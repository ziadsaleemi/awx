from django.db import migrations
from django.utils import timezone


AWS_INPUTS = {
    "fields": [
        {
            "id": "aws_access_key_id",
            "label": "Access Key ID",
            "type": "string",
            "help_text": "AWS IAM access key ID.",
        },
        {
            "id": "aws_secret_access_key",
            "label": "Secret Access Key",
            "type": "string",
            "secret": True,
            "help_text": "AWS IAM secret access key.",
        },
        {
            "id": "aws_session_token",
            "label": "Session Token",
            "type": "string",
            "secret": True,
            "help_text": "Optional: temporary session token for STS-issued credentials.",
        },
        {
            "id": "aws_default_region",
            "label": "Default Region",
            "type": "string",
            "help_text": "AWS region to use by default, e.g. us-east-1.",
        },
    ],
    "required": ["aws_access_key_id", "aws_secret_access_key"],
}

AWS_INJECTORS = {
    "env": {
        "AWS_ACCESS_KEY_ID": "{{ aws_access_key_id }}",
        "AWS_SECRET_ACCESS_KEY": "{{ aws_secret_access_key }}",
        "AWS_SESSION_TOKEN": "{{ aws_session_token | default('') }}",
        "AWS_DEFAULT_REGION": "{{ aws_default_region | default('us-east-1') }}",
    }
}


def create_aws_credential_type(apps, schema_editor):
    CredentialType = apps.get_model('main', 'CredentialType')
    if CredentialType.objects.filter(namespace='aws_terraform').exists():
        return
    CredentialType.objects.create(
        name='Amazon Web Services (Terraform)',
        namespace='aws_terraform',
        kind='cloud',
        managed=False,
        inputs=AWS_INPUTS,
        injectors=AWS_INJECTORS,
        description='Credentials for the AWS Terraform provider.',
        created=timezone.now(),
        modified=timezone.now(),
    )


def remove_aws_credential_type(apps, schema_editor):
    CredentialType = apps.get_model('main', 'CredentialType')
    CredentialType.objects.filter(namespace='aws_terraform', managed=False).delete()


class Migration(migrations.Migration):
    dependencies = [
        ('main', '0209_vmware_credential_type'),
    ]

    operations = [
        migrations.RunPython(
            create_aws_credential_type,
            remove_aws_credential_type,
        ),
    ]
