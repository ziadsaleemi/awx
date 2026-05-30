from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('main', '0237_catalogitem_available_providers'),
    ]

    operations = [
        migrations.AddField(
            model_name='catalogitem',
            name='provider_field_configs',
            field=models.JSONField(
                blank=True,
                null=True,
                default=None,
                help_text=(
                    'Per-provider deploy-form field configuration. '
                    'Maps provider slug to {disabled_fields: [], hidden_fields: [], field_templates: {}}.'
                ),
            ),
        ),
    ]
