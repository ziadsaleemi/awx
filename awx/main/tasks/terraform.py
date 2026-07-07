"""
awx/main/tasks/terraform.py
---------------------------
Task runner for TerraformJob.

Sprint 2: real Terraform subprocess execution.
  - Syncs the SCM project (inherits SourceControlMixin)
  - Writes extra_vars as an auto-loaded tfvars file
  - Injects cloud-provider env vars from attached credentials
  - Runs: terraform init -> terraform plan -> terraform apply/destroy
  - Populates target inventory from ``terraform output -json`` after
    a successful apply (host_ip_* output variables -> AWX Host records)
"""

# stdlib
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import time
import traceback
import uuid as _uuid

# third-party
import yaml

# Django
from django.conf import settings
from django.db import transaction

# Dispatcherd
from dispatcherd.publish import task

# AWX
from awx.main.dispatch import get_task_queuename
from awx.main.models import Group, Host, Inventory
from awx.main.models.credential import build_safe_env
from awx.main.models.terraform import TerraformJob
from awx.main.tasks.jobs import AWX_DEFAULT_REMOTE_TMP, RunProjectUpdate, SourceControlMixin, with_path_cleanup
from awx.main.tasks.signals import signal_callback, with_signal_handling
from awx.main.tasks.terraform_credentials import TerraformProviderInjector

logger = logging.getLogger('awx.main.tasks.terraform')

# Match any Terraform output key that starts with "host_ip"
_HOST_IP_KEY_RE = re.compile(r'^host_ip', re.IGNORECASE)
_ANSIBLE_USER_OUTPUT_KEYS = ('ansible_user', 'vm_ssh_user', 'ssh_user', 'cloud_init_user', 'admin_username')
_TF_VARIABLE_NAME_RE = re.compile(r'^[a-zA-Z_][a-zA-Z0-9_]*$')
_TF_VARIABLE_BLOCK_RE = re.compile(r'(^|\n)\s*variable\s+"([a-zA-Z_][a-zA-Z0-9_]*)"\s*\{')
_TF_BACKEND_BLOCK_RE = re.compile(r'(^|\n)\s*backend\s+"([a-zA-Z0-9_\-]+)"\s*\{')


def _first_string_output(outputs, keys):
    for key in keys:
        value = outputs.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ''


# ---------------------------------------------------------------------------
# Container runtime / default execution environment
# ---------------------------------------------------------------------------


class _DefaultTerraformEE:
    """
    Minimal stand-in for an ExecutionEnvironment model instance.

    Used when no explicit EE is configured on the TerraformJobTemplate/Job.
    Runs Terraform inside the official ``hashicorp/terraform`` image so the
    AWX execution node itself does NOT need Terraform installed locally —
    the image is pulled on first use, then cached.
    """

    image = 'docker.io/hashicorp/terraform:latest'
    pull = 'missing'  # pull only if not already present in local cache


def _container_runtime() -> str:
    """
    Return the first available container runtime binary on PATH.

    Prefers ``docker`` (the native runtime for hashicorp/terraform images),
    and falls back to ``podman`` for environments where Docker is absent.
    If neither is found the name ``docker`` is returned so the subsequent
    subprocess call fails with a recognisable "command not found" message.
    """
    for runtime in ('docker', 'podman'):
        if shutil.which(runtime):
            return runtime
    return 'docker'


def _image_uses_terraform_entrypoint(image: str) -> bool:
    """
    Return True for official or mirrored hashicorp/terraform images.

    Those images ship with ``ENTRYPOINT ["terraform"]``.  AWX passes the full
    Terraform command itself (``terraform init`` / ``terraform plan`` / ...),
    so the container entrypoint must be cleared or Docker executes
    ``terraform terraform init``.
    """
    repository = (image or '').split('@', 1)[0]
    tag_separator = repository.rfind(':')
    last_separator = repository.rfind('/')
    if tag_separator > last_separator:
        repository = repository[:tag_separator]
    return repository == 'hashicorp/terraform' or repository.endswith('/hashicorp/terraform')


@task(queue=get_task_queuename)
class RunTerraformJob(SourceControlMixin):
    """
    Executes a TerraformJob: syncs the SCM project, injects cloud-provider
    env vars from attached credentials, runs terraform init/plan/apply (or
    destroy), and optionally populates the target inventory from Terraform
    output variables.
    """

    model = TerraformJob
    event_model = None

    # ------------------------------------------------------------------
    # SourceControlMixin override
    # ------------------------------------------------------------------

    def sync_and_copy_without_lock(self, project, private_data_dir, scm_branch=None):
        """
        Simplified version for TerraformJob.

        The standard implementation from SourceControlMixin tries to link a
        project_update (for Job) or source_project_update (for InventoryUpdate)
        back to the running instance.  TerraformJob has neither field, so we
        run the sync without that back-reference.
        """
        sync_needs = self.get_sync_needs(project, scm_branch=scm_branch)

        if sync_needs:
            local_project_sync = self.spawn_project_sync(project, sync_needs, scm_branch=scm_branch)
            try:
                sync_task = RunProjectUpdate(job_private_data_dir=private_data_dir)
                sync_task.instance = local_project_sync  # skip "waiting" status check
                sync_task.run(local_project_sync.id)
                local_project_sync.refresh_from_db()
                self.instance = self.update_model(self.instance.pk, scm_revision=local_project_sync.scm_revision)
            except Exception:
                local_project_sync.refresh_from_db()
                if local_project_sync.status != 'canceled':
                    self.instance = self.update_model(
                        self.instance.pk,
                        status='failed',
                        job_explanation=(
                            'Previous Task Failed: {"job_type": "project_update", '
                            f'"job_name": "{local_project_sync.name}", "job_id": "{local_project_sync.id}"}}'
                        ),
                    )
                    raise
                self.instance.refresh_from_db()
                if self.instance.cancel_flag:
                    return
        else:
            self.instance = self.update_model(self.instance.pk, scm_revision=project.scm_revision)
            RunProjectUpdate.make_local_copy(project, private_data_dir)

    # ------------------------------------------------------------------
    # Credentials
    # ------------------------------------------------------------------

    def build_credentials_list(self, instance):
        return list(instance.credentials.prefetch_related('credential_type').all())

    def _build_env(self, instance, private_data_dir):
        """
        Collect environment variables contributed by attached credentials.
        Returns (env dict, safe_env dict for logging).
        """
        env = dict(os.environ)
        safe_env = build_safe_env(env)
        for credential in self.build_credentials_list(instance):
            credential.credential_type.inject_credential(credential, env, safe_env, args=[], private_data_dir=private_data_dir)
            # Apply any Python-level injector registered for this credential type
            # (no-op when only template-based injection is needed).
            TerraformProviderInjector.apply_all(credential, env, safe_env, private_data_dir)
        return env, safe_env

    # ------------------------------------------------------------------
    # Extra-vars -> tfvars
    # ------------------------------------------------------------------

    def _iter_root_terraform_files(self, working_dir):
        try:
            entries = os.listdir(working_dir)
        except OSError:
            return

        for name in entries:
            path = os.path.join(working_dir, name)
            if not os.path.isfile(path):
                continue
            if name.endswith('.tf') or name.endswith('.tf.json'):
                yield path

    def _extract_tfjson_backend_names(self, data):
        backend_names = set()
        if not isinstance(data, dict):
            return backend_names

        terraform_blocks = data.get('terraform')
        if isinstance(terraform_blocks, dict):
            terraform_blocks = [terraform_blocks]
        elif not isinstance(terraform_blocks, list):
            return backend_names

        for block in terraform_blocks:
            if not isinstance(block, dict):
                continue
            backends = block.get('backend')
            if isinstance(backends, dict):
                backends = [backends]
            elif not isinstance(backends, list):
                continue
            for backend in backends:
                if isinstance(backend, dict):
                    for name in backend.keys():
                        if isinstance(name, str) and name:
                            backend_names.add(name)

        return backend_names

    def _root_terraform_backend_kind(self, working_dir):
        """
        Return Terraform backend kind for the root module in ``working_dir``.

        Returns:
          - ``'local'`` when backend is implicit local (no backend block)
            or explicitly ``backend \"local\"``
          - ``'remote'`` when any non-local backend is declared
          - ``None`` when no root Terraform files are present/readable
        """
        scanned = False
        backend_names = set()

        for path in self._iter_root_terraform_files(working_dir):
            scanned = True
            if path.endswith('.tf'):
                try:
                    with open(path, 'r') as fh:
                        content = fh.read()
                except OSError:
                    continue
                for _full, backend_name in _TF_BACKEND_BLOCK_RE.findall(content):
                    backend_names.add(backend_name)

            elif path.endswith('.tf.json'):
                try:
                    with open(path, 'r') as fh:
                        data = json.load(fh)
                except (OSError, ValueError, TypeError):
                    continue
                backend_names.update(self._extract_tfjson_backend_names(data))

        if not scanned:
            return None

        if not backend_names:
            return 'local'

        if any(name != 'local' for name in backend_names):
            return 'remote'

        return 'local'

    def _local_state_warning_message(self, working_dir, operation):
        backend_kind = self._root_terraform_backend_kind(working_dir)
        if backend_kind != 'local':
            return None

        action = 'destroy/deprovision' if operation == 'destroy' else operation
        return (
            'WARNING: Terraform root module appears to use local state. '
            'AWX runs jobs in ephemeral working directories, so '
            f'{action} may show no changes or miss resources created by earlier runs. '
            'Configure a remote backend (for example S3, AzureRM, GCS, or Terraform Cloud) '
            'to persist state across runs.'
        )

    def _get_declared_root_variables(self, working_dir):
        """
        Return ``(declared, scanned)`` for variables declared by the *root*
        Terraform module in ``working_dir``.

        - ``declared``: set of variable names
        - ``scanned``: True when at least one root ``.tf`` / ``.tf.json`` file
          was found and inspected
        """
        declared = set()
        scanned = False

        for path in self._iter_root_terraform_files(working_dir):
            if path.endswith('.tf'):
                scanned = True
                try:
                    with open(path, 'r') as fh:
                        content = fh.read()
                except OSError:
                    continue
                for _full, var_name in _TF_VARIABLE_BLOCK_RE.findall(content):
                    declared.add(var_name)

            elif path.endswith('.tf.json'):
                scanned = True
                try:
                    with open(path, 'r') as fh:
                        data = json.load(fh)
                except (OSError, ValueError, TypeError):
                    continue
                if isinstance(data, dict):
                    variables = data.get('variable')
                    if isinstance(variables, dict):
                        for var_name in variables.keys():
                            if isinstance(var_name, str) and _TF_VARIABLE_NAME_RE.match(var_name):
                                declared.add(var_name)

        return declared, scanned

    def _write_tfvars(self, instance, working_dir):
        """
        Parse instance.extra_vars (JSON or YAML dict) and write an
        auto-loaded tfvars file (``awx.auto.tfvars.json``) so Terraform picks
        up all survey / launch-time variables.

        Returns the path of the written file, or None when extra_vars is
        empty or cannot be parsed as a dict.
        """
        raw = (instance.extra_vars or '').strip()
        if not raw:
            return None

        # Try JSON first, fall back to YAML
        try:
            data = json.loads(raw)
        except (ValueError, TypeError):
            try:
                data = yaml.safe_load(raw)
            except Exception:
                logger.warning(
                    '%s Could not parse extra_vars; skipping tfvars injection',
                    instance.log_format,
                )
                return None

        if not isinstance(data, dict):
            logger.warning(
                '%s extra_vars is not a dict; skipping tfvars injection',
                instance.log_format,
            )
            return None

        declared_vars, scanned_root_module = self._get_declared_root_variables(working_dir)
        if scanned_root_module:
            filtered = {k: v for k, v in data.items() if k in declared_vars}
            dropped = sorted(set(data.keys()) - set(filtered.keys()))
            if dropped:
                logger.info(
                    '%s skipping %d undeclared Terraform variable(s) from tfvars: %s',
                    instance.log_format,
                    len(dropped),
                    dropped,
                )
            data = filtered

            if not data:
                logger.info(
                    '%s no declared Terraform variables remain; skipping tfvars injection',
                    instance.log_format,
                )
                return None

        tfvars_path = os.path.join(working_dir, 'awx.auto.tfvars.json')
        with open(tfvars_path, 'w') as fh:
            json.dump(data, fh, indent=2)
        logger.debug(
            '%s wrote %d variable(s) to %s',
            instance.log_format,
            len(data),
            tfvars_path,
        )
        return tfvars_path

    # ------------------------------------------------------------------
    # Execution environment helpers
    # ------------------------------------------------------------------

    def _write_envvars_file(self, env, private_data_dir):
        """
        Serialise *env* to ``{private_data_dir}/env/envvars`` in KEY=VALUE
        format so podman can load them with ``--env-file``.

        Lines whose value contains embedded newlines are skipped (podman
        does not support multi-line values in env-files).

        Returns the host-side path of the file.
        """
        env_dir = os.path.join(private_data_dir, 'env')
        os.makedirs(env_dir, exist_ok=True)
        env_file = os.path.join(env_dir, 'envvars')
        with open(env_file, 'w') as fh:
            for key, val in env.items():
                val_str = str(val)
                if '\n' not in val_str and '\r' not in val_str:
                    fh.write(f'{key}={val_str}\n')
        return env_file

    def _wrap_cmd_for_ee(self, args, cwd, env, private_data_dir, ee):
        """
        Return a ``podman run`` invocation that executes *args* inside the
        execution environment container.

        ``private_data_dir`` is bind-mounted read/write at ``/runner``
        inside the container so the working-directory path is re-mapped
        accordingly.

        The env-vars written by ``_write_envvars_file`` are loaded via
        ``--env-file`` so credentials never appear in the process listing.
        """
        if cwd and cwd.startswith(private_data_dir):
            container_cwd = '/runner' + cwd[len(private_data_dir) :]
        else:
            container_cwd = '/runner'

        self._write_envvars_file(env, private_data_dir)
        pull = getattr(ee, 'pull', 'missing')
        runtime = _container_runtime()
        entrypoint_args = []
        if _image_uses_terraform_entrypoint(getattr(ee, 'image', '')):
            entrypoint_args = ['--entrypoint', '']

        container_cmd = (
            [
                runtime,
                'run',
                '--rm',
                '--volume',
                f'{private_data_dir}:/runner:Z',
                '--workdir',
                container_cwd,
                '--pull',
                pull,
                '--env-file',
                os.path.join(private_data_dir, 'env', 'envvars'),
            ]
            + entrypoint_args
            + [
                ee.image,
            ]
            + list(args)
        )

        logger.info(
            '%s using execution environment %s (runtime=%s, pull=%s)',
            self.instance.log_format,
            ee.image,
            runtime,
            pull,
        )
        return container_cmd

    # ------------------------------------------------------------------
    # Subprocess helpers
    # ------------------------------------------------------------------

    def _write_event(self, line):
        """
        Persist a single output line as a TerraformJobEvent record and push
        it over WebSocket so the UI can display it in real-time.
        """
        from django.utils.timezone import now as tz_now
        from awx.main.models.events import TerraformJobEvent, emit_event_detail

        self._event_counter += 1
        line_count = line.count('\n') or 1
        start = self._event_line_number
        end = start + line_count
        ts = tz_now()
        event = TerraformJobEvent(
            terraform_job=self.instance,
            job_created=self.instance.created,
            counter=self._event_counter,
            uuid=str(_uuid.uuid4()),
            stdout=line,
            start_line=start,
            end_line=end,
            created=ts,
            modified=ts,
        )
        event.save()
        self._event_line_number = end
        try:
            emit_event_detail(event)
        except Exception:
            logger.warning('%s emit_event_detail failed', self.instance.log_format, exc_info=True)

    def _run_cmd(self, args, cwd, env, timeout, log_prefix, private_data_dir=None, ee=None):
        """
        Run a single command; returns ``(returncode, stdout+stderr text)``.
        stderr is merged into stdout so both are captured together.
        Each output line is also written as a TerraformJobEvent for live UI
        streaming (when self._event_counter has been initialised).

        When *ee* and *private_data_dir* are provided the command is wrapped
        in a ``podman run`` invocation so it executes inside the execution
        environment container.
        """
        if ee is not None and private_data_dir is not None:
            args = self._wrap_cmd_for_ee(args, cwd, env, private_data_dir, ee)
            cwd = None  # podman --workdir handles the working directory
            env = None  # host environment is sufficient for the podman client

        logger.info('%s running: %s', log_prefix, ' '.join(str(a) for a in args))
        proc = subprocess.Popen(
            args,
            cwd=cwd,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        output_lines = []
        try:
            for raw in iter(proc.stdout.readline, b''):
                line = raw.decode('utf-8', errors='replace')
                output_lines.append(line)
                if hasattr(self, '_event_counter'):
                    self._write_event(line)
            try:
                proc.wait(timeout=timeout or None)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
                logger.warning('%s timed out after %s s', log_prefix, timeout)
        except Exception:
            proc.kill()
            proc.wait()
            raise
        return proc.returncode, ''.join(output_lines)

    def _run_terraform(self, instance, working_dir, env, private_data_dir=None):
        """
        Execute the full Terraform sequence for the requested operation.

        Returns ``(overall_returncode, combined_output_text, plan_tmpdir)``.
        ``plan_tmpdir`` is a temporary directory used to store the plan binary;
        the caller is responsible for cleaning it up.

        When *private_data_dir* is provided (the normal case) the method
        resolves the instance's execution environment and runs Terraform
        inside the EE container via podman when one is configured.
        """
        timeout = self.get_instance_timeout(instance)
        prefix = instance.log_format
        output_parts = []
        # Use the explicitly-configured EE when one is set.  When none is
        # configured, fall back to the containerised hashicorp/terraform image
        # only if ``terraform`` is not already available on PATH — this avoids
        # podman-in-Docker issues on environments (e.g. Docker Desktop on
        # Apple Silicon) where the nested container runtime cannot exec processes.
        if private_data_dir:
            ee = instance.resolve_execution_environment()
            if ee is None and shutil.which('terraform') is None:
                ee = _DefaultTerraformEE()
        else:
            ee = None

        # Plan binary lives in a temp dir on the HOST (or inside the container
        # via the /runner mount when EE is active).
        plan_tmpdir = tempfile.mkdtemp(prefix='tfplan_', dir=settings.AWX_ISOLATION_BASE_PATH)

        # When running in an EE the plan file must be reachable inside the
        # container.  Because private_data_dir is mounted at /runner, we store
        # the plan file there so both the host path and container path exist.
        if ee and private_data_dir:
            plan_tmpdir_on_host = os.path.join(private_data_dir, 'tfplan')
            os.makedirs(plan_tmpdir_on_host, exist_ok=True)
            plan_tmpdir_for_cmd = '/runner/tfplan'
        else:
            plan_tmpdir_for_cmd = plan_tmpdir

        cmd_kwargs = dict(env=env, timeout=timeout, log_prefix=prefix, private_data_dir=private_data_dir, ee=ee)

        # 1. terraform init
        if hasattr(self, '_event_counter'):
            self._write_event('=== terraform init ===\n')
        rc, text = self._run_cmd(
            ['terraform', 'init', '-no-color', '-input=false'],
            cwd=working_dir,
            **cmd_kwargs,
        )
        output_parts.append('=== terraform init ===\n' + text)
        if rc != 0:
            return rc, '\n'.join(output_parts), plan_tmpdir

        operation = instance.terraform_operation

        if operation == 'plan':
            if hasattr(self, '_event_counter'):
                self._write_event('=== terraform plan ===\n')
            rc, text = self._run_cmd(
                ['terraform', 'plan', '-no-color', '-input=false'],
                cwd=working_dir,
                **cmd_kwargs,
            )
            output_parts.append('=== terraform plan ===\n' + text)

        elif operation == 'apply':
            plan_file = os.path.join(plan_tmpdir_for_cmd, 'tfplan.out')
            # 2a. terraform plan (saves binary plan)
            if hasattr(self, '_event_counter'):
                self._write_event('=== terraform plan ===\n')
            rc, text = self._run_cmd(
                ['terraform', 'plan', '-no-color', '-input=false', f'-out={plan_file}'],
                cwd=working_dir,
                **cmd_kwargs,
            )
            output_parts.append('=== terraform plan ===\n' + text)
            if rc == 0:
                # 2b. terraform apply (consumes the binary plan)
                if hasattr(self, '_event_counter'):
                    self._write_event('=== terraform apply ===\n')
                rc, text = self._run_cmd(
                    ['terraform', 'apply', '-auto-approve', '-no-color', '-input=false', plan_file],
                    cwd=working_dir,
                    **cmd_kwargs,
                )
                output_parts.append('=== terraform apply ===\n' + text)

        elif operation == 'destroy':
            if hasattr(self, '_event_counter'):
                self._write_event('=== terraform destroy ===\n')
            rc, text = self._run_cmd(
                ['terraform', 'destroy', '-auto-approve', '-no-color', '-input=false'],
                cwd=working_dir,
                **cmd_kwargs,
            )
            output_parts.append('=== terraform destroy ===\n' + text)

        return rc, '\n'.join(output_parts), plan_tmpdir

    # ------------------------------------------------------------------
    # Inventory population (A5)
    # ------------------------------------------------------------------

    def _resolve_output_ee(self, instance, private_data_dir=None):
        if not private_data_dir:
            return None
        ee = instance.resolve_execution_environment()
        if ee is None and shutil.which('terraform') is None:
            ee = _DefaultTerraformEE()
        return ee

    def _parse_terraform_output_json(self, text):
        try:
            return json.loads(text)
        except ValueError:
            # Some execution environments prepend log lines to stdout.
            # Try to recover by parsing the outermost JSON object.
            start = text.find('{')
            end = text.rfind('}')
            if start != -1 and end > start:
                try:
                    return json.loads(text[start : end + 1])
                except ValueError:
                    pass
        return None

    def _flatten_outputs(self, outputs):
        flattened = {}
        if not isinstance(outputs, dict):
            return flattened
        for key, val_obj in outputs.items():
            flattened[key] = val_obj.get('value') if isinstance(val_obj, dict) else val_obj
        return flattened

    def _has_nonempty_host_ip_output(self, flattened_outputs):
        for key, raw in flattened_outputs.items():
            if not _HOST_IP_KEY_RE.search(key):
                continue
            if isinstance(raw, list):
                if any(str(ip).strip() for ip in raw if ip):
                    return True
            elif raw and str(raw).strip():
                return True
        return False

    def _collect_terraform_outputs(self, instance, working_dir, env, private_data_dir=None, wait_for_host_ip=False):
        ee = self._resolve_output_ee(instance, private_data_dir=private_data_dir)
        timeout = self.get_instance_timeout(instance)
        attempts = 6 if wait_for_host_ip else 1
        latest_outputs = {}

        for attempt in range(1, attempts + 1):
            rc, text = self._run_cmd(
                ['terraform', 'output', '-json', '-no-color'],
                cwd=working_dir,
                env=env,
                timeout=timeout,
                log_prefix=instance.log_format,
                private_data_dir=private_data_dir,
                ee=ee,
            )
            if rc != 0:
                logger.warning(
                    '%s terraform output failed (rc=%s, attempt=%s/%s)',
                    instance.log_format,
                    rc,
                    attempt,
                    attempts,
                )
                return {}

            parsed = self._parse_terraform_output_json(text)
            if parsed is None:
                logger.warning(
                    '%s could not parse terraform output JSON (attempt=%s/%s)',
                    instance.log_format,
                    attempt,
                    attempts,
                )
                return {}

            latest_outputs = self._flatten_outputs(parsed)
            if not wait_for_host_ip or self._has_nonempty_host_ip_output(latest_outputs):
                return latest_outputs

            if attempt < attempts:
                # Refresh and retry to allow guest-agent/DHCP-reported IPs
                # to appear in output values after initial apply completion.
                self._run_cmd(
                    ['terraform', 'apply', '-refresh-only', '-auto-approve', '-no-color'],
                    cwd=working_dir,
                    env=env,
                    timeout=timeout,
                    log_prefix=instance.log_format,
                    private_data_dir=private_data_dir,
                    ee=ee,
                )
                time.sleep(10)

        return latest_outputs

    def _populate_inventory(self, instance, working_dir, env, private_data_dir=None):
        """
        After a successful ``apply``, parse ``terraform output -json`` and
        create / update Host records in ``target_inventory`` for every output
        variable whose key matches ``^host_ip``.

        Convention:
          host_ip_<name>  ->  single IP string  (e.g. "10.0.0.1")
                          ->  list of IP strings (e.g. ["10.0.0.1","10.0.0.2"])

        Hosts are named by their IP address.  Each host receives variables:
          ansible_host, terraform_output_key, terraform_job_id
        """
        if not instance.target_inventory_id:
            return

        outputs = self._collect_terraform_outputs(
            instance,
            working_dir,
            env,
            private_data_dir=private_data_dir,
            wait_for_host_ip=True,
        )

        # Extract raw values from {"key": {"value": ..., "type": ...}} structure
        host_entries = {}
        for key, raw in outputs.items():
            if not _HOST_IP_KEY_RE.search(key):
                continue
            if isinstance(raw, list):
                ips = [str(ip).strip() for ip in raw if ip]
            elif raw:
                ips = [str(raw).strip()]
            else:
                ips = []
            for ip in ips:
                host_entries.setdefault(key, []).append(ip)

        if not host_entries:
            logger.info(
                '%s no host_ip_* outputs found; nothing to add to inventory',
                instance.log_format,
            )
            return

        host_connection_vars = {'ansible_remote_tmp': AWX_DEFAULT_REMOTE_TMP}
        ansible_user = _first_string_output(outputs, _ANSIBLE_USER_OUTPUT_KEYS)
        if ansible_user:
            host_connection_vars['ansible_user'] = ansible_user

        try:
            inventory = Inventory.objects.get(pk=instance.target_inventory_id)
        except Inventory.DoesNotExist:
            logger.warning(
                '%s target inventory pk=%s not found; skipping',
                instance.log_format,
                instance.target_inventory_id,
            )
            return

        group = None
        if instance.target_group:
            group, _ = Group.objects.get_or_create(
                inventory=inventory,
                name=instance.target_group,
            )

        host_count = 0
        with transaction.atomic():
            for key, ips in host_entries.items():
                for ip in ips:
                    host, created = Host.objects.get_or_create(
                        inventory=inventory,
                        name=ip,
                        defaults={
                            'variables': json.dumps(
                                {
                                    'ansible_host': ip,
                                    **host_connection_vars,
                                    'terraform_output_key': key,
                                    'terraform_job_id': instance.pk,
                                }
                            ),
                        },
                    )
                    if not created:
                        try:
                            existing = json.loads(host.variables or '{}')
                        except ValueError:
                            existing = {}
                        existing.update(
                            {
                                'ansible_host': ip,
                                **host_connection_vars,
                                'terraform_output_key': key,
                                'terraform_job_id': instance.pk,
                            }
                        )
                        host.variables = json.dumps(existing)
                        host.save(update_fields=['variables'])
                    if group:
                        group.hosts.add(host)
                    host_count += 1

        logger.info(
            '%s inventory population complete: %d host(s) added/updated',
            instance.log_format,
            host_count,
        )

    # ------------------------------------------------------------------
    # Artifact capture
    # ------------------------------------------------------------------

    def _capture_artifacts(self, instance, working_dir, env, private_data_dir=None):
        """
        Run ``terraform output -json`` and store every output value in
        ``instance.artifacts`` so they are available to downstream workflow
        nodes via ``get_effective_artifacts()``.

        The Terraform output JSON has the shape::

            {"key": {"value": <raw>, "type": "..."}, ...}

        We flatten this to ``{"key": <raw>, ...}`` — the same flat dict that
        Ansible's ``set_stats`` module produces so the workflow engine treats
        both identically.
        """
        artifacts = self._collect_terraform_outputs(
            instance,
            working_dir,
            env,
            private_data_dir=private_data_dir,
            wait_for_host_ip=True,
        )

        if artifacts:
            self.update_model(instance.pk, artifacts=artifacts)
            instance.artifacts = artifacts
            logger.info(
                '%s captured %d terraform output(s) as job artifacts: %s',
                instance.log_format,
                len(artifacts),
                list(artifacts.keys()),
            )
        else:
            logger.warning('%s no Terraform outputs captured as artifacts', instance.log_format)

    # ------------------------------------------------------------------
    # Main entry point (completely overrides BaseTask.run)
    # ------------------------------------------------------------------

    @with_path_cleanup
    @with_signal_handling
    def run(self, pk, **kwargs):
        """
        Main task entry point.

        Lifecycle (mirrors BaseTask.run but uses a Terraform subprocess
        instead of ansible-runner / Receptor):

          1. Load instance; guard against unexpected statuses
          2. Emit WebSocket "running" signal
          3. Create private_data_dir; sync SCM project into it
          4. Resolve working directory (project checkout + terraform_dir)
          5. Write extra_vars -> awx.auto.tfvars.json
          6. Inject credential env vars
          7. Run terraform init -> plan -> apply/destroy
          8. On successful apply + target_inventory set: populate inventory
          9. Persist status + stdout; emit final WebSocket status
        """
        # 1. Load instance
        self.instance = self.update_model(pk)

        if self.instance.status == 'waiting':
            from awx.main.models import UnifiedJob

            UnifiedJob.objects.filter(pk=pk).update(status='running', start_args='')
            self.instance.refresh_from_db()

        if self.instance.status != 'running':
            logger.error(
                'Not starting TerraformJob pk=%s: unexpected status "%s"',
                pk,
                self.instance.status,
            )
            return

        if self.instance.cancel_flag:
            self.instance = self.update_model(pk, status='canceled')
            self.instance.websocket_emit_status('canceled')
            return

        # 2. Notify "running"
        self.instance.websocket_emit_status('running')
        self.instance.send_notification_templates('running')

        # Initialize live-streaming event counters
        self._event_counter = 0
        self._event_line_number = 0

        status = 'error'
        private_data_dir = None
        plan_tmpdir = None
        combined_output = ''

        try:
            # 3. Private data dir + project sync
            private_data_dir = self.build_private_data_dir(self.instance)

            if self.instance.project_id:
                self.sync_and_copy(self.instance.project, private_data_dir)
                self.instance.refresh_from_db()

            if self.instance.cancel_flag or signal_callback():
                self.instance = self.update_model(pk, status='canceled')
                self.instance.websocket_emit_status('canceled')
                return

            if self.instance.status != 'running':
                raise RuntimeError('not starting %s task' % self.instance.status)

            # 4. Resolve working directory
            working_dir = os.path.join(private_data_dir, 'project')
            tf_subdir = (self.instance.terraform_dir or '.').strip()
            if tf_subdir and tf_subdir != '.':
                working_dir = os.path.join(working_dir, tf_subdir)

            if not os.path.isdir(working_dir):
                raise RuntimeError(f'Terraform directory does not exist: {working_dir}')

            local_state_warning = self._local_state_warning_message(
                working_dir,
                self.instance.terraform_operation,
            )
            if local_state_warning:
                warning_text = local_state_warning + '\n'
                combined_output += warning_text + '\n'
                logger.warning('%s %s', self.instance.log_format, local_state_warning)
                self._write_event(warning_text)

            # 5. Write tfvars
            self._write_tfvars(self.instance, working_dir)

            # 6. Build credential env
            env, safe_env = self._build_env(self.instance, private_data_dir)
            logger.debug(
                '%s credential env keys: %s',
                self.instance.log_format,
                list(safe_env.keys()),
            )

            # 7. Run Terraform
            rc, combined_output, plan_tmpdir = self._run_terraform(self.instance, working_dir, env, private_data_dir=private_data_dir)
            if plan_tmpdir:
                self.cleanup_paths.append(plan_tmpdir)
                plan_tmpdir = None  # ownership transferred to cleanup_paths

            status = 'successful' if rc == 0 else 'failed'

            # 8. Capture artifacts + inventory population (apply only)
            if status == 'successful' and self.instance.terraform_operation == 'apply':
                self._capture_artifacts(self.instance, working_dir, env, private_data_dir=private_data_dir)
                if self.instance.target_inventory_id:
                    self._populate_inventory(self.instance, working_dir, env, private_data_dir=private_data_dir)

        except Exception:
            tb = traceback.format_exc()
            logger.exception(
                '%s Exception during TerraformJob execution',
                self.instance.log_format,
            )
            combined_output += '\n\nTraceback:\n' + tb

        # 9. Persist status + stdout
        try:
            self.instance.result_stdout_text = combined_output
        except Exception:
            logger.warning('%s Could not persist result_stdout_text', self.instance.log_format)

        self.instance = self.update_model(pk, status=status)

        try:
            self.post_run_hook(self.instance, status)
        except Exception:
            logger.exception('%s post_run_hook errored', self.instance.log_format)

        try:
            self.final_run_hook(self.instance, status, private_data_dir)
        except Exception:
            logger.exception('%s final_run_hook errored', self.instance.log_format)

        self.instance.websocket_emit_status(status)
        self.instance.send_notification_templates(status)

    # ------------------------------------------------------------------
    # Hooks
    # ------------------------------------------------------------------

    def pre_run_hook(self, instance, private_data_dir):
        instance.log_lifecycle('pre_run')

    def post_run_hook(self, instance, status):
        instance.log_lifecycle('post_run')

    def final_run_hook(self, instance, status, private_data_dir):
        instance.log_lifecycle('finalize_run')
        from awx.main.scheduler import ScheduleTaskManager, ScheduleWorkflowManager

        if instance.unifiedjob_blocked_jobs.exists():
            ScheduleTaskManager().schedule()
        if instance.spawned_by_workflow:
            ScheduleWorkflowManager().schedule()
