---
description: "Use when writing or editing AWX API views, serializers, permissions, or URL patterns in awx/api/. Covers base class selection, RBAC queryset filtering, pagination, serializer constraints, and URL registration."
applyTo: "awx/api/**"
---

# AWX API Conventions

## View base classes

Always inherit from the base classes in `awx/api/generics.py`, never from DRF generics directly:

| Purpose | Class |
|---------|-------|
| Read-only list | `ListAPIView` |
| Create + list | `ListCreateAPIView` |
| Sub-resource list (read-only) | `SubListAPIView` |
| Sub-resource list + create | `SubListCreateAPIView` |
| Sub-resource list + attach/detach | `SubListAttachDetachAPIView` or `SubListCreateAttachDetachAPIView` |
| Detail (read) | `RetrieveAPIView` |
| Detail (read + update) | `RetrieveUpdateAPIView` |
| Detail (read + update + delete) | `RetrieveUpdateDestroyAPIView` |

## RBAC queryset filtering

**Every list view must return an RBAC-filtered queryset.** The standard pattern is:

```python
class MyModelList(ListAPIView):
    model = MyModel
    serializer_class = MyModelSerializer
    # No get_queryset() needed — ListAPIView base class calls
    # self.request.user.get_queryset(self.model) automatically
```

Only override `get_queryset()` when you need extra annotations or filters _on top of_ RBAC:

```python
def get_queryset(self):
    qs = self.request.user.get_queryset(self.model)
    return qs.annotate(...)  # OK — RBAC filter is preserved
```

Never bypass RBAC with `Model.objects.all()` or `Model.objects.filter(...)` in list views.

## Pagination

All list endpoints inherit pagination automatically from `awx/api/pagination.py` — do **not** disable it or return unbounded querysets. If a view needs a different page size, set `pagination_class` to `LimitPagination`, not `None`.

## Serializers — no DB queries

**Never perform database queries inside serializer methods** (`to_representation`, `validate_*`, field definitions). Serializers run once per item in the result set; any query there becomes O(n) queries.

Put aggregation and related-object lookups in the view's `get_queryset()` as annotations or `select_related`/`prefetch_related`.

```python
# BAD — runs a query for every item in the page
class MySerializer(serializers.ModelSerializer):
    count = serializers.SerializerMethodField()

    def get_count(self, obj):
        return obj.related_set.count()  # N queries!

# GOOD — annotate once in the view
def get_queryset(self):
    return super().get_queryset().annotate(count=Count('related'))
```

## Permissions

The default permission class is `ModelAccessPermission` (auto-applied via `DEFAULT_PERMISSION_CLASSES`). Only override `permission_classes` for special-case views (e.g., webhook callbacks, metrics endpoints).

Never check `request.user.is_superuser` directly in views — use `check_user_access` from `awx.main.access` or rely on the access class.

## URL registration

Every new view must be registered in `awx/api/urls/<model_name>.py`. Follow the existing pattern:

```python
urls = [
    url(r'^$', views.MyModelList.as_view(), name='mymodel_list'),
    url(r'^(?P<pk>[0-9]+)/$', views.MyModelDetail.as_view(), name='mymodel_detail'),
]
```

Then include the URL module in `awx/api/urls/urls.py`.

## API discoverability

All endpoints must be reachable by traversal from `/api/v2/`. Add a `related` entry in the parent serializer pointing to any new sub-resource URL.

## i18n

Wrap all user-visible strings with `gettext_lazy`:

```python
from django.utils.translation import gettext_lazy as _

raise ValidationError(_("Something went wrong."))
```

Avoid jokes or FIXME comments in strings exposed in the API browser — see [API_STANDARDS.md](../../API_STANDARDS.md).
