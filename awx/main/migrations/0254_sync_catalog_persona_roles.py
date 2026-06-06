from django.db import migrations

from awx.main.migrations._implicit_roles import create_missing_implicit_roles
from awx.main.migrations._dab_rbac import setup_managed_role_definitions


def sync_catalog_persona_roles(apps, schema_editor):
    from ansible_base.rbac.management import sync_dab_permissions

    create_missing_implicit_roles(apps, 'Organization', 'CatalogItem')
    sync_dab_permissions(apps=apps)
    setup_managed_role_definitions(apps, schema_editor)


class Migration(migrations.Migration):

    dependencies = [
        ('main', '0253_organization_catalog_roles'),
    ]

    operations = [
        migrations.RunPython(sync_catalog_persona_roles, migrations.RunPython.noop),
    ]
