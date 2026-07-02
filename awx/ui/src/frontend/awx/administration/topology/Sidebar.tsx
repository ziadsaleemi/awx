import {
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
} from '@patternfly/react-core';
import { InstanceDetailsTab } from '../instances/InstanceDetails';
import { Instance } from '../../interfaces/Instance';
import { InstanceGroup } from '../../interfaces/InstanceGroup';
import { AwxItemsResponse } from '../../common/AwxItemsResponse';
import { useInstanceActions } from '../instances/hooks/useInstanceActions';
import { useGetItem } from '../../../common/crud/useGet';
import { awxAPI } from '../../common/api/awx-utils';
import { SidebarHeader } from '../../resources/templates/WorkflowVisualizer/components';
import { useTranslation } from 'react-i18next';
import { MeshNode } from './types';

function formatValue(value: string | number | boolean) {
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  return String(value);
}

export function ServiceDetailSidebar(props: { service: MeshNode; onClose: () => void }) {
  const { service } = props;
  const { t } = useTranslation();
  const metadata = service.metadata ?? {};

  return (
    <>
      <SidebarHeader onClose={props.onClose} title={service.hostname} />
      <DescriptionList isHorizontal>
        <DescriptionListGroup>
          <DescriptionListTerm>{t('Type')}</DescriptionListTerm>
          <DescriptionListDescription>
            {service.service_type ?? t('Service')}
          </DescriptionListDescription>
        </DescriptionListGroup>
        <DescriptionListGroup>
          <DescriptionListTerm>{t('Status')}</DescriptionListTerm>
          <DescriptionListDescription>
            {service.status_label ?? service.node_state}
          </DescriptionListDescription>
        </DescriptionListGroup>
        {service.endpoint ? (
          <DescriptionListGroup>
            <DescriptionListTerm>{t('Endpoint')}</DescriptionListTerm>
            <DescriptionListDescription>{service.endpoint}</DescriptionListDescription>
          </DescriptionListGroup>
        ) : null}
        {service.description ? (
          <DescriptionListGroup>
            <DescriptionListTerm>{t('Description')}</DescriptionListTerm>
            <DescriptionListDescription>{service.description}</DescriptionListDescription>
          </DescriptionListGroup>
        ) : null}
        {Object.entries(metadata).map(([key, value]) => (
          <DescriptionListGroup key={key}>
            <DescriptionListTerm>{key}</DescriptionListTerm>
            <DescriptionListDescription>{formatValue(value)}</DescriptionListDescription>
          </DescriptionListGroup>
        ))}
      </DescriptionList>
    </>
  );
}

export function InstanceDetailInner(props: {
  instance: Instance;
  instanceGroups: AwxItemsResponse<InstanceGroup> | undefined;
  instanceForks: number;
}) {
  const { instance, instanceGroups, instanceForks } = props;
  return (
    <InstanceDetailsTab
      numberOfColumns="single"
      instance={instance}
      instanceGroups={instanceGroups}
      instanceForks={instanceForks}
    />
  );
}

export function InstanceDetailSidebar(props: { selectedId: string; onClose: () => void }) {
  const { selectedId } = props;
  const { data: instance } = useGetItem<Instance>(awxAPI`/instances/`, selectedId);
  const { instanceGroups, instanceForks } = useInstanceActions(selectedId);

  return instance ? (
    <>
      <SidebarHeader onClose={props.onClose} title={instance.hostname} />
      <InstanceDetailInner
        instance={instance}
        instanceGroups={instanceGroups ? instanceGroups : undefined}
        instanceForks={instanceForks}
      />
    </>
  ) : null;
}
