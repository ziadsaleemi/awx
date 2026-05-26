import django.db.models.deletion
from django.db import migrations, models

import awx.main.fields


class Migration(migrations.Migration):

    dependencies = [
        ('main', '0218_terraform_job_timeout'),
    ]

    operations = [
        migrations.CreateModel(
            name='TerraformJobEvent',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created', models.DateTimeField(default=None, editable=False, null=True)),
                ('modified', models.DateTimeField(db_index=True, default=None, editable=False)),
                ('event_data', awx.main.fields.JSONBlob(blank=True, default=dict)),
                ('uuid', models.CharField(default='', editable=False, max_length=1024)),
                ('counter', models.PositiveIntegerField(default=0, editable=False)),
                ('stdout', models.TextField(default='', editable=False)),
                ('verbosity', models.PositiveIntegerField(default=0, editable=False)),
                ('start_line', models.PositiveIntegerField(default=0, editable=False)),
                ('end_line', models.PositiveIntegerField(default=0, editable=False)),
                ('job_created', models.DateTimeField(editable=False, null=True)),
                (
                    'terraform_job',
                    models.ForeignKey(
                        db_index=False,
                        editable=False,
                        on_delete=django.db.models.deletion.DO_NOTHING,
                        related_name='terraform_job_events',
                        to='main.terraformjob',
                    ),
                ),
            ],
            options={
                'ordering': ('-pk',),
            },
        ),
        migrations.AddIndex(
            model_name='terraformjobevent',
            index=models.Index(fields=['terraform_job', 'job_created', 'uuid'], name='main_terraformjobevent_tfj_created_uuid_idx'),
        ),
        migrations.AddIndex(
            model_name='terraformjobevent',
            index=models.Index(fields=['terraform_job', 'job_created', 'counter'], name='main_terraformjobevent_tfj_created_counter_idx'),
        ),
    ]
