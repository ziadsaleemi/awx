from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('main', '0235_catalog_item_cloud_backends'),
    ]

    operations = [
        migrations.AddField(
            model_name='catalogitem',
            name='provider_workflows',
            field=models.JSONField(
                blank=True,
                default=None,
                help_text=(
                    'Mapping of cloud provider slug to WorkflowJobTemplate pk whose survey drives '
                    'the provider-specific deploy form fields. e.g. {"digitalocean": 25, "proxmox": 21}.'
                ),
                null=True,
            ),
        ),
    ]
