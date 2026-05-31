import { jsonToYaml } from '../../../../framework/utils/codeEditorUtils';

export interface GeneratedInventoryHost {
  name: string;
  variables: Record<string, string>;
}

export interface GeneratedInventoryGroup {
  name: string;
  variables: Record<string, string>;
  hosts: GeneratedInventoryHost[];
  children: string[];
}

export interface GeneratedInventoryPlan {
  source: string;
  variables: Record<string, string>;
  hosts: GeneratedInventoryHost[];
  groups: GeneratedInventoryGroup[];
}

type SectionType = 'hosts' | 'vars' | 'children';

function stripQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function splitInventoryLine(line: string) {
  return line.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
}

function parseKeyValue(token: string) {
  const equalsIndex = token.indexOf('=');
  if (equalsIndex === -1) {
    return undefined;
  }
  const key = token.slice(0, equalsIndex).trim();
  const value = stripQuotes(token.slice(equalsIndex + 1).trim());
  if (!key) {
    return undefined;
  }
  return [key, value] as const;
}

function parseVariableLine(line: string) {
  const parsed = parseKeyValue(line);
  if (parsed) {
    return parsed;
  }
  const colonIndex = line.indexOf(':');
  if (colonIndex === -1) {
    return undefined;
  }
  const key = line.slice(0, colonIndex).trim();
  const value = stripQuotes(line.slice(colonIndex + 1).trim());
  if (!key) {
    return undefined;
  }
  return [key, value] as const;
}

function parseHostLine(line: string): GeneratedInventoryHost | undefined {
  const tokens = splitInventoryLine(line);
  const [name, ...variableTokens] = tokens;
  if (!name || name.includes('=')) {
    return undefined;
  }

  const variables: Record<string, string> = {};
  for (const token of variableTokens) {
    const parsed = parseKeyValue(token);
    if (parsed) {
      variables[parsed[0]] = parsed[1];
    }
  }

  return { name: stripQuotes(name), variables };
}

function mergeVariables(target: Record<string, string>, source: Record<string, string>) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = value;
  }
}

function upsertHost(hosts: GeneratedInventoryHost[], host: GeneratedInventoryHost) {
  const existing = hosts.find((item) => item.name === host.name);
  if (existing) {
    mergeVariables(existing.variables, host.variables);
  } else {
    hosts.push(host);
  }
}

function ensureGroup(groupsByName: Map<string, GeneratedInventoryGroup>, name: string) {
  const existing = groupsByName.get(name);
  if (existing) {
    return existing;
  }
  const group: GeneratedInventoryGroup = {
    name,
    variables: {},
    hosts: [],
    children: [],
  };
  groupsByName.set(name, group);
  return group;
}

export function parseGeneratedInventory(source: string): GeneratedInventoryPlan {
  const groupsByName = new Map<string, GeneratedInventoryGroup>();
  const plan: GeneratedInventoryPlan = {
    source: source.trim(),
    variables: {},
    hosts: [],
    groups: [],
  };
  let currentSection: { name: string; type: SectionType } | undefined;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) {
      continue;
    }

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const [name, modifier] = sectionMatch[1].split(':', 2);
      const sectionName = name.trim();
      if (!sectionName) {
        currentSection = undefined;
        continue;
      }
      if (modifier === 'vars') {
        currentSection = { name: sectionName, type: 'vars' };
        if (sectionName !== 'all') {
          ensureGroup(groupsByName, sectionName);
        }
      } else if (modifier === 'children') {
        currentSection = { name: sectionName, type: 'children' };
        ensureGroup(groupsByName, sectionName);
      } else {
        currentSection = { name: sectionName, type: 'hosts' };
        if (sectionName !== 'all' && sectionName !== 'ungrouped') {
          ensureGroup(groupsByName, sectionName);
        }
      }
      continue;
    }

    if (!currentSection) {
      const host = parseHostLine(line);
      if (host) {
        upsertHost(plan.hosts, host);
      }
      continue;
    }

    if (currentSection.type === 'vars') {
      const parsed = parseVariableLine(line);
      if (!parsed) {
        continue;
      }
      if (currentSection.name === 'all') {
        plan.variables[parsed[0]] = parsed[1];
      } else {
        ensureGroup(groupsByName, currentSection.name).variables[parsed[0]] = parsed[1];
      }
      continue;
    }

    if (currentSection.type === 'children') {
      const childName = line.split(/\s+/)[0]?.trim();
      if (!childName) {
        continue;
      }
      const group = ensureGroup(groupsByName, currentSection.name);
      if (!group.children.includes(childName)) {
        group.children.push(childName);
      }
      ensureGroup(groupsByName, childName);
      continue;
    }

    const host = parseHostLine(line);
    if (!host) {
      continue;
    }
    if (currentSection.name === 'all' || currentSection.name === 'ungrouped') {
      upsertHost(plan.hosts, host);
    } else {
      upsertHost(ensureGroup(groupsByName, currentSection.name).hosts, host);
      upsertHost(plan.hosts, host);
    }
  }

  plan.groups = Array.from(groupsByName.values());
  return plan;
}

export function countGeneratedInventoryHosts(plan: GeneratedInventoryPlan) {
  const hostNames = new Set(plan.hosts.map((host) => host.name));
  for (const group of plan.groups) {
    for (const host of group.hosts) {
      hostNames.add(host.name);
    }
  }
  return hostNames.size;
}

export function inventoryVariablesToYaml(variables: Record<string, unknown>) {
  if (Object.keys(variables).length === 0) {
    return '---\n';
  }
  return jsonToYaml(JSON.stringify(variables)) || '---\n';
}
