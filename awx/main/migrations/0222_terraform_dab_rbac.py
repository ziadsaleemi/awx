from django.db import migrations

from awx.main.migrations._dab_rbac import setup_managed_role_definitions


def sync_terraform_dab_permissions(apps, schema_editor):
    """
    Create DABContentType, DABPermission, and RoleDefinition entries for
    TerraformJobTemplate which was added to permission_registry after the
    original 0192_custom_roles migration ran.
    """
    from ansible_base.rbac.management import sync_dab_permissions

    sync_dab_permissions(apps=apps)
    setup_managed_role_definitions(apps, schema_editor)


class Migration(migrations.Migration):

    dependencies = [
        ('main', '0221_proxmox_credential_type_privilege_help'),
    ]

    operations = [
        migrations.RunPython(sync_terraform_dab_permissions, migrations.RunPython.noop),
    ]
