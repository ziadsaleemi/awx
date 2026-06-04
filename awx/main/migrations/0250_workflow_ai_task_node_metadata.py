# Generated for AWX workflow AI task node metadata.

import awx.main.fields
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('main', '0249_workflow_eda_node_metadata'),
    ]

    operations = [
        migrations.AddField(
            model_name='workflowjobnode',
            name='ai_task_approval_required',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='workflowjobnode',
            name='ai_task_model',
            field=models.CharField(blank=True, default='', max_length=128),
        ),
        migrations.AddField(
            model_name='workflowjobnode',
            name='ai_task_prompt',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='workflowjobnode',
            name='ai_task_result',
            field=awx.main.fields.JSONBlob(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='workflowjobnode',
            name='ai_task_status',
            field=models.CharField(blank=True, default='', max_length=64),
        ),
        migrations.AddField(
            model_name='workflowjobtemplatenode',
            name='ai_task_approval_required',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='workflowjobtemplatenode',
            name='ai_task_model',
            field=models.CharField(blank=True, default='', max_length=128),
        ),
        migrations.AddField(
            model_name='workflowjobtemplatenode',
            name='ai_task_prompt',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='workflowjobtemplatenode',
            name='ai_task_result',
            field=awx.main.fields.JSONBlob(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='workflowjobtemplatenode',
            name='ai_task_status',
            field=models.CharField(blank=True, default='', max_length=64),
        ),
        migrations.AlterField(
            model_name='workflowjobnode',
            name='node_type',
            field=models.CharField(
                choices=[('template', 'Template'), ('eda_rulebook', 'EDA rulebook activation'), ('ai_task', 'AI task')],
                default='template',
                max_length=32,
            ),
        ),
        migrations.AlterField(
            model_name='workflowjobtemplatenode',
            name='node_type',
            field=models.CharField(
                choices=[('template', 'Template'), ('eda_rulebook', 'EDA rulebook activation'), ('ai_task', 'AI task')],
                default='template',
                max_length=32,
            ),
        ),
    ]
