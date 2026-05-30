from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('main', '0240_catalogdeployment_target_provider'),
    ]

    operations = [
        migrations.AddField(
            model_name='catalogitem',
            name='browse_enabled',
            field=models.BooleanField(
                default=True,
                help_text='When enabled, this catalog item is shown in the service catalog browse view.',
            ),
        ),
    ]
