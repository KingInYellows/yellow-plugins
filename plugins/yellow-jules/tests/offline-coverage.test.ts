/**
 * R52 PR2 scenario set, end to end through the compiled CLI against the
 * loopback fake server: credential absence, inaccessible sources, invalid
 * inputs, SDK module loading (workspace and data-dir branches, entry-digest
 * mismatch, storage binding), installed-cache execution, unknown states,
 * duplicate activities, pagination and partial pagination, corrupt journal
 * reads, and the negative test — every shipped subcommand issues zero
 * POST/PATCH/PUT/DELETE requests.
 *
 * "Installed cache" means a plugin root holding dist/, package.json, and
 * runtime/ with no node_modules, as Claude Code installs it; the SDK can then
 * only come from `setup --install-sdk` into the data dir.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  resolveJournalPath,
  resolveRuntimeDir,
  resolveStateDir,
} from '../src/config.js';
import { JulesSdkAdapter, type SdkModule } from '../src/sdk-adapter.js';

import {
  FakeJulesServer,
  restActivity,
  restSession,
} from './fake-http-server.js';
import { codeOf } from './support/app-error.js';
import {
  buildPlugin,
  type BuiltPlugin,
  type CliRun,
  isolation,
  type Isolation,
  runCli,
} from './support/cli-harness.js';
import { createPathTraps, type PathTraps } from './support/path-traps.js';

vi.setConfig({ testTimeout: 120_000 });

let cachePlugin: BuiltPlugin;
let workspacePlugin: BuiltPlugin;
let traps: PathTraps;
let server: FakeJulesServer;
let baseUrl: string;
let iso: Isolation;
let isoRoot: string;

beforeAll(async () => {
  traps = createPathTraps();
  cachePlugin = buildPlugin({ withWorkspaceSdk: false });
  workspacePlugin = buildPlugin({ withWorkspaceSdk: true });
  server = new FakeJulesServer();
  ({ baseUrl } = await server.start());
  isoRoot = fs.mkdtempSync(`${cachePlugin.root}-iso-`);
  iso = isolation(isoRoot, traps.pathValue, {
    YELLOW_JULES_TEST_BASE_URL: baseUrl,
    NODE_DISABLE_COMPILE_CACHE: '1',
  });
}, 180_000);

afterAll(async () => {
  await server?.stop();
  traps?.cleanup();
  for (const dir of [cachePlugin?.root, workspacePlugin?.root, isoRoot]) {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function cli(
  plugin: BuiltPlugin,
  args: string[],
  env: NodeJS.ProcessEnv = iso.env
): Promise<CliRun> {
  return runCli(plugin.cli, args, { env, cwd: iso.cwd, timeoutMs: 300_000 });
}

function errorCode(r: CliRun): unknown {
  return (r.json['error'] as Record<string, unknown> | undefined)?.['code'];
}

function seedSession(): void {
  server.reset();
  server.state.sessions.set(
    's1',
    restSession('s1', {
      state: 'COMPLETED',
      outputs: [
        {
          changeSet: {
            source: 'sources/github/octo/repo',
            gitPatch: {
              unidiffPatch: 'diff --git a/x b/x\n+new\n',
              baseCommitId: 'c'.repeat(40),
              suggestedCommitMessage: 'm',
            },
          },
        },
      ],
    })
  );
  server.state.activities.set(
    's1',
    Array.from({ length: 3 }, (_, i) =>
      restActivity('s1', `act-${i + 1}`, `2026-09-10T00:00:0${i + 1}Z`)
    )
  );
}

describe('SDK module loading in an installed plugin cache (R3 a, R4)', () => {
  it('with nothing installed, reads fail with JULES_SDK_MISSING and setup reports missing', async () => {
    seedSession();
    const status = await cli(cachePlugin, [
      'status',
      '--session',
      'sessions/s1',
    ]);
    expect(status.code).toBe(1);
    expect(errorCode(status)).toBe('JULES_SDK_MISSING');
    const setup = await cli(cachePlugin, ['setup']);
    expect(setup.code).toBe(0);
    expect(setup.json).toMatchObject({
      sdkResolution: 'missing',
      requiresAttention: true,
    });
    expect(server.log).toEqual([]);
  });

  it('setup --install-sdk installs the pinned SDK into the data dir only', async () => {
    const r = await cli(cachePlugin, ['setup', '--install-sdk']);
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({
      ok: true,
      installed: true,
      sdkResolution: 'data-dir',
      sdkVersion: '0.2.0',
      sourcesReachable: {
        supported: true,
        value: { count: 1, truncated: false },
      },
    });
    expect(r.json['sdkIntegrity']).toMatch(/^sha512-/);
    expect(r.json['sdkEntrySha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(
      fs.existsSync(path.join(cachePlugin.pluginRoot, 'node_modules'))
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(
          resolveRuntimeDir(iso.dataDir),
          'node_modules',
          '@google',
          'jules-sdk'
        )
      )
    ).toBe(true);
  });

  it('the installed cache then executes end to end from the data-dir SDK', async () => {
    seedSession();
    const r = await cli(cachePlugin, ['status', '--session', 'sessions/s1']);
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({
      vendorState: 'completed',
      condition: 'remote-completed',
    });
  });

  it('the workspace branch resolves from the plugin node_modules', async () => {
    const env = {
      ...iso.env,
      YELLOW_JULES_DATA_DIR: path.join(isoRoot, 'data-workspace'),
    };
    const r = await cli(workspacePlugin, ['setup'], env);
    expect(r.json).toMatchObject({
      ok: true,
      sdkResolution: 'workspace',
      sdkVersion: '0.2.0',
    });
    expect(r.json).not.toHaveProperty('sdkEntrySha256');
  });

  it('an entry-digest mismatch is JULES_SDK_INTEGRITY and the SDK is never loaded', async () => {
    const pinFile = path.join(resolveRuntimeDir(iso.dataDir), 'pin.json');
    const original = fs.readFileSync(pinFile, 'utf8');
    try {
      const pin = JSON.parse(original);
      pin.sdkEntrySha256 = '0'.repeat(64);
      fs.writeFileSync(pinFile, JSON.stringify(pin), { mode: 0o600 });
      seedSession();
      for (const args of [['setup'], ['status', '--session', 'sessions/s1']]) {
        const r = await cli(cachePlugin, args);
        expect(r.code).toBe(1);
        expect(errorCode(r)).toBe('JULES_SDK_INTEGRITY');
      }
      expect(server.log).toEqual([]);
    } finally {
      fs.writeFileSync(pinFile, original, { mode: 0o600 });
    }
  });

  it('an extra package planted under runtime/node_modules is JULES_SDK_INTEGRITY', async () => {
    const planted = path.join(
      resolveRuntimeDir(iso.dataDir),
      'node_modules',
      'evil'
    );
    fs.mkdirSync(planted);
    fs.writeFileSync(
      path.join(planted, 'package.json'),
      '{"name":"evil","version":"1.0.0"}'
    );
    try {
      const r = await cli(cachePlugin, ['setup']);
      expect(errorCode(r)).toBe('JULES_SDK_INTEGRITY');
    } finally {
      fs.rmSync(planted, { recursive: true, force: true });
    }
  });

  it('an SDK that ignores the injected storage factory fails the binding assertion', async () => {
    const real = (await import('@google/jules-sdk')) as unknown as SdkModule;
    const dataDir = fs.mkdtempSync(path.join(isoRoot, 'binding-'));
    const ignoring = {
      ...real,
      connect: (options: Parameters<SdkModule['connect']>[0]) =>
        real.connect({ ...options, storageFactory: undefined }),
    } as SdkModule;
    expect(
      codeOf(() =>
        JulesSdkAdapter.connect({
          sdk: ignoring,
          dataDir,
          apiKey: 'k',
          baseUrl,
        })
      )
    ).toBe('JULES_SDK_INTEGRITY');
    delete process.env['JULES_HOME'];
  });
});

describe('credentials, sources, and inputs', () => {
  it('credential absence: setup degrades, reads fail, and nothing is sent', async () => {
    server.reset();
    const env = { ...iso.env };
    delete env['JULES_API_KEY'];
    const setup = await cli(cachePlugin, ['setup'], env);
    expect(setup.json).toMatchObject({
      ok: true,
      credentialSource: 'none',
      requiresAttention: true,
    });
    const list = await cli(cachePlugin, ['list'], env);
    expect(errorCode(list)).toBe('JULES_AUTH_FAILED');
    expect(server.log).toEqual([]);
  });

  it('an inaccessible sources list (403) is JULES_AUTH_FAILED', async () => {
    server.reset();
    server.state.overrides.push((r) =>
      r.path === '/v1alpha/sources' ? { status: 403, body: {} } : undefined
    );
    const r = await cli(cachePlugin, ['setup']);
    expect(r.code).toBe(1);
    expect(errorCode(r)).toBe('JULES_AUTH_FAILED');
  });

  it('a session the vendor does not know is JULES_NOT_FOUND', async () => {
    server.reset();
    const r = await cli(cachePlugin, ['status', '--session', 'sessions/nope']);
    expect(errorCode(r)).toBe('JULES_NOT_FOUND');
  });

  it.each([
    [['status', '--session', 'sessions/../x']],
    [['collect', '--session', 'jl-XYZ']],
    [['list', '--page-token', 'a/b']],
  ])(
    'invalid input %j is JULES_INVALID_INPUT before any request',
    async (args) => {
      server.reset();
      const r = await cli(cachePlugin, args);
      expect(r.code).toBe(1);
      expect(errorCode(r)).toBe('JULES_INVALID_INPUT');
      expect(server.log).toEqual([]);
    }
  );
});

describe('vendor data shapes through the CLI', () => {
  it('an unknown vendor state is needs-inspection', async () => {
    server.reset();
    server.state.sessions.set(
      's1',
      restSession('s1', { state: 'BRAND_NEW_STATE' })
    );
    const r = await cli(cachePlugin, ['status', '--session', 'sessions/s1']);
    expect(r.json).toMatchObject({
      vendorState: 'unspecified',
      condition: 'needs-inspection',
    });
  });

  it('paginates, counts a duplicate once, and reports a partial walk without inventing an end', async () => {
    server.reset();
    server.state.sessions.set('s2', restSession('s2'));
    const a = (n: number) =>
      restActivity('s2', `act-${n}`, `2026-09-10T00:00:0${n}Z`);
    server.state.overrides.push((r) => {
      if (r.path !== '/v1alpha/sessions/s2/activities') return undefined;
      if (r.query['pageToken'] === 'p2')
        return { body: { activities: [a(2), a(3)], nextPageToken: 'p3' } };
      if (r.query['pageToken'] === 'p3') return { status: 500, body: {} };
      return { body: { activities: [a(1), a(2)], nextPageToken: 'p2' } };
    });
    const r = await cli(cachePlugin, ['status', '--session', 'sessions/s2']);
    expect(r.code).toBe(0);
    expect(r.json['activities']).toMatchObject({
      processed: 4,
      new: 3,
      pages: 2,
      partialPagination: true,
      resumePageToken: 'p3',
    });
    expect(r.json['attention']).toContain('partialPagination');
    // Page 3 was tried three times (two bounded retries), never more.
    expect(
      server.log.filter((l) => l.query['pageToken'] === 'p3')
    ).toHaveLength(3);
  });

  it('a corrupt journal is reported by list and status, and left untouched', async () => {
    const env = {
      ...iso.env,
      YELLOW_JULES_DATA_DIR: path.join(isoRoot, 'data-corrupt'),
    };
    fs.mkdirSync(resolveStateDir(env['YELLOW_JULES_DATA_DIR']!), {
      recursive: true,
      mode: 0o700,
    });
    fs.chmodSync(env['YELLOW_JULES_DATA_DIR']!, 0o700);
    fs.writeFileSync(
      resolveJournalPath(env['YELLOW_JULES_DATA_DIR']!),
      '{"version":1',
      { mode: 0o600 }
    );
    for (const args of [['list'], ['status', '--session', 'sessions/s1']]) {
      const r = await cli(workspacePlugin, args, env);
      expect(r.code).toBe(1);
      expect(errorCode(r)).toBe('JULES_JOURNAL_CORRUPT');
    }
    expect(
      fs.readFileSync(resolveJournalPath(env['YELLOW_JULES_DATA_DIR']!), 'utf8')
    ).toBe('{"version":1');
  });
});

describe('negative test (R52): the shipped surface never mutates the vendor', () => {
  it('every shipped subcommand issues zero POST/PATCH/PUT/DELETE requests', async () => {
    seedSession();
    const runs: Array<[string[], number]> = [
      [['setup'], 0],
      [['setup', '--install-sdk'], 0],
      [['list'], 0],
      [['status', '--session', 'sessions/s1'], 0],
      [['status', '--reconcile'], 0],
      [['status', '--session', 'sessions/s1', '--reconcile'], 0],
      [['collect', '--session', 'sessions/s1'], 0],
    ];
    for (const [args, code] of runs) {
      const r = await cli(cachePlugin, args);
      expect({ args, code: r.code, lines: r.stdoutLines }).toEqual({
        args,
        code,
        lines: 1,
      });
    }
    const methods = new Set(server.log.map((l) => l.method));
    expect([...methods]).toEqual(['GET']);
    expect(server.mutatingCount).toBe(0);
    expect(server.log.length).toBeGreaterThan(0);
    expect(server.log.every((l) => l.apiKeyPresent)).toBe(true);
  });

  it('collect staged the patch under the data dir, not the cwd', async () => {
    expect(fs.readdirSync(iso.cwd)).toEqual([]);
    const artifacts = path.join(iso.dataDir, 'artifacts');
    const [localDir] = fs.readdirSync(artifacts);
    expect(localDir).toMatch(/^jl-[0-9a-f]{32}$/);
    expect(
      fs.readFileSync(path.join(artifacts, localDir!, 'patch.diff'), 'utf8')
    ).toBe('diff --git a/x b/x\n+new\n');
  });

  it('no trapped tool was invoked', () => {
    expect(traps.entries()).toEqual([]);
  });
});
