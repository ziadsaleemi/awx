import { ChartPie } from '@patternfly/react-charts';
import {
  Bullseye,
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
import { ServerIcon } from '@patternfly/react-icons';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { PageDashboard } from '../../../../../framework/PageDashboard/PageDashboard';
import { PageDashboardCard } from '../../../../../framework/PageDashboard/PageDashboardCard';
import { useGet } from '../../../../common/crud/useGet';
import { awxAPI } from '../../../common/api/awx-utils';
import { useGetHost } from '../hooks/useGetHost';
import { Sparkline } from '../../templates/components/Sparkline';

type HostFacts = Record<string, unknown>;

type MountFact = {
  mount?: string;
  device?: string;
  size_total?: number;
  size_available?: number;
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

function usedPercent(total?: number, available?: number) {
  if (!total || available === undefined || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(((total - available) / total) * 100)));
}

function getMounts(facts: HostFacts) {
  return Array.isArray(facts.ansible_mounts)
    ? (facts.ansible_mounts as MountFact[])
        .filter((mount) => mount.size_total && mount.size_total > 0)
        .sort((a, b) => (b.size_total ?? 0) - (a.size_total ?? 0))
    : [];
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

    return {
      cpuCount,
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
      interfaces,
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
      <DescriptionListDescription>{props.value || t('Not available')}</DescriptionListDescription>
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

export function HostDashboard(props: { page: 'host' | 'inventory' }) {
  const { t } = useTranslation();
  const params = useParams<{ id: string; host_id: string }>();
  const hostId = props.page === 'host' ? params.id ?? '' : params.host_id ?? '';
  const { host } = useGetHost(hostId);
  const { data: facts, isLoading } = useGet<HostFacts>(awxAPI`/hosts/${hostId}/ansible_facts/`);
  const safeFacts = facts ?? {};
  const summary = useHostFactSummary(safeFacts);
  const recentPlaybookJobs = host?.summary_fields?.recent_jobs?.map((job) => ({
    ...job,
    canceled_on: null,
  }));

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
            <Detail label={t('Interfaces')} value={summary.interfaces.length} />
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
            <Detail label={t('Fact keys')} value={summary.factCount} />
          </DescriptionList>
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
