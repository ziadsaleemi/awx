export interface QuayStatus {
  enabled: boolean;
  configured: boolean;
  status: string;
  server_url: string;
  registry: string;
  namespace: string;
  auth_configured: boolean;
  push_configured: boolean;
  push_username_configured: boolean;
  push_token_configured: boolean;
  can_manage: boolean;
  management_configured: boolean;
  management_required_scopes: string[];
  verify_ssl: boolean;
  request_timeout: number;
  settings_url: string;
  message: string;
  counts: {
    repositories: number;
    tags: number;
  };
  controller_error: string;
}
