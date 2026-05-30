import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('main', '0241_catalogitem_browse_enabled'),
    ]

    operations = [
        migrations.AddField(
            model_name='catalogitem',
            name='configure_workflow',
            field=models.ForeignKey(
                blank=True,
                default=None,
                help_text='Workflow to run automatically after a successful provision to configure the new resource.',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='catalog_items_as_configure',
                to='main.workflowjobtemplate',
            ),
        ),
        migrations.AddField(
            model_name='catalogitem',
            name='validate_workflow',
            field=models.ForeignKey(
                blank=True,
                default=None,
                help_text='Workflow to run after configure_workflow to validate the resource is healthy.',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='catalog_items_as_validate',
                to='main.workflowjobtemplate',
            ),
        ),
    ]
