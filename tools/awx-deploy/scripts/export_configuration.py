#!/usr/bin/env python3
"""Export Capstan controller configuration into a secret-safe manifest."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from reconcile_configuration import ConfigurationError, ControllerClient, ENCRYPTED_MARKERS, _redact_sensitive


READ_ONLY_FIELDS = {
    "id",
    "type",
    "url",
    "related",
    "summary_fields",
    "created",
    "modified",
    "created_by",
    "modified_by",
    "managed",
    "status",
    "last_job_run",
    "last_job_failed",
    "next_job_run",
    "last_update_failed",
    "last_updated",
    "pending_deletion",
}
SECRET_NAME_PATTERN = re.compile(r"(password|passphrase|token|secret|private|api_key|ssh_key)", re.IGNORECASE)
NON_ALNUM_PATTERN = re.compile(r"[^a-z0-9]+")


@dataclass(frozen=True)
class ResourceProfile:
    kind: str
    endpoint: str
    fields: tuple[str, ...]
    foreign_keys: dict[str, str] = field(default_factory=dict)
    list_foreign_keys: dict[str, str] = field(default_factory=dict)
    associations: dict[str, str] = field(default_factory=dict)
    parent_field: str = ""
    parent_relation: str = ""
    include: Callable[[dict[str, Any], bool], bool] = lambda _item, _managed: True
    survey: bool = False


def _exclude_managed(item: dict[str, Any], include_managed: bool) -> bool:
    return include_managed or not item.get("managed", False)


def _exclude_seed_instance_groups(item: dict[str, Any], include_managed: bool) -> bool:
    return include_managed or item.get("name") not in {"controlplane", "default"}


def _exclude_system_schedules(item: dict[str, Any], include_managed: bool) -> bool:
    unified = item.get("summary_fields", {}).get("unified_job_template", {})
    return include_managed or unified.get("unified_job_type") != "system_job"


def _exclude_admin(item: dict[str, Any], include_managed: bool) -> bool:
    return include_managed or item.get("username") != "admin"


PROFILES = (
    ResourceProfile(
        "organization",
        "/api/v2/organizations/",
        ("name", "description", "max_hosts", "default_environment", "opa_query_path"),
        foreign_keys={"default_environment": "execution_environment"},
        associations={"instance_groups": "instance_group", "galaxy_credentials": "credential"},
    ),
    ResourceProfile(
        "credential_type",
        "/api/v2/credential_types/",
        ("name", "description", "kind", "inputs", "injectors"),
        include=_exclude_managed,
    ),
    ResourceProfile(
        "role_definition",
        "/api/v2/role_definitions/",
        ("name", "description", "content_type", "permissions"),
        include=_exclude_managed,
    ),
    ResourceProfile(
        "user_type",
        "/api/v2/user_types/",
        ("name", "description", "role_definitions"),
        list_foreign_keys={"role_definitions": "role_definition"},
    ),
    ResourceProfile(
        "team",
        "/api/v2/teams/",
        ("name", "description", "organization"),
        foreign_keys={"organization": "organization"},
    ),
    ResourceProfile(
        "user",
        "/api/v2/users/",
        ("username", "first_name", "last_name", "email", "is_superuser", "is_system_auditor", "custom_user_type", "password"),
        foreign_keys={"custom_user_type": "user_type"},
        include=_exclude_admin,
    ),
    ResourceProfile(
        "notification_template",
        "/api/v2/notification_templates/",
        ("name", "description", "organization", "notification_type", "notification_configuration", "messages"),
        foreign_keys={"organization": "organization"},
    ),
    ResourceProfile(
        "credential",
        "/api/v2/credentials/",
        ("name", "description", "organization", "credential_type", "inputs"),
        foreign_keys={"organization": "organization", "credential_type": "credential_type"},
    ),
    ResourceProfile(
        "cloud_connection",
        "/api/v2/catalog_cloud/connections/",
        ("provider_id", "name", "credential", "organization"),
        foreign_keys={"credential": "credential", "organization": "organization"},
    ),
    ResourceProfile(
        "execution_environment",
        "/api/v2/execution_environments/",
        ("name", "description", "organization", "image", "pull", "credential"),
        foreign_keys={"organization": "organization", "credential": "credential"},
        include=_exclude_managed,
    ),
    ResourceProfile(
        "instance_group",
        "/api/v2/instance_groups/",
        (
            "name",
            "credential",
            "is_container_group",
            "policy_instance_percentage",
            "policy_instance_minimum",
            "max_concurrent_jobs",
            "max_forks",
            "pod_spec_override",
        ),
        foreign_keys={"credential": "credential"},
        include=_exclude_seed_instance_groups,
    ),
    ResourceProfile(
        "label",
        "/api/v2/labels/",
        ("name", "organization"),
        foreign_keys={"organization": "organization"},
    ),
    ResourceProfile(
        "project",
        "/api/v2/projects/",
        (
            "name",
            "description",
            "organization",
            "scm_type",
            "scm_url",
            "scm_branch",
            "scm_refspec",
            "scm_clean",
            "scm_delete_on_update",
            "scm_track_submodules",
            "scm_update_on_launch",
            "scm_update_cache_timeout",
            "allow_override",
            "timeout",
            "credential",
            "signature_validation_credential",
            "default_environment",
        ),
        foreign_keys={
            "organization": "organization",
            "credential": "credential",
            "signature_validation_credential": "credential",
            "default_environment": "execution_environment",
        },
        associations={
            "notification_templates_started": "notification_template",
            "notification_templates_success": "notification_template",
            "notification_templates_error": "notification_template",
        },
    ),
    ResourceProfile(
        "inventory",
        "/api/v2/inventories/",
        (
            "name",
            "description",
            "organization",
            "kind",
            "host_filter",
            "variables",
            "prevent_instance_group_fallback",
            "default_machine_credential",
            "force_inventory_machine_credential",
            "opa_query_path",
        ),
        foreign_keys={"organization": "organization", "default_machine_credential": "credential"},
        associations={"instance_groups": "instance_group", "input_inventories": "inventory"},
    ),
    ResourceProfile(
        "constructed_inventory",
        "/api/v2/constructed_inventories/",
        (
            "name",
            "description",
            "organization",
            "variables",
            "limit",
            "source_vars",
            "verbosity",
            "update_cache_timeout",
            "prevent_instance_group_fallback",
            "default_machine_credential",
            "force_inventory_machine_credential",
            "opa_query_path",
        ),
        foreign_keys={"organization": "organization", "default_machine_credential": "credential"},
        associations={"input_inventories": "inventory", "instance_groups": "instance_group"},
    ),
    ResourceProfile(
        "group",
        "/api/v2/groups/",
        ("name", "description", "inventory", "variables"),
        foreign_keys={"inventory": "inventory"},
        associations={"children": "group", "hosts": "host"},
        parent_field="inventory",
        parent_relation="groups",
    ),
    ResourceProfile(
        "host",
        "/api/v2/hosts/",
        ("name", "description", "inventory", "enabled", "instance_id", "variables"),
        foreign_keys={"inventory": "inventory"},
        associations={"groups": "group"},
        parent_field="inventory",
        parent_relation="hosts",
    ),
    ResourceProfile(
        "inventory_source",
        "/api/v2/inventory_sources/",
        (
            "name",
            "description",
            "inventory",
            "source",
            "source_path",
            "source_vars",
            "source_project",
            "scm_branch",
            "credential",
            "enabled_var",
            "enabled_value",
            "host_filter",
            "overwrite",
            "overwrite_vars",
            "timeout",
            "verbosity",
            "update_on_launch",
            "update_cache_timeout",
            "execution_environment",
        ),
        foreign_keys={
            "inventory": "inventory",
            "source_project": "project",
            "credential": "credential",
            "execution_environment": "execution_environment",
        },
        associations={
            "credentials": "credential",
            "notification_templates_started": "notification_template",
            "notification_templates_success": "notification_template",
            "notification_templates_error": "notification_template",
        },
        parent_field="inventory",
        parent_relation="inventory_sources",
    ),
    ResourceProfile(
        "job_template",
        "/api/v2/job_templates/",
        (
            "name",
            "description",
            "organization",
            "inventory",
            "project",
            "playbook",
            "execution_environment",
            "job_type",
            "scm_branch",
            "forks",
            "limit",
            "verbosity",
            "extra_vars",
            "job_tags",
            "force_handlers",
            "skip_tags",
            "start_at_task",
            "timeout",
            "use_fact_cache",
            "host_config_key",
            "ask_scm_branch_on_launch",
            "ask_diff_mode_on_launch",
            "ask_variables_on_launch",
            "ask_limit_on_launch",
            "ask_tags_on_launch",
            "ask_skip_tags_on_launch",
            "ask_job_type_on_launch",
            "ask_verbosity_on_launch",
            "ask_inventory_on_launch",
            "ask_credential_on_launch",
            "ask_execution_environment_on_launch",
            "ask_labels_on_launch",
            "ask_forks_on_launch",
            "ask_job_slice_count_on_launch",
            "ask_timeout_on_launch",
            "ask_instance_groups_on_launch",
            "survey_enabled",
            "become_enabled",
            "diff_mode",
            "allow_simultaneous",
            "job_slice_count",
            "webhook_service",
            "webhook_credential",
            "prevent_instance_group_fallback",
            "opa_query_path",
        ),
        foreign_keys={
            "organization": "organization",
            "inventory": "inventory",
            "project": "project",
            "execution_environment": "execution_environment",
            "webhook_credential": "credential",
        },
        associations={
            "credentials": "credential",
            "labels": "label",
            "instance_groups": "instance_group",
            "notification_templates_started": "notification_template",
            "notification_templates_success": "notification_template",
            "notification_templates_error": "notification_template",
        },
        survey=True,
    ),
    ResourceProfile(
        "workflow_job_template",
        "/api/v2/workflow_job_templates/",
        (
            "name",
            "description",
            "organization",
            "inventory",
            "extra_vars",
            "limit",
            "scm_branch",
            "job_tags",
            "skip_tags",
            "ask_variables_on_launch",
            "ask_inventory_on_launch",
            "ask_scm_branch_on_launch",
            "ask_limit_on_launch",
            "ask_labels_on_launch",
            "ask_skip_tags_on_launch",
            "ask_tags_on_launch",
            "survey_enabled",
            "allow_simultaneous",
            "webhook_service",
            "webhook_credential",
        ),
        foreign_keys={"organization": "organization", "inventory": "inventory", "webhook_credential": "credential"},
        associations={
            "labels": "label",
            "notification_templates_started": "notification_template",
            "notification_templates_success": "notification_template",
            "notification_templates_error": "notification_template",
        },
        survey=True,
    ),
    ResourceProfile(
        "terraform_job_template",
        "/api/v2/terraform_job_templates/",
        (
            "name",
            "description",
            "organization",
            "project",
            "execution_environment",
            "terraform_dir",
            "extra_vars",
            "verbosity",
            "terraform_operation",
            "target_inventory",
            "target_group",
            "allow_simultaneous",
            "timeout",
            "ask_variables_on_launch",
            "ask_inventory_on_launch",
            "ask_terraform_operation_on_launch",
            "survey_enabled",
        ),
        foreign_keys={
            "organization": "organization",
            "project": "project",
            "execution_environment": "execution_environment",
            "target_inventory": "inventory",
        },
        associations={"credentials": "credential"},
        survey=True,
    ),
    ResourceProfile(
        "ee_build_template",
        "/api/v2/quay/execution-environment-images/templates/",
        (
            "name",
            "description",
            "organization",
            "project",
            "namespace",
            "repository",
            "tag",
            "runtime",
            "definition_file",
            "context_path",
            "execution_environment",
        ),
        foreign_keys={"organization": "organization", "project": "project", "execution_environment": "execution_environment"},
        associations={
            "instance_groups": "instance_group",
            "notification_templates_started": "notification_template",
            "notification_templates_success": "notification_template",
            "notification_templates_error": "notification_template",
        },
    ),
    ResourceProfile(
        "workflow_node",
        "/api/v2/workflow_job_template_nodes/",
        (
            "workflow_job_template",
            "unified_job_template",
            "identifier",
            "all_parents_must_converge",
            "inventory",
            "scm_branch",
            "job_type",
            "job_tags",
            "skip_tags",
            "limit",
            "diff_mode",
            "verbosity",
            "extra_data",
            "node_type",
            "eda_rulebook_name",
            "eda_activation_id",
            "eda_event_source",
            "ai_task_prompt",
            "ai_task_model",
            "ai_task_approval_required",
        ),
        foreign_keys={"workflow_job_template": "workflow_job_template", "unified_job_template": "unified_job_template", "inventory": "inventory"},
        associations={"credentials": "credential", "success_nodes": "workflow_node", "failure_nodes": "workflow_node", "always_nodes": "workflow_node"},
        parent_field="workflow_job_template",
        parent_relation="workflow_nodes",
    ),
    ResourceProfile(
        "catalog_item",
        "/api/v2/catalog_items/",
        (
            "name",
            "description",
            "organization",
            "icon_url",
            "icon_data",
            "name_template",
            "dynamic_name_field",
            "dynamic_field_templates",
            "deploy_disabled_fields",
            "deploy_hidden_fields",
            "provision_workflow",
            "terraform_job_template",
            "deprovision_workflow",
            "override_workflow_limit",
            "browse_enabled",
            "extra_vars_schema",
            "cloud_backends",
            "provider_workflows",
            "provider_deprovision_workflows",
            "available_providers",
            "provider_field_configs",
            "configure_workflow",
            "validate_workflow",
            "default_lease_minutes",
            "require_lease",
        ),
        foreign_keys={
            "organization": "organization",
            "provision_workflow": "workflow_job_template",
            "terraform_job_template": "terraform_job_template",
            "deprovision_workflow": "workflow_job_template",
            "configure_workflow": "workflow_job_template",
            "validate_workflow": "workflow_job_template",
        },
    ),
    ResourceProfile(
        "schedule",
        "/api/v2/schedules/",
        (
            "name",
            "description",
            "rrule",
            "enabled",
            "unified_job_template",
            "extra_data",
            "inventory",
            "execution_environment",
            "scm_branch",
            "job_type",
            "job_tags",
            "skip_tags",
            "limit",
            "diff_mode",
            "verbosity",
            "forks",
            "job_slice_count",
            "timeout",
        ),
        foreign_keys={"unified_job_template": "unified_job_template", "inventory": "inventory", "execution_environment": "execution_environment"},
        include=_exclude_system_schedules,
    ),
    ResourceProfile(
        "role_user_assignment",
        "/api/v2/role_user_assignments/",
        ("role_definition", "user", "object_id"),
        foreign_keys={"role_definition": "role_definition", "user": "user"},
    ),
    ResourceProfile(
        "role_team_assignment",
        "/api/v2/role_team_assignments/",
        ("role_definition", "team", "object_id"),
        foreign_keys={"role_definition": "role_definition", "team": "team"},
    ),
)

PROFILE_BY_KIND = {profile.kind: profile for profile in PROFILES}
LOOKUP_ENDPOINTS = {
    "unified_job_template": "/api/v2/unified_job_templates/",
}
ROLE_CONTENT_TYPE_KINDS = {
    "catalogitem": "catalog_item",
    "credential": "credential",
    "executionenvironment": "execution_environment",
    "instancegroup": "instance_group",
    "inventory": "inventory",
    "jobtemplate": "job_template",
    "notificationtemplate": "notification_template",
    "organization": "organization",
    "project": "project",
    "quayimagebuildtemplate": "ee_build_template",
    "team": "team",
    "terraformjobtemplate": "terraform_job_template",
    "workflowjobtemplate": "workflow_job_template",
}


def _slug(value: Any) -> str:
    normalized = NON_ALNUM_PATTERN.sub("_", str(value or "resource").lower()).strip("_")
    return normalized or "resource"


class ConfigurationExporter:
    def __init__(
        self,
        client: ControllerClient,
        include_users: bool = False,
        include_managed: bool = False,
        selected_resources: set[str] | None = None,
        setting_names: list[str] | None = None,
    ):
        self.client = client
        self.include_users = include_users
        self.include_managed = include_managed
        self.selected_resources = selected_resources
        self.setting_names = setting_names or []
        self.objects: dict[str, list[dict[str, Any]]] = {}
        self.keys: dict[tuple[str, int], str] = {}
        self.secrets: set[str] = set()
        self.warnings: list[str] = []

    def _enabled_profiles(self) -> list[ResourceProfile]:
        profiles = []
        for profile in PROFILES:
            if self.selected_resources is not None and profile.kind not in self.selected_resources:
                continue
            if profile.kind in {"user", "role_user_assignment", "role_team_assignment"} and not self.include_users:
                continue
            profiles.append(profile)
        return profiles

    def _load_objects(self, profiles: list[ResourceProfile]) -> None:
        for profile in profiles:
            try:
                rows = self.client.list(profile.endpoint)
            except ConfigurationError as exc:
                self.warnings.append(f"{profile.kind}: {exc}")
                rows = []
            self.objects[profile.kind] = [row for row in rows if profile.include(row, self.include_managed)]

        seen: set[str] = set()
        for profile in profiles:
            rows = self.objects[profile.kind]
            for row in rows:
                object_id = row.get("id")
                if not isinstance(object_id, int):
                    continue
                label = row.get("name") or row.get("username") or row.get("identifier") or object_id
                key = f"{profile.kind}.{_slug(label)}"
                if key in seen:
                    key = f"{key}_{object_id}"
                seen.add(key)
                self.keys[(profile.kind, object_id)] = key
                if profile.kind in {
                    "job_template",
                    "workflow_job_template",
                    "terraform_job_template",
                    "ee_build_template",
                }:
                    self.keys[("unified_job_template", object_id)] = key

    def _find_object(self, kind: str, object_id: int) -> dict[str, Any] | None:
        for item in self.objects.get(kind, []):
            if item.get("id") == object_id:
                return item
        profile = PROFILE_BY_KIND.get(kind)
        endpoint = profile.endpoint if profile else LOOKUP_ENDPOINTS.get(kind)
        if endpoint is None:
            return None
        try:
            rows = self.client.list(endpoint, {"id": object_id})
        except ConfigurationError:
            return None
        return rows[0] if len(rows) == 1 else None

    def _reference(self, kind: str, value: Any) -> Any:
        if value in (None, ""):
            return value
        if isinstance(value, dict) and isinstance(value.get("id"), int):
            value = value["id"]
        if not isinstance(value, int):
            return value
        key = self.keys.get((kind, value))
        if key:
            return {"$ref": key}
        item = self._find_object(kind, value)
        if not item:
            self.warnings.append(f"Could not make portable reference for {kind} id={value}; retaining numeric id")
            return value
        name_field = "username" if kind == "user" else "name"
        name = item.get(name_field)
        if not name:
            self.warnings.append(f"Could not make named lookup for {kind} id={value}; retaining numeric id")
            return value
        profile = PROFILE_BY_KIND.get(kind)
        endpoint = profile.endpoint if profile else LOOKUP_ENDPOINTS.get(kind, f"/api/v2/{kind}s/")
        match = {name_field: name}
        if kind == "credential_type" and item.get("kind"):
            match["kind"] = item["kind"]
        return {"$lookup": {"endpoint": endpoint, "match": match}}

    def _secret_reference(self, prefix: str, field_name: str) -> str:
        name = f"CAPSTAN_{_slug(prefix).upper()}_{_slug(field_name).upper()}"
        self.secrets.add(name)
        return f"${{{name}}}"

    def _credential_inputs(self, item: dict[str, Any]) -> dict[str, Any]:
        inputs = item.get("inputs") or {}
        if not isinstance(inputs, dict):
            return inputs
        credential_type = self._find_object("credential_type", item.get("credential_type"))
        fields = ((credential_type or {}).get("inputs") or {}).get("fields", [])
        secret_fields = {field.get("id") for field in fields if isinstance(field, dict) and field.get("secret")}
        result = {}
        for key, value in inputs.items():
            if key in secret_fields or value in ENCRYPTED_MARKERS or SECRET_NAME_PATTERN.search(key):
                result[key] = self._secret_reference(f"credential_{item.get('name')}", key)
            else:
                result[key] = value
        return result

    def _notification_configuration(self, item: dict[str, Any]) -> dict[str, Any]:
        configuration = item.get("notification_configuration") or {}
        if not isinstance(configuration, dict):
            return configuration

        def replace(value: Any, path: list[str]) -> Any:
            if isinstance(value, dict):
                return {key: replace(child, [*path, key]) for key, child in value.items()}
            if isinstance(value, list):
                return [replace(child, [*path, str(index)]) for index, child in enumerate(value)]
            if value is None or isinstance(value, (bool, int, float)):
                return value
            if value == "" or (path[-1] == "http_method" and value in {"GET", "POST", "PUT", "PATCH", "DELETE"}):
                return value
            return self._secret_reference(f"notification_{item.get('name')}", "_".join(path))

        return {key: replace(value, [key]) for key, value in configuration.items()}

    def _resource_data(self, profile: ResourceProfile, item: dict[str, Any]) -> dict[str, Any]:
        data: dict[str, Any] = {}
        for name in profile.fields:
            if name in READ_ONLY_FIELDS or name not in item:
                continue
            value = item[name]
            if name in profile.foreign_keys:
                value = self._reference(profile.foreign_keys[name], value)
            elif name in profile.list_foreign_keys and isinstance(value, list):
                value = [self._reference(profile.list_foreign_keys[name], entry) for entry in value]
            data[name] = value

        if profile.kind == "credential":
            data["inputs"] = self._credential_inputs(item)
        elif profile.kind == "notification_template":
            data["notification_configuration"] = self._notification_configuration(item)
        elif profile.kind == "user":
            data["password"] = self._secret_reference(f"user_{item.get('username')}", "password")
            user_type = item.get("summary_fields", {}).get("custom_user_type", {}).get("id")
            if user_type:
                data["custom_user_type"] = self._reference("user_type", user_type)
        elif profile.kind == "catalog_item":
            for field_name in ("provider_workflows", "provider_deprovision_workflows"):
                if isinstance(data.get(field_name), dict):
                    data[field_name] = {provider: self._reference("workflow_job_template", template_id) for provider, template_id in data[field_name].items()}
        elif profile.kind == "ee_build_template":
            # The Project Quay facade accepts both names but returns `context`.
            # Export one canonical field so a roundtrip does not report drift.
            context = item.get("context", item.get("context_path"))
            data.pop("context_path", None)
            if context is not None:
                data["context"] = context
        elif profile.kind in {"role_user_assignment", "role_team_assignment"} and item.get("object_id"):
            role = self._find_object("role_definition", item.get("role_definition"))
            model = str((role or {}).get("content_type", "")).rsplit(".", 1)[-1]
            target_kind = ROLE_CONTENT_TYPE_KINDS.get(model)
            if target_kind:
                data["object_id"] = self._reference(target_kind, item["object_id"])
            else:
                self.warnings.append(
                    f"{profile.kind}.{item.get('id')}: unknown role content type {(role or {}).get('content_type')!r}; retaining numeric object_id"
                )
        return data

    def _match(self, profile: ResourceProfile, item: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
        if profile.kind in {"role_user_assignment", "role_team_assignment"}:
            fields = ("role_definition", "user" if profile.kind == "role_user_assignment" else "team", "object_id")
            return {name: data.get(name) for name in fields}
        identity = "username" if profile.kind == "user" else "identifier" if profile.kind == "workflow_node" else "name"
        match = {identity: data[identity]}
        for scope in ("organization", profile.parent_field):
            if scope and scope in data and data[scope] is not None:
                match[scope] = data[scope]
        if profile.kind == "credential_type" and data.get("kind"):
            match["kind"] = data["kind"]
        if profile.kind == "cloud_connection":
            match["provider_id"] = data["provider_id"]
        return match

    def _endpoint(self, profile: ResourceProfile, data: dict[str, Any]) -> Any:
        if profile.parent_field and isinstance(data.get(profile.parent_field), dict) and "$ref" in data[profile.parent_field]:
            return {"$related": {"ref": data[profile.parent_field]["$ref"], "name": profile.parent_relation}}
        return profile.endpoint

    def _association_specs(self, profile: ResourceProfile, item: dict[str, Any]) -> list[dict[str, Any]]:
        specs = []
        for relation, target_kind in profile.associations.items():
            related_url = (item.get("related") or {}).get(relation)
            if not related_url:
                continue
            try:
                related = self.client.list(related_url)
            except ConfigurationError as exc:
                self.warnings.append(f"{profile.kind}.{item.get('id')}.{relation}: {exc}")
                continue
            references = [self._reference(target_kind, row.get("id")) for row in related if row.get("id") is not None]
            specs.append({"name": relation, "exact": True, "items": references})
        return specs

    def _survey_actions(self, profile: ResourceProfile, item: dict[str, Any]) -> list[dict[str, Any]]:
        if not profile.survey or not item.get("survey_enabled"):
            return []
        survey_url = (item.get("related") or {}).get("survey_spec")
        if not survey_url:
            return []
        try:
            survey = self.client.request("GET", survey_url)
        except ConfigurationError as exc:
            self.warnings.append(f"{profile.kind}.{item.get('id')}.survey_spec: {exc}")
            return []
        if not isinstance(survey, dict) or not survey.get("spec"):
            return []
        return [{"path": "survey_spec", "method": "POST", "when": "changed", "data": survey}]

    def _settings(self) -> dict[str, Any]:
        if not self.setting_names:
            return {}
        current = self.client.request("GET", "/api/v2/settings/all/")
        result = {}
        for name in self.setting_names:
            if name not in current:
                raise ConfigurationError(f"setting {name!r} does not exist on the source controller")
            value = current[name]
            if SECRET_NAME_PATTERN.search(name):
                value = self._secret_reference("setting", name)
            result[name] = value
        return result

    def export(self) -> dict[str, Any]:
        profiles = self._enabled_profiles()
        self._load_objects(profiles)
        resources = []
        for profile in profiles:
            for item in self.objects.get(profile.kind, []):
                object_id = item.get("id")
                if not isinstance(object_id, int) or (profile.kind, object_id) not in self.keys:
                    continue
                data = self._resource_data(profile, item)
                spec: dict[str, Any] = {
                    "key": self.keys[(profile.kind, object_id)],
                    "endpoint": self._endpoint(profile, data),
                    "match": self._match(profile, item, data),
                    "data": data,
                }
                associations = self._association_specs(profile, item)
                if associations:
                    spec["associations"] = associations
                actions = self._survey_actions(profile, item)
                if actions:
                    spec["actions"] = actions
                if profile.kind in {"credential", "notification_template", "user"}:
                    spec["secret_update"] = "preserve"
                resources.append(spec)
        return {"version": 1, "settings": self._settings(), "resources": resources}


def _write(path: str, content: str, force: bool) -> None:
    if path == "-":
        sys.stdout.write(content)
        return
    output = Path(path)
    if output.exists() and not force:
        raise ConfigurationError(f"{output} already exists; use --force to replace it")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(content, encoding="utf-8")


def _dump(document: dict[str, Any], output_format: str) -> str:
    if output_format == "json":
        return json.dumps(document, indent=2, sort_keys=False) + "\n"
    try:
        import yaml
    except ImportError as exc:
        raise ConfigurationError("PyYAML is required for YAML output; use --format json or install PyYAML") from exc
    return yaml.safe_dump(document, sort_keys=False, width=120, default_flow_style=False)


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--controller", default=os.getenv("CAPSTAN_CONTROLLER_URL", ""))
    parser.add_argument("--username", default=os.getenv("CAPSTAN_CONTROLLER_USERNAME", ""))
    parser.add_argument("--password", default=os.getenv("CAPSTAN_CONTROLLER_PASSWORD", ""))
    parser.add_argument("--token", default=os.getenv("CAPSTAN_CONTROLLER_TOKEN", ""))
    parser.add_argument("--timeout", type=int, default=int(os.getenv("CAPSTAN_CONTROLLER_TIMEOUT", "30")))
    parser.add_argument("--insecure", action="store_true", default=os.getenv("CAPSTAN_CONTROLLER_VERIFY_SSL", "true").lower() in {"0", "false", "no"})
    parser.add_argument("--output", default="-", help="Manifest destination, or - for stdout")
    parser.add_argument("--format", choices=("yaml", "json"), default="yaml")
    parser.add_argument("--env-example", help="Write required secret variable names with blank values")
    parser.add_argument("--resource", action="append", choices=tuple(PROFILE_BY_KIND), help="Export only this resource kind; repeatable")
    parser.add_argument("--setting", action="append", default=[], help="Include one explicit controller setting; repeatable")
    parser.add_argument("--include-users", action="store_true", help="Include users and RBAC assignments with password placeholders")
    parser.add_argument("--include-managed", action="store_true", help="Include managed/seed resources and the admin account")
    parser.add_argument("--force", action="store_true", help="Replace output files if they already exist")
    args = parser.parse_args(argv)
    if not args.controller:
        parser.error("--controller or CAPSTAN_CONTROLLER_URL is required")
    if not args.token and not args.username:
        parser.error("CAPSTAN_CONTROLLER_TOKEN or CAPSTAN_CONTROLLER_USERNAME is required")
    return args


def main(argv: list[str] | None = None) -> int:
    try:
        args = _parse_args(argv or sys.argv[1:])
        client = ControllerClient(
            args.controller,
            username=args.username,
            password=args.password,
            token=args.token,
            verify_ssl=not args.insecure,
            timeout=args.timeout,
        )
        exporter = ConfigurationExporter(
            client,
            include_users=args.include_users,
            include_managed=args.include_managed,
            selected_resources=set(args.resource) if args.resource else None,
            setting_names=args.setting,
        )
        document = exporter.export()
        _write(args.output, _dump(document, args.format), args.force)
        if args.env_example:
            _write(args.env_example, "".join(f"{name}=\n" for name in sorted(exporter.secrets)), args.force)
        print(
            json.dumps(
                {
                    "exported": len(document["resources"]),
                    "settings": len(document["settings"]),
                    "secret_variables": len(exporter.secrets),
                    "warnings": exporter.warnings,
                },
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 0
    except (ConfigurationError, OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"failed": True, "message": _redact_sensitive(str(exc))}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
