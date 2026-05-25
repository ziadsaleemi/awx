---
applyTo: "awx/main/tasks/**"
---

# AWX Background Task Conventions

## Decorator

All background tasks use `@task()` from `dispatcherd.publish` — **not** Celery's `@shared_task` or `@app.task`.

```python
from dispatcherd.publish import task
from awx.main.dispatch import get_task_queuename

@task(queue=get_task_queuename, timeout=3600, on_duplicate='queue_one')
def my_periodic_task():
    ...
```

`get_task_queuename` is a callable (not a string constant) — pass it without calling: `queue=get_task_queuename`.

## `on_duplicate` values

| Value | Behaviour |
|-------|-----------|
| `'queue_one'` | If a copy is already queued (not running), skip enqueue — only one pending at a time |
| `'discard'` | Silently discard the new submission if any copy is already queued or running |
| `'bind'` | (job tasks) bind the new request to the already-running instance |
| *(omitted)* | Always enqueue, even if duplicates exist — use for unique per-object tasks |

## Queue names

- `queue=get_task_queuename` — default; routes to a random READY control/hybrid node
- `queue='tower_broadcast_all'` — fan-out to **every** running dispatcher (for config/reload events)
- `queue='tower_settings_change'` — settings-change broadcast
- `queue=get_local_queuename` — route to **this** node only (use for node-local operations)

## Mutual exclusion with `advisory_lock`

Use PostgreSQL advisory locks (from `ansible_base.lib.utils.db`) instead of Django's `select_for_update` for task-level coordination:

```python
from ansible_base.lib.utils.db import advisory_lock

@task(queue=get_task_queuename, timeout=1800, on_duplicate='queue_one')
def my_singleton_task():
    with advisory_lock('my_singleton_task_lock', wait=False) as acquired:
        if not acquired:
            return  # another worker holds the lock — bail out immediately
        # ... do work ...
```

- `wait=False` — return immediately if the lock is unavailable (correct for periodic tasks)
- `wait=True` — block until the lock is acquired (correct for coordinated writes)
- Lock names must be globally unique strings; use the task name as a convention

## DB access in tasks

- Tasks run **outside** a request/response cycle — there is no `request.user`; use `impersonate()` from `crum` when an authenticated user context is required
- Wrap multi-step mutations in `transaction.atomic()`
- Use `ignore_inventory_computed_fields()` and `ignore_inventory_group_removal()` context managers when bulk-modifying inventory to suppress expensive post-save signals

## File placement

| Type | File |
|------|------|
| Job execution (run_job, run_ad_hoc, etc.) | `awx/main/tasks/jobs.py` |
| Periodic / system tasks (scheduling, cleanup, sync) | `awx/main/tasks/system.py` |
| Receptor communication | `awx/main/tasks/receptor.py` |
| Job event callbacks | `awx/main/tasks/callback.py` |
| Small reusable utilities | `awx/main/tasks/helpers.py` |

Do **not** add new tasks to `jobs.py` unless they are directly involved in running a `UnifiedJob`. Periodic/maintenance tasks belong in `system.py`.

## Logging

```python
import logging
logger = logging.getLogger('awx.main.tasks.<module>')  # e.g. awx.main.tasks.system
```

Use `logger.info` for normal task lifecycle events, `logger.warning` for unexpected-but-recoverable situations, `logger.exception` (with the exception in scope) for errors that should page.

## Dispatching a task from application code

```python
from awx.main.tasks.system import my_task

# Fire-and-forget (returns immediately, task runs async in dispatcher)
my_task.apply_async()

# With arguments
my_task.apply_async(args=[arg1], kwargs={'key': 'value'})
```

Never call the task function directly (`my_task()`) in production code paths — this runs it synchronously in the web worker process and blocks the request.
