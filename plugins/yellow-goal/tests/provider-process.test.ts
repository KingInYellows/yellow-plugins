/**
 * Async fixed-authority transport unit coverage. Every child here is a
 * short inline `node -e` script (same pattern as spawn.test.ts) — never a
 * real engine. Deep protocol-shaped behavior (version/capabilities/run
 * event streams) is covered in runtime-protocol.test.ts via the portable
 * fake fixture.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { GoalEngineError } from '../src/errors.js';
import {
  buildChildEnv,
  createOperationScratchDir,
  spawnProtocolChild,
  type ProtocolChildLimits,
} from '../src/provider-process.js';

const GENEROUS_LIMITS: ProtocolChildLimits = {
  maxStdoutBytes: 1_048_576,
  maxStderrBytes: 1_048_576,
};

function farFutureDeadline(): number {
  return Date.now() + 60_000;
}

function neverAbortingSignal(): AbortSignal {
  return new AbortController().signal;
}

describe('spawnProtocolChild', () => {
  it('resolves with buffered stdout/stderr on a clean exit', async () => {
    const result = await spawnProtocolChild({
      bin: process.execPath,
      argv: [
        '-e',
        "process.stdout.write('out'); process.stderr.write('err'); process.exit(0)",
      ],
      env: process.env,
      deadlineAt: farFutureDeadline(),
      signal: neverAbortingSignal(),
      limits: GENEROUS_LIMITS,
    });
    expect(result.exitCode).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stdout.toString('utf8')).toBe('out');
    expect(result.stderr.toString('utf8')).toBe('err');
    expect(result.forcedKill).toBe(false);
    expect(result.localCause).toBeUndefined();
  });

  it('streams stdout to onStdout and never buffers it', async () => {
    const chunks: Buffer[] = [];
    const result = await spawnProtocolChild({
      bin: process.execPath,
      argv: ['-e', "process.stdout.write('hello-stream'); process.exit(0)"],
      env: process.env,
      deadlineAt: farFutureDeadline(),
      signal: neverAbortingSignal(),
      limits: GENEROUS_LIMITS,
      onStdout: (chunk) => chunks.push(chunk),
    });
    expect(Buffer.concat(chunks).toString('utf8')).toBe('hello-stream');
    expect(result.stdout.length).toBe(0);
  });

  it('kills and rejects with GOAL_PROTOCOL_TRANSPORT on stdout overflow', async () => {
    await expect(
      spawnProtocolChild({
        bin: process.execPath,
        argv: ['-e', "process.stdout.write('x'.repeat(1000))"],
        env: process.env,
        deadlineAt: farFutureDeadline(),
        signal: neverAbortingSignal(),
        limits: { maxStdoutBytes: 10, maxStderrBytes: 1024 },
      })
    ).rejects.toMatchObject({ code: 'GOAL_PROTOCOL_TRANSPORT' });
  });

  it('kills and rejects with GOAL_PROTOCOL_TRANSPORT on stderr overflow', async () => {
    await expect(
      spawnProtocolChild({
        bin: process.execPath,
        argv: ['-e', "process.stderr.write('x'.repeat(1000))"],
        env: process.env,
        deadlineAt: farFutureDeadline(),
        signal: neverAbortingSignal(),
        limits: { maxStdoutBytes: 1024, maxStderrBytes: 10 },
      })
    ).rejects.toMatchObject({ code: 'GOAL_PROTOCOL_TRANSPORT' });
  });

  it('propagates a thrown onStdout error and kills the child', async () => {
    const boom = new GoalEngineError('GOAL_PROTOCOL_INVALID', 'bad record');
    await expect(
      spawnProtocolChild({
        bin: process.execPath,
        argv: [
          '-e',
          "process.stdout.write('a\\n'); setTimeout(() => process.stdout.write('b\\n'), 20); setTimeout(() => process.exit(0), 2000)",
        ],
        env: process.env,
        deadlineAt: farFutureDeadline(),
        signal: neverAbortingSignal(),
        limits: GENEROUS_LIMITS,
        onStdout: () => {
          throw boom;
        },
      })
    ).rejects.toBe(boom);
  });

  it('rejects with GOAL_ENGINE_MISSING when the binary does not exist', async () => {
    await expect(
      spawnProtocolChild({
        bin: path.join(os.tmpdir(), 'yellow-goal-does-not-exist-binary'),
        argv: [],
        env: process.env,
        deadlineAt: farFutureDeadline(),
        signal: neverAbortingSignal(),
        limits: GENEROUS_LIMITS,
      })
    ).rejects.toMatchObject({ code: 'GOAL_ENGINE_MISSING' });
  });

  it('rejects with GOAL_ENGINE_UNRUNNABLE for a non-executable binary', async () => {
    if (process.getuid?.() === 0) return; // root ignores the permission bit
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yellow-goal-noexec-'));
    const file = path.join(dir, 'not-executable');
    fs.writeFileSync(file, '#!/bin/sh\nexit 0\n', { mode: 0o600 });
    try {
      await expect(
        spawnProtocolChild({
          bin: file,
          argv: [],
          env: process.env,
          deadlineAt: farFutureDeadline(),
          signal: neverAbortingSignal(),
          limits: GENEROUS_LIMITS,
        })
      ).rejects.toMatchObject({ code: 'GOAL_ENGINE_UNRUNNABLE' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('records caller-cancelled and reports a graceful close when the child cooperates with SIGTERM', async () => {
    const controller = new AbortController();
    const resultPromise = spawnProtocolChild({
      bin: process.execPath,
      argv: [
        '-e',
        "process.on('SIGTERM', () => process.exit(7)); process.stdout.write('ready\\n'); setTimeout(() => {}, 5000)",
      ],
      env: process.env,
      deadlineAt: farFutureDeadline(),
      signal: controller.signal,
      limits: GENEROUS_LIMITS,
      // Abort only once the child has proven its SIGTERM handler is installed.
      onStdout: (chunk) => {
        if (chunk.includes('ready')) controller.abort();
      },
    });
    const result = await resultPromise;
    expect(result.exitCode).toBe(7);
    expect(result.signal).toBeNull();
    expect(result.forcedKill).toBe(false);
    expect(result.localCause).toBe('caller-cancelled');
  });

  it('records deadline as the local cause when the deadline elapses first', async () => {
    const resultPromise = spawnProtocolChild({
      bin: process.execPath,
      argv: [
        '-e',
        "process.on('SIGTERM', () => process.exit(9)); process.stdout.write('ready\\n'); setTimeout(() => {}, 5000)",
      ],
      env: process.env,
      // The deadline is far enough that the child is ready long before it
      // elapses, yet short enough to keep the test fast; the readiness
      // marker below asserts the ordering rather than assuming it.
      deadlineAt: Date.now() + 1500,
      signal: neverAbortingSignal(),
      limits: GENEROUS_LIMITS,
      onStdout: (chunk) => {
        expect(chunk.includes('ready')).toBe(true);
      },
    });
    const result = await resultPromise;
    expect(result.exitCode).toBe(9);
    expect(result.signal).toBeNull();
    expect(result.localCause).toBe('deadline');
  });

  it('escalates to SIGKILL after the grace period when the child ignores SIGTERM', async () => {
    const controller = new AbortController();
    let abortedAt = 0;
    const resultPromise = spawnProtocolChild({
      bin: process.execPath,
      argv: [
        '-e',
        "process.on('SIGTERM', () => {}); process.stdout.write('ready\\n'); setTimeout(() => {}, 20000)",
      ],
      env: process.env,
      deadlineAt: farFutureDeadline(),
      signal: controller.signal,
      limits: GENEROUS_LIMITS,
      // Abort only once the child has proven its ignore-SIGTERM handler is
      // installed; a signal sent earlier would hit the OS default action.
      onStdout: (chunk) => {
        if (chunk.includes('ready') && abortedAt === 0) {
          abortedAt = Date.now();
          controller.abort();
        }
      },
    });
    const result = await resultPromise;
    expect(Date.now() - abortedAt).toBeGreaterThanOrEqual(4900);
    expect(result.forcedKill).toBe(true);
    expect(result.localCause).toBe('caller-cancelled');
    expect(result.signal).not.toBeNull();
  }, 10_000);

  it('settles exactly once with no dangling timers on an unrelated fast exit', async () => {
    const controller = new AbortController();
    const result = await spawnProtocolChild({
      bin: process.execPath,
      argv: ['-e', 'process.exit(0)'],
      env: process.env,
      deadlineAt: farFutureDeadline(),
      signal: controller.signal,
      limits: GENEROUS_LIMITS,
    });
    expect(result.exitCode).toBe(0);
    // If timers/listeners leaked, aborting after settlement would throw or
    // hang; it must be a harmless no-op.
    expect(() => controller.abort()).not.toThrow();
  });
});

describe('buildChildEnv', () => {
  it('allowlists PATH/LANG/LC_ALL and creates a scratch HOME/TMPDIR', () => {
    const scratchDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'yellow-goal-env-')
    );
    try {
      const env = buildChildEnv({
        sourceEnv: {
          PATH: '/usr/bin',
          LANG: 'en_US.UTF-8',
          LC_ALL: 'C',
          ANTHROPIC_API_KEY: 'sk-secret',
          CLAUDE_CODE_OAUTH_TOKEN: 'oauth-secret',
          OPENAI_API_KEY: 'openai-secret',
          GH_TOKEN: 'gh-secret',
          GITHUB_TOKEN: 'gh-secret-2',
          NPM_TOKEN: 'npm-secret',
          NODE_AUTH_TOKEN: 'node-secret',
          NODE_OPTIONS: '--some-real-option',
        },
        scratchDir,
      });
      expect(env['PATH']).toBe('/usr/bin');
      expect(env['LANG']).toBe('en_US.UTF-8');
      expect(env['LC_ALL']).toBe('C');
      expect(env['HOME']).toBe(path.join(scratchDir, 'home'));
      expect(env['TMPDIR']).toBe(path.join(scratchDir, 'tmp'));
      expect(env['XDG_CONFIG_HOME']).toBe(
        path.join(scratchDir, 'home', '.config')
      );
      expect(env['XDG_CACHE_HOME']).toBe(
        path.join(scratchDir, 'home', '.cache')
      );
      expect(fs.existsSync(env['HOME'] as string)).toBe(true);
      expect(fs.existsSync(env['TMPDIR'] as string)).toBe(true);
      for (const key of [
        'ANTHROPIC_API_KEY',
        'CLAUDE_CODE_OAUTH_TOKEN',
        'OPENAI_API_KEY',
        'CODEX_API_KEY',
        'GH_TOKEN',
        'GITHUB_TOKEN',
        'NPM_TOKEN',
        'NODE_AUTH_TOKEN',
        'NODE_OPTIONS',
      ]) {
        expect(env[key]).toBeUndefined();
      }
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  it('applies childEnvOverride as a test-only injection seam', () => {
    const scratchDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'yellow-goal-env-override-')
    );
    try {
      const env = buildChildEnv({
        sourceEnv: { PATH: '/usr/bin' },
        scratchDir,
        childEnvOverride: {
          NODE_OPTIONS: '--import=file:///fixture.mjs',
          FAKE_PROVIDER_MODE: 'ok',
        },
      });
      expect(env['NODE_OPTIONS']).toBe('--import=file:///fixture.mjs');
      expect(env['FAKE_PROVIDER_MODE']).toBe('ok');
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  it('omits LANG/LC_ALL when absent from the source environment', () => {
    const scratchDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'yellow-goal-env-nolang-')
    );
    try {
      const env = buildChildEnv({
        sourceEnv: { PATH: '/usr/bin' },
        scratchDir,
      });
      expect('LANG' in env).toBe(false);
      expect('LC_ALL' in env).toBe(false);
    } finally {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });
});

describe('createOperationScratchDir', () => {
  it('honors GOAL_GEN_SCRATCH when set', () => {
    const pinned = fs.mkdtempSync(
      path.join(os.tmpdir(), 'yellow-goal-pinned-scratch-')
    );
    try {
      expect(createOperationScratchDir({ GOAL_GEN_SCRATCH: pinned })).toBe(
        pinned
      );
    } finally {
      fs.rmSync(pinned, { recursive: true, force: true });
    }
  });

  it('creates a fresh directory per call when unset', () => {
    const a = createOperationScratchDir({});
    const b = createOperationScratchDir({});
    try {
      expect(a).not.toBe(b);
      expect(fs.existsSync(a)).toBe(true);
      expect(fs.existsSync(b)).toBe(true);
    } finally {
      fs.rmSync(a, { recursive: true, force: true });
      fs.rmSync(b, { recursive: true, force: true });
    }
  });
});
