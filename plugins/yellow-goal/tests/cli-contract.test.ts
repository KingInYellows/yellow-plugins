/**
 * Black-box contract: build the CLI into a scratch dir and spawn it against
 * an env-driven fake `goal-gen` on PATH. Never a real engine.
 */
import { execFile, execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PINNED_ENGINE_VERSION } from '../src/pin.js';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const fixtureBin = path.join(packageRoot, 'tests', 'fixtures', 'bin');

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
  fs.chmodSync(path.join(fixtureBin, 'goal-gen'), 0o755);
}, 60_000);

afterAll(() => {
  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.rmSync(scratch, { recursive: true, force: true });
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
          PATH: `${fixtureBin}:${process.env.PATH ?? ''}`,
          GOAL_GEN_BIN: '',
          ...extraEnv,
        },
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

describe('PATH fake goal-gen contract', () => {
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
      const result = await runCli(['setup'], { PATH: empty });
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
    const out = execFileSync(path.join(fixtureBin, 'goal-gen'), ['version'], {
      encoding: 'utf8',
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
