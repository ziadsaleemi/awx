# Generated for AWX workflow EDA node metadata.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('main', '0248_catalog_deployment_expired_status'),
    ]

    operations = [
        migrations.AddField(
            model_name='workflowjobnode',
            name='eda_activation_id',
            field=models.CharField(blank=True, default='', max_length=128),
        ),
        migrations.AddField(
            model_name='workflowjobnode',
            name='eda_event_source',
            field=models.CharField(blank=True, default='', max_length=512),
        ),
        migrations.AddField(
            model_name='workflowjobnode',
            name='eda_event_source_status',
            field=models.CharField(blank=True, default='', max_length=64),
        ),
        migrations.AddField(
            model_name='workflowjobnode',
            name='eda_rulebook_name',
            field=models.CharField(blank=True, default='', max_length=512),
        ),
        migrations.AddField(
            model_name='workflowjobnode',
            name='node_type',
            field=models.CharField(
                choices=[('template', 'Template'), ('eda_rulebook', 'EDA rulebook activation')],
                default='template',
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name='workflowjobtemplatenode',
            name='eda_activation_id',
            field=models.CharField(blank=True, default='', max_length=128),
        ),
        migrations.AddField(
            model_name='workflowjobtemplatenode',
            name='eda_event_source',
            field=models.CharField(blank=True, default='', max_length=512),
        ),
        migrations.AddField(
            model_name='workflowjobtemplatenode',
            name='eda_event_source_status',
            field=models.CharField(blank=True, default='', max_length=64),
        ),
        migrations.AddField(
            model_name='workflowjobtemplatenode',
            name='eda_rulebook_name',
            field=models.CharField(blank=True, default='', max_length=512),
        ),
        migrations.AddField(
            model_name='workflowjobtemplatenode',
            name='node_type',
            field=models.CharField(
                choices=[('template', 'Template'), ('eda_rulebook', 'EDA rulebook activation')],
                default='template',
                max_length=32,
            ),
        ),
    ]
