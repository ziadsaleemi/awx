# Generated for AWX user UI preferences.

from django.conf import settings
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('main', '0250_workflow_ai_task_node_metadata'),
    ]

    operations = [
        migrations.CreateModel(
            name='UserUISettings',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created', models.DateTimeField(default=None, editable=False)),
                ('modified', models.DateTimeField(default=None, editable=False)),
                ('ui_preferences', models.JSONField(blank=True, default=dict)),
                (
                    'user',
                    models.OneToOneField(
                        editable=False,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='ui_settings',
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
        ),
    ]
