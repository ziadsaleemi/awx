#!/usr/bin/env python3
"""Reconcile Capstan controller resources from ordered YAML or JSON manifests."""

from __future__ import annotations

import argparse
import base64
import copy
import json
import os
import re
import ssl
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen


ENV_PATTERN = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}")
SECRET_ENV_PATTERN = re.compile(r"(PASSWORD|PASS|TOKEN|SECRET|PRIVATE|API_KEY|SSH_KEY)", re.IGNORECASE)
ENCRYPTED_MARKERS = {"$encrypted$", "**********"}


class ConfigurationError(RuntimeError):
    pass


def _redact_sensitive(message: str) -> str:
    redacted = message
    for name, value in os.environ.items():
        if SECRET_ENV_PATTERN.search(name) and value and len(value) >= 4:
            redacted = redacted.replace(value, "**********")
    return redacted


def _load_document(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() == ".json":
        data = json.loads(text)
    else:
        try:
            import yaml
        except ImportError as exc:
            raise ConfigurationError("PyYAML is required for YAML manifests; use JSON or install PyYAML") from exc
        data = yaml.safe_load(text)
    if not isinstance(data, dict):
        raise ConfigurationError(f"{path}: manifest root must be an object")
    return data


def _expand_environment(value: Any, source: str) -> Any:
    if isinstance(value, dict):
        if set(value) == {"$env"}:
            name = value["$env"]
            if not isinstance(name, str) or not name:
                raise ConfigurationError(f"{source}: $env must name an environment variable")
            if name not in os.environ:
                raise ConfigurationError(f"{source}: required environment variable {name} is not set")
            return os.environ[name]
        return {key: _expand_environment(item, source) for key, item in value.items()}
    if isinstance(value, list):
        return [_expand_environment(item, source) for item in value]
    if not isinstance(value, str):
        return value

    def replace(match: re.Match[str]) -> str:
        name, default = match.group(1), match.group(2)
        if name in os.environ:
            return os.environ[name]
        if default is not None:
            return default
        raise ConfigurationError(f"{source}: required environment variable {name} is not set")

    return ENV_PATTERN.sub(replace, value)


def load_manifests(paths: list[Path]) -> dict[str, Any]:
    combined: dict[str, Any] = {"version": 1, "settings": {}, "resources": []}
    seen_keys: set[str] = set()
    for path in paths:
        document = _expand_environment(_load_document(path), str(path))
        if document.get("version", 1) != 1:
            raise ConfigurationError(f"{path}: unsupported manifest version {document.get('version')!r}")
        settings = document.get("settings", {})
        resources = document.get("resources", [])
        if not isinstance(settings, dict):
            raise ConfigurationError(f"{path}: settings must be an object")
        if not isinstance(resources, list):
            raise ConfigurationError(f"{path}: resources must be a list")
        combined["settings"].update(settings)
        for resource in resources:
            if not isinstance(resource, dict):
                raise ConfigurationError(f"{path}: every resource must be an object")
            key = resource.get("key")
            if not isinstance(key, str) or not key:
                raise ConfigurationError(f"{path}: every resource requires a unique key")
            if key in seen_keys:
                raise ConfigurationError(f"{path}: duplicate resource key {key!r}")
            seen_keys.add(key)
            combined["resources"].append(resource)
    return combined


class ControllerClient:
    def __init__(self, base_url: str, username: str = "", password: str = "", token: str = "", verify_ssl: bool = True, timeout: int = 30):
        self.base_url = base_url.rstrip("/") + "/"
        self.timeout = timeout
        self.headers = {"Accept": "application/json", "Content-Type": "application/json", "User-Agent": "capstan-config/1"}
        if token:
            self.headers["Authorization"] = f"Bearer {token}"
        elif username:
            encoded = base64.b64encode(f"{username}:{password}".encode()).decode()
            self.headers["Authorization"] = f"Basic {encoded}"
        self.ssl_context = None
        if self.base_url.startswith("https://") and not verify_ssl:
            self.ssl_context = ssl._create_unverified_context()

    def request(self, method: str, path: str, data: Any = None) -> Any:
        url = path if path.startswith(("http://", "https://")) else urljoin(self.base_url, path.lstrip("/"))
        body = None if data is None else json.dumps(data).encode("utf-8")
        request = Request(url, data=body, headers=self.headers, method=method.upper())
        try:
            with urlopen(request, timeout=self.timeout, context=self.ssl_context) as response:
                payload = response.read()
        except HTTPError as exc:
            payload = exc.read().decode("utf-8", errors="replace")
            try:
                detail = json.loads(payload)
            except json.JSONDecodeError:
                detail = payload[:500]
            raise ConfigurationError(f"{method.upper()} {url} returned HTTP {exc.code}: {detail}") from exc
        except URLError as exc:
            raise ConfigurationError(f"{method.upper()} {url} failed: {exc.reason}") from exc
        if not payload:
            return None
        return json.loads(payload.decode("utf-8"))

    def list(self, endpoint: str, match: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        query = dict(match or {})
        query.setdefault("page_size", 200)
        separator = "&" if "?" in endpoint else "?"
        next_path: str | None = f"{endpoint}{separator}{urlencode(query, doseq=True)}"
        results: list[dict[str, Any]] = []
        while next_path:
            response = self.request("GET", next_path)
            if isinstance(response, list):
                results.extend(response)
                break
            if not isinstance(response, dict) or not isinstance(response.get("results"), list):
                raise ConfigurationError(f"GET {endpoint}: expected a paginated list response")
            results.extend(response["results"])
            next_path = response.get("next")
        return results


@dataclass
class ResourceState:
    key: str
    endpoint: str
    object: dict[str, Any]
    action: str


class ConfigurationReconciler:
    def __init__(self, client: ControllerClient, check_mode: bool = False):
        self.client = client
        self.check_mode = check_mode
        self.registry: dict[str, ResourceState] = {}
        self.summary = {"created": 0, "updated": 0, "deleted": 0, "associated": 0, "disassociated": 0, "actions": 0, "unchanged": 0}
        self.events: list[dict[str, str]] = []

    @staticmethod
    def _endpoint(value: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ConfigurationError("resource endpoint must be a non-empty string")
        endpoint = value.strip()
        if not endpoint.startswith(("http://", "https://", "/")):
            endpoint = f"/api/v2/{endpoint.strip('/')}/"
        elif endpoint.startswith("/") and not endpoint.endswith("/"):
            endpoint += "/"
        return endpoint

    def _lookup(self, endpoint: str, match: dict[str, Any], description: str) -> dict[str, Any] | None:
        results = self.client.list(endpoint, match)
        if len(results) > 1:
            raise ConfigurationError(f"{description}: lookup matched {len(results)} resources; make match fields unique")
        return results[0] if results else None

    def _resolve(self, value: Any) -> Any:
        if isinstance(value, dict) and set(value) == {"$ref"}:
            key = value["$ref"]
            if key not in self.registry:
                raise ConfigurationError(f"reference {key!r} is unresolved; resources must be ordered before their consumers")
            object_id = self.registry[key].object.get("id")
            if object_id is None:
                raise ConfigurationError(f"reference {key!r} has no API id")
            return object_id
        if isinstance(value, dict) and set(value) == {"$lookup"}:
            lookup = value["$lookup"]
            if not isinstance(lookup, dict) or "endpoint" not in lookup or "match" not in lookup:
                raise ConfigurationError("$lookup requires endpoint and match")
            endpoint = self._endpoint(lookup["endpoint"])
            match = self._resolve(lookup["match"])
            found = self._lookup(endpoint, match, f"external lookup {match}")
            if not found:
                raise ConfigurationError(f"external lookup at {endpoint} did not match {match}")
            return found[lookup.get("field", "id")]
        if isinstance(value, dict):
            return {key: self._resolve(item) for key, item in value.items()}
        if isinstance(value, list):
            return [self._resolve(item) for item in value]
        return value

    @staticmethod
    def _different(existing: Any, desired: Any) -> bool:
        if isinstance(existing, str) and existing in ENCRYPTED_MARKERS and desired not in (None, ""):
            return False
        if isinstance(desired, dict):
            if not isinstance(existing, dict):
                return True
            return any(ConfigurationReconciler._different(existing.get(key), value) for key, value in desired.items())
        if isinstance(desired, list):
            return existing != desired
        if isinstance(existing, str) and isinstance(desired, str):
            return existing.rstrip() != desired.rstrip()
        return existing != desired

    @staticmethod
    def _detail_path(endpoint: str, obj: dict[str, Any]) -> str:
        if isinstance(obj.get("url"), str):
            return obj["url"]
        return f"{endpoint.rstrip('/')}/{obj['id']}/"

    def _reconcile_settings(self, settings: dict[str, Any]) -> None:
        if not settings:
            return
        current = self.client.request("GET", "/api/v2/settings/all/")
        desired = self._resolve(settings)
        changed = {key: value for key, value in desired.items() if self._different(current.get(key), value)}
        if not changed:
            self.summary["unchanged"] += 1
            self.events.append({"key": "settings", "action": "unchanged"})
            return
        self.summary["updated"] += 1
        self.events.append({"key": "settings", "action": "updated"})
        if not self.check_mode:
            self.client.request("PATCH", "/api/v2/settings/all/", changed)

    def _reconcile_resource(self, spec: dict[str, Any]) -> None:
        key = spec["key"]
        endpoint = self._endpoint(spec.get("endpoint", spec.get("kind", "")))
        state = spec.get("state", "present")
        if state not in {"present", "absent"}:
            raise ConfigurationError(f"{key}: state must be present or absent")
        match = self._resolve(spec.get("match", {}))
        data = self._resolve(spec.get("data", {}))
        if not isinstance(match, dict) or not match:
            raise ConfigurationError(f"{key}: match must contain at least one unique field")
        if not isinstance(data, dict):
            raise ConfigurationError(f"{key}: data must be an object")
        found = self._lookup(endpoint, match, key)

        if state == "absent":
            if found is None:
                self.summary["unchanged"] += 1
                self.registry[key] = ResourceState(key, endpoint, {"id": None}, "unchanged")
                self.events.append({"key": key, "action": "unchanged"})
                return
            if found.get("pending_deletion"):
                self.summary["unchanged"] += 1
                self.registry[key] = ResourceState(key, endpoint, found, "pending_deletion")
                self.events.append({"key": key, "action": "pending_deletion"})
                return
            self.summary["deleted"] += 1
            if not self.check_mode:
                self.client.request("DELETE", self._detail_path(endpoint, found))
            self.registry[key] = ResourceState(key, endpoint, found, "deleted")
            self.events.append({"key": key, "action": "deleted"})
            return

        if found is not None and found.get("pending_deletion"):
            raise ConfigurationError(f"{key}: matching resource is pending deletion; wait for cleanup before recreating it")

        if found is None:
            self.summary["created"] += 1
            if self.check_mode:
                synthetic = copy.deepcopy(data)
                synthetic.setdefault("id", -(len(self.registry) + 1))
                found = synthetic
            else:
                found = self.client.request("POST", endpoint, data)
            action = "created"
        else:
            secret_update = spec.get("secret_update", "preserve")
            if secret_update not in {"preserve", "always"}:
                raise ConfigurationError(f"{key}: secret_update must be preserve or always")
            needs_update = self._different(found, data)
            if secret_update == "always" and data:
                needs_update = True
            if needs_update:
                self.summary["updated"] += 1
                if not self.check_mode:
                    found = self.client.request("PATCH", self._detail_path(endpoint, found), data)
                else:
                    found = {**found, **copy.deepcopy(data)}
                action = "updated"
            else:
                self.summary["unchanged"] += 1
                action = "unchanged"

        self.registry[key] = ResourceState(key, endpoint, found, action)
        self.events.append({"key": key, "action": action})
        self._reconcile_associations(spec, self.registry[key])
        self._run_actions(spec, self.registry[key])

    def _reconcile_associations(self, spec: dict[str, Any], resource: ResourceState) -> None:
        associations = spec.get("associations", [])
        if not isinstance(associations, list):
            raise ConfigurationError(f"{resource.key}: associations must be a list")
        for association in associations:
            if not isinstance(association, dict) or not association.get("name"):
                raise ConfigurationError(f"{resource.key}: every association requires a name")
            relation = association["name"].strip("/")
            desired_ids = set(self._resolve(association.get("items", [])))
            if not all(isinstance(item, int) for item in desired_ids):
                raise ConfigurationError(f"{resource.key}.{relation}: association items must resolve to integer ids")
            related_path = f"{self._detail_path(resource.endpoint, resource.object)}{relation}/"
            current_ids: set[int] = set()
            if resource.object.get("id", 0) > 0:
                current_ids = {item["id"] for item in self.client.list(related_path) if item.get("id") is not None}
            additions = desired_ids - current_ids
            removals = current_ids - desired_ids if association.get("exact", False) else set()
            self.summary["associated"] += len(additions)
            self.summary["disassociated"] += len(removals)
            if not self.check_mode:
                for object_id in sorted(additions):
                    self.client.request("POST", related_path, {"associate": True, "id": object_id})
                for object_id in sorted(removals):
                    self.client.request("POST", related_path, {"disassociate": True, "id": object_id})

    def _run_actions(self, spec: dict[str, Any], resource: ResourceState) -> None:
        actions = spec.get("actions", [])
        if not isinstance(actions, list):
            raise ConfigurationError(f"{resource.key}: actions must be a list")
        for action in actions:
            if not isinstance(action, dict) or not action.get("path"):
                raise ConfigurationError(f"{resource.key}: every action requires a path")
            when = action.get("when", "changed")
            should_run = when == "always" or when == resource.action or (when == "changed" and resource.action in {"created", "updated"})
            if not should_run:
                continue
            self.summary["actions"] += 1
            if self.check_mode:
                continue
            action_path = action["path"]
            if action_path.startswith("/"):
                path = action_path
            else:
                path = f"{self._detail_path(resource.endpoint, resource.object)}{action_path.strip('/')}/"
            self.client.request(action.get("method", "POST"), path, self._resolve(action.get("data", {})))

    def reconcile(self, manifest: dict[str, Any]) -> dict[str, Any]:
        self._reconcile_settings(manifest.get("settings", {}))
        for resource in manifest.get("resources", []):
            self._reconcile_resource(resource)
        return {**self.summary, "resources": self.events}


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifests", nargs="+", type=Path, help="Ordered YAML or JSON manifest files")
    parser.add_argument("--controller", default=os.getenv("CAPSTAN_CONTROLLER_URL", ""))
    parser.add_argument("--username", default=os.getenv("CAPSTAN_CONTROLLER_USERNAME", ""))
    parser.add_argument("--password", default=os.getenv("CAPSTAN_CONTROLLER_PASSWORD", ""))
    parser.add_argument("--token", default=os.getenv("CAPSTAN_CONTROLLER_TOKEN", ""))
    parser.add_argument("--timeout", type=int, default=int(os.getenv("CAPSTAN_CONTROLLER_TIMEOUT", "30")))
    parser.add_argument("--check", action="store_true", help="Report changes without writing them")
    parser.add_argument("--insecure", action="store_true", default=os.getenv("CAPSTAN_CONTROLLER_VERIFY_SSL", "true").lower() in {"0", "false", "no"})
    args = parser.parse_args(argv)
    if not args.controller:
        parser.error("--controller or CAPSTAN_CONTROLLER_URL is required")
    if not args.token and not args.username:
        parser.error("CAPSTAN_CONTROLLER_TOKEN or CAPSTAN_CONTROLLER_USERNAME is required")
    return args


def main(argv: list[str] | None = None) -> int:
    try:
        args = _parse_args(argv or sys.argv[1:])
        manifest = load_manifests(args.manifests)
        client = ControllerClient(
            args.controller,
            username=args.username,
            password=args.password,
            token=args.token,
            verify_ssl=not args.insecure,
            timeout=args.timeout,
        )
        summary = ConfigurationReconciler(client, check_mode=args.check).reconcile(manifest)
        result = {
            "changed": any(summary[key] for key in ("created", "updated", "deleted", "associated", "disassociated", "actions")),
            "check_mode": args.check,
            **summary,
        }
        print(json.dumps(result, sort_keys=True))
        return 0
    except (ConfigurationError, OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"failed": True, "message": _redact_sensitive(str(exc))}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
