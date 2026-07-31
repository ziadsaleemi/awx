export interface GalaxyNgStatus {
  enabled: boolean;
  configured: boolean;
  status: string;
  server_url: string;
  api_root_url: string;
  api_browser_url: string;
  content_url: string;
  ui_url: string;
  auth_configured: boolean;
  verify_ssl: boolean;
  request_timeout: number;
  api_path_prefix: string;
  content_path_prefix: string;
  settings_url: string;
  message: string;
  version?: string;
  component_versions?: Record<string, string>;
  compatibility?: {
    adapter_contract_version: number;
    state: 'compatible' | 'degraded' | 'unknown';
    schema_available: boolean;
    schema_version: string;
    openapi_version: string;
    capabilities: Record<string, boolean>;
    missing_capabilities: string[];
    missing_mutation_capabilities: string[];
    mutation_safe: boolean;
    message: string;
    error?: string;
  };
  counts: {
    namespaces: number;
    collections: number;
    repositories: number;
    remotes: number;
    remote_registries: number;
    signature_keys: number;
    collection_approvals: number;
    tasks: number;
  };
  pulp_status: Record<string, unknown>;
  controller_error: string;
}
