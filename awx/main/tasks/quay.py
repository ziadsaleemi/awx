# Copyright (c) 2026 Red Hat, Inc.
# All Rights Reserved.

import logging
import os
import shlex
import shutil
import subprocess
import time
from urllib.parse import urlparse

from django.utils.timezone import now
from dispatcherd.publish import task

from awx.main.dispatch import get_task_queuename
from awx.main.models import UnifiedJob
from awx.main.models.quay import QuayImageBuild, QuayImageBuildJob
from awx.main.tasks.jobs import BaseTask
from awx.main.tasks.signals import signal_callback
from awx.main.utils.quay import QuayClient

logger = logging.getLogger('awx.main.tasks.quay')

QUAY_IMAGE_BUILD_LOG_LIMIT = 1024 * 1024


class QuayImageBuildCanceled(RuntimeError):
    pass


def _append_log(build, text):
    build.log = ((build.log or '') + text)[-QUAY_IMAGE_BUILD_LOG_LIMIT:]
    build.save(update_fields=['log'])


def _mark(build, status=None, progress=None, error=None, started=False, finished=False, job=None):
    update_fields = []
    if status is not None:
        build.status = status
        update_fields.append('status')
    if progress is not None:
        build.progress = max(0, min(100, int(progress)))
        update_fields.append('progress')
    if error is not None:
        build.error = str(error)
        update_fields.append('error')
    if started:
        build.started = now()
        update_fields.append('started')
    if finished:
        build.finished = now()
        update_fields.append('finished')
    build.save(update_fields=update_fields)

    if job is not None:
        job_update_fields = []
        if status is not None:
            job.status = status
            job_update_fields.append('status')
        if progress is not None:
            job.progress = build.progress
            job_update_fields.append('progress')
        if error is not None:
            job.job_explanation = str(error)
            job_update_fields.append('job_explanation')
        if started:
            job.started = build.started
            job_update_fields.append('started')
        if finished:
            job.finished = build.finished
            job_update_fields.append('finished')
        if job_update_fields:
            job.save(update_fields=job_update_fields)


def _raise_if_canceled(job, proc=None):
    if job is None:
        return
    job.refresh_from_db(fields=['cancel_flag'])
    if job.cancel_flag or signal_callback():
        if proc is not None and proc.poll() is None:
            proc.terminate()
        raise QuayImageBuildCanceled('Project Quay image build was canceled.')


def _run_command(build, args, cwd=None, input_text=None, job=None):
    _raise_if_canceled(job)
    display = shlex.join([str(arg) for arg in args])
    _append_log(build, f'\n$ {display}\n')
    logger.info('Quay image build %s running: %s', build.pk, display)
    proc = subprocess.Popen(
        args,
        cwd=cwd,
        env=os.environ.copy(),
        stdin=subprocess.PIPE if input_text is not None else None,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding='utf-8',
        errors='replace',
    )
    if input_text is not None and proc.stdin:
        proc.stdin.write(input_text)
        proc.stdin.close()
    if proc.stdout:
        for line in proc.stdout:
            _append_log(build, line)
            _raise_if_canceled(job, proc=proc)
    return proc.wait()


def _execute_quay_image_build(build, job=None):
    build.status = 'running'
    build.progress = 5
    build.started = now()
    build.error = ''
    build.log = ''
    build.save(update_fields=['status', 'progress', 'started', 'error', 'log'])
    if job is not None:
        job.status = 'running'
        job.progress = 5
        job.started = build.started
        job.job_explanation = ''
        job.save(update_fields=['status', 'progress', 'started', 'job_explanation'])
    started_monotonic = time.monotonic()

    try:
        _raise_if_canceled(job)
        client = QuayClient()
        parsed = urlparse(client.server_url)
        insecure_registry = parsed.scheme == 'http' or not client.verify_ssl
        if not client.push_username or not client.push_token:
            raise RuntimeError('Project Quay push credentials are not configured.')
        if not shutil.which('ansible-builder'):
            raise RuntimeError('ansible-builder is not installed on this AWX execution node.')
        if not shutil.which(build.runtime):
            raise RuntimeError(f'{build.runtime} is not installed on this AWX execution node.')
        if not build.project_path:
            raise RuntimeError('AWX Project has not been synced to a local checkout yet.')

        _append_log(build, f'Starting Project Quay image build {build.image}\n')
        _append_log(build, f'Project: {build.project_name or build.project_id or "-"}\n')
        _append_log(build, f'Source: {build.project_path}\n')
        _mark(build, progress=10, job=job)

        build_args = [
            'ansible-builder',
            'build',
            '--container-runtime',
            build.runtime,
            '-f',
            build.definition_file,
            '-t',
            build.image,
            '-c',
            build.context_path,
        ]
        if _run_command(build, build_args, cwd=build.project_path, job=job) != 0:
            raise RuntimeError('ansible-builder build failed.')
        _mark(build, progress=70, job=job)

        login_args = [
            build.runtime,
            'login',
            build.registry,
            '--username',
            client.push_username,
            '--password-stdin',
        ]
        if build.runtime == 'podman' and insecure_registry:
            login_args.insert(2, '--tls-verify=false')
        if _run_command(build, login_args, input_text=f'{client.push_token}\n', job=job) != 0:
            raise RuntimeError('Project Quay registry login failed.')
        _mark(build, progress=85, job=job)

        push_args = [build.runtime, 'push', build.image]
        if build.runtime == 'podman' and insecure_registry:
            push_args.insert(2, '--tls-verify=false')
        if _run_command(build, push_args, job=job) != 0:
            raise RuntimeError('Project Quay image push failed.')

        elapsed = time.monotonic() - started_monotonic
        _append_log(build, f'\nBuild completed successfully in {elapsed:.1f}s.\n')
        _mark(build, status='successful', progress=100, finished=True, job=job)
        return 'successful'
    except QuayImageBuildCanceled as exc:
        logger.info('Quay image build %s canceled', build.pk)
        _append_log(build, f'\nCANCELED: {exc}\n')
        _mark(build, status='canceled', progress=max(build.progress, 1), error=exc, finished=True, job=job)
        return 'canceled'
    except Exception as exc:
        logger.exception('Quay image build %s failed', build.pk)
        _append_log(build, f'\nERROR: {exc}\n')
        _mark(build, status='failed', progress=max(build.progress, 1), error=exc, finished=True, job=job)
        return 'failed'


def _command_summary_for_job(job, build):
    return [
        {
            'label': 'Build execution environment',
            'command': f'cd {shlex.quote(build.project_path)} && ansible-builder build --container-runtime {shlex.quote(build.runtime)} -f {shlex.quote(build.definition_file)} -t {shlex.quote(build.image)} -c {shlex.quote(build.context_path)}',
            'working_directory': build.project_path,
        },
        {
            'label': 'Log in to Project Quay',
            'command': f'echo \"$QUAY_TOKEN\" | {build.runtime} login {shlex.quote(build.registry)} --username \"$QUAY_USERNAME\" --password-stdin',
        },
        {
            'label': 'Push to Project Quay',
            'command': f'{build.runtime} push {shlex.quote(build.image)}',
        },
    ]


def _create_quay_image_build_from_job(job):
    client = QuayClient()
    registry = client.registry
    if not registry:
        raise RuntimeError('Project Quay registry URL does not include a registry hostname.')
    if not job.project_id or not job.project:
        raise RuntimeError('Project Quay image build job no longer has an AWX Project.')

    project_path = job.project.get_project_path()
    if not project_path:
        raise RuntimeError('AWX Project has not been synced to a local checkout yet.')

    image = job.image or f'{registry}/{job.repository_path}:{job.tag}'
    build = QuayImageBuild.objects.create(
        template=job.quay_image_build_template,
        project=job.project,
        project_name=job.project.name,
        project_path=project_path,
        scm_revision=job.project.scm_revision or '',
        namespace=job.namespace,
        repository=job.repository,
        tag=job.tag,
        image=image,
        registry=registry,
        runtime=job.runtime,
        definition_file=job.definition_file,
        context_path=job.context_path,
        unified_job=job,
    )
    build.command_summary = _command_summary_for_job(job, build)
    build.save(update_fields=['command_summary'])
    job.image = build.image
    job.registry = build.registry
    job.scm_revision = build.scm_revision
    job.command_summary = build.command_summary
    job.save(update_fields=['image', 'registry', 'scm_revision', 'command_summary'])
    return build


@task(queue=get_task_queuename)
class RunQuayImageBuildJob(BaseTask):
    model = QuayImageBuildJob
    event_model = None

    def run(self, pk, **kwargs):
        self.instance = self.update_model(pk)

        if self.instance.status == 'waiting':
            UnifiedJob.objects.filter(pk=pk).update(status='running', start_args='')
            self.instance.refresh_from_db()

        if self.instance.status != 'running':
            logger.error('Not starting QuayImageBuildJob pk=%s: unexpected status "%s"', pk, self.instance.status)
            return

        if self.instance.cancel_flag:
            self.instance = self.update_model(pk, status='canceled')
            self.instance.websocket_emit_status('canceled')
            return

        self.instance.websocket_emit_status('running')
        self.instance.send_notification_templates('running')

        try:
            build = getattr(self.instance, 'quay_image_build', None)
        except QuayImageBuild.DoesNotExist:
            build = None
        if build is None:
            try:
                build = _create_quay_image_build_from_job(self.instance)
            except Exception as exc:
                logger.exception('Unable to create legacy Quay image build for job %s', pk)
                self.instance.job_explanation = str(exc)
                self.instance.finished = now()
                self.instance.status = 'failed'
                self.instance.save(update_fields=['job_explanation', 'finished', 'status'])
                self.instance.websocket_emit_status('failed')
                self.instance.send_notification_templates('failed')
                return

        status = _execute_quay_image_build(build, job=self.instance)
        self.instance.refresh_from_db()
        self.instance.websocket_emit_status(status)
        self.instance.send_notification_templates('succeeded' if status == 'successful' else 'failed')


@task(queue=get_task_queuename, timeout=3600 * 5)
def run_quay_image_build(build_id):
    try:
        build = QuayImageBuild.objects.select_related('unified_job').get(pk=build_id)
    except QuayImageBuild.DoesNotExist:
        logger.warning('Quay image build %s no longer exists', build_id)
        return

    job = build.unified_job if build.unified_job_id else None
    _execute_quay_image_build(build, job=job)
