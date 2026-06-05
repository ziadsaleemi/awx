import awx.main.fields
import django.db.models.deletion
from django.db import migrations

from awx.main.migrations._dab_rbac import setup_managed_role_definitions


def sync_cloud_persona_roles(apps, schema_editor):
    from ansible_base.rbac.management import sync_dab_permissions

    Organization = apps.get_model('main', 'Organization')
    for organization in Organization.objects.iterator():
        organization.save()
    for model_name in ('CloudProviderConnection', 'CloudProviderState'):
        model = apps.get_model('main', model_name)
        for obj in model.objects.iterator():
            obj.save()

    sync_dab_permissions(apps=apps)
    setup_managed_role_definitions(apps, schema_editor)


class Migration(migrations.Migration):

    dependencies = [
        ('main', '0255_user_types'),
    ]

    operations = [
        migrations.AddField(
            model_name='organization',
            name='cloud_admin_role',
            field=awx.main.fields.ImplicitRoleField(
                editable=False,
                null='True',
                on_delete=django.db.models.deletion.SET_NULL,
                parent_role='admin_role',
                related_name='+',
                to='main.Role',
            ),
            preserve_default='True',
        ),
        migrations.AddField(
            model_name='cloudproviderconnection',
            name='admin_role',
            field=awx.main.fields.ImplicitRoleField(
                editable=False,
                null='True',
                on_delete=django.db.models.deletion.SET_NULL,
                parent_role=['organization.cloud_admin_role'],
                related_name='+',
                to='main.Role',
            ),
            preserve_default='True',
        ),
        migrations.AddField(
            model_name='cloudproviderconnection',
            name='read_role',
            field=awx.main.fields.ImplicitRoleField(
                editable=False,
                null='True',
                on_delete=django.db.models.deletion.SET_NULL,
                parent_role=['admin_role', 'organization.cloud_user_role'],
                related_name='+',
                to='main.Role',
            ),
            preserve_default='True',
        ),
        migrations.AddField(
            model_name='cloudproviderstate',
            name='admin_role',
            field=awx.main.fields.ImplicitRoleField(
                editable=False,
                null='True',
                on_delete=django.db.models.deletion.SET_NULL,
                parent_role=['organization.cloud_admin_role'],
                related_name='+',
                to='main.Role',
            ),
            preserve_default='True',
        ),
        migrations.AddField(
            model_name='cloudproviderstate',
            name='read_role',
            field=awx.main.fields.ImplicitRoleField(
                editable=False,
                null='True',
                on_delete=django.db.models.deletion.SET_NULL,
                parent_role=['admin_role', 'organization.cloud_user_role'],
                related_name='+',
                to='main.Role',
            ),
            preserve_default='True',
        ),
        migrations.AddField(
            model_name='organization',
            name='cloud_user_role',
            field=awx.main.fields.ImplicitRoleField(
                editable=False,
                null='True',
                on_delete=django.db.models.deletion.SET_NULL,
                parent_role='cloud_admin_role',
                related_name='+',
                to='main.Role',
            ),
            preserve_default='True',
        ),
        migrations.AlterField(
            model_name='organization',
            name='read_role',
            field=awx.main.fields.ImplicitRoleField(
                editable=False,
                null='True',
                on_delete=django.db.models.deletion.SET_NULL,
                parent_role=[
                    'member_role',
                    'auditor_role',
                    'execute_role',
                    'project_admin_role',
                    'inventory_admin_role',
                    'workflow_admin_role',
                    'notification_admin_role',
                    'credential_admin_role',
                    'job_template_admin_role',
                    'approval_role',
                    'execution_environment_admin_role',
                    'cloud_admin_role',
                    'cloud_user_role',
                ],
                related_name='+',
                to='main.Role',
            ),
        ),
        migrations.RunPython(sync_cloud_persona_roles, migrations.RunPython.noop),
    ]
