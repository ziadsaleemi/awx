import awx.main.fields
from django.db import migrations
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ('main', '0214_catalog_models'),
    ]

    operations = [
        migrations.AddField(
            model_name='terraformjobtemplate',
            name='admin_role',
            field=awx.main.fields.ImplicitRoleField(
                editable=False,
                null='True',
                on_delete=django.db.models.deletion.SET_NULL,
                parent_role=['organization.job_template_admin_role'],
                related_name='+',
                to='main.role',
            ),
            preserve_default='True',
        ),
        migrations.AddField(
            model_name='terraformjobtemplate',
            name='execute_role',
            field=awx.main.fields.ImplicitRoleField(
                editable=False,
                null='True',
                on_delete=django.db.models.deletion.SET_NULL,
                parent_role=['admin_role', 'organization.execute_role'],
                related_name='+',
                to='main.role',
            ),
            preserve_default='True',
        ),
        migrations.AddField(
            model_name='terraformjobtemplate',
            name='read_role',
            field=awx.main.fields.ImplicitRoleField(
                editable=False,
                null='True',
                on_delete=django.db.models.deletion.SET_NULL,
                parent_role=['admin_role', 'execute_role', 'organization.auditor_role'],
                related_name='+',
                to='main.role',
            ),
            preserve_default='True',
        ),
    ]
