import json
import re
import shlex
from collections import OrderedDict

SENSITIVE_KEY_PARTS = ('password', 'secret', 'token', 'credential', 'private_key')


def _coerce_sample_limit(value):
    try:
        sample_limit = int(value)
    except (TypeError, ValueError):
        sample_limit = 50
    return max(1, min(sample_limit, 200))


def _safe_name(value, default='resource'):
    text = str(value or '').strip()
    text = re.sub(r'\s+', '_', text)
    text = re.sub(r'[^A-Za-z0-9_.-]+', '_', text)
    text = text.strip('_.-')
    if not text:
        text = default
    if text[0].isdigit():
        text = f'{default}_{text}'
    return text[:128]


def _safe_group_name(value, default='cloud_resources'):
    return _safe_name(value, default).replace('.', '_').replace('-', '_').lower()


def _safe_var_name(value):
    name = re.sub(r'[^A-Za-z0-9_]+', '_', str(value or '')).strip('_').lower()
    return name or 'value'


def _is_sensitive_key(key):
    normalized = str(key or '').lower()
    return any(part in normalized for part in SENSITIVE_KEY_PARTS)


def _scalar_to_string(value):
    if value is None:
        return ''
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (list, dict)):
        return json.dumps(value, sort_keys=True)
    return str(value)


def _clean_variables(values):
    cleaned = OrderedDict()
    for key, value in values.items():
        if _is_sensitive_key(key):
            continue
        name = _safe_var_name(key)
        text = _scalar_to_string(value)
        if len(text) > 500:
            text = text[:497] + '...'
        cleaned[name] = text
    return dict(cleaned)


def _resource(kind, groups, name, variables, connection_id=None):
    safe_kind = _safe_group_name(kind, 'resource')
    safe_name = _safe_name(name, safe_kind)
    resource_name = _safe_name(f'{safe_kind}_{safe_name}', safe_kind)
    vars_with_kind = OrderedDict()
    vars_with_kind['resource_kind'] = safe_kind
    if connection_id:
        vars_with_kind['cloud_connection_id'] = str(connection_id)
    vars_with_kind.update(variables)
    return {
        'kind': safe_kind,
        'name': resource_name,
        'groups': [_safe_group_name(group) for group in groups if group],
        'variables': _clean_variables(vars_with_kind),
    }


def _provider_payload_keys(provider_id):
    return {
        'digitalocean': ('images', 'pricing', 'regions', 'vpcs'),
        'proxmox': ('nodes', 'vms', 'containers', 'templates', 'storage', 'networks'),
        'vmware': ('datacenters', 'clusters', 'hosts', 'vms', 'networks', 'datastores'),
        'azure': ('resource_groups', 'vms', 'vnets', 'storage_accounts', 'locations', 'vm_images', 'vm_sizes'),
    }.get(provider_id, ())


def _iter_provider_payloads(provider_id, provider_data, connection_id=None):
    if not isinstance(provider_data, dict):
        return

    requested_connection = str(connection_id) if connection_id not in (None, '') else None
    payload_keys = _provider_payload_keys(provider_id)
    is_direct_payload = any(key in provider_data for key in payload_keys)

    if is_direct_payload:
        payload_connection = provider_data.get('connection_id')
        if requested_connection and payload_connection and str(payload_connection) != requested_connection:
            return
        yield str(payload_connection or requested_connection or ''), provider_data
        return

    for key, value in provider_data.items():
        if not isinstance(value, dict):
            continue
        if requested_connection and str(key) != requested_connection:
            continue
        yield str(key), value


def _collect_digitalocean_resources(data, connection_id):
    resources = []
    for region in data.get('regions') or []:
        if not isinstance(region, dict):
            continue
        slug = region.get('slug') or region.get('name')
        resources.append(
            _resource(
                'region',
                ['digitalocean_regions'],
                slug,
                {
                    'cloud_provider': 'digitalocean',
                    'region_slug': slug,
                    'region_name': region.get('name'),
                    'available': region.get('available'),
                    'features': region.get('features'),
                },
                connection_id,
            )
        )

    for vpc in data.get('vpcs') or []:
        if not isinstance(vpc, dict):
            continue
        region = vpc.get('region')
        groups = ['digitalocean_vpcs']
        if region:
            groups.append(f'digitalocean_region_{region}')
        resources.append(
            _resource(
                'vpc',
                groups,
                vpc.get('name') or vpc.get('id'),
                {
                    'cloud_provider': 'digitalocean',
                    'cloud_id': vpc.get('id'),
                    'region': region,
                    'ip_range': vpc.get('ip_range'),
                    'default': vpc.get('default'),
                    'created_at': vpc.get('created_at'),
                    'ansible_connection': 'local',
                },
                connection_id,
            )
        )

    for image in data.get('images') or []:
        if not isinstance(image, dict):
            continue
        resources.append(
            _resource(
                'image',
                ['digitalocean_images'],
                image.get('slug') or image.get('name') or image.get('id'),
                {
                    'cloud_provider': 'digitalocean',
                    'cloud_id': image.get('id') or image.get('slug'),
                    'image_name': image.get('name'),
                    'distribution': image.get('distribution'),
                    'image_type': image.get('type'),
                    'status': image.get('status'),
                    'private': image.get('private'),
                    'regions': image.get('regions'),
                    'ansible_connection': 'local',
                },
                connection_id,
            )
        )

    for size in data.get('pricing') or []:
        if not isinstance(size, dict):
            continue
        resources.append(
            _resource(
                'size',
                ['digitalocean_sizes'],
                size.get('slug'),
                {
                    'cloud_provider': 'digitalocean',
                    'size_slug': size.get('slug'),
                    'vcpus': size.get('vcpus'),
                    'memory_mb': size.get('memory_mb') or size.get('memory'),
                    'disk_gb': size.get('disk_gb') or size.get('disk'),
                    'price_monthly': size.get('price_monthly'),
                    'price_hourly': size.get('price_hourly'),
                    'regions': size.get('regions'),
                    'ansible_connection': 'local',
                },
                connection_id,
            )
        )
    return resources


def _collect_proxmox_resources(data, connection_id):
    resources = []
    for node in data.get('nodes') or []:
        if not isinstance(node, dict):
            continue
        resources.append(
            _resource(
                'node',
                ['proxmox_nodes'],
                node.get('node'),
                {
                    'cloud_provider': 'proxmox',
                    'proxmox_node': node.get('node'),
                    'status': node.get('status'),
                    'maxcpu': node.get('maxcpu'),
                    'maxmem': node.get('maxmem'),
                    'maxdisk': node.get('maxdisk'),
                    'ansible_connection': 'local',
                },
                connection_id,
            )
        )

    for vm in data.get('vms') or []:
        if not isinstance(vm, dict):
            continue
        node = vm.get('node')
        status = vm.get('status')
        groups = ['proxmox_vms']
        if node:
            groups.append(f'proxmox_node_{node}')
        if status:
            groups.append(f'proxmox_status_{status}')
        resources.append(
            _resource(
                'vm',
                groups,
                vm.get('name') or vm.get('vmid'),
                {
                    'cloud_provider': 'proxmox',
                    'proxmox_vmid': vm.get('vmid'),
                    'proxmox_node': node,
                    'status': status,
                    'cpus': vm.get('cpus'),
                    'memory_bytes': vm.get('maxmem'),
                    'disk_bytes': vm.get('maxdisk'),
                    'ansible_connection': 'local',
                },
                connection_id,
            )
        )

    for container in data.get('containers') or []:
        if not isinstance(container, dict):
            continue
        node = container.get('node')
        groups = ['proxmox_containers']
        if node:
            groups.append(f'proxmox_node_{node}')
        resources.append(
            _resource(
                'container',
                groups,
                container.get('name') or container.get('vmid'),
                {
                    'cloud_provider': 'proxmox',
                    'proxmox_vmid': container.get('vmid'),
                    'proxmox_node': node,
                    'status': container.get('status'),
                    'cpus': container.get('cpus'),
                    'memory_bytes': container.get('maxmem'),
                    'disk_bytes': container.get('maxdisk'),
                    'ansible_connection': 'local',
                },
                connection_id,
            )
        )

    for template in data.get('templates') or []:
        if not isinstance(template, dict):
            continue
        resources.append(
            _resource(
                'template',
                ['proxmox_templates'],
                template.get('name') or template.get('vmid'),
                {
                    'cloud_provider': 'proxmox',
                    'proxmox_vmid': template.get('vmid'),
                    'proxmox_node': template.get('node'),
                    'status': template.get('status'),
                    'ansible_connection': 'local',
                },
                connection_id,
            )
        )
    return resources


def _collect_vmware_resources(data, connection_id):
    resources = []
    clusters_by_id = {cluster.get('id'): cluster.get('name') for cluster in data.get('clusters') or [] if isinstance(cluster, dict)}

    for datacenter in data.get('datacenters') or []:
        if not isinstance(datacenter, dict):
            continue
        resources.append(
            _resource(
                'datacenter',
                ['vmware_datacenters'],
                datacenter.get('name') or datacenter.get('id'),
                {
                    'cloud_provider': 'vmware',
                    'cloud_id': datacenter.get('id'),
                    'datacenter_name': datacenter.get('name'),
                    'cluster_count': datacenter.get('cluster_count'),
                    'host_count': datacenter.get('host_count'),
                    'datastore_count': datacenter.get('datastore_count'),
                    'network_count': datacenter.get('network_count'),
                    'ansible_connection': 'local',
                },
                connection_id,
            )
        )

    for cluster in data.get('clusters') or []:
        if not isinstance(cluster, dict):
            continue
        resources.append(
            _resource(
                'cluster',
                ['vmware_clusters'],
                cluster.get('name') or cluster.get('id'),
                {
                    'cloud_provider': 'vmware',
                    'cloud_id': cluster.get('id'),
                    'cluster_name': cluster.get('name'),
                    'datacenter_id': cluster.get('datacenter_id'),
                    'ha_enabled': cluster.get('ha_enabled'),
                    'drs_enabled': cluster.get('drs_enabled'),
                    'host_count': cluster.get('host_count'),
                    'ansible_connection': 'local',
                },
                connection_id,
            )
        )

    for host in data.get('hosts') or []:
        if not isinstance(host, dict):
            continue
        cluster_name = clusters_by_id.get(host.get('cluster_id')) or host.get('cluster_id')
        groups = ['vmware_hosts']
        if cluster_name:
            groups.append(f'vmware_cluster_{cluster_name}')
        resources.append(
            _resource(
                'host',
                groups,
                host.get('name') or host.get('id'),
                {
                    'cloud_provider': 'vmware',
                    'cloud_id': host.get('id'),
                    'cluster_id': host.get('cluster_id'),
                    'power_state': host.get('power_state'),
                    'connection_state': host.get('connection_state'),
                    'cpu_count': host.get('cpu_count'),
                    'memory_size_mib': host.get('memory_size_mib'),
                    'vm_count': host.get('vm_count'),
                    'ansible_connection': 'local',
                },
                connection_id,
            )
        )

    for vm in data.get('vms') or []:
        if not isinstance(vm, dict):
            continue
        groups = ['vmware_vms']
        if vm.get('host_id'):
            groups.append(f'vmware_host_{vm.get("host_id")}')
        if vm.get('cluster_id'):
            cluster_name = clusters_by_id.get(vm.get('cluster_id')) or vm.get('cluster_id')
            groups.append(f'vmware_cluster_{cluster_name}')
        resources.append(
            _resource(
                'vm',
                groups,
                vm.get('name') or vm.get('id'),
                {
                    'cloud_provider': 'vmware',
                    'cloud_id': vm.get('id'),
                    'host_id': vm.get('host_id'),
                    'cluster_id': vm.get('cluster_id'),
                    'power_state': vm.get('power_state'),
                    'cpu_count': vm.get('cpu_count'),
                    'memory_size_mib': vm.get('memory_size_mib'),
                    'guest_os': vm.get('guest_os'),
                    'guest_full_name': vm.get('guest_full_name'),
                    'guest_hostname': vm.get('guest_hostname'),
                    'ip_address': vm.get('ip_address'),
                    'hardware_version': vm.get('hardware_version'),
                    'cpu_cores_per_socket': vm.get('cpu_cores_per_socket'),
                    'cpu_hot_add_enabled': vm.get('cpu_hot_add_enabled'),
                    'memory_hot_add_enabled': vm.get('memory_hot_add_enabled'),
                    'disk_count': vm.get('disk_count'),
                    'disk_capacity_bytes': vm.get('disk_capacity_bytes'),
                    'datastore_names': vm.get('datastore_names'),
                    'nics_count': vm.get('nics_count'),
                    'cdrom_count': vm.get('cdrom_count'),
                    'ansible_connection': 'local',
                },
                connection_id,
            )
        )

    for network in data.get('networks') or []:
        if not isinstance(network, dict):
            continue
        groups = ['vmware_networks']
        if network.get('datacenter_id'):
            groups.append(f'vmware_datacenter_{network.get("datacenter_id")}')
        resources.append(
            _resource(
                'network',
                groups,
                network.get('name') or network.get('id'),
                {
                    'cloud_provider': 'vmware',
                    'cloud_id': network.get('id'),
                    'network_name': network.get('name'),
                    'network_type': network.get('type'),
                    'datacenter_id': network.get('datacenter_id'),
                    'ansible_connection': 'local',
                },
                connection_id,
            )
        )

    for datastore in data.get('datastores') or []:
        if not isinstance(datastore, dict):
            continue
        groups = ['vmware_datastores']
        if datastore.get('datacenter_id'):
            groups.append(f'vmware_datacenter_{datastore.get("datacenter_id")}')
        resources.append(
            _resource(
                'datastore',
                groups,
                datastore.get('name') or datastore.get('id'),
                {
                    'cloud_provider': 'vmware',
                    'cloud_id': datastore.get('id'),
                    'datastore_name': datastore.get('name'),
                    'datastore_type': datastore.get('type'),
                    'capacity_mb': datastore.get('capacity_mb'),
                    'free_space_mb': datastore.get('free_space_mb'),
                    'accessible': datastore.get('accessible'),
                    'datacenter_id': datastore.get('datacenter_id'),
                    'ansible_connection': 'local',
                },
                connection_id,
            )
        )
    return resources


def _collect_azure_resources(data, connection_id):
    resources = []
    for group in data.get('resource_groups') or []:
        if not isinstance(group, dict):
            continue
        location = group.get('location')
        groups = ['azure_resource_groups']
        if location:
            groups.append(f'azure_region_{location}')
        resources.append(
            _resource(
                'resource_group',
                groups,
                group.get('name') or group.get('id'),
                {
                    'cloud_provider': 'azure',
                    'cloud_id': group.get('id'),
                    'resource_group': group.get('name'),
                    'location': location,
                    'provisioning_state': group.get('provisioning_state'),
                    'tags': group.get('tags'),
                    'ansible_connection': 'local',
                },
                connection_id,
            )
        )

    for vm in data.get('vms') or []:
        if not isinstance(vm, dict):
            continue
        location = vm.get('location')
        resource_group = vm.get('resource_group')
        groups = ['azure_vms']
        if location:
            groups.append(f'azure_region_{location}')
        if resource_group:
            groups.append(f'azure_resource_group_{resource_group}')
        resources.append(
            _resource(
                'vm',
                groups,
                vm.get('name') or vm.get('id'),
                {
                    'cloud_provider': 'azure',
                    'cloud_id': vm.get('id'),
                    'resource_group': resource_group,
                    'location': location,
                    'vm_size': vm.get('vm_size'),
                    'os_type': vm.get('os_type'),
                    'power_state': vm.get('power_state'),
                    'provisioning_state': vm.get('provisioning_state'),
                    'tags': vm.get('tags'),
                    'ansible_connection': 'local',
                },
                connection_id,
            )
        )

    for vnet in data.get('vnets') or []:
        if not isinstance(vnet, dict):
            continue
        location = vnet.get('location')
        groups = ['azure_virtual_networks']
        if location:
            groups.append(f'azure_region_{location}')
        resources.append(
            _resource(
                'vnet',
                groups,
                vnet.get('name') or vnet.get('id'),
                {
                    'cloud_provider': 'azure',
                    'cloud_id': vnet.get('id'),
                    'resource_group': vnet.get('resource_group'),
                    'location': location,
                    'address_space': vnet.get('address_space'),
                    'provisioning_state': vnet.get('provisioning_state'),
                    'ansible_connection': 'local',
                },
                connection_id,
            )
        )

    for account in data.get('storage_accounts') or []:
        if not isinstance(account, dict):
            continue
        location = account.get('location')
        groups = ['azure_storage_accounts']
        if location:
            groups.append(f'azure_region_{location}')
        resources.append(
            _resource(
                'storage_account',
                groups,
                account.get('name') or account.get('id'),
                {
                    'cloud_provider': 'azure',
                    'cloud_id': account.get('id'),
                    'resource_group': account.get('resource_group'),
                    'location': location,
                    'kind': account.get('kind'),
                    'sku': account.get('sku'),
                    'provisioning_state': account.get('provisioning_state'),
                    'ansible_connection': 'local',
                },
                connection_id,
            )
        )
    return resources


def collect_cloud_inventory_resources(provider_id, provider_data, connection_id=None, sample_limit=50):
    sample_limit = _coerce_sample_limit(sample_limit)
    collectors = {
        'digitalocean': _collect_digitalocean_resources,
        'proxmox': _collect_proxmox_resources,
        'vmware': _collect_vmware_resources,
        'azure': _collect_azure_resources,
    }
    collector = collectors.get(provider_id)
    if collector is None:
        return []

    resources = []
    for payload_connection_id, payload in _iter_provider_payloads(provider_id, provider_data, connection_id):
        resources.extend(collector(payload, payload_connection_id))
        if len(resources) >= sample_limit:
            break
    return resources[:sample_limit]


def _ensure_group(groups_by_name, name):
    if name not in groups_by_name:
        groups_by_name[name] = {
            'name': name,
            'variables': {},
            'hosts': [],
            'children': [],
        }
    return groups_by_name[name]


def _upsert_host(hosts, host):
    for existing in hosts:
        if existing['name'] == host['name']:
            existing['variables'].update(host.get('variables') or {})
            return existing
    hosts.append(host)
    return host


def _quote_inventory_value(value):
    text = _scalar_to_string(value)
    if text == '':
        return '""'
    if re.search(r'[\s#;="\']', text):
        return json.dumps(text)
    return text


def render_inventory_source(plan):
    lines = ['[all:vars]']
    for key, value in plan.get('variables', {}).items():
        lines.append(f'{key}={_quote_inventory_value(value)}')
    lines.append('')

    for group in plan.get('groups', []):
        children = group.get('children') or []
        if children:
            lines.append(f'[{group["name"]}:children]')
            lines.extend(children)
            lines.append('')

        hosts = group.get('hosts') or []
        if hosts:
            lines.append(f'[{group["name"]}]')
            for host in hosts:
                variables = host.get('variables') or {}
                rendered_vars = ' '.join(f'{key}={_quote_inventory_value(value)}' for key, value in variables.items())
                lines.append(f'{host["name"]} {rendered_vars}'.rstrip())
            lines.append('')

        variables = group.get('variables') or {}
        if variables:
            lines.append(f'[{group["name"]}:vars]')
            for key, value in variables.items():
                lines.append(f'{key}={_quote_inventory_value(value)}')
            lines.append('')

    return '\n'.join(lines).strip() + '\n'


def build_cloud_inventory_suggestion(provider_id, provider_data, organization_id=None, connection_id=None, sample_limit=50):
    resources = collect_cloud_inventory_resources(provider_id, provider_data, connection_id, sample_limit)
    root_group_name = _safe_group_name(f'cloud_{provider_id}', 'cloud_resources')
    groups_by_name = OrderedDict()
    _ensure_group(groups_by_name, root_group_name)

    host_names = set()
    plan_hosts = []
    resource_counts = OrderedDict()

    for resource in resources:
        resource_counts[resource['kind']] = resource_counts.get(resource['kind'], 0) + 1
        host_name = resource['name']
        if host_name in host_names:
            suffix = 2
            while f'{host_name}_{suffix}' in host_names:
                suffix += 1
            host_name = f'{host_name}_{suffix}'
        host_names.add(host_name)
        host = {'name': host_name, 'variables': resource['variables']}
        _upsert_host(plan_hosts, host)

        for group_name in resource['groups']:
            group = _ensure_group(groups_by_name, group_name)
            _upsert_host(group['hosts'], host)
            root = _ensure_group(groups_by_name, root_group_name)
            if group_name != root_group_name and group_name not in root['children']:
                root['children'].append(group_name)

    variables = OrderedDict()
    variables['cloud_provider'] = provider_id
    variables['cloud_inventory_source'] = 'cloud_provider_state'
    if organization_id is not None:
        variables['cloud_organization_id'] = str(organization_id)
    if connection_id not in (None, ''):
        variables['cloud_connection_scope'] = str(connection_id)
    else:
        variables['cloud_connection_scope'] = 'all'

    plan = {
        'source': '',
        'variables': dict(variables),
        'hosts': plan_hosts,
        'groups': list(groups_by_name.values()),
    }
    plan['source'] = render_inventory_source(plan)
    return plan, dict(resource_counts), resources


def _split_inventory_line(line):
    try:
        return shlex.split(line)
    except ValueError:
        return line.split()


def _parse_key_value(token):
    if '=' not in token:
        return None
    key, value = token.split('=', 1)
    key = key.strip()
    if not key:
        return None
    return key, value.strip().strip('"').strip("'")


def _parse_variable_line(line):
    parsed = _parse_key_value(line)
    if parsed:
        return parsed
    if ':' not in line:
        return None
    key, value = line.split(':', 1)
    key = key.strip()
    if not key:
        return None
    return key, value.strip().strip('"').strip("'")


def _parse_host_line(line):
    tokens = _split_inventory_line(line)
    if not tokens or '=' in tokens[0]:
        return None
    variables = OrderedDict()
    for token in tokens[1:]:
        parsed = _parse_key_value(token)
        if parsed:
            variables[parsed[0]] = parsed[1]
    return {'name': tokens[0].strip('"').strip("'"), 'variables': dict(variables)}


def parse_inventory_source(source):
    groups_by_name = OrderedDict()
    plan = {
        'source': (source or '').strip(),
        'variables': {},
        'hosts': [],
        'groups': [],
    }
    current_section = None

    for raw_line in (source or '').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or line.startswith(';'):
            continue

        section = re.match(r'^\[([^\]]+)\]$', line)
        if section:
            name, modifier = (section.group(1).split(':', 1) + [''])[:2]
            name = name.strip()
            modifier = modifier.strip()
            if not name:
                current_section = None
                continue
            if modifier == 'vars':
                current_section = {'name': name, 'type': 'vars'}
                if name != 'all':
                    _ensure_group(groups_by_name, name)
            elif modifier == 'children':
                current_section = {'name': name, 'type': 'children'}
                _ensure_group(groups_by_name, name)
            else:
                current_section = {'name': name, 'type': 'hosts'}
                if name not in ('all', 'ungrouped'):
                    _ensure_group(groups_by_name, name)
            continue

        if current_section is None:
            host = _parse_host_line(line)
            if host:
                _upsert_host(plan['hosts'], host)
            continue

        if current_section['type'] == 'vars':
            parsed = _parse_variable_line(line)
            if not parsed:
                continue
            if current_section['name'] == 'all':
                plan['variables'][parsed[0]] = parsed[1]
            else:
                _ensure_group(groups_by_name, current_section['name'])['variables'][parsed[0]] = parsed[1]
            continue

        if current_section['type'] == 'children':
            child_name = line.split()[0].strip()
            if child_name:
                group = _ensure_group(groups_by_name, current_section['name'])
                if child_name not in group['children']:
                    group['children'].append(child_name)
                _ensure_group(groups_by_name, child_name)
            continue

        host = _parse_host_line(line)
        if not host:
            continue
        if current_section['name'] in ('all', 'ungrouped'):
            _upsert_host(plan['hosts'], host)
        else:
            _upsert_host(_ensure_group(groups_by_name, current_section['name'])['hosts'], host)
            _upsert_host(plan['hosts'], host)

    plan['groups'] = list(groups_by_name.values())
    return plan


def count_inventory_plan_hosts(plan):
    names = {host['name'] for host in plan.get('hosts') or []}
    for group in plan.get('groups') or []:
        names.update(host['name'] for host in group.get('hosts') or [])
    return len(names)
