import json

import pytest

from awx.api.versioning import reverse


@pytest.mark.django_db
def test_terraform_launch_accepts_saved_survey_defaults(post, admin_user, terraform_job_template):
    terraform_job_template.ask_variables_on_launch = True
    terraform_job_template.survey_enabled = True
    terraform_job_template.survey_spec = {
        'name': 'Terraform survey',
        'description': '',
        'spec': [
            {
                'question_name': 'VM name',
                'variable': 'vm_name',
                'type': 'text',
                'required': True,
                'default': '',
            },
            {
                'question_name': 'CPU',
                'variable': 'cpu',
                'type': 'integer',
                'required': True,
                'default': '2',
            },
        ],
    }
    terraform_job_template.extra_vars = json.dumps({'vm_name': 'awx-demo-vsphere'})
    terraform_job_template.save()

    response = post(
        reverse('api:terraform_job_template_launch', kwargs={'pk': terraform_job_template.pk}),
        {},
        admin_user,
        expect=201,
    )

    assert response.data['id']
