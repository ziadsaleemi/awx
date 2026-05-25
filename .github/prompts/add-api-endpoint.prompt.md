---
description: "Scaffold a complete AWX REST API endpoint from scratch: model field (or new model), migration, serializer, view, URL registration, access class, and unit + functional tests."
---

# Add AWX API Endpoint

Scaffold all the layers needed to expose a new or extended resource through the AWX REST API.

## Variables

Fill in the values relevant to your change before running:

- **Resource name**: the Django model name (e.g. `ExecutionEnvironment`, `Label`)
- **Change type**: `new-model` | `new-field` | `new-action` (a launch / cancel / copy endpoint)
- **Field name / Action name**: e.g. `registry_credential` or `copy`
- **Field type**: Django field type if applicable (e.g. `CharField`, `ForeignKey`, `BooleanField`)
- **Endpoint path**: the URL segment, e.g. `execution_environments/`

---

## Step 1 — Model

**For a new field on an existing model** (`awx/main/models/<file>.py`):

1. Add the field with a `help_text`, a sensible `default=`, and `blank=True` / `null=True` as appropriate
2. Follow [model conventions](./../instructions/model-conventions.instructions.md)

**For a new model**:

1. Create the class in `awx/main/models/<resource>.py`, inheriting from `CommonModel` or `CommonModelNameNotUnique`
2. Export it from `awx/main/models/__init__.py`
3. Verify `app_label = 'main'` is set in `class Meta`

---

## Step 2 — Migration

```bash
# Inside the dev container
awx-manage makemigrations
awx-manage check_migrations --dry-run --check -n 'add_<field_or_model>'
```

Review the generated file in `awx/main/migrations/`. If existing rows need backfilling, add a `RunPython` data migration using `apps.get_model()` — never import the live model class.

---

## Step 3 — Serializer (`awx/api/serializers.py`)

1. Find the serializer for the model (search for `class <Model>Serializer`)
2. Add the new field to `fields` in `class Meta`; if it requires a custom representation, add a `SerializerMethodField` backed by logic in the **view's queryset** (not the serializer), or a `get_<field>` method that touches only already-loaded data
3. If the model is referenced as a FK summary, add it to `SUMMARIZABLE_FK_FIELDS`

```python
class MyResourceSerializer(BaseSerializer):
    class Meta:
        model = MyResource
        fields = ('*', 'new_field', 'organization')
```

---

## Step 4 — View (`awx/api/views/<resource>.py`)

Use the correct base class from `awx/api/generics.py`:

```python
class MyResourceList(ListCreateAPIView):
    model = MyResource
    serializer_class = MyResourceSerializer
    # get_queryset() is inherited — returns RBAC-filtered queryset automatically

class MyResourceDetail(RetrieveUpdateDestroyAPIView):
    model = MyResource
    serializer_class = MyResourceSerializer
```

For an action endpoint (launch, cancel, copy), inherit from `GenericAPIView` and define `post()`.

---

## Step 5 — URL registration

1. Create (or update) `awx/api/urls/<resource>.py`:

```python
from django.urls import re_path
from awx.api.views.<resource> import MyResourceList, MyResourceDetail

urls = [
    re_path(r'^$', MyResourceList.as_view(), name='myresource_list'),
    re_path(r'^(?P<pk>[0-9]+)/$', MyResourceDetail.as_view(), name='myresource_detail'),
]

__all__ = ['urls']
```

2. Import and include in `awx/api/urls/urls.py`:

```python
from .<resource> import urls as myresource_urls
# ...
re_path(r'^my_resources/', include(myresource_urls)),
```

---

## Step 6 — Access class (`awx/main/access.py`)

Add a `BaseAccess` subclass. It is auto-registered at module load time:

```python
class MyResourceAccess(BaseAccess):
    model = MyResource

    def filtered_queryset(self):
        return self.model.access_qs(self.user, 'view')

    def can_add(self, data):
        ...

    def can_change(self, obj, data):
        ...

    def can_delete(self, obj):
        ...
```

If the model uses `django-ansible-base` permissions, register it in `permission_registry` in `awx/main/apps.py`.

---

## Step 7 — Tests

**Unit test** (`awx/main/tests/unit/`) — no DB, no `@pytest.mark.django_db`:

```python
def test_myresource_serializer_fields():
    from awx.api.serializers import MyResourceSerializer
    fields = MyResourceSerializer().fields
    assert 'new_field' in fields
```

**Functional test** (`awx/main/tests/functional/`) — requires `@pytest.mark.django_db`:

```python
@pytest.mark.django_db
def test_myresource_list(get, admin):
    url = reverse('api:myresource_list')
    response = get(url, user=admin)
    assert response.status_code == 200
    assert 'results' in response.data   # pagination check

@pytest.mark.django_db
def test_myresource_list_rbac(get, alice):
    """Non-owner should not see resources they have no access to."""
    url = reverse('api:myresource_list')
    response = get(url, user=alice)
    assert response.status_code == 200
    assert response.data['count'] == 0
```

---

## Checklist

- [ ] Model field has `help_text` and a sensible `default`
- [ ] Migration generated and reviewed
- [ ] No DB queries added inside the serializer
- [ ] View inherits from the correct `awx/api/generics.py` base class
- [ ] URL registered in both `awx/api/urls/<resource>.py` and `urls.py`
- [ ] Access class added to `awx/main/access.py`
- [ ] Positive + negative tests for the new endpoint
- [ ] `make api-lint` passes (black + flake8 + yamllint)
