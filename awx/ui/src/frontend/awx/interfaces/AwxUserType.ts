export interface AwxUserType {
  id: number;
  type: 'user_type';
  url: string;
  related: Record<string, string>;
  summary_fields: {
    role_definitions?: {
      id: number;
      name: string;
      description?: string;
    }[];
    user_capabilities?: {
      edit?: boolean;
      delete?: boolean;
      copy?: boolean;
    };
  };
  created: string;
  modified: string;
  name: string;
  description: string;
  role_definitions: number[];
}
