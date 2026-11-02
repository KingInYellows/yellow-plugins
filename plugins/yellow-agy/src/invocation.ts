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

/**
 * Unset inside WSL on the bridge, where the Windows-side scrub can't reach
 * the distro's own environment. GIT_CONFIG_PARAMETERS (what `git -c` sets)
 * overrides the GIT_CONFIG_COUNT hooks setting, so it goes too.
 */
export const BRIDGE_UNSET_VARS = [
  ...AUTH_MODE_VARS,
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_EXEC_PATH',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
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
  /**
   * Filter driver names the repo's effective git config defines
   * (`git config --name-only --get-regexp '^filter\\.'`). Each is turned off.
   */
  readonly filterDrivers?: readonly string[];
}

const DISTRO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const FILTER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Config every git child sees (defense in depth: no profile allows git, but a
 * granted test command or the adapter's own host calls may run it): no hooks,
 * fsmonitor, editors, signing programs or submodule recursion, and every named
 * filter driver emptied (its clean/smudge/process commands run on status and
 * add).
 */
export function hookConfig(
  nullDevice: string,
  filterDrivers: readonly string[] = []
): Record<string, string> {
  const pairs: [string, string][] = [
    ['core.hooksPath', nullDevice],
    ['core.fsmonitor', 'false'],
    // `git commit --edit` runs the editor; `true` exits 0 without editing.
    ['core.editor', 'true'],
    ['sequence.editor', 'true'],
    // `git commit -S` runs the signer.
    ['commit.gpgSign', 'false'],
    ['gpg.program', 'false'],
    ['gpg.ssh.program', 'false'],
    ['gpg.x509.program', 'false'],
    // Submodules have their own config (filters, fsmonitor) we can't see.
    ['diff.ignoreSubmodules', 'all'],
    ['status.submoduleSummary', 'false'],
  ];
  for (const name of new Set(filterDrivers)) {
    if (!FILTER_NAME_RE.test(name)) {
      throw new AgyError(
        'AGY_INTERNAL',
        `invalid git filter driver name ${JSON.stringify(name)}`
      );
    }
    for (const key of ['clean', 'smudge', 'process']) {
      pairs.push([`filter.${name}.${key}`, '']);
    }
    pairs.push([`filter.${name}.required`, 'false']);
  }
  const out: Record<string, string> = {
    GIT_CONFIG_COUNT: String(pairs.length),
  };
  pairs.forEach(([key, value], i) => {
    out[`GIT_CONFIG_KEY_${i}`] = key;
    out[`GIT_CONFIG_VALUE_${i}`] = value;
  });
  return out;
}

/**
 * A copy of `env` without the auth-mode variables, WSLENV forwarding, or any
 * GIT_* variable (config overrides and repository routing such as GIT_DIR
 * would point git somewhere other than the worktree).
 */
export function scrubEnv(
  env: Readonly<Record<string, string | undefined>>
): Record<string, string> {
  const out: Record<string, string> = {};
  const drop = new Set<string>([...AUTH_MODE_VARS, 'WSLENV']);
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    // Windows env names are case-insensitive, so compare upper-cased.
    if (drop.has(key.toUpperCase())) continue;
    if (key.toUpperCase().startsWith('GIT_')) continue;
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
    let escaped = arg.replace(/(\\*)"/g, '$1$1\\"');
    // Inside quotes, trailing backslashes are doubled before the closing quote.
    if (needsQuotes) escaped = escaped.replace(/(\\+)$/, '$1$1');
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
      env: { ...env, ...hookConfig('/dev/null', options.filterDrivers) },
    };
  }

  if (host.kind === 'windows-native') {
    const inv: Invocation = {
      file: 'agy.exe',
      args: [...agyArgs],
      cwd: options.cwd,
      env: { ...env, ...hookConfig('NUL', options.filterDrivers) },
    };
    checkWindowsLength(inv);
    return inv;
  }

  const wslCwd = options.cwd;
  // Reject . and .. segments so the string check below sees the real path.
  // A symlink into /mnt can't be seen from here; the worktree root is the
  // adapter's own directory and setup checks it with realpath inside WSL.
  const segments = wslCwd.split('/');
  if (
    !wslCwd.startsWith('/') ||
    wslCwd === '/mnt' ||
    wslCwd.startsWith('/mnt/') ||
    segments.some(
      (seg, i) => seg === '.' || seg === '..' || (seg === '' && i > 0)
    )
  ) {
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
  for (const name of BRIDGE_UNSET_VARS) args.push('-u', name);
  for (const [key, value] of Object.entries(
    hookConfig('/dev/null', options.filterDrivers)
  )) {
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
