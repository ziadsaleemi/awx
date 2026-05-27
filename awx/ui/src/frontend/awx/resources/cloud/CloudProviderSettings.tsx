import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Label, PageSection, Spinner } from '@patternfly/react-core';
import { postRequest } from '../../../common/crud/Data';
import { isRequestError } from '../../../common/crud/RequestError';
import {
  ITableColumn,
  PageHeader,
  PageLayout,
  PageTable,
  PageTab,
  PageTabs,
  TextCell,
  useInMemoryView,
  usePageAlertToaster,
} from '../../../../framework';
import { EmptyStateUnauthorized } from '../../../../framework/components/EmptyStateUnauthorized';
import { awxAPI } from '../../common/api/awx-utils';
import { useAwxActiveUser } from '../../common/useAwxActiveUser';
import {
  DigitalOceanImage,
  DigitalOceanProviderData,
  DigitalOceanRegion,
  DigitalOceanSize,
  DigitalOceanVpc,
  getCloudConnections,
  getCloudProviderData,
  setCloudProviderData,
} from './cloudConnectionStore';
import { getCloudProviderLabel } from './cloudProviders';

interface PullApiResponse {
  pulled_at: string;
  image_count: number;
  pricing_count: number;
  region_count: number;
  vpc_count: number;
  images: DigitalOceanImage[];
  pricing: DigitalOceanSize[];
  regions: DigitalOceanRegion[];
  vpcs: DigitalOceanVpc[];
}

function ImagesTab(props: { images: DigitalOceanImage[] }) {
  const { t } = useTranslation();
  const tableColumns = useMemo<ITableColumn<DigitalOceanImage>[]>(
    () => [
      {
        header: t('Name'),
        cell: (img) => <TextCell text={img.name || '-'} />,
        sort: 'name',
      },
      {
        header: t('Distribution'),
        cell: (img) => <TextCell text={img.distribution || '-'} />,
        sort: 'distribution',
      },
      {
        header: t('Type'),
        cell: (img) => <TextCell text={img.type || '-'} />,
        sort: 'type',
      },
      {
        header: t('Visibility'),
        cell: (img) => (
          <Label color={img.private ? 'blue' : 'grey'} isCompact>
            {img.private ? t('Private') : t('Public')}
          </Label>
        ),
      },
      {
        header: t('Min disk (GB)'),
        cell: (img) => <TextCell text={img.min_disk_size?.toString() || '-'} />,
        sort: 'min_disk_size',
      },
      {
        header: t('Status'),
        cell: (img) => <TextCell text={img.status || '-'} />,
        sort: 'status',
      },
      {
        header: t('ID'),
        type: 'text',
        value: (img) => img.id?.toString(),
        table: 'expanded',
      },
      {
        header: t('Slug'),
        type: 'text',
        value: (img) => img.slug,
        table: 'expanded',
      },
      {
        header: t('Size (GB)'),
        type: 'text',
        value: (img) => img.size_gigabytes?.toString(),
        table: 'expanded',
      },
      {
        header: t('Regions'),
        type: 'text',
        value: (img) => img.regions?.join(', '),
        table: 'expanded',
      },
    ],
    [t]
  );

  const view = useInMemoryView<DigitalOceanImage>({
    keyFn: (img) => img.id.toString(),
    items: props.images,
    tableColumns,
  });

  return (
    <PageTable<DigitalOceanImage>
      id="digitalocean-images-table"
      tableColumns={tableColumns}
      errorStateTitle={t('Error loading images')}
      emptyStateTitle={t('No images')}
      emptyStateDescription={t('Click "Pull data" to fetch.')}
      disableListView
      disableCardView
      {...view}
    />
  );
}

function SizesTab(props: { pricing: DigitalOceanSize[] }) {
  const { t } = useTranslation();
  const tableColumns = useMemo<ITableColumn<DigitalOceanSize>[]>(
    () => [
      {
        header: t('Slug'),
        cell: (size) => <TextCell text={size.slug || '-'} />,
        sort: 'slug',
      },
      {
        header: t('vCPUs'),
        cell: (size) => <TextCell text={size.vcpus?.toString() || '-'} />,
        sort: 'vcpus',
      },
      {
        header: t('Memory (MB)'),
        cell: (size) => <TextCell text={size.memory_mb?.toString() || '-'} />,
        sort: 'memory_mb',
      },
      {
        header: t('Disk (GB)'),
        cell: (size) => <TextCell text={size.disk_gb?.toString() || '-'} />,
        sort: 'disk_gb',
      },
      {
        header: t('Hourly ($)'),
        cell: (size) => (
          <TextCell
            text={
              size.price_hourly !== null && size.price_hourly !== undefined
                ? `$${size.price_hourly.toFixed(5)}`
                : '-'
            }
          />
        ),
        sort: 'price_hourly',
      },
      {
        header: t('Monthly ($)'),
        cell: (size) => (
          <TextCell
            text={
              size.price_monthly !== null && size.price_monthly !== undefined
                ? `$${size.price_monthly.toFixed(2)}`
                : '-'
            }
          />
        ),
        sort: 'price_monthly',
      },
      {
        header: t('Available'),
        cell: (size) => (
          <Label color={size.available ? 'green' : 'red'} isCompact>
            {size.available ? t('Yes') : t('No')}
          </Label>
        ),
      },
      {
        header: t('Description'),
        type: 'text',
        value: (size) => size.description,
        table: 'expanded',
      },
      {
        header: t('Transfer (TB)'),
        type: 'text',
        value: (size) => size.transfer_tb?.toString(),
        table: 'expanded',
      },
      {
        header: t('Regions'),
        type: 'text',
        value: (size) => size.regions?.join(', '),
        table: 'expanded',
      },
    ],
    [t]
  );

  const view = useInMemoryView<DigitalOceanSize>({
    keyFn: (size) => size.slug,
    items: props.pricing,
    tableColumns,
  });

  return (
    <PageTable<DigitalOceanSize>
      id="digitalocean-sizes-table"
      tableColumns={tableColumns}
      errorStateTitle={t('Error loading sizes')}
      emptyStateTitle={t('No sizes')}
      emptyStateDescription={t('Click "Pull data" to fetch.')}
      disableListView
      disableCardView
      {...view}
    />
  );
}

function RegionsTab(props: { regions: DigitalOceanRegion[] }) {
  const { t } = useTranslation();
  const tableColumns = useMemo<ITableColumn<DigitalOceanRegion>[]>(
    () => [
      {
        header: t('Name'),
        cell: (region) => <TextCell text={region.name || '-'} />,
        sort: 'name',
      },
      {
        header: t('Slug'),
        cell: (region) => <TextCell text={region.slug || '-'} />,
        sort: 'slug',
      },
      {
        header: t('Available'),
        cell: (region) => (
          <Label color={region.available ? 'green' : 'grey'} isCompact>
            {region.available ? t('Yes') : t('No')}
          </Label>
        ),
      },
      {
        header: t('Features'),
        cell: (region) => <TextCell text={region.features?.slice(0, 4).join(', ') || '-'} />,
      },
      {
        header: t('All features'),
        type: 'text',
        value: (region) => region.features?.join(', '),
        table: 'expanded',
      },
    ],
    [t]
  );

  const view = useInMemoryView<DigitalOceanRegion>({
    keyFn: (region) => region.slug,
    items: props.regions,
    tableColumns,
  });

  return (
    <PageTable<DigitalOceanRegion>
      id="digitalocean-regions-table"
      tableColumns={tableColumns}
      errorStateTitle={t('Error loading regions')}
      emptyStateTitle={t('No regions')}
      emptyStateDescription={t('Click "Pull data" to fetch.')}
      disableListView
      disableCardView
      {...view}
    />
  );
}

function NetworksTab(props: { vpcs: DigitalOceanVpc[] }) {
  const { t } = useTranslation();
  const tableColumns = useMemo<ITableColumn<DigitalOceanVpc>[]>(
    () => [
      {
        header: t('Name'),
        cell: (vpc) => <TextCell text={vpc.name || '-'} />,
        sort: 'name',
      },
      {
        header: t('Region'),
        cell: (vpc) => <TextCell text={vpc.region || '-'} />,
        sort: 'region',
      },
      {
        header: t('IP range'),
        cell: (vpc) => <TextCell text={vpc.ip_range || '-'} />,
        sort: 'ip_range',
      },
      {
        header: t('Default'),
        cell: (vpc) =>
          vpc.default ? (
            <Label color="blue" isCompact>
              {t('Default')}
            </Label>
          ) : (
            <TextCell text="-" />
          ),
      },
      {
        header: t('VPC ID'),
        type: 'text',
        value: (vpc) => vpc.id,
        table: 'expanded',
      },
      {
        header: t('Created at'),
        type: 'text',
        value: (vpc) => (vpc.created_at ? new Date(vpc.created_at).toLocaleString() : undefined),
        table: 'expanded',
      },
    ],
    [t]
  );

  const view = useInMemoryView<DigitalOceanVpc>({
    keyFn: (vpc) => vpc.id,
    items: props.vpcs,
    tableColumns,
  });

  return (
    <PageTable<DigitalOceanVpc>
      id="digitalocean-vpcs-table"
      tableColumns={tableColumns}
      errorStateTitle={t('Error loading VPCs')}
      emptyStateTitle={t('No VPCs')}
      emptyStateDescription={t('Click "Pull data" to fetch.')}
      disableListView
      disableCardView
      {...view}
    />
  );
}

export function CloudProviderSettings(props: { provider: string }) {
  const { t } = useTranslation();
  const alertToaster = usePageAlertToaster();
  const { activeAwxUser } = useAwxActiveUser();
  const providerLabel = getCloudProviderLabel(props.provider);
  const connectionState = getCloudConnections()[props.provider];
  const canManageCloud =
    Boolean(activeAwxUser?.is_superuser) || Boolean(activeAwxUser?.is_system_auditor);

  const cached = getCloudProviderData(props.provider);
  const [data, setData] = useState<DigitalOceanProviderData | null>(cached);
  const [isPulling, setIsPulling] = useState(false);

  const isConnected = connectionState?.status === 'connected';

  if (!canManageCloud) {
    return (
      <PageLayout>
        <PageHeader
          title={t('{{provider}} configuration', { provider: providerLabel })}
          description={t('Cloud provider policy controls for administrators.')}
        />
        <PageSection variant="light">
          <EmptyStateUnauthorized
            title={t('You do not have permission to manage cloud settings.')}
          />
        </PageSection>
      </PageLayout>
    );
  }

  const onPull = async () => {
    if (!isConnected || !connectionState?.credentialId) {
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Connect {{provider}} first before pulling data.', { provider: providerLabel }),
      });
      return;
    }

    setIsPulling(true);
    try {
      const result = await postRequest<PullApiResponse, { credential_id: number }>(
        awxAPI`/catalog_cloud/connectors/digitalocean/pull_images/`,
        { credential_id: connectionState.credentialId }
      );
      const newData: DigitalOceanProviderData = {
        pulledAt: result.pulled_at,
        images: result.images ?? [],
        pricing: result.pricing ?? [],
        regions: result.regions ?? [],
        vpcs: result.vpcs ?? [],
      };
      setData(newData);
      setCloudProviderData(props.provider, newData);
      alertToaster.addAlert({
        variant: 'success',
        title: t('Pulled {{images}} images, {{sizes}} sizes, {{regions}} regions, {{vpcs}} VPCs.', {
          images: result.image_count ?? 0,
          sizes: result.pricing_count ?? 0,
          regions: result.region_count ?? 0,
          vpcs: result.vpc_count ?? 0,
        }),
      });
    } catch (err) {
      const detail =
        isRequestError(err) && err.details
          ? err.details
          : err instanceof Error
            ? err.message
            : String(err);
      alertToaster.addAlert({
        variant: 'danger',
        title: t('Failed to pull {{provider}} data', { provider: providerLabel }),
        children: detail,
      });
    } finally {
      setIsPulling(false);
    }
  };

  const pulledAt = data?.pulledAt ? new Date(data.pulledAt).toLocaleString() : null;

  const count = (n: number) => ` (${n})`;

  return (
    <PageLayout>
      <PageHeader
        title={t('{{provider}}', { provider: providerLabel })}
        description={
          isConnected
            ? pulledAt
              ? t('Last pull: {{time}}', { time: pulledAt })
              : t('Connected. Click "Pull data" to load provider resources.')
            : t('Not connected. Go to Cloud Connections to connect.')
        }
        headerActions={
          <Button
            variant="primary"
            onClick={() => void onPull()}
            isLoading={isPulling}
            isDisabled={!isConnected || isPulling}
            icon={isPulling ? <Spinner size="sm" /> : undefined}
          >
            {isPulling ? t('Pulling…') : t('Pull data')}
          </Button>
        }
      />
      {!isConnected && (
        <PageSection style={{ paddingBottom: 0 }}>
          <Alert isInline variant="warning" title={t('Provider not connected')}>
            {t('Connect {{provider}} on the Cloud Connections page before pulling data.', {
              provider: providerLabel,
            })}
          </Alert>
        </PageSection>
      )}
      <PageTabs>
        <PageTab label={t('Images') + (data ? count(data.images.length) : '')}>
          <ImagesTab images={data?.images ?? []} />
        </PageTab>
        <PageTab label={t('Droplet sizes') + (data ? count(data.pricing.length) : '')}>
          <SizesTab pricing={data?.pricing ?? []} />
        </PageTab>
        <PageTab label={t('Regions') + (data ? count(data.regions.length) : '')}>
          <RegionsTab regions={data?.regions ?? []} />
        </PageTab>
        <PageTab label={t('Networks') + (data ? count(data.vpcs.length) : '')}>
          <NetworksTab vpcs={data?.vpcs ?? []} />
        </PageTab>
      </PageTabs>
    </PageLayout>
  );
}
