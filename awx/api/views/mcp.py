"""
MCP (Model Context Protocol) Server for AWX.

Exposes AWX resources as MCP tools so external AI agents (Claude Desktop,
Cursor, VS Code Copilot, etc.) can discover and invoke automation without
custom integrations.

Endpoints
---------
GET  /api/v2/mcp/manifest/   — MCP manifest (protocol discovery)
GET  /api/v2/mcp/tools/      — List available MCP tools
POST /api/v2/mcp/invoke/     — Invoke an MCP tool

Authentication: AWX token or session (same as the rest of the v2 API).
Every MCP-initiated action is tagged activity-stream with source="mcp".
Configured MCP policy context is returned with tool responses and included in
OPA guardrail input for launch tools.

MCP Tool catalogue
------------------
- list_job_templates       → GET /api/v2/job_templates/
- get_job_template         → GET /api/v2/job_templates/<id>/
- launch_job               → POST /api/v2/job_templates/<id>/launch/
- get_job_status           → GET /api/v2/jobs/<id>/
- list_inventories         → GET /api/v2/inventories/
- get_inventory            → GET /api/v2/inventories/<id>/
- list_credentials         → GET /api/v2/credentials/
- list_projects            → GET /api/v2/projects/
- list_terraform_templates → GET /api/v2/terraform_job_templates/
- list_catalog_items       → GET /api/v2/catalog_items/
- list_catalog_deployments → GET /api/v2/catalog_deployments/
- get_catalog_deployment   → GET /api/v2/catalog_deployments/<id>/
- get_policy_context       → Retrieve configured MCP policy context
- preview_resource_action  → Validate an AWX resource-authoring plan without saving
- apply_resource_action    → Apply an explicit AWX resource-authoring plan
"""

import hashlib
import json
import logging
import re

from django.conf import settings
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from awx.main.models import (
    ActivityStream,
    CatalogDeployment,
    CatalogItem,
    Credential,
    Inventory,
    Job,
    JobTemplate,
    Project,
)

logger = logging.getLogger('awx.api.mcp')

MCP_VERSION = '2024-11-05'
MCP_READ_SCOPE = 'mcp:read'
MCP_WRITE_SCOPE = 'mcp:write'
MCP_WRITE_TOOLS = {'apply_resource_action', 'launch_job'}
MCP_COMPAT_READ_SCOPES = {'read', 'write'}
MCP_COMPAT_WRITE_SCOPES = {'write'}
MCP_TOKEN_RE = re.compile(r'[a-zA-Z0-9_]{3,}')
MCP_RESOURCE_ACTION_TYPES = (
    'catalog_item',
    'constructed_inventory',
    'credential_reference',
    'inventory',
    'inventory_source',
    'job_template',
    'project',
    'project_file',
    'role_assignment',
    'schedule',
    'smart_inventory',
    'survey_spec',
    'workflow_job_template',
)

# ---------------------------------------------------------------------------
# Tool definitions
# ---------------------------------------------------------------------------

MCP_TOOLS = [
    {
        'name': 'list_job_templates',
        'description': 'List all job templates in AWX. Returns name, id, description, and playbook.',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'search': {'type': 'string', 'description': 'Optional name search filter'},
                'page_size': {'type': 'integer', 'description': 'Results per page (max 200)', 'default': 50},
            },
        },
    },
    {
        'name': 'get_job_template',
        'description': 'Get details of a specific job template by ID.',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'id': {'type': 'integer', 'description': 'Job template ID'},
            },
            'required': ['id'],
        },
    },
    {
        'name': 'launch_job',
        'description': 'Launch an Ansible job from a job template. Returns the new job ID.',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'template_id': {'type': 'integer', 'description': 'Job template ID to launch'},
                'extra_vars': {'type': 'object', 'description': 'Extra variables to pass to the job (key/value dict)'},
                'limit': {'type': 'string', 'description': 'Host limit pattern'},
                'verbosity': {'type': 'integer', 'description': 'Verbosity level (0-5)', 'default': 0},
            },
            'required': ['template_id'],
        },
    },
    {
        'name': 'get_job_status',
        'description': 'Get the current status and result of a running or completed job.',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'job_id': {'type': 'integer', 'description': 'Job ID'},
            },
            'required': ['job_id'],
        },
    },
    {
        'name': 'list_inventories',
        'description': 'List all inventories in AWX.',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'search': {'type': 'string', 'description': 'Optional name search filter'},
                'page_size': {'type': 'integer', 'default': 50},
            },
        },
    },
    {
        'name': 'get_inventory',
        'description': 'Get details of an inventory by ID, including host count and variables.',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'id': {'type': 'integer', 'description': 'Inventory ID'},
            },
            'required': ['id'],
        },
    },
    {
        'name': 'list_credentials',
        'description': 'List credentials visible to the current user (secrets are never returned).',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'search': {'type': 'string'},
                'page_size': {'type': 'integer', 'default': 50},
            },
        },
    },
    {
        'name': 'list_projects',
        'description': 'List all projects (SCM repositories) in AWX.',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'search': {'type': 'string'},
                'page_size': {'type': 'integer', 'default': 50},
            },
        },
    },
    {
        'name': 'list_terraform_templates',
        'description': 'List all Terraform job templates in AWX.',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'search': {'type': 'string'},
                'page_size': {'type': 'integer', 'default': 50},
            },
        },
    },
    {
        'name': 'list_catalog_items',
        'description': 'List service catalog items visible to the current user.',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'search': {'type': 'string'},
                'page_size': {'type': 'integer', 'default': 50},
            },
        },
    },
    {
        'name': 'list_catalog_deployments',
        'description': 'List service catalog deployments visible to the current user.',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'search': {'type': 'string'},
                'status': {'type': 'string', 'description': 'Optional deployment status filter'},
                'page_size': {'type': 'integer', 'default': 50},
            },
        },
    },
    {
        'name': 'get_catalog_deployment',
        'description': 'Get details for a service catalog deployment by ID.',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'id': {'type': 'integer', 'description': 'Catalog deployment ID'},
            },
            'required': ['id'],
        },
    },
    {
        'name': 'get_policy_context',
        'description': 'Retrieve AWX policy and best-practice context relevant to a planned MCP action.',
        'inputSchema': {
            'type': 'object',
            'properties': {
                'query': {'type': 'string', 'description': 'Natural-language query or planned action'},
                'limit': {'type': 'integer', 'default': 3},
            },
        },
    },
    {
        'name': 'preview_resource_action',
        'description': (
            'Validate a typed AWX resource-authoring plan without saving. Supports projects, playbooks/roles via '
            'project_file, inventories, smart/constructed inventories, inventory sources, job templates, workflow '
            'templates, schedules, catalog items, role assignments, survey specs, and credential references.'
        ),
        'inputSchema': {
            'type': 'object',
            'properties': {
                'plan': {'type': 'object', 'description': 'Typed AI resource-action plan to validate'},
                'prompt': {'type': 'string', 'description': 'Optional natural-language request to turn into a plan'},
                'context': {'type': 'object', 'description': 'Optional route/resource context for prompt-generated plans'},
            },
        },
    },
    {
        'name': 'apply_resource_action',
        'description': (
            'Apply an explicit typed AWX resource-authoring plan using the same serializers, RBAC, OPA guardrails, '
            'Activity Stream audit, and rollback behavior as /api/v2/ai/resource_actions/. Use preview_resource_action first.'
        ),
        'inputSchema': {
            'type': 'object',
            'properties': {
                'plan': {'type': 'object', 'description': 'Typed AI resource-action plan to apply'},
                'context': {'type': 'object', 'description': 'Optional route/resource context stored with the request'},
            },
            'required': ['plan'],
        },
    },
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _paginate_queryset(qs, page_size=50):
    """Return a safe page of objects as dicts."""
    page_size = min(int(page_size), 200)
    return list(qs[:page_size].values())


def _page_size(params: dict, default=50):
    try:
        return max(1, min(int(params.get('page_size', default)), 200))
    except (TypeError, ValueError):
        return default


def _policy_vector_dimensions():
    try:
        value = int(getattr(settings, 'MCP_POLICY_VECTOR_DIMENSIONS', 64))
    except (TypeError, ValueError):
        return 64
    return max(16, min(value, 512))


def _policy_tokens(text):
    return [token.lower() for token in MCP_TOKEN_RE.findall(str(text or ''))]


def _policy_embedding(text, dimensions=None):
    dimensions = dimensions or _policy_vector_dimensions()
    vector = [0.0] * dimensions
    for token in _policy_tokens(text):
        digest = hashlib.sha256(token.encode('utf-8')).digest()
        bucket = int.from_bytes(digest[:4], 'big') % dimensions
        sign = 1.0 if digest[4] & 1 else -1.0
        vector[bucket] += sign

    norm = sum(value * value for value in vector) ** 0.5
    if not norm:
        return vector
    return [value / norm for value in vector]


def _policy_vector_score(left, right):
    return sum(left_value * right_value for left_value, right_value in zip(left, right))


def _policy_documents():
    raw_context = getattr(settings, 'MCP_POLICY_CONTEXT', '') or ''
    if not isinstance(raw_context, str) or not raw_context.strip():
        return []

    documents = []
    for index, section in enumerate(re.split(r'\n\s*\n', raw_context.strip()), start=1):
        content = section.strip()
        if not content:
            continue
        first_line = content.splitlines()[0].strip().lstrip('#').strip()
        title = first_line[:120] or f'Policy context {index}'
        documents.append(
            {
                'id': f'policy-{index}',
                'title': title,
                'content': content[:2000],
                '_embedding': _policy_embedding(f'{title}\n{content}'),
            }
        )
    return documents


def _safe_argument_summary(arguments):
    summary = {'argument_keys': sorted(arguments.keys())}
    for key in ('id', 'job_id', 'template_id', 'status', 'page_size'):
        if key in arguments:
            summary[key] = arguments[key]
    if isinstance(arguments.get('extra_vars'), dict):
        summary['extra_var_keys'] = sorted(arguments['extra_vars'].keys())
    if isinstance(arguments.get('prompt'), str):
        summary['prompt_chars'] = len(arguments['prompt'])
    if isinstance(arguments.get('plan'), dict):
        plan = arguments['plan']
        operations = plan.get('operations') or plan.get('actions') or []
        if isinstance(operations, list):
            summary['operation_count'] = len(operations)
            resource_types = []
            for operation in operations:
                if isinstance(operation, dict):
                    resource_type = operation.get('resource_type') or operation.get('resource') or operation.get('type')
                    if isinstance(resource_type, str):
                        resource_types.append(resource_type)
            if resource_types:
                summary['resource_types'] = sorted(set(resource_types))
    return summary


def _policy_query_for_request(tool_name, arguments):
    if isinstance(arguments.get('query'), str) and arguments['query'].strip():
        return arguments['query'].strip()

    query_parts = [tool_name]
    if isinstance(arguments.get('prompt'), str) and arguments['prompt'].strip():
        query_parts.append(arguments['prompt'][:500])
    for value in _safe_argument_summary(arguments).values():
        if isinstance(value, (str, int)):
            query_parts.append(str(value))
        elif isinstance(value, list):
            query_parts.extend(str(item) for item in value)
    return ' '.join(query_parts)


def _policy_context_for_request(tool_name, arguments):
    documents = _policy_documents()
    if not documents:
        return []

    query = _policy_query_for_request(tool_name, arguments)
    tokens = set(_policy_tokens(query))
    query_embedding = _policy_embedding(query)

    ranked = []
    for document in documents:
        document_text = f"{document['title']} {document['content']}"
        document_tokens = set(_policy_tokens(document_text))
        matched_terms = sorted(tokens & document_tokens)
        token_score = len(matched_terms) / max(len(tokens), 1)
        vector_score = max(0.0, _policy_vector_score(query_embedding, document['_embedding']))
        score = round((vector_score * 0.8) + (token_score * 0.2), 6)
        payload = {key: value for key, value in document.items() if not key.startswith('_')}
        payload['score'] = score
        if matched_terms:
            payload['matched_terms'] = matched_terms[:20]
        ranked.append((score, len(matched_terms), payload))
    ranked.sort(key=lambda item: (item[0], item[1]), reverse=True)

    requested_limit = arguments.get('limit', 3)
    try:
        limit = max(1, min(int(requested_limit), 10))
    except (TypeError, ValueError):
        limit = 3

    selected = [document for score, matched_count, document in ranked if score > 0 or matched_count > 0][:limit]
    if not selected:
        selected = [document for _, _, document in ranked[:limit]]
    return selected


def _mcp_base_url(request):
    forwarded_proto = request.META.get('HTTP_X_FORWARDED_PROTO', '').split(',')[0].strip()
    forwarded_host = request.META.get('HTTP_X_FORWARDED_HOST', '').split(',')[0].strip()
    scheme = forwarded_proto or request.scheme
    host = forwarded_host or request.get_host()
    prefix = request.META.get('HTTP_X_FORWARDED_PREFIX', '').rstrip('/')
    return f'{scheme}://{host}{prefix}/api/v2/mcp/'


def _tool_required_scope(tool_name):
    return MCP_WRITE_SCOPE if tool_name in MCP_WRITE_TOOLS else MCP_READ_SCOPE


def _tool_allows_write(tool_name):
    return tool_name in MCP_WRITE_TOOLS


def _mcp_tools_for_response():
    tools = []
    for tool in MCP_TOOLS:
        tool_name = tool['name']
        tools.append(
            {
                **tool,
                'mcp_scope': _tool_required_scope(tool_name),
                'annotations': {'readOnlyHint': not _tool_allows_write(tool_name)},
            }
        )
    return tools


def _request_oauth_scopes(request):
    auth = getattr(request, 'auth', None)
    if auth is None:
        return set()

    values = []
    for attr in ('scope', 'scopes'):
        raw = getattr(auth, attr, None)
        if isinstance(raw, str):
            values.extend(raw.split())
        elif isinstance(raw, (list, tuple, set)):
            values.extend(raw)

    get_scopes = getattr(auth, 'get_scopes', None)
    if callable(get_scopes):
        raw = get_scopes()
        if isinstance(raw, str):
            values.extend(raw.split())
        elif isinstance(raw, (list, tuple, set)):
            values.extend(raw)

    return {str(value) for value in values if str(value)}


def _check_mcp_tool_scope(request, tool_name):
    scopes = _request_oauth_scopes(request)
    if not scopes:
        return True, None

    if _tool_allows_write(tool_name):
        allowed_scopes = {MCP_WRITE_SCOPE, *MCP_COMPAT_WRITE_SCOPES}
    else:
        allowed_scopes = {MCP_READ_SCOPE, MCP_WRITE_SCOPE, *MCP_COMPAT_READ_SCOPES}

    if scopes & allowed_scopes:
        return True, None
    return False, f'MCP tool {tool_name} requires OAuth scope {_tool_required_scope(tool_name)}.'


def _audit_related_resource(action, arguments, result):
    if action in ('get_job_template', 'launch_job'):
        return 'job_template', arguments.get('id') or arguments.get('template_id')
    if action == 'get_job_status':
        return 'job', arguments.get('job_id')
    if action == 'get_inventory':
        return 'inventory', arguments.get('id')
    if action == 'get_catalog_deployment':
        return 'catalog_deployment', arguments.get('id')
    if action == 'list_catalog_items':
        return 'catalog_item', None
    if action == 'list_catalog_deployments':
        return 'catalog_deployment', None
    if action == 'list_credentials':
        return 'credential', None
    if action == 'list_projects':
        return 'project', None
    if action == 'list_inventories':
        return 'inventory', None
    if action == 'list_job_templates':
        return 'job_template', None
    if action == 'list_terraform_templates':
        return 'terraform_job_template', None
    if action in ('preview_resource_action', 'apply_resource_action'):
        return 'ai_resource_action', None
    return 'mcp', None


def _attach_activity_relation(entry, resource, resource_id, result):
    if resource_id is not None:
        if resource == 'catalog_deployment':
            deployment = CatalogDeployment.objects.filter(pk=resource_id).select_related('catalog_item').first()
            if deployment is not None and deployment.catalog_item_id:
                entry.catalog_item.add(deployment.catalog_item)
            return

        relation_map = {
            'catalog_item': (CatalogItem, entry.catalog_item),
            'credential': (Credential, entry.credential),
            'inventory': (Inventory, entry.inventory),
            'job': (Job, entry.job),
            'job_template': (JobTemplate, entry.job_template),
            'project': (Project, entry.project),
        }
        model_and_relation = relation_map.get(resource)
        if model_and_relation:
            model, relation = model_and_relation
            obj = model.objects.filter(pk=resource_id).first()
            if obj is not None:
                relation.add(obj)

    job_id = result.get('job_id') if isinstance(result, dict) else None
    if job_id:
        job = Job.objects.filter(pk=job_id).first()
        if job is not None:
            entry.job.add(job)


def _tag_activity(user, action: str, arguments: dict, result: dict, policy_context: list):
    """Persist an ActivityStream audit entry for every MCP tool invocation."""
    resource, resource_id = _audit_related_resource(action, arguments, result)
    is_error = bool(isinstance(result, dict) and result.get('error'))
    changes = {
        'triggered_by': 'mcp_agent',
        'source': 'mcp',
        'action': action,
        'resource': resource,
        'resource_id': resource_id,
        'is_error': is_error,
        **_safe_argument_summary(arguments),
    }
    if policy_context:
        changes['policy_context'] = [document['title'] for document in policy_context]

    entry = ActivityStream.objects.create(
        operation='create',
        object1='mcp',
        object2=resource,
        changes=json.dumps(changes),
        actor=user,
    )
    entry.user.add(user)
    _attach_activity_relation(entry, resource, resource_id, result)

    logger.info(
        'MCP action | user=%s | action=%s | resource=%s | id=%s | error=%s',
        user.username,
        action,
        resource,
        resource_id,
        is_error,
    )
    return entry


# ---------------------------------------------------------------------------
# Tool handlers
# ---------------------------------------------------------------------------


def _handle_list_job_templates(request, params: dict):
    from awx.main.access import JobTemplateAccess

    qs = JobTemplateAccess(request.user).get_queryset()
    search = params.get('search', '')
    if search:
        qs = qs.filter(name__icontains=search)
    page_size = min(int(params.get('page_size', 50)), 200)
    results = list(qs[:page_size].values('id', 'name', 'description', 'playbook', 'status'))
    return {'templates': results, 'count': len(results)}


def _handle_get_job_template(request, params: dict):
    from awx.main.access import JobTemplateAccess

    template_id = params.get('id')
    if not template_id:
        return {'error': 'id is required'}
    qs = JobTemplateAccess(request.user).get_queryset()
    try:
        jt = qs.get(pk=template_id)
    except JobTemplate.DoesNotExist:
        return {'error': f'Job template {template_id} not found or not accessible'}
    return {
        'id': jt.pk,
        'name': jt.name,
        'description': jt.description,
        'playbook': jt.playbook,
        'job_type': jt.job_type,
        'status': jt.status,
        'ask_variables_on_launch': jt.ask_variables_on_launch,
    }


def _handle_launch_job(request, params: dict):
    from awx.main.access import JobTemplateAccess
    from awx.main.models import JobTemplate as JT

    from awx.api.views.opa import check_opa_policy

    template_id = params.get('template_id')
    if not template_id:
        return {'error': 'template_id is required'}

    qs = JobTemplateAccess(request.user).get_queryset()
    try:
        jt = qs.get(pk=template_id)
    except JT.DoesNotExist:
        return {'error': f'Job template {template_id} not found or not accessible'}

    if not request.user.can_access(JT, 'start', jt, None, None, None, False):
        return {'error': 'You do not have permission to launch this job template'}

    policy_context = getattr(request, 'mcp_policy_context', [])

    # G6c — OPA guardrail: validate AI-triggered launch
    opa_input = {
        'user': {
            'username': request.user.username,
            'is_superuser': request.user.is_superuser,
        },
        'template': {
            'id': jt.pk,
            'name': jt.name,
            'playbook': jt.playbook,
        },
        'source': 'mcp',
        'policy_context': policy_context,
    }
    if not check_opa_policy('awx/ai_action/allow', opa_input):
        logger.warning(
            'OPA guardrail denied MCP job launch: user=%s template_id=%s',
            request.user.username,
            jt.pk,
        )
        return {'error': 'This action was denied by an OPA policy guardrail.'}

    extra_vars = params.get('extra_vars', {})
    if isinstance(extra_vars, dict):
        extra_vars = json.dumps(extra_vars)

    launch_kwargs = {
        'extra_vars': extra_vars or '',
        '_eager_fields': {'launched_by': f'mcp:{request.user.username}'},
    }
    if params.get('limit'):
        launch_kwargs['limit'] = params['limit']
    if params.get('verbosity') is not None:
        launch_kwargs['verbosity'] = int(params['verbosity'])

    new_job = jt.create_unified_job(**launch_kwargs)
    new_job.signal_start()

    return {'job_id': new_job.pk, 'status': new_job.status}


def _handle_get_job_status(request, params: dict):
    from awx.main.access import JobAccess

    job_id = params.get('job_id')
    if not job_id:
        return {'error': 'job_id is required'}
    qs = JobAccess(request.user).get_queryset()
    try:
        job = qs.get(pk=job_id)
    except Job.DoesNotExist:
        return {'error': f'Job {job_id} not found or not accessible'}
    return {
        'id': job.pk,
        'status': job.status,
        'started': str(job.started) if job.started else None,
        'finished': str(job.finished) if job.finished else None,
        'elapsed': job.elapsed,
        'failed': job.failed,
    }


def _handle_list_inventories(request, params: dict):
    from awx.main.access import InventoryAccess

    qs = InventoryAccess(request.user).get_queryset()
    search = params.get('search', '')
    if search:
        qs = qs.filter(name__icontains=search)
    page_size = min(int(params.get('page_size', 50)), 200)
    results = list(qs[:page_size].values('id', 'name', 'description', 'total_hosts', 'variables'))
    return {'inventories': results, 'count': len(results)}


def _handle_get_inventory(request, params: dict):
    from awx.main.access import InventoryAccess

    inv_id = params.get('id')
    if not inv_id:
        return {'error': 'id is required'}
    qs = InventoryAccess(request.user).get_queryset()
    try:
        inv = qs.get(pk=inv_id)
    except Inventory.DoesNotExist:
        return {'error': f'Inventory {inv_id} not found or not accessible'}
    return {
        'id': inv.pk,
        'name': inv.name,
        'description': inv.description,
        'total_hosts': inv.total_hosts,
        'total_groups': inv.total_groups,
        'variables': inv.variables,
    }


def _handle_list_credentials(request, params: dict):
    from awx.main.access import CredentialAccess

    qs = CredentialAccess(request.user).get_queryset()
    search = params.get('search', '')
    if search:
        qs = qs.filter(name__icontains=search)
    page_size = min(int(params.get('page_size', 50)), 200)
    results = list(qs[:page_size].values('id', 'name', 'description', 'credential_type'))
    return {'credentials': results, 'count': len(results)}


def _handle_list_projects(request, params: dict):
    from awx.main.access import ProjectAccess

    qs = ProjectAccess(request.user).get_queryset()
    search = params.get('search', '')
    if search:
        qs = qs.filter(name__icontains=search)
    page_size = min(int(params.get('page_size', 50)), 200)
    results = list(qs[:page_size].values('id', 'name', 'description', 'scm_type', 'scm_url', 'status'))
    return {'projects': results, 'count': len(results)}


def _handle_list_terraform_templates(request, params: dict):
    from awx.main.access import TerraformJobTemplateAccess

    try:
        qs = TerraformJobTemplateAccess(request.user).get_queryset()
    except Exception:
        return {'templates': [], 'count': 0}
    search = params.get('search', '')
    if search:
        qs = qs.filter(name__icontains=search)
    page_size = min(int(params.get('page_size', 50)), 200)
    results = list(qs[:page_size].values('id', 'name', 'description', 'terraform_operation'))
    return {'templates': results, 'count': len(results)}


def _handle_list_catalog_items(request, params: dict):
    from awx.main.access import CatalogItemAccess

    qs = CatalogItemAccess(request.user).get_queryset().select_related('organization')
    search = params.get('search', '')
    if search:
        qs = qs.filter(name__icontains=search)
    results = []
    for item in qs[: _page_size(params)]:
        results.append(
            {
                'id': item.pk,
                'name': item.name,
                'description': item.description,
                'organization': item.organization_id,
                'available_providers': item.available_providers or [],
                'browse_enabled': item.browse_enabled,
                'require_lease': item.require_lease,
            }
        )
    return {'catalog_items': results, 'count': len(results)}


def _serialize_catalog_deployment(deployment):
    return {
        'id': deployment.pk,
        'name': deployment.name,
        'status': deployment.status,
        'catalog_item': deployment.catalog_item_id,
        'catalog_item_name': deployment.catalog_item.name if deployment.catalog_item else None,
        'organization': deployment.catalog_item.organization_id if deployment.catalog_item else None,
        'owner': deployment.owner_id,
        'owner_username': deployment.owner.username if deployment.owner else None,
        'target_provider': deployment.target_provider,
        'provision_job': deployment.provision_job_id,
        'terraform_provision_job': deployment.terraform_provision_job_id,
        'deprovision_job': deployment.deprovision_job_id,
        'expires_at': deployment.expires_at.isoformat() if deployment.expires_at else None,
        'auto_deprovision': deployment.auto_deprovision,
        'created': deployment.created.isoformat() if deployment.created else None,
        'modified': deployment.modified.isoformat() if deployment.modified else None,
    }


def _handle_list_catalog_deployments(request, params: dict):
    from awx.main.access import CatalogDeploymentAccess

    qs = (
        CatalogDeploymentAccess(request.user)
        .get_queryset()
        .select_related(
            'catalog_item',
            'catalog_item__organization',
            'owner',
        )
    )
    search = params.get('search', '')
    if search:
        qs = qs.filter(name__icontains=search)
    status_filter = params.get('status', '')
    if status_filter:
        qs = qs.filter(status=status_filter)
    results = [_serialize_catalog_deployment(deployment) for deployment in qs[: _page_size(params)]]
    return {'catalog_deployments': results, 'count': len(results)}


def _handle_get_catalog_deployment(request, params: dict):
    from awx.main.access import CatalogDeploymentAccess

    deployment_id = params.get('id')
    if not deployment_id:
        return {'error': 'id is required'}
    qs = (
        CatalogDeploymentAccess(request.user)
        .get_queryset()
        .select_related(
            'catalog_item',
            'catalog_item__organization',
            'owner',
        )
    )
    try:
        deployment = qs.get(pk=deployment_id)
    except CatalogDeployment.DoesNotExist:
        return {'error': f'Catalog deployment {deployment_id} not found or not accessible'}
    return _serialize_catalog_deployment(deployment)


def _handle_get_policy_context(request, params: dict):
    context = _policy_context_for_request('get_policy_context', params)
    return {'policy_context': context, 'count': len(context)}


def _handle_resource_action(request, params: dict, mode: str):
    from awx.api.views.ai import (
        AIProviderError,
        _ai_plan_uses_operation_references,
        _ai_provider_plan_from_prompt,
        _apply_ai_operations_sequentially,
        _audit_ai_resource_action,
        _build_ai_rollback_plan,
        _json_safe,
        _normalize_ai_plan,
        _public_ai_operation_result,
        _redact_sensitive,
        _summarize_ai_prompt,
        _simulate_ai_operations_for_preview,
        _validate_ai_operations_for_preview,
    )

    if not isinstance(params, dict):
        return {'error': 'arguments must be a JSON object'}

    context = params.get('context') if isinstance(params.get('context'), dict) else {}
    policy_context = getattr(request, 'mcp_policy_context', [])
    if policy_context:
        context = {**context, 'mcp_policy_context': policy_context}

    generated = False
    provider = ''
    model = ''
    prompt_summary = ''
    try:
        if params.get('plan') is not None:
            plan = _normalize_ai_plan(params.get('plan'))
        elif mode == 'preview':
            prompt = params.get('prompt')
            if not isinstance(prompt, str) or not prompt.strip():
                return {'error': 'Provide either a plan object or a non-empty prompt.'}
            prompt = prompt.strip()
            prompt_summary = _summarize_ai_prompt(prompt)
            plan, provider, model = _ai_provider_plan_from_prompt(request, prompt, context)
            generated = True
        else:
            return {'error': 'apply_resource_action requires an explicit plan. Run preview_resource_action first.'}
    except AIProviderError as exc:
        return {'error': str(exc.detail), 'status_code': exc.status_code}
    except (ValueError, json.JSONDecodeError) as exc:
        return {'error': str(exc)}

    resource_policy_context = {
        'source': 'mcp',
        'approval_required': mode == 'apply',
        'human_approved': False,
        'approval': {'method': 'mcp_resource_action', 'tool': f'{mode}_resource_action'},
    }
    if mode == 'preview':
        if _ai_plan_uses_operation_references(plan['operations']):
            operations = _simulate_ai_operations_for_preview(request, plan['operations'], policy_context=resource_policy_context)
        else:
            operations = _validate_ai_operations_for_preview(request, plan['operations'], policy_context=resource_policy_context)
        can_apply = all(operation.get('valid') for operation in operations)
    else:
        operations, can_apply = _apply_ai_operations_sequentially(request, plan['operations'], policy_context=resource_policy_context)

    public_operations = [_public_ai_operation_result(operation) for operation in operations]
    rollback_plan = _build_ai_rollback_plan(plan, public_operations) if mode == 'apply' else None
    audit_entry = _audit_ai_resource_action(
        request, mode, plan, public_operations, provider=provider, model=model, prompt_summary=prompt_summary, rollback_plan=rollback_plan
    )
    result = {
        'mode': mode,
        'generated': generated,
        'plan': _redact_sensitive(_json_safe(plan)),
        'operations': public_operations,
        'can_apply': can_apply,
        'audit': {'activity_stream_id': audit_entry.pk},
        'supported_resource_types': list(MCP_RESOURCE_ACTION_TYPES),
    }
    if rollback_plan:
        result['rollback_plan'] = rollback_plan
    if mode == 'apply' and not can_apply:
        result['error'] = 'AI resource action apply failed validation.'
    return result


def _handle_preview_resource_action(request, params: dict):
    return _handle_resource_action(request, params, 'preview')


def _handle_apply_resource_action(request, params: dict):
    return _handle_resource_action(request, params, 'apply')


TOOL_HANDLERS = {
    'list_job_templates': _handle_list_job_templates,
    'get_job_template': _handle_get_job_template,
    'launch_job': _handle_launch_job,
    'get_job_status': _handle_get_job_status,
    'list_inventories': _handle_list_inventories,
    'get_inventory': _handle_get_inventory,
    'list_credentials': _handle_list_credentials,
    'list_projects': _handle_list_projects,
    'list_terraform_templates': _handle_list_terraform_templates,
    'list_catalog_items': _handle_list_catalog_items,
    'list_catalog_deployments': _handle_list_catalog_deployments,
    'get_catalog_deployment': _handle_get_catalog_deployment,
    'get_policy_context': _handle_get_policy_context,
    'preview_resource_action': _handle_preview_resource_action,
    'apply_resource_action': _handle_apply_resource_action,
}


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------


class MCPManifestView(APIView):
    """
    GET /api/v2/mcp/manifest/

    Returns the MCP protocol manifest so clients can discover this server.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        base = _mcp_base_url(request)
        policy_documents = _policy_documents()
        policy_context_enabled = bool(policy_documents)
        return Response(
            {
                'protocolVersion': MCP_VERSION,
                'serverInfo': {
                    'name': 'AWX MCP Server',
                    'version': '1.0.0',
                },
                'capabilities': {
                    'tools': {'listChanged': False},
                    'policy_context': {
                        'enabled': policy_context_enabled,
                        'rag': {
                            'enabled': policy_context_enabled,
                            'embedding_provider': 'local_hash_vector',
                            'vector_dimensions': _policy_vector_dimensions(),
                            'document_count': len(policy_documents),
                            'max_results': 10,
                        },
                    },
                    'auth': {
                        'oauth2_scope_model': {
                            'read': MCP_READ_SCOPE,
                            'write': MCP_WRITE_SCOPE,
                            'awx_compatibility': {
                                'read': sorted(MCP_COMPAT_READ_SCOPES),
                                'write': sorted(MCP_COMPAT_WRITE_SCOPES),
                            },
                        }
                    },
                    'resource_authoring': {
                        'enabled': True,
                        'preview_tool': 'preview_resource_action',
                        'apply_tool': 'apply_resource_action',
                        'requires_explicit_plan_for_apply': True,
                        'supported_resource_types': list(MCP_RESOURCE_ACTION_TYPES),
                    },
                    'audit': {'activity_stream': True, 'triggered_by': 'mcp_agent'},
                },
                'tool_count': len(MCP_TOOLS),
                'policy_context_enabled': policy_context_enabled,
                'tools_url': base + 'tools/',
                'invoke_url': base + 'invoke/',
            }
        )


class MCPToolsView(APIView):
    """
    GET /api/v2/mcp/tools/

    Returns the list of available MCP tools with their input schemas.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        return Response({'tools': _mcp_tools_for_response()})


class MCPInvokeView(APIView):
    """
    POST /api/v2/mcp/invoke/

    Invoke an MCP tool.

    Body:
        {
            "name": "launch_job",
            "arguments": {"template_id": 42, "extra_vars": {"env": "prod"}}
        }

    Returns:
        {
            "content": [{"type": "text", "text": "<JSON string of result>"}],
            "isError": false
        }
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        tool_name = request.data.get('name')
        arguments = request.data.get('arguments', {})

        if not tool_name or not isinstance(tool_name, str):
            return Response(
                {'error': 'Request must include a "name" field identifying the tool.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not isinstance(arguments, dict):
            return Response(
                {'error': '"arguments" must be a JSON object.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        handler = TOOL_HANDLERS.get(tool_name)
        if handler is None:
            return Response(
                {'error': f'Unknown tool: {tool_name!r}. Call GET /api/v2/mcp/tools/ to list available tools.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        allowed, scope_error = _check_mcp_tool_scope(request, tool_name)
        if not allowed:
            result = {
                'error': scope_error,
                'required_scope': _tool_required_scope(tool_name),
                'token_scopes': sorted(_request_oauth_scopes(request)),
            }
            _tag_activity(request.user, tool_name, arguments, result, [])
            return Response(
                {
                    'content': [{'type': 'text', 'text': json.dumps(result)}],
                    'isError': True,
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        policy_context = _policy_context_for_request(tool_name, arguments)
        request.mcp_policy_context = policy_context
        try:
            result = handler(request, arguments)
        except Exception as exc:
            logger.exception('MCP tool %s raised an exception', tool_name)
            result = {'error': f'Internal error: {exc}'}
            _tag_activity(request.user, tool_name, arguments, result, policy_context)
            return Response(
                {
                    'content': [{'type': 'text', 'text': json.dumps(result)}],
                    'isError': True,
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        if policy_context and isinstance(result, dict) and 'policy_context' not in result:
            result = {**result, 'policy_context': policy_context}
        _tag_activity(request.user, tool_name, arguments, result, policy_context)
        is_error = 'error' in result
        return Response(
            {
                'content': [{'type': 'text', 'text': json.dumps(result)}],
                'isError': is_error,
            }
        )
