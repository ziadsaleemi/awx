import awx.main.fields
from django.db import migrations
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('main', '0252_inventory_default_machine_credential'),
    ]

    operations = [
        migrations.AlterModelOptions(
            name='catalogitem',
            options={
                'default_permissions': ('add', 'change', 'delete', 'view'),
                'ordering': ('name',),
                'permissions': [('use_catalogitem', 'Can deploy this catalog item')],
            },
        ),
        migrations.AddField(
            model_name='organization',
            name='catalog_admin_role',
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
            model_name='organization',
            name='catalog_user_role',
            field=awx.main.fields.ImplicitRoleField(
                editable=False,
                null='True',
                on_delete=django.db.models.deletion.SET_NULL,
                parent_role='catalog_admin_role',
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
                ],
                related_name='+',
                to='main.Role',
            ),
        ),
        migrations.AlterField(
            model_name='catalogitem',
            name='admin_role',
            field=awx.main.fields.ImplicitRoleField(
                editable=False,
                null='True',
                on_delete=django.db.models.deletion.SET_NULL,
                parent_role=['organization.admin_role', 'organization.catalog_admin_role'],
                related_name='+',
                to='main.Role',
            ),
        ),
        migrations.AlterField(
            model_name='catalogitem',
            name='use_role',
            field=awx.main.fields.ImplicitRoleField(
                editable=False,
                null='True',
                on_delete=django.db.models.deletion.SET_NULL,
                parent_role=['admin_role', 'organization.member_role', 'organization.catalog_user_role'],
                related_name='+',
                to='main.Role',
            ),
        ),
    ]
