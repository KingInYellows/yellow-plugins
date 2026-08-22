/**
 * Black-box contract test: builds the CLI into a scratch location and
 * spawns it as a real subprocess. Scoped to scenarios that are guaranteed
 * zero-network (dry-run, missing --yes, nested-delegation guard, and usage
 * errors) — anything that would reach the real @cursor/sdk is exercised
 * against FakeSdkAdapter at the runtime.ts level instead (see
 * idempotency.test.ts / agent-run-lifecycle.test.ts / concurrency.test.ts).
 */

import { execFile, execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
// Build into a per-run temp directory rather than the package's dist/ —
// dist/ is COMMITTED (installed plugins ship the compiled CLI), so the test
// must never delete or overwrite it.
let buildDir: string;
let cliPath: string;

let dataDir: string;

beforeAll(async () => {
  buildDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'yellow-cursor-build-')
  );
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
    {
      cwd: packageRoot,
      stdio: 'inherit',
    }
  );
  dataDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'yellow-cursor-cli-')
  );
}, 60_000);

afterAll(async () => {
  if (buildDir)
    await fs.promises.rm(buildDir, { recursive: true, force: true });
  if (dataDir) await fs.promises.rm(dataDir, { recursive: true, force: true });
});

interface CliRun {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

async function runCli(args: readonly string[]): Promise<CliRun> {
  try {
    const { stdout, stderr } = await execFileAsync('node', [cliPath, ...args], {
      env: {
        ...process.env,
        CURSOR_API_KEY: '',
        YELLOW_CURSOR_DATA_DIR: dataDir,
      },
    });
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

describe('stdout/stderr/exit-code contract', () => {
  it('delegate --dry-run prints exactly one ok:true JSON object and exits 0, touching no network', async () => {
    const result = await runCli([
      'delegate',
      '--repo',
      'https://github.com/org/repo',
      '--prompt',
      'do the thing',
      '--dry-run',
    ]);
    expect(result.exitCode).toBe(0);
    const body = parseSingleJsonLine(result.stdout) as {
      ok: boolean;
      operation: string;
      dryRun: boolean;
    };
    expect(body.ok).toBe(true);
    expect(body.operation).toBe('delegate');
    expect(body.dryRun).toBe(true);
  });

  it('delegate without --yes returns CURSOR_CONFIRMATION_REQUIRED, exits 1, and echoes idempotencyKey', async () => {
    const result = await runCli([
      'delegate',
      '--repo',
      'https://github.com/org/repo',
      '--prompt',
      'do it',
    ]);
    expect(result.exitCode).toBe(1);
    const body = parseSingleJsonLine(result.stdout) as {
      ok: boolean;
      operation: string;
      idempotencyKey: string;
      error: { code: string };
    };
    expect(body.ok).toBe(false);
    expect(body.operation).toBe('delegate');
    expect(body.error.code).toBe('CURSOR_CONFIRMATION_REQUIRED');
    expect(typeof body.idempotencyKey).toBe('string');
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it('follow-up without --yes returns CURSOR_CONFIRMATION_REQUIRED and echoes idempotencyKey', async () => {
    const result = await runCli([
      'follow-up',
      '--agent-id',
      'bc-abc',
      '--prompt',
      'more',
    ]);
    expect(result.exitCode).toBe(1);
    const body = parseSingleJsonLine(result.stdout) as {
      ok: boolean;
      idempotencyKey: string;
      error: { code: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('CURSOR_CONFIRMATION_REQUIRED');
    expect(typeof body.idempotencyKey).toBe('string');
  });

  it('cancel/archive/unarchive without --yes all return CURSOR_CONFIRMATION_REQUIRED with no network', async () => {
    for (const args of [
      ['cancel', '--run-id', 'run-1', '--agent-id', 'bc-abc'],
      ['archive', '--agent-id', 'bc-abc'],
      ['unarchive', '--agent-id', 'bc-abc'],
    ]) {
      const result = await runCli(args);
      expect(result.exitCode).toBe(1);
      const body = parseSingleJsonLine(result.stdout) as {
        ok: boolean;
        error: { code: string };
      };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('CURSOR_CONFIRMATION_REQUIRED');
    }
  });

  it('delegate --yes inside a nested remote-agent context refuses before any network call', async () => {
    const { stdout, stderr } = await execFileAsync(
      'node',
      [
        cliPath,
        'delegate',
        '--repo',
        'https://github.com/org/repo',
        '--prompt',
        'do it',
        '--yes',
      ],
      {
        env: {
          ...process.env,
          CURSOR_API_KEY: '',
          YELLOW_CURSOR_DATA_DIR: dataDir,
          YELLOW_REMOTE_AGENT_CONTEXT: '1',
        },
      }
    ).catch((err: { stdout: string; stderr: string }) => err);
    const body = parseSingleJsonLine(stdout) as {
      ok: boolean;
      error: { code: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('CURSOR_NESTED_DELEGATION');
    expect(stderr.length).toBeGreaterThan(0);
  });

  it('an unknown subcommand exits 2 with a CURSOR_INVALID_INPUT usage error', async () => {
    const result = await runCli(['not-a-real-command']);
    expect(result.exitCode).toBe(2);
    const body = parseSingleJsonLine(result.stdout) as {
      ok: boolean;
      error: { code: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('CURSOR_INVALID_INPUT');
  });

  it('a missing required flag exits 2 with a CURSOR_INVALID_INPUT usage error', async () => {
    const result = await runCli(['delegate', '--prompt', 'missing repo']);
    expect(result.exitCode).toBe(2);
    const body = parseSingleJsonLine(result.stdout) as {
      ok: boolean;
      error: { code: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('CURSOR_INVALID_INPUT');
  });

  it('--max-active with trailing garbage exits 2 rather than silently truncating to a leading-digit prefix', async () => {
    // Number.parseInt('3abc', 10) === 3 — without a strict digit check this
    // would silently succeed as max-active=3 instead of rejecting the flag.
    const result = await runCli([
      'delegate',
      '--repo',
      'https://github.com/org/repo',
      '--prompt',
      'do it',
      '--max-active',
      '3abc',
    ]);
    expect(result.exitCode).toBe(2);
    const body = parseSingleJsonLine(result.stdout) as {
      ok: boolean;
      error: { code: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('CURSOR_INVALID_INPUT');
  });

  it('no subcommand at all exits 2', async () => {
    const result = await runCli([]);
    expect(result.exitCode).toBe(2);
    parseSingleJsonLine(result.stdout);
  });
});
