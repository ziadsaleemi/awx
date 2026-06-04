import pytest


from awx.api.versioning import reverse


@pytest.mark.django_db
@pytest.mark.parametrize(
    "is_admin, status",
    [
        [True, 201],
        [False, 403],
    ],  # if they're a WFJ admin, they get a 201  # if they're not a WFJ *nor* org admin, they get a 403
)
def test_workflow_job_relaunch(workflow_job, post, admin_user, alice, is_admin, status):
    url = reverse("api:workflow_job_relaunch", kwargs={'pk': workflow_job.pk})
    if is_admin:
        post(url, user=admin_user, expect=status)
    else:
        post(url, user=alice, expect=status)


@pytest.mark.django_db
def test_workflow_job_relaunch_failure(workflow_job, post, admin_user):
    workflow_job.is_sliced_job = True
    workflow_job.job_template = None
    workflow_job.save()
    url = reverse("api:workflow_job_relaunch", kwargs={'pk': workflow_job.pk})
    post(url, user=admin_user, expect=400)


@pytest.mark.django_db
def test_workflow_job_relaunch_not_inventory_failure(workflow_job, post, admin_user):
    workflow_job.is_sliced_job = True
    workflow_job.inventory = None
    workflow_job.save()
    url = reverse("api:workflow_job_relaunch", kwargs={'pk': workflow_job.pk})
    post(url, user=admin_user, expect=400)


@pytest.mark.django_db
@pytest.mark.parametrize(
    "is_admin, status",
    [
        [True, 202],
        [False, 403],
    ],  # if they're a WFJ admin, they get a 202  # if they're not a WFJ *nor* org admin, they get a 403
)
def test_workflow_job_cancel(workflow_job, post, admin_user, alice, is_admin, status):
    url = reverse("api:workflow_job_cancel", kwargs={'pk': workflow_job.pk})
    if is_admin:
        post(url, user=admin_user, expect=status)
        workflow_job.refresh_from_db()
        assert workflow_job.status == 'canceled'
        assert workflow_job.cancel_flag is True
    else:
        post(url, user=alice, expect=status)


@pytest.mark.django_db
def test_workflow_job_cancel_running_unspawned_workflow(workflow_job_template, post, admin_user):
    workflow_job_template.workflow_nodes.create(identifier='stale-node')
    workflow_job = workflow_job_template.create_unified_job(_eager_fields={'status': 'running', 'created_by': admin_user})
    workflow_job.dependencies_processed = False
    workflow_job.save(update_fields=['dependencies_processed'])

    url = reverse("api:workflow_job_cancel", kwargs={'pk': workflow_job.pk})
    post(url, user=admin_user, expect=202)

    workflow_job.refresh_from_db()
    assert workflow_job.status == 'canceled'
    assert workflow_job.cancel_flag is True
    assert workflow_job.workflow_nodes.get(identifier='stale-node').do_not_run is True
