from django.db import migrations
from django.utils import timezone


# GCP requires a JSON service-account key file on disk.  AWX's `file`
# injector writes the template content to a temporary file and exposes
# its path as {{tower.filename}} so we can set GOOGLE_CREDENTIALS to
# the file path rather than embedding the raw JSON in an env var.

GCP_INPUTS = {
    "fields": [
        {
            "id": "gcp_project",
            "label": "Project ID",
            "type": "string",
            "help_text": "GCP project ID, e.g. my-gcp-project.",
        },
        {
            "id": "google_credentials",
            "label": "Service Account JSON Key",
            "type": "string",
            "secret": True,
            "multiline": True,
            "help_text": (
                "Full contents of a GCP service-account JSON key file. "
                "AWX will write this to a temporary file and pass its "
                "path to Terraform via GOOGLE_CREDENTIALS."
            ),
        },
    ],
    "required": ["gcp_project", "google_credentials"],
}

GCP_INJECTORS = {
    "file": {
        # AWX writes this template to a temp file; path available as
        # {{tower.filename}} in env-var templates below.
        "template": "{{ google_credentials }}"
    },
    "env": {
        "GOOGLE_PROJECT": "{{ gcp_project }}",
        # GOOGLE_CREDENTIALS accepts the path to the JSON key file.
        "GOOGLE_CREDENTIALS": "{{tower.filename}}",
    },
}


def create_gcp_credential_type(apps, schema_editor):
    CredentialType = apps.get_model('main', 'CredentialType')
    if CredentialType.objects.filter(namespace='gcp_terraform').exists():
        return
    CredentialType.objects.create(
        name='Google Cloud Platform (Terraform)',
        namespace='gcp_terraform',
        kind='cloud',
        managed=False,
        inputs=GCP_INPUTS,
        injectors=GCP_INJECTORS,
        description='Credentials for the Google Cloud Terraform provider.',
        created=timezone.now(),
        modified=timezone.now(),
    )


def remove_gcp_credential_type(apps, schema_editor):
    CredentialType = apps.get_model('main', 'CredentialType')
    CredentialType.objects.filter(namespace='gcp_terraform', managed=False).delete()


class Migration(migrations.Migration):
    dependencies = [
        ('main', '0211_azure_credential_type'),
    ]

    operations = [
        migrations.RunPython(
            create_gcp_credential_type,
            remove_gcp_credential_type,
        ),
    ]
