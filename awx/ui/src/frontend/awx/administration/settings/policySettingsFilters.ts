export function isOpaSetting(key: string) {
  return key.startsWith('OPA_');
}

export function isGatekeeperSetting(key: string) {
  return key.startsWith('GATEKEEPER_');
}
