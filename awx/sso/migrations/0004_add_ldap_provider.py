from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('sso', '0003_convert_saml_string_to_list'),
    ]

    operations = [
        migrations.AlterField(
            model_name='userenterpriseauth',
            name='provider',
            field=models.CharField(
                choices=[('ldap', 'LDAP'), ('radius', 'RADIUS'), ('tacacs+', 'TACACS+'), ('saml', 'SAML')],
                max_length=32,
            ),
        ),
    ]
