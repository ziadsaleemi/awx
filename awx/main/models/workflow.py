# Copyright (c) 2016 Ansible, Inc.
# All Rights Reserved.

# Python
import json
import logging
import re
from types import SimpleNamespace
from uuid import uuid4
from copy import copy
from urllib.parse import urljoin

# Django
from django.db import connection, models
from django.conf import settings
from django.utils.translation import gettext_lazy as _
from django.core.exceptions import ObjectDoesNotExist
from django.utils.timezone import now, timedelta

# from django import settings as tower_settings

# Django-CRUM
from crum import get_current_user

from jinja2 import sandbox
from jinja2.exceptions import TemplateSyntaxError, UndefinedError, SecurityError

from ansible_base.lib.utils.models import prevent_search

# AWX
from awx.api.versioning import reverse
from awx.main.models import accepts_json, UnifiedJobTemplate, UnifiedJob
from awx.main.models.notifications import NotificationTemplate, JobNotificationMixin
from awx.main.models.base import CreatedModifiedModel, VarsDictProperty
from awx.main.models.rbac import ROLE_SINGLETON_SYSTEM_ADMINISTRATOR, ROLE_SINGLETON_SYSTEM_AUDITOR
from awx.main.fields import ImplicitRoleField, JSONBlob, OrderedManyToManyField
from awx.main.models.mixins import (
    ResourceMixin,
    SurveyJobTemplateMixin,
    SurveyJobMixin,
    RelatedJobsMixin,
    WebhookMixin,
    WebhookTemplateMixin,
)
from awx.main.models.jobs import LaunchTimeConfigBase, LaunchTimeConfig, JobTemplate
from awx.main.models.credential import Credential
from awx.main.redact import REPLACE_STR
from awx.main.utils import ScheduleWorkflowManager, NullablePromptPseudoField
from awx.main.utils.eda import EDAControllerClient, EDAControllerError, workflow_status_from_activation_status

__all__ = [
    'WorkflowJobTemplate',
    'WorkflowJob',
    'WorkflowJobOptions',
    'WorkflowJobNode',
    'WorkflowJobTemplateNode',
    'WorkflowApprovalTemplate',
    'WorkflowApproval',
]


logger = logging.getLogger('awx.main.models.workflow')

WORKFLOW_BASE_URL = "{}/jobs/workflow/{}"
_HOST_IP_ARTIFACT_KEY_RE = re.compile(r'^host_ip', re.IGNORECASE)
WORKFLOW_NODE_TYPE_TEMPLATE = 'template'
WORKFLOW_NODE_TYPE_EDA_RULEBOOK = 'eda_rulebook'
WORKFLOW_NODE_TYPE_AI_TASK = 'ai_task'
WORKFLOW_NODE_TYPES = (
    (WORKFLOW_NODE_TYPE_TEMPLATE, _('Template')),
    (WORKFLOW_NODE_TYPE_EDA_RULEBOOK, _('EDA rulebook activation')),
    (WORKFLOW_NODE_TYPE_AI_TASK, _('AI task')),
)


class AIWorkflowTaskError(Exception):
    pass


class AIWorkflowTaskRequest(SimpleNamespace):
    path_info = '/api/v2/workflow_job_nodes/'
    path = '/api/v2/workflow_job_nodes/'
    method = 'POST'
    GET = {}
    query_params = {}

    def get_full_path(self):
        return self.path_info

    def build_absolute_uri(self, location=None):
        return location or self.path_info


def _extract_ai_plan(value):
    source = str(value or '').strip()
    if not source:
        return None
    start = source.find('{')
    end = source.rfind('}')
    if start == -1 or end <= start:
        return None
    try:
        parsed = json.loads(source[start : end + 1])
    except (TypeError, ValueError):
        return None
    return parsed if isinstance(parsed, (dict, list)) else None


def run_ai_workflow_task(prompt, parent_artifacts=None, model_name=''):
    if not getattr(settings, 'AI_ENABLED', False):
        raise AIWorkflowTaskError(_('The AI assistant is not enabled. Enable it in Settings → AI Assistant.'))

    from awx.api.views.ai import _PROVIDER_DEFAULTS, _call_ai_provider, _openai_codex_effective_default_model, AIProviderError

    provider = getattr(settings, 'AI_PROVIDER', 'openai')
    api_key = getattr(settings, 'AI_API_KEY', '')
    if provider != 'openai_codex' and not api_key:
        raise AIWorkflowTaskError(_('AI_API_KEY is not configured. Set it in Settings → AI Assistant.'))

    defaults = _PROVIDER_DEFAULTS.get(provider, _PROVIDER_DEFAULTS['openai'])
    model = model_name or (
        _openai_codex_effective_default_model() if provider == 'openai_codex' else getattr(settings, 'AI_MODEL_NAME', '') or defaults['model']
    )
    artifacts_json = json.dumps(parent_artifacts or {}, default=str, sort_keys=True)[:12000]
    system_prompt = (
        'You are an AWX runtime workflow planner. Generate an execution plan for the requested automation. '
        'Do not mutate AWX resources or claim that actions were executed. Return concise JSON when possible. '
        'When the task should create or update AWX resources, return a resource-action plan shaped as '
        '{"name": "...", "operations": [{"id": "op-1", "operation": "create|update", '
        '"resource_type": "inventory|smart_inventory|constructed_inventory|project|job_template|workflow_job_template|schedule|catalog_item", '
        '"object_id": 123, "data": {}}]}. AWX will validate and require approval before applying by default.'
    )
    messages = [
        {
            'role': 'user',
            'content': '\n\n'.join(
                [
                    f'Runtime AI task:\n{prompt}',
                    f'Parent workflow artifacts JSON:\n{artifacts_json or "{}"}',
                ]
            ),
        }
    ]
    try:
        response = _call_ai_provider(
            provider, model, messages, getattr(settings, 'AI_MAX_TOKENS', 2048), system_prompt, api_key, getattr(settings, 'AI_API_URL', '')
        )
    except AIProviderError as exc:
        raise AIWorkflowTaskError(str(exc.detail)) from exc

    return {
        'provider': provider,
        'model': model,
        'response': response,
        'plan': _extract_ai_plan(response),
    }


def _ai_resource_action_plan(value):
    if not isinstance(value, dict) or not isinstance(value.get('operations'), list):
        return None
    from awx.api.views.ai import _normalize_ai_plan

    try:
        return _normalize_ai_plan(value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None


def _ai_resource_action_request(user):
    if not user:
        raise AIWorkflowTaskError(_('AI resource action plans require a workflow launch user.'))
    return AIWorkflowTaskRequest(user=user)


class WorkflowNodeBase(CreatedModifiedModel, LaunchTimeConfig):
    class Meta:
        abstract = True
        app_label = 'main'

    success_nodes = models.ManyToManyField(
        'self',
        blank=True,
        symmetrical=False,
        related_name='%(class)ss_success',
    )
    failure_nodes = models.ManyToManyField(
        'self',
        blank=True,
        symmetrical=False,
        related_name='%(class)ss_failure',
    )
    always_nodes = models.ManyToManyField(
        'self',
        blank=True,
        symmetrical=False,
        related_name='%(class)ss_always',
    )
    all_parents_must_converge = models.BooleanField(
        default=False, help_text=_("If enabled then the node will only run if all of the parent nodes have met the criteria to reach this node")
    )
    unified_job_template = models.ForeignKey(
        'UnifiedJobTemplate',
        related_name='%(class)ss',
        blank=True,
        null=True,
        default=None,
        on_delete=models.SET_NULL,
    )
    node_type = models.CharField(max_length=32, choices=WORKFLOW_NODE_TYPES, default=WORKFLOW_NODE_TYPE_TEMPLATE)
    eda_rulebook_name = models.CharField(max_length=512, blank=True, default='')
    eda_activation_id = models.CharField(max_length=128, blank=True, default='')
    eda_event_source = models.CharField(max_length=512, blank=True, default='')
    eda_event_source_status = models.CharField(max_length=64, blank=True, default='')
    ai_task_prompt = models.TextField(blank=True, default='')
    ai_task_model = models.CharField(max_length=128, blank=True, default='')
    ai_task_approval_required = models.BooleanField(default=True)
    ai_task_status = models.CharField(max_length=64, blank=True, default='')
    ai_task_result = JSONBlob(default=dict, blank=True)

    @property
    def is_eda_rulebook_node(self):
        return self.node_type == WORKFLOW_NODE_TYPE_EDA_RULEBOOK

    @property
    def is_ai_task_node(self):
        return self.node_type == WORKFLOW_NODE_TYPE_AI_TASK

    def get_parent_nodes(self):
        '''Returns queryset containing all parents of this node'''
        success_parents = getattr(self, '%ss_success' % self.__class__.__name__.lower()).all()
        failure_parents = getattr(self, '%ss_failure' % self.__class__.__name__.lower()).all()
        always_parents = getattr(self, '%ss_always' % self.__class__.__name__.lower()).all()
        return (success_parents | failure_parents | always_parents).order_by('id')

    @classmethod
    def _get_workflow_job_field_names(cls):
        """
        Return field names that should be copied from template node to job node.
        """
        return [
            'workflow_job',
            'unified_job_template',
            'node_type',
            'eda_rulebook_name',
            'eda_activation_id',
            'eda_event_source',
            'eda_event_source_status',
            'ai_task_prompt',
            'ai_task_model',
            'ai_task_approval_required',
            'ai_task_status',
            'ai_task_result',
            'extra_data',
            'survey_passwords',
            'inventory',
            'credentials',
            'char_prompts',
            'all_parents_must_converge',
            'labels',
            'instance_groups',
            'execution_environment',
        ]

    def create_workflow_job_node(self, **kwargs):
        """
        Create a new workflow job node based on this workflow node.
        """
        create_kwargs = {}
        for field_name in self._get_workflow_job_field_names():
            if field_name in ['credentials', 'labels', 'instance_groups']:
                continue
            if field_name in kwargs:
                create_kwargs[field_name] = kwargs[field_name]
            elif hasattr(self, field_name):
                create_kwargs[field_name] = getattr(self, field_name)
        create_kwargs['identifier'] = self.identifier
        new_node = WorkflowJobNode.objects.create(**create_kwargs)
        if self.pk:
            allowed_creds = self.credentials.all()
            allowed_labels = self.labels.all()
            allowed_instance_groups = self.instance_groups.all()
        else:
            allowed_creds = []
            allowed_labels = []
            allowed_instance_groups = []
        for cred in allowed_creds:
            new_node.credentials.add(cred)

        for label in allowed_labels:
            new_node.labels.add(label)
        for instance_group in allowed_instance_groups:
            new_node.instance_groups.add(instance_group)

        return new_node


class WorkflowJobTemplateNode(WorkflowNodeBase):
    FIELDS_TO_PRESERVE_AT_COPY = [
        'unified_job_template',
        'node_type',
        'eda_rulebook_name',
        'eda_activation_id',
        'eda_event_source',
        'eda_event_source_status',
        'ai_task_prompt',
        'ai_task_model',
        'ai_task_approval_required',
        'ai_task_status',
        'ai_task_result',
        'workflow_job_template',
        'success_nodes',
        'failure_nodes',
        'always_nodes',
        'credentials',
        'inventory',
        'extra_data',
        'survey_passwords',
        'char_prompts',
        'all_parents_must_converge',
        'identifier',
        'labels',
        'execution_environment',
        'instance_groups',
    ]
    REENCRYPTION_BLOCKLIST_AT_COPY = ['extra_data', 'survey_passwords']

    workflow_job_template = models.ForeignKey(
        'WorkflowJobTemplate',
        related_name='workflow_job_template_nodes',
        on_delete=models.CASCADE,
    )
    identifier = models.CharField(
        max_length=512,
        default=uuid4,
        blank=False,
        help_text=_('An identifier for this node that is unique within its workflow. It is copied to workflow job nodes corresponding to this node.'),
    )
    instance_groups = OrderedManyToManyField(
        'InstanceGroup',
        related_name='workflow_job_template_node_instance_groups',
        blank=True,
        editable=False,
        through='WorkflowJobTemplateNodeBaseInstanceGroupMembership',
    )

    class Meta:
        app_label = 'main'
        unique_together = (("identifier", "workflow_job_template"),)
        indexes = [
            models.Index(fields=['identifier']),
        ]
        ordering = ('pk',)

    def get_absolute_url(self, request=None):
        return reverse('api:workflow_job_template_node_detail', kwargs={'pk': self.pk}, request=request)

    def create_wfjt_node_copy(self, user, workflow_job_template=None):
        """
        Copy this node to a new WFJT, leaving out related fields the user
        is not allowed to access
        """
        create_kwargs = {}
        allowed_creds = []
        for field_name in self._get_workflow_job_field_names():
            if field_name == 'credentials':
                for cred in self.credentials.all():
                    if user.can_access(Credential, 'use', cred):
                        allowed_creds.append(cred)
                continue
            item = getattr(self, field_name, None)
            if item is None:
                continue
            if field_name == 'inventory':
                if not user.can_access(item.__class__, 'use', item):
                    continue
            if field_name in ['unified_job_template']:
                if not user.can_access(item.__class__, 'start', item, validate_license=False):
                    continue
            create_kwargs[field_name] = item
        create_kwargs['workflow_job_template'] = workflow_job_template
        new_node = self.__class__.objects.create(**create_kwargs)
        for cred in allowed_creds:
            new_node.credentials.add(cred)
        return new_node

    def create_approval_template(self, **kwargs):
        approval_template = WorkflowApprovalTemplate(**kwargs)
        approval_template.save()
        self.unified_job_template = approval_template
        self.save(update_fields=['unified_job_template'])
        return approval_template


class WorkflowJobNode(WorkflowNodeBase):
    job = models.OneToOneField(
        'UnifiedJob',
        related_name='unified_job_node',
        blank=True,
        null=True,
        default=None,
        on_delete=models.SET_NULL,
    )
    workflow_job = models.ForeignKey(
        'WorkflowJob',
        related_name='workflow_job_nodes',
        blank=True,
        null=True,
        default=None,
        on_delete=models.CASCADE,
    )
    ancestor_artifacts = JSONBlob(
        default=dict,
        blank=True,
        editable=False,
    )
    do_not_run = models.BooleanField(
        default=False,
        help_text=_(
            "Indicates that a job will not be created when True. Workflow runtime "
            "semantics will mark this True if the node is in a path that will "
            "decidedly not be ran. A value of False means the node may not run."
        ),
    )
    bypassed_job_status = models.CharField(
        max_length=20,
        blank=True,
        default='',
        help_text=_(
            "If set, this node was carried over from a prior workflow run with this status. "
            "It will not be re-run but will be treated as having finished with this status "
            "for graph traversal purposes. Used by the resume-from-failure feature."
        ),
    )
    identifier = models.CharField(
        max_length=512,
        blank=True,  # blank denotes pre-migration job nodes
        help_text=_('An identifier coresponding to the workflow job template node that this node was created from.'),
    )
    instance_groups = OrderedManyToManyField(
        'InstanceGroup', related_name='workflow_job_node_instance_groups', blank=True, editable=False, through='WorkflowJobNodeBaseInstanceGroupMembership'
    )

    class Meta:
        app_label = 'main'
        indexes = [
            models.Index(fields=["identifier", "workflow_job"]),
            models.Index(fields=['identifier']),
        ]
        ordering = ('pk',)

    # Compatibility descriptors for TerraformJobTemplate-specific prompt fields.
    # WorkflowJobNode stores inventory in the standard 'inventory' FK from
    # LaunchTimeConfig; TerraformJobTemplate names the same concept
    # 'target_inventory', so provide an alias to avoid AttributeError in
    # prompts_dict(for_cls=TerraformJobTemplate).
    @property
    def target_inventory(self):
        return self.inventory

    @target_inventory.setter
    def target_inventory(self, value):
        self.inventory = value

    # terraform_operation is a char_prompts-backed pseudo-field specific to
    # TerraformJobTemplate; store it transparently so prompts_dict works.
    terraform_operation = NullablePromptPseudoField('terraform_operation')

    @property
    def event_processing_finished(self):
        return True

    def _build_parent_artifacts(self):
        artifacts = {k: v for k, v in self.ancestor_artifacts.items() if k != 'job_slice'} if self.ancestor_artifacts else {}
        for parent_node in self.get_parent_nodes():
            artifacts.update(parent_node.ancestor_artifacts)
            if parent_node.job:
                artifacts.update(parent_node.job.get_effective_artifacts(parents_set=set([self.workflow_job_id])))
        return artifacts

    def sync_eda_rulebook_activation(self):
        artifacts = self._build_parent_artifacts()
        activation = None
        controller_status = 'not_configured'
        controller_error = ''
        activation_status = self.eda_event_source_status or 'planned'
        source = 'virtual'

        client = EDAControllerClient()
        if client.is_configured:
            source = 'eda_controller'
            try:
                result = client.ensure_activation_started(
                    self.eda_rulebook_name,
                    activation_id=self.eda_activation_id,
                    event_source=self.eda_event_source,
                )
                activation = result['activation']
                if activation:
                    controller_status = 'ok'
                    if activation.get('id'):
                        self.eda_activation_id = activation['id']
                    activation_status = activation.get('status') or activation_status
                else:
                    controller_status = 'not_found'
                    activation_status = 'not_found'
            except EDAControllerError as exc:
                controller_status = exc.status
                controller_error = str(exc)
                activation_status = exc.status

        workflow_status = workflow_status_from_activation_status(activation_status)
        artifacts['awx_eda'] = {
            'rulebook_name': self.eda_rulebook_name,
            'activation_id': self.eda_activation_id,
            'event_source': self.eda_event_source,
            'event_source_status': activation_status,
            'controller_status': controller_status,
            'controller_error': controller_error,
            'source': source,
        }
        if activation:
            artifacts['awx_eda']['activation'] = activation
            artifacts['awx_eda']['actions'] = result.get('actions', [])
            artifacts['awx_eda']['events'] = result.get('events', [])
        self.ancestor_artifacts = artifacts
        self.eda_event_source_status = activation_status
        self.bypassed_job_status = workflow_status
        self.save(update_fields=['ancestor_artifacts', 'eda_activation_id', 'eda_event_source_status', 'bypassed_job_status'])
        return self

    def mark_eda_rulebook_successful(self):
        return self.sync_eda_rulebook_activation()

    def sync_ai_task(self):
        if self.ai_task_status == 'awaiting_approval':
            return self

        artifacts = self._build_parent_artifacts()
        ai_status = 'planned'
        workflow_status = 'failed'
        error = ''
        resource_action = None
        result = {
            'provider': '',
            'model': self.ai_task_model,
            'response': '',
            'plan': None,
        }

        try:
            if not self.ai_task_prompt:
                raise AIWorkflowTaskError(_('AI task prompt is required.'))
            result = run_ai_workflow_task(self.ai_task_prompt, copy(artifacts), self.ai_task_model)
            ai_status = 'successful'
            workflow_status = 'successful'
            resource_action_plan = _ai_resource_action_plan(result.get('plan'))
            if resource_action_plan:
                resource_action = self.preview_ai_resource_action_plan(resource_action_plan, result)
                if not resource_action['can_apply']:
                    ai_status = 'failed'
                    workflow_status = 'failed'
                    error = _('AI resource action plan failed validation.')
                elif self.ai_task_approval_required:
                    ai_status = 'awaiting_approval'
                    workflow_status = ''
                else:
                    resource_action = self.apply_ai_resource_action_plan(resource_action_plan, result, user=self.workflow_job.created_by)
                    ai_status = 'applied' if resource_action['can_apply'] else 'failed'
                    workflow_status = 'successful' if resource_action['can_apply'] else 'failed'
                    error = '' if resource_action['can_apply'] else _('AI resource action plan failed to apply.')
        except AIWorkflowTaskError as exc:
            ai_status = 'failed'
            workflow_status = 'failed'
            error = str(exc)

        self.ai_task_status = ai_status
        self.ai_task_result = {
            'status': ai_status,
            'provider': result.get('provider', ''),
            'model': result.get('model') or self.ai_task_model,
            'response': result.get('response', ''),
            'plan': result.get('plan'),
            'error': error,
            'approval_required': self.ai_task_approval_required,
        }
        if resource_action:
            self.ai_task_result['resource_action'] = resource_action
        artifacts['awx_ai'] = {
            'prompt': self.ai_task_prompt,
            'status': ai_status,
            'provider': self.ai_task_result['provider'],
            'model': self.ai_task_result['model'],
            'response': self.ai_task_result['response'],
            'plan': self.ai_task_result['plan'],
            'error': error,
            'approval_required': self.ai_task_approval_required,
            'resource_action': resource_action,
            'source': 'ai_provider',
        }
        self.ancestor_artifacts = artifacts
        self.bypassed_job_status = workflow_status
        self.save(update_fields=['ancestor_artifacts', 'ai_task_status', 'ai_task_result', 'bypassed_job_status'])
        if ai_status == 'awaiting_approval':
            self.ensure_ai_task_approval()
        return self

    def ensure_ai_task_approval(self):
        if self.job and isinstance(self.job, WorkflowApproval):
            return self.job

        prompt_label = (self.ai_task_prompt or self.identifier or str(self.pk)).splitlines()[0][:80]
        approval = WorkflowApproval.objects.create(
            name=_('AI plan approval: %(name)s') % {'name': prompt_label},
            description=self.ai_task_prompt,
            status='pending',
            started=now(),
            created_by=self.workflow_job.created_by,
            modified_by=self.workflow_job.created_by,
        )
        self.job = approval
        self.save(update_fields=['job'])
        approval.send_approval_notification('running')
        approval.websocket_emit_status(approval.status)
        return approval

    def preview_ai_resource_action_plan(self, plan, provider_result):
        from awx.api.views.ai import (
            _ai_plan_uses_operation_references,
            _audit_ai_resource_action,
            _public_ai_operation_result,
            _redact_sensitive,
            _simulate_ai_operations_for_preview,
            _validate_ai_operations_for_preview,
            _json_safe,
        )

        request = _ai_resource_action_request(self.workflow_job.created_by)
        policy_context = {
            'source': 'workflow_ai_task',
            'approval_required': self.ai_task_approval_required,
            'human_approved': False,
            'approval': {
                'workflow_job_node': self.pk,
                'workflow_job': self.workflow_job_id,
                'workflow_job_template': getattr(self.workflow_job, 'workflow_job_template_id', None),
            },
        }
        operations = (
            _simulate_ai_operations_for_preview(request, plan['operations'], policy_context=policy_context)
            if _ai_plan_uses_operation_references(plan['operations'])
            else _validate_ai_operations_for_preview(request, plan['operations'], policy_context=policy_context)
        )
        public_operations = [_public_ai_operation_result(operation) for operation in operations]
        audit_entry = _audit_ai_resource_action(
            request,
            'preview',
            plan,
            public_operations,
            provider=provider_result.get('provider', ''),
            model=provider_result.get('model', ''),
        )
        return {
            'mode': 'preview',
            'plan': _redact_sensitive(_json_safe(plan)),
            'operations': public_operations,
            'can_apply': all(operation.get('valid') for operation in public_operations),
            'audit': {'activity_stream_id': audit_entry.pk},
        }

    def apply_ai_resource_action_plan(self, plan=None, provider_result=None, user=None, human_approved=False):
        from awx.api.views.ai import (
            _apply_ai_operations_sequentially,
            _audit_ai_resource_action,
            _public_ai_operation_result,
            _redact_sensitive,
            _json_safe,
        )

        plan = _ai_resource_action_plan(plan or self.ai_task_result.get('plan'))
        if not plan:
            raise AIWorkflowTaskError(_('AI task result does not contain an applicable resource action plan.'))
        request = _ai_resource_action_request(user)
        policy_context = {
            'source': 'workflow_ai_task',
            'approval_required': self.ai_task_approval_required,
            'human_approved': human_approved,
            'approval': {
                'workflow_job_node': self.pk,
                'workflow_job': self.workflow_job_id,
                'workflow_job_template': getattr(self.workflow_job, 'workflow_job_template_id', None),
                'approved_by': getattr(user, 'pk', None) if human_approved else None,
            },
        }
        operations, can_apply = _apply_ai_operations_sequentially(request, plan['operations'], policy_context=policy_context)
        public_operations = [_public_ai_operation_result(operation) for operation in operations]
        provider_result = provider_result or self.ai_task_result
        audit_entry = _audit_ai_resource_action(
            request,
            'apply',
            plan,
            public_operations,
            provider=provider_result.get('provider', ''),
            model=provider_result.get('model', ''),
        )
        return {
            'mode': 'apply',
            'plan': _redact_sensitive(_json_safe(plan)),
            'operations': public_operations,
            'can_apply': can_apply,
            'audit': {'activity_stream_id': audit_entry.pk},
        }

    def approve_ai_resource_action_plan(self, user):
        resource_action = self.apply_ai_resource_action_plan(user=user, human_approved=True)
        ai_status = 'applied' if resource_action['can_apply'] else 'failed'
        workflow_status = 'successful' if resource_action['can_apply'] else 'failed'
        error = '' if resource_action['can_apply'] else _('AI resource action plan failed to apply.')
        result = copy(self.ai_task_result or {})
        result.update(
            {
                'status': ai_status,
                'error': error,
                'resource_action': resource_action,
            }
        )
        artifacts = copy(self.ancestor_artifacts or {})
        awx_ai = copy(artifacts.get('awx_ai') or {})
        awx_ai.update(
            {
                'status': ai_status,
                'error': error,
                'resource_action': resource_action,
            }
        )
        artifacts['awx_ai'] = awx_ai
        self.ai_task_status = ai_status
        self.ai_task_result = result
        self.ancestor_artifacts = artifacts
        self.bypassed_job_status = workflow_status
        self.save(update_fields=['ancestor_artifacts', 'ai_task_status', 'ai_task_result', 'bypassed_job_status'])
        ScheduleWorkflowManager().schedule()
        return resource_action

    def deny_ai_resource_action_plan(self, user=None):
        error = str(_('AI resource action plan was denied.'))
        result = copy(self.ai_task_result or {})
        approval = copy(result.get('approval') or {})
        approval.update({'denied_by': getattr(user, 'pk', None)})
        result.update(
            {
                'status': 'failed',
                'error': error,
                'approval': approval,
            }
        )
        artifacts = copy(self.ancestor_artifacts or {})
        awx_ai = copy(artifacts.get('awx_ai') or {})
        awx_ai.update(
            {
                'status': 'failed',
                'error': error,
                'approval': approval,
            }
        )
        artifacts['awx_ai'] = awx_ai
        self.ai_task_status = 'failed'
        self.ai_task_result = result
        self.ancestor_artifacts = artifacts
        self.bypassed_job_status = 'failed'
        self.save(update_fields=['ancestor_artifacts', 'ai_task_status', 'ai_task_result', 'bypassed_job_status'])
        ScheduleWorkflowManager().schedule()

    def get_absolute_url(self, request=None):
        return reverse('api:workflow_job_node_detail', kwargs={'pk': self.pk}, request=request)

    def get_job_kwargs(self):
        """
        In advance of creating a new unified job as part of a workflow,
        this method builds the attributes to use
        It alters the node by saving its updated version of
        ancestor_artifacts, making it available to subsequent nodes.
        """
        # reject/accept prompted fields
        data = {}
        wj_special_vars = {}
        wj_special_passwords = {}
        ujt_obj = self.unified_job_template
        if ujt_obj is not None:
            node_prompts_data = self.prompts_dict(for_cls=ujt_obj.__class__)
            wj_prompts_data = self.workflow_job.prompts_dict(for_cls=ujt_obj.__class__)
            # Explanation - special historical case
            # WFJT extra_vars ignored JobTemplate.ask_variables_on_launch, bypassing _accept_or_ignore_job_kwargs
            # inventory and others are only accepted if JT prompts for it with related ask_ field
            # this is inconsistent, but maintained
            if not isinstance(ujt_obj, WorkflowJobTemplate):
                wj_special_vars = wj_prompts_data.pop('extra_vars', {})
                wj_special_passwords = wj_prompts_data.pop('survey_passwords', {})
            elif 'extra_vars' in node_prompts_data:
                # Follow the vars combination rules
                node_prompts_data['extra_vars'].update(wj_prompts_data.pop('extra_vars', {}))
            elif 'survey_passwords' in node_prompts_data:
                node_prompts_data['survey_passwords'].update(wj_prompts_data.pop('survey_passwords', {}))

            # Follow the credential combination rules
            if ('credentials' in wj_prompts_data) and ('credentials' in node_prompts_data):
                wj_pivoted_creds = Credential.unique_dict(wj_prompts_data['credentials'])
                node_pivoted_creds = Credential.unique_dict(node_prompts_data['credentials'])
                node_pivoted_creds.update(wj_pivoted_creds)
                wj_prompts_data['credentials'] = [cred for cred in node_pivoted_creds.values()]

            # NOTE: no special rules for instance_groups, because they do not merge
            # or labels, because they do not propogate WFJT-->node at all

            # Combine WFJT prompts with node here, WFJT at higher level
            node_prompts_data.update(wj_prompts_data)
            accepted_fields, ignored_fields, errors = ujt_obj._accept_or_ignore_job_kwargs(**node_prompts_data)
            if errors:
                logger.info(
                    _('Bad launch configuration starting template {template_pk} as part of workflow {workflow_pk}. Errors:\n{error_text}').format(
                        template_pk=ujt_obj.pk, workflow_pk=self.pk, error_text=errors
                    )
                )
            data.update(accepted_fields)  # missing fields are handled in the scheduler
        # build ancestor artifacts, save them to node model for later
        # initialize from pre-seeded ancestor_artifacts (set on root nodes of
        # child workflows via seed_root_ancestor_artifacts to carry artifacts
        # from the parent workflow); exclude job_slice which is internal
        # metadata handled separately below
        aa_dict = self._build_parent_artifacts()
        is_root_node = True
        for parent_node in self.get_parent_nodes():
            is_root_node = False
        if aa_dict and not is_root_node:
            self.ancestor_artifacts = aa_dict
            self.save(update_fields=['ancestor_artifacts'])
        # process password list
        password_dict = data.get('survey_passwords', {})
        if '_ansible_no_log' in aa_dict:
            for key in aa_dict:
                if key != '_ansible_no_log':
                    password_dict[key] = REPLACE_STR
        password_dict.update(wj_special_passwords)
        if password_dict:
            data['survey_passwords'] = password_dict
        # process extra_vars
        extra_vars = data.get('extra_vars', {})
        override_limit_raw = wj_special_vars.pop('terraform_override_limit', True)
        if isinstance(override_limit_raw, str):
            override_limit = override_limit_raw.strip().lower() not in ('0', 'false', 'no', 'off', '')
        else:
            override_limit = bool(override_limit_raw)
        if ujt_obj and isinstance(ujt_obj, JobTemplate):
            if aa_dict:
                functional_aa_dict = copy(aa_dict)
                functional_aa_dict.pop('_ansible_no_log', None)
                extra_vars.update(functional_aa_dict)

                if override_limit:
                    host_limits = []
                    for key, value in functional_aa_dict.items():
                        if not _HOST_IP_ARTIFACT_KEY_RE.search(key):
                            continue
                        if isinstance(value, list):
                            host_limits.extend(str(item).strip() for item in value if item)
                        elif value:
                            host_limits.append(str(value).strip())
                    host_limits = sorted(set(h for h in host_limits if h))
                    if host_limits:
                        data['limit'] = ','.join(host_limits)
        elif ujt_obj and isinstance(ujt_obj, WorkflowJobTemplate):
            pass  # artifacts are applied via seed_root_ancestor_artifacts in the task manager
        else:
            # Generic fallback for other UnifiedJobTemplate subclasses that
            # accept extra_vars (e.g. TerraformJobTemplate).  Propagate
            # ancestor artifacts as extra_vars the same way JobTemplate does.
            from awx.main.models.terraform import TerraformJobTemplate  # local import avoids circular dependency

            if ujt_obj and isinstance(ujt_obj, TerraformJobTemplate):
                if aa_dict:
                    functional_aa_dict = copy(aa_dict)
                    functional_aa_dict.pop('_ansible_no_log', None)
                    extra_vars.update(functional_aa_dict)

        # Workflow Job extra_vars higher precedence than ancestor artifacts
        extra_vars.update(wj_special_vars)
        if extra_vars:
            data['extra_vars'] = extra_vars

        # ensure that unified jobs created by WorkflowJobs are marked
        data['_eager_fields'] = {'launch_type': 'workflow'}
        if self.workflow_job and self.workflow_job.created_by:
            data['_eager_fields']['created_by'] = self.workflow_job.created_by
        # Extra processing in the case that this is a slice job
        if 'job_slice' in self.ancestor_artifacts and is_root_node:
            data['_eager_fields']['allow_simultaneous'] = True
            data['_eager_fields']['job_slice_number'] = self.ancestor_artifacts['job_slice']
            data['_eager_fields']['job_slice_count'] = self.workflow_job.workflow_job_nodes.count()
            data['_prevent_slicing'] = True
        return data


class WorkflowJobOptions(LaunchTimeConfigBase):
    class Meta:
        abstract = True

    extra_vars = accepts_json(
        prevent_search(
            models.TextField(
                blank=True,
                default='',
            )
        )
    )
    # Workflow jobs are used for sliced jobs, and thus, must be a conduit for any JT prompts
    instance_groups = OrderedManyToManyField(
        'InstanceGroup', related_name='workflow_job_instance_groups', blank=True, editable=False, through='WorkflowJobInstanceGroupMembership'
    )
    allow_simultaneous = models.BooleanField(default=False)

    extra_vars_dict = VarsDictProperty('extra_vars', True)

    @property
    def workflow_nodes(self):
        raise NotImplementedError()

    @classmethod
    def _get_unified_job_field_names(cls):
        r = set(f.name for f in WorkflowJobOptions._meta.fields) | set(
            ['name', 'description', 'organization', 'survey_passwords', 'labels', 'limit', 'scm_branch', 'job_tags', 'skip_tags']
        )
        r.remove('char_prompts')  # needed due to copying launch config to launch config
        return r

    def _create_workflow_nodes(self, old_node_list, user=None):
        node_links = {}
        for old_node in old_node_list:
            if user:
                new_node = old_node.create_wfjt_node_copy(user, workflow_job_template=self)
            else:
                new_node = old_node.create_workflow_job_node(workflow_job=self)
            node_links[old_node.pk] = new_node
        return node_links

    def _inherit_node_relationships(self, old_node_list, node_links):
        for old_node in old_node_list:
            new_node = node_links[old_node.pk]
            for relationship in ['always_nodes', 'success_nodes', 'failure_nodes']:
                old_manager = getattr(old_node, relationship)
                for old_child_node in old_manager.all():
                    new_child_node = node_links[old_child_node.pk]
                    new_manager = getattr(new_node, relationship)
                    new_manager.add(new_child_node)

    def copy_nodes_from_original(self, original=None, user=None):
        old_node_list = original.workflow_nodes.prefetch_related('always_nodes', 'success_nodes', 'failure_nodes').all()
        node_links = self._create_workflow_nodes(old_node_list, user=user)
        self._inherit_node_relationships(old_node_list, node_links)

    def create_relaunch_workflow_job(self):
        new_workflow_job = self.copy_unified_job()
        if self.unified_job_template_id is None:
            new_workflow_job.copy_nodes_from_original(original=self)
        return new_workflow_job

    def _create_workflow_nodes_for_resume(self, old_node_list):
        """
        Build a node_links map for a resume run. Nodes whose job already
        succeeded are recreated with ``bypassed_job_status='successful'`` and
        their accumulated artifacts pre-populated so downstream nodes that DO
        re-run still receive the correct artifact chain. Nodes that were
        previously marked do_not_run (skipped by the scheduler) keep that flag.
        All other nodes (failed, canceled, error, or never started) are created
        fresh and will be re-run normally.
        """
        node_links = {}
        for old_node in old_node_list:
            new_node = old_node.create_workflow_job_node(workflow_job=self)
            if (old_node.job and old_node.job.status == 'successful') or old_node.bypassed_job_status == 'successful':
                # Combine ancestor artifacts with this node's own job artifacts
                # so that any downstream node that re-runs will see them via
                # parent_node.ancestor_artifacts in get_job_kwargs().
                # If the node was already bypassed (no real job), carry forward
                # the previously accumulated artifacts unchanged.
                if old_node.job:
                    combined_artifacts = dict(old_node.ancestor_artifacts or {})
                    source_job = old_node.job.get_real_instance()
                    combined_artifacts.update(source_job.get_effective_artifacts(parents_set=set([self.pk])))
                else:
                    combined_artifacts = dict(old_node.ancestor_artifacts or {})
                new_node.bypassed_job_status = 'successful'
                new_node.ancestor_artifacts = combined_artifacts
                new_node.save(update_fields=['bypassed_job_status', 'ancestor_artifacts'])
            elif old_node.do_not_run:
                new_node.do_not_run = True
                new_node.save(update_fields=['do_not_run'])
            # else: node failed / was never run → leave fresh for re-execution
            node_links[old_node.pk] = new_node
        return node_links

    def copy_nodes_from_original_for_resume(self, original=None):
        old_node_list = original.workflow_nodes.prefetch_related('always_nodes', 'success_nodes', 'failure_nodes').select_related('job').all()
        node_links = self._create_workflow_nodes_for_resume(old_node_list)
        self._inherit_node_relationships(old_node_list, node_links)

    def create_resume_workflow_job(self):
        """
        Create a new workflow job that resumes execution from the point of
        failure. Nodes that already succeeded are bypassed (not re-run);
        failed, canceled, or error nodes are restarted from scratch.

        When the original WFJ was created from a WJT, copy_unified_job() will
        call create_unified_job() on the WJT which auto-copies fresh nodes from
        the template.  We must delete those and replace them with resume-aware
        copies taken from the *previous workflow job* (not the template) so the
        bypass/artifact logic is applied correctly.
        """
        new_workflow_job = self.copy_unified_job()
        # Remove any nodes already created (e.g., auto-copied from the WJT).
        new_workflow_job.workflow_job_nodes.all().delete()
        # Re-populate nodes using the resume logic (bypass succeeded nodes).
        new_workflow_job.copy_nodes_from_original_for_resume(original=self)
        return new_workflow_job


class WorkflowJobTemplate(UnifiedJobTemplate, WorkflowJobOptions, SurveyJobTemplateMixin, ResourceMixin, RelatedJobsMixin, WebhookTemplateMixin):
    SOFT_UNIQUE_TOGETHER = [('polymorphic_ctype', 'name', 'organization')]
    FIELDS_TO_PRESERVE_AT_COPY = [
        'labels',
        'organization',
        'instance_groups',
        'workflow_job_template_nodes',
        'credentials',
        'survey_spec',
        'skip_tags',
        'job_tags',
        'execution_environment',
    ]

    class Meta:
        app_label = 'main'
        permissions = [
            ('execute_workflowjobtemplate', 'Can run this workflow job template'),
            ('approve_workflowjobtemplate', 'Can approve steps in this workflow job template'),
        ]

    notification_templates_approvals = models.ManyToManyField(
        "NotificationTemplate",
        blank=True,
        related_name='%(class)s_notification_templates_for_approvals',
    )
    admin_role = ImplicitRoleField(
        parent_role=['singleton:' + ROLE_SINGLETON_SYSTEM_ADMINISTRATOR, 'organization.workflow_admin_role'],
    )
    execute_role = ImplicitRoleField(
        parent_role=[
            'admin_role',
            'organization.execute_role',
        ]
    )
    read_role = ImplicitRoleField(
        parent_role=[
            'singleton:' + ROLE_SINGLETON_SYSTEM_AUDITOR,
            'organization.auditor_role',
            'execute_role',
            'admin_role',
            'approval_role',
        ]
    )
    approval_role = ImplicitRoleField(
        parent_role=[
            'organization.approval_role',
            'admin_role',
        ]
    )

    @property
    def workflow_nodes(self):
        return self.workflow_job_template_nodes

    @classmethod
    def _get_unified_job_class(cls):
        return WorkflowJob

    @classmethod
    def _get_unified_jt_copy_names(cls):
        base_list = super(WorkflowJobTemplate, cls)._get_unified_jt_copy_names()
        base_list.remove('labels')
        return base_list | set(['survey_spec', 'survey_enabled', 'ask_variables_on_launch', 'organization'])

    def get_absolute_url(self, request=None):
        return reverse('api:workflow_job_template_detail', kwargs={'pk': self.pk}, request=request)

    @property
    def cache_timeout_blocked(self):
        if WorkflowJob.objects.filter(workflow_job_template=self, status__in=['pending', 'waiting', 'running']).count() >= getattr(
            settings, 'SCHEDULE_MAX_JOBS', 10
        ):
            logger.error(
                "Workflow Job template %s could not be started because there are more than %s other jobs from that template waiting to run"
                % (self.name, getattr(settings, 'SCHEDULE_MAX_JOBS', 10))
            )
            return True
        return False

    @property
    def notification_templates(self):
        base_notification_templates = NotificationTemplate.objects.all()
        error_notification_templates = list(base_notification_templates.filter(unifiedjobtemplate_notification_templates_for_errors__in=[self]))
        started_notification_templates = list(base_notification_templates.filter(unifiedjobtemplate_notification_templates_for_started__in=[self]))
        success_notification_templates = list(base_notification_templates.filter(unifiedjobtemplate_notification_templates_for_success__in=[self]))
        approval_notification_templates = list(base_notification_templates.filter(workflowjobtemplate_notification_templates_for_approvals__in=[self]))
        # Get Organization NotificationTemplates
        if self.organization is not None:
            error_notification_templates = set(
                error_notification_templates + list(base_notification_templates.filter(organization_notification_templates_for_errors=self.organization))
            )
            started_notification_templates = set(
                started_notification_templates + list(base_notification_templates.filter(organization_notification_templates_for_started=self.organization))
            )
            success_notification_templates = set(
                success_notification_templates + list(base_notification_templates.filter(organization_notification_templates_for_success=self.organization))
            )
            approval_notification_templates = set(
                approval_notification_templates + list(base_notification_templates.filter(organization_notification_templates_for_approvals=self.organization))
            )
        return dict(
            error=list(error_notification_templates),
            started=list(started_notification_templates),
            success=list(success_notification_templates),
            approvals=list(approval_notification_templates),
        )

    def create_unified_job(self, **kwargs):
        workflow_job = super(WorkflowJobTemplate, self).create_unified_job(**kwargs)
        workflow_job.copy_nodes_from_original(original=self)
        return workflow_job

    def _accept_or_ignore_job_kwargs(self, **kwargs):
        exclude_errors = kwargs.pop('_exclude_errors', [])
        prompted_data = {}
        rejected_data = {}
        errors_dict = {}

        # Handle all the fields that have prompting rules
        # NOTE: If WFJTs prompt for other things, this logic can be combined with jobs
        for field_name, ask_field_name in self.get_ask_mapping().items():
            if field_name == 'extra_vars':
                accepted_vars, rejected_vars, vars_errors = self.accept_or_ignore_variables(
                    kwargs.get('extra_vars', {}), _exclude_errors=exclude_errors, extra_passwords=kwargs.get('survey_passwords', {})
                )
                if accepted_vars:
                    prompted_data['extra_vars'] = accepted_vars
                if rejected_vars:
                    rejected_data['extra_vars'] = rejected_vars
                errors_dict.update(vars_errors)
                continue

            if field_name not in kwargs:
                continue
            new_value = kwargs[field_name]
            old_value = getattr(self, field_name)

            if new_value == old_value:
                continue  # no-op case: Counted as neither accepted or ignored
            elif getattr(self, ask_field_name):
                # accepted prompt
                prompted_data[field_name] = new_value
            else:
                # unprompted - template is not configured to accept field on launch
                rejected_data[field_name] = new_value
                # Not considered an error for manual launch, to support old
                # behavior of putting them in ignored_fields and launching anyway
                if 'prompts' not in exclude_errors:
                    errors_dict[field_name] = _('Field is not configured to prompt on launch.').format(field_name=field_name)

        return prompted_data, rejected_data, errors_dict

    def can_start_without_user_input(self):
        return not bool(self.variables_needed_to_start)

    def node_templates_missing(self):
        return [
            node.pk
            for node in self.workflow_job_template_nodes.filter(unified_job_template__isnull=True)
            .exclude(node_type__in=(WORKFLOW_NODE_TYPE_EDA_RULEBOOK, WORKFLOW_NODE_TYPE_AI_TASK))
            .all()
        ]

    def node_prompts_rejected(self):
        node_list = []
        for node in self.workflow_job_template_nodes.prefetch_related('unified_job_template').all():
            ujt_obj = node.unified_job_template
            if ujt_obj is None:
                continue
            prompts_dict = node.prompts_dict()
            accepted_fields, ignored_fields, prompts_errors = ujt_obj._accept_or_ignore_job_kwargs(**prompts_dict)
            if prompts_errors:
                node_list.append(node.pk)
        return node_list

    '''
    RelatedJobsMixin
    '''

    def _get_related_jobs(self):
        return WorkflowJob.objects.filter(workflow_job_template=self)

    def resolve_execution_environment(self):
        return None  # EEs are not meaningful for workflows


class WorkflowJob(UnifiedJob, WorkflowJobOptions, SurveyJobMixin, JobNotificationMixin, WebhookMixin):
    class Meta:
        app_label = 'main'
        ordering = ('id',)

    workflow_job_template = models.ForeignKey(
        'WorkflowJobTemplate',
        related_name='workflow_jobs',
        blank=True,
        null=True,
        default=None,
        on_delete=models.SET_NULL,
    )
    job_template = models.ForeignKey(
        'JobTemplate',
        related_name='slice_workflow_jobs',
        blank=True,
        null=True,
        default=None,
        on_delete=models.SET_NULL,
        help_text=_("If automatically created for a sliced job run, the job template the workflow job was created from."),
    )
    is_sliced_job = models.BooleanField(default=False)
    is_bulk_job = models.BooleanField(default=False)

    # Compatibility descriptors for TerraformJobTemplate-specific prompt fields.
    @property
    def target_inventory(self):
        return self.inventory

    @target_inventory.setter
    def target_inventory(self, value):
        self.inventory = value

    terraform_operation = NullablePromptPseudoField('terraform_operation')

    def _set_default_dependencies_processed(self):
        self.dependencies_processed = True

    @property
    def workflow_nodes(self):
        return self.workflow_job_nodes

    @property
    def event_processing_finished(self):
        return True  # workflow jobs do not have events

    @property
    def has_unpartitioned_events(self):
        return False  # workflow jobs do not have events

    def _get_parent_field_name(self):
        if self.job_template_id:
            # This is a workflow job which is a container for slice jobs
            return 'job_template'
        return 'workflow_job_template'

    @classmethod
    def _get_unified_job_template_class(cls):
        return WorkflowJobTemplate

    def socketio_emit_data(self):
        return {}

    def get_absolute_url(self, request=None):
        return reverse('api:workflow_job_detail', kwargs={'pk': self.pk}, request=request)

    def get_ui_url(self):
        return urljoin(settings.TOWER_URL_BASE, WORKFLOW_BASE_URL.format(settings.OPTIONAL_UI_URL_PREFIX, self.pk))

    def notification_data(self):
        result = super(WorkflowJob, self).notification_data()
        str_arr = ['Workflow job summary:', '']
        for node in self.workflow_job_nodes.all().select_related('job'):
            if node.job is None:
                node_job_description = 'no job.'
            else:
                node_job_description = 'job #{0}, "{1}", which finished with status {2}.'.format(node.job.id, node.job.name, node.job.status)
            str_arr.append("- node #{0} spawns {1}".format(node.id, node_job_description))
        result['body'] = '\n'.join(str_arr)
        result.update(
            dict(
                inventory=self.inventory.name if self.inventory else None,
                limit=self.limit,
                extra_vars=self.display_extra_vars(),
            )
        )
        return result

    def _get_task_impact(self):
        return 0

    def _combined_artifacts(self):
        combined = {}
        for node in self.workflow_job_nodes.all().select_related('job').order_by('id'):
            if not node.job:
                continue
            job_artifacts = node.job.get_effective_artifacts()
            if not isinstance(job_artifacts, dict) or not job_artifacts:
                continue
            combined.update(job_artifacts)
        return combined

    def display_artifacts(self):
        artifacts = self._combined_artifacts()
        if artifacts.get('_ansible_no_log', False):
            return "$hidden due to Ansible no_log flag$"
        return artifacts

    def get_effective_artifacts(self, **kwargs):
        artifacts = self._combined_artifacts()
        if isinstance(artifacts, dict):
            return artifacts
        return {}

    def get_ancestor_workflows(self):
        """Returns a list of WFJTs that are indirect parents of this workflow job
        say WFJTs are set up to spawn in order of A->B->C, and this workflow job
        came from C, then C is the parent and [B, A] will be returned from this.
        """
        ancestors = []
        wj_ids = set([self.pk])
        wj = self.get_workflow_job()
        while wj and wj.workflow_job_template_id:
            if wj.pk in wj_ids:
                logger.critical('Cycles detected in the workflow jobs graph, this is not normal and suggests task manager degeneracy.')
                break
            wj_ids.add(wj.pk)
            ancestors.append(wj.workflow_job_template)
            wj = wj.get_workflow_job()
        return ancestors

    def seed_root_ancestor_artifacts(self, artifacts):
        """Apply parent workflow artifacts to root nodes so they propagate
        through the normal ancestor_artifacts channel instead of being
        baked into this workflow's extra_vars."""
        self.workflow_job_nodes.exclude(
            workflowjobnodes_success__isnull=False,
        ).exclude(
            workflowjobnodes_failure__isnull=False,
        ).exclude(
            workflowjobnodes_always__isnull=False,
        ).update(ancestor_artifacts=artifacts)

    def get_effective_artifacts(self, **kwargs):
        """
        For downstream jobs of a workflow nested inside of a workflow,
        we send aggregated artifacts from the nodes inside of the nested workflow
        """
        artifacts = {}
        job_queryset = (
            UnifiedJob.objects.filter(unified_job_node__workflow_job=self)
            .defer('job_args', 'job_cwd', 'start_args', 'result_traceback')
            .order_by('finished', 'id')
            .filter(status__in=['successful', 'failed'])
            .iterator()
        )
        parents_set = kwargs.get('parents_set', set())
        new_parents_set = parents_set | {self.id}
        for job in job_queryset:
            if job.id in parents_set:
                continue
            artifacts.update(job.get_effective_artifacts(parents_set=new_parents_set))
        return artifacts

    def prompts_dict(self, *args, **kwargs):
        if self.job_template_id:
            # HACK: Exception for sliced jobs here, this is bad
            # when sliced jobs were introduced, workflows did not have all the prompted JT fields
            # so to support prompting with slicing, we abused the workflow job launch config
            # these would be more properly saved on the workflow job, but it gets the wrong fields now
            try:
                wj_config = self.launch_config
                r = wj_config.prompts_dict(*args, **kwargs)
            except ObjectDoesNotExist:
                r = {}
        else:
            r = super().prompts_dict(*args, **kwargs)
            # Workflow labels and job labels are treated separately
            # that means that they do not propogate from WFJT / workflow job to jobs in workflow
            r.pop('labels', None)

        return r

    def get_notification_templates(self):
        return self.workflow_job_template.notification_templates

    def get_notification_friendly_name(self):
        return "Workflow Job"

    @property
    def preferred_instance_groups(self):
        return []

    def cancel_dispatcher_process(self):
        # WorkflowJobs don't _actually_ run anything in the dispatcher, so
        # there's no point in asking the dispatcher if it knows about this task
        return


class WorkflowApprovalTemplate(UnifiedJobTemplate, RelatedJobsMixin):
    FIELDS_TO_PRESERVE_AT_COPY = [
        'description',
        'timeout',
    ]

    class Meta:
        app_label = 'main'

    timeout = models.IntegerField(
        blank=True,
        default=0,
        help_text=_("The amount of time (in seconds) before the approval node expires and fails."),
    )

    @classmethod
    def _get_unified_job_class(cls):
        return WorkflowApproval

    @classmethod
    def _get_unified_job_field_names(cls):
        return ['name', 'description', 'timeout']

    def get_absolute_url(self, request=None):
        return reverse('api:workflow_approval_template_detail', kwargs={'pk': self.pk}, request=request)

    @property
    def workflow_job_template(self):
        return self.workflowjobtemplatenodes.first().workflow_job_template

    '''
    RelatedJobsMixin
    '''

    def _get_related_jobs(self):
        return UnifiedJob.objects.filter(unified_job_template=self)


class WorkflowApproval(UnifiedJob, JobNotificationMixin):
    class Meta:
        app_label = 'main'

    workflow_approval_template = models.ForeignKey(
        'WorkflowApprovalTemplate',
        related_name='approvals',
        blank=True,
        null=True,
        default=None,
        on_delete=models.SET_NULL,
    )
    timeout = models.IntegerField(
        blank=True,
        default=0,
        help_text=_("The amount of time (in seconds) before the approval node expires and fails."),
    )
    expires = models.DateTimeField(
        default=None,
        null=True,
        editable=False,
        help_text=_("The time this approval will expire. This is the created time plus timeout, used for filtering."),
    )
    timed_out = models.BooleanField(default=False, help_text=_("Shows when an approval node (with a timeout assigned to it) has timed out."))
    approved_or_denied_by = models.ForeignKey(
        'auth.User',
        related_name='%s(class)s_approved+',
        default=None,
        null=True,
        editable=False,
        on_delete=models.SET_NULL,
    )

    def _set_default_dependencies_processed(self):
        self.dependencies_processed = True

    @classmethod
    def _get_unified_job_template_class(cls):
        return WorkflowApprovalTemplate

    def get_absolute_url(self, request=None):
        return reverse('api:workflow_approval_detail', kwargs={'pk': self.pk}, request=request)

    @property
    def event_class(self):
        return None

    def get_ui_url(self):
        return urljoin(settings.TOWER_URL_BASE, WORKFLOW_BASE_URL.format(settings.OPTIONAL_UI_URL_PREFIX, self.workflow_job.id))

    def _get_parent_field_name(self):
        return 'workflow_approval_template'

    def save(self, *args, **kwargs):
        update_fields = list(kwargs.get('update_fields', []))
        if self.timeout != 0 and ((not self.pk) or (not update_fields) or ('timeout' in update_fields)):
            if not self.created:  # on creation, created will be set by parent class, so we fudge it here
                created = now()
            else:
                created = self.created
            new_expires = created + timedelta(seconds=self.timeout)
            if new_expires != self.expires:
                self.expires = new_expires
                if update_fields and 'expires' not in update_fields:
                    update_fields.append('expires')
        elif self.timeout == 0 and ((not update_fields) or ('timeout' in update_fields)):
            if self.expires:
                self.expires = None
                if update_fields and 'expires' not in update_fields:
                    update_fields.append('expires')
        super(WorkflowApproval, self).save(*args, **kwargs)

    @property
    def ai_task_node(self):
        try:
            node = self.unified_job_node
        except ObjectDoesNotExist:
            return None
        return node if node.is_ai_task_node else None

    def approve(self, request=None):
        user = getattr(request, 'user', None) or get_current_user()
        ai_node = self.ai_task_node
        if ai_node and ai_node.ai_task_status == 'awaiting_approval':
            resource_action = ai_node.approve_ai_resource_action_plan(user)
            self.status = 'successful' if resource_action.get('can_apply') else 'failed'
        else:
            self.status = 'successful'
        self.approved_or_denied_by = user
        self.save()
        self.send_approval_notification('approved' if self.status == 'successful' else 'denied')
        self.websocket_emit_status(self.status)
        ScheduleWorkflowManager().schedule()
        return reverse('api:workflow_approval_approve', kwargs={'pk': self.pk}, request=request)

    def deny(self, request=None):
        user = getattr(request, 'user', None) or get_current_user()
        ai_node = self.ai_task_node
        if ai_node and ai_node.ai_task_status == 'awaiting_approval':
            ai_node.deny_ai_resource_action_plan(user)
        self.status = 'failed'
        self.approved_or_denied_by = user
        self.save()
        self.send_approval_notification('denied')
        self.websocket_emit_status(self.status)
        ScheduleWorkflowManager().schedule()
        return reverse('api:workflow_approval_deny', kwargs={'pk': self.pk}, request=request)

    def cancel(self, job_explanation=None, is_chain=False):
        # WorkflowApprovals have no dispatcher process (they wait for human
        # input) and are excluded from TaskManager processing, so the base
        # cancel() would only set cancel_flag without ever transitioning the
        # status.  We call super() for the flag, then transition directly.
        has_already_canceled = bool(self.status == 'canceled')
        super().cancel(job_explanation=job_explanation, is_chain=is_chain)
        if self.status != 'canceled' and not has_already_canceled:
            self.status = 'canceled'
            self.save(update_fields=['status'])

    def signal_start(self, **kwargs):
        can_start = super(WorkflowApproval, self).signal_start(**kwargs)
        self.started = self.created
        self.save(update_fields=['started'])
        self.send_approval_notification('running')
        return can_start

    @property
    def event_processing_finished(self):
        return True  # approval jobs do not have events

    @property
    def has_unpartitioned_events(self):
        return False  # approval jobs do not have events

    def send_approval_notification(self, approval_status):
        from awx.main.tasks.system import send_notifications  # avoid circular import

        if self.workflow_job_template is None:
            return
        for nt in self.workflow_job_template.notification_templates["approvals"]:
            try:
                notification_subject, notification_body = self.build_approval_notification_message(nt, approval_status)
            except Exception:
                raise NotImplementedError("build_approval_notification_message() does not exist")

            # Use kwargs to force late-binding
            # https://stackoverflow.com/a/3431699/10669572
            def send_it(local_nt=nt, local_subject=notification_subject, local_body=notification_body):
                def _func():
                    send_notifications.delay([local_nt.generate_notification(local_subject, local_body).id], job_id=self.id)

                return _func

            connection.on_commit(send_it())

    def build_approval_notification_message(self, nt, approval_status):
        env = sandbox.ImmutableSandboxedEnvironment()

        context = self.context(approval_status)

        msg_template = body_template = None
        msg = body = ''

        # Use custom template if available
        if nt.messages and nt.messages.get('workflow_approval', None):
            template = nt.messages['workflow_approval'].get(approval_status, {})
            msg_template = template.get('message', None)
            body_template = template.get('body', None)
        # If custom template not provided, look up default template
        default_template = nt.notification_class.default_messages['workflow_approval'][approval_status]
        if not msg_template:
            msg_template = default_template.get('message', None)
        if not body_template:
            body_template = default_template.get('body', None)

        if msg_template:
            try:
                msg = env.from_string(msg_template).render(**context)
            except (TemplateSyntaxError, UndefinedError, SecurityError):
                msg = ''

        if body_template:
            try:
                body = env.from_string(body_template).render(**context)
            except (TemplateSyntaxError, UndefinedError, SecurityError):
                body = ''

        return (msg, body)

    def context(self, approval_status):
        workflow_url = urljoin(settings.TOWER_URL_BASE, WORKFLOW_BASE_URL.format(settings.OPTIONAL_UI_URL_PREFIX, self.workflow_job.id))
        return {
            'approval_status': approval_status,
            'approval_node_name': self.workflow_approval_template.name if self.workflow_approval_template_id else self.name,
            'workflow_url': workflow_url,
            'job_metadata': json.dumps(self.notification_data(), indent=4),
        }

    @property
    def workflow_job_template(self):
        try:
            return self.unified_job_node.workflow_job.unified_job_template
        except ObjectDoesNotExist:
            return None

    @property
    def workflow_job(self):
        return self.unified_job_node.workflow_job

    def notification_data(self):
        result = super(WorkflowApproval, self).notification_data()
        result.update(
            dict(
                extra_vars=self.workflow_job.display_extra_vars(),
            )
        )
        return result
