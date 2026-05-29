from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('main', '0239_add_provider_deprovision_workflows'),
    ]

    operations = [
        migrations.AddField(
            model_name='catalogdeployment',
            name='target_provider',
            field=models.CharField(
                max_length=128,
                blank=True,
                default='',
                help_text='Cloud provider slug selected at deploy time, used to route deprovision to the correct workflow.',
            ),
        ),
    ]
