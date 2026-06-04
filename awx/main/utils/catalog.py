import logging

logger = logging.getLogger('awx.main.utils.catalog')


def catalog_related_object_matches_item_org(item, obj):
    if obj is None or item.organization_id is None:
        return True
    return getattr(obj, 'organization_id', None) == item.organization_id


def collect_catalog_deployment_saved_vars(deployment):
    saved_vars = {}
    if isinstance(deployment.extra_vars, dict):
        saved_vars.update(deployment.extra_vars)

    if deployment.provision_job_id and deployment.provision_job:
        try:
            saved_vars.update(deployment.provision_job.get_real_instance().get_effective_artifacts(parents_set=set()))
        except Exception:
            logger.exception('Failed to collect workflow artifacts for CatalogDeployment %s', deployment.pk)

    if deployment.terraform_provision_job_id and deployment.terraform_provision_job:
        artifacts = deployment.terraform_provision_job.artifacts
        if isinstance(artifacts, dict):
            saved_vars.update(artifacts)

    return saved_vars
