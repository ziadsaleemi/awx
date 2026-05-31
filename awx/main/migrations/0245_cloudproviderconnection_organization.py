"""
Migration: add organization foreign keys to cloud provider connection/state.

Existing rows (if any) will have organization set to NULL, meaning they are
treated as global/unscoped records and remain visible only to system-level
users until an org admin explicitly claims them by setting the organization
field.
"""

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('main', '0244_catalog_ttl_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='cloudproviderconnection',
            name='organization',
            field=models.ForeignKey(
                blank=True,
                default=None,
                help_text='Organization this connection belongs to.',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='cloud_provider_connections',
                to='main.organization',
            ),
        ),
        migrations.AlterField(
            model_name='cloudproviderstate',
            name='provider_id',
            field=models.CharField(
                help_text='Identifier of the cloud provider (e.g. digitalocean).',
                max_length=64,
            ),
        ),
        migrations.AddField(
            model_name='cloudproviderstate',
            name='organization',
            field=models.ForeignKey(
                blank=True,
                default=None,
                help_text='Organization this provider state belongs to.',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='cloud_provider_states',
                to='main.organization',
            ),
        ),
        migrations.AlterModelOptions(
            name='cloudproviderstate',
            options={'ordering': ('organization_id', 'provider_id')},
        ),
        migrations.AlterUniqueTogether(
            name='cloudproviderstate',
            unique_together={('provider_id', 'organization')},
        ),
        migrations.AddConstraint(
            model_name='cloudproviderstate',
            constraint=models.UniqueConstraint(
                condition=models.Q(('organization__isnull', True)),
                fields=('provider_id',),
                name='main_cloudproviderstate_global_provider_unique',
            ),
        ),
    ]
