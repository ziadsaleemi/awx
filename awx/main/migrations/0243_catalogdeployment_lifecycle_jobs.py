import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('main', '0242_catalogitem_post_provision_workflows'),
    ]

    operations = [
        migrations.AddField(
            model_name='catalogdeployment',
            name='configure_job',
            field=models.ForeignKey(
                blank=True,
                default=None,
                help_text='Most recent configure_workflow job for this deployment.',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='catalog_deployments_as_configure',
                to='main.workflowjob',
            ),
        ),
        migrations.AddField(
            model_name='catalogdeployment',
            name='validate_job',
            field=models.ForeignKey(
                blank=True,
                default=None,
                help_text='Most recent validate_workflow job for this deployment.',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='catalog_deployments_as_validate',
                to='main.workflowjob',
            ),
        ),
    ]
