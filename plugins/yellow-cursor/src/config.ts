/**
 * Credential-source labeling and host-neutral data-dir resolution. Never
 * reads auth from argv, and never returns/prints the credential value
 * itself — only which source it came from.
 */

import * as os from 'node:os';
import * as path from 'node:path';

export type CredentialSource = 'env' | 'stored-login' | 'none';

/**
 * The CLI only knows about the env-var branch of the precedence order
 * (CURSOR_API_KEY env -> SDK stored login -> none); whether a stored login
 * exists is only knowable by asking the SDK (SdkAdapter.probeSetup), so
 * runtime.ts combines this with the adapter probe result.
 */
export function hasEnvApiKey(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env['CURSOR_API_KEY'];
  return typeof value === 'string' && value.length > 0;
}

export interface DataDirEnv {
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly homedir: () => string;
}

const DEFAULT_DATA_DIR_ENV: DataDirEnv = {
  env: process.env,
  platform: process.platform,
  homedir: os.homedir,
};

/**
 * `node:path`'s default export is bound to the OS actually running the
 * process, not to a logical `platform` argument — so a win32 stub run on a
 * Linux CI box would silently produce POSIX-separated paths without this.
 * Selecting `path.win32` explicitly makes the platform argument authoritative
 * regardless of the host OS, which is what makes this testable at all.
 */
function pathFor(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix;
}

export function resolveDataDir(overrides: Partial<DataDirEnv> = {}): string {
  const { env, platform, homedir } = { ...DEFAULT_DATA_DIR_ENV, ...overrides };
  const p = pathFor(platform);

  const explicit = env['YELLOW_CURSOR_DATA_DIR'];
  if (explicit && explicit.length > 0) {
    return explicit;
  }

  const xdgDataHome = env['XDG_DATA_HOME'];
  if (xdgDataHome && xdgDataHome.length > 0) {
    return p.join(xdgDataHome, 'yellow-cursor');
  }

  if (platform === 'darwin') {
    return p.join(homedir(), 'Library', 'Application Support', 'yellow-cursor');
  }

  if (platform === 'win32') {
    const appData = env['APPDATA'];
    if (appData && appData.length > 0) {
      return p.join(appData, 'yellow-cursor');
    }
    return p.join(homedir(), 'AppData', 'Roaming', 'yellow-cursor');
  }

  return p.join(homedir(), '.local', 'share', 'yellow-cursor');
}

export function resolveRuntimeDir(dataDir: string): string {
  return path.join(dataDir, 'runtime');
}

export function resolveStateFilePath(dataDir: string): string {
  return path.join(dataDir, 'state', 'agents.json');
}

export function resolveStateDir(dataDir: string): string {
  return path.join(dataDir, 'state');
}
