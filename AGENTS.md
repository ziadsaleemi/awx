# AWX — Agent Instructions

AWX is the open-source web UI and REST API for Ansible Automation Platform. It is a Django + Django REST Framework application backed by PostgreSQL, with background task execution via Receptor, real-time event streaming over WebSockets (Channels/Daphne), and a task dispatch layer built on top of PostgreSQL LISTEN/NOTIFY.

## Repository layout

| Path | Purpose |
|------|---------|
| `awx/api/` | DRF views, serializers, permissions, pagination, URL routing |
| `awx/main/models/` | Django models; `unified_jobs.py` is the polymorphic base for all runnable objects |
| `awx/main/access.py` | RBAC access-control layer (checked before every API action) |
| `awx/main/tasks/` | Background tasks: `jobs.py`, `system.py`, `receptor.py`, etc. |
| `awx/main/scheduler/` | Task manager & workflow DAG scheduler |
| `awx/main/dispatch/` | PostgreSQL PubSub / task routing |
| `awx/settings/` | Django settings for dev (`development.py`) and production (`production.py`) |
| `awx_collection/` | `awx.awx` Ansible collection (plugins/modules) |
| `awxkit/` | Python client library for AWX |
| `tools/docker-compose/` | Dev environment (Docker Compose + Ansible playbooks) |

## Development environment

The standard dev environment runs inside Docker. See [tools/docker-compose/README.md](tools/docker-compose/README.md) for full setup instructions.

```bash
# Build the development image (only needed once or after Dockerfile changes)
make docker-compose-build

# Start the full stack (postgres, redis, awx_1 container, etc.)
make docker-compose

# Open a shell in the running container
docker exec -it tools_awx_1 /bin/bash
```

Once inside the container, the source tree is bind-mounted at `/awx_devel/`. Changes to Python files are picked up immediately by the running processes via `awx-autoreload`.

Supervisord controls the in-container processes. Individual processes can be toggled via the VS Code workspace tasks (`supervisorctl start/stop tower-processes:<name>`).

## Key commands (run inside the dev container)

| Task | Command |
|------|---------|
| Run all tests | `make test` |
| Run unit tests only | `make test_unit` or `py.test awx/main/tests/unit awx/conf/tests/unit` |
| Run functional tests only | `py.test awx/main/tests/functional` |
| Run a single test file | `py.test awx/main/tests/unit/path/to/test_file.py` |
| Lint (black check) | `make api-lint` |
| Auto-format (black) | `make black` |
| Generate OpenAPI schema | `make genschema` |
| Apply migrations | `awx-manage migrate` |
| Create superuser | `awx-manage createsuperuser` |

`DJANGO_SETTINGS_MODULE=awx.main.tests.settings_for_test` is set automatically by `pytest.ini`.

## Testing conventions

- `awx/main/tests/unit/` — no database; do **not** use `@pytest.mark.django_db`
- `awx/main/tests/functional/` — uses sqlite3 test DB; **must** use `@pytest.mark.django_db`
- `awx/main/tests/live/` — requires the full running stack (`make docker-compose`)
- `awx_collection/test/awx/` — collection unit tests, run with `make test_collection`

Tests run in parallel by default (`-n auto`). Use `--create-db` to force a fresh database.

## API conventions

See [API_STANDARDS.md](API_STANDARDS.md) for the full guide. Key rules:

- **Every collection endpoint must be paginated** — no unbounded list returns
- **No DB queries inside serializers** — they run once per item; put query logic in the view/queryset
- **RBAC filtering is mandatory** — all collections must be filtered through `access.py`
- **Constant-time query count** — query count must not grow with result set size
- **REST verbs must be RESTy** — use PUT/POST for mutations, not GET

## Models

- `UnifiedJob` (`awx/main/models/unified_jobs.py`) is the polymorphic base for all runnable objects (`Job`, `InventoryUpdate`, `ProjectUpdate`, `AdHocCommand`, `WorkflowJob`, `SystemJob`)
- `PrimordialModel` / `CommonModel` from `awx/main/models/base.py` are the standard base classes for non-job models
- When adding new fields, always consider existing data and write a migration with a sensible default — see [DATA_MIGRATION.md](DATA_MIGRATION.md)

## RBAC

AWX uses `django-ansible-base` for RBAC. Access objects in `awx/main/access.py` define who can read/write/delete each model. Always add a corresponding access class method when adding a new model or action.

## UI development rules

- **Match existing design** — before implementing any new UI element, find the closest existing component in `awx/ui/src/` that already does something similar and copy its visual pattern (markup structure, styled-component names, PatternFly variants). Do not invent new design from scratch.
- **Update ENHANCEMENTS.md** — every time a UI change is completed (or a new one is planned), update `ENHANCEMENTS.md` accordingly: add the row if missing, and flip the status to ✅ when done.

## Submitting changes

- All PRs target the `devel` branch
- Commits **must** be signed off: `git commit --signoff`
- No merge commits — use `git rebase`
- Install pre-commit hooks once: `make pre-commit`
- CI runs `black`, `flake8`, `yamllint`, and the full test suite

## Useful documentation

- [CONTRIBUTING.md](CONTRIBUTING.md) — contribution workflow, PR process
- [API_STANDARDS.md](API_STANDARDS.md) — API coding standards
- [docs/task_manager_system.md](docs/task_manager_system.md) — task scheduling internals
- [docs/rbac.md](docs/rbac.md) — RBAC design
- [docs/clustering.md](docs/clustering.md) — multi-node / receptor architecture
- [docs/websockets.md](docs/websockets.md) — WebSocket event streaming
