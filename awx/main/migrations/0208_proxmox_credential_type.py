from django.db import migrations
from django.utils import timezone


PROXMOX_VE_INPUTS = {
    "fields": [
        {
            "id": "pm_api_url",
            "label": "Proxmox API URL",
            "type": "string",
            "help_text": (
                "Full URL to the Proxmox VE API endpoint, "
                "e.g. https://proxmox.example.com:8006/api2/json"
            ),
        },
        {
            "id": "pm_api_token_id",
            "label": "API Token ID",
            "type": "string",
            "help_text": "Token identifier in the form user@realm!tokenname",
        },
        {
            "id": "pm_api_token_secret",
            "label": "API Token Secret",
            "type": "string",
            "secret": True,
            "help_text": "The UUID secret value of the Proxmox API token.",
        },
        {
            "id": "pm_node",
            "label": "Node Name",
            "type": "string",
            "help_text": "Name of the Proxmox VE node to target (e.g. pve).",
        },
        {
            "id": "pm_tls_insecure",
            "label": "Skip TLS Verification",
            "type": "boolean",
            "help_text": "Disable TLS certificate validation. Use only in lab environments.",
        },
    ],
    "required": ["pm_api_url", "pm_api_token_id", "pm_api_token_secret"],
}

# Env-var injectors: keys are env var names; values are Jinja2 templates
# referencing the credential field ids above.
PROXMOX_VE_INJECTORS = {
    "env": {
        "PM_API_URL": "{{ pm_api_url }}",
        "PM_API_TOKEN_ID": "{{ pm_api_token_id }}",
        "PM_API_TOKEN_SECRET": "{{ pm_api_token_secret }}",
        "PM_NODE": "{{ pm_node }}",
        "PM_TLS_INSECURE": "{{ pm_tls_insecure | default('false') | lower }}",
    }
}


def create_proxmox_credential_type(apps, schema_editor):
    CredentialType = apps.get_model('main', 'CredentialType')
    # Idempotent: skip if already present (e.g. re-running migrations in dev)
    if CredentialType.objects.filter(namespace='proxmox_ve').exists():
        return
    CredentialType.objects.create(
        name='Proxmox VE',
        namespace='proxmox_ve',
        kind='cloud',
        managed=False,
        inputs=PROXMOX_VE_INPUTS,
        injectors=PROXMOX_VE_INJECTORS,
        description='Credentials for the Proxmox Virtual Environment Terraform provider.',
        created=timezone.now(),
        modified=timezone.now(),
    )


def remove_proxmox_credential_type(apps, schema_editor):
    CredentialType = apps.get_model('main', 'CredentialType')
    CredentialType.objects.filter(namespace='proxmox_ve', managed=False).delete()


class Migration(migrations.Migration):
    dependencies = [
        ('main', '0207_add_terraform_models'),
    ]

    operations = [
        migrations.RunPython(
            create_proxmox_credential_type,
            remove_proxmox_credential_type,
        ),
    ]
