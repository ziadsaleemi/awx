import {
  Node,
  EdgeModel,
  NodeModel,
  NodeStatus,
  GraphElement,
  WithSelectionProps,
} from '@patternfly/react-topology';

export interface MeshNode {
  id: string | number;
  x: number;
  y: number;
  node_type: string;
  hostname: string;
  node_state: string;
  service_type?: string;
  status_label?: string;
  description?: string;
  endpoint?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface MeshLink {
  link_state: string;
  source:
    | string
    | {
        id: string | number;
        hostname: string;
      };
  target:
    | string
    | {
        id: string | number;
        hostname: string;
      };
}

export interface WebWorkerResponse {
  type: string;
  progress: number;
  nodes: MeshNode[];
  links: MeshLink[];
}

export interface CustomNodeProps extends WithSelectionProps {
  element: Node<
    NodeModel,
    {
      nodeType: string;
      nodeStatus: string;
      serviceType?: string;
      statusLabel?: string;
      description?: string;
      endpoint?: string;
      metadata?: Record<string, string | number | boolean>;
    }
  >;
}

export interface CustomEdgeProps {
  element: GraphElement<
    EdgeModel,
    {
      tagStatus: NodeStatus;
      endTerminalStatus: NodeStatus;
    }
  >;
}
