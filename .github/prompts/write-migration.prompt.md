---
description: "Write an AWX Django migration safely: schema migration with proper defaults, RunPython data migration, reverse migration, and validation checklist."
---

# Write an AWX Migration

Use this prompt when you need to write or fix a migration in `awx/main/migrations/`.

## Before you start

1. Run `awx-manage showmigrations main` to confirm the latest migration number
2. Run `awx-manage makemigrations --check --dry-run` — if Django can auto-generate the schema part, let it and only add the data migration step manually

---

## Schema migration rules

- Every new field **must** have a sensible `default=` so the migration is non-destructive on existing rows
- Use `blank=True, default=''` for text fields; use `null=True, blank=True` only for `ForeignKey` / nullable numerics
- If you are removing a field, do it in two separate releases:
  1. Release N: stop referencing the column in code (but keep the field in the model and migration graph)
  2. Release N+1: add a migration that removes the column

---

## Data migration (RunPython) template

```python
import logging
from django.db import migrations

logger = logging.getLogger('awx.main.migrations')


def forward(apps, schema_editor):
    # ALWAYS use apps.get_model() — never import the live model class
    MyModel = apps.get_model('main', 'MyModel')

    updated = 0
    for obj in MyModel.objects.iterator():  # iterator() avoids loading all rows at once
        # ... mutate obj ...
        obj.save(update_fields=['field1', 'field2'])  # always use update_fields
        updated += 1

    if updated:
        logger.info(f'Migration: updated {updated} MyModel rows')


def reverse(apps, schema_editor):
    # Provide a reverse function unless rollback is genuinely impossible
    # For trivial reverses use migrations.RunPython.noop
    pass


class Migration(migrations.Migration):
    dependencies = [
        ('main', '0NNN_previous_migration'),
    ]

    operations = [
        # 1. Schema changes first
        migrations.AddField(
            model_name='mymodel',
            name='new_field',
            field=...,
        ),
        # 2. Data migration after the column exists
        migrations.RunPython(forward, reverse),
        # 3. AlterField to remove the null=True safety net, if applicable
    ]
```

---

## Key rules

| Rule | Why |
|------|-----|
| Use `apps.get_model('main', 'ModelName')` | Frozen model snapshot — safe to run at any point in migration history |
| Never `from awx.main.models import X` | The live model may have fields/methods that don't exist at migration time |
| Always provide `update_fields` in `save()` | Avoids clobbering unrelated columns, and is faster |
| Use `iterator()` for large tables | Keeps memory flat; don't load all rows into a list |
| Log how many rows were modified | Helps diagnose slow deployments and verify the migration ran |
| Add a `reverse` function or `RunPython.noop` | Required for `migrate --fake` and rollback support |
| Never drop a column in the same release you stop using it | Zero-downtime deployments require the old code to keep working until all instances are upgraded |

---

## Large-table backfills

For tables with millions of rows, use batched updates to avoid long-running locks:

```python
def forward(apps, schema_editor):
    MyModel = apps.get_model('main', 'MyModel')
    batch_size = 5000
    last_pk = 0
    while True:
        batch = list(MyModel.objects.filter(pk__gt=last_pk).order_by('pk')[:batch_size])
        if not batch:
            break
        for obj in batch:
            obj.new_field = compute_value(obj)
        MyModel.objects.bulk_update(batch, ['new_field'])
        last_pk = batch[-1].pk
        logger.debug(f'Backfilled up to pk={last_pk}')
```

For truly massive tables (> 10M rows), consider moving the backfill to a `@task` in `awx/main/tasks/system.py` and trigger it from a post-migrate signal instead of a blocking `RunPython`.

---

## After writing the migration

```bash
# Validate Django is happy with the migration graph
awx-manage migrate --run-syncdb

# Verify migration is reversible
awx-manage migrate main 0NNN_previous_migration

# Re-apply
awx-manage migrate main 0NNN_your_new_migration

# Run the full test suite to catch any freeze-snapshot issues
py.test awx/main/tests/functional/ -x -q
```
