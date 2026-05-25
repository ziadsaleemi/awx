---
description: "Diagnose why a user can't see or act on a resource: trace the RBAC access class, filtered_queryset, permission_registry, and object-level can_* methods step by step."
---

# Debug AWX RBAC

Use this prompt when a user (or automated test) is getting unexpected 403 / empty list / missing object behaviour from the AWX API.

---

## Step 1 — Identify the model and action

Determine which model is involved and what operation is failing:

| HTTP status / symptom | Likely cause |
|-----------------------|--------------|
| `403 Forbidden` on collection | `can_add()` returned `False` |
| `403 Forbidden` on detail action | `can_change()` or `can_delete()` returned `False` |
| `404 Not Found` on detail | Object exists but is filtered out of the queryset — `can_read()` is `False` |
| Empty `results` list | `filtered_queryset()` returns nothing for this user |
| `403` on a sub-list attach | `can_attach()` returned `False` |

---

## Step 2 — Find the access class

Open `awx/main/access.py` and search for the model:

```python
# access_registry is populated at module load by all BaseAccess subclasses
grep 'model = MyModel' awx/main/access.py
```

The access class will have `model = MyModel`. If none exists, the model is **not RBAC-protected** — that is likely the bug.

---

## Step 3 — Trace `filtered_queryset()`

```python
# In a Django shell inside the container:
awx-manage shell

from awx.main.models import MyModel
from awx.main.access import MyModelAccess
from django.contrib.auth.models import User

user = User.objects.get(username='alice')
access = MyModelAccess(user)

# What does the user actually see?
qs = access.filtered_queryset()
print(qs.query)   # Shows the raw SQL including WHERE clauses
print(qs.count())

# Does the specific object appear?
obj = MyModel.objects.get(pk=42)
print(qs.filter(pk=obj.pk).exists())  # True = visible, False = filtered out
```

If `filtered_queryset()` delegates to `self.model.access_qs(self.user, 'view')`, the model is registered with `django-ansible-base`'s `permission_registry`. Check:

```python
from ansible_base.rbac import permission_registry
print(permission_registry.is_registered(MyModel))   # should be True
```

---

## Step 4 — Check object-level `can_*` methods

```python
from awx.main.access import check_user_access

obj = MyModel.objects.get(pk=42)

# Can the user read, change, delete?
print(check_user_access(user, MyModel, 'read', obj))
print(check_user_access(user, MyModel, 'change', obj, {}))
print(check_user_access(user, MyModel, 'delete', obj))
```

To see the full decision with debug messages, use:

```python
from awx.main.access import MyModelAccess

access = MyModelAccess(user, save_messages=True)
result = access.can_change(obj, {})
print(result, access.messages)
```

---

## Step 5 — Check `permission_registry` role assignments

If the model uses `django-ansible-base` RBAC:

```python
from ansible_base.rbac.models import RoleEvaluation, RoleDefinition

# What roles does alice have on obj?
RoleEvaluation.objects.filter(
    content_type__app_label='main',
    content_type__model='mymodel',
    object_id=obj.pk,
    role__users=user,
).select_related('role__role_definition')
```

If `RoleEvaluation` is empty, the user has no direct or inherited permission on the object.

---

## Step 6 — Common fixes

| Root cause | Fix |
|------------|-----|
| Access class missing | Add a `BaseAccess` subclass with `model = MyModel` to `access.py` |
| `filtered_queryset` not overridden and model not in `permission_registry` | Either register the model with `permission_registry.register(MyModel, ...)` in `awx/main/apps.py`, or override `filtered_queryset()` manually |
| `can_add` / `can_change` always returns `False` for non-superusers | Override the method to check the appropriate role or team membership |
| View not using RBAC queryset | The view's `get_queryset()` must delegate to `self.request.user.get_queryset(self.model)` — do not call `MyModel.objects.all()` directly |
| Permission not registered in `apps.py` | Add the model's permissions to `permission_registry.register(...)` in `awx/main/apps.py` |

---

## Step 7 — Write a regression test

Add a functional test in `awx/main/tests/functional/` that reproduces the scenario:

```python
import pytest
from django.urls import reverse

@pytest.mark.django_db
def test_alice_cannot_see_bobs_resource(get, alice, bob, my_resource_factory):
    """alice should not see resources she has no role on."""
    obj = my_resource_factory(created_by=bob)
    url = reverse('api:mymodel_list')
    response = get(url, user=alice)
    assert response.status_code == 200
    assert response.data['count'] == 0

@pytest.mark.django_db
def test_alice_can_see_her_own_resource(get, alice, my_resource_factory):
    obj = my_resource_factory(created_by=alice)
    url = reverse('api:mymodel_list')
    response = get(url, user=alice)
    assert response.status_code == 200
    assert response.data['count'] == 1
```
