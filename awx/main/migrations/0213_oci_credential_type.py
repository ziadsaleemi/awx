from django.db import migrations
from django.utils import timezone


# The OCI Terraform provider can be configured via an OCI CLI config file.
# We use two file templates:
#   * oci_config  — the standard ~/.oci/config ini file
#   * oci_key     — the RSA private key PEM content referenced by key_file
#
# AWX's `file` injector writes each template to a separate temp file and
# exposes the paths as {{tower.filename.oci_config}} and
# {{tower.filename.oci_key}} respectively.

OCI_INPUTS = {
    "fields": [
        {
            "id": "tenancy_ocid",
            "label": "Tenancy OCID",
            "type": "string",
            "help_text": "OCID of the tenancy, e.g. ocid1.tenancy.oc1...",
        },
        {
            "id": "user_ocid",
            "label": "User OCID",
            "type": "string",
            "help_text": "OCID of the user, e.g. ocid1.user.oc1...",
        },
        {
            "id": "fingerprint",
            "label": "API Key Fingerprint",
            "type": "string",
            "help_text": "Fingerprint of the RSA public key, e.g. 20:3b:97:...",
        },
        {
            "id": "private_key",
            "label": "Private Key (PEM)",
            "type": "string",
            "secret": True,
            "multiline": True,
            "help_text": "PEM-encoded RSA private key associated with the API signing key.",
        },
        {
            "id": "region",
            "label": "Region",
            "type": "string",
            "help_text": "OCI region identifier, e.g. us-phoenix-1.",
        },
    ],
    "required": [
        "tenancy_ocid",
        "user_ocid",
        "fingerprint",
        "private_key",
        "region",
    ],
}

OCI_INJECTORS = {
    "file": {
        # Renders to a standard OCI CLI config; key_file references the
        # companion private key temp file.
        "template.oci_config": (
            "[DEFAULT]\n"
            "tenancy={{ tenancy_ocid }}\n"
            "user={{ user_ocid }}\n"
            "fingerprint={{ fingerprint }}\n"
            "key_file={{tower.filename.oci_key}}\n"
            "region={{ region }}\n"
        ),
        "template.oci_key": "{{ private_key }}",
    },
    "env": {
        # Point the OCI CLI / Terraform OCI provider at our temp config.
        "OCI_CLI_CONFIG_FILE": "{{tower.filename.oci_config}}",
        "OCI_CLI_CONFIG_PROFILE": "DEFAULT",
        # Convenience: also expose individual TF_VAR_* variables so
        # Terraform root modules can reference them directly without
        # reading the config file.
        "TF_VAR_tenancy_ocid": "{{ tenancy_ocid }}",
        "TF_VAR_user_ocid": "{{ user_ocid }}",
        "TF_VAR_fingerprint": "{{ fingerprint }}",
        "TF_VAR_region": "{{ region }}",
    },
}


def create_oci_credential_type(apps, schema_editor):
    CredentialType = apps.get_model('main', 'CredentialType')
    if CredentialType.objects.filter(namespace='oci_terraform').exists():
        return
    CredentialType.objects.create(
        name='Oracle Cloud Infrastructure (Terraform)',
        namespace='oci_terraform',
        kind='cloud',
        managed=False,
        inputs=OCI_INPUTS,
        injectors=OCI_INJECTORS,
        description='Credentials for the Oracle Cloud Infrastructure Terraform provider.',
        created=timezone.now(),
        modified=timezone.now(),
    )


def remove_oci_credential_type(apps, schema_editor):
    CredentialType = apps.get_model('main', 'CredentialType')
    CredentialType.objects.filter(namespace='oci_terraform', managed=False).delete()


class Migration(migrations.Migration):
    dependencies = [
        ('main', '0212_gcp_credential_type'),
    ]

    operations = [
        migrations.RunPython(
            create_oci_credential_type,
            remove_oci_credential_type,
        ),
    ]
