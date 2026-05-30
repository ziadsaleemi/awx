import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('main', '0206_workflowjobnode_bypassed_job_status'),
    ]

    operations = [
        # -------------------------------------------------------- #
        # TerraformJobTemplate                                      #
        # -------------------------------------------------------- #
        migrations.CreateModel(
            name='TerraformJobTemplate',
            fields=[
                # polymorphic / UJT base — pk is provided by the parent
                (
                    'unifiedjobtemplate_ptr',
                    models.OneToOneField(
                        auto_created=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        parent_link=True,
                        primary_key=True,
                        serialize=False,
                        to='main.unifiedjobtemplate',
                    ),
                ),
                # Survey mixin fields
                ('survey_enabled', models.BooleanField(default=False)),
                ('survey_spec', models.JSONField(blank=True, default=dict)),
                ('ask_inventory_on_launch', models.BooleanField(blank=True, default=False)),
                ('ask_limit_on_launch', models.BooleanField(blank=True, default=False)),
                ('ask_scm_branch_on_launch', models.BooleanField(blank=True, default=False)),
                ('ask_labels_on_launch', models.BooleanField(blank=True, default=False)),
                ('ask_tags_on_launch', models.BooleanField(blank=True, default=False)),
                ('ask_skip_tags_on_launch', models.BooleanField(blank=True, default=False)),
                ('ask_variables_on_launch', models.BooleanField(blank=True, default=False)),
                # Terraform-specific
                (
                    'terraform_dir',
                    models.CharField(
                        blank=True,
                        default='.',
                        help_text='Path within the project to the directory containing the Terraform root module.',
                        max_length=1024,
                    ),
                ),
                (
                    'extra_vars',
                    models.TextField(
                        blank=True,
                        default='',
                        help_text='Variables to pass to Terraform as a tfvars file. Accepts JSON or YAML.',
                    ),
                ),
                (
                    'verbosity',
                    models.PositiveIntegerField(
                        blank=True,
                        choices=[
                            (0, '0 (Normal)'),
                            (1, '1 (Verbose)'),
                            (2, '2 (More Verbose)'),
                            (3, '3 (Debug)'),
                            (4, '4 (Connection Debug)'),
                            (5, '5 (WinRM Debug)'),
                        ],
                        default=0,
                        help_text='Control the level of output Terraform produces.',
                    ),
                ),
                (
                    'terraform_operation',
                    models.CharField(
                        choices=[('apply', 'Apply'), ('plan', 'Plan'), ('destroy', 'Destroy')],
                        default='apply',
                        help_text='The Terraform operation to run: apply, plan, or destroy.',
                        max_length=16,
                    ),
                ),
                (
                    'target_group',
                    models.CharField(
                        blank=True,
                        default='',
                        help_text='Inventory group to add provisioned hosts to. Created automatically if it does not exist.',
                        max_length=512,
                    ),
                ),
                (
                    'allow_simultaneous',
                    models.BooleanField(
                        default=False,
                        help_text='Allow multiple jobs from this template to run simultaneously.',
                    ),
                ),
                (
                    'timeout',
                    models.IntegerField(
                        blank=True,
                        default=0,
                        help_text='The number of seconds to run before the task is cancelled. Zero means no timeout.',
                    ),
                ),
                (
                    'ask_terraform_operation_on_launch',
                    models.BooleanField(
                        blank=True,
                        default=False,
                        help_text='Prompt the user for terraform_operation at launch time.',
                    ),
                ),
                # FKs
                (
                    'project',
                    models.ForeignKey(
                        blank=True,
                        default=None,
                        help_text='The project which contains the Terraform configuration files.',
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='terraform_job_templates',
                        to='main.project',
                    ),
                ),
                (
                    'target_inventory',
                    models.ForeignKey(
                        blank=True,
                        default=None,
                        help_text='Inventory to populate with provisioned hosts after a successful apply.',
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='terraform_job_templates',
                        to='main.inventory',
                    ),
                ),
            ],
            options={
                'ordering': ('name',),
                'permissions': [('execute_terraformjobtemplate', 'Can run this Terraform job template')],
                'default_permissions': ('change', 'delete', 'view'),
            },
            bases=('main.unifiedjobtemplate',),
        ),
        # -------------------------------------------------------- #
        # TerraformJob                                              #
        # -------------------------------------------------------- #
        migrations.CreateModel(
            name='TerraformJob',
            fields=[
                (
                    'unifiedjob_ptr',
                    models.OneToOneField(
                        auto_created=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        parent_link=True,
                        primary_key=True,
                        serialize=False,
                        to='main.unifiedjob',
                    ),
                ),
                # Survey mixin
                ('survey_passwords', models.JSONField(blank=True, default=dict, editable=False)),
                # Copied-at-launch fields
                (
                    'terraform_dir',
                    models.CharField(
                        blank=True,
                        default='.',
                        help_text='Path within the project to the Terraform root module.',
                        max_length=1024,
                    ),
                ),
                (
                    'extra_vars',
                    models.TextField(
                        blank=True,
                        default='',
                        help_text='Variables passed to Terraform as a tfvars file.',
                    ),
                ),
                (
                    'verbosity',
                    models.PositiveIntegerField(
                        blank=True,
                        choices=[
                            (0, '0 (Normal)'),
                            (1, '1 (Verbose)'),
                            (2, '2 (More Verbose)'),
                            (3, '3 (Debug)'),
                            (4, '4 (Connection Debug)'),
                            (5, '5 (WinRM Debug)'),
                        ],
                        default=0,
                        help_text='Verbosity level for Terraform output.',
                    ),
                ),
                (
                    'terraform_operation',
                    models.CharField(
                        choices=[('apply', 'Apply'), ('plan', 'Plan'), ('destroy', 'Destroy')],
                        default='apply',
                        help_text='The Terraform operation that was run: apply, plan, or destroy.',
                        max_length=16,
                    ),
                ),
                (
                    'target_group',
                    models.CharField(
                        blank=True,
                        default='',
                        help_text='Inventory group to add provisioned hosts to.',
                        max_length=512,
                    ),
                ),
                (
                    'scm_revision',
                    models.CharField(
                        blank=True,
                        default='',
                        editable=False,
                        help_text='The SCM revision of the project checked out for this job.',
                        max_length=1024,
                    ),
                ),
                # FKs
                (
                    'terraform_job_template',
                    models.ForeignKey(
                        blank=True,
                        default=None,
                        help_text='The Terraform job template that produced this job.',
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='jobs',
                        to='main.terraformjobtemplate',
                    ),
                ),
                (
                    'project',
                    models.ForeignKey(
                        blank=True,
                        default=None,
                        help_text='The project containing the Terraform configuration.',
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='terraform_jobs',
                        to='main.project',
                    ),
                ),
                (
                    'target_inventory',
                    models.ForeignKey(
                        blank=True,
                        default=None,
                        help_text='Inventory to populate with hosts after a successful apply.',
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='terraform_jobs',
                        to='main.inventory',
                    ),
                ),
            ],
            options={
                'ordering': ('id',),
            },
            bases=('main.unifiedjob',),
        ),
    ]
