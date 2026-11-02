/**
 * Builds the one way the CLI spawns agy on each host (contract-v0 "Host
 * bridge" and the hard rules). Pure: it returns an argv array and an env
 * object and never spawns anything. Every spawn in the CLI goes through
 * buildInvocation, so the env scrub, the hook-disabling git config and the
 * permission-flag guard cannot be skipped.
 */

import { AgyError } from './errors';

/** Variables that switch agy off the subscription sign-in. */
export const AUTH_MODE_VARS = [
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_GENAI_USE_VERTEXAI',
  'GOOGLE_CLOUD_PROJECT',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'AGY_ADC_AUTH',
] as const;

/** Flags the CLI never passes, whatever the caller asks for. */
const FORBIDDEN_FLAGS = ['--dangerously-skip-permissions'] as const;

/** Windows caps a command line at 32,767 characters; keep a margin. */
export const WINDOWS_ARGV_LIMIT = 30_000;

export type Host =
  | { readonly kind: 'posix' }
  | { readonly kind: 'windows-native' }
  | { readonly kind: 'wsl-bridge'; readonly distro?: string };

export interface Invocation {
  readonly file: string;
  readonly args: readonly string[];
  /** Host-side cwd for the spawn; undefined on the bridge, which uses --cd. */
  readonly cwd: string | undefined;
  readonly env: Readonly<Record<string, string>>;
}

export interface InvocationOptions {
  /** The worktree agy runs in: a host path, or a WSL path on the bridge. */
  readonly cwd: string;
  /** The caller's environment; the scrub is applied to a copy. */
  readonly baseEnv: Readonly<Record<string, string | undefined>>;
}

const DISTRO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function hookConfig(nullDevice: string): Record<string, string> {
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: nullDevice,
  };
}

/** A copy of `env` without the auth-mode variables or WSLENV forwarding. */
export function scrubEnv(
  env: Readonly<Record<string, string | undefined>>
): Record<string, string> {
  const out: Record<string, string> = {};
  const drop = new Set<string>([...AUTH_MODE_VARS, 'WSLENV']);
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    // Windows env names are case-insensitive, so compare upper-cased.
    if (drop.has(key.toUpperCase())) continue;
    if (key.toUpperCase().startsWith('GIT_CONFIG_')) continue;
    out[key] = value;
  }
  return out;
}

/** Names (never values) of auth-mode variables set in `env`. */
export function authModeVarsSet(
  env: Readonly<Record<string, string | undefined>>
): string[] {
  const set = new Set<string>();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || value === '') continue;
    const upper = key.toUpperCase();
    if ((AUTH_MODE_VARS as readonly string[]).includes(upper)) set.add(upper);
  }
  return [...set].sort();
}

function assertNoForbiddenFlags(agyArgs: readonly string[]): void {
  for (const arg of agyArgs) {
    for (const flag of FORBIDDEN_FLAGS) {
      if (arg === flag || arg.startsWith(`${flag}=`)) {
        throw new AgyError(
          'AGY_INTERNAL',
          `refusing to build an agy invocation with ${flag}`
        );
      }
    }
  }
}

/**
 * Length of the Windows command line CreateProcess would see, counting a
 * space between arguments and the quotes and escapes Node adds.
 */
export function windowsCommandLineLength(
  file: string,
  args: readonly string[]
): number {
  let total = 0;
  for (const arg of [file, ...args]) {
    const needsQuotes = arg === '' || /[\s"]/.test(arg);
    const escaped = arg.replace(/(\\*)"/g, '$1$1\\"');
    total += escaped.length + (needsQuotes ? 2 : 0) + 1;
  }
  return total - 1;
}

export function buildInvocation(
  host: Host,
  agyArgs: readonly string[],
  options: InvocationOptions
): Invocation {
  assertNoForbiddenFlags(agyArgs);
  const env = scrubEnv(options.baseEnv);

  if (host.kind === 'posix') {
    return {
      file: 'agy',
      args: [...agyArgs],
      cwd: options.cwd,
      env: { ...env, ...hookConfig('/dev/null') },
    };
  }

  if (host.kind === 'windows-native') {
    const inv: Invocation = {
      file: 'agy.exe',
      args: [...agyArgs],
      cwd: options.cwd,
      env: { ...env, ...hookConfig('NUL') },
    };
    checkWindowsLength(inv);
    return inv;
  }

  const wslCwd = options.cwd;
  if (!wslCwd.startsWith('/') || wslCwd.startsWith('/mnt/')) {
    throw new AgyError(
      'AGY_BRIDGE',
      `the bridge worktree must be an absolute path inside the WSL filesystem, not ${JSON.stringify(wslCwd)}`
    );
  }
  const args: string[] = [];
  if (host.distro !== undefined) {
    if (!DISTRO_RE.test(host.distro)) {
      throw new AgyError(
        'AGY_INVALID_INPUT',
        `invalid WSL distro name ${JSON.stringify(host.distro)}`
      );
    }
    args.push('-d', host.distro);
  }
  // Exec-only: -e runs env directly, so no distro shell re-parses argv.
  args.push('--cd', wslCwd, '-e', 'env');
  for (const name of AUTH_MODE_VARS) args.push('-u', name);
  for (const [key, value] of Object.entries(hookConfig('/dev/null'))) {
    args.push(`${key}=${value}`);
  }
  args.push('agy', ...agyArgs);
  const inv: Invocation = { file: 'wsl.exe', args, cwd: undefined, env };
  checkWindowsLength(inv);
  return inv;
}

function checkWindowsLength(inv: Invocation): void {
  const length = windowsCommandLineLength(inv.file, inv.args);
  if (length > WINDOWS_ARGV_LIMIT) {
    throw new AgyError(
      'AGY_PROMPT_TOO_LONG',
      `the agy command line would be ${length} characters; the limit is ${WINDOWS_ARGV_LIMIT}`
    );
  }
}
