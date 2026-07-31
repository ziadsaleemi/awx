import pytest
from django.test import override_settings

from awx.main.scheduler.task_manager_models import TaskManagerModels


class FakeMeta(object):
    model_name = 'job'


class FakeObject(object):
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)
            self._meta = FakeMeta()
            self._meta.concrete_model = self


class Job(FakeObject):
    def __init__(self, **kwargs):
        self.task_impact = kwargs.get('task_impact', 43)
        self.is_container_group_task = kwargs.get('is_container_group_task', False)
        self.controller_node = kwargs.get('controller_node', '')
        self.execution_node = kwargs.get('execution_node', '')
        self.instance_group = kwargs.get('instance_group', None)
        self.instance_group_id = self.instance_group.id if self.instance_group else None
        self.capacity_type = kwargs.get('capacity_type', 'execution')
        self.organization_id = kwargs.get('organization_id')
        self.preferred_instance_groups_cache = kwargs.get('preferred_instance_groups_cache')
        self.global_instance_groups = kwargs.get('global_instance_groups', [])

    def log_format(self):
        return 'job 382 (fake)'


class Instances(FakeObject):
    def add(self, *args):
        for instance in args:
            self.obj.instance_list.append(instance)

    def all(self):
        return self.obj.instance_list


class InstanceGroup(FakeObject):
    def __init__(self, **kwargs):
        super(InstanceGroup, self).__init__(**kwargs)
        self.instance_list = []
        self.pk = self.id = kwargs.get('id', 1)
        self.tenant_organization_id = kwargs.get('tenant_organization_id')
        self.tenant_status = kwargs.get('tenant_status', '')

    @property
    def instances(self):
        mgr = Instances(obj=self)
        return mgr

    @property
    def is_container_group(self):
        return False

    @property
    def max_concurrent_jobs(self):
        return 0

    @property
    def max_forks(self):
        return 0


class Instance(FakeObject):
    def __init__(self, **kwargs):
        self.node_type = kwargs.get('node_type', 'hybrid')
        self.capacity = kwargs.get('capacity', 0)
        self.hostname = kwargs.get('hostname', 'fakehostname')
        self.tenant_organization_id = kwargs.get('tenant_organization_id')
        self.consumed_capacity = 0
        self.jobs_running = 0


@pytest.fixture
def sample_cluster():
    def stand_up_cluster():
        ig_small = InstanceGroup(name='ig_small')
        ig_large = InstanceGroup(name='ig_large')
        default = InstanceGroup(name='default')
        i1 = Instance(hostname='i1', capacity=200, node_type='hybrid')
        i2 = Instance(hostname='i2', capacity=200, node_type='hybrid')
        i3 = Instance(hostname='i3', capacity=200, node_type='hybrid')
        ig_small.instances.add(i1)
        ig_large.instances.add(i2, i3)
        default.instances.add(i2)
        return [default, ig_large, ig_small]

    return stand_up_cluster


@pytest.fixture
def create_ig_manager():
    def _rf(ig_list, tasks):
        tm_models = TaskManagerModels.init_with_consumed_capacity(
            tasks=tasks,
            instances=set(inst for ig in ig_list for inst in ig.instance_list),
            instance_groups=ig_list,
        )
        return tm_models.instance_groups

    return _rf


def test_tenant_group_excludes_cross_tenant_instances():
    tenant_group = InstanceGroup(id=10, name='tenant-1', tenant_organization_id=1, tenant_status='active')
    tenant_instance = Instance(hostname='tenant-1-execution', capacity=200, node_type='execution', tenant_organization_id=1)
    foreign_instance = Instance(hostname='tenant-2-execution', capacity=200, node_type='execution', tenant_organization_id=2)
    tenant_group.instances.add(tenant_instance, foreign_instance)

    groups = TaskManagerModels(
        instances=[tenant_instance, foreign_instance],
        instance_groups=[tenant_group],
    ).instance_groups

    assert groups['tenant-1'].instance_hostnames == ('tenant-1-execution',)


@override_settings(CAPSTAN_PRODUCT_MODE='saas', CAPSTAN_SAAS_REQUIRE_EXTERNAL_EXECUTION=True)
def test_saas_task_uses_only_active_execution_pools_owned_by_its_tenant():
    owned = InstanceGroup(id=10, name='tenant-1', tenant_organization_id=1, tenant_status='active')
    suspended = InstanceGroup(id=11, name='tenant-1-suspended', tenant_organization_id=1, tenant_status='suspended')
    foreign = InstanceGroup(id=12, name='tenant-2', tenant_organization_id=2, tenant_status='active')
    shared = InstanceGroup(id=13, name='default')
    groups = TaskManagerModels(instances=[], instance_groups=[owned, suspended, foreign, shared]).instance_groups
    task = Job(
        organization_id=1,
        preferred_instance_groups_cache=[shared.id, foreign.id, suspended.id, owned.id],
        global_instance_groups=[shared],
    )

    assert groups.get_instance_groups_from_task_cache(task) == [owned]


@override_settings(CAPSTAN_PRODUCT_MODE='saas', CAPSTAN_SAAS_REQUIRE_EXTERNAL_EXECUTION=True)
def test_saas_task_without_owned_pool_fails_closed_without_global_fallback():
    shared = InstanceGroup(id=13, name='default')
    groups = TaskManagerModels(instances=[], instance_groups=[shared]).instance_groups
    task = Job(organization_id=1, preferred_instance_groups_cache=[], global_instance_groups=[shared])

    assert groups.get_instance_groups_from_task_cache(task) == []


@override_settings(CAPSTAN_PRODUCT_MODE='on_prem', CAPSTAN_SAAS_REQUIRE_EXTERNAL_EXECUTION=False)
def test_on_prem_task_without_cached_pool_retains_global_fallback():
    shared = InstanceGroup(id=13, name='default')
    groups = TaskManagerModels(instances=[], instance_groups=[shared]).instance_groups
    task = Job(organization_id=1, preferred_instance_groups_cache=[], global_instance_groups=[shared])

    assert groups.get_instance_groups_from_task_cache(task) == [shared]


@pytest.mark.parametrize('ig_name,consumed_capacity', [('default', 43), ('ig_large', 43 * 2), ('ig_small', 43)])
def test_running_capacity(sample_cluster, ig_name, consumed_capacity, create_ig_manager):
    default, ig_large, ig_small = sample_cluster()
    ig_list = [default, ig_large, ig_small]
    tasks = [Job(status='running', execution_node='i1'), Job(status='running', execution_node='i2'), Job(status='running', execution_node='i3')]

    instance_groups_mgr = create_ig_manager(ig_list, tasks)

    assert instance_groups_mgr.get_consumed_capacity(ig_name) == consumed_capacity


def test_offline_node_running(sample_cluster, create_ig_manager):
    """
    Assure that algorithm doesn't explode if a job is marked running
    in an offline node
    """
    default, ig_large, ig_small = sample_cluster()
    ig_small.instance_list[0].capacity = 0
    tasks = [Job(status='running', execution_node='i1')]
    instance_groups_mgr = create_ig_manager([default, ig_large, ig_small], tasks)
    assert instance_groups_mgr.get_consumed_capacity('ig_small') == 43
    assert instance_groups_mgr.get_remaining_capacity('ig_small') == 0


def test_offline_node_waiting(sample_cluster, create_ig_manager):
    """
    Same but for a waiting job
    """
    default, ig_large, ig_small = sample_cluster()
    ig_small.instance_list[0].capacity = 0
    tasks = [Job(status='waiting', execution_node='i1')]
    instance_groups_mgr = create_ig_manager([default, ig_large, ig_small], tasks)
    assert instance_groups_mgr.get_consumed_capacity('ig_small') == 43
    assert instance_groups_mgr.get_remaining_capacity('ig_small') == 0


def test_RBAC_reduced_filter(sample_cluster, create_ig_manager):
    """
    User can see jobs that are running in `ig_small` and `ig_large` IGs,
    but user does not have permission to see those actual instance groups.
    Verify that this does not blow everything up.
    """
    default, ig_large, ig_small = sample_cluster()
    tasks = [Job(status='waiting', execution_node='i1'), Job(status='waiting', execution_node='i2'), Job(status='waiting', execution_node='i3')]
    instance_groups_mgr = create_ig_manager([default], tasks)
    # Cross-links between groups not visible to current user,
    # so a naieve accounting of capacities is returned instead
    assert instance_groups_mgr.get_consumed_capacity('default') == 43


def Is(param):
    """
    param:
        [remaining_capacity1, remaining_capacity2, remaining_capacity3, ...]
        [(jobs_running1, capacity1), (jobs_running2, capacity2), (jobs_running3, capacity3), ...]
    """

    instances = []
    if isinstance(param[0], tuple):
        for index, (jobs_running, capacity) in enumerate(param):
            inst = Instance(capacity=capacity, node_type='execution', hostname=f'fakehost-{index}')
            inst.jobs_running = jobs_running
            instances.append(inst)
    else:
        for index, capacity in enumerate(param):
            inst = Instance(capacity=capacity, node_type='execution', hostname=f'fakehost-{index}')
            inst.node_type = 'execution'
            instances.append(inst)
    return instances


class TestSelectBestInstanceForTask(object):
    @pytest.mark.parametrize(
        'task,instances,instance_fit_index,reason',
        [
            (Job(task_impact=100), Is([100]), 0, "Only one, pick it"),
            (Job(task_impact=100), Is([100, 100]), 0, "Two equally good fits, pick the first"),
            (Job(task_impact=100), Is([50, 100]), 1, "First instance not as good as second instance"),
            (Job(task_impact=100), Is([50, 0, 20, 100, 100, 100, 30, 20]), 3, "Pick Instance [3] as it is the first that the task fits in."),
            (Job(task_impact=100), Is([50, 0, 20, 99, 11, 1, 5, 99]), None, "The task don't a fit, you must a quit!"),
        ],
    )
    def test_fit_task_to_most_remaining_capacity_instance(self, task, instances, instance_fit_index, reason):
        ig = InstanceGroup(id=10, name='controlplane')
        tasks = []
        for instance in instances:
            ig.instances.add(instance)
            for _ in range(instance.jobs_running):
                tasks.append(Job(execution_node=instance.hostname, controller_node=instance.hostname, instance_group=ig))
        tm_models = TaskManagerModels.init_with_consumed_capacity(tasks=tasks, instances=instances, instance_groups=[ig])
        instance_picked = tm_models.instance_groups.fit_task_to_most_remaining_capacity_instance(task, 'controlplane')

        if instance_fit_index is None:
            assert instance_picked is None, reason
        else:
            assert instance_picked.hostname == instances[instance_fit_index].hostname, reason

    @pytest.mark.parametrize(
        'instances,instance_fit_index,reason',
        [
            (Is([(0, 100)]), 0, "One idle instance, pick it"),
            (Is([(1, 100)]), None, "One un-idle instance, pick nothing"),
            (Is([(0, 100), (0, 200), (1, 500), (0, 700)]), 3, "Pick the largest idle instance"),
            (Is([(0, 100), (0, 200), (1, 10000), (0, 700), (0, 699)]), 3, "Pick the largest idle instance"),
            (Is([(0, 0)]), None, "One idle but down instance, don't pick it"),
        ],
    )
    def test_find_largest_idle_instance(self, instances, instance_fit_index, reason):
        ig = InstanceGroup(id=10, name='controlplane')
        tasks = []
        for instance in instances:
            ig.instances.add(instance)
            for _ in range(instance.jobs_running):
                tasks.append(Job(execution_node=instance.hostname, controller_node=instance.hostname, instance_group=ig))
        tm_models = TaskManagerModels.init_with_consumed_capacity(tasks=tasks, instances=instances, instance_groups=[ig])

        if instance_fit_index is None:
            assert tm_models.instance_groups.find_largest_idle_instance('controlplane') is None, reason
        else:
            assert tm_models.instance_groups.find_largest_idle_instance('controlplane').hostname == instances[instance_fit_index].hostname, reason
