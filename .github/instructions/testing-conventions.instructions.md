---
description: "Use when writing, editing, or running tests in awx/main/tests/ or awx/conf/tests/. Covers test folder placement, django_db decorator rules, factory usage, and pytest configuration."
applyTo: "awx/main/tests/**"
---

# AWX Testing Conventions

## Test folder placement

| Folder | DB required | Use `@pytest.mark.django_db` |
|--------|-------------|------------------------------|
| `unit/` | No | **Never** — will cause an error |
| `functional/` | Yes (sqlite3) | **Always required** |
| `live/` | Yes (postgres) | Run via `make live_test` inside container only |

Put a test in `unit/` if it doesn't touch the database. Move it to `functional/` the moment it needs models or the ORM.

## Running tests (inside the dev container)

```bash
# All tests
make test

# Unit only
py.test awx/main/tests/unit awx/conf/tests/unit

# Functional only
py.test awx/main/tests/functional

# Single file
py.test awx/main/tests/unit/path/to/test_file.py

# Force fresh DB
py.test --create-db awx/main/tests/functional
```

Tests run in parallel by default (`-n auto`). If a test is flaky under parallelism, investigate before marking it serial.

## pytest configuration

`DJANGO_SETTINGS_MODULE=awx.main.tests.settings_for_test` is set automatically via `pytest.ini`. Do not override it in test files.

Useful pytest marks (declared in `pytest.ini`):

| Mark | Purpose |
|------|---------|
| `@pytest.mark.django_db` | Required for functional tests |
| `@pytest.mark.ac` | Access-control tests |
| `@pytest.mark.survey` | Survey feature tests |

## Factories

Use the factories in `awx/main/tests/factories/` to create model instances — do not call `Model.objects.create()` directly in tests unless no factory exists.

```python
from awx.main.tests.factories import (
    create_job_template,
    create_organization,
    create_user,
)
```

## Fixtures

Common fixtures are in `awx/main/tests/conftest.py`. Check there before writing a new one with the same purpose.

## Coverage

Every new API URL/route must have test coverage. Write both:
- A **positive** test (expected success path)
- A **negative** test (permission denied, invalid input, etc.)
