"""
Add TF_VAR_pm_* environment variable injectors to the Proxmox VE credential type.

Root cause: The Proxmox VE credential type only injected PM_* env vars (consumed
by the telmate/proxmox provider internally), but the main.tf HCL files reference
Terraform input variables via ``var.pm_node``, ``var.pm_api_url``, etc.  Without
matching TF_VAR_* env vars those variables default to "" and ``target_node``
evaluates to the fallback "pve" instead of the real node name, causing Proxmox to
return HTTP 500 ("hostname lookup 'pve' failed").
"""

from django.db import migrations

UPDATED_INJECTORS = {
    "env": {
        # Provider reads these natively via its own env-var support
        "PM_API_URL": "{{ pm_api_url }}",
        "PM_API_TOKEN_ID": "{{ pm_api_token_id }}",
        "PM_API_TOKEN_SECRET": "{{ pm_api_token_secret }}",
        "PM_NODE": "{{ pm_node }}",
        "PM_TLS_INSECURE": "{{ pm_tls_insecure | default('false') | lower }}",
        # TF_VAR_* equivalents so ``var.pm_*`` in HCL resolves correctly
        "TF_VAR_pm_api_url": "{{ pm_api_url }}",
        "TF_VAR_pm_api_token_id": "{{ pm_api_token_id }}",
        "TF_VAR_pm_api_token_secret": "{{ pm_api_token_secret }}",
        "TF_VAR_pm_node": "{{ pm_node }}",
        "TF_VAR_pm_tls_insecure": "{{ pm_tls_insecure | default('false') | lower }}",
    }
}


def add_tf_var_injectors(apps, schema_editor):
    CredentialType = apps.get_model('main', 'CredentialType')
    CredentialType.objects.filter(namespace='proxmox_ve').update(injectors=UPDATED_INJECTORS)


class Migration(migrations.Migration):
    dependencies = [
        ('main', '0222_terraform_dab_rbac'),
    ]

    operations = [
        migrations.RunPython(add_tf_var_injectors, migrations.RunPython.noop),
    ]
