from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('main', '0205_add_ordering_to_instancegroup_and_workflow_nodes'),
    ]

    operations = [
        migrations.AddField(
            model_name='workflowjobnode',
            name='bypassed_job_status',
            field=models.CharField(
                blank=True,
                default='',
                help_text=(
                    'If set, this node was carried over from a prior workflow run with this status. '
                    'It will not be re-run but will be treated as having finished with this status '
                    'for graph traversal purposes. Used by the resume-from-failure feature.'
                ),
                max_length=20,
            ),
        ),
    ]
