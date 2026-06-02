# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

import json

from django.utils.translation import gettext_lazy as _
from rest_framework.response import Response

from awx.api.generics import APIView
from awx.api.permissions import IsSystemAdmin
from awx.main.management.commands.check_external_automation import run_external_automation_checks


class ExternalAutomationCheckView(APIView):
    name = _('External Automation Check')
    resource_purpose = 'live EDA and OPA automation smoke check'
    permission_classes = [IsSystemAdmin]

    def post(self, request, format=None):
        data = request.data if isinstance(request.data, dict) else {}
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
        )
        return Response(result)
