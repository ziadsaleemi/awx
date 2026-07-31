import json
import subprocess

import pytest

from awx.main.utils.terraform_state import TerraformGitStateStore


def run_git(*args, cwd=None):
    return subprocess.run(
        ['git', *args],
        cwd=cwd,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    ).stdout


@pytest.mark.django_db(transaction=True)
def test_managed_git_state_publish_and_restore_round_trip(
    tmp_path,
    project,
    terraform_job_template,
):
    bare_repository = tmp_path / 'terraform-state.git'
    run_git('init', '--bare', str(bare_repository))

    project.scm_url = str(bare_repository)
    project.save(update_fields=['scm_url'])
    terraform_job_template.project = project
    terraform_job_template.state_backend = 'git'
    terraform_job_template.state_project = project
    terraform_job_template.state_branch = 'capstan-test-state'
    terraform_job_template.state_key = 'production/web'
    terraform_job_template.save()

    first_job = terraform_job_template.create_unified_job()
    first_job.status = 'running'
    first_job.save(update_fields=['status'])
    first_private_data_dir = tmp_path / 'job-1'
    first_working_dir = first_private_data_dir / 'project'
    first_working_dir.mkdir(parents=True)
    first_store = TerraformGitStateStore(
        first_job,
        str(first_private_data_dir),
        str(first_working_dir),
    )

    first_store.acquire()
    try:
        assert first_store.prepare() is None
        state = {
            'version': 4,
            'terraform_version': '1.12.2',
            'serial': 1,
            'lineage': 'lineage-1',
            'outputs': {
                'database_password': {
                    'sensitive': True,
                    'type': 'string',
                    'value': 'do-not-store-in-plaintext',
                }
            },
            'resources': [
                {
                    'mode': 'managed',
                    'type': 'test_resource',
                    'name': 'example',
                    'provider': 'test',
                    'instances': [
                        {
                            'attributes': {
                                'password': 'do-not-store-in-plaintext',
                            }
                        }
                    ],
                }
            ],
        }
        first_working_dir.joinpath('terraform.tfstate').write_text(json.dumps(state))
        revision = first_store.publish('successful')
    finally:
        first_store.release()

    encrypted_blob = subprocess.run(
        [
            'git',
            f'--git-dir={bare_repository}',
            'show',
            f'capstan-test-state:{revision.state_path}',
        ],
        check=True,
        stdout=subprocess.PIPE,
    ).stdout
    metadata = json.loads(
        run_git(
            f'--git-dir={bare_repository}',
            'show',
            f'capstan-test-state:{first_store.metadata_path}',
        )
    )

    assert b'do-not-store-in-plaintext' not in encrypted_blob
    assert metadata['serial'] == 1
    assert metadata['resource_count'] == 1
    assert 'outputs' not in metadata
    assert revision.summary['outputs'][0]['name'] == 'database_password'
    assert 'do-not-store-in-plaintext' not in str(revision.summary)

    second_job = terraform_job_template.create_unified_job()
    second_job.status = 'running'
    second_job.save(update_fields=['status'])
    second_private_data_dir = tmp_path / 'job-2'
    second_working_dir = second_private_data_dir / 'project'
    second_working_dir.mkdir(parents=True)
    second_store = TerraformGitStateStore(
        second_job,
        str(second_private_data_dir),
        str(second_working_dir),
    )

    second_store.acquire()
    try:
        restored_revision = second_store.prepare()
    finally:
        second_store.release()

    second_job.refresh_from_db()
    restored_state = json.loads(second_working_dir.joinpath('terraform.tfstate').read_text())
    assert restored_revision == revision
    assert second_job.state_revision_read == revision
    assert restored_state['serial'] == 1
    assert restored_state['outputs']['database_password']['value'] == 'do-not-store-in-plaintext'
