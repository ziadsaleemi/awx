import hashlib
import json
import os
import re
import shutil
import stat
import string
import subprocess
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils.timezone import now

from awx.main.constants import ACTIVE_STATES
from awx.main.models.terraform import (
    TerraformJobTemplate,
    TerraformStateLock,
    TerraformStateRevision,
)
from awx.main.utils import update_scm_url
from awx.main.utils.encryption import decrypt_field, encrypt_field

_STATE_KEY_RE = re.compile(r'^[A-Za-z0-9._/{}-]+$')
_STATE_KEY_FIELD_RE = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')
_BRANCH_RE = re.compile(r'^[A-Za-z0-9._/-]+$')


class TerraformStateError(RuntimeError):
    pass


def validate_state_key(value, allow_placeholders=True):
    value = (value or '').strip()
    if not value or len(value) > 1024 or not _STATE_KEY_RE.fullmatch(value) or value.startswith(('/', '.')) or value.endswith('/') or '..' in value:
        raise TerraformStateError(
            'Managed Terraform state key may contain letters, numbers, ".", "_", "-", "/", '
            'and simple "{variable}" placeholders, and cannot be absolute or contain "..".'
        )

    try:
        fields = []
        for _literal, field_name, format_spec, conversion in string.Formatter().parse(value):
            if field_name is None:
                continue
            if not allow_placeholders or not _STATE_KEY_FIELD_RE.fullmatch(field_name) or format_spec or conversion:
                raise TerraformStateError('Managed Terraform state key placeholders must be simple variable names.')
            fields.append(field_name)
    except ValueError as exc:
        raise TerraformStateError('Managed Terraform state key contains malformed placeholders.') from exc

    if ('{' in value or '}' in value) and not fields:
        raise TerraformStateError('Managed Terraform state key contains malformed placeholders.')
    return value


def validate_state_branch(value):
    value = (value or '').strip()
    if (
        not value
        or len(value) > 255
        or not _BRANCH_RE.fullmatch(value)
        or value.startswith(('/', '.'))
        or value.endswith(('/', '.'))
        or '..' in value
        or '@{' in value
        or value.endswith('.lock')
    ):
        raise TerraformStateError('Managed Terraform state branch is not a valid Git branch name.')
    return value


def summarize_terraform_state(state):
    """Return structural state metadata without exposing resource attributes or output values."""
    if not isinstance(state, dict):
        raise TerraformStateError('Terraform state must be a JSON object.')

    resources = []
    resource_count = 0
    for resource in state.get('resources') or []:
        if not isinstance(resource, dict):
            continue
        instances = resource.get('instances') or []
        instance_count = len(instances) if isinstance(instances, list) else 0
        resource_count += instance_count
        resources.append(
            {
                'mode': str(resource.get('mode') or 'managed'),
                'type': str(resource.get('type') or ''),
                'name': str(resource.get('name') or ''),
                'provider': str(resource.get('provider') or ''),
                'instance_count': instance_count,
            }
        )

    outputs = []
    raw_outputs = state.get('outputs') or {}
    if isinstance(raw_outputs, dict):
        for name, output in raw_outputs.items():
            output = output if isinstance(output, dict) else {}
            outputs.append(
                {
                    'name': str(name),
                    'sensitive': bool(output.get('sensitive', False)),
                    'type': output.get('type'),
                }
            )

    return {
        'format_version': state.get('version'),
        'serial': state.get('serial'),
        'lineage': str(state.get('lineage') or ''),
        'terraform_version': str(state.get('terraform_version') or ''),
        'resource_count': resource_count,
        'output_count': len(outputs),
        'resources': resources,
        'outputs': outputs,
    }


def sanitize_terraform_state_summary(summary):
    """Whitelist revision metadata before returning it through the API."""
    summary = summary if isinstance(summary, dict) else {}
    resources = []
    for resource in summary.get('resources') or []:
        if not isinstance(resource, dict):
            continue
        resources.append(
            {
                'mode': str(resource.get('mode') or 'managed'),
                'type': str(resource.get('type') or ''),
                'name': str(resource.get('name') or ''),
                'provider': str(resource.get('provider') or ''),
                'instance_count': int(resource.get('instance_count') or 0),
            }
        )

    outputs = []
    for output in summary.get('outputs') or []:
        if not isinstance(output, dict):
            continue
        outputs.append(
            {
                'name': str(output.get('name') or ''),
                'sensitive': bool(output.get('sensitive', False)),
                'type': output.get('type'),
            }
        )

    return {
        'format_version': summary.get('format_version'),
        'serial': summary.get('serial'),
        'lineage': str(summary.get('lineage') or ''),
        'terraform_version': str(summary.get('terraform_version') or ''),
        'resource_count': int(summary.get('resource_count') or 0),
        'output_count': int(summary.get('output_count') or 0),
        'resources': resources,
        'outputs': outputs,
    }


def _template_data_key(template_id):
    with transaction.atomic():
        template = TerraformJobTemplate.objects.select_for_update().get(pk=template_id)
        if not template.state_encryption_key:
            template.state_encryption_key = Fernet.generate_key().decode('ascii')
            template.state_encryption_key = encrypt_field(template, 'state_encryption_key')
            template.save(update_fields=['state_encryption_key'])
        return decrypt_field(template, 'state_encryption_key').encode('ascii')


class TerraformGitStateStore:
    """Restore and publish encrypted Terraform local state through a Git project."""

    def __init__(self, job, private_data_dir, working_dir, emit=None):
        self.job = job
        self.template = job.terraform_job_template
        self.private_data_dir = private_data_dir
        self.working_dir = working_dir
        self.emit = emit or (lambda _message: None)
        self.project = job.state_project or job.project
        self.branch = validate_state_branch(job.state_branch or 'capstan-terraform-state')
        self.state_key = self._resolve_state_key(job.state_key)
        self.key_hash = hashlib.sha256(self.state_key.encode('utf-8')).hexdigest()
        self.state_path = f'.capstan/terraform-state/{self.key_hash}.tfstate.enc'
        self.metadata_path = f'.capstan/terraform-state/{self.key_hash}.json'
        self.checkout_dir = os.path.join(private_data_dir, 'terraform-state-git')
        self.lock = None
        self.git_env = None
        self.remote_url = ''

        if not self.template:
            raise TerraformStateError('Managed Git state requires a Terraform job template.')
        if not self.project or self.project.scm_type != 'git' or not self.project.scm_url:
            raise TerraformStateError('Managed Git state requires a Git-backed state project.')

    def _resolve_state_key(self, configured_key):
        raw = (configured_key or '').strip()
        if not raw:
            raw = f'template-{self.job.terraform_job_template_id}'
        else:
            validate_state_key(raw)

        values = {
            'template_id': self.job.terraform_job_template_id,
            'organization_id': self.job.organization_id or 'none',
        }
        for name, value in (self.job.extra_vars_dict or {}).items():
            if isinstance(value, (str, int, float, bool)):
                values[name] = value
        try:
            raw = raw.format_map(values)
        except KeyError as exc:
            raise TerraformStateError(f'Managed Terraform state key references missing launch variable "{exc.args[0]}".') from exc
        except ValueError as exc:
            raise TerraformStateError('Managed Terraform state key contains malformed placeholders.') from exc
        return validate_state_key(raw, allow_placeholders=False)

    @property
    def plaintext_path(self):
        return os.path.join(self.working_dir, 'terraform.tfstate')

    def acquire(self):
        scope = hashlib.sha256(f'{self.project.pk}:{self.branch}'.encode('utf-8')).hexdigest()
        for _attempt in range(2):
            try:
                with transaction.atomic():
                    existing = TerraformStateLock.objects.select_for_update().filter(scope=scope).first()
                    if existing:
                        age_seconds = (now() - existing.created).total_seconds()
                        existing_active = existing.terraform_job.status in ACTIVE_STATES
                        if existing_active and age_seconds < 86400:
                            raise TerraformStateError(
                                'Managed Terraform state branch is locked by ' f'job #{existing.terraform_job_id}. Wait for that job to finish.'
                            )
                        existing.delete()

                    self.lock = TerraformStateLock.objects.create(
                        scope=scope,
                        terraform_job_template=self.template,
                        terraform_job=self.job,
                        state_project=self.project,
                        state_branch=self.branch,
                    )
                break
            except IntegrityError:
                if _attempt:
                    raise TerraformStateError('Managed Terraform state branch was locked concurrently.')
        self.emit(f'=== managed Git state: locked {self.project.name}/{self.branch} ' f'for key {self.state_key} ===\n')

    def release(self):
        if self.lock:
            TerraformStateLock.objects.filter(pk=self.lock.pk, lock_id=self.lock.lock_id).delete()
            self.lock = None

    def _write_secret_file(self, name, content, mode=stat.S_IRUSR | stat.S_IWUSR):
        secrets_dir = os.path.join(self.private_data_dir, 'terraform-state-secrets')
        os.makedirs(secrets_dir, mode=0o700, exist_ok=True)
        path = os.path.join(secrets_dir, name)
        with open(path, 'w') as stream:
            stream.write(content)
        os.chmod(path, mode)
        return path

    def _prepare_git_environment(self):
        env = dict(os.environ)
        env.update(
            {
                'GIT_TERMINAL_PROMPT': '0',
                'GIT_CONFIG_NOSYSTEM': '1',
            }
        )
        credential = self.project.credential
        username = ''
        password = ''
        ssh_key = ''
        ssh_passphrase = ''
        if credential:
            username = credential.get_input('username', default='')
            password = credential.get_input('password', default='')
            ssh_key = credential.get_input('ssh_key_data', default='')
            ssh_passphrase = credential.get_input('ssh_key_unlock', default='')

        askpass = self._write_secret_file(
            'git-askpass.sh',
            '#!/bin/sh\n'
            'case "$1" in\n'
            '  *sername*) printf "%s\\n" "$CAPSTAN_GIT_USERNAME" ;;\n'
            '  *assword*) printf "%s\\n" "$CAPSTAN_GIT_PASSWORD" ;;\n'
            '  *assphrase*) printf "%s\\n" "$CAPSTAN_GIT_SSH_PASSPHRASE" ;;\n'
            '  *) exit 1 ;;\n'
            'esac\n',
            mode=0o700,
        )
        env.update(
            {
                'GIT_ASKPASS': askpass,
                'SSH_ASKPASS': askpass,
                'SSH_ASKPASS_REQUIRE': 'force',
                'DISPLAY': env.get('DISPLAY') or ':0',
                'CAPSTAN_GIT_USERNAME': str(username or ''),
                'CAPSTAN_GIT_PASSWORD': str(password or ''),
                'CAPSTAN_GIT_SSH_PASSPHRASE': str(ssh_passphrase or ''),
            }
        )
        if ssh_key:
            key_path = self._write_secret_file('state-scm-key', ssh_key)
            env['GIT_SSH_COMMAND'] = f'ssh -i {key_path} -o IdentitiesOnly=yes ' '-o StrictHostKeyChecking=accept-new -o BatchMode=no'

        self.remote_url = update_scm_url(
            'git',
            self.project.scm_url,
            username=True,
            password=False,
            check_special_cases=False,
            scp_format=True,
        )
        self.git_env = env

    def _git(self, *args, check=True):
        result = subprocess.run(
            ['git', *args],
            cwd=self.checkout_dir,
            env=self.git_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=max(self.job.timeout or 0, 300),
        )
        if check and result.returncode:
            message = (result.stdout or '').strip().splitlines()
            detail = message[-1] if message else f'git exited with status {result.returncode}'
            detail = self._sanitize_git_output(detail)
            raise TerraformStateError(f'Managed Terraform state Git operation failed: {detail}')
        return result

    def _sanitize_git_output(self, detail):
        detail = str(detail)
        for value in (self.project.scm_url, self.remote_url):
            if value:
                detail = detail.replace(value, '<state-project-url>')
        return detail

    def prepare(self):
        if not self.lock:
            raise TerraformStateError('Managed Terraform state lock was not acquired.')

        shutil.rmtree(self.checkout_dir, ignore_errors=True)
        os.makedirs(self.checkout_dir, mode=0o700)
        self._prepare_git_environment()
        self._git('init')
        self._git('config', 'user.name', 'Capstan Terraform State')
        self._git('config', 'user.email', 'terraform-state@capstan.invalid')
        self._git('remote', 'add', 'origin', self.remote_url)

        remote_branch = self._git(
            'ls-remote',
            '--exit-code',
            '--heads',
            'origin',
            f'refs/heads/{self.branch}',
            check=False,
        )
        if remote_branch.returncode == 0:
            self._git('fetch', '--depth=1', 'origin', f'refs/heads/{self.branch}')
            self._git('checkout', '-B', self.branch, 'FETCH_HEAD')
        elif remote_branch.returncode == 2:
            self._git('checkout', '--orphan', self.branch)
        else:
            detail = (remote_branch.stdout or '').strip().splitlines()
            raise TerraformStateError(
                'Managed Terraform state could not inspect the state branch: '
                + self._sanitize_git_output(detail[-1] if detail else f'git exited with status {remote_branch.returncode}')
            )

        encrypted_path = os.path.join(self.checkout_dir, self.state_path)
        revision = None
        if os.path.exists(encrypted_path):
            key = _template_data_key(self.template.pk)
            try:
                plaintext = Fernet(key).decrypt(Path(encrypted_path).read_bytes())
            except InvalidToken as exc:
                raise TerraformStateError(
                    'Managed Terraform state could not be decrypted. Verify the Capstan SECRET_KEY ' 'and database backup belong to this state repository.'
                ) from exc
            try:
                state = json.loads(plaintext)
            except (TypeError, ValueError) as exc:
                raise TerraformStateError('Managed Terraform state contains invalid JSON.') from exc
            summarize_terraform_state(state)
            Path(self.plaintext_path).write_bytes(plaintext)
            os.chmod(self.plaintext_path, 0o600)

            commit = self._git('rev-parse', 'HEAD').stdout.strip()
            revision = (
                TerraformStateRevision.objects.filter(
                    terraform_job_template=self.template,
                    state_key=self.state_key,
                    state_path=self.state_path,
                    git_commit=commit,
                )
                .order_by('-created')
                .first()
            )
            self.emit(f'=== managed Git state: restored commit {commit[:12]} ===\n')
        else:
            self.emit('=== managed Git state: no prior revision; starting with empty state ===\n')

        self.job.state_key = self.state_key
        self.job.state_revision_read = revision
        self.job.save(update_fields=['state_key', 'state_revision_read'])
        return revision

    def publish(self, job_status):
        state_file = Path(self.plaintext_path)
        if not state_file.exists():
            self.emit('=== managed Git state: no state file was produced ===\n')
            return None

        plaintext = state_file.read_bytes()
        try:
            state = json.loads(plaintext)
        except (TypeError, ValueError) as exc:
            raise TerraformStateError('Terraform produced an invalid JSON state file.') from exc
        summary = summarize_terraform_state(state)
        checksum = hashlib.sha256(plaintext).hexdigest()
        key = _template_data_key(self.template.pk)

        encrypted_path = Path(self.checkout_dir, self.state_path)
        encrypted_path.parent.mkdir(parents=True, exist_ok=True)
        encrypted_path.write_bytes(Fernet(key).encrypt(plaintext))
        os.chmod(encrypted_path, 0o600)

        metadata = {
            'format': 'capstan-terraform-state/v1',
            'state_key_hash': self.key_hash,
            'checksum': checksum,
            'serial': summary['serial'],
            'lineage': summary['lineage'],
            'terraform_version': summary['terraform_version'],
            'resource_count': summary['resource_count'],
            'output_count': summary['output_count'],
        }
        metadata_path = Path(self.checkout_dir, self.metadata_path)
        metadata_path.write_text(json.dumps(metadata, indent=2, sort_keys=True) + '\n')
        self._git('add', self.state_path, self.metadata_path)

        if self._git('diff', '--cached', '--quiet', check=False).returncode == 0:
            self.job.state_revision_written = self.job.state_revision_read
            self.job.save(update_fields=['state_revision_written'])
            self.emit('=== managed Git state: state unchanged; no revision published ===\n')
            return self.job.state_revision_read

        self._git(
            'commit',
            '-m',
            f'Capstan Terraform state {self.key_hash[:12]} from job #{self.job.pk}',
        )
        self._git('push', 'origin', f'HEAD:refs/heads/{self.branch}')
        commit = self._git('rev-parse', 'HEAD').stdout.strip()

        revision = TerraformStateRevision.objects.create(
            terraform_job_template=self.template,
            terraform_job=self.job,
            state_project=self.project,
            state_key=self.state_key,
            state_branch=self.branch,
            state_path=self.state_path,
            git_commit=commit,
            checksum=checksum,
            serial=summary['serial'],
            lineage=summary['lineage'],
            terraform_version=summary['terraform_version'],
            resource_count=summary['resource_count'],
            output_count=summary['output_count'],
            operation=self.job.terraform_operation,
            job_status=job_status,
            summary=summary,
        )
        self.job.state_revision_written = revision
        self.job.save(update_fields=['state_revision_written'])
        self.emit(f'=== managed Git state: published revision {commit[:12]} ===\n')
        return revision

    def preserve_recovery_copy(self):
        """Persist an encrypted recovery copy when Git publication fails."""
        state_file = Path(self.plaintext_path)
        if not state_file.exists():
            return ''
        recovery_dir = Path(settings.JOBOUTPUT_ROOT, 'terraform_state_recovery')
        recovery_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        recovery_path = recovery_dir / f'job-{self.job.pk}-{self.key_hash[:16]}.tfstate.enc'
        recovery_path.write_bytes(Fernet(_template_data_key(self.template.pk)).encrypt(state_file.read_bytes()))
        os.chmod(recovery_path, 0o600)
        return str(recovery_path)
