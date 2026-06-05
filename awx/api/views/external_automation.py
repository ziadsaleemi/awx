# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

import json

from django.utils.translation import gettext_lazy as _
from rest_framework.exceptions import ParseError
from rest_framework.response import Response

from awx.api.generics import APIView
from awx.api.views.policy_permissions import ExternalAutomationCheckPermission
from awx.api.versioning import reverse
from awx.main.models import ActivityStream, CloudProviderConnection
from awx.main.management.commands.check_external_automation import run_external_automation_checks


def _safe_check_summary(result):
    checks = result.get('checks', {}) if isinstance(result, dict) else {}
    summary = {}
    for name, check in checks.items():
        if not isinstance(check, dict):
            continue
        entry = {
            'ok': bool(check.get('ok')),
            'status': str(check.get('status') or ''),
        }
        for key in ('count', 'allowed', 'health_status_code', 'context', 'verify_ssl'):
            if key in check:
                entry[key] = check[key]
        counts = check.get('counts')
        if isinstance(counts, dict):
            entry['counts'] = {
                key: counts.get(key)
                for key in ('constraint_templates', 'constraints', 'violations', 'configs', 'nodes', 'vms', 'containers', 'templates', 'running_vms')
                if key in counts
            }
        for key in ('api_url', 'connection_id', 'connection_name', 'connection_status', 'verify_ssl', 'expected_vms_found'):
            if key in check:
                entry[key] = check[key]
        policy_sync = check.get('policy_sync')
        if isinstance(policy_sync, dict):
            entry['policy_sync'] = {
                'requested': bool(policy_sync.get('requested')),
                'ok': bool(policy_sync.get('ok')) if 'ok' in policy_sync else None,
                'status': str(policy_sync.get('status') or ''),
                'policy_id': str(policy_sync.get('policy_id') or ''),
            }
        deny_smoke = check.get('deny_smoke')
        if isinstance(deny_smoke, dict):
            entry['deny_smoke'] = {
                'requested': bool(deny_smoke.get('requested')),
                'ok': bool(deny_smoke.get('ok')) if 'ok' in deny_smoke else None,
                'status': str(deny_smoke.get('status') or ''),
                'allowed': deny_smoke.get('allowed'),
            }
        summary[name] = entry
    return summary


def _audit_external_automation_check(request, result):
    changes = {
        'triggered_by': 'settings_external_automation_smoke',
        'source': 'external_automation_check',
        'is_error': not bool(result.get('ok')),
        'checks': _safe_check_summary(result),
    }
    entry = ActivityStream.objects.create(
        operation='create',
        object1='external_automation',
        object2='check',
        changes=json.dumps(changes),
        actor=request.user,
    )
    entry.user.add(request.user)
    return {
        'activity_stream_id': entry.pk,
        'activity_stream_url': reverse('api:activity_stream_detail', kwargs={'pk': entry.pk}, request=request),
    }


def _proxmox_check_kwargs_from_request(request, data):
    if not bool(data.get('include_proxmox', False)):
        return {}

    connection_id = str(data.get('proxmox_connection_id') or '').strip()
    if connection_id:
        try:
            int(connection_id)
        except (TypeError, ValueError):
            raise ParseError(_('proxmox_connection_id must be an integer.'))

    qs = (
        request.user.get_queryset(CloudProviderConnection)
        .filter(provider_id='proxmox')
        .select_related('credential', 'credential__credential_type')
        .order_by('-status', 'name', 'id')
    )
    if connection_id:
        qs = qs.filter(pk=connection_id)

    connection = qs.first()
    if connection is None:
        return {
            'proxmox_connection_id': connection_id,
            'proxmox_connection_status': 'missing',
            'proxmox_expected_vms': data.get('proxmox_expected_vms') or [],
        }

    credential = connection.credential
    if credential is None or getattr(credential.credential_type, 'namespace', '') != 'proxmox_ve':
        return {
            'proxmox_connection_id': str(connection.pk),
            'proxmox_connection_name': connection.name,
            'proxmox_connection_status': 'missing_credential',
            'proxmox_expected_vms': data.get('proxmox_expected_vms') or [],
        }

    return {
        'proxmox_api_url': credential.get_input('pm_api_url', default='') or '',
        'proxmox_api_token_id': credential.get_input('pm_api_token_id', default='') or '',
        'proxmox_api_token_secret': credential.get_input('pm_api_token_secret', default='') or '',
        'proxmox_tls_insecure': bool(credential.get_input('pm_tls_insecure', default=False)),
        'proxmox_expected_vms': data.get('proxmox_expected_vms') or [],
        'proxmox_connection_id': str(connection.pk),
        'proxmox_connection_name': connection.name,
        'proxmox_connection_status': connection.status,
    }


class ExternalAutomationCheckView(APIView):
    name = _('External Automation Check')
    resource_purpose = 'live EDA, OPA, Gatekeeper, and Proxmox automation smoke check'
    permission_classes = [ExternalAutomationCheckPermission]

    def post(self, request, format=None):
        data = request.data if isinstance(request.data, dict) else {}
        proxmox_kwargs = _proxmox_check_kwargs_from_request(request, data)
        result = run_external_automation_checks(
            include_eda=bool(data.get('include_eda', True)),
            include_opa=bool(data.get('include_opa', True)),
            start_eda_activation=bool(data.get('start_eda_activation', False)),
            eda_rulebook_name=str(data.get('eda_rulebook_name') or 'codex-smoke.yml'),
            eda_activation_id=str(data.get('eda_activation_id') or ''),
            eda_event_source=str(data.get('eda_event_source') or ''),
            eda_activation_extra_data=json.dumps(data.get('eda_activation_extra_data') or {}),
            eda_include_events=bool(data.get('eda_include_events', False)),
            cleanup_eda_activation=bool(data.get('cleanup_eda_activation', False)),
            sync_opa_policy=bool(data.get('sync_opa_policy', False)),
            opa_policy_id=str(data.get('opa_policy_id') or 'awx/managed'),
            opa_deny_smoke=bool(data.get('opa_deny_smoke', False)),
            opa_deny_policy_id=str(data.get('opa_deny_policy_id') or 'awx/codex_deny_smoke'),
            include_gatekeeper=bool(data.get('include_gatekeeper', False)),
            gatekeeper_context=str(data.get('gatekeeper_context') or ''),
            include_proxmox=bool(data.get('include_proxmox', False)),
            **proxmox_kwargs,
        )
        result['audit'] = _audit_external_automation_check(request, result)
        return Response(result)
