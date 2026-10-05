/**
 * Black-box contract: build the CLI into a scratch dir and spawn it against
 * an env-driven fake `goal-gen` on PATH. Never a real engine.
 */
import { execFile, execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PINNED_ENGINE_VERSION } from '../src/pin.js';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const fixturePath = path.join(
  packageRoot,
  'tests',
  'fixtures',
  'fake-engine.mjs'
);

let buildDir: string;
let cliPath: string;
let scratch: string;

beforeAll(() => {
  buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yellow-goal-build-'));
  cliPath = path.join(buildDir, 'cli.js');
  execFileSync(
    'node',
    [
      path.join(packageRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
      '-p',
      'tsconfig.json',
      '--outDir',
      buildDir,
    ],
    { cwd: packageRoot, stdio: 'inherit' }
  );
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'yellow-goal-scratch-'));
}, 60_000);

afterAll(() => {
  if (buildDir) fs.rmSync(buildDir, { recursive: true, force: true });
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
});

interface CliRun {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

async function runCli(
  args: readonly string[],
  extraEnv: NodeJS.ProcessEnv = {}
): Promise<CliRun> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [cliPath, ...args],
      {
        env: {
          ...process.env,
          GOAL_GEN_BIN: process.execPath,
          NODE_OPTIONS: `--import=${pathToFileURL(fixturePath).href}`,
          FAKE_GOAL_CLI_PATH: cliPath,
          ...extraEnv,
        },
        timeout: 10_000,
        killSignal: 'SIGKILL',
      }
    );
    return { stdout, stderr, exitCode: 0 };
  } catch (err) {
    const e = err as { stdout: string; stderr: string; code: number };
    return { stdout: e.stdout, stderr: e.stderr, exitCode: e.code };
  }
}

function parseSingleJsonLine(stdout: string): unknown {
  const lines = stdout.split('\n').filter((line) => line.length > 0);
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0] as string);
}

describe('portable fake goal-gen contract', () => {
  it.each(
    [
      [],
      ['setup', '--bogus'],
      ['request', 'create', '--repo'],
      ['request', 'create', '--bogus'],
      ['request', 'validate'],
      ['request', 'validate', 'one.json', 'two.json'],
      ['request', 'validate', '--bogus'],
      ['run'],
      ['analyze'],
      ['request', 'validate', '--executor=stub'],
      ['run-stub'],
      ['run-stub', 'req.json', '--executor', 'claude-code'],
      ['run-stub', 'req.json', '--executor=stub'],
      ['run-stub', 'req.json', '--protocol', 'v1'],
      ['run-stub', 'req.json', '--protocol=v1'],
      ['run-stub', 'req.json', '--bogus'],
      ['run-stub', 'req.json', 'extra-positional'],
      ['run-stub', 'req.json', '--scenario', 'not-a-real-scenario'],
      ['run-stub', 'req.json', '--timeout-ms', 'abc'],
      ['run-stub', 'req.json', '--timeout-ms', '-5'],
      ['run-stub', 'req.json', '--timeout-ms', '0'],
    ].map((args) => ({ args }))
  )(
    'rejects invalid argv $args before invoking an engine',
    async ({ args }) => {
      const result = await runCli(args, {
        GOAL_GEN_BIN: path.join(scratch, 'never-exists'),
      });
      expect(result.exitCode).toBe(2);
      expect(parseSingleJsonLine(result.stdout)).toMatchObject({
        ok: false,
        error: { code: 'GOAL_INVALID_INPUT' },
      });
    }
  );

  it('probes the pin before a request and creates no output on mismatch', async () => {
    const output = path.join(scratch, 'must-not-be-created.json');
    const result = await runCli(
      [
        'request',
        'create',
        '--repo',
        scratch,
        '--goal',
        'test',
        '--output',
        output,
      ],
      { FAKE_GOAL_GEN_MODE: 'mismatch', FAKE_GOAL_GEN_VERSION: '9.9.9' }
    );
    expect(result.exitCode).toBe(1);
    expect(parseSingleJsonLine(result.stdout)).toMatchObject({
      error: { code: 'GOAL_ENGINE_VERSION_MISMATCH' },
    });
    expect(fs.existsSync(output)).toBe(false);
  });
  it('setup exits 0 when the fake reports the pin', async () => {
    const result = await runCli(['setup']);
    expect(result.exitCode).toBe(0);
    const body = parseSingleJsonLine(result.stdout) as {
      ok: boolean;
      engineVersion: string;
    };
    expect(body.ok).toBe(true);
    expect(body.engineVersion).toBe(PINNED_ENGINE_VERSION);
  });

  it('setup fail-closes on version mismatch', async () => {
    const result = await runCli(['setup'], {
      FAKE_GOAL_GEN_MODE: 'mismatch',
      FAKE_GOAL_GEN_VERSION: '9.9.9',
    });
    expect(result.exitCode).toBe(1);
    const body = parseSingleJsonLine(result.stdout) as {
      ok: boolean;
      error: { code: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('GOAL_ENGINE_VERSION_MISMATCH');
  });

  it('setup fail-closes when goal-gen is missing from PATH', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'yellow-goal-empty-'));
    try {
      const result = await runCli(['setup'], {
        PATH: empty,
        GOAL_GEN_BIN: path.join(empty, 'missing-goal-gen'),
      });
      expect(result.exitCode).toBe(1);
      const body = parseSingleJsonLine(result.stdout) as {
        ok: boolean;
        error: { code: string };
      };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('GOAL_ENGINE_MISSING');
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('request create + validate round-trip through the fake', async () => {
    const output = path.join(scratch, 'request.json');
    const created = await runCli([
      'request',
      'create',
      '--repo',
      scratch,
      '--goal',
      'install smoke',
      '--output',
      output,
    ]);
    expect(created.exitCode).toBe(0);
    const createdBody = parseSingleJsonLine(created.stdout) as {
      ok: boolean;
      requestId: string;
    };
    expect(createdBody.ok).toBe(true);
    expect(createdBody.requestId).toBe('req_fake');
    expect(fs.existsSync(output)).toBe(true);

    const validated = await runCli(['request', 'validate', output]);
    expect(validated.exitCode).toBe(0);
    const validatedBody = parseSingleJsonLine(validated.stdout) as {
      ok: boolean;
      valid: boolean;
    };
    expect(validatedBody.ok).toBe(true);
    expect(validatedBody.valid).toBe(true);
  });

  it('refuses --executor on request create (exit 2)', async () => {
    const result = await runCli([
      'request',
      'create',
      '--repo',
      scratch,
      '--goal',
      'nope',
      '--output',
      path.join(scratch, 'x.json'),
      '--executor',
      'claude-code',
    ]);
    expect(result.exitCode).toBe(2);
    const body = parseSingleJsonLine(result.stdout) as {
      ok: boolean;
      error: { code: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('GOAL_INVALID_INPUT');
  });

  it('fake goal-gen without --json is not process-contract JSON', () => {
    const out = execFileSync(process.execPath, ['version'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_OPTIONS: `--import=${pathToFileURL(fixturePath).href}`,
        FAKE_GOAL_CLI_PATH: cliPath,
      },
    });
    expect(() => JSON.parse(out.trim())).toThrow();
  });

  it('request validate fail-closes when the fake returns valid:false', async () => {
    const result = await runCli(
      ['request', 'validate', path.join(scratch, 'request.json')],
      { FAKE_GOAL_GEN_VALID: 'false' }
    );
    expect(result.exitCode).toBe(1);
    const body = parseSingleJsonLine(result.stdout) as {
      ok: boolean;
      error: { code: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('GOAL_ENGINE_FAILED');
  });

  it('unknown subcommand is a usage error (exit 2)', async () => {
    const result = await runCli(['definitely-not']);
    expect(result.exitCode).toBe(2);
    const body = parseSingleJsonLine(result.stdout) as {
      ok: boolean;
      error: { code: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('GOAL_INVALID_INPUT');
  });
});

describe('run-stub against the portable fake provider engine', () => {
  const providerFixturePath = path.join(
    packageRoot,
    'tests',
    'fixtures',
    'fake-provider-engine.mjs'
  );

  it('runs the success scenario end to end and exits 0', async () => {
    const result = await runCli(['run-stub', 'req.json', '--yes'], {
      GOAL_GEN_BIN: providerFixturePath,
    });
    expect(result.exitCode).toBe(0);
    const body = parseSingleJsonLine(result.stdout) as {
      ok: boolean;
      operation: string;
      engineVersion: string;
      summary: { status: string };
    };
    expect(body.ok).toBe(true);
    expect(body.operation).toBe('run-stub');
    expect(body.engineVersion).toBe(PINNED_ENGINE_VERSION);
    expect(body.summary.status).toBe('succeeded');
  });

  it('maps a failed scenario to exit 1 with GOAL_RUN_FAILED', async () => {
    const result = await runCli(
      ['run-stub', 'req.json', '--scenario', 'failed', '--yes'],
      { GOAL_GEN_BIN: providerFixturePath }
    );
    expect(result.exitCode).toBe(1);
    const body = parseSingleJsonLine(result.stdout) as {
      ok: boolean;
      error: { code: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('GOAL_RUN_FAILED');
  });

  it('accepts a leading-dash request path after -- on run-stub', async () => {
    const result = await runCli(
      ['run-stub', '--scenario', 'success', '--yes', '--', '-odd-request.json'],
      { GOAL_GEN_BIN: providerFixturePath }
    );
    expect(result.exitCode).toBe(0);
    expect(parseSingleJsonLine(result.stdout)).toMatchObject({
      ok: true,
      operation: 'run-stub',
    });
  });

  it('forwards a SIGTERM into the run-stub operation and reports GOAL_RUN_CANCELLED', async () => {
    const resultPromise = new Promise<CliRun>((resolve) => {
      const child = execFile(
        process.execPath,
        [
          cliPath,
          'run-stub',
          'req.json',
          '--scenario',
          'await-cancel',
          '--timeout-ms',
          '60000',
        ],
        {
          env: { ...process.env, GOAL_GEN_BIN: providerFixturePath },
          timeout: 15_000,
          killSignal: 'SIGKILL',
        },
        (err, stdout, stderr) => {
          const exitCode = (err as { code?: number } | null)?.code ?? 0;
          resolve({ stdout, stderr, exitCode });
        }
      );
      // Give the CLI time to spawn the engine child, complete the fast
      // version/capabilities probes, and reach the run phase's
      // await-cancel wait before signalling.
      setTimeout(() => {
        if (child.pid !== undefined) process.kill(child.pid, 'SIGTERM');
      }, 3000);
    });
    const result = await resultPromise;
    expect(result.exitCode).toBe(1);
    const body = parseSingleJsonLine(result.stdout) as {
      ok: boolean;
      error: { code: string; localCause?: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('GOAL_RUN_CANCELLED');
    expect(body.error.localCause).toBe('caller-cancelled');
  }, 20_000);
});

describe('run-stub scratch hygiene', () => {
  const fixture = path.join(
    packageRoot,
    'tests',
    'fixtures',
    'fake-provider-engine.mjs'
  );
  it('ignores GOAL_GEN_SCRATCH from the ambient environment and retains nothing', async () => {
    const pinned = path.join(scratch, 'ambient-scratch-must-not-be-used');
    const result = await runCli(
      ['run-stub', 'req.json', '--scenario', 'success', '--yes'],
      { GOAL_GEN_BIN: fixture, GOAL_GEN_SCRATCH: pinned }
    );
    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(pinned)).toBe(false);
  });
});

describe('run-real against the portable fake provider engine', () => {
  const providerFixturePath = path.join(
    packageRoot,
    'tests',
    'fixtures',
    'fake-provider-engine.mjs'
  );

  function realArgs(name: string, approval: string): {
    args: string[];
    bundle: string;
  } {
    const bundle = path.join(scratch, `bundle-${name}`);
    fs.mkdirSync(bundle, { recursive: true });
    return {
      bundle,
      args: [
        'run-real',
        'req.json',
        '--approval',
        approval,
        '--profile',
        'config-repair',
        '--max-turns',
        '4',
        '--per-action-usd',
        '1',
        '--total-usd',
        '5',
        '--auth-mode',
        'subscription',
        '--allowed-tool',
        'Read',
        '--bundle-dir',
        bundle,
        '--spend-ledger',
        path.join(bundle, 'spend.jsonl'),
      ],
    };
  }

  function readJson(file: string): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  }

  it('shows the engine manifest, forwards the approval, and reports spend and bundle path', async () => {
    const approval = path.join(scratch, 'operator-approval.json');
    fs.writeFileSync(approval, '{}\n');
    const { args, bundle } = realArgs('verified', approval);
    const result = await runCli(args, { GOAL_GEN_BIN: providerFixturePath });
    expect(result.exitCode).toBe(0);
    const body = parseSingleJsonLine(result.stdout) as {
      ok: boolean;
      operation: string;
      outcome: string;
      manifest: Record<string, unknown>;
      spend: { costUsd: number; approvalId: string };
      bundleDir: string;
    };
    const recordedManifest = readJson(path.join(bundle, 'fake-manifest.json'));
    const recordedRun = readJson(path.join(bundle, 'fake-run.json')) as {
      argv: string[];
      events: { type: string; payload: Record<string, unknown> }[];
    };
    expect(body.ok).toBe(true);
    expect(body.operation).toBe('run-real');
    expect(body.outcome).toBe('verified');
    expect(body.manifest).toEqual(recordedManifest['body']);
    const spend = recordedRun.events.find((event) => event.type === 'run.spend');
    const summary = recordedRun.events.find(
      (event) => event.type === 'run.summary'
    );
    expect(body.spend).toEqual(spend?.payload);
    expect(body.bundleDir).toBe(summary?.payload['bundleDir']);
    expect(recordedRun.argv).toContain('--approval');
    expect(recordedRun.argv[recordedRun.argv.indexOf('--approval') + 1]).toBe(
      approval
    );
    expect(recordedRun.argv).toEqual(
      expect.arrayContaining([
        '--protocol',
        'v2',
        '--executor',
        'agx-claude-code',
      ])
    );
    expect(recordedRun.argv).not.toContain('--yes');
    expect(recordedRun.argv).not.toContain('approve');
    const manifestArgv = recordedManifest['argv'] as string[];
    expect(manifestArgv[0]).toBe('run');
    expect(manifestArgv[1]).toBe('manifest');
    expect(manifestArgv).not.toContain('--yes');
    expect(manifestArgv).not.toContain('approve');
  });

  it('reports spend and no bundle path when the worker fails after spawn', async () => {
    const { args, bundle } = realArgs(
      'worker-failed',
      path.join(scratch, 'mode-worker-failed.json')
    );
    const result = await runCli(args, { GOAL_GEN_BIN: providerFixturePath });
    expect(result.exitCode).toBe(1);
    const body = parseSingleJsonLine(result.stdout) as {
      ok: boolean;
      outcome: string;
      spend?: { costUsd: number };
      bundleDir?: string;
    };
    const recordedRun = readJson(path.join(bundle, 'fake-run.json')) as {
      events: { type: string; payload: { costUsd?: number } }[];
    };
    const spend = recordedRun.events.find((event) => event.type === 'run.spend');
    expect(body.ok).toBe(false);
    expect(body.outcome).toBe('worker-failed');
    expect(body.spend?.costUsd).toBe(spend?.payload.costUsd);
    expect(body.bundleDir).toBeUndefined();
  });

  it('accepts a pre-spawn failure with neither spend nor a bundle path', async () => {
    const { args } = realArgs(
      'pre-spawn',
      path.join(scratch, 'mode-pre-spawn.json')
    );
    const result = await runCli(args, { GOAL_GEN_BIN: providerFixturePath });
    expect(result.exitCode).toBe(1);
    const body = parseSingleJsonLine(result.stdout) as {
      outcome: string;
      eventCount: number;
      spend?: unknown;
      bundleDir?: unknown;
    };
    expect(body.outcome).toBe('worker-failed');
    expect(body.eventCount).toBe(2);
    expect(body.spend).toBeUndefined();
    expect(body.bundleDir).toBeUndefined();
  });

  it('reports a refusal with no run.start, spend, or bundle', async () => {
    const unread = await runCli(
      realArgs('refusal', path.join(scratch, 'mode-refusal.json')).args,
      { GOAL_GEN_BIN: providerFixturePath }
    );
    expect(unread.exitCode).toBe(1);
    const unreadBody = parseSingleJsonLine(unread.stdout) as {
      outcome: string;
      eventCount: number;
      runId?: string;
      approvalId?: string;
      spend?: unknown;
      bundleDir?: unknown;
      refusalCode: string;
    };
    expect(unreadBody.outcome).toBe('refused');
    expect(unreadBody.eventCount).toBe(0);
    expect(unreadBody.runId).toBeUndefined();
    expect(unreadBody.approvalId).toBeUndefined();
    expect(unreadBody.spend).toBeUndefined();
    expect(unreadBody.bundleDir).toBeUndefined();
    expect(unreadBody.refusalCode).toBe('APPROVAL_MISSING');

    const known = await runCli(
      realArgs(
        'refusal-known',
        path.join(scratch, 'mode-refusal-known.json')
      ).args,
      { GOAL_GEN_BIN: providerFixturePath }
    );
    const knownBody = parseSingleJsonLine(known.stdout) as {
      outcome: string;
      approvalId?: string;
      spend?: unknown;
      bundleDir?: unknown;
    };
    const recorded = readJson(
      path.join(scratch, 'bundle-refusal-known', 'fake-run.json')
    ) as { stderr: { approvalId?: string } };
    expect(knownBody.outcome).toBe('refused');
    expect(knownBody.approvalId).toBe(recorded.stderr.approvalId);
    expect(knownBody.spend).toBeUndefined();
    expect(knownBody.bundleDir).toBeUndefined();
  });

  it.each(['simulation-true', 'missing-approval', 'target-honored'])(
    'rejects a real-run stream with %s',
    async (mode) => {
      const { args } = realArgs(
        mode,
        path.join(scratch, `mode-${mode}.json`)
      );
      const result = await runCli(args, { GOAL_GEN_BIN: providerFixturePath });
      expect(result.exitCode).toBe(1);
      expect(parseSingleJsonLine(result.stdout)).toMatchObject({
        ok: false,
        error: { code: 'GOAL_PROTOCOL_INVALID' },
      });
    }
  );

  it.each([
    ['--yes'],
    ['--executor', 'claude-code'],
    ['--protocol', 'v1'],
    ['approve'],
  ])('refuses %j before spawning the engine', async (...extra) => {
    const { args, bundle } = realArgs('refused-flag', path.join(scratch, 'a.json'));
    const result = await runCli([...args, ...extra], {
      GOAL_GEN_BIN: providerFixturePath,
    });
    expect(result.exitCode).toBe(2);
    expect(parseSingleJsonLine(result.stdout)).toMatchObject({
      ok: false,
      error: { code: 'GOAL_INVALID_INPUT' },
    });
    expect(fs.existsSync(path.join(bundle, 'fake-run.json'))).toBe(false);
    expect(fs.existsSync(path.join(bundle, 'fake-manifest.json'))).toBe(false);
  });
});
