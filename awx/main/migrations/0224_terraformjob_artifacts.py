# Generated migration: adds artifacts JSONBlob to TerraformJob so that
# Terraform output values can be propagated to downstream workflow nodes.

from django.db import migrations

import awx.main.fields


class Migration(migrations.Migration):

    dependencies = [
        ('main', '0223_proxmox_credential_type_tf_vars'),
    ]

    operations = [
        migrations.AddField(
            model_name='terraformjob',
            name='artifacts',
            field=awx.main.fields.JSONBlob(
                blank=True,
                default=dict,
                editable=False,
                help_text=(
                    'Terraform output values captured after a successful apply. '
                    'Propagated to downstream jobs in a workflow via ancestor_artifacts.'
                ),
            ),
        ),
    ]
