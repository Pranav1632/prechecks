import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';

export function loadDotEnv({ cwd = process.cwd() } = {}) {
  const envPath = findDotEnv(cwd);

  if (!envPath) {
    return null;
  }

  const content = readFileSync(envPath, 'utf8');

  for (const line of content.split(/\r?\n/)) {
    const entry = parseEnvLine(line);

    if (!entry || process.env[entry.key] !== undefined) {
      continue;
    }

    process.env[entry.key] = entry.value;
  }

  return envPath;
}

function findDotEnv(startDir) {
  let current = startDir;
  const root = parse(startDir).root;

  while (true) {
    const candidate = join(current, '.env');

    if (existsSync(candidate)) {
      return candidate;
    }

    if (current === root) {
      return null;
    }

    current = dirname(current);
  }
}

function parseEnvLine(line) {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const equalsIndex = trimmed.indexOf('=');
  if (equalsIndex === -1) {
    return null;
  }

  const key = trimmed.slice(0, equalsIndex).trim();
  const rawValue = trimmed.slice(equalsIndex + 1).trim();

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null;
  }

  return {
    key,
    value: unquoteValue(rawValue)
  };
}

function unquoteValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
