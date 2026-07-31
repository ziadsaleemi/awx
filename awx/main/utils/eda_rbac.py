# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

import secrets
from dataclasses import dataclass

from django.db.models import Q

from awx.main import models
from awx.main.utils.eda import EDAControllerClient, EDAControllerError, _coerce_items, _pick_first

EDA_ORGANIZATION_CONTENT_TYPE = 'shared.organization'
EDA_RBAC_SYNC_MODES = {'observe', 'sync', 'enforce'}

# AWX remains the desired-state owner; EDA remains the enforcement owner. These
# mappings intentionally use upstream managed EDA organization roles by name.
AWX_TO_EDA_ORG_ROLE_MAPPINGS = (
    {
        'awx_role_field': 'admin_role',
        'awx_role_label': 'Organization Admin',
        'eda_role_name': 'Organization Admin',
        'eda_role_aliases': ('Admin',),
        'actor_source': 'awx_organization_admin',
    },
    {
        'awx_role_field': 'eda_admin_role',
        'awx_role_label': 'EDA Administrator',
        'eda_role_name': 'Organization Admin',
        'eda_role_aliases': ('Admin',),
        'actor_source': 'awx_eda_admin',
    },
    {
        'awx_role_field': 'eda_operator_role',
        'awx_role_label': 'EDA Operator',
        'eda_role_name': 'Organization Operator',
        'eda_role_aliases': ('Operator',),
        'actor_source': 'awx_eda_operator',
    },
    {
        'awx_role_field': 'auditor_role',
        'awx_role_label': 'Organization Auditor',
        'eda_role_name': 'Organization Auditor',
        'eda_role_aliases': ('Auditor', 'Organization Viewer'),
        'actor_source': 'awx_organization_auditor',
    },
    {
        'awx_role_field': 'credential_admin_role',
        'awx_role_label': 'Credential Administrator',
        'eda_role_name': 'Organization EDA Credential Admin',
        'eda_role_aliases': ('EDA Credential Admin',),
        'actor_source': 'awx_credential_admin',
    },
)


@dataclass(frozen=True)
class DesiredAssignment:
    actor_type: str
    actor_id: int
    actor_name: str
    eda_actor_id: str
    eda_actor_name: str
    awx_organization_id: int
    awx_organization_name: str
    eda_organization_id: str
    eda_organization_name: str
    awx_role_field: str
    awx_role_label: str
    eda_role_id: str
    eda_role_name: str
    content_type: str = EDA_ORGANIZATION_CONTENT_TYPE

    @property
    def key(self):
        return (
            self.actor_type,
            str(self.eda_actor_id),
            str(self.eda_role_id),
            self.content_type,
            str(self.eda_organization_id),
        )

    def as_dict(self):
        return {
            'actor_type': self.actor_type,
            'actor_id': self.actor_id,
            'actor_name': self.actor_name,
            'eda_actor_id': self.eda_actor_id,
            'eda_actor_name': self.eda_actor_name,
            'awx_organization_id': self.awx_organization_id,
            'awx_organization_name': self.awx_organization_name,
            'eda_organization_id': self.eda_organization_id,
            'eda_organization_name': self.eda_organization_name,
            'awx_role_field': self.awx_role_field,
            'awx_role_label': self.awx_role_label,
            'eda_role_id': self.eda_role_id,
            'eda_role_name': self.eda_role_name,
            'content_type': self.content_type,
        }


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


def _accessible_sync_organizations(user=None):
    if user is None:
        return models.Organization.objects.all().order_by('name')
    if user.is_superuser:
        return models.Organization.objects.all().order_by('name')
    query = Q(pk__in=models.Organization.accessible_objects(user, 'admin_role').values('pk'))
    query |= Q(pk__in=models.Organization.accessible_objects(user, 'eda_admin_role').values('pk'))
    return models.Organization.objects.filter(query).distinct().order_by('name')


def _list_resource_map(client, resource):
    return _result_items(client.list_resource_all(resource, page_size=200))


def _index_by_name(items, name_key='name'):
    indexed = {}
    for item in items:
        name = _normalized_text(item.get(name_key) or _item_name(item))
        if name:
            indexed.setdefault(name, item)
    return indexed


def _index_eda_users(users):
    return _index_by_name(users, 'username')


def _eda_team_org_id(item):
    return str(_item_id(item.get('organization_id') or item.get('organization')) or '')


def _index_eda_teams(teams):
    indexed = {}
    for team in teams:
        name = _normalized_text(team.get('name') or _item_name(team))
        org_id = _eda_team_org_id(team)
        if name:
            indexed.setdefault((org_id, name), team)
            indexed.setdefault(('', name), team)
    return indexed


def _index_eda_org_roles(role_definitions):
    indexed = {}
    for role in role_definitions:
        name = _normalized_text(role.get('name'))
        content_type = str(_item_name(role.get('content_type') or role.get('content_type_model')) or '')
        if name and (not content_type or content_type == EDA_ORGANIZATION_CONTENT_TYPE):
            indexed.setdefault(name, role)
    return indexed


def _assignment_key(assignment, actor_type):
    actor_value = assignment.get(actor_type)
    actor_id = _item_id(actor_value)
    role_id = _item_id(assignment.get('role_definition') or assignment.get('role_definition_id'))
    object_id = _item_id(assignment.get('object_id') or assignment.get('object'))
    content_type = str(_item_name(assignment.get('content_type')) or '')
    return (actor_type, str(actor_id or ''), str(role_id or ''), content_type, str(object_id or ''))


def _assignment_dict(assignment, actor_type, eda_indexes):
    actor_id = str(_item_id(assignment.get(actor_type)) or '')
    role_id = str(_item_id(assignment.get('role_definition') or assignment.get('role_definition_id')) or '')
    object_id = str(_item_id(assignment.get('object_id') or assignment.get('object')) or '')
    actor = eda_indexes[f'{actor_type}s_by_id'].get(actor_id, {})
    role = eda_indexes['roles_by_id'].get(role_id, {})
    organization = eda_indexes['organizations_by_id'].get(object_id, {})
    return {
        'id': assignment.get('id'),
        'actor_type': actor_type,
        'eda_actor_id': actor_id,
        'eda_actor_name': _item_name(actor) or _item_name(assignment.get(actor_type)) or actor_id,
        'eda_role_id': role_id,
        'eda_role_name': _item_name(role) or _item_name(assignment.get('role_definition')) or role_id,
        'content_type': str(_item_name(assignment.get('content_type')) or ''),
        'eda_organization_id': object_id,
        'eda_organization_name': _item_name(organization) or object_id,
    }


def _eda_indexes(client):
    organizations = _list_resource_map(client, 'organizations')
    users = _list_resource_map(client, 'users')
    teams = _list_resource_map(client, 'teams')
    roles = _list_resource_map(client, 'role-definitions')
    user_assignments = _list_resource_map(client, 'user-role-assignments')
    team_assignments = _list_resource_map(client, 'team-role-assignments')

    return {
        'organizations': organizations,
        'users': users,
        'teams': teams,
        'roles': roles,
        'user_assignments': user_assignments,
        'team_assignments': team_assignments,
        'organizations_by_name': _index_by_name(organizations),
        'users_by_name': _index_eda_users(users),
        'teams_by_key': _index_eda_teams(teams),
        'roles_by_name': _index_eda_org_roles(roles),
        'organizations_by_id': {str(_item_id(item)): item for item in organizations if _item_id(item) not in (None, '')},
        'users_by_id': {str(_item_id(item)): item for item in users if _item_id(item) not in (None, '')},
        'teams_by_id': {str(_item_id(item)): item for item in teams if _item_id(item) not in (None, '')},
        'roles_by_id': {str(_item_id(item)): item for item in roles if _item_id(item) not in (None, '')},
    }


def _append_missing_identity(report, identity_type, name, **extra):
    row = {'name': name}
    row.update(extra)
    if row not in report['missing_identities'][identity_type]:
        report['missing_identities'][identity_type].append(row)


def _mapped_eda_role_names(mapping):
    names = [mapping['eda_role_name']]
    names.extend(mapping.get('eda_role_aliases') or [])
    return names


def _mapped_eda_role(indexes, mapping):
    for role_name in _mapped_eda_role_names(mapping):
        role = indexes['roles_by_name'].get(_normalized_text(role_name))
        if role:
            return role
    return None


def _create_missing_organization(client, report, org, indexes):
    payload = {'name': org.name, 'description': org.description or 'Managed by AWX RBAC sync'}
    try:
        created = client.create_resource('organizations', payload)
    except EDAControllerError as exc:
        report['errors'].append({'action': 'create_organization', 'name': org.name, 'detail': str(exc)})
        return None
    indexes['organizations'].append(created)
    indexes['organizations_by_name'][_normalized_text(created.get('name') or org.name)] = created
    indexes['organizations_by_id'][str(_item_id(created))] = created
    report['actions'].append({'action': 'create_identity', 'resource': 'organizations', 'name': org.name, 'id': _item_id(created)})
    return created


def _create_missing_user(client, report, user, indexes):
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
        created = client.create_resource('users', payload)
    except EDAControllerError as exc:
        report['errors'].append({'action': 'create_user', 'username': user.username, 'detail': str(exc)})
        return None
    indexes['users'].append(created)
    indexes['users_by_name'][_normalized_text(created.get('username') or user.username)] = created
    indexes['users_by_id'][str(_item_id(created))] = created
    report['actions'].append({'action': 'create_identity', 'resource': 'users', 'name': user.username, 'id': _item_id(created)})
    return created


def _create_missing_team(client, report, team, eda_org_id, indexes):
    payload = {'name': team.name, 'organization_id': eda_org_id, 'description': 'Managed by AWX RBAC sync'}
    try:
        created = client.create_resource('teams', payload)
    except EDAControllerError as exc:
        report['errors'].append({'action': 'create_team', 'name': team.name, 'detail': str(exc)})
        return None
    indexes['teams'].append(created)
    indexes['teams_by_key'][(str(eda_org_id), _normalized_text(team.name))] = created
    indexes['teams_by_key'][('', _normalized_text(team.name))] = created
    indexes['teams_by_id'][str(_item_id(created))] = created
    report['actions'].append({'action': 'create_identity', 'resource': 'teams', 'name': team.name, 'id': _item_id(created)})
    return created


def _direct_role_users(role):
    if not role:
        return models.User.objects.none()
    return role.members.order_by('username')


def _direct_role_teams(role, organization):
    if not role:
        return models.Team.objects.none()
    return models.Team.objects.filter(organization=organization, member_role__children=role).order_by('name')


def _desired_assignments_for_organization(client, report, org, indexes, *, mode, create_missing_identities):
    desired = {}
    eda_org = indexes['organizations_by_name'].get(_normalized_text(org.name))
    if not eda_org and mode in ('sync', 'enforce') and create_missing_identities:
        eda_org = _create_missing_organization(client, report, org, indexes)
    if not eda_org:
        _append_missing_identity(report, 'organizations', org.name, awx_organization_id=org.id)
        return desired
    eda_org_id = str(_item_id(eda_org) or '')

    for mapping in AWX_TO_EDA_ORG_ROLE_MAPPINGS:
        role = getattr(org, mapping['awx_role_field'], None)
        eda_role = _mapped_eda_role(indexes, mapping)
        if not eda_role:
            _append_missing_identity(
                report,
                'role_definitions',
                mapping['eda_role_name'],
                content_type=EDA_ORGANIZATION_CONTENT_TYPE,
                awx_role_field=mapping['awx_role_field'],
                aliases=list(mapping.get('eda_role_aliases') or []),
            )
            continue
        eda_role_id = str(_item_id(eda_role) or '')

        for user in _direct_role_users(role):
            eda_user = indexes['users_by_name'].get(_normalized_text(user.username))
            if not eda_user and mode in ('sync', 'enforce') and create_missing_identities:
                eda_user = _create_missing_user(client, report, user, indexes)
            if not eda_user:
                _append_missing_identity(report, 'users', user.username, awx_user_id=user.id)
                continue
            assignment = DesiredAssignment(
                actor_type='user',
                actor_id=user.id,
                actor_name=user.username,
                eda_actor_id=str(_item_id(eda_user) or ''),
                eda_actor_name=str(_item_name(eda_user) or user.username),
                awx_organization_id=org.id,
                awx_organization_name=org.name,
                eda_organization_id=eda_org_id,
                eda_organization_name=str(_item_name(eda_org) or org.name),
                awx_role_field=mapping['awx_role_field'],
                awx_role_label=mapping['awx_role_label'],
                eda_role_id=eda_role_id,
                eda_role_name=str(_item_name(eda_role) or mapping['eda_role_name']),
            )
            desired.setdefault(assignment.key, assignment)

        for team in _direct_role_teams(role, org):
            eda_team = indexes['teams_by_key'].get((eda_org_id, _normalized_text(team.name))) or indexes['teams_by_key'].get(('', _normalized_text(team.name)))
            if not eda_team and mode in ('sync', 'enforce') and create_missing_identities:
                eda_team = _create_missing_team(client, report, team, eda_org_id, indexes)
            if not eda_team:
                _append_missing_identity(report, 'teams', team.name, awx_team_id=team.id, awx_organization_name=org.name)
                continue
            assignment = DesiredAssignment(
                actor_type='team',
                actor_id=team.id,
                actor_name=team.name,
                eda_actor_id=str(_item_id(eda_team) or ''),
                eda_actor_name=str(_item_name(eda_team) or team.name),
                awx_organization_id=org.id,
                awx_organization_name=org.name,
                eda_organization_id=eda_org_id,
                eda_organization_name=str(_item_name(eda_org) or org.name),
                awx_role_field=mapping['awx_role_field'],
                awx_role_label=mapping['awx_role_label'],
                eda_role_id=eda_role_id,
                eda_role_name=str(_item_name(eda_role) or mapping['eda_role_name']),
            )
            desired.setdefault(assignment.key, assignment)
    return desired


def _current_assignment_index(indexes):
    current = {}
    for assignment in indexes['user_assignments']:
        key = _assignment_key(assignment, 'user')
        if all(key):
            current[key] = assignment
    for assignment in indexes['team_assignments']:
        key = _assignment_key(assignment, 'team')
        if all(key):
            current[key] = assignment
    return current


def _managed_actor_ids(indexes, organizations):
    eda_user_ids = set()
    eda_team_ids = set()
    usernames = set(models.User.objects.values_list('username', flat=True))
    for user in indexes['users']:
        if str(user.get('username') or '') in usernames:
            eda_user_ids.add(str(_item_id(user) or ''))
    for org in organizations:
        org_name = _normalized_text(org.name)
        eda_org = indexes['organizations_by_name'].get(org_name)
        eda_org_id = str(_item_id(eda_org) or '') if eda_org else ''
        for team in org.teams.all():
            eda_team = indexes['teams_by_key'].get((eda_org_id, _normalized_text(team.name))) or indexes['teams_by_key'].get(('', _normalized_text(team.name)))
            if eda_team:
                eda_team_ids.add(str(_item_id(eda_team) or ''))
    return {'user': eda_user_ids, 'team': eda_team_ids}


def _managed_extra_assignments(current, desired, indexes, managed_org_ids, managed_role_ids, managed_actor_ids):
    extras = []
    for key, assignment in current.items():
        actor_type, actor_id, role_id, content_type, object_id = key
        if content_type != EDA_ORGANIZATION_CONTENT_TYPE:
            continue
        if object_id not in managed_org_ids or role_id not in managed_role_ids:
            continue
        if actor_id not in managed_actor_ids.get(actor_type, set()):
            continue
        if key in desired:
            continue
        row = _assignment_dict(assignment, actor_type, indexes)
        extras.append(row)
    return extras


def _assignment_payload(assignment):
    actor_key = assignment.actor_type
    return {
        actor_key: int(assignment.eda_actor_id),
        'role_definition': int(assignment.eda_role_id),
        'content_type': assignment.content_type,
        'object_id': int(assignment.eda_organization_id),
    }


def build_eda_rbac_sync_report(user=None, *, mode='observe', create_missing_identities=True):
    mode = str(mode or 'observe').strip().lower()
    if mode not in EDA_RBAC_SYNC_MODES:
        raise EDAControllerError('EDA RBAC sync mode is invalid.', 'invalid')

    client = EDAControllerClient()
    report = {
        'source': 'eda_controller' if client.is_configured else 'not_configured',
        'mode': mode,
        'create_missing_identities': bool(create_missing_identities),
        'managed_content_type': EDA_ORGANIZATION_CONTENT_TYPE,
        'managed_role_mappings': list(AWX_TO_EDA_ORG_ROLE_MAPPINGS),
        'summary': {},
        'desired_assignments': [],
        'missing_identities': {'organizations': [], 'users': [], 'teams': [], 'role_definitions': []},
        'missing_assignments': [],
        'extra_assignments': [],
        'actions': [],
        'errors': [],
    }
    if not client.is_configured:
        report['summary'] = {
            'awx_organizations': 0,
            'desired_assignments': 0,
            'current_assignments': 0,
            'missing_assignments': 0,
            'extra_assignments': 0,
            'actions': 0,
            'errors': 0,
        }
        return report

    indexes = _eda_indexes(client)
    organizations = list(_accessible_sync_organizations(user).prefetch_related('teams'))
    desired = {}
    for org in organizations:
        desired.update(
            _desired_assignments_for_organization(
                client,
                report,
                org,
                indexes,
                mode=mode,
                create_missing_identities=create_missing_identities,
            )
        )

    current = _current_assignment_index(indexes)
    missing_keys = [key for key in desired if key not in current]
    for key in missing_keys:
        assignment = desired[key]
        report['missing_assignments'].append(assignment.as_dict())
        if mode in ('sync', 'enforce'):
            resource = f'{assignment.actor_type}-role-assignments'
            try:
                created = client.create_resource(resource, _assignment_payload(assignment))
                report['actions'].append(
                    {
                        'action': 'create_assignment',
                        'resource': resource,
                        'id': _item_id(created),
                        'actor_type': assignment.actor_type,
                        'actor_name': assignment.actor_name,
                        'eda_role_name': assignment.eda_role_name,
                        'eda_organization_name': assignment.eda_organization_name,
                    }
                )
            except EDAControllerError as exc:
                report['errors'].append({'action': 'create_assignment', 'assignment': assignment.as_dict(), 'detail': str(exc)})

    managed_org_ids = {
        str(_item_id(indexes['organizations_by_name'].get(_normalized_text(org.name))) or '')
        for org in organizations
        if indexes['organizations_by_name'].get(_normalized_text(org.name))
    }
    managed_role_ids = set()
    for mapping in AWX_TO_EDA_ORG_ROLE_MAPPINGS:
        eda_role = _mapped_eda_role(indexes, mapping)
        if eda_role:
            managed_role_ids.add(str(_item_id(eda_role) or ''))
    managed_actor_ids = _managed_actor_ids(indexes, organizations)
    extras = _managed_extra_assignments(current, desired, indexes, managed_org_ids, managed_role_ids, managed_actor_ids)
    report['extra_assignments'] = extras
    if mode == 'enforce':
        for extra in extras:
            resource = f"{extra['actor_type']}-role-assignments"
            try:
                client.delete_resource(resource, extra['id'])
                report['actions'].append(
                    {
                        'action': 'delete_assignment',
                        'resource': resource,
                        'id': extra['id'],
                        'actor_type': extra['actor_type'],
                        'actor_name': extra['eda_actor_name'],
                        'eda_role_name': extra['eda_role_name'],
                        'eda_organization_name': extra['eda_organization_name'],
                    }
                )
            except EDAControllerError as exc:
                report['errors'].append({'action': 'delete_assignment', 'assignment': extra, 'detail': str(exc)})

    report['desired_assignments'] = [assignment.as_dict() for assignment in desired.values()]
    report['summary'] = {
        'awx_organizations': len(organizations),
        'desired_assignments': len(desired),
        'current_assignments': len(current),
        'missing_assignments': len(report['missing_assignments']),
        'extra_assignments': len(report['extra_assignments']),
        'missing_identities': sum(len(value) for value in report['missing_identities'].values()),
        'actions': len(report['actions']),
        'errors': len(report['errors']),
    }
    return report
