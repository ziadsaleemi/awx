"""
Marketplace template ingestion API (E14).

Endpoints:
  GET  /api/v2/marketplace/templates/  — list available cloud images/templates
                                          from connected providers, grouped by provider.
  POST /api/v2/marketplace/ingest/     — create a CatalogItem from a marketplace entry.
"""

import logging

from django.utils.text import slugify

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from awx.main.models import CatalogItem, CloudProviderState, Organization, WorkflowJobTemplate
from awx.main.models.terraform import TerraformJobTemplate

logger = logging.getLogger('awx.api.views.marketplace')

# ---------------------------------------------------------------------------
# Provider-specific helpers
# ---------------------------------------------------------------------------
# Dynamic helpers normalize already-pulled CloudProviderState payloads into
# {id, name, provider, type, description, region, metadata} marketplace entries.
# ---------------------------------------------------------------------------

PROVIDER_CATALOG = {
    'digitalocean': [
        {
            'id': 'do-ubuntu-22-04-x64',
            'name': 'Ubuntu 22.04 LTS (x64)',
            'provider': 'digitalocean',
            'type': 'image',
            'description': 'Official Canonical Ubuntu 22.04 LTS droplet image.',
            'region': 'nyc3',
            'metadata': {'slug': 'ubuntu-22-04-x64', 'distribution': 'Ubuntu', 'min_disk_size': 25},
        },
        {
            'id': 'do-fedora-39-x64',
            'name': 'Fedora 39 (x64)',
            'provider': 'digitalocean',
            'type': 'image',
            'description': 'Official Fedora 39 droplet image.',
            'region': 'nyc3',
            'metadata': {'slug': 'fedora-39-x64', 'distribution': 'Fedora', 'min_disk_size': 20},
        },
        {
            'id': 'do-marketplace-lamp',
            'name': 'LAMP on Ubuntu 22.04',
            'provider': 'digitalocean',
            'type': 'marketplace',
            'description': '1-Click LAMP stack (Apache, MySQL, PHP) on Ubuntu 22.04.',
            'region': 'nyc3',
            'metadata': {'slug': 'lamp', 'category': 'infrastructure'},
        },
        {
            'id': 'do-marketplace-k8s',
            'name': 'Kubernetes on Ubuntu 22.04',
            'provider': 'digitalocean',
            'type': 'marketplace',
            'description': '1-Click Kubernetes cluster setup on Ubuntu 22.04.',
            'region': 'nyc3',
            'metadata': {'slug': 'kubernetes', 'category': 'kubernetes'},
        },
    ],
    'azure': [
        {
            'id': 'azure-ubuntu-22-lts',
            'name': 'Ubuntu Server 22.04 LTS',
            'provider': 'azure',
            'type': 'image',
            'description': 'Canonical Ubuntu Server 22.04 LTS from Azure Marketplace.',
            'region': 'eastus',
            'metadata': {
                'publisher': 'Canonical',
                'offer': '0001-com-ubuntu-server-jammy',
                'sku': '22_04-lts',
            },
        },
        {
            'id': 'azure-rhel-9-lvm',
            'name': 'Red Hat Enterprise Linux 9 LVM',
            'provider': 'azure',
            'type': 'image',
            'description': 'RHEL 9 with LVM from Azure Marketplace.',
            'region': 'eastus',
            'metadata': {'publisher': 'RedHat', 'offer': 'RHEL', 'sku': '9-lvm'},
        },
        {
            'id': 'azure-marketplace-nginx',
            'name': 'NGINX Plus',
            'provider': 'azure',
            'type': 'marketplace',
            'description': 'NGINX Plus on Ubuntu 20.04 LTS (Bitnami).',
            'region': 'eastus',
            'metadata': {'publisher': 'bitnami', 'product_id': 'nginxplus'},
        },
    ],
    'aws': [
        {
            'id': 'aws-ami-ubuntu-22-04',
            'name': 'Ubuntu 22.04 LTS (Jammy) - HVM x86_64',
            'provider': 'aws',
            'type': 'ami',
            'description': 'Official Canonical Ubuntu 22.04 LTS HVM AMI.',
            'region': 'us-east-1',
            'metadata': {'ami_id': 'ami-0c7217cdde317cfec', 'architecture': 'x86_64', 'virtualization': 'hvm'},
        },
        {
            'id': 'aws-ami-amazon-linux-2023',
            'name': 'Amazon Linux 2023 AMI',
            'provider': 'aws',
            'type': 'ami',
            'description': 'AWS-maintained Amazon Linux 2023.',
            'region': 'us-east-1',
            'metadata': {'ami_id': 'ami-0604d81f2fd264c7b', 'architecture': 'x86_64'},
        },
        {
            'id': 'aws-marketplace-wordpress',
            'name': 'WordPress Certified by Bitnami',
            'provider': 'aws',
            'type': 'marketplace',
            'description': 'WordPress 6.4 with Bitnami AMI from AWS Marketplace.',
            'region': 'us-east-1',
            'metadata': {'product_id': '2zex6ol8-iu0ds7b8-8rmjy22u-43xzs2ae', 'vendor': 'bitnami'},
        },
    ],
    'proxmox': [
        {
            'id': 'proxmox-tpl-ubuntu-2204',
            'name': 'Ubuntu 22.04 LTS Cloud-Init',
            'provider': 'proxmox',
            'type': 'template',
            'description': 'Ubuntu 22.04 LTS cloud-init-ready VM template.',
            'region': 'local',
            'metadata': {'vmid': 9000, 'node': 'pve'},
        },
        {
            'id': 'proxmox-tpl-debian-12',
            'name': 'Debian 12 Cloud-Init',
            'provider': 'proxmox',
            'type': 'template',
            'description': 'Debian 12 (Bookworm) cloud-init-ready VM template.',
            'region': 'local',
            'metadata': {'vmid': 9001, 'node': 'pve'},
        },
    ],
    'gcp': [
        {
            'id': 'gcp-ubuntu-2204-jammy',
            'name': 'Ubuntu 22.04 LTS (Jammy)',
            'provider': 'gcp',
            'type': 'image',
            'description': 'Canonical Ubuntu 22.04 LTS public image.',
            'region': 'us-central1',
            'metadata': {'image_family': 'ubuntu-2204-lts', 'project': 'ubuntu-os-cloud'},
        },
        {
            'id': 'gcp-debian-12-bookworm',
            'name': 'Debian 12 (Bookworm)',
            'provider': 'gcp',
            'type': 'image',
            'description': 'Google-maintained Debian 12 image.',
            'region': 'us-central1',
            'metadata': {'image_family': 'debian-12', 'project': 'debian-cloud'},
        },
    ],
    'vmware': [
        {
            'id': 'vmware-tpl-rhel9',
            'name': 'RHEL 9 VMware Template',
            'provider': 'vmware',
            'type': 'template',
            'description': 'Red Hat Enterprise Linux 9 vSphere template.',
            'region': 'datacenter-1',
            'metadata': {'datastore': 'datastore1', 'guest_id': 'rhel9_64Guest'},
        },
        {
            'id': 'vmware-tpl-windows2022',
            'name': 'Windows Server 2022',
            'provider': 'vmware',
            'type': 'template',
            'description': 'Windows Server 2022 Datacenter vSphere template.',
            'region': 'datacenter-1',
            'metadata': {'datastore': 'datastore1', 'guest_id': 'windows2019srvNext_64Guest'},
        },
    ],
}

PROVIDER_LABELS = {
    'digitalocean': 'DigitalOcean',
    'azure': 'Microsoft Azure',
    'aws': 'Amazon AWS',
    'proxmox': 'Proxmox VE',
    'gcp': 'Google Cloud',
    'vmware': 'VMware vSphere',
}

STATE_TEMPLATE_KEYS = ('images', 'vm_images', 'templates', 'vms')


def _string_set(value):
    if value is None:
        return None
    if not isinstance(value, (list, tuple, set)):
        return set()
    return {str(item) for item in value}


def _is_allowed(value, allowed_values):
    return allowed_values is None or str(value) in allowed_values


def _entry_slug(value):
    slug = slugify(str(value or ''))
    return slug or 'template'


def _provider_data_payloads(provider_data):
    if not isinstance(provider_data, dict):
        return

    if any(isinstance(provider_data.get(key), list) for key in STATE_TEMPLATE_KEYS):
        yield provider_data

    # Proxmox, VMware, and Azure store org state keyed by connection id.
    for value in provider_data.values():
        if isinstance(value, dict) and any(isinstance(value.get(key), list) for key in STATE_TEMPLATE_KEYS):
            yield value


def _template_regions(image, allowed_regions):
    regions = image.get('regions') if isinstance(image.get('regions'), list) else []
    if allowed_regions is not None:
        regions = [region for region in regions if str(region) in allowed_regions]
    return regions


def _digitalocean_entries_from_payload(state, payload):
    admin_settings = state.admin_settings if isinstance(state.admin_settings, dict) else {}
    allowed_image_ids = _string_set(admin_settings.get('allowedImageIds'))
    allowed_regions = _string_set(admin_settings.get('allowedRegionSlugs'))

    for image in payload.get('images') or []:
        if not isinstance(image, dict):
            continue
        image_id = image.get('id') or image.get('slug') or image.get('name')
        if not image_id or not _is_allowed(image_id, allowed_image_ids):
            continue
        regions = _template_regions(image, allowed_regions)
        if allowed_regions is not None and not regions:
            continue

        distribution = image.get('distribution') or 'DigitalOcean'
        yield {
            'id': f'digitalocean-image-{_entry_slug(image_id)}',
            'name': image.get('name') or str(image_id),
            'provider': 'digitalocean',
            'type': 'image',
            'description': f'{distribution} droplet image pulled from DigitalOcean.',
            'region': regions[0] if regions else '',
            'metadata': image,
            'source': 'cloud_provider_state',
            'organization': state.organization_id,
        }


def _azure_entries_from_payload(state, payload):
    admin_settings = state.admin_settings if isinstance(state.admin_settings, dict) else {}
    allowed_urns = _string_set(admin_settings.get('allowedVMImageUrns'))
    allowed_locations = _string_set(admin_settings.get('allowedLocationNames'))

    for image in payload.get('vm_images') or []:
        if not isinstance(image, dict):
            continue
        image_ref = image.get('urn') or image.get('id') or image.get('name')
        location = image.get('location') or ''
        if not image_ref or not _is_allowed(image_ref, allowed_urns) or not _is_allowed(location, allowed_locations):
            continue

        publisher = image.get('publisher') or 'Azure'
        offer = image.get('offer') or image.get('name') or image_ref
        sku = image.get('sku') or ''
        yield {
            'id': f'azure-image-{_entry_slug(image_ref)}',
            'name': image.get('name') or ' '.join(part for part in (publisher, offer, sku) if part),
            'provider': 'azure',
            'type': image.get('image_type') or 'image',
            'description': image.get('description') or f'{publisher} VM image pulled from Azure.',
            'region': location,
            'metadata': image,
            'source': 'cloud_provider_state',
            'organization': state.organization_id,
        }


def _proxmox_entries_from_payload(state, payload):
    admin_settings = state.admin_settings if isinstance(state.admin_settings, dict) else {}
    allowed_template_names = _string_set(admin_settings.get('allowedTemplateNames'))
    allowed_node_names = _string_set(admin_settings.get('allowedNodeNames'))

    for template in payload.get('templates') or []:
        if not isinstance(template, dict):
            continue
        template_name = template.get('name') or template.get('vmid')
        node = template.get('node') or ''
        if not template_name or not _is_allowed(template_name, allowed_template_names) or not _is_allowed(node, allowed_node_names):
            continue

        template_id = template.get('vmid') or template_name
        yield {
            'id': f'proxmox-template-{_entry_slug(template_id)}',
            'name': str(template_name),
            'provider': 'proxmox',
            'type': 'template',
            'description': f'Proxmox VM template on node {node}.' if node else 'Proxmox VM template.',
            'region': node or 'local',
            'metadata': template,
            'source': 'cloud_provider_state',
            'organization': state.organization_id,
        }


def _vmware_entries_from_payload(state, payload):
    templates = payload.get('templates')
    if templates is None:
        templates = [vm for vm in payload.get('vms') or [] if isinstance(vm, dict) and (vm.get('template') or vm.get('is_template') or vm.get('isTemplate'))]

    for template in templates or []:
        if not isinstance(template, dict):
            continue
        template_ref = template.get('id') or template.get('name')
        if not template_ref:
            continue
        region = template.get('datacenter_name') or template.get('datacenter_id') or template.get('host_id') or ''
        yield {
            'id': f'vmware-template-{_entry_slug(template_ref)}',
            'name': template.get('name') or str(template_ref),
            'provider': 'vmware',
            'type': 'template',
            'description': 'VMware vSphere template pulled from provider inventory.',
            'region': region,
            'metadata': template,
            'source': 'cloud_provider_state',
            'organization': state.organization_id,
        }


def _entries_from_provider_state(state):
    extractors = {
        'digitalocean': _digitalocean_entries_from_payload,
        'azure': _azure_entries_from_payload,
        'proxmox': _proxmox_entries_from_payload,
        'vmware': _vmware_entries_from_payload,
    }
    extractor = extractors.get(state.provider_id)
    if extractor is None:
        return []

    entries = []
    seen_ids = set()
    for payload in _provider_data_payloads(state.provider_data):
        for entry in extractor(state, payload):
            entry_id = entry.get('id')
            if not entry_id or entry_id in seen_ids:
                continue
            seen_ids.add(entry_id)
            entries.append(entry)
    return entries


def _marketplace_admin_orgs(user):
    return Organization.objects.all() if user.is_superuser else Organization.accessible_objects(user, 'admin_role')


def _user_can_read_marketplace(user):
    return bool(user.is_superuser or user.is_system_auditor or _marketplace_admin_orgs(user).exists())


def _resolve_marketplace_organization(request, require_admin=False):
    raw_org_pk = (
        request.data.get('organization')
        or request.data.get('organization_id')
        or request.query_params.get('organization')
        or request.query_params.get('organization_id')
    )
    admin_orgs = _marketplace_admin_orgs(request.user)

    if raw_org_pk not in (None, ''):
        try:
            organization = Organization.objects.get(pk=int(raw_org_pk))
        except (Organization.DoesNotExist, ValueError, TypeError):
            return None, Response(
                {'organization': [f'Organization {raw_org_pk} not found.']},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if request.user.is_superuser or (request.user.is_system_auditor and not require_admin):
            return organization, None
        if admin_orgs.filter(pk=organization.pk).exists():
            return organization, None
        return None, Response(
            {'organization': ['You do not have permission to use this organization.']},
            status=status.HTTP_403_FORBIDDEN,
        )

    if request.user.is_superuser or (request.user.is_system_auditor and not require_admin):
        return None, None

    count = admin_orgs.count()
    if count == 1:
        return admin_orgs.first(), None
    if count == 0:
        return None, Response(
            {'organization': ['You must be an organization administrator to import marketplace templates.']},
            status=status.HTTP_403_FORBIDDEN,
        )
    return None, Response(
        {'organization': ['Organization is required.']},
        status=status.HTTP_400_BAD_REQUEST,
    )


def _provider_state_queryset(request, organization, provider_filter=None):
    queryset = request.user.get_queryset(CloudProviderState).exclude(provider_data__isnull=True)
    if organization is None:
        queryset = queryset.filter(organization__isnull=True)
    else:
        queryset = queryset.filter(organization=organization)
    if provider_filter:
        queryset = queryset.filter(provider_id=provider_filter)
    return queryset.order_by('provider_id', 'pk')


def _static_catalog_response(provider_filter=None, type_filter=None):
    providers_data = []
    total = 0

    for provider_id, templates in PROVIDER_CATALOG.items():
        if provider_filter and provider_filter != provider_id:
            continue

        filtered = templates
        if type_filter:
            filtered = [t for t in templates if t.get('type') == type_filter]

        if not filtered:
            continue

        providers_data.append(
            {
                'id': provider_id,
                'label': PROVIDER_LABELS.get(provider_id, provider_id),
                'templates': filtered,
                'source': 'static_fallback',
            }
        )
        total += len(filtered)

    return {'count': total, 'providers': providers_data}


def _provider_state_catalog_response(request, organization, provider_filter=None, type_filter=None):
    all_state_queryset = _provider_state_queryset(request, organization)
    has_provider_state = all_state_queryset.exists()
    state_queryset = all_state_queryset
    if provider_filter:
        state_queryset = state_queryset.filter(provider_id=provider_filter)

    providers = {}
    for state in state_queryset:
        for entry in _entries_from_provider_state(state):
            if type_filter and entry.get('type') != type_filter:
                continue
            provider_id = entry['provider']
            provider = providers.setdefault(
                provider_id,
                {
                    'id': provider_id,
                    'label': PROVIDER_LABELS.get(provider_id, provider_id),
                    'templates': [],
                    'source': 'cloud_provider_state',
                },
            )
            if all(existing['id'] != entry['id'] for existing in provider['templates']):
                provider['templates'].append(entry)

    providers_data = [providers[key] for key in sorted(providers)]
    total = sum(len(provider['templates']) for provider in providers_data)
    return has_provider_state, {'count': total, 'providers': providers_data}


def _find_marketplace_entry(request, provider, template_id, organization):
    state_queryset = list(_provider_state_queryset(request, organization, provider))
    if state_queryset:
        for state in state_queryset:
            for entry in _entries_from_provider_state(state):
                if entry.get('id') == template_id:
                    return entry
        return None

    provider_entries = PROVIDER_CATALOG.get(provider)
    if provider_entries is None:
        return None
    return next((entry for entry in provider_entries if entry['id'] == template_id), None)


class MarketplaceTemplateListView(APIView):
    """
    GET /api/v2/marketplace/templates/

    Returns all available marketplace images/templates, optionally filtered
    by `provider` and/or `type` query params.

    Response shape::

        {
          "count": <int>,
          "providers": [
            {
              "id": "<provider>",
              "label": "<label>",
              "templates": [ {id, name, provider, type, description, region, metadata}, ... ]
            },
            ...
          ]
        }
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        if not _user_can_read_marketplace(request.user):
            return Response(
                {'organization': ['You do not have permission to view marketplace templates.']},
                status=status.HTTP_403_FORBIDDEN,
            )

        provider_filter = request.query_params.get('provider', '').strip().lower() or None
        type_filter = request.query_params.get('type', '').strip().lower() or None
        organization, error_response = _resolve_marketplace_organization(request)
        if error_response is not None:
            return error_response

        has_provider_state, state_response = _provider_state_catalog_response(
            request,
            organization,
            provider_filter=provider_filter,
            type_filter=type_filter,
        )
        if has_provider_state:
            return Response(state_response)

        return Response(_static_catalog_response(provider_filter=provider_filter, type_filter=type_filter))


class MarketplaceTemplateIngestView(APIView):
    """
    POST /api/v2/marketplace/ingest/

    Creates a CatalogItem seeded from a marketplace template entry.

    Request body::

        {
          "provider": "digitalocean",
          "template_id": "do-ubuntu-22-04-x64",
          "organization": <org_pk>,
          "terraform_job_template": <tft_pk>,      // optional, alternative to provision_workflow
          "provision_workflow": <wjt_pk>,          // optional
          "deprovision_workflow": <wjt_pk>,         // optional
          "configure_workflow": <wjt_pk>,           // optional
          "validate_workflow": <wjt_pk>,            // optional
          "name": "My Ubuntu VM"                    // optional override
        }

    Response: the newly created CatalogItem serialized by CatalogItemSerializer.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        provider = request.data.get('provider', '').strip().lower()
        template_id = request.data.get('template_id', '').strip()

        if not provider or not template_id:
            return Response(
                {'error': 'provider and template_id are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        organization, error_response = _resolve_marketplace_organization(request, require_admin=True)
        if error_response is not None:
            return error_response

        entry = _find_marketplace_entry(request, provider, template_id, organization)
        if entry is None:
            return Response(
                {'error': f'Template {template_id!r} not found for provider {provider!r}.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        def _has_value(key):
            return request.data.get(key) not in (None, '')

        if _has_value('provision_workflow') and _has_value('terraform_job_template'):
            return Response(
                {'terraform_job_template': ['Choose either a Terraform job template or a provision workflow, not both.']},
                status=status.HTTP_400_BAD_REQUEST,
            )

        def _get_wjt(key):
            pk = request.data.get(key)
            if not pk:
                return None, None
            try:
                workflow = WorkflowJobTemplate.objects.get(pk=int(pk))
            except (WorkflowJobTemplate.DoesNotExist, ValueError, TypeError):
                return None, {key: ['Workflow job template not found.']}
            if workflow.organization_id != organization.pk:
                return None, {key: ['Workflow job template must belong to the selected organization.']}
            return workflow, None

        def _get_tft(key):
            pk = request.data.get(key)
            if not pk:
                return None, None
            try:
                terraform_template = TerraformJobTemplate.objects.get(pk=int(pk))
            except (TerraformJobTemplate.DoesNotExist, ValueError, TypeError):
                return None, {key: ['Terraform job template not found.']}
            if terraform_template.organization_id != organization.pk:
                return None, {key: ['Terraform job template must belong to the selected organization.']}
            return terraform_template, None

        workflows = {}
        for key in ('provision_workflow', 'deprovision_workflow', 'configure_workflow', 'validate_workflow'):
            workflow, error = _get_wjt(key)
            if error:
                return Response(error, status=status.HTTP_400_BAD_REQUEST)
            workflows[key] = workflow
        terraform_template, error = _get_tft('terraform_job_template')
        if error:
            return Response(error, status=status.HTTP_400_BAD_REQUEST)

        item_name = (request.data.get('name') or entry['name']).strip() or entry['name']
        cloud_backends = {provider: terraform_template.pk if terraform_template else None}
        provider_workflows = {provider: workflows['provision_workflow'].pk} if workflows['provision_workflow'] else None
        provider_deprovision_workflows = {provider: workflows['deprovision_workflow'].pk} if workflows['deprovision_workflow'] else None

        # Build the CatalogItem
        catalog_item = CatalogItem(
            name=item_name,
            description=entry.get('description', ''),
            organization=organization,
            provision_workflow=workflows['provision_workflow'],
            terraform_job_template=terraform_template,
            deprovision_workflow=workflows['deprovision_workflow'],
            configure_workflow=workflows['configure_workflow'],
            validate_workflow=workflows['validate_workflow'],
            # Store original marketplace metadata for reference
            cloud_backends=cloud_backends,
            provider_workflows=provider_workflows,
            provider_deprovision_workflows=provider_deprovision_workflows,
            available_providers=[provider],
        )
        catalog_item.save()

        logger.info(
            'Ingested marketplace template %r from provider %r as CatalogItem pk=%d (user=%s)',
            template_id,
            provider,
            catalog_item.pk,
            request.user.username,
        )

        from awx.api import serializers as api_serializers

        serializer = api_serializers.CatalogItemSerializer(catalog_item, context={'request': request})
        return Response(serializer.data, status=status.HTTP_201_CREATED)
