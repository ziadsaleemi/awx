# -*- coding: utf-8 -*-
"""
Unit tests for awx.main.tasks.terraform.RunTerraformJob

These tests run without a database (no @pytest.mark.django_db) and rely
entirely on mocks.
"""

import json
from unittest import mock

import pytest

from awx.main.tasks.terraform import RunTerraformJob, _HOST_IP_KEY_RE, _first_string_output

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_task():
    """Return a RunTerraformJob instance with all external dependencies mocked."""
    task = RunTerraformJob.__new__(RunTerraformJob)
    task.instance = None
    task.cleanup_paths = []
    task.update_attempts = 3
    task.runner_callback = mock.MagicMock()
    task.lock_fd = None
    return task


def _make_instance(
    pk=1,
    terraform_operation='apply',
    terraform_dir='.',
    extra_vars='',
    target_inventory_id=None,
    target_group='',
    project_id=1,
    cancel_flag=False,
    status='running',
    scm_revision='',
):
    inst = mock.MagicMock()
    inst.pk = pk
    inst.id = pk
    inst.terraform_operation = terraform_operation
    inst.terraform_dir = terraform_dir
    inst.extra_vars = extra_vars
    inst.target_inventory_id = target_inventory_id
    inst.target_group = target_group
    inst.project_id = project_id
    inst.cancel_flag = cancel_flag
    inst.status = status
    inst.scm_revision = scm_revision
    inst.log_format = f'TerraformJob pk={pk}'
    inst.log_lifecycle = mock.MagicMock()
    inst.websocket_emit_status = mock.MagicMock()
    inst.send_notification_templates = mock.MagicMock()
    inst.spawned_by_workflow = False
    inst.unifiedjob_blocked_jobs = mock.MagicMock()
    inst.unifiedjob_blocked_jobs.exists.return_value = False
    return inst


# ---------------------------------------------------------------------------
# _HOST_IP_KEY_RE
# ---------------------------------------------------------------------------


def test_host_ip_regex_matches():
    assert _HOST_IP_KEY_RE.search('host_ip_web')
    assert _HOST_IP_KEY_RE.search('host_ip')
    assert _HOST_IP_KEY_RE.search('HOST_IP_DB')  # case-insensitive


def test_host_ip_regex_no_match():
    assert not _HOST_IP_KEY_RE.search('web_host_ip')
    assert not _HOST_IP_KEY_RE.search('instance_id')


def test_first_string_output_returns_first_present_value():
    outputs = {'cloud_init_user': 'ansible', 'admin_username': 'azureuser'}

    assert _first_string_output(outputs, ('ansible_user', 'cloud_init_user')) == 'ansible'


def test_first_string_output_ignores_empty_and_non_string_values():
    outputs = {'cloud_init_user': '', 'admin_username': ['azureuser'], 'ssh_user': 'deployer'}

    assert _first_string_output(outputs, ('cloud_init_user', 'admin_username', 'ssh_user')) == 'deployer'


# ---------------------------------------------------------------------------
# _write_tfvars
# ---------------------------------------------------------------------------


class TestWriteTfvars:
    def test_empty_extra_vars_returns_none(self, tmp_path):
        task = _make_task()
        inst = _make_instance(extra_vars='')
        result = task._write_tfvars(inst, str(tmp_path))
        assert result is None

    def test_json_extra_vars_writes_file(self, tmp_path):
        task = _make_task()
        inst = _make_instance(extra_vars='{"region": "us-east-1"}')
        path = task._write_tfvars(inst, str(tmp_path))
        assert path is not None
        with open(path) as f:
            data = json.load(f)
        assert data == {'region': 'us-east-1'}

    def test_yaml_extra_vars_writes_file(self, tmp_path):
        task = _make_task()
        inst = _make_instance(extra_vars='region: us-west-2\nenv: prod')
        path = task._write_tfvars(inst, str(tmp_path))
        assert path is not None
        with open(path) as f:
            data = json.load(f)
        assert data['region'] == 'us-west-2'
        assert data['env'] == 'prod'

    def test_non_dict_extra_vars_returns_none(self, tmp_path):
        task = _make_task()
        inst = _make_instance(extra_vars='["not", "a", "dict"]')
        result = task._write_tfvars(inst, str(tmp_path))
        assert result is None

    def test_unparseable_extra_vars_returns_none(self, tmp_path):
        task = _make_task()
        inst = _make_instance(extra_vars='{not valid json: and not valid yaml:')
        result = task._write_tfvars(inst, str(tmp_path))
        assert result is None

    def test_filters_undeclared_variables_to_root_module(self, tmp_path):
        (tmp_path / 'main.tf').write_text('variable "region" {\n  type = string\n}\n')
        task = _make_task()
        inst = _make_instance(extra_vars='{"region": "us-east-1", "vm_id": "1234"}')

        path = task._write_tfvars(inst, str(tmp_path))

        assert path is not None
        with open(path) as f:
            data = json.load(f)
        assert data == {'region': 'us-east-1'}

    def test_skips_tfvars_when_root_module_declares_no_variables(self, tmp_path):
        (tmp_path / 'main.tf').write_text('terraform {}\n')
        task = _make_task()
        inst = _make_instance(extra_vars='{"region": "us-east-1"}')

        path = task._write_tfvars(inst, str(tmp_path))

        assert path is None


# ---------------------------------------------------------------------------
# local state warning helpers
# ---------------------------------------------------------------------------


class TestLocalStateWarning:
    def test_no_backend_block_defaults_to_local(self, tmp_path):
        (tmp_path / 'main.tf').write_text('resource "null_resource" "x" {}\n')
        task = _make_task()

        kind = task._root_terraform_backend_kind(str(tmp_path))

        assert kind == 'local'

    def test_explicit_local_backend_detected(self, tmp_path):
        (tmp_path / 'main.tf').write_text('terraform {\n  backend "local" {}\n}\n')
        task = _make_task()

        kind = task._root_terraform_backend_kind(str(tmp_path))

        assert kind == 'local'

    def test_remote_backend_detected(self, tmp_path):
        (tmp_path / 'main.tf').write_text('terraform {\n  backend "s3" {}\n}\n')
        task = _make_task()

        kind = task._root_terraform_backend_kind(str(tmp_path))

        assert kind == 'remote'

    def test_tfjson_backend_detected(self, tmp_path):
        (tmp_path / 'main.tf.json').write_text(
            json.dumps(
                {
                    'terraform': {
                        'backend': {
                            'azurerm': {},
                        }
                    }
                }
            )
        )
        task = _make_task()

        kind = task._root_terraform_backend_kind(str(tmp_path))

        assert kind == 'remote'

    def test_warning_emitted_for_destroy_on_local_backend(self, tmp_path):
        (tmp_path / 'main.tf').write_text('terraform {}\n')
        task = _make_task()

        warning = task._local_state_warning_message(str(tmp_path), 'destroy')

        assert warning is not None
        assert 'destroy/deprovision' in warning

    def test_warning_not_emitted_for_remote_backend(self, tmp_path):
        (tmp_path / 'main.tf').write_text('terraform {\n  backend "gcs" {}\n}\n')
        task = _make_task()

        warning = task._local_state_warning_message(str(tmp_path), 'destroy')

        assert warning is None


# ---------------------------------------------------------------------------
# _run_terraform
# ---------------------------------------------------------------------------


class TestRunTerraform:
    """Tests for the terraform subprocess orchestration."""

    def _make_popen(self, rc, stdout_text):
        proc = mock.MagicMock()
        proc.returncode = rc
        proc.communicate.return_value = (stdout_text.encode(), b'')
        return proc

    @mock.patch('awx.main.tasks.terraform.subprocess.Popen')
    def test_plan_operation_runs_init_then_plan(self, mock_popen, tmp_path):
        task = _make_task()
        inst = _make_instance(terraform_operation='plan')
        inst_timeout = mock.patch.object(task, 'get_instance_timeout', return_value=0)

        mock_popen.side_effect = [
            self._make_popen(0, 'Initializing...'),  # init
            self._make_popen(0, 'Plan: 1 to add.'),  # plan
        ]
        with inst_timeout:
            with mock.patch('awx.main.tasks.terraform.tempfile.mkdtemp', return_value=str(tmp_path / 'tfplan')):
                (tmp_path / 'tfplan').mkdir()
                rc, output, _ = task._run_terraform(inst, str(tmp_path), {})

        assert rc == 0
        assert 'terraform init' in output
        assert 'terraform plan' in output
        # Exactly 2 subprocess calls: init + plan
        assert mock_popen.call_count == 2

    @mock.patch('awx.main.tasks.terraform.subprocess.Popen')
    def test_apply_operation_runs_init_plan_apply(self, mock_popen, tmp_path):
        task = _make_task()
        inst = _make_instance(terraform_operation='apply')

        mock_popen.side_effect = [
            self._make_popen(0, 'Initializing...'),  # init
            self._make_popen(0, 'Plan: 1 to add.'),  # plan
            self._make_popen(0, 'Apply complete!'),  # apply
        ]
        with mock.patch.object(task, 'get_instance_timeout', return_value=0):
            with mock.patch('awx.main.tasks.terraform.tempfile.mkdtemp', return_value=str(tmp_path / 'tfplan')):
                (tmp_path / 'tfplan').mkdir()
                rc, output, _ = task._run_terraform(inst, str(tmp_path), {})

        assert rc == 0
        assert 'terraform apply' in output
        assert mock_popen.call_count == 3

    @mock.patch('awx.main.tasks.terraform.subprocess.Popen')
    def test_destroy_operation_runs_init_then_destroy(self, mock_popen, tmp_path):
        task = _make_task()
        inst = _make_instance(terraform_operation='destroy')

        mock_popen.side_effect = [
            self._make_popen(0, 'Initializing...'),
            self._make_popen(0, 'Destroy complete!'),
        ]
        with mock.patch.object(task, 'get_instance_timeout', return_value=0):
            with mock.patch('awx.main.tasks.terraform.tempfile.mkdtemp', return_value=str(tmp_path / 'tfplan')):
                (tmp_path / 'tfplan').mkdir()
                rc, output, _ = task._run_terraform(inst, str(tmp_path), {})

        assert rc == 0
        assert 'terraform destroy' in output

    @mock.patch('awx.main.tasks.terraform.subprocess.Popen')
    def test_init_failure_stops_pipeline(self, mock_popen, tmp_path):
        """If terraform init fails, plan/apply should NOT run."""
        task = _make_task()
        inst = _make_instance(terraform_operation='apply')

        mock_popen.side_effect = [
            self._make_popen(1, 'Error: provider not found'),  # init fails
        ]
        with mock.patch.object(task, 'get_instance_timeout', return_value=0):
            with mock.patch('awx.main.tasks.terraform.tempfile.mkdtemp', return_value=str(tmp_path / 'tfplan')):
                (tmp_path / 'tfplan').mkdir()
                rc, output, _ = task._run_terraform(inst, str(tmp_path), {})

        assert rc == 1
        # Only init ran
        assert mock_popen.call_count == 1


# ---------------------------------------------------------------------------
# _populate_inventory
# ---------------------------------------------------------------------------


class TestPopulateInventory:
    def _terraform_output(self, entries):
        """Build a fake ``terraform output -json`` payload."""
        return json.dumps({k: {'value': v, 'type': 'string'} for k, v in entries.items()})

    def test_skips_when_no_target_inventory(self):
        task = _make_task()
        inst = _make_instance(target_inventory_id=None)
        # Should return immediately without any subprocess calls
        with mock.patch.object(task, '_run_cmd') as mock_run:
            task._populate_inventory(inst, '/tmp', {})
        mock_run.assert_not_called()

    @mock.patch('awx.main.tasks.terraform.Group')
    @mock.patch('awx.main.tasks.terraform.Host')
    @mock.patch('awx.main.tasks.terraform.Inventory')
    def test_creates_hosts_from_host_ip_outputs(self, mock_inventory_cls, mock_host_cls, mock_group_cls):
        task = _make_task()
        inst = _make_instance(target_inventory_id=42, target_group='')

        mock_inventory = mock.MagicMock()
        mock_inventory_cls.objects.get.return_value = mock_inventory

        mock_host = mock.MagicMock()
        mock_host_cls.objects.get_or_create.return_value = (mock_host, True)

        tf_output = self._terraform_output({'host_ip_web': '10.0.0.1'})

        with mock.patch.object(task, 'get_instance_timeout', return_value=0):
            with mock.patch.object(task, '_run_cmd', return_value=(0, tf_output)):
                from unittest.mock import patch

                with patch('awx.main.tasks.terraform.transaction') as mock_txn:
                    mock_txn.atomic.return_value.__enter__ = mock.MagicMock(return_value=None)
                    mock_txn.atomic.return_value.__exit__ = mock.MagicMock(return_value=False)
                    task._populate_inventory(inst, '/tmp', {})

        mock_host_cls.objects.get_or_create.assert_called_once_with(
            inventory=mock_inventory,
            name='10.0.0.1',
            defaults={
                'variables': json.dumps(
                    {'ansible_host': '10.0.0.1', 'ansible_remote_tmp': '/tmp/ansible', 'terraform_output_key': 'host_ip_web', 'terraform_job_id': 1}
                )
            },
        )

    @mock.patch('awx.main.tasks.terraform.Group')
    @mock.patch('awx.main.tasks.terraform.Host')
    @mock.patch('awx.main.tasks.terraform.Inventory')
    def test_creates_hosts_with_terraform_ansible_user_output(self, mock_inventory_cls, mock_host_cls, mock_group_cls):
        task = _make_task()
        inst = _make_instance(target_inventory_id=42, target_group='')

        mock_inventory = mock.MagicMock()
        mock_inventory_cls.objects.get.return_value = mock_inventory
        mock_host = mock.MagicMock()
        mock_host_cls.objects.get_or_create.return_value = (mock_host, True)

        tf_output = self._terraform_output({'host_ip_web': '10.0.0.1', 'cloud_init_user': 'ansible'})

        with mock.patch.object(task, 'get_instance_timeout', return_value=0):
            with mock.patch.object(task, '_run_cmd', return_value=(0, tf_output)):
                with mock.patch('awx.main.tasks.terraform.transaction') as mock_txn:
                    mock_txn.atomic.return_value.__enter__ = mock.MagicMock(return_value=None)
                    mock_txn.atomic.return_value.__exit__ = mock.MagicMock(return_value=False)
                    task._populate_inventory(inst, '/tmp', {})

        variables = json.loads(mock_host_cls.objects.get_or_create.call_args.kwargs['defaults']['variables'])
        assert variables['ansible_host'] == '10.0.0.1'
        assert variables['ansible_user'] == 'ansible'
        assert variables['ansible_remote_tmp'] == '/tmp/ansible'

    def test_skips_when_no_host_ip_outputs(self):
        task = _make_task()
        inst = _make_instance(target_inventory_id=42)

        tf_output = json.dumps({'instance_id': {'value': 'i-12345', 'type': 'string'}})

        with mock.patch.object(task, 'get_instance_timeout', return_value=0):
            with mock.patch.object(task, '_run_cmd', return_value=(0, tf_output)):
                with mock.patch('awx.main.tasks.terraform.Inventory') as mock_inv:
                    mock_inv.objects.get.return_value = mock.MagicMock()
                    with mock.patch('awx.main.tasks.terraform.Host') as mock_host:
                        task._populate_inventory(inst, '/tmp', {})
                        mock_host.objects.get_or_create.assert_not_called()

    def test_skips_when_terraform_output_fails(self):
        task = _make_task()
        inst = _make_instance(target_inventory_id=42)

        with mock.patch.object(task, 'get_instance_timeout', return_value=0):
            with mock.patch.object(task, '_run_cmd', return_value=(1, 'Error: ...')):
                with mock.patch('awx.main.tasks.terraform.Host') as mock_host:
                    task._populate_inventory(inst, '/tmp', {})
                    mock_host.objects.get_or_create.assert_not_called()

    def test_handles_list_of_ips(self):
        """host_ip_* value may be a list of IP strings."""
        task = _make_task()
        inst = _make_instance(target_inventory_id=42, target_group='')

        tf_output = json.dumps({'host_ip_nodes': {'value': ['10.0.0.1', '10.0.0.2'], 'type': 'list'}})

        with mock.patch.object(task, 'get_instance_timeout', return_value=0):
            with mock.patch.object(task, '_run_cmd', return_value=(0, tf_output)):
                with mock.patch('awx.main.tasks.terraform.Inventory') as mock_inv:
                    mock_inv.objects.get.return_value = mock.MagicMock()
                    with mock.patch('awx.main.tasks.terraform.Host') as mock_host:
                        mock_host.objects.get_or_create.return_value = (mock.MagicMock(), True)
                        with mock.patch('awx.main.tasks.terraform.transaction') as mock_txn:
                            mock_txn.atomic.return_value.__enter__ = mock.MagicMock(return_value=None)
                            mock_txn.atomic.return_value.__exit__ = mock.MagicMock(return_value=False)
                            task._populate_inventory(inst, '/tmp', {})

        # Both IPs should have been registered
        assert mock_host.objects.get_or_create.call_count == 2
        created_names = {call.kwargs['name'] for call in mock_host.objects.get_or_create.call_args_list}
        assert created_names == {'10.0.0.1', '10.0.0.2'}


# ---------------------------------------------------------------------------
# run() – high-level status transitions
# ---------------------------------------------------------------------------


class TestRunStatusTransitions:
    """Test that run() sets the correct terminal status."""

    def _setup_run(self, task, inst, private_data_dir, terraform_rc=0):
        """Wire up all mocks needed for a complete run() call."""
        task.update_model = mock.MagicMock(return_value=inst)
        task.build_private_data_dir = mock.MagicMock(return_value=private_data_dir)
        task.sync_and_copy = mock.MagicMock()
        task._write_tfvars = mock.MagicMock(return_value=None)
        task._build_env = mock.MagicMock(return_value=({}, {}))
        task._run_terraform = mock.MagicMock(return_value=(terraform_rc, 'output text', None))
        task._populate_inventory = mock.MagicMock()

    def test_successful_apply_marks_job_successful(self, tmp_path):
        task = _make_task()
        inst = _make_instance(
            terraform_operation='apply',
            target_inventory_id=None,
        )
        # Make project directory exist
        project_dir = tmp_path / 'project'
        project_dir.mkdir()

        self._setup_run(task, inst, str(tmp_path), terraform_rc=0)

        task.run(1)

        # update_model called with status='successful'
        update_calls = task.update_model.call_args_list
        final_call = update_calls[-1]
        assert final_call == mock.call(1, status='successful')
        inst.websocket_emit_status.assert_called_with('successful')

    def test_failed_terraform_marks_job_failed(self, tmp_path):
        task = _make_task()
        inst = _make_instance(
            terraform_operation='plan',
            target_inventory_id=None,
        )
        project_dir = tmp_path / 'project'
        project_dir.mkdir()

        self._setup_run(task, inst, str(tmp_path), terraform_rc=1)

        task.run(1)

        update_calls = task.update_model.call_args_list
        final_call = update_calls[-1]
        assert final_call == mock.call(1, status='failed')
        inst.websocket_emit_status.assert_called_with('failed')

    def test_canceled_job_skips_terraform(self, tmp_path):
        task = _make_task()
        inst = _make_instance(cancel_flag=True, status='running')
        task.update_model = mock.MagicMock(return_value=inst)
        task._run_terraform = mock.MagicMock()

        task.run(1)

        task._run_terraform.assert_not_called()
        inst.websocket_emit_status.assert_called_with('canceled')

    def test_inventory_populated_on_successful_apply_with_target(self, tmp_path):
        task = _make_task()
        inst = _make_instance(
            terraform_operation='apply',
            target_inventory_id=99,
        )
        project_dir = tmp_path / 'project'
        project_dir.mkdir()

        self._setup_run(task, inst, str(tmp_path), terraform_rc=0)

        task.run(1)

        task._populate_inventory.assert_called_once()

    def test_inventory_not_populated_on_plan(self, tmp_path):
        task = _make_task()
        inst = _make_instance(
            terraform_operation='plan',
            target_inventory_id=99,
        )
        project_dir = tmp_path / 'project'
        project_dir.mkdir()

        self._setup_run(task, inst, str(tmp_path), terraform_rc=0)

        task.run(1)

        task._populate_inventory.assert_not_called()
