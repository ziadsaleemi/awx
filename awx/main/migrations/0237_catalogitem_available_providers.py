from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('main', '0236_catalogitem_provider_workflows'),
    ]

    operations = [
        migrations.AddField(
            model_name='catalogitem',
            name='available_providers',
            field=models.JSONField(
                blank=True,
                null=True,
                default=None,
                help_text=(
                    'List of cloud provider slugs this catalog item is available on. '
                    'Drives the provider tabs shown to users. e.g. ["digitalocean", "proxmox", "azure"]. '
                    'If null, only providers in cloud_backends/provider_workflows are shown.'
                ),
            ),
        ),
    ]
