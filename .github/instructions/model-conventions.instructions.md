---
description: "Use when writing, editing, or adding AWX Django models in awx/main/models/. Covers base class selection, field conventions, migration requirements, access class registration, and data migration patterns."
applyTo: "awx/main/models/**"
---

# AWX Model Conventions

## Base class hierarchy

Choose the right base class — never inherit from `models.Model` directly:

| Use case | Base class |
|----------|-----------|
| Standard named object (unique name) | `CommonModel` |
| Standard named object (non-unique name) | `CommonModelNameNotUnique` |
| Object without a name field | `PrimordialModel` (subclass it) |
| Runnable job object | `UnifiedJob` (`awx/main/models/unified_jobs.py`) |
| Simple non-audited model | `CreatedModifiedModel` or `BaseModel` |

`CommonModel` and `CommonModelNameNotUnique` both extend `PrimordialModel`, which provides `created`, `modified`, `created_by`, `modified_by`, and `description` fields automatically.

```python
# Standard named, uniquely-named resource
class MyResource(CommonModel):
    class Meta:
        app_label = 'main'
        ordering = ('name',)
    ...

# Runnable job type
class MyJob(UnifiedJob):
    ...
```

## Field conventions

- Always provide `help_text` for every field — these appear in the API browser and must be customer-friendly (no jokes, no FIXMEs)
- Use `blank=True, default=''` for optional text fields, not `null=True`
- Use `null=True, default=None` for optional FK fields and optional numeric fields
- Sensitive fields (passwords, tokens) must be declared in `PASSWORD_FIELDS` on the model and will be encrypted at rest

## Migrations

**Every model change requires a migration.** After modifying a model:

```bash
# Inside the container
awx-manage makemigrations
awx-manage check_migrations --dry-run --check -n 'description_of_change'
```

Rules for new fields:

- Always provide a `default=` (or `null=True`) — never leave existing rows in an inconsistent state
- Never drop a column and remove its code in the same release; remove the code first, drop the column in a later migration
- Use `index_together` → `Meta.indexes` (the former is deprecated in Django)

### Data migrations

When backfilling data in a migration, use `apps.get_model()` — **never import the real model class**:

```python
def migrate_data(apps, schema_editor):
    MyModel = apps.get_model('main', 'MyModel')
    for obj in MyModel.objects.filter(...):
        obj.new_field = compute_value(obj)
        obj.save(update_fields=['new_field'])

class Migration(migrations.Migration):
    operations = [
        migrations.RunPython(migrate_data, migrations.RunPython.noop),
    ]
```

## Access class registration

Every new model that has API endpoints **must** have a corresponding access class in `awx/main/access.py`. It is registered automatically for all `BaseAccess` subclasses at module load time.

```python
class MyResourceAccess(BaseAccess):
    model = MyResource

    def filtered_queryset(self):
        # For models registered in django-ansible-base permission_registry:
        return self.model.access_qs(self.user, 'view')
        # For simpler models, write a custom filter:
        # return self.model.objects.filter(organization__in=orgs_for_user)

    def can_add(self, data):
        ...

    def can_change(self, obj, data):
        ...

    def can_delete(self, obj):
        ...
```

Without an access class, `ListAPIView.get_queryset()` will raise a `KeyError` at runtime.

## Signals and activity stream

If the model should appear in the Activity Stream, register it with `activity_stream_registrar` (see `awx/main/registrar.py`). Check existing models for the pattern.

## `__str__` and `summary_fields`

`BaseModel.__str__` uses `name` if present, otherwise `verbose_name + pk`. You only need to override it if the default is not meaningful.

If the model is referenced as a foreign key from other serializers, add it to `SUMMARIZABLE_FK_FIELDS` in `awx/api/serializers.py` so that related fields return useful summary data.
