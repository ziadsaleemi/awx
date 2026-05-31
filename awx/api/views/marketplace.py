"""
Marketplace template ingestion API (E14).

Endpoints:
  GET  /api/v2/marketplace/templates/  — list available cloud images/templates
                                          from connected providers, grouped by provider.
  POST /api/v2/marketplace/ingest/     — create a CatalogItem from a marketplace entry.
"""

import logging

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from awx.main.models import CatalogItem, Organization, WorkflowJobTemplate

logger = logging.getLogger('awx.api.views.marketplace')

# ---------------------------------------------------------------------------
# Provider-specific helpers
# ---------------------------------------------------------------------------
# Each helper returns a list of dicts:
# {id, name, provider, type, description, region, metadata}
# They are intentionally lightweight; real implementations would call provider
# APIs using stored cloud credentials, similar to cloudConnectionStore.ts.
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
        provider_filter = request.query_params.get('provider', '').strip().lower() or None
        type_filter = request.query_params.get('type', '').strip().lower() or None

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
                }
            )
            total += len(filtered)

        return Response({'count': total, 'providers': providers_data})


class MarketplaceTemplateIngestView(APIView):
    """
    POST /api/v2/marketplace/ingest/

    Creates a CatalogItem seeded from a marketplace template entry.

    Request body::

        {
          "provider": "digitalocean",
          "template_id": "do-ubuntu-22-04-x64",
          "organization": <org_pk>,
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

        # Look up the marketplace entry
        provider_entries = PROVIDER_CATALOG.get(provider)
        if provider_entries is None:
            return Response(
                {'error': f'Unknown provider: {provider}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        entry = next((t for t in provider_entries if t['id'] == template_id), None)
        if entry is None:
            return Response(
                {'error': f'Template {template_id!r} not found for provider {provider!r}.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        admin_orgs = Organization.objects.all() if request.user.is_superuser else Organization.accessible_objects(request.user, 'admin_role')
        if not admin_orgs.exists():
            return Response(
                {'organization': ['You must be an organization administrator to import marketplace templates.']},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Marketplace imports create CatalogItems, so they must always be scoped
        # to an organization the caller administers.
        org_pk = request.data.get('organization') or request.data.get('organization_id')
        if not org_pk:
            if admin_orgs.count() == 1:
                organization = admin_orgs.first()
            else:
                return Response(
                    {'organization': ['Organization is required.']},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            try:
                org_id = int(org_pk)
                organization = Organization.objects.get(pk=org_id)
            except (Organization.DoesNotExist, ValueError, TypeError):
                return Response(
                    {'organization': [f'Organization {org_pk} not found.']},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not request.user.is_superuser and not admin_orgs.filter(pk=organization.pk).exists():
                return Response(
                    {'organization': ['You do not have permission to import into this organization.']},
                    status=status.HTTP_403_FORBIDDEN,
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

        workflows = {}
        for key in ('provision_workflow', 'deprovision_workflow', 'configure_workflow', 'validate_workflow'):
            workflow, error = _get_wjt(key)
            if error:
                return Response(error, status=status.HTTP_400_BAD_REQUEST)
            workflows[key] = workflow

        item_name = (request.data.get('name') or entry['name']).strip() or entry['name']

        # Build the CatalogItem
        catalog_item = CatalogItem(
            name=item_name,
            description=entry.get('description', ''),
            organization=organization,
            provision_workflow=workflows['provision_workflow'],
            deprovision_workflow=workflows['deprovision_workflow'],
            configure_workflow=workflows['configure_workflow'],
            validate_workflow=workflows['validate_workflow'],
            # Store original marketplace metadata for reference
            cloud_backends={provider: None},
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
