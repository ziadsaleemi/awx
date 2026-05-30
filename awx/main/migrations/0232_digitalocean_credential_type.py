from django.db import migrations
from django.utils import timezone


DIGITALOCEAN_INPUTS = {
    "fields": [
        {
            "id": "do_token",
            "label": "API Token",
            "type": "string",
            "secret": True,
            "help_text": "DigitalOcean personal access token with required scopes.",
        },
        {
            "id": "do_region",
            "label": "Default Region",
            "type": "string",
            "help_text": "Default DigitalOcean region slug, e.g. nyc3.",
        },
        {
            "id": "do_spaces_access_id",
            "label": "Spaces Access Key",
            "type": "string",
            "help_text": "Optional Spaces access key for object storage operations.",
        },
        {
            "id": "do_spaces_secret_key",
            "label": "Spaces Secret Key",
            "type": "string",
            "secret": True,
            "help_text": "Optional Spaces secret key for object storage operations.",
        },
    ],
    "required": ["do_token"],
}

DIGITALOCEAN_INJECTORS = {
    "env": {
        "DIGITALOCEAN_TOKEN": "{{ do_token }}",
        "DO_TOKEN": "{{ do_token }}",
        "DIGITALOCEAN_REGION": "{{ do_region | default('') }}",
        "DO_REGION": "{{ do_region | default('') }}",
        "SPACES_ACCESS_KEY_ID": "{{ do_spaces_access_id | default('') }}",
        "SPACES_SECRET_ACCESS_KEY": "{{ do_spaces_secret_key | default('') }}",
        "TF_VAR_do_token": "{{ do_token }}",
        "TF_VAR_do_region": "{{ do_region | default('') }}",
    }
}


def create_digitalocean_credential_type(apps, schema_editor):
    CredentialType = apps.get_model('main', 'CredentialType')
    if CredentialType.objects.filter(namespace='digitalocean_terraform').exists():
        return
    CredentialType.objects.create(
        name='DigitalOcean (Terraform)',
        namespace='digitalocean_terraform',
        kind='cloud',
        managed=False,
        inputs=DIGITALOCEAN_INPUTS,
        injectors=DIGITALOCEAN_INJECTORS,
        description='Credentials for the DigitalOcean Terraform provider.',
        created=timezone.now(),
        modified=timezone.now(),
    )


def remove_digitalocean_credential_type(apps, schema_editor):
    CredentialType = apps.get_model('main', 'CredentialType')
    CredentialType.objects.filter(namespace='digitalocean_terraform', managed=False).delete()


class Migration(migrations.Migration):
    dependencies = [
        ('main', '0231_catalog_item_deploy_hidden_fields'),
    ]

    operations = [
        migrations.RunPython(
            create_digitalocean_credential_type,
            remove_digitalocean_credential_type,
        ),
    ]
