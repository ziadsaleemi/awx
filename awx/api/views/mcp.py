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
- launch_terraform_job     → POST /api/v2/terraform_job_templates/<id>/launch/
- list_catalog_items       → GET /api/v2/catalog_items/
"""

import json
import logging

from django.urls import reverse
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from rest_framework.permissions import IsAuthenticated
from awx.main.models import (
    Credential,
    Inventory,
    Job,
    JobTemplate,
    Project,
)

logger = logging.getLogger('awx.api.mcp')

MCP_VERSION = '2024-11-05'

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
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _paginate_queryset(qs, page_size=50):
    """Return a safe page of objects as dicts."""
    page_size = min(int(page_size), 200)
    return list(qs[:page_size].values())


def _tag_activity(user, action: str, resource: str, resource_id: int | None = None):
    """Log an MCP-initiated action to the standard Python logger (activity stream hook)."""
    logger.info(
        'MCP action | user=%s | action=%s | resource=%s | id=%s',
        user.username,
        action,
        resource,
        resource_id,
    )


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
    _tag_activity(request.user, 'launch_job', 'job_template', jt.pk)

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
        base = request.build_absolute_uri('/api/v2/mcp/')
        return Response({
            'protocolVersion': MCP_VERSION,
            'serverInfo': {
                'name': 'AWX MCP Server',
                'version': '1.0.0',
            },
            'capabilities': {
                'tools': {'listChanged': False},
            },
            'tools_url': base + 'tools/',
            'invoke_url': base + 'invoke/',
        })


class MCPToolsView(APIView):
    """
    GET /api/v2/mcp/tools/

    Returns the list of available MCP tools with their input schemas.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        return Response({'tools': MCP_TOOLS})


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

        try:
            result = handler(request, arguments)
        except Exception as exc:
            logger.exception('MCP tool %s raised an exception', tool_name)
            return Response(
                {
                    'content': [{'type': 'text', 'text': f'Internal error: {exc}'}],
                    'isError': True,
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        is_error = 'error' in result
        return Response({
            'content': [{'type': 'text', 'text': json.dumps(result)}],
            'isError': is_error,
        })
