def create_missing_implicit_roles(apps, *model_names):
    """Create implicit roles for historical migration models without firing model save signals."""
    ContentType = apps.get_model('contenttypes', 'ContentType')
    Role = apps.get_model('main', 'Role')

    for model_name in model_names:
        model = apps.get_model('main', model_name)
        implicit_role_fields = getattr(model, '__implicit_role_fields', [])
        if not implicit_role_fields:
            continue

        content_type_id = ContentType.objects.get_for_model(model).id
        role_field_names = {field.name for field in implicit_role_fields}

        # Historical migration models may retain default ordering from a
        # later state where an ordering field has already been removed.
        for obj in model.objects.all().order_by().iterator():
            existing_roles = {
                role.role_field: role.id
                for role in Role.objects.filter(
                    content_type_id=content_type_id,
                    object_id=obj.pk,
                    role_field__in=role_field_names,
                )
            }
            missing_roles = [
                Role(role_field=field.name, content_type_id=content_type_id, object_id=obj.pk)
                for field in implicit_role_fields
                if field.name not in existing_roles and getattr(obj, field.attname, None) is None
            ]
            if missing_roles:
                Role.objects.bulk_create(missing_roles)
                existing_roles = {
                    role.role_field: role.id
                    for role in Role.objects.filter(
                        content_type_id=content_type_id,
                        object_id=obj.pk,
                        role_field__in=role_field_names,
                    )
                }

            updates = {
                field.attname: existing_roles[field.name]
                for field in implicit_role_fields
                if field.name in existing_roles and getattr(obj, field.attname, None) is None
            }
            if updates:
                model.objects.filter(pk=obj.pk).update(**updates)
