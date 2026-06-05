import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('dab_rbac', '__first__'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('main', '0254_sync_catalog_persona_roles'),
    ]

    operations = [
        migrations.CreateModel(
            name='UserType',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created', models.DateTimeField(default=None, editable=False)),
                ('modified', models.DateTimeField(default=None, editable=False)),
                ('name', models.CharField(max_length=512, unique=True)),
                ('description', models.TextField(blank=True, default='')),
                (
                    'role_definitions',
                    models.ManyToManyField(blank=True, related_name='awx_user_types', to='dab_rbac.roledefinition'),
                ),
            ],
            options={
                'ordering': ('name',),
            },
        ),
        migrations.CreateModel(
            name='UserTypeAssignment',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created', models.DateTimeField(default=None, editable=False)),
                ('modified', models.DateTimeField(default=None, editable=False)),
                (
                    'user',
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='custom_user_type_assignment',
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                ('user_type', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='assignments', to='main.usertype')),
            ],
        ),
    ]
