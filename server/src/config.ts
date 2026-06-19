/**
 * Server configuration: where the BASE directory is, what to bind, and whether
 * write endpoints are enabled.
 *
 * BASE is the one directory the server is allowed to touch. It is resolved to a
 * canonical absolute path here, once, and every request validates against it.
 * Precedence: CLI flag/positional > environment variable > current directory.
 */

import path from 'node:path';
import fs from 'node:fs';

export interface Config {
  /** Canonical absolute path to the BASE directory. */
  base: string;
  host: string;
  port: number;
  /** When false, write/create/delete/move endpoints are not registered. */
  allowWrite: boolean;
}

export const DEFAULT_PORT = 4317;
export const DEFAULT_HOST = '127.0.0.1';

/** Resolve, verify, and canonicalize the BASE directory. Throws if invalid. */
export function resolveBase(raw: string | undefined): string {
  const candidate = raw && raw.trim() !== '' ? raw : process.cwd();
  const abs = path.resolve(candidate);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new Error(`BASE directory does not exist: ${abs}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`BASE is not a directory: ${abs}`);
  }
  // Canonicalize so all later containment checks compare real paths.
  return fs.realpathSync.native(abs);
}

type ParsedArgs = {
  values: Map<string, string | boolean>;
  positionals: string[];
};

function parseArgs(argv: string[]): ParsedArgs {
  const values = new Map<string, string | boolean>();
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        values.set(key, next);
        i++;
      } else {
        values.set(key, true);
      }
    } else {
      positionals.push(arg);
    }
  }
  return { values, positionals };
}

function isTruthyFlag(v: string | boolean | undefined): boolean {
  return v === true || v === '1' || v === 'true';
}

export function loadConfig(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Config {
  const { values, positionals } = parseArgs(argv);

  const baseArg =
    (values.get('base') as string | undefined) ?? positionals[0] ?? env.LOOKMD_BASE;
  const base = resolveBase(baseArg);

  const portRaw = (values.get('port') as string | undefined) ?? env.LOOKMD_PORT;
  const port = portRaw !== undefined ? Number(portRaw) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid port: ${portRaw}`);
  }

  const host =
    (values.get('host') as string | undefined) ?? env.LOOKMD_HOST ?? DEFAULT_HOST;

  const readOnly =
    isTruthyFlag(values.get('read-only')) || isTruthyFlag(env.LOOKMD_READ_ONLY);

  return { base, host, port, allowWrite: !readOnly };
}
