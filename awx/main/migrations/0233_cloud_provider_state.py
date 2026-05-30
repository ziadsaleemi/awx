# Generated migration for CloudProviderConnection and CloudProviderState models.

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('main', '0232_digitalocean_credential_type'),
    ]

    operations = [
        migrations.CreateModel(
            name='CloudProviderConnection',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('provider_id', models.CharField(help_text='Identifier of the cloud provider (e.g. digitalocean, azure, proxmox).', max_length=64)),
                ('name', models.CharField(help_text='Human-readable display name for this connection.', max_length=512)),
                ('status', models.CharField(
                    choices=[('connected', 'Connected'), ('disconnected', 'Disconnected'), ('misconfigured', 'Misconfigured')],
                    default='disconnected',
                    max_length=32,
                )),
                ('credential', models.ForeignKey(
                    blank=True,
                    default=None,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='cloud_provider_connections',
                    to='main.credential',
                )),
                ('credential_name', models.CharField(blank=True, default='', help_text='Cached display name of the credential.', max_length=512)),
                ('error', models.TextField(blank=True, default='', help_text='Last error message, if any.')),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'ordering': ('provider_id', 'name'),
                'app_label': 'main',
            },
        ),
        migrations.CreateModel(
            name='CloudProviderState',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('provider_id', models.CharField(
                    help_text='Identifier of the cloud provider (e.g. digitalocean).',
                    max_length=64,
                    unique=True,
                )),
                ('pulled_at', models.DateTimeField(blank=True, default=None, null=True, help_text='Timestamp of the last successful data pull.')),
                ('provider_data', models.JSONField(blank=True, default=None, null=True, help_text='Raw pulled resource data.')),
                ('admin_settings', models.JSONField(blank=True, default=None, null=True, help_text='Admin allow-list settings for this provider.')),
                ('provider_settings', models.JSONField(blank=True, default=None, null=True, help_text='General provider settings.')),
            ],
            options={
                'ordering': ('provider_id',),
                'app_label': 'main',
            },
        ),
    ]
