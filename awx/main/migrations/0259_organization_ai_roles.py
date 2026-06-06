import awx.main.fields
import django.db.models.deletion
from django.db import migrations

from awx.main.migrations._dab_rbac import setup_managed_role_definitions
from awx.main.migrations._implicit_roles import create_missing_implicit_roles


def sync_ai_persona_roles(apps, schema_editor):
    from ansible_base.rbac.management import sync_dab_permissions

    create_missing_implicit_roles(apps, 'Organization')
    sync_dab_permissions(apps=apps)
    setup_managed_role_definitions(apps, schema_editor)


class Migration(migrations.Migration):

    dependencies = [
        ('main', '0258_organization_eda_roles'),
    ]

    operations = [
        migrations.AlterModelOptions(
            name='organization',
            options={
                'default_permissions': ('change', 'delete', 'view'),
                'ordering': ('name',),
                'permissions': [
                    ('member_organization', 'Basic participation permissions for organization'),
                    ('audit_organization', 'Audit everything inside the organization'),
                    ('view_policyascode', 'View Policy as Code status and resources'),
                    ('change_policyascode', 'Manage Policy as Code modules and governed live changes'),
                    ('view_edaactivation', 'View Event-Driven Ansible activation status and events'),
                    ('execute_edaactivation', 'Operate Event-Driven Ansible activations'),
                    ('change_edaactivation', 'Manage Event-Driven Ansible activation lifecycle'),
                    ('view_airesourceaction', 'View AI resource action plans and audit context'),
                    ('change_airesourceaction', 'Author and apply AI resource action plans'),
                    ('approve_airesourceaction', 'Approve AI resource action plans'),
                ],
            },
        ),
        migrations.AddField(
            model_name='organization',
            name='ai_author_role',
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
            name='ai_approver_role',
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
                    'policy_author_role',
                    'policy_operator_role',
                    'eda_admin_role',
                    'eda_operator_role',
                    'ai_author_role',
                    'ai_approver_role',
                ],
                related_name='+',
                to='main.Role',
            ),
        ),
        migrations.RunPython(sync_ai_persona_roles, migrations.RunPython.noop),
    ]
