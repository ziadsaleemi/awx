interface Node {
  id: number | string;
  hostname: string;
  node_type: string;
  node_state: string;
  enabled: boolean;
  service_type?: string;
  status_label?: string;
  description?: string;
  endpoint?: string;
  metadata?: Record<string, string | number | boolean>;
}
interface Link {
  source: string;
  target: string;
  link_state: string;
}
export interface MeshVisualizer {
  nodes: Node[];
  links: Link[];
  services?: Node[];
  service_links?: Link[];
}
