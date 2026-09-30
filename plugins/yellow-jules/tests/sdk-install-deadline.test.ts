import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveRuntimeDir } from '../src/config.js';
import {
  INSTALL_TIMEOUT_MS,
  installSdk,
  type NpmRunner,
} from '../src/sdk-resolver.js';

import { codeOfAsync } from './support/app-error.js';

let root: string;
let dataDir: string;
let pluginRoot: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'yellow-jules-install-'));
  dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir, { mode: 0o700 });
  pluginRoot = path.join(root, 'plugin');
  fs.mkdirSync(path.join(pluginRoot, 'runtime'), { recursive: true });
  for (const name of ['package.json', 'package-lock.json']) {
    fs.writeFileSync(path.join(pluginRoot, 'runtime', name), '{}');
  }
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Mimics defaultNpmRunner: hangs until timeoutMs, leaving a partial node_modules behind. */
function hangingRunner(seen: { timeoutMs?: number }): NpmRunner {
  return (_args, options) =>
    new Promise((resolve) => {
      seen.timeoutMs = options.timeoutMs;
      fs.mkdirSync(path.join(options.cwd, 'node_modules', 'partial'), {
        recursive: true,
      });
      setTimeout(
        () => resolve({ exitCode: null, stderr: '', timedOut: true }),
        options.timeoutMs
      );
    });
}

describe('installSdk deadline', () => {
  it('bounds the child by the remaining deadline and reports JULES_DEADLINE_EXCEEDED', async () => {
    const seen: { timeoutMs?: number } = {};
    const started = Date.now();
    const code = await codeOfAsync(() =>
      installSdk(dataDir, {
        pluginRoot,
        deadlineMs: 50,
        runNpm: hangingRunner(seen),
      })
    );
    expect(code).toBe('JULES_DEADLINE_EXCEEDED');
    expect(seen.timeoutMs).toBe(50);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(
      fs.existsSync(path.join(resolveRuntimeDir(dataDir), 'node_modules'))
    ).toBe(false);
  });

  it('fails without spawning when no deadline remains', async () => {
    let spawned = false;
    const code = await codeOfAsync(() =>
      installSdk(dataDir, {
        pluginRoot,
        deadlineMs: 0,
        runNpm: async () => {
          spawned = true;
          return { exitCode: 0, stderr: '', timedOut: false };
        },
      })
    );
    expect(code).toBe('JULES_DEADLINE_EXCEEDED');
    expect(spawned).toBe(false);
  });

  it('keeps the install cap when the deadline is larger', async () => {
    const seen: { timeoutMs?: number } = {};
    await codeOfAsync(() =>
      installSdk(dataDir, {
        pluginRoot,
        deadlineMs: INSTALL_TIMEOUT_MS * 2,
        runNpm: async (_a, o) => {
          seen.timeoutMs = o.timeoutMs;
          return { exitCode: 1, stderr: '', timedOut: false };
        },
      })
    );
    expect(seen.timeoutMs).toBe(INSTALL_TIMEOUT_MS);
  });
});
