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
from awx.main.models.quay import QuayImageBuild
from awx.main.utils.quay import QuayClient

logger = logging.getLogger('awx.main.tasks.quay')

QUAY_IMAGE_BUILD_LOG_LIMIT = 1024 * 1024


def _append_log(build, text):
    build.log = ((build.log or '') + text)[-QUAY_IMAGE_BUILD_LOG_LIMIT:]
    build.save(update_fields=['log'])


def _mark(build, status=None, progress=None, error=None, finished=False):
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
    if finished:
        build.finished = now()
        update_fields.append('finished')
    build.save(update_fields=update_fields)


def _run_command(build, args, cwd=None, input_text=None):
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
    return proc.wait()


@task(queue=get_task_queuename, timeout=3600 * 5)
def run_quay_image_build(build_id):
    try:
        build = QuayImageBuild.objects.get(pk=build_id)
    except QuayImageBuild.DoesNotExist:
        logger.warning('Quay image build %s no longer exists', build_id)
        return

    build.status = 'running'
    build.progress = 5
    build.started = now()
    build.error = ''
    build.log = ''
    build.save(update_fields=['status', 'progress', 'started', 'error', 'log'])
    started_monotonic = time.monotonic()

    try:
        client = QuayClient()
        parsed = urlparse(client.server_url)
        insecure_registry = parsed.scheme == 'http' or not client.verify_ssl
        if not client.push_username or not client.push_token:
            raise RuntimeError('Project Quay push credentials are not configured.')
        if not shutil.which('ansible-builder'):
            raise RuntimeError('ansible-builder is not installed on this AWX execution node.')
        if not shutil.which(build.runtime):
            raise RuntimeError(f'{build.runtime} is not installed on this AWX execution node.')

        _append_log(build, f'Starting Project Quay image build {build.image}\n')
        _append_log(build, f'Project: {build.project_name or build.project_id or "-"}\n')
        _append_log(build, f'Source: {build.project_path}\n')
        _mark(build, progress=10)

        build_args = [
            'ansible-builder',
            'build',
            '--container-runtime',
            build.runtime,
            '-f',
            build.definition_file,
            '-t',
            build.image,
            build.context_path,
        ]
        if _run_command(build, build_args, cwd=build.project_path) != 0:
            raise RuntimeError('ansible-builder build failed.')
        _mark(build, progress=70)

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
        if _run_command(build, login_args, input_text=f'{client.push_token}\n') != 0:
            raise RuntimeError('Project Quay registry login failed.')
        _mark(build, progress=85)

        push_args = [build.runtime, 'push', build.image]
        if build.runtime == 'podman' and insecure_registry:
            push_args.insert(2, '--tls-verify=false')
        if _run_command(build, push_args) != 0:
            raise RuntimeError('Project Quay image push failed.')

        elapsed = time.monotonic() - started_monotonic
        _append_log(build, f'\nBuild completed successfully in {elapsed:.1f}s.\n')
        _mark(build, status='successful', progress=100, finished=True)
    except Exception as exc:
        logger.exception('Quay image build %s failed', build.pk)
        _append_log(build, f'\nERROR: {exc}\n')
        _mark(build, status='failed', progress=max(build.progress, 1), error=exc, finished=True)
