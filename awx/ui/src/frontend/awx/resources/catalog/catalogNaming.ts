export interface CatalogNameContext {
  user_org_name?: string;
  [key: string]: string | number | boolean | undefined;
}

function normalizeNameComponent(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '');
}

function renderTemplate(template: string, context: CatalogNameContext) {
  return template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_match, key: string) => {
    const value = context[key];
    return value !== undefined && value !== null ? normalizeNameComponent(String(value)) : '';
  });
}

export function generateCatalogName(
  template: string | undefined,
  context: CatalogNameContext,
  existingNames: string[],
  fallbackPrefix: string
) {
  const rawTemplate = template?.trim() ?? '';
  const renderedBase = renderTemplate(rawTemplate || fallbackPrefix, context).trim() || 'deployment';
  const wantsSequence = renderedBase.endsWith('+1');
  const base = wantsSequence ? renderedBase.slice(0, -2) : renderedBase;

  if (!wantsSequence) {
    return base;
  }

  const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escapedBase}(?<sequence>\\d+)?$`, 'i');
  let highestSequence = 0;
  let matched = false;

  for (const existingName of existingNames) {
    const match = pattern.exec(existingName.trim());
    if (!match) continue;
    matched = true;
    const sequence = match.groups?.sequence;
    highestSequence = Math.max(highestSequence, sequence ? Number(sequence) : 1);
  }

  if (!matched) {
    return `${base}1`;
  }

  return `${base}${highestSequence + 1}`;
}

export function parseCatalogDynamicFieldNames(rawValue: string | undefined): string[] {
  if (!rawValue) return [];

  const names = new Set<string>();
  for (const token of rawValue.split(',')) {
    const normalized = token.trim();
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(normalized)) {
      continue;
    }
    names.add(normalized);
  }

  return [...names];
}
