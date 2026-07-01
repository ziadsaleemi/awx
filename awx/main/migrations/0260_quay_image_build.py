import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('main', '0259_organization_ai_roles'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='QuayImageBuild',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created', models.DateTimeField(default=None, editable=False)),
                ('modified', models.DateTimeField(default=None, editable=False)),
                ('description', models.TextField(blank=True, default='')),
                ('project_name', models.CharField(blank=True, default='', max_length=512)),
                ('project_path', models.CharField(blank=True, default='', max_length=4096)),
                ('scm_revision', models.CharField(blank=True, default='', max_length=1024)),
                ('namespace', models.CharField(max_length=255)),
                ('repository', models.CharField(max_length=255)),
                ('tag', models.CharField(default='latest', max_length=128)),
                ('image', models.CharField(max_length=1024)),
                ('registry', models.CharField(max_length=512)),
                ('runtime', models.CharField(default='podman', max_length=16)),
                ('definition_file', models.CharField(default='execution-environment.yml', max_length=1024)),
                ('context_path', models.CharField(default='.', max_length=1024)),
                (
                    'status',
                    models.CharField(
                        choices=[
                            ('pending', 'Pending'),
                            ('running', 'Running'),
                            ('successful', 'Successful'),
                            ('failed', 'Failed'),
                            ('canceled', 'Canceled'),
                        ],
                        default='pending',
                        max_length=32,
                    ),
                ),
                ('progress', models.PositiveSmallIntegerField(default=0)),
                ('started', models.DateTimeField(blank=True, default=None, null=True)),
                ('finished', models.DateTimeField(blank=True, default=None, null=True)),
                ('error', models.TextField(blank=True, default='')),
                ('log', models.TextField(blank=True, default='')),
                ('command_summary', models.JSONField(blank=True, default=list)),
                (
                    'created_by',
                    models.ForeignKey(
                        default=None,
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='%s(class)s_created+',
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    'modified_by',
                    models.ForeignKey(
                        default=None,
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='%s(class)s_modified+',
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    'project',
                    models.ForeignKey(
                        blank=True,
                        default=None,
                        help_text='AWX Project used as the execution environment build source.',
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='quay_image_builds',
                        to='main.project',
                    ),
                ),
            ],
            options={
                'ordering': ('-created', '-id'),
                'app_label': 'main',
            },
        ),
    ]
