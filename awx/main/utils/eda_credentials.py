# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

import copy
import secrets

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework.serializers import ValidationError as DRFValidationError

from awx.main import models
from awx.main.utils.eda import EDAControllerClient, EDAControllerError, _coerce_items, _pick_first

EDA_CREDENTIAL_CONTENT_TYPE = 'eda.edacredential'
EDA_CREDENTIAL_SYNC_MODES = {'observe', 'sync', 'enforce'}
CAPSTAN_CREDENTIAL_TYPE_MARKER = '[capstan-credential-type:{id}]'
CAPSTAN_CREDENTIAL_MARKER = '[capstan-credential:{id}]'
EDA_IMPORTED_CREDENTIAL_TYPE_MARKER = '[eda-credential-type:{id}]'
EDA_IMPORTED_CREDENTIAL_MARKER = '[eda-credential:{id}]'
EDA_MISSING_SECRETS_MARKER = '[eda-missing-secrets:{fields}]'
CAPSTAN_CREDENTIAL_FIELD_KEYS = {
    'choices',
    'default',
    'format',
    'help_text',
    'id',
    'label',
    'multiline',
    'secret',
    'type',
}
CAPSTAN_CREDENTIAL_FIELD_FORMATS = {'ssh_private_key', 'url'}

CAPSTAN_TO_EDA_CREDENTIAL_ROLE_MAPPINGS = (
    {
        'awx_role_field': 'admin_role',
        'awx_role_label': 'Credential Admin',
        'eda_role_name': 'EDA Credential Admin',
    },
    {
        'awx_role_field': 'use_role',
        'awx_role_label': 'Credential Use',
        'eda_role_name': 'EDA Credential Use',
    },
)


def _item_id(value):
    if isinstance(value, dict):
        return _pick_first(value, ('id', 'pk', 'uuid'))
    return value


def _item_name(value):
    if isinstance(value, dict):
        return _pick_first(value, ('name', 'username', 'email', 'id'))
    return value


def _normalized_text(value):
    return str(value or '').strip().lower()


def _result_items(payload):
    return [item for item in _coerce_items(payload) if isinstance(item, dict)]


def _list_resource(client, resource):
    return _result_items(client.list_resource_all(resource, page_size=200))


def _marker(marker_template, object_id):
    return marker_template.format(id=object_id)


def _marked_description(marker_template, obj):
    marker = _marker(marker_template, obj.pk)
    description = _public_description(getattr(obj, 'description', ''))
    return f'{marker}\n{description}' if description else marker


def _public_description(description):
    internal_prefixes = ('[eda-credential-type:', '[eda-credential:', '[eda-missing-secrets:')
    return '\n'.join(line for line in str(description or '').splitlines() if not line.strip().startswith(internal_prefixes)).strip()


def _marker_id(description, prefix):
    description = str(description or '')
    if prefix not in description:
        return None
    value = description.split(prefix, 1)[1].split(']', 1)[0]
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _marker_values(description, prefix):
    description = str(description or '')
    if prefix not in description:
        return []
    value = description.split(prefix, 1)[1].split(']', 1)[0]
    return sorted({item.strip() for item in value.split(',') if item.strip()})


def _organization_id(item):
    return str(_item_id(item.get('organization_id') or item.get('organization')) or '')


def _credential_type_id(item):
    return str(_item_id(item.get('credential_type_id') or item.get('credential_type')) or '')


def _accessible_credentials(user=None):
    queryset = models.Credential.objects.select_related('credential_type', 'organization').order_by('id')
    if user is None or user.is_superuser:
        return queryset
    return queryset.filter(pk__in=models.Credential.accessible_objects(user, 'read_role').values('pk'))


def _eda_state(client):
    credential_types = _list_resource(client, 'credential-types')
    credentials = _list_resource(client, 'credentials')
    organizations = _list_resource(client, 'organizations')
    users = _list_resource(client, 'users')
    teams = _list_resource(client, 'teams')
    roles = _list_resource(client, 'role-definitions')
    user_assignments = _list_resource(client, 'user-role-assignments')
    team_assignments = _list_resource(client, 'team-role-assignments')
    return {
        'credential_types': credential_types,
        'credentials': credentials,
        'organizations': organizations,
        'users': users,
        'teams': teams,
        'roles': roles,
        'user_assignments': user_assignments,
        'team_assignments': team_assignments,
        'credential_types_by_capstan_id': {
            marker_id: item for item in credential_types if (marker_id := _marker_id(item.get('description'), '[capstan-credential-type:')) is not None
        },
        'credential_types_by_id': {str(_item_id(item)): item for item in credential_types if _item_id(item) not in (None, '')},
        'credential_types_by_namespace': {
            _normalized_text(item.get('namespace')): item for item in credential_types if _normalized_text(item.get('namespace'))
        },
        'credential_types_by_name': {_normalized_text(item.get('name')): item for item in credential_types if _normalized_text(item.get('name'))},
        'credentials_by_capstan_id': {
            marker_id: item for item in credentials if (marker_id := _marker_id(item.get('description'), '[capstan-credential:')) is not None
        },
        'credentials_by_id': {str(_item_id(item)): item for item in credentials if _item_id(item) not in (None, '')},
        'organizations_by_name': {_normalized_text(item.get('name')): item for item in organizations if _normalized_text(item.get('name'))},
        'organizations_by_id': {str(_item_id(item)): item for item in organizations if _item_id(item) not in (None, '')},
        'users_by_name': {_normalized_text(item.get('username')): item for item in users if _normalized_text(item.get('username'))},
        'users_by_id': {str(_item_id(item)): item for item in users if _item_id(item) not in (None, '')},
        'teams_by_key': {(_organization_id(item), _normalized_text(item.get('name'))): item for item in teams if _normalized_text(item.get('name'))},
        'teams_by_id': {str(_item_id(item)): item for item in teams if _item_id(item) not in (None, '')},
        'roles_by_key': {
            (
                str(_item_name(item.get('content_type') or item.get('content_type_model')) or ''),
                _normalized_text(item.get('name')),
            ): item
            for item in roles
            if _normalized_text(item.get('name'))
        },
    }


def _append_error(report, action, name, detail, **extra):
    row = {'action': action, 'name': name, 'detail': detail}
    row.update(extra)
    report['errors'].append(row)


def _safe_write_error(exc):
    return f'Event Engine credential write failed ({getattr(exc, "status", "error")}).'


def _eda_injector_value(value):
    if isinstance(value, dict):
        return {key: _eda_injector_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_eda_injector_value(item) for item in value]
    if isinstance(value, str):
        return value.replace('tower.filename', 'eda.filename')
    return value


def _capstan_injector_value(value):
    if isinstance(value, dict):
        return {key: _capstan_injector_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_capstan_injector_value(item) for item in value]
    if isinstance(value, str):
        return value.replace('eda.filename', 'tower.filename')
    return value


def _credential_type_payload(credential_type):
    return {
        'name': credential_type.name,
        'description': _marked_description(CAPSTAN_CREDENTIAL_TYPE_MARKER, credential_type),
        'inputs': credential_type.inputs or {'fields': []},
        'injectors': _eda_injector_value(credential_type.injectors or {}),
    }


def _credential_type_match(credential_type, state):
    marked = state['credential_types_by_capstan_id'].get(credential_type.pk)
    if marked:
        return marked, 'managed'
    imported_id = _marker_id(credential_type.description, '[eda-credential-type:')
    if imported_id is not None:
        imported = state['credential_types_by_id'].get(str(imported_id))
        if imported:
            return imported, 'native' if imported.get('managed') else 'imported'
    namespace = _normalized_text(credential_type.namespace)
    if namespace and namespace in state['credential_types_by_namespace']:
        return state['credential_types_by_namespace'][namespace], 'native'
    named = state['credential_types_by_name'].get(_normalized_text(credential_type.name))
    if named and named.get('managed'):
        return named, 'native'
    if named:
        return named, 'conflict'
    return None, 'missing'


def _project_credential_types(client, report, state, credential_types, mode, prune_stale):
    type_map = {}
    desired_ids = set()
    for credential_type in credential_types:
        desired_ids.add(credential_type.pk)
        remote, match = _credential_type_match(credential_type, state)
        row = {
            'capstan_credential_type_id': credential_type.pk,
            'name': credential_type.name,
            'kind': credential_type.kind,
            'namespace': credential_type.namespace or '',
            'managed': credential_type.managed,
            'input_fields': list(credential_type.defined_fields),
            'status': match,
        }
        report['desired_credential_types'].append(row)
        if match == 'conflict':
            _append_error(
                report,
                'match_credential_type',
                credential_type.name,
                'An unmanaged Event Engine credential type already uses this name and is not owned by Capstan.',
            )
            continue
        if remote:
            type_map[credential_type.pk] = remote
            if match in ('managed', 'imported') and mode in ('sync', 'enforce'):
                desired_payload = _credential_type_payload(credential_type)
                changed = {key: value for key, value in desired_payload.items() if key in ('name', 'description') and remote.get(key) != value}
                if remote.get('inputs') != desired_payload['inputs']:
                    changed['inputs'] = desired_payload['inputs']
                if remote.get('injectors') != desired_payload['injectors']:
                    changed['injectors'] = desired_payload['injectors']
                if changed:
                    try:
                        remote = client.update_resource('credential-types', _item_id(remote), changed)
                        state['credential_types_by_capstan_id'][credential_type.pk] = remote
                        type_map[credential_type.pk] = remote
                        report['actions'].append(
                            {
                                'action': 'update_credential_type',
                                'name': credential_type.name,
                                'capstan_credential_type_id': credential_type.pk,
                                'eda_credential_type_id': _item_id(remote),
                            }
                        )
                    except EDAControllerError as exc:
                        _append_error(report, 'update_credential_type', credential_type.name, str(exc))
            continue

        report['missing_credential_types'].append(row)
        if mode not in ('sync', 'enforce'):
            continue
        try:
            remote = client.create_resource('credential-types', _credential_type_payload(credential_type))
        except EDAControllerError as exc:
            _append_error(report, 'create_credential_type', credential_type.name, str(exc))
            continue
        state['credential_types'].append(remote)
        state['credential_types_by_capstan_id'][credential_type.pk] = remote
        type_map[credential_type.pk] = remote
        report['actions'].append(
            {
                'action': 'create_credential_type',
                'name': credential_type.name,
                'capstan_credential_type_id': credential_type.pk,
                'eda_credential_type_id': _item_id(remote),
            }
        )

    if mode == 'enforce' and prune_stale:
        stale = [(capstan_id, remote) for capstan_id, remote in state['credential_types_by_capstan_id'].items() if capstan_id not in desired_ids]
        report['_stale_credential_types'] = stale
    return type_map


def _ensure_organization(client, report, state, organization, mode):
    if organization:
        name = organization.name
        description = organization.description or 'Managed by Capstan'
    else:
        name = 'Default'
        description = 'Default Event Engine organization'
    remote = state['organizations_by_name'].get(_normalized_text(name))
    if remote or mode not in ('sync', 'enforce'):
        return remote
    try:
        remote = client.create_resource('organizations', {'name': name, 'description': description})
    except EDAControllerError as exc:
        _append_error(report, 'create_organization', name, str(exc))
        return None
    state['organizations'].append(remote)
    state['organizations_by_name'][_normalized_text(name)] = remote
    state['organizations_by_id'][str(_item_id(remote))] = remote
    report['actions'].append({'action': 'create_identity', 'resource': 'organizations', 'name': name, 'id': _item_id(remote)})
    return remote


def _credential_inputs(credential):
    missing_imported_secrets = [
        field
        for field in _marker_values(credential.description, '[eda-missing-secrets:')
        if field not in credential.inputs or credential.inputs.get(field) in (None, '')
    ]
    if missing_imported_secrets:
        raise EDAControllerError(
            'Imported from Event Engine; enter these secret fields in Capstan before reconciliation: ' + ', '.join(missing_imported_secrets),
            'missing_imported_secrets',
        )
    if credential.dynamic_input_fields:
        raise EDAControllerError(
            f'Dynamic input sources are configured for fields: {", ".join(sorted(credential.dynamic_input_fields))}.',
            'dynamic_input',
        )
    values = {}
    for field_name in credential.credential_type.defined_fields:
        if field_name not in credential.inputs:
            continue
        value = credential.get_input(field_name)
        if value == 'ASK':
            raise EDAControllerError(f'Runtime prompt field "{field_name}" cannot be projected to Event Engine.', 'runtime_prompt')
        values[field_name] = value
    return values


def _credential_row(credential, remote_type, remote_org, status):
    return {
        'capstan_credential_id': credential.pk,
        'name': credential.name,
        'credential_type': credential.credential_type.name,
        'capstan_credential_type_id': credential.credential_type_id,
        'eda_credential_type_id': _item_id(remote_type) if remote_type else None,
        'organization': credential.organization.name if credential.organization else 'Default',
        'eda_organization_id': _item_id(remote_org) if remote_org else None,
        'input_fields': sorted(credential.inputs.keys()),
        'status': status,
    }


def _credential_exact_match(state, credential, remote_type, remote_org):
    type_id = str(_item_id(remote_type) or '')
    org_id = str(_item_id(remote_org) or '')
    for remote in state['credentials']:
        if (
            _normalized_text(remote.get('name')) == _normalized_text(credential.name)
            and _credential_type_id(remote) == type_id
            and _organization_id(remote) == org_id
        ):
            return remote
    return None


def _project_credentials(client, report, state, credentials, type_map, mode, refresh_secrets, prune_stale):
    credential_map = {}
    desired_ids = set()
    for credential in credentials:
        desired_ids.add(credential.pk)
        remote_type = type_map.get(credential.credential_type_id)
        remote_org = _ensure_organization(client, report, state, credential.organization, mode)
        marked = state['credentials_by_capstan_id'].get(credential.pk)
        imported_id = _marker_id(credential.description, '[eda-credential:')
        imported = state['credentials_by_id'].get(str(imported_id)) if imported_id is not None else None
        exact = _credential_exact_match(state, credential, remote_type, remote_org) if remote_type and remote_org else None
        status = 'managed' if marked else ('imported' if imported else ('conflict' if exact else 'missing'))
        row = _credential_row(credential, remote_type, remote_org, status)
        report['desired_credentials'].append(row)
        if not remote_type:
            _append_error(
                report,
                'match_credential',
                credential.name,
                'The Capstan credential type does not have a compatible Event Engine projection.',
                capstan_credential_id=credential.pk,
            )
            continue
        if not remote_org:
            _append_error(
                report,
                'match_credential',
                credential.name,
                'The Capstan credential organization does not have a compatible Event Engine projection.',
                capstan_credential_id=credential.pk,
            )
            continue
        if exact and not marked and not imported:
            _append_error(
                report,
                'match_credential',
                credential.name,
                'An Event Engine credential already uses this name, type, and organization and is not owned by Capstan.',
                capstan_credential_id=credential.pk,
            )
            continue

        remote = marked or imported
        if remote:
            credential_map[credential.pk] = remote
            if mode in ('sync', 'enforce'):
                try:
                    _credential_inputs(credential)
                except EDAControllerError as exc:
                    if getattr(exc, 'status', '') == 'missing_imported_secrets':
                        _append_error(
                            report,
                            'resolve_credential_inputs',
                            credential.name,
                            str(exc),
                            capstan_credential_id=credential.pk,
                        )
                        continue
                payload = {
                    'name': credential.name,
                    'description': _marked_description(CAPSTAN_CREDENTIAL_MARKER, credential),
                    'credential_type_id': int(_item_id(remote_type)),
                    'organization_id': int(_item_id(remote_org)),
                }
                if refresh_secrets:
                    try:
                        payload['inputs'] = _credential_inputs(credential)
                    except EDAControllerError as exc:
                        _append_error(
                            report,
                            'resolve_credential_inputs',
                            credential.name,
                            str(exc),
                            capstan_credential_id=credential.pk,
                        )
                        continue
                metadata_changed = (
                    remote.get('name') != payload['name']
                    or remote.get('description') != payload['description']
                    or _credential_type_id(remote) != str(payload['credential_type_id'])
                    or _organization_id(remote) != str(payload['organization_id'])
                )
                if metadata_changed or refresh_secrets:
                    try:
                        remote = client.update_resource('credentials', _item_id(remote), payload)
                        state['credentials_by_capstan_id'][credential.pk] = remote
                        credential_map[credential.pk] = remote
                        report['actions'].append(
                            {
                                'action': 'update_credential',
                                'name': credential.name,
                                'capstan_credential_id': credential.pk,
                                'eda_credential_id': _item_id(remote),
                                'input_fields': sorted((payload.get('inputs') or {}).keys()),
                            }
                        )
                    except EDAControllerError as exc:
                        _append_error(
                            report,
                            'update_credential',
                            credential.name,
                            _safe_write_error(exc),
                            capstan_credential_id=credential.pk,
                        )
            continue

        report['missing_credentials'].append(row)
        if mode not in ('sync', 'enforce'):
            continue
        try:
            inputs = _credential_inputs(credential)
        except EDAControllerError as exc:
            _append_error(report, 'resolve_credential_inputs', credential.name, str(exc), capstan_credential_id=credential.pk)
            continue
        payload = {
            'name': credential.name,
            'description': _marked_description(CAPSTAN_CREDENTIAL_MARKER, credential),
            'inputs': inputs,
            'credential_type_id': int(_item_id(remote_type)),
            'organization_id': int(_item_id(remote_org)),
        }
        try:
            remote = client.create_resource('credentials', payload)
        except EDAControllerError as exc:
            _append_error(
                report,
                'create_credential',
                credential.name,
                _safe_write_error(exc),
                capstan_credential_id=credential.pk,
            )
            continue
        state['credentials'].append(remote)
        state['credentials_by_capstan_id'][credential.pk] = remote
        credential_map[credential.pk] = remote
        report['actions'].append(
            {
                'action': 'create_credential',
                'name': credential.name,
                'capstan_credential_id': credential.pk,
                'eda_credential_id': _item_id(remote),
                'input_fields': sorted(inputs.keys()),
            }
        )

    if mode == 'enforce' and prune_stale:
        stale = [(capstan_id, remote) for capstan_id, remote in state['credentials_by_capstan_id'].items() if capstan_id not in desired_ids]
        for capstan_id, remote in stale:
            try:
                client.delete_resource('credentials', _item_id(remote))
                report['actions'].append(
                    {
                        'action': 'delete_credential',
                        'name': remote.get('name') or str(_item_id(remote)),
                        'capstan_credential_id': capstan_id,
                        'eda_credential_id': _item_id(remote),
                    }
                )
            except EDAControllerError as exc:
                _append_error(report, 'delete_credential', remote.get('name') or str(_item_id(remote)), str(exc))
    return credential_map


def _ensure_user(client, report, state, user, mode):
    remote = state['users_by_name'].get(_normalized_text(user.username))
    if remote or mode not in ('sync', 'enforce'):
        return remote
    payload = {
        'username': user.username,
        'password': secrets.token_urlsafe(32),
        'first_name': user.first_name or '',
        'last_name': user.last_name or '',
        'email': user.email or '',
        'is_superuser': False,
        'is_staff': False,
    }
    try:
        remote = client.create_resource('users', payload)
    except EDAControllerError as exc:
        _append_error(report, 'create_user', user.username, str(exc))
        return None
    state['users'].append(remote)
    state['users_by_name'][_normalized_text(user.username)] = remote
    state['users_by_id'][str(_item_id(remote))] = remote
    report['actions'].append({'action': 'create_identity', 'resource': 'users', 'name': user.username, 'id': _item_id(remote)})
    return remote


def _ensure_team(client, report, state, team, remote_org, mode):
    key = (str(_item_id(remote_org) or ''), _normalized_text(team.name))
    remote = state['teams_by_key'].get(key)
    if remote or mode not in ('sync', 'enforce'):
        return remote
    try:
        remote = client.create_resource(
            'teams',
            {
                'name': team.name,
                'description': 'Managed by Capstan',
                'organization_id': int(_item_id(remote_org)),
            },
        )
    except EDAControllerError as exc:
        _append_error(report, 'create_team', team.name, str(exc))
        return None
    state['teams'].append(remote)
    state['teams_by_key'][key] = remote
    state['teams_by_id'][str(_item_id(remote))] = remote
    report['actions'].append({'action': 'create_identity', 'resource': 'teams', 'name': team.name, 'id': _item_id(remote)})
    return remote


def _role_definition(state, name):
    return state['roles_by_key'].get((EDA_CREDENTIAL_CONTENT_TYPE, _normalized_text(name)))


def _assignment_key(assignment, actor_type):
    return (
        actor_type,
        str(_item_id(assignment.get(actor_type)) or ''),
        str(_item_id(assignment.get('role_definition') or assignment.get('role_definition_id')) or ''),
        str(_item_name(assignment.get('content_type')) or ''),
        str(_item_id(assignment.get('object_id') or assignment.get('object')) or ''),
    )


def _direct_role_teams(role, organization):
    if not role or not organization:
        return models.Team.objects.none()
    return models.Team.objects.filter(organization=organization, member_role__children=role).order_by('name')


def _project_credential_access(client, report, state, credentials, credential_map, mode):
    desired = {}
    role_ids = set()
    managed_credential_ids = {str(_item_id(remote)) for remote in credential_map.values() if _item_id(remote) not in (None, '')}
    for credential in credentials:
        remote_credential = credential_map.get(credential.pk)
        if not remote_credential:
            continue
        remote_org = state['organizations_by_name'].get(_normalized_text(credential.organization.name if credential.organization else 'Default'))
        for mapping in CAPSTAN_TO_EDA_CREDENTIAL_ROLE_MAPPINGS:
            remote_role = _role_definition(state, mapping['eda_role_name'])
            if not remote_role:
                _append_error(
                    report,
                    'match_role_definition',
                    mapping['eda_role_name'],
                    f'Event Engine role definition for {EDA_CREDENTIAL_CONTENT_TYPE} was not found.',
                )
                continue
            role_ids.add(str(_item_id(remote_role)))
            role = getattr(credential, mapping['awx_role_field'])
            for user in role.members.order_by('username'):
                remote_actor = _ensure_user(client, report, state, user, mode)
                if not remote_actor:
                    continue
                key = ('user', str(_item_id(remote_actor)), str(_item_id(remote_role)), EDA_CREDENTIAL_CONTENT_TYPE, str(_item_id(remote_credential)))
                desired[key] = {
                    'actor_type': 'user',
                    'actor_name': user.username,
                    'eda_actor_id': _item_id(remote_actor),
                    'role_name': mapping['eda_role_name'],
                    'eda_role_id': _item_id(remote_role),
                    'credential_name': credential.name,
                    'eda_credential_id': _item_id(remote_credential),
                    'awx_role_label': mapping['awx_role_label'],
                }
            for team in _direct_role_teams(role, credential.organization):
                remote_actor = _ensure_team(client, report, state, team, remote_org, mode)
                if not remote_actor:
                    continue
                key = ('team', str(_item_id(remote_actor)), str(_item_id(remote_role)), EDA_CREDENTIAL_CONTENT_TYPE, str(_item_id(remote_credential)))
                desired[key] = {
                    'actor_type': 'team',
                    'actor_name': team.name,
                    'eda_actor_id': _item_id(remote_actor),
                    'role_name': mapping['eda_role_name'],
                    'eda_role_id': _item_id(remote_role),
                    'credential_name': credential.name,
                    'eda_credential_id': _item_id(remote_credential),
                    'awx_role_label': mapping['awx_role_label'],
                }

    current = {}
    for actor_type, assignments in (('user', state['user_assignments']), ('team', state['team_assignments'])):
        for assignment in assignments:
            key = _assignment_key(assignment, actor_type)
            if key[3] == EDA_CREDENTIAL_CONTENT_TYPE:
                current[key] = assignment
    report['desired_access_assignments'] = list(desired.values())
    for key, row in desired.items():
        if key in current:
            continue
        report['missing_access_assignments'].append(row)
        if mode not in ('sync', 'enforce'):
            continue
        payload = {
            row['actor_type']: int(row['eda_actor_id']),
            'role_definition': int(row['eda_role_id']),
            'content_type': EDA_CREDENTIAL_CONTENT_TYPE,
            'object_id': int(row['eda_credential_id']),
        }
        try:
            created = client.create_resource(f"{row['actor_type']}-role-assignments", payload)
            report['actions'].append(
                {
                    'action': 'create_credential_access',
                    'resource': f"{row['actor_type']}-role-assignments",
                    'id': _item_id(created),
                    **row,
                }
            )
        except EDAControllerError as exc:
            _append_error(report, 'create_credential_access', row['credential_name'], str(exc), actor_name=row['actor_name'])

    known_user_ids = {
        str(_item_id(state['users_by_name'].get(_normalized_text(username))) or '') for username in models.User.objects.values_list('username', flat=True)
    }
    capstan_team_keys = {
        (_normalized_text(organization_name), _normalized_text(team_name))
        for organization_name, team_name in models.Team.objects.values_list('organization__name', 'name')
    }
    known_team_ids = set()
    for remote in state['teams']:
        remote_organization = state['organizations_by_id'].get(_organization_id(remote))
        remote_team_key = (
            _normalized_text(remote_organization.get('name') if remote_organization else ''),
            _normalized_text(remote.get('name')),
        )
        if remote_team_key in capstan_team_keys:
            known_team_ids.add(str(_item_id(remote)))
    extras = []
    for key, assignment in current.items():
        actor_type, actor_id, role_id, _, object_id = key
        if object_id not in managed_credential_ids or role_id not in role_ids:
            continue
        known_actor_ids = known_user_ids if actor_type == 'user' else known_team_ids
        if actor_id not in known_actor_ids or key in desired:
            continue
        row = {
            'id': assignment.get('id'),
            'actor_type': actor_type,
            'eda_actor_id': actor_id,
            'eda_role_id': role_id,
            'eda_credential_id': object_id,
        }
        extras.append(row)
    report['extra_access_assignments'] = extras
    if mode == 'enforce':
        for row in extras:
            try:
                client.delete_resource(f"{row['actor_type']}-role-assignments", row['id'])
                report['actions'].append({'action': 'delete_credential_access', **row})
            except EDAControllerError as exc:
                _append_error(report, 'delete_credential_access', str(row['eda_credential_id']), str(exc))
    report['_current_credential_assignments'] = len(current)


def _delete_stale_credential_types(client, report):
    for capstan_id, remote in report.pop('_stale_credential_types', []):
        try:
            client.delete_resource('credential-types', _item_id(remote))
            report['actions'].append(
                {
                    'action': 'delete_credential_type',
                    'name': remote.get('name') or str(_item_id(remote)),
                    'capstan_credential_type_id': capstan_id,
                    'eda_credential_type_id': _item_id(remote),
                }
            )
        except EDAControllerError as exc:
            _append_error(report, 'delete_credential_type', remote.get('name') or str(_item_id(remote)), str(exc))


def _import_description(marker_template, remote, missing_secret_fields=None):
    lines = [_marker(marker_template, _item_id(remote))]
    if missing_secret_fields:
        lines.append(EDA_MISSING_SECRETS_MARKER.format(fields=','.join(sorted(missing_secret_fields))))
    description = _public_description(remote.get('description'))
    if description:
        lines.append(description)
    return '\n'.join(lines)


def _remote_type_schema(remote):
    remote_inputs = copy.deepcopy(remote.get('inputs') or {})
    remote_fields = remote_inputs.get('fields')
    fields = []
    for remote_field in remote_fields if isinstance(remote_fields, list) else []:
        if not isinstance(remote_field, dict) or not remote_field.get('id'):
            continue
        field = {key: value for key, value in remote_field.items() if key in CAPSTAN_CREDENTIAL_FIELD_KEYS}
        if field.get('format') not in CAPSTAN_CREDENTIAL_FIELD_FORMATS:
            field.pop('format', None)
        fields.append(field)
    field_ids = {field['id'] for field in fields}
    required = [field_id for field_id in remote_inputs.get('required', []) if field_id in field_ids]
    inputs = {'fields': fields}
    if required:
        inputs['required'] = required
    return inputs, _capstan_injector_value(copy.deepcopy(remote.get('injectors') or {}))


def _credential_type_is_compatible(local, remote):
    if _normalized_text(local.name) != _normalized_text(remote.get('name')):
        return False
    if local.managed:
        return True
    inputs, injectors = _remote_type_schema(remote)
    return (local.inputs or {'fields': []}) == inputs and (local.injectors or {}) == injectors


def _local_imported_type_map():
    return {
        imported_id: credential_type
        for credential_type in models.CredentialType.objects.all()
        if (imported_id := _marker_id(credential_type.description, '[eda-credential-type:')) is not None
    }


def _local_imported_credential_map():
    return {
        imported_id: credential
        for credential in models.Credential.objects.select_related('credential_type', 'organization')
        if (imported_id := _marker_id(credential.description, '[eda-credential:')) is not None
    }


def _find_local_type_for_import(remote, imported_types):
    remote_id = _item_id(remote)
    imported = imported_types.get(remote_id)
    if imported:
        return imported, 'imported'
    named = list(models.CredentialType.objects.filter(name__iexact=str(remote.get('name') or '').strip()).order_by('-managed', 'id'))
    for credential_type in named:
        if _credential_type_is_compatible(credential_type, remote):
            return credential_type, 'existing'
    if named:
        return None, 'conflict'
    return None, 'create'


def _create_imported_credential_type(remote):
    inputs, injectors = _remote_type_schema(remote)
    credential_type = models.CredentialType(
        name=str(remote.get('name') or '').strip(),
        description=_import_description(EDA_IMPORTED_CREDENTIAL_TYPE_MARKER, remote),
        kind=remote.get('kind') if remote.get('kind') in ('cloud', 'net') else 'cloud',
        inputs=inputs,
        injectors=injectors,
    )
    credential_type.full_clean()
    credential_type.save()
    return credential_type


def _remote_credential_inputs(remote, remote_type):
    remote_inputs = remote.get('inputs') if isinstance(remote.get('inputs'), dict) else {}
    secret_fields = {
        field.get('id')
        for field in (remote_type.get('inputs') or {}).get('fields', [])
        if isinstance(field, dict) and field.get('id') and field.get('secret') is True
    }
    missing_secret_fields = sorted(field for field in secret_fields if remote_inputs.get(field) not in (None, ''))
    non_secret_inputs = {key: value for key, value in remote_inputs.items() if key not in secret_fields and value != '$encrypted$'}
    return non_secret_inputs, missing_secret_fields


def _remote_organization(state, remote_credential):
    return state['organizations_by_id'].get(_organization_id(remote_credential))


def _find_local_organization(state, remote_credential):
    remote = _remote_organization(state, remote_credential)
    name = str((remote or {}).get('name') or '').strip()
    if not name:
        return None, ''
    return models.Organization.objects.filter(name__iexact=name).first(), name


def _find_local_credential_for_import(remote, credential_type, organization, imported_credentials):
    remote_id = _item_id(remote)
    imported = imported_credentials.get(remote_id)
    if imported:
        return imported, 'imported'
    if not credential_type or not organization:
        return None, 'blocked'
    exact = models.Credential.objects.filter(
        name__iexact=str(remote.get('name') or '').strip(),
        credential_type=credential_type,
        organization=organization,
    ).first()
    return (exact, 'existing') if exact else (None, 'create')


def _create_imported_credential(remote, remote_type, credential_type, organization):
    inputs, missing_secret_fields = _remote_credential_inputs(remote, remote_type)
    credential = models.Credential(
        name=str(remote.get('name') or '').strip(),
        description=_import_description(EDA_IMPORTED_CREDENTIAL_MARKER, remote, missing_secret_fields),
        credential_type=credential_type,
        organization=organization,
        inputs=inputs,
    )
    credential.full_clean()
    credential.save()
    return credential, missing_secret_fields


def build_eda_credential_import_report(user=None, *, apply=False):
    client = EDAControllerClient()
    report = {
        'source': 'eda_controller' if client.is_configured else 'not_configured',
        'mode': 'apply' if apply else 'preview',
        'secret_values_included': False,
        'summary': {},
        'credential_types': [],
        'credentials': [],
        'actions': [],
        'errors': [],
    }
    if not client.is_configured:
        report['summary'] = {
            'eda_credential_types': 0,
            'eda_credentials': 0,
            'importable_credential_types': 0,
            'importable_credentials': 0,
            'existing': 0,
            'secrets_required': 0,
            'actions': 0,
            'errors': 0,
        }
        return report
    if user is not None and not user.is_superuser:
        raise EDAControllerError('Only a system administrator can import Event Engine credentials.', 'forbidden')

    state = _eda_state(client)
    imported_types = _local_imported_type_map()
    imported_credentials = _local_imported_credential_map()
    local_type_map = {}
    type_status_by_remote_id = {}
    source_types = [remote for remote in state['credential_types'] if _marker_id(remote.get('description'), '[capstan-credential-type:') is None]
    source_credentials = [remote for remote in state['credentials'] if _marker_id(remote.get('description'), '[capstan-credential:') is None]

    for remote in source_types:
        remote_id = _item_id(remote)
        local, status = _find_local_type_for_import(remote, imported_types)
        row = {
            'eda_credential_type_id': remote_id,
            'capstan_credential_type_id': local.pk if local else None,
            'name': remote.get('name') or '',
            'managed_in_eda': bool(remote.get('managed')),
            'status': status,
        }
        report['credential_types'].append(row)
        type_status_by_remote_id[str(remote_id)] = status
        if status == 'conflict':
            _append_error(
                report,
                'import_credential_type',
                row['name'],
                'A Capstan credential type with this name has a different schema. It was not overwritten.',
                eda_credential_type_id=remote_id,
            )
            continue
        if not local and apply:
            try:
                with transaction.atomic():
                    local = _create_imported_credential_type(remote)
            except (DjangoValidationError, DRFValidationError) as exc:
                _append_error(
                    report,
                    'import_credential_type',
                    row['name'],
                    str(exc),
                    eda_credential_type_id=remote_id,
                )
                continue
            row['capstan_credential_type_id'] = local.pk
            row['status'] = 'created'
            type_status_by_remote_id[str(remote_id)] = 'created'
            imported_types[remote_id] = local
            report['actions'].append(
                {
                    'action': 'create_credential_type',
                    'name': local.name,
                    'eda_credential_type_id': remote_id,
                    'capstan_credential_type_id': local.pk,
                }
            )
        if local:
            local_type_map[str(remote_id)] = local

    for remote in source_credentials:
        remote_id = _item_id(remote)
        remote_type = state['credential_types_by_id'].get(_credential_type_id(remote))
        credential_type = local_type_map.get(_credential_type_id(remote))
        organization, organization_name = _find_local_organization(state, remote)
        type_status = type_status_by_remote_id.get(_credential_type_id(remote))
        if not apply and not credential_type and type_status == 'create' and organization:
            local, status = None, 'create'
        else:
            local, status = _find_local_credential_for_import(
                remote,
                credential_type,
                organization,
                imported_credentials,
            )
        _, missing_secret_fields = _remote_credential_inputs(remote, remote_type or {})
        row = {
            'eda_credential_id': remote_id,
            'capstan_credential_id': local.pk if local else None,
            'name': remote.get('name') or '',
            'credential_type': (remote_type or {}).get('name') or '',
            'organization': organization_name,
            'missing_secret_fields': missing_secret_fields,
            'status': status,
        }
        report['credentials'].append(row)
        if not remote_type:
            _append_error(
                report,
                'import_credential',
                row['name'],
                'The Event Engine credential type could not be resolved.',
                eda_credential_id=remote_id,
            )
            continue
        if not credential_type and not (not apply and type_status == 'create'):
            _append_error(
                report,
                'import_credential',
                row['name'],
                'Import its credential type before importing this credential.',
                eda_credential_id=remote_id,
            )
            continue
        if not organization:
            _append_error(
                report,
                'import_credential',
                row['name'],
                f'Create or rename a Capstan organization to match Event Engine organization "{organization_name or "unknown"}".',
                eda_credential_id=remote_id,
            )
            continue
        if not local and apply:
            try:
                with transaction.atomic():
                    local, missing_secret_fields = _create_imported_credential(
                        remote,
                        remote_type,
                        credential_type,
                        organization,
                    )
            except (DjangoValidationError, DRFValidationError) as exc:
                _append_error(
                    report,
                    'import_credential',
                    row['name'],
                    str(exc),
                    eda_credential_id=remote_id,
                )
                continue
            row['capstan_credential_id'] = local.pk
            row['missing_secret_fields'] = missing_secret_fields
            row['status'] = 'created'
            imported_credentials[remote_id] = local
            report['actions'].append(
                {
                    'action': 'create_credential',
                    'name': local.name,
                    'eda_credential_id': remote_id,
                    'capstan_credential_id': local.pk,
                    'missing_secret_fields': missing_secret_fields,
                }
            )

    report['summary'] = {
        'eda_credential_types': len(source_types),
        'eda_credentials': len(source_credentials),
        'importable_credential_types': sum(row['status'] in ('create', 'created') for row in report['credential_types']),
        'importable_credentials': sum(row['status'] in ('create', 'created') for row in report['credentials']),
        'existing': sum(row['status'] in ('existing', 'imported') for row in report['credential_types'] + report['credentials']),
        'secrets_required': sum(bool(row['missing_secret_fields']) for row in report['credentials']),
        'actions': len(report['actions']),
        'errors': len(report['errors']),
    }
    return report


def build_eda_credential_sync_report(user=None, *, mode='observe', refresh_secrets=False):
    mode = str(mode or 'observe').strip().lower()
    if mode not in EDA_CREDENTIAL_SYNC_MODES:
        raise EDAControllerError('EDA credential sync mode is invalid.', 'invalid')

    client = EDAControllerClient()
    report = {
        'source': 'eda_controller' if client.is_configured else 'not_configured',
        'mode': mode,
        'secret_values_included': False,
        'summary': {},
        'desired_credential_types': [],
        'missing_credential_types': [],
        'desired_credentials': [],
        'missing_credentials': [],
        'desired_access_assignments': [],
        'missing_access_assignments': [],
        'extra_access_assignments': [],
        'actions': [],
        'errors': [],
    }
    if not client.is_configured:
        report['summary'] = {
            'capstan_credential_types': 0,
            'capstan_credentials': 0,
            'projected_credential_types': 0,
            'projected_credentials': 0,
            'desired_access_assignments': 0,
            'current_access_assignments': 0,
            'missing': 0,
            'actions': 0,
            'errors': 0,
        }
        return report

    credentials = list(_accessible_credentials(user))
    credential_type_ids = {credential.credential_type_id for credential in credentials}
    if user is None or user.is_superuser:
        credential_types = list(models.CredentialType.objects.all().order_by('id'))
    else:
        credential_types = list(models.CredentialType.objects.filter(pk__in=credential_type_ids).order_by('id'))

    state = _eda_state(client)
    prune_stale = user is None or user.is_superuser
    type_map = _project_credential_types(client, report, state, credential_types, mode, prune_stale)
    credential_map = _project_credentials(
        client,
        report,
        state,
        credentials,
        type_map,
        mode,
        bool(refresh_secrets),
        prune_stale,
    )
    _project_credential_access(client, report, state, credentials, credential_map, mode)
    if mode == 'enforce' and prune_stale:
        _delete_stale_credential_types(client, report)
    else:
        report.pop('_stale_credential_types', None)
    current_assignments = report.pop('_current_credential_assignments', 0)
    report['summary'] = {
        'capstan_credential_types': len(credential_types),
        'capstan_credentials': len(credentials),
        'projected_credential_types': len(type_map),
        'projected_credentials': len(credential_map),
        'desired_access_assignments': len(report['desired_access_assignments']),
        'current_access_assignments': current_assignments,
        'missing': (len(report['missing_credential_types']) + len(report['missing_credentials']) + len(report['missing_access_assignments'])),
        'actions': len(report['actions']),
        'errors': len(report['errors']),
    }
    return report
