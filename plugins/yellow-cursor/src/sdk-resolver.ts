/**
 * Resolves `@cursor/sdk` lazily: only sdk-adapter.ts calls resolveSdk(), and
 * only when an operation actually needs it (so `delegate --dry-run` and
 * usage-error paths never touch the SDK at all). Falls back to a
 * data-dir-local install performed by `setup --install-sdk` when the
 * workspace dependency isn't resolvable (e.g. this CLI installed/run
 * standalone outside the monorepo).
 */

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

import { resolveRuntimeDir } from './config.js';
import { throwAppError } from './errors.js';

type CursorSdkModule = typeof import('@cursor/sdk');

let cachedSdk: CursorSdkModule | undefined;

/** Test-only: forces the next resolveSdk() call to re-resolve instead of using the cache. */
export function resetSdkCache(): void {
  cachedSdk = undefined;
}

function tryRequire(specifier: string): CursorSdkModule | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(specifier) as CursorSdkModule;
  } catch {
    return undefined;
  }
}

export function resolveSdk(dataDir: string): CursorSdkModule {
  if (cachedSdk) return cachedSdk;

  const workspaceSdk = tryRequire('@cursor/sdk');
  if (workspaceSdk) {
    cachedSdk = workspaceSdk;
    return cachedSdk;
  }

  const runtimeModulePath = path.join(
    resolveRuntimeDir(dataDir),
    'node_modules',
    '@cursor',
    'sdk'
  );
  if (fs.existsSync(runtimeModulePath)) {
    const runtimeSdk = tryRequire(runtimeModulePath);
    if (runtimeSdk) {
      cachedSdk = runtimeSdk;
      return cachedSdk;
    }
  }

  return throwAppError(
    'CURSOR_SDK_MISSING',
    '@cursor/sdk is not installed and no data-dir runtime install was found.',
    {
      recoveryAction:
        'Run /cursor:setup (or `cursor setup --install-sdk`) to install the Cursor SDK.',
    }
  );
}

export type SdkResolutionState = 'workspace' | 'data-dir' | 'missing';

/** Non-throwing probe for `setup` reporting — resolveSdk() throws on total failure, this doesn't. */
export function probeSdkResolutionState(dataDir: string): SdkResolutionState {
  if (cachedSdk) return 'workspace';
  if (tryRequire('@cursor/sdk')) return 'workspace';
  const runtimeModulePath = path.join(
    resolveRuntimeDir(dataDir),
    'node_modules',
    '@cursor',
    'sdk'
  );
  if (fs.existsSync(runtimeModulePath) && tryRequire(runtimeModulePath))
    return 'data-dir';
  return 'missing';
}

const execFileAsync = promisify(execFile);

export interface InstallSdkResult {
  readonly ok: true;
  readonly runtimeDir: string;
}

export async function installSdk(dataDir: string): Promise<InstallSdkResult> {
  const runtimeDir = resolveRuntimeDir(dataDir);
  await fs.promises.mkdir(runtimeDir, { recursive: true, mode: 0o700 });
  await execFileAsync(
    'npm',
    [
      'install',
      '--prefix',
      runtimeDir,
      '@cursor/sdk@1.0.28',
      '--no-save',
      '--no-audit',
      '--no-fund',
    ],
    { shell: false }
  );
  resetSdkCache();
  return { ok: true, runtimeDir };
}
