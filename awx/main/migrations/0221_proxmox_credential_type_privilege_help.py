"""
Update the Proxmox VE credential type's help text to warn users about
API token privilege separation requirements.

Error observed: "user root@pam has valid credentials but cannot retrieve user
list, check privilege separation of api token"

Root cause: The telmate/proxmox Terraform provider validates API tokens by
listing users (GET /api2/json/access/users).  When a token has "Privilege
Separation" enabled in Proxmox, the token only has the permissions explicitly
granted to it — *not* all permissions of the owning user.  If the token has
not been granted User.Audit (and Sys.Audit for some operations), this call
fails even though the token itself is valid.

Resolution (Proxmox side, cannot be fixed in AWX):
  Option A — Disable "Privilege Separation" on the token:
    Proxmox UI → Datacenter → Permissions → API Tokens → Edit token →
    uncheck "Privilege Separation".
  Option B — Grant explicit permissions to the token:
    Proxmox UI → Datacenter → Permissions → Add → API Token Permission →
    path "/", token "user@realm!tokenname", role "PVEAuditor" (or
    manually grant User.Audit + Sys.Audit + VM.Allocate etc).
"""
import json
from django.db import migrations


def update_proxmox_help_texts(apps, schema_editor):
    CredentialType = apps.get_model('main', 'CredentialType')
    try:
        ct = CredentialType.objects.get(namespace='proxmox_ve')
    except CredentialType.DoesNotExist:
        return  # not installed in this environment

    inputs = ct.inputs
    if isinstance(inputs, str):
        inputs = json.loads(inputs)

    for field in inputs.get('fields', []):
        if field['id'] == 'pm_api_token_id':
            field['help_text'] = (
                "Token identifier in the form user@realm!tokenname (e.g. root@pam!terraform). "
                "\n\n"
                "⚠️  Privilege Separation: If the token was created with 'Privilege Separation' "
                "enabled (the Proxmox default), you must explicitly grant permissions to the "
                "token itself — the token does NOT inherit the owner's permissions. "
                "The telmate/proxmox provider requires at minimum: User.Audit and Sys.Audit "
                "(plus VM.Allocate, VM.Config.*, Datastore.*, SDN.Use for VM operations). "
                "\n\n"
                "Easiest fix: In Proxmox → Datacenter → Permissions → API Tokens → "
                "edit the token and uncheck 'Privilege Separation', "
                "then assign the PVEAdmin role to the token at path '/'."
            )
        elif field['id'] == 'pm_api_token_secret':
            field['help_text'] = (
                "The UUID secret value of the Proxmox API token. "
                "This is shown only once when the token is created in Proxmox; "
                "store it securely."
            )

    ct.inputs = inputs
    ct.save(update_fields=['inputs'])


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ('main', '0220_catalog_terraform_support'),
    ]

    operations = [
        migrations.RunPython(update_proxmox_help_texts, noop),
    ]
