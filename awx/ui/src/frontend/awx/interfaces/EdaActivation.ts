export interface EdaActivation {
  id: number;
  name: string;
  status: string;
  started?: string | null;
  finished?: string | null;
  rulebook?: string;
  event_source?: string;
  source?: string;
  related?: {
    controller_activation?: string;
  };
}

export interface EdaActivationEvent {
  id: number;
  event_type?: string;
  status?: string;
  rule?: string;
  message?: string;
  created?: string;
}

export interface EdaStatus {
  configured: boolean;
  status: string;
  controller_url: string;
  auth_configured: boolean;
  activations_url: string;
  settings_url: string;
  message: string;
}

export interface EdaActivationActionResponse {
  source: string;
  activation: EdaActivation;
  actions: string[];
  events?: EdaActivationEvent[];
}
