from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('main', '0243_catalogdeployment_lifecycle_jobs'),
    ]

    operations = [
        # CatalogItem: default lease duration + require_lease flag
        migrations.AddField(
            model_name='catalogitem',
            name='default_lease_minutes',
            field=models.PositiveIntegerField(
                blank=True,
                null=True,
                default=None,
                help_text='Default lease duration in minutes applied to every new deployment of this item. Leave blank for no default lease.',
            ),
        ),
        migrations.AddField(
            model_name='catalogitem',
            name='require_lease',
            field=models.BooleanField(
                default=False,
                help_text='When enabled, deployers must supply a TTL before the deployment is created.',
            ),
        ),
        # CatalogDeployment: expiry timestamp + auto-deprovision flag
        migrations.AddField(
            model_name='catalogdeployment',
            name='expires_at',
            field=models.DateTimeField(
                blank=True,
                null=True,
                default=None,
                help_text='UTC datetime when this deployment lease expires.',
            ),
        ),
        migrations.AddField(
            model_name='catalogdeployment',
            name='auto_deprovision',
            field=models.BooleanField(
                default=False,
                help_text='When True and expires_at is set, the deprovision workflow is launched automatically once the lease expires.',
            ),
        ),
    ]
