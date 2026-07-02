import {
  BuilderImageIcon,
  BrainIcon,
  CheckCircleIcon,
  CloudServerIcon,
  ClockIcon,
  CodeBranchIcon,
  CubeIcon,
  DataProcessorIcon,
  DatabaseIcon,
  ExclamationCircleIcon,
  NetworkIcon,
  MinusCircleIcon,
  PlusCircleIcon,
  QuestionCircleIcon,
  RegistryIcon,
  RobotIcon,
  ServiceCatalogIcon,
  ShieldAltIcon,
} from '@patternfly/react-icons';
import {
  DEFAULT_DECORATOR_RADIUS,
  Decorator,
  DefaultNode,
  TopologyQuadrant,
  WithSelectionProps,
  getDefaultShapeDecoratorCenter,
} from '@patternfly/react-topology';
import { useMemo } from 'react';
import { pfDanger, pfDisabled, pfInfo, pfSuccess } from '../../../../../framework';
import { CustomNodeProps } from '../types';

function getStatusIcon(nodeType: string) {
  switch (nodeType) {
    case 'ready':
    case 'connected':
      return <CheckCircleIcon style={{ fill: pfSuccess }} />;
    case 'installed':
    case 'not_configured':
      return <ClockIcon style={{ fill: pfInfo }} />;
    case 'provisioning':
      return <PlusCircleIcon style={{ fill: pfDisabled }} />;
    case 'deprovisioning':
    case 'disabled':
      return <MinusCircleIcon style={{ fill: pfDisabled }} />;
    case 'unavailable':
    case 'deprovision-fail':
    case 'provision-fail':
      return <ExclamationCircleIcon style={{ fill: pfDanger }} />;
    default:
      return <QuestionCircleIcon style={{ fill: pfDisabled }} />;
  }
}

export function getNodeIcon(nodeType: string) {
  switch (nodeType) {
    case 'hybrid':
      return BuilderImageIcon;
    case 'execution':
      return CubeIcon;
    case 'control':
      return DatabaseIcon;
    case 'hop':
      return DataProcessorIcon;
    case 'service-ai':
      return BrainIcon;
    case 'service-cloud':
      return CloudServerIcon;
    case 'service-eda':
      return RobotIcon;
    case 'service-galaxy':
      return ServiceCatalogIcon;
    case 'service-gatekeeper':
      return ShieldAltIcon;
    case 'service-opa':
      return CodeBranchIcon;
    case 'service-quay':
      return RegistryIcon;
    case 'service-network':
      return NetworkIcon;
    default:
      return DatabaseIcon;
  }
}

export const MeshNode: React.FC<CustomNodeProps & WithSelectionProps> = ({
  element,
  onSelect,
  selected,
}: CustomNodeProps) => {
  const data = element.getData();
  const Icon = data && getNodeIcon(data.nodeType);
  const isServiceNode = data?.nodeType?.startsWith('service-');

  const statusDecorator = useMemo(() => {
    const icon = data && getStatusIcon(data.nodeStatus);
    if (!icon) {
      return null;
    }
    const { x, y } = getDefaultShapeDecoratorCenter(TopologyQuadrant.upperLeft, element);

    const decorator = (
      <Decorator
        x={x}
        y={y}
        radius={DEFAULT_DECORATOR_RADIUS}
        showBackground
        onClick={onSelect}
        icon={<g>{icon}</g>}
        ariaLabel={data?.nodeStatus}
      />
    );

    return decorator;
  }, [data, element, onSelect]);

  return (
    <DefaultNode
      element={element}
      onSelect={onSelect}
      selected={selected}
      onStatusDecoratorClick={onSelect}
      truncateLength={20}
    >
      <g
        data-cy={`mesh-node-icon-${element.getId()}`}
        onClick={onSelect}
        style={{ cursor: 'pointer', pointerEvents: 'all' }}
        transform={`translate(13, 13)`}
      >
        {Icon && (
          <Icon style={{ color: isServiceNode ? '#0066cc' : '#393F44' }} width={25} height={25} />
        )}
      </g>
      {statusDecorator}
    </DefaultNode>
  );
};
