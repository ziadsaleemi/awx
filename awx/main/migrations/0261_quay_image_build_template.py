import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('main', '0260_quay_image_build'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='QuayImageBuildTemplate',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created', models.DateTimeField(default=None, editable=False)),
                ('modified', models.DateTimeField(default=None, editable=False)),
                ('description', models.TextField(blank=True, default='')),
                ('name', models.CharField(max_length=512, unique=True)),
                ('namespace', models.CharField(max_length=255)),
                ('repository', models.CharField(max_length=255)),
                ('tag', models.CharField(default='latest', max_length=128)),
                ('runtime', models.CharField(default='podman', max_length=16)),
                ('definition_file', models.CharField(default='execution-environment.yml', max_length=1024)),
                ('context_path', models.CharField(default='.', max_length=1024)),
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
                        related_name='quay_image_build_templates',
                        to='main.project',
                    ),
                ),
            ],
            options={
                'ordering': ('name', 'id'),
                'app_label': 'main',
            },
        ),
        migrations.AddField(
            model_name='quayimagebuild',
            name='template',
            field=models.ForeignKey(
                blank=True,
                default=None,
                help_text='Saved execution environment build template used to launch this run.',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='builds',
                to='main.quayimagebuildtemplate',
            ),
        ),
    ]
