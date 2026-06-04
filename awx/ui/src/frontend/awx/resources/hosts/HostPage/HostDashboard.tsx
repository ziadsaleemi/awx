import { ChartPie } from '@patternfly/react-charts';
import {
  Alert,
  Bullseye,
  Button,
  CardBody,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  EmptyState,
  EmptyStateBody,
  EmptyStateHeader,
  EmptyStateIcon,
  EmptyStateVariant,
  Flex,
  FlexItem,
  Label,
  Progress,
  ProgressSize,
  Spinner,
  Stack,
  StackItem,
  Text,
  TextContent,
  TextVariants,
} from '@patternfly/react-core';
import { CheckIcon, ServerIcon, SyncAltIcon } from '@patternfly/react-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { PageDashboard } from '../../../../../framework/PageDashboard/PageDashboard';
import { PageDashboardCard } from '../../../../../framework/PageDashboard/PageDashboardCard';
import { postRequest, requestGet } from '../../../../common/crud/Data';
import { useGet } from '../../../../common/crud/useGet';
import { awxAPI } from '../../../common/api/awx-utils';
import { Credential } from '../../../interfaces/Credential';
import { useGetHost } from '../hooks/useGetHost';
import { Sparkline } from '../../templates/components/Sparkline';

type HostFacts = Record<string, unknown>;
type FactPullState = 'idle' | 'loading' | 'success';

const FACT_PULL_POLL_INTERVAL_MS = 1000;
const FACT_PULL_MAX_ATTEMPTS = 90;
const FACT_PULL_MIN_LOADING_MS = 750;
const FACT_PULL_SUCCESS_MS = 1400;
const FINISHED_JOB_STATUSES = new Set(['successful', 'failed', 'error', 'canceled']);
const PSEUDO_BLOCK_DEVICE_PATTERN = /^(ram|loop|nbd)\d+$/;

type CredentialsResponse = {
  count: number;
  results: Credential[];
};

type FactPullPayload = {
  credential: number;
  module_name: 'setup';
  module_args: string;
  forks: number;
  verbosity: number;
  become_enabled: boolean;
  diff_mode: boolean;
  extra_vars: string;
};

type AdHocCommandStatus = {
  id: number;
  status: string;
  host_status_counts?: Record<string, number> | null;
  job_explanation?: string;
  result_traceback?: string;
};

type MountFact = {
  mount?: string;
  device?: string;
  size_total?: number;
  size_available?: number;
  fstype?: string;
};

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function getNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function getFactString(facts: HostFacts, key: string) {
  return getString(facts[key]);
}

function getNestedNumber(facts: HostFacts, path: string[]) {
  let current: unknown = facts;
  for (const key of path) {
    current = getRecord(current)[key];
  }
  return getNumber(current);
}

function formatMb(value?: number) {
  if (value === undefined || value === null) return 'Not available';
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} TB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} GB`;
  return `${Math.round(value)} MB`;
}

function formatBytes(value?: number) {
  if (value === undefined || value === null) return 'Not available';
  const gb = value / 1024 / 1024 / 1024;
  if (gb >= 1024) return `${(gb / 1024).toFixed(1)} TB`;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(value / 1024 / 1024).toFixed(0)} MB`;
}

function formatDuration(seconds?: number) {
  if (!seconds) return 'Not available';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function formatBoolean(value: unknown) {
  if (typeof value !== 'boolean') return undefined;
  return value ? 'Yes' : 'No';
}

function formatList(values: unknown, limit = 4) {
  if (!Array.isArray(values)) return undefined;
  const displayValues = values.map(getString).filter((value): value is string => !!value);
  if (!displayValues.length) return undefined;
  const visibleValues = displayValues.slice(0, limit).join(', ');
  return displayValues.length > limit
    ? `${visibleValues} +${displayValues.length - limit} more`
    : visibleValues;
}

function formatFactTimestamp(facts: HostFacts) {
  const dateTime = getRecord(facts.ansible_date_time);
  const iso =
    getString(dateTime.iso8601) ??
    getString(dateTime.iso8601_micro) ??
    getString(dateTime.iso8601_basic);
  if (iso?.includes('T')) {
    return iso
      .replace('T', ' ')
      .replace(/\.\d+Z$/, ' UTC')
      .replace(/Z$/, ' UTC');
  }
  const date = getString(dateTime.date);
  const time = getString(dateTime.time);
  const timezone = getString(dateTime.tz) ?? getString(dateTime.tz_offset);
  if (date && time) return `${date} ${time}${timezone ? ` ${timezone}` : ''}`;
  return undefined;
}

function usedPercent(total?: number, available?: number) {
  if (!total || available === undefined || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(((total - available) / total) * 100)));
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getMounts(facts: HostFacts) {
  return Array.isArray(facts.ansible_mounts)
    ? (facts.ansible_mounts as MountFact[])
        .filter((mount) => mount.size_total && mount.size_total > 0)
        .sort((a, b) => (b.size_total ?? 0) - (a.size_total ?? 0))
    : [];
}

function getDeviceSummaries(facts: HostFacts) {
  return Object.entries(getRecord(facts.ansible_devices))
    .map(([name, value]) => {
      const device = getRecord(value);
      const partitions = Object.keys(getRecord(device.partitions)).length;
      return {
        name,
        size: getString(device.size),
        model: getString(device.model),
        vendor: getString(device.vendor),
        rotational: getString(device.rotational),
        virtual: getString(device.virtual),
        scheduler: getString(device.scheduler_mode),
        partitions,
      };
    })
    .filter(
      (device) =>
        device.size &&
        device.size !== '0.00 Bytes' &&
        !PSEUDO_BLOCK_DEVICE_PATTERN.test(device.name)
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getInterfaceSummaries(facts: HostFacts, interfaceNames: unknown[]) {
  return interfaceNames
    .map(getString)
    .filter((name): name is string => !!name)
    .map((name) => {
      const network = getRecord(facts[`ansible_${name}`]);
      const ipv4 = getRecord(network.ipv4);
      const ipv6 = Array.isArray(network.ipv6)
        ? network.ipv6
            .map((address) => getString(getRecord(address).address))
            .filter((address): address is string => !!address)
        : [];
      return {
        name,
        active: network.active === true,
        address: getString(ipv4.address),
        mac: getString(network.macaddress),
        mtu: getNumber(network.mtu),
        speed: getNumber(network.speed),
        type: getString(network.type),
        ipv6,
      };
    })
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      if (a.name === 'lo') return 1;
      if (b.name === 'lo') return -1;
      return a.name.localeCompare(b.name);
    });
}

function useHostFactSummary(facts: HostFacts) {
  return useMemo(() => {
    const memoryTotal =
      getNumber(facts.ansible_memtotal_mb) ??
      getNestedNumber(facts, ['ansible_memory_mb', 'real', 'total']);
    const memoryFree =
      getNumber(facts.ansible_memfree_mb) ??
      getNestedNumber(facts, ['ansible_memory_mb', 'real', 'free']);
    const swapTotal =
      getNumber(facts.ansible_swaptotal_mb) ??
      getNestedNumber(facts, ['ansible_memory_mb', 'swap', 'total']);
    const swapFree =
      getNumber(facts.ansible_swapfree_mb) ??
      getNestedNumber(facts, ['ansible_memory_mb', 'swap', 'free']);
    const cpuCount =
      getNumber(facts.ansible_processor_vcpus) ??
      getNumber(facts.ansible_processor_nproc) ??
      getNumber(facts.ansible_processor_count);
    const mounts = getMounts(facts);
    const storageTotal = mounts.reduce((total, mount) => total + (mount.size_total ?? 0), 0);
    const storageAvailable = mounts.reduce(
      (total, mount) => total + (mount.size_available ?? 0),
      0
    );
    const defaultIpv4 = getRecord(facts.ansible_default_ipv4);
    const interfaces = Array.isArray(facts.ansible_interfaces)
      ? (facts.ansible_interfaces as unknown[])
      : [];
    const loadAverage = getRecord(facts.ansible_loadavg);
    const dns = getRecord(facts.ansible_dns);
    const selinux = getRecord(facts.ansible_selinux);
    const appArmor = getRecord(facts.ansible_apparmor);
    const devices = getDeviceSummaries(facts);
    const interfaceDetails = getInterfaceSummaries(facts, interfaces);

    return {
      cpuCount,
      cpuCores: getNumber(facts.ansible_processor_cores),
      cpuSockets: getNumber(facts.ansible_processor_count),
      cpuThreadsPerCore: getNumber(facts.ansible_processor_threads_per_core),
      memoryTotal,
      memoryFree,
      memoryUsedPct: usedPercent(memoryTotal, memoryFree),
      swapTotal,
      swapFree,
      swapUsedPct: usedPercent(swapTotal, swapFree),
      storageTotal,
      storageAvailable,
      storageUsedPct: usedPercent(storageTotal, storageAvailable),
      mounts,
      defaultAddress: getString(defaultIpv4.address),
      defaultInterface: getString(defaultIpv4.interface),
      defaultGateway: getString(defaultIpv4.gateway),
      defaultMac: getString(defaultIpv4.macaddress),
      interfaces,
      interfaceDetails,
      allIpv4: formatList(facts.ansible_all_ipv4_addresses, 8),
      allIpv6: formatList(facts.ansible_all_ipv6_addresses, 4),
      dnsNameservers: formatList(dns.nameservers, 4),
      dnsSearch: formatList(dns.search, 4),
      loadAverage:
        getNumber(loadAverage['1m']) !== undefined
          ? `${getNumber(loadAverage['1m'])} / ${getNumber(loadAverage['5m']) ?? 0} / ${
              getNumber(loadAverage['15m']) ?? 0
            }`
          : undefined,
      lastFactPull: formatFactTimestamp(facts),
      hostname: getFactString(facts, 'ansible_hostname'),
      fqdn: getFactString(facts, 'ansible_fqdn'),
      domain: getFactString(facts, 'ansible_domain'),
      nodename: getFactString(facts, 'ansible_nodename'),
      userId: getFactString(facts, 'ansible_user_id'),
      userDir: getFactString(facts, 'ansible_user_dir'),
      userShell: getFactString(facts, 'ansible_user_shell'),
      userUid: getNumber(facts.ansible_user_uid),
      userGid: getNumber(facts.ansible_user_gid),
      machineId: getFactString(facts, 'ansible_machine_id'),
      osFamily: getFactString(facts, 'ansible_os_family'),
      distributionRelease: getFactString(facts, 'ansible_distribution_release'),
      distributionMajorVersion: getFactString(facts, 'ansible_distribution_major_version'),
      machine: getFactString(facts, 'ansible_machine'),
      userspaceBits: getFactString(facts, 'ansible_userspace_bits'),
      kernelVersion: getFactString(facts, 'ansible_kernel_version'),
      system: getFactString(facts, 'ansible_system'),
      productName: getFactString(facts, 'ansible_product_name'),
      productVersion: getFactString(facts, 'ansible_product_version'),
      productSerial: getFactString(facts, 'ansible_product_serial'),
      systemVendor: getFactString(facts, 'ansible_system_vendor'),
      formFactor: getFactString(facts, 'ansible_form_factor'),
      biosVendor: getFactString(facts, 'ansible_bios_vendor'),
      biosVersion: getFactString(facts, 'ansible_bios_version'),
      biosDate: getFactString(facts, 'ansible_bios_date'),
      boardName: getFactString(facts, 'ansible_board_name'),
      virtualizationRole: getFactString(facts, 'ansible_virtualization_role'),
      selinuxStatus: getString(selinux.status),
      appArmorStatus: getString(appArmor.status),
      fips: formatBoolean(facts.ansible_fips),
      isChroot: formatBoolean(facts.ansible_is_chroot),
      capabilitiesEnforced: getFactString(facts, 'ansible_system_capabilities_enforced'),
      locallyReachableIpv4: formatList(getRecord(facts.ansible_locally_reachable_ips).ipv4, 6),
      devices,
      factCount: Object.keys(facts).length,
    };
  }, [facts]);
}

function Stat(props: { label: string; value: string | number; tone?: 'good' | 'warn' }) {
  const color =
    props.tone === 'good'
      ? 'var(--pf-v5-global--success-color--100)'
      : props.tone === 'warn'
        ? 'var(--pf-v5-global--warning-color--100)'
        : undefined;
  return (
    <StackItem>
      <TextContent>
        <Text component={TextVariants.small}>{props.label}</Text>
        <Text component={TextVariants.h2} style={{ marginTop: 2, color }}>
          {props.value}
        </Text>
      </TextContent>
    </StackItem>
  );
}

function Detail(props: { label: string; value?: string | number }) {
  const { t } = useTranslation();
  return (
    <DescriptionListGroup>
      <DescriptionListTerm>{props.label}</DescriptionListTerm>
      <DescriptionListDescription style={{ overflowWrap: 'anywhere' }}>
        {props.value || t('Not available')}
      </DescriptionListDescription>
    </DescriptionListGroup>
  );
}

function UsageRow(props: { label: string; value: number; description?: string }) {
  return (
    <StackItem>
      <Flex alignItems={{ default: 'alignItemsCenter' }}>
        <FlexItem grow={{ default: 'grow' }}>
          <div style={{ fontSize: 12, marginBottom: 4 }}>{props.label}</div>
        </FlexItem>
        {props.description && (
          <FlexItem>
            <Text component={TextVariants.small}>{props.description}</Text>
          </FlexItem>
        )}
      </Flex>
      <Progress value={props.value} size={ProgressSize.sm} title={`${props.value}%`} />
    </StackItem>
  );
}

function InlineRows(props: { rows: { label: string; value?: string | number }[] }) {
  const { t } = useTranslation();
  return (
    <Stack hasGutter>
      {props.rows.map((row) => (
        <StackItem key={row.label}>
          <Flex spaceItems={{ default: 'spaceItemsMd' }}>
            <FlexItem style={{ minWidth: 120 }}>
              <Text component={TextVariants.small} style={{ fontWeight: 600 }}>
                {row.label}
              </Text>
            </FlexItem>
            <FlexItem grow={{ default: 'grow' }}>
              <Text component={TextVariants.small} style={{ overflowWrap: 'anywhere' }}>
                {row.value || t('Not available')}
              </Text>
            </FlexItem>
          </Flex>
        </StackItem>
      ))}
    </Stack>
  );
}

export function HostDashboard(props: { page: 'host' | 'inventory' }) {
  const { t } = useTranslation();
  const params = useParams<{ id: string; host_id: string }>();
  const hostId = props.page === 'host' ? params.id ?? '' : params.host_id ?? '';
  const factPullResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [factPullError, setFactPullError] = useState<string>();
  const [factPullState, setFactPullState] = useState<FactPullState>('idle');
  const { host } = useGetHost(hostId);
  const {
    data: facts,
    isLoading,
    refresh: refreshFacts,
  } = useGet<HostFacts>(awxAPI`/hosts/${hostId}/ansible_facts/`);
  const { data: credentials, isLoading: credentialsLoading } = useGet<CredentialsResponse>(
    awxAPI`/credentials/?credential_type__namespace=ssh&order_by=name&page_size=1`
  );
  const credentialId = credentials?.results?.[0]?.id;
  const safeFacts = facts ?? {};
  const summary = useHostFactSummary(safeFacts);
  const recentPlaybookJobs = host?.summary_fields?.recent_jobs?.map((job) => ({
    ...job,
    canceled_on: null,
  }));
  useEffect(
    () => () => {
      if (factPullResetTimer.current) clearTimeout(factPullResetTimer.current);
    },
    []
  );
  const waitForFactPull = useCallback(
    async (jobId: number) => {
      for (let attempt = 0; attempt < FACT_PULL_MAX_ATTEMPTS; attempt++) {
        const job = await requestGet<AdHocCommandStatus>(
          awxAPI`/ad_hoc_commands/${String(jobId)}/`
        );
        if (FINISHED_JOB_STATUSES.has(job.status)) {
          if (job.status === 'successful') {
            if (job.host_status_counts !== undefined && job.host_status_counts !== null) return;
            await delay(FACT_PULL_POLL_INTERVAL_MS);
            continue;
          }
          throw new Error(
            job.job_explanation ||
              job.result_traceback ||
              t('Fact collection finished with status {{status}}.', { status: job.status })
          );
        }
        await delay(FACT_PULL_POLL_INTERVAL_MS);
      }
      throw new Error(t('Timed out waiting for fact collection to finish.'));
    },
    [t]
  );
  const pullFacts = useCallback(async () => {
    if (factPullResetTimer.current) {
      clearTimeout(factPullResetTimer.current);
      factPullResetTimer.current = null;
    }
    if (!credentialId) {
      setFactPullError(t('No usable SSH credential is available for fact collection.'));
      return;
    }
    flushSync(() => {
      setFactPullError(undefined);
      setFactPullState('loading');
    });
    const loadingStartedAt = Date.now();
    try {
      const result = await postRequest<{ id: number }, FactPullPayload>(
        awxAPI`/hosts/${hostId}/ad_hoc_commands/`,
        {
          credential: credentialId,
          module_name: 'setup',
          module_args: '',
          forks: 0,
          verbosity: 0,
          become_enabled: false,
          diff_mode: false,
          extra_vars: '',
        }
      );
      await waitForFactPull(result.id);
      const loadingElapsed = Date.now() - loadingStartedAt;
      if (loadingElapsed < FACT_PULL_MIN_LOADING_MS) {
        await delay(FACT_PULL_MIN_LOADING_MS - loadingElapsed);
      }
      refreshFacts();
      setFactPullState('success');
      factPullResetTimer.current = setTimeout(() => {
        setFactPullState('idle');
      }, FACT_PULL_SUCCESS_MS);
    } catch (error) {
      setFactPullState('idle');
      setFactPullError(
        error instanceof Error ? error.message : t('Unable to launch fact collection.')
      );
    }
  }, [credentialId, hostId, refreshFacts, t, waitForFactPull]);
  const isPullingFacts = factPullState === 'loading';
  const didPullFacts = factPullState === 'success';
  const factPullButtonLabel = isPullingFacts
    ? t('Pulling facts')
    : didPullFacts
      ? t('Facts updated')
      : t('Pull facts');
  const pullFactsButton = (
    <Button
      icon={isPullingFacts ? <Spinner size="sm" /> : didPullFacts ? <CheckIcon /> : <SyncAltIcon />}
      isDisabled={isPullingFacts || didPullFacts || !hostId || credentialsLoading || !credentialId}
      aria-label={factPullButtonLabel}
      title={factPullButtonLabel}
      data-fact-pull-state={factPullState}
      onClick={() => void pullFacts()}
      data-cy="pull-host-facts"
    >
      {factPullButtonLabel}
    </Button>
  );
  const factPullAlert = factPullError ? (
    <Alert variant="danger" isInline title={factPullError} style={{ marginBottom: 16 }} />
  ) : null;

  if (isLoading) {
    return (
      <Bullseye style={{ minHeight: 240 }}>
        <Spinner />
      </Bullseye>
    );
  }

  if (!summary.factCount) {
    return (
      <PageDashboard>
        <PageDashboardCard title={t('Host dashboard')} width="full" height="md">
          <CardBody>
            {factPullAlert}
            <Bullseye>
              <EmptyState variant={EmptyStateVariant.lg}>
                <EmptyStateHeader
                  titleText={t('No facts available')}
                  headingLevel="h2"
                  icon={<EmptyStateIcon icon={ServerIcon} />}
                />
                <EmptyStateBody>
                  {t('Run a job with gather facts enabled to populate this host dashboard.')}
                </EmptyStateBody>
                <div style={{ marginTop: 16 }}>{pullFactsButton}</div>
              </EmptyState>
            </Bullseye>
          </CardBody>
        </PageDashboardCard>
      </PageDashboard>
    );
  }

  return (
    <PageDashboard>
      <PageDashboardCard title={t('System summary')} subtitle={host?.name} width="full" height="sm">
        <CardBody>
          {factPullAlert}
          <Flex
            spaceItems={{ default: 'spaceItems2xl' }}
            alignItems={{ default: 'alignItemsFlexStart' }}
          >
            <FlexItem grow={{ default: 'grow' }}>
              <DescriptionList isHorizontal isCompact columnModifier={{ default: '2Col' }}>
                <Detail
                  label={t('Operating system')}
                  value={getFactString(safeFacts, 'ansible_distribution')}
                />
                <Detail label={t('Last facts pull')} value={summary.lastFactPull} />
                <Detail label={t('Hostname')} value={summary.hostname} />
                <Detail label={t('FQDN')} value={summary.fqdn} />
                <Detail
                  label={t('Version')}
                  value={getFactString(safeFacts, 'ansible_distribution_version')}
                />
                <Detail label={t('Kernel')} value={getFactString(safeFacts, 'ansible_kernel')} />
                <Detail
                  label={t('Architecture')}
                  value={getFactString(safeFacts, 'ansible_architecture')}
                />
                <Detail
                  label={t('Virtualization')}
                  value={getFactString(safeFacts, 'ansible_virtualization_type')}
                />
                <Detail
                  label={t('Uptime')}
                  value={formatDuration(getNumber(safeFacts.ansible_uptime_seconds))}
                />
              </DescriptionList>
            </FlexItem>
            {host && (
              <FlexItem>
                <Label color={host.enabled ? 'green' : 'red'}>
                  {host.enabled ? t('Enabled') : t('Disabled')}
                </Label>
              </FlexItem>
            )}
            <FlexItem>{pullFactsButton}</FlexItem>
          </Flex>
        </CardBody>
      </PageDashboardCard>

      <PageDashboardCard title={t('Compute')} width="half" height="md">
        <CardBody>
          <Stack hasGutter>
            <Flex spaceItems={{ default: 'spaceItems2xl' }}>
              <FlexItem>
                <Stat label={t('vCPUs')} value={summary.cpuCount ?? t('Not available')} />
              </FlexItem>
              <FlexItem>
                <Stat
                  label={t('Memory')}
                  value={formatMb(summary.memoryTotal)}
                  tone={summary.memoryUsedPct > 85 ? 'warn' : 'good'}
                />
              </FlexItem>
            </Flex>
            <UsageRow
              label={t('Memory used')}
              value={summary.memoryUsedPct}
              description={`${formatMb((summary.memoryTotal ?? 0) - (summary.memoryFree ?? 0))} / ${formatMb(summary.memoryTotal)}`}
            />
            {!!summary.swapTotal && (
              <UsageRow
                label={t('Swap used')}
                value={summary.swapUsedPct}
                description={`${formatMb(summary.swapTotal - (summary.swapFree ?? 0))} / ${formatMb(summary.swapTotal)}`}
              />
            )}
            <InlineRows
              rows={[
                { label: t('Load avg'), value: summary.loadAverage },
                {
                  label: t('CPU topology'),
                  value:
                    summary.cpuSockets || summary.cpuCores || summary.cpuThreadsPerCore
                      ? t('{{sockets}} sockets / {{cores}} cores / {{threads}} threads', {
                          sockets: summary.cpuSockets ?? 0,
                          cores: summary.cpuCores ?? 0,
                          threads: summary.cpuThreadsPerCore ?? 0,
                        })
                      : undefined,
                },
                { label: t('Machine'), value: summary.machine },
                { label: t('Userspace'), value: summary.userspaceBits },
              ]}
            />
          </Stack>
        </CardBody>
      </PageDashboardCard>

      <PageDashboardCard title={t('Capacity')} width="half" height="md">
        <CardBody>
          <Flex
            alignItems={{ default: 'alignItemsCenter' }}
            spaceItems={{ default: 'spaceItems2xl' }}
          >
            <FlexItem>
              <div style={{ width: 180, height: 180 }}>
                <ChartPie
                  ariaDesc={t('Storage used')}
                  ariaTitle={t('Storage used')}
                  data={[
                    { x: t('Used'), y: summary.storageUsedPct },
                    { x: t('Free'), y: Math.max(0, 100 - summary.storageUsedPct) },
                  ]}
                  width={180}
                  height={180}
                  padding={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  colorScale={[
                    'var(--pf-v5-global--primary-color--100)',
                    'var(--pf-v5-global--BackgroundColor--200)',
                  ]}
                  allowTooltip={false}
                />
              </div>
            </FlexItem>
            <FlexItem grow={{ default: 'grow' }}>
              <Stack hasGutter>
                <Stat label={t('Storage used')} value={`${summary.storageUsedPct}%`} />
                <Text component={TextVariants.small}>
                  {formatBytes(summary.storageTotal - summary.storageAvailable)} {t('of')}{' '}
                  {formatBytes(summary.storageTotal)}
                </Text>
                <Text component={TextVariants.small}>
                  {t('{{count}} mounted filesystems', { count: summary.mounts.length })}
                </Text>
              </Stack>
            </FlexItem>
          </Flex>
        </CardBody>
      </PageDashboardCard>

      <PageDashboardCard title={t('Storage')} width="full" height="md">
        <CardBody>
          <Stack hasGutter>
            {summary.mounts.slice(0, 6).map((mount) => {
              const pct = usedPercent(mount.size_total, mount.size_available);
              return (
                <UsageRow
                  key={`${mount.device ?? ''}-${mount.mount ?? ''}`}
                  label={`${mount.mount ?? t('Unknown mount')} ${mount.device ? `(${mount.device})` : ''}`}
                  value={pct}
                  description={`${formatBytes((mount.size_total ?? 0) - (mount.size_available ?? 0))} / ${formatBytes(mount.size_total)}`}
                />
              );
            })}
          </Stack>
        </CardBody>
      </PageDashboardCard>

      <PageDashboardCard title={t('Network')} width="half" height="sm">
        <CardBody>
          <DescriptionList isHorizontal isCompact>
            <Detail label={t('Primary address')} value={summary.defaultAddress} />
            <Detail label={t('Primary interface')} value={summary.defaultInterface} />
            <Detail label={t('Gateway')} value={summary.defaultGateway} />
            <Detail label={t('Primary MAC')} value={summary.defaultMac} />
            <Detail label={t('Interfaces')} value={summary.interfaces.length} />
            <Detail label={t('IPv4 addresses')} value={summary.allIpv4} />
            <Detail label={t('IPv6 addresses')} value={summary.allIpv6} />
            <Detail label={t('DNS servers')} value={summary.dnsNameservers} />
            <Detail label={t('DNS search')} value={summary.dnsSearch} />
          </DescriptionList>
        </CardBody>
      </PageDashboardCard>

      <PageDashboardCard title={t('Runtime')} width="half" height="sm">
        <CardBody>
          <DescriptionList isHorizontal isCompact>
            <Detail
              label={t('Python')}
              value={getFactString(safeFacts, 'ansible_python_version')}
            />
            <Detail
              label={t('Package manager')}
              value={getFactString(safeFacts, 'ansible_pkg_mgr')}
            />
            <Detail
              label={t('Service manager')}
              value={getFactString(safeFacts, 'ansible_service_mgr')}
            />
            <Detail label={t('OS family')} value={summary.osFamily} />
            <Detail label={t('Release')} value={summary.distributionRelease} />
            <Detail label={t('Major version')} value={summary.distributionMajorVersion} />
            <Detail label={t('Fact keys')} value={summary.factCount} />
          </DescriptionList>
        </CardBody>
      </PageDashboardCard>

      <PageDashboardCard title={t('Identity')} width="half" height="sm">
        <CardBody>
          <DescriptionList isHorizontal isCompact>
            <Detail label={t('Node name')} value={summary.nodename} />
            <Detail label={t('Domain')} value={summary.domain} />
            <Detail label={t('User')} value={summary.userId} />
            <Detail
              label={t('UID / GID')}
              value={
                summary.userUid !== undefined || summary.userGid !== undefined
                  ? `${summary.userUid ?? t('Not available')} / ${summary.userGid ?? t('Not available')}`
                  : undefined
              }
            />
            <Detail label={t('User home')} value={summary.userDir} />
            <Detail label={t('User shell')} value={summary.userShell} />
            <Detail label={t('Machine ID')} value={summary.machineId} />
          </DescriptionList>
        </CardBody>
      </PageDashboardCard>

      <PageDashboardCard title={t('Security')} width="half" height="sm">
        <CardBody>
          <DescriptionList isHorizontal isCompact>
            <Detail label={t('SELinux')} value={summary.selinuxStatus} />
            <Detail label={t('AppArmor')} value={summary.appArmorStatus} />
            <Detail label={t('FIPS')} value={summary.fips} />
            <Detail label={t('Chroot')} value={summary.isChroot} />
            <Detail label={t('Capabilities enforced')} value={summary.capabilitiesEnforced} />
            <Detail label={t('Reachable IPv4')} value={summary.locallyReachableIpv4} />
          </DescriptionList>
        </CardBody>
      </PageDashboardCard>

      <PageDashboardCard title={t('Hardware')} width="half" height="sm">
        <CardBody>
          <DescriptionList isHorizontal isCompact>
            <Detail label={t('System')} value={summary.system} />
            <Detail label={t('Vendor')} value={summary.systemVendor} />
            <Detail label={t('Product')} value={summary.productName} />
            <Detail label={t('Product version')} value={summary.productVersion} />
            <Detail label={t('Serial')} value={summary.productSerial} />
            <Detail label={t('Form factor')} value={summary.formFactor} />
            <Detail label={t('Board')} value={summary.boardName} />
            <Detail label={t('BIOS')} value={summary.biosVersion} />
            <Detail label={t('BIOS vendor')} value={summary.biosVendor} />
            <Detail label={t('BIOS date')} value={summary.biosDate} />
            <Detail label={t('Kernel build')} value={summary.kernelVersion} />
            <Detail label={t('Virtualization role')} value={summary.virtualizationRole} />
          </DescriptionList>
        </CardBody>
      </PageDashboardCard>

      <PageDashboardCard title={t('Network interfaces')} width="half" height="sm">
        <CardBody>
          {summary.interfaceDetails.length ? (
            <InlineRows
              rows={summary.interfaceDetails.slice(0, 6).map((networkInterface) => ({
                label: networkInterface.name,
                value: [
                  networkInterface.active ? t('up') : t('down'),
                  networkInterface.address,
                  networkInterface.mac,
                  networkInterface.mtu ? `mtu ${networkInterface.mtu}` : undefined,
                  networkInterface.speed ? `${networkInterface.speed} Mbps` : undefined,
                  networkInterface.ipv6.length
                    ? t('{{count}} IPv6', { count: networkInterface.ipv6.length })
                    : undefined,
                  networkInterface.type,
                ]
                  .filter(Boolean)
                  .join(' | '),
              }))}
            />
          ) : (
            <Text>{t('No interface details available')}</Text>
          )}
        </CardBody>
      </PageDashboardCard>

      <PageDashboardCard title={t('Block devices')} width="full" height="sm">
        <CardBody>
          {summary.devices.length ? (
            <InlineRows
              rows={summary.devices.slice(0, 8).map((device) => ({
                label: device.name,
                value: [
                  device.size,
                  device.partitions
                    ? t('{{count}} partition(s)', { count: device.partitions })
                    : t('no partitions'),
                  device.model,
                  device.vendor,
                  device.rotational === '1' ? t('rotational') : t('solid state / virtual'),
                  device.virtual === '1' ? t('virtual') : undefined,
                  device.scheduler,
                ]
                  .filter(Boolean)
                  .join(' | '),
              }))}
            />
          ) : (
            <Text>{t('No block device details available')}</Text>
          )}
        </CardBody>
      </PageDashboardCard>

      <PageDashboardCard title={t('Recent automation')} width="full" height="xs">
        <CardBody>
          {recentPlaybookJobs?.length ? (
            <Sparkline jobs={recentPlaybookJobs} />
          ) : (
            <Text>{t('No recent job data available')}</Text>
          )}
        </CardBody>
      </PageDashboardCard>
    </PageDashboard>
  );
}
