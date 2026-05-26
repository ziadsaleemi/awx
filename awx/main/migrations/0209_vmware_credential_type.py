from django.db import migrations
from django.utils import timezone


VMWARE_INPUTS = {
    "fields": [
        {
            "id": "vsphere_server",
            "label": "vSphere Server",
            "type": "string",
            "help_text": "Hostname or IP address of the vCenter / ESXi host, e.g. vcenter.example.com",
        },
        {
            "id": "vsphere_user",
            "label": "Username",
            "type": "string",
            "help_text": "vSphere username, e.g. administrator@vsphere.local",
        },
        {
            "id": "vsphere_password",
            "label": "Password",
            "type": "string",
            "secret": True,
            "help_text": "Password for the vSphere user.",
        },
        {
            "id": "vsphere_allow_unverified_ssl",
            "label": "Skip TLS Verification",
            "type": "boolean",
            "help_text": "Disable TLS certificate validation. Use only in lab environments.",
        },
    ],
    "required": ["vsphere_server", "vsphere_user", "vsphere_password"],
}

VMWARE_INJECTORS = {
    "env": {
        "VSPHERE_SERVER": "{{ vsphere_server }}",
        "VSPHERE_USER": "{{ vsphere_user }}",
        "VSPHERE_PASSWORD": "{{ vsphere_password }}",
        "VSPHERE_ALLOW_UNVERIFIED_SSL": "{{ vsphere_allow_unverified_ssl | default('false') | lower }}",
    }
}


def create_vmware_credential_type(apps, schema_editor):
    CredentialType = apps.get_model('main', 'CredentialType')
    if CredentialType.objects.filter(namespace='vmware_vsphere_terraform').exists():
        return
    CredentialType.objects.create(
        name='VMware vSphere (Terraform)',
        namespace='vmware_vsphere_terraform',
        kind='cloud',
        managed=False,
        inputs=VMWARE_INPUTS,
        injectors=VMWARE_INJECTORS,
        description='Credentials for the VMware vSphere Terraform provider.',
        created=timezone.now(),
        modified=timezone.now(),
    )


def remove_vmware_credential_type(apps, schema_editor):
    CredentialType = apps.get_model('main', 'CredentialType')
    CredentialType.objects.filter(namespace='vmware_vsphere_terraform', managed=False).delete()


class Migration(migrations.Migration):
    dependencies = [
        ('main', '0208_proxmox_credential_type'),
    ]

    operations = [
        migrations.RunPython(
            create_vmware_credential_type,
            remove_vmware_credential_type,
        ),
    ]
