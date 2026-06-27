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
import { CSSProperties, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
const HOST_DASHBOARD_SECTION_STYLE: CSSProperties = { padding: '16px' };

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

function DashboardGrid(props: { children: ReactNode; minColumnWidth?: string }) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 20,
        gridTemplateColumns: `repeat(auto-fit, minmax(${props.minColumnWidth ?? '280px'}, 1fr))`,
        alignItems: 'start',
        minWidth: 0,
      }}
    >
      {props.children}
    </div>
  );
}

function MetricBlock(props: {
  label: string;
  value: string | number;
  helper?: string | number;
  tone?: 'good' | 'warn';
}) {
  const color =
    props.tone === 'good'
      ? 'var(--pf-v5-global--success-color--100)'
      : props.tone === 'warn'
        ? 'var(--pf-v5-global--warning-color--100)'
        : 'var(--pf-v5-global--primary-color--100)';
  return (
    <div
      style={{
        borderLeft: `3px solid ${color}`,
        minWidth: 0,
        paddingLeft: 12,
      }}
    >
      <TextContent>
        <Text component={TextVariants.small} style={{ fontWeight: 600 }}>
          {props.label}
        </Text>
        <Text component={TextVariants.h2} style={{ marginTop: 2, color, lineHeight: 1.1 }}>
          {props.value}
        </Text>
        {props.helper !== undefined && (
          <Text component={TextVariants.small} style={{ opacity: 0.78, overflowWrap: 'anywhere' }}>
            {props.helper}
          </Text>
        )}
      </TextContent>
    </div>
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
      <Flex alignItems={{ default: 'alignItemsCenter' }} flexWrap={{ default: 'wrap' }}>
        <FlexItem grow={{ default: 'grow' }} style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, marginBottom: 4 }}>{props.label}</div>
        </FlexItem>
        {props.description && (
          <FlexItem style={{ minWidth: 0 }}>
            <Text component={TextVariants.small} style={{ overflowWrap: 'anywhere' }}>
              {props.description}
            </Text>
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
          <Flex spaceItems={{ default: 'spaceItemsMd' }} flexWrap={{ default: 'nowrap' }}>
            <FlexItem style={{ minWidth: 120 }}>
              <Text component={TextVariants.small} style={{ fontWeight: 600 }}>
                {row.label}
              </Text>
            </FlexItem>
            <FlexItem grow={{ default: 'grow' }} style={{ minWidth: 0 }}>
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

function DetailSection(props: {
  title: string;
  rows: { label: string; value?: string | number }[];
}) {
  return (
    <Stack hasGutter>
      <StackItem>
        <Text component={TextVariants.h4} style={{ marginBottom: 0 }}>
          {props.title}
        </Text>
      </StackItem>
      <StackItem>
        <DescriptionList isHorizontal isCompact>
          {props.rows.map((row) => (
            <Detail key={row.label} label={row.label} value={row.value} />
          ))}
        </DescriptionList>
      </StackItem>
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

  const memoryUsed =
    summary.memoryTotal !== undefined && summary.memoryFree !== undefined
      ? summary.memoryTotal - summary.memoryFree
      : undefined;
  const swapUsed =
    summary.swapTotal !== undefined && summary.swapFree !== undefined
      ? summary.swapTotal - summary.swapFree
      : undefined;
  const storageUsed = Math.max(0, summary.storageTotal - summary.storageAvailable);
  const hostStatus = host ? (
    <Label color={host.enabled ? 'green' : 'red'}>
      {host.enabled ? t('Enabled') : t('Disabled')}
    </Label>
  ) : null;
  const osVersion = [
    getFactString(safeFacts, 'ansible_distribution'),
    getFactString(safeFacts, 'ansible_distribution_version'),
  ]
    .filter(Boolean)
    .join(' ');
  const cpuTopology =
    summary.cpuSockets || summary.cpuCores || summary.cpuThreadsPerCore
      ? t('{{sockets}} sockets / {{cores}} cores / {{threads}} threads', {
          sockets: summary.cpuSockets ?? 0,
          cores: summary.cpuCores ?? 0,
          threads: summary.cpuThreadsPerCore ?? 0,
        })
      : undefined;

  if (!summary.factCount) {
    return (
      <PageDashboard sectionStyle={HOST_DASHBOARD_SECTION_STYLE}>
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
    <PageDashboard sectionStyle={HOST_DASHBOARD_SECTION_STYLE}>
      <PageDashboardCard
        title={t('System summary')}
        subtitle={host?.name}
        width="full"
        height="md"
        headerControls={
          <Flex
            alignItems={{ default: 'alignItemsCenter' }}
            spaceItems={{ default: 'spaceItemsMd' }}
          >
            {hostStatus && <FlexItem>{hostStatus}</FlexItem>}
            <FlexItem>{pullFactsButton}</FlexItem>
          </Flex>
        }
      >
        <CardBody>
          {factPullAlert}
          <Stack hasGutter>
            <StackItem>
              <DashboardGrid minColumnWidth="220px">
                <MetricBlock
                  label={t('Operating system')}
                  value={osVersion || t('Not available')}
                  helper={summary.osFamily}
                />
                <MetricBlock
                  label={t('vCPUs')}
                  value={summary.cpuCount ?? t('Not available')}
                  helper={
                    summary.loadAverage
                      ? t('Load {{load}}', { load: summary.loadAverage })
                      : undefined
                  }
                />
                <MetricBlock
                  label={t('Memory')}
                  value={formatMb(summary.memoryTotal)}
                  helper={
                    memoryUsed !== undefined
                      ? `${formatMb(memoryUsed)} ${t('used')} (${summary.memoryUsedPct}%)`
                      : undefined
                  }
                  tone={summary.memoryUsedPct > 85 ? 'warn' : 'good'}
                />
                <MetricBlock
                  label={t('Primary IP')}
                  value={summary.defaultAddress ?? t('Not available')}
                  helper={summary.defaultInterface}
                />
              </DashboardGrid>
            </StackItem>
            <StackItem>
              <DashboardGrid minColumnWidth="340px">
                <DetailSection
                  title={t('Host identity')}
                  rows={[
                    { label: t('Last facts pull'), value: summary.lastFactPull },
                    { label: t('Hostname'), value: summary.hostname },
                    { label: t('FQDN'), value: summary.fqdn },
                    { label: t('Node name'), value: summary.nodename },
                    { label: t('Domain'), value: summary.domain },
                  ]}
                />
                <DetailSection
                  title={t('Operating context')}
                  rows={[
                    { label: t('Kernel'), value: getFactString(safeFacts, 'ansible_kernel') },
                    { label: t('Kernel build'), value: summary.kernelVersion },
                    {
                      label: t('Architecture'),
                      value: getFactString(safeFacts, 'ansible_architecture'),
                    },
                    {
                      label: t('Virtualization'),
                      value: getFactString(safeFacts, 'ansible_virtualization_type'),
                    },
                    {
                      label: t('Uptime'),
                      value: formatDuration(getNumber(safeFacts.ansible_uptime_seconds)),
                    },
                  ]}
                />
              </DashboardGrid>
            </StackItem>
          </Stack>
        </CardBody>
      </PageDashboardCard>

      <PageDashboardCard
        title={t('Resource utilization')}
        width="half"
        height="lg"
        style={{ minWidth: 0 }}
      >
        <CardBody>
          <DashboardGrid minColumnWidth="340px">
            <Stack hasGutter>
              <StackItem>
                <Text component={TextVariants.h4}>{t('Compute and memory')}</Text>
              </StackItem>
              <StackItem>
                <DashboardGrid minColumnWidth="160px">
                  <MetricBlock
                    label={t('CPU topology')}
                    value={summary.cpuCount ?? t('Not available')}
                    helper={cpuTopology}
                  />
                  <MetricBlock
                    label={t('Userspace')}
                    value={summary.userspaceBits ?? t('Not available')}
                    helper={summary.machine}
                  />
                </DashboardGrid>
              </StackItem>
              <UsageRow
                label={t('Memory used')}
                value={summary.memoryUsedPct}
                description={`${formatMb(memoryUsed)} / ${formatMb(summary.memoryTotal)}`}
              />
              {!!summary.swapTotal && (
                <UsageRow
                  label={t('Swap used')}
                  value={summary.swapUsedPct}
                  description={`${formatMb(swapUsed)} / ${formatMb(summary.swapTotal)}`}
                />
              )}
            </Stack>
            <Stack hasGutter>
              <StackItem>
                <Text component={TextVariants.h4}>{t('Storage capacity')}</Text>
              </StackItem>
              <StackItem>
                <Flex
                  alignItems={{ default: 'alignItemsCenter' }}
                  spaceItems={{ default: 'spaceItemsLg' }}
                  flexWrap={{ default: 'wrap' }}
                >
                  <FlexItem>
                    <div style={{ width: 156, height: 156 }}>
                      <ChartPie
                        ariaDesc={t('Storage used')}
                        ariaTitle={t('Storage used')}
                        data={[
                          { x: t('Used'), y: summary.storageUsedPct },
                          { x: t('Free'), y: Math.max(0, 100 - summary.storageUsedPct) },
                        ]}
                        width={156}
                        height={156}
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
                    <MetricBlock
                      label={t('Storage used')}
                      value={`${summary.storageUsedPct}%`}
                      helper={`${formatBytes(storageUsed)} ${t('of')} ${formatBytes(summary.storageTotal)}`}
                      tone={summary.storageUsedPct > 85 ? 'warn' : 'good'}
                    />
                    <Text component={TextVariants.small} style={{ marginTop: 8 }}>
                      {t('{{count}} mounted filesystems', { count: summary.mounts.length })}
                    </Text>
                  </FlexItem>
                </Flex>
              </StackItem>
            </Stack>
            <Stack hasGutter>
              <StackItem>
                <Text component={TextVariants.h4}>{t('Largest filesystems')}</Text>
              </StackItem>
              {summary.mounts.slice(0, 5).map((mount) => {
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
          </DashboardGrid>
        </CardBody>
      </PageDashboardCard>

      <PageDashboardCard
        title={t('Network and runtime')}
        width="half"
        height="lg"
        style={{ minWidth: 0 }}
      >
        <CardBody>
          <DashboardGrid minColumnWidth="340px">
            <DetailSection
              title={t('Primary network')}
              rows={[
                { label: t('Primary address'), value: summary.defaultAddress },
                { label: t('Primary interface'), value: summary.defaultInterface },
                { label: t('Gateway'), value: summary.defaultGateway },
                { label: t('Primary MAC'), value: summary.defaultMac },
                { label: t('Interfaces'), value: summary.interfaces.length },
              ]}
            />
            <DetailSection
              title={t('Addressing and DNS')}
              rows={[
                { label: t('IPv4 addresses'), value: summary.allIpv4 },
                { label: t('IPv6 addresses'), value: summary.allIpv6 },
                { label: t('DNS servers'), value: summary.dnsNameservers },
                { label: t('DNS search'), value: summary.dnsSearch },
                { label: t('Reachable IPv4'), value: summary.locallyReachableIpv4 },
              ]}
            />
            <DetailSection
              title={t('Runtime')}
              rows={[
                { label: t('Python'), value: getFactString(safeFacts, 'ansible_python_version') },
                { label: t('Package manager'), value: getFactString(safeFacts, 'ansible_pkg_mgr') },
                {
                  label: t('Service manager'),
                  value: getFactString(safeFacts, 'ansible_service_mgr'),
                },
                { label: t('Release'), value: summary.distributionRelease },
                { label: t('Fact keys'), value: summary.factCount },
              ]}
            />
          </DashboardGrid>
        </CardBody>
      </PageDashboardCard>

      <PageDashboardCard
        title={t('Platform and security')}
        width="half"
        height="lg"
        style={{ minWidth: 0 }}
      >
        <CardBody>
          <DashboardGrid minColumnWidth="340px">
            <DetailSection
              title={t('User context')}
              rows={[
                { label: t('User'), value: summary.userId },
                {
                  label: t('UID / GID'),
                  value:
                    summary.userUid !== undefined || summary.userGid !== undefined
                      ? `${summary.userUid ?? t('Not available')} / ${summary.userGid ?? t('Not available')}`
                      : undefined,
                },
                { label: t('User home'), value: summary.userDir },
                { label: t('User shell'), value: summary.userShell },
                { label: t('Machine ID'), value: summary.machineId },
              ]}
            />
            <DetailSection
              title={t('Security')}
              rows={[
                { label: t('SELinux'), value: summary.selinuxStatus },
                { label: t('AppArmor'), value: summary.appArmorStatus },
                { label: t('FIPS'), value: summary.fips },
                { label: t('Chroot'), value: summary.isChroot },
                { label: t('Capabilities enforced'), value: summary.capabilitiesEnforced },
              ]}
            />
            <DetailSection
              title={t('Hardware')}
              rows={[
                { label: t('System'), value: summary.system },
                { label: t('Vendor'), value: summary.systemVendor },
                { label: t('Product'), value: summary.productName },
                { label: t('Product version'), value: summary.productVersion },
                { label: t('Serial'), value: summary.productSerial },
                { label: t('Form factor'), value: summary.formFactor },
                { label: t('Board'), value: summary.boardName },
                { label: t('BIOS'), value: summary.biosVersion },
                { label: t('BIOS vendor'), value: summary.biosVendor },
                { label: t('BIOS date'), value: summary.biosDate },
                { label: t('Virtualization role'), value: summary.virtualizationRole },
              ]}
            />
          </DashboardGrid>
        </CardBody>
      </PageDashboardCard>

      <PageDashboardCard
        title={t('Storage, devices, and interfaces')}
        width="half"
        height="lg"
        style={{ minWidth: 0 }}
      >
        <CardBody>
          <DashboardGrid minColumnWidth="360px">
            <Stack hasGutter>
              <StackItem>
                <Text component={TextVariants.h4}>{t('Network interfaces')}</Text>
              </StackItem>
              <StackItem>
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
              </StackItem>
            </Stack>
            <Stack hasGutter>
              <StackItem>
                <Text component={TextVariants.h4}>{t('Block devices')}</Text>
              </StackItem>
              <StackItem>
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
              </StackItem>
            </Stack>
          </DashboardGrid>
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
