/**
 * The stdout/stderr/exit contract (R7, contract "Output envelope" and "Exit
 * codes"), exercised on a CLI compiled with `tsc --outDir <mkdtemp>` — never
 * the committed dist/ — and spawned with the loopback preload.
 */

import * as fs from 'node:fs';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { FakeJulesServer, restSession } from './fake-http-server.js';
import {
  buildPlugin,
  type BuiltPlugin,
  type CliRun,
  isolation,
  type Isolation,
  runCli,
} from './support/cli-harness.js';
import { createPathTraps, type PathTraps } from './support/path-traps.js';

vi.setConfig({ testTimeout: 60_000 });

let plugin: BuiltPlugin;
let traps: PathTraps;
let server: FakeJulesServer;
let iso: Isolation;
let isoRoot: string;

beforeAll(async () => {
  traps = createPathTraps();
  plugin = buildPlugin({ withWorkspaceSdk: true });
  server = new FakeJulesServer();
  const { baseUrl } = await server.start();
  isoRoot = fs.mkdtempSync(`${plugin.root}-iso-`);
  iso = isolation(isoRoot, traps.pathValue, {
    YELLOW_JULES_TEST_BASE_URL: baseUrl,
  });
}, 120_000);

afterAll(async () => {
  await server?.stop();
  traps?.cleanup();
  fs.rmSync(plugin.root, { recursive: true, force: true });
  fs.rmSync(isoRoot, { recursive: true, force: true });
});

function run(
  args: string[],
  env: NodeJS.ProcessEnv = iso.env
): Promise<CliRun> {
  return runCli(plugin.cli, args, { env, cwd: iso.cwd });
}

function expectEnvelope(
  r: CliRun,
  code: number,
  ok: boolean,
  operation: string
): void {
  expect(r.code).toBe(code);
  expect(r.stdoutLines).toBe(1);
  expect(r.stdout.endsWith('\n')).toBe(true);
  expect(r.json['ok']).toBe(ok);
  expect(r.json['operation']).toBe(operation);
}

describe('usage errors exit 2 with a valid envelope', () => {
  it.each([
    [['bogus'], 'unknown'],
    [[], 'unknown'],
    [['list', '--nope'], 'list'],
    [['list', 'positional'], 'list'],
    [['collect'], 'collect'],
    [['status'], 'status'],
    [['delegate', '--repo', 'a/b'], 'unknown'],
    [['reply'], 'unknown'],
    [['approve'], 'unknown'],
  ])('%j -> operation %s', async (args, operation) => {
    const r = await run(args);
    expectEnvelope(r, 2, false, operation);
    expect((r.json['error'] as Record<string, unknown>)['code']).toBe(
      'JULES_INVALID_INPUT'
    );
    expect(r.stderr.length).toBeGreaterThan(0);
  });
});

describe('operational failures exit 1', () => {
  it.each([
    [['status', '--session', 'not-a-ref'], 'status', 'JULES_INVALID_INPUT'],
    [['list', '--limit', '0'], 'list', 'JULES_INVALID_INPUT'],
    [['list', '--limit', '101'], 'list', 'JULES_INVALID_INPUT'],
    [['list', '--deadline-ms', 'soon'], 'list', 'JULES_INVALID_INPUT'],
    [['list', '--page-token', '../x'], 'list', 'JULES_INVALID_INPUT'],
    [['cancel'], 'cancel', 'JULES_UNSUPPORTED_CAPABILITY'],
    [['pause'], 'pause', 'JULES_UNSUPPORTED_CAPABILITY'],
  ])('%j -> %s', async (args, operation, code) => {
    const r = await run(args);
    expectEnvelope(r, 1, false, operation);
    const error = r.json['error'] as Record<string, unknown>;
    expect(error['code']).toBe(code);
    expect(typeof error['recoveryAction']).toBe('string');
    expect(typeof error['retryable']).toBe('boolean');
  });
});

describe('success exits 0 with one JSON line', () => {
  it('setup without a credential is ok with requiresAttention', async () => {
    const env = { ...iso.env };
    delete env['JULES_API_KEY'];
    const r = await run(['setup'], env);
    expectEnvelope(r, 0, true, 'setup');
    expect(r.json).toMatchObject({
      credentialSource: 'none',
      sdkResolution: 'workspace',
      requiresAttention: true,
    });
    expect(r.stderr).toBe('');
  });

  it('list against the fake server', async () => {
    server.reset();
    server.state.sessions.set('s1', restSession('s1'));
    const r = await run(['list', '--limit', '5']);
    expectEnvelope(r, 0, true, 'list');
    expect(r.json['sessions']).toEqual([
      expect.objectContaining({
        sessionResource: 'sessions/s1',
        vendorState: 'inProgress',
        condition: 'working',
      }),
    ]);
  });
});

describe('redaction on every output path', () => {
  it('vendor error text carrying the key is redacted on stdout and stderr', async () => {
    server.reset();
    server.state.overrides.push(() => ({
      status: 400,
      body: {
        error: {
          code: 400,
          message: `bad request for key ${iso.env['JULES_API_KEY']} AIzaSyA1234567890abcdefXYZ`,
        },
      },
    }));
    const r = await run(['list']);
    expectEnvelope(r, 1, false, 'list');
    expect(r.stdout).not.toContain(iso.env['JULES_API_KEY']);
    expect(r.stderr).not.toContain(iso.env['JULES_API_KEY']);
    expect(r.stdout).not.toContain('AIzaSyA1234567890abcdefXYZ');
    expect(r.stdout).toContain('***REDACTED***');
  });

  it('no trapped tool was invoked', () => {
    expect(traps.entries()).toEqual([]);
  });
});
