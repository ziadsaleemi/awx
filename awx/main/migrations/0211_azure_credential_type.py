from django.db import migrations
from django.utils import timezone


AZURE_INPUTS = {
    "fields": [
        {
            "id": "arm_subscription_id",
            "label": "Subscription ID",
            "type": "string",
            "help_text": "Azure subscription ID (UUID).",
        },
        {
            "id": "arm_client_id",
            "label": "Client ID",
            "type": "string",
            "help_text": "Azure service principal application (client) ID.",
        },
        {
            "id": "arm_client_secret",
            "label": "Client Secret",
            "type": "string",
            "secret": True,
            "help_text": "Azure service principal client secret.",
        },
        {
            "id": "arm_tenant_id",
            "label": "Tenant ID",
            "type": "string",
            "help_text": "Azure Active Directory tenant ID.",
        },
        {
            "id": "arm_environment",
            "label": "Environment",
            "type": "string",
            "help_text": (
                "Azure cloud environment. Leave blank for public Azure. "
                "Other values: AzureUSGovernment, AzureChinaCloud, AzureGermanCloud."
            ),
        },
    ],
    "required": [
        "arm_subscription_id",
        "arm_client_id",
        "arm_client_secret",
        "arm_tenant_id",
    ],
}

AZURE_INJECTORS = {
    "env": {
        "ARM_SUBSCRIPTION_ID": "{{ arm_subscription_id }}",
        "ARM_CLIENT_ID": "{{ arm_client_id }}",
        "ARM_CLIENT_SECRET": "{{ arm_client_secret }}",
        "ARM_TENANT_ID": "{{ arm_tenant_id }}",
        "ARM_ENVIRONMENT": "{{ arm_environment | default('') }}",
    }
}


def create_azure_credential_type(apps, schema_editor):
    CredentialType = apps.get_model('main', 'CredentialType')
    if CredentialType.objects.filter(namespace='azure_rm_terraform').exists():
        return
    CredentialType.objects.create(
        name='Microsoft Azure Resource Manager (Terraform)',
        namespace='azure_rm_terraform',
        kind='cloud',
        managed=False,
        inputs=AZURE_INPUTS,
        injectors=AZURE_INJECTORS,
        description='Credentials for the Azure Resource Manager Terraform provider.',
        created=timezone.now(),
        modified=timezone.now(),
    )


def remove_azure_credential_type(apps, schema_editor):
    CredentialType = apps.get_model('main', 'CredentialType')
    CredentialType.objects.filter(namespace='azure_rm_terraform', managed=False).delete()


class Migration(migrations.Migration):
    dependencies = [
        ('main', '0210_aws_credential_type'),
    ]

    operations = [
        migrations.RunPython(
            create_azure_credential_type,
            remove_azure_credential_type,
        ),
    ]
