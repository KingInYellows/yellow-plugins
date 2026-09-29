/**
 * Packed-SDK transport suite (R49, R50; contract "PR2 test implications").
 *
 * `beforeAll` installs the real pinned `@google/jules-sdk@0.2.0` once into a
 * temp data dir through the shipped `installSdk` path (`npm ci
 * --ignore-scripts` from runtime/package-lock.json), which also exercises the
 * install and runtime/pin.json verification. Every scenario then drives the
 * real SDK against the loopback fake server and asserts the exact ordered
 * server-side request sequence. Mutating SDK calls happen only here, in test
 * code, through the adapter's pure builders: the shipped runtime compiles no
 * mutating path in PR2 (R52).
 *
 * These rows prove request shape, count, and side effects against
 * illustrative response bodies — not vendor response compatibility.
 */

import { execFile, execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import { walkActivities } from '../src/activity-walk.js';
import { resolveRuntimeDir, resolveSdkScratchDir } from '../src/config.js';
import { withReadRetry } from '../src/deadline.js';
import { AdapterError, type CallPhase } from '../src/errors.js';
import {
  type FetchGuardHandle,
  installFetchGuard,
} from '../src/fetch-guard.js';
import {
  buildClientOptions,
  buildCreateSessionConfig,
  classifyAdapterError,
  JulesSdkAdapter,
  type SdkModule,
} from '../src/sdk-adapter.js';
import {
  installSdk,
  type PinFile,
  resetSdkCache,
  resolveSdk,
} from '../src/sdk-resolver.js';

import {
  FakeJulesServer,
  restActivity,
  restSession,
} from './fake-http-server.js';
import { FakeClock } from './fake-sdk.js';
import { buildPlugin, PLUGIN_DIR } from './support/cli-harness.js';
import { createPathTraps, type PathTraps } from './support/path-traps.js';

const INSTALL_TIMEOUT_MS = 300_000;
const API_KEY = 'dummy-jules-test-key';

let root: string;
let dataDir: string;
let traps: PathTraps;
let sdk: SdkModule;
let sdkEntry: string;
let server: FakeJulesServer;
let second: FakeJulesServer;
let baseUrl: string;
let secondOrigin: string;
let marker: string;
const savedEnv: Record<string, string | undefined> = {};
const contactedOrigins = new Set<string>();
let originalFetch: typeof fetch;
let guard: FetchGuardHandle | undefined;
let dispatched = false;

const ISOLATED_ENV = [
  'HOME',
  'XDG_DATA_HOME',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'TMPDIR',
  'PATH',
  'JULES_HOME',
  'NODE_DISABLE_COMPILE_CACHE',
];

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'yellow-jules-packed-'));
  dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir, { mode: 0o700 });
  traps = createPathTraps();
  for (const key of ISOLATED_ENV) savedEnv[key] = process.env[key];
  for (const name of ['home', 'xdg-data', 'xdg-config', 'xdg-cache', 'tmp']) {
    fs.mkdirSync(path.join(root, name), { mode: 0o700 });
  }
  process.env['PATH'] = traps.pathValue;
  // Node's compile cache is excluded by environment (contract), for this process's children too.
  process.env['NODE_DISABLE_COMPILE_CACHE'] = '1';

  // The shipped install path, from the shipped lockfile.
  const probe = await installSdk(dataDir, { pluginRoot: PLUGIN_DIR });
  expect(probe.resolution).toBe('data-dir');

  process.env['HOME'] = path.join(root, 'home');
  process.env['XDG_DATA_HOME'] = path.join(root, 'xdg-data');
  process.env['XDG_CONFIG_HOME'] = path.join(root, 'xdg-config');
  process.env['XDG_CACHE_HOME'] = path.join(root, 'xdg-cache');
  process.env['TMPDIR'] = path.join(root, 'tmp');
  delete process.env['JULES_HOME'];

  // Resolve from a plugin root with no node_modules, so only the data-dir install can load.
  resetSdkCache();
  const resolved = await resolveSdk(dataDir, {
    pluginRoot: path.join(root, 'plugin-without-node-modules'),
  });
  expect(resolved.resolution).toBe('data-dir');
  sdk = resolved.module as SdkModule;
  sdkEntry = resolved.entryPath;

  server = new FakeJulesServer();
  second = new FakeJulesServer();
  ({ baseUrl } = await server.start());
  ({ origin: secondOrigin } = await second.start());

  // Test bootstrap: record every origin the process contacts (innermost wrapper).
  originalFetch = globalThis.fetch;
  globalThis.fetch = (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit
  ) => {
    const url = input instanceof Request ? input.url : String(input);
    contactedOrigins.add(new URL(url).origin);
    return originalFetch(input, init);
  };

  marker = path.join(root, 'marker');
  fs.writeFileSync(marker, '');
  // Make the marker strictly older than anything a scenario writes.
  const past = new Date(Date.now() - 2000);
  fs.utimesSync(marker, past, past);
}, INSTALL_TIMEOUT_MS);

afterAll(async () => {
  guard?.uninstall();
  if (originalFetch !== undefined) globalThis.fetch = originalFetch;
  await server?.stop();
  await second?.stop();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetSdkCache();
  traps?.cleanup();
  fs.rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  server.reset();
  second.reset();
  dispatched = false;
  guard = installFetchGuard({
    allowedOrigins: [new URL(baseUrl).origin],
    readTimeoutMs: 30_000,
    onPostDispatch: () => {
      dispatched = true;
    },
  });
});

afterEach(() => {
  guard?.uninstall();
  guard = undefined;
});

function newClient() {
  return sdk.connect(
    buildClientOptions(sdk, { apiKey: API_KEY, baseUrl }).options
  );
}

const CREATE = buildCreateSessionConfig({
  prompt: 'Investigate only. Do not change files.',
  owner: 'octo',
  repo: 'repo',
  baseBranch: 'main',
  title: `[yellow:jl-${'a'.repeat(32)}] investigate`,
});

async function createOutcome(): Promise<{
  ok: boolean;
  code?: string;
  phase: CallPhase;
}> {
  try {
    await newClient().session(CREATE);
    return { ok: true, phase: dispatched ? 'after-dispatch' : 'pre-dispatch' };
  } catch (err) {
    const phase: CallPhase = dispatched ? 'after-dispatch' : 'pre-dispatch';
    return {
      ok: false,
      code: classifyAdapterError(sdk, err, phase).code,
      phase,
    };
  }
}

const SOURCE_GET = 'GET /v1alpha/sources/github/octo/repo';
const CREATE_POST = 'POST /v1alpha/sessions';

describe('install and module loading (R3 a, R4)', () => {
  it('npm ci recorded the pinned tree and entry digest in runtime/pin.json', () => {
    const pin = JSON.parse(
      fs.readFileSync(path.join(resolveRuntimeDir(dataDir), 'pin.json'), 'utf8')
    ) as PinFile;
    const lock = JSON.parse(
      fs.readFileSync(
        path.join(PLUGIN_DIR, 'runtime', 'package-lock.json'),
        'utf8'
      )
    );
    expect(pin.sdkVersion).toBe('0.2.0');
    expect(pin.sdkIntegrity).toBe(
      lock.packages['node_modules/@google/jules-sdk'].integrity
    );
    expect(pin.sdkEntrySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(pin.tree.map((p) => p.name).sort()).toEqual([
      '@google/jules-sdk',
      'yaml',
      'zod',
    ]);
    if (process.platform !== 'win32') {
      expect(
        fs.statSync(path.join(resolveRuntimeDir(dataDir), 'pin.json')).mode &
          0o777
      ).toBe(0o600);
    }
  });

  it('loaded the ESM-only package from the data dir into this CJS-style build', () => {
    expect(typeof sdk.connect).toBe('function');
    expect(sdkEntry.startsWith(resolveRuntimeDir(dataDir))).toBe(true);
  });
});

describe('create request shape and replay (R12, R14, R3 b-c)', () => {
  it('sends explicit plan-approval and no-auto-PR flags, one GET then one POST', async () => {
    const outcome = await createOutcome();
    expect(outcome.ok).toBe(true);
    expect(server.paths()).toEqual([SOURCE_GET, CREATE_POST]);
    const post = server.log[1]!;
    expect(post.body).toMatchObject({
      requirePlanApproval: true,
      automationMode: 'AUTOMATION_MODE_UNSPECIFIED',
      title: `[yellow:jl-${'a'.repeat(32)}] investigate`,
      sourceContext: {
        source: 'sources/github/octo/repo',
        githubRepoContext: { startingBranch: 'main' },
      },
    });
    expect(post.body).toHaveProperty('promptDigest');
    expect(post.body).not.toHaveProperty('prompt');
    expect(server.log.every((r) => r.apiKeyPresent)).toBe(true);
  });

  it.each([
    [429, 'JULES_RATE_LIMITED'],
    [500, 'JULES_UNKNOWN_OUTCOME'],
    [502, 'JULES_UNKNOWN_OUTCOME'],
    [503, 'JULES_UNKNOWN_OUTCOME'],
    [504, 'JULES_UNKNOWN_OUTCOME'],
  ])(
    'a POST answered %i is never replayed and classifies as %s',
    async (status, code) => {
      server.state.overrides.push((r) =>
        r.method === 'POST' && r.path === '/v1alpha/sessions'
          ? {
              status,
              body: { error: { code: status, message: `scripted ${status}` } },
            }
          : undefined
      );
      const outcome = await createOutcome();
      expect(outcome).toEqual({ ok: false, code, phase: 'after-dispatch' });
      expect(server.paths()).toEqual([SOURCE_GET, CREATE_POST]);
      expect(server.postCount).toBe(1);
    }
  );

  it('a failure before the POST is a pre-dispatch rejection', async () => {
    server.state.overrides.push((r) =>
      r.method === 'GET' ? { status: 503, body: {} } : undefined
    );
    const outcome = await createOutcome();
    expect(outcome).toEqual({
      ok: false,
      code: 'JULES_SERVICE_UNAVAILABLE',
      phase: 'pre-dispatch',
    });
    expect(server.postCount).toBe(0);
  });

  it('a missing source is JULES_SOURCE_ACCESS before any POST', async () => {
    server.state.sources = [];
    const outcome = await createOutcome();
    expect(outcome).toEqual({
      ok: false,
      code: 'JULES_SOURCE_ACCESS',
      phase: 'pre-dispatch',
    });
    expect(server.postCount).toBe(0);
  });

  it('a lost 2xx (connection dropped after the POST) is JULES_UNKNOWN_OUTCOME', async () => {
    server.state.overrides.push((r) =>
      r.method === 'POST' ? { lost: true } : undefined
    );
    const outcome = await createOutcome();
    expect(outcome).toEqual({
      ok: false,
      code: 'JULES_UNKNOWN_OUTCOME',
      phase: 'after-dispatch',
    });
    expect(server.postCount).toBe(1);
  });

  it('an invalid 2xx body is JULES_UNKNOWN_OUTCOME', async () => {
    server.state.overrides.push((r) =>
      r.method === 'POST' ? { status: 200, rawBody: '{not json' } : undefined
    );
    const outcome = await createOutcome();
    expect(outcome).toEqual({
      ok: false,
      code: 'JULES_UNKNOWN_OUTCOME',
      phase: 'after-dispatch',
    });
    expect(server.postCount).toBe(1);
  });

  it('a post-create cache (storage upsert) failure is JULES_UNKNOWN_OUTCOME, not a retry', async () => {
    const client = newClient();
    (client.storage as unknown as { upsert: () => Promise<void> }).upsert =
      async () => {
        throw new Error('storage full');
      };
    let code: string | undefined;
    try {
      await client.session(CREATE);
    } catch (err) {
      code = classifyAdapterError(
        sdk,
        err,
        dispatched ? 'after-dispatch' : 'pre-dispatch'
      ).code;
    }
    expect(code).toBe('JULES_UNKNOWN_OUTCOME');
    expect(server.postCount).toBe(1);
  });
});

describe('redirects never forward the credential (network guard)', () => {
  it('a cross-origin 302 on the create POST is refused and the target never contacted', async () => {
    server.state.overrides.push((r) =>
      r.method === 'POST'
        ? {
            status: 302,
            headers: { location: `${secondOrigin}/v1alpha/sessions` },
          }
        : undefined
    );
    const outcome = await createOutcome();
    expect(outcome).toEqual({
      ok: false,
      code: 'JULES_UNKNOWN_OUTCOME',
      phase: 'after-dispatch',
    });
    expect(second.log).toEqual([]);
    expect(server.postCount).toBe(1);
  });

  it('a cross-origin 302 on a read is refused as a pre-dispatch service error', async () => {
    const adapter = JulesSdkAdapter.connect({
      sdk,
      dataDir,
      apiKey: API_KEY,
      baseUrl,
    });
    server.state.overrides.push((r) =>
      r.method === 'GET'
        ? {
            status: 302,
            headers: { location: `${secondOrigin}/v1alpha/sessions/x` },
          }
        : undefined
    );
    let kind: string | undefined;
    try {
      await adapter.getSession('sessions/x');
    } catch (err) {
      kind = (err as AdapterError).kind;
    }
    await adapter.close();
    expect(kind).toBe('network');
    expect(second.log).toEqual([]);
  });

  it('the guard refuses any origin other than the pinned one before sending', async () => {
    await expect(fetch(`${secondOrigin}/v1alpha/sessions`)).rejects.toThrow(
      /fetch guard/
    );
    expect(second.log).toEqual([]);
  });

  const hasOpenssl = (() => {
    try {
      execFileSync('openssl', ['version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!hasOpenssl)(
    'an HTTPS-to-HTTP downgrade 302 never reaches the plain-HTTP target (child process, test-only CA)',
    async () => {
      const certDir = fs.mkdtempSync(path.join(root, 'cert-'));
      const key = path.join(certDir, 'key.pem');
      const cert = path.join(certDir, 'cert.pem');
      execFileSync(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-keyout',
          key,
          '-out',
          cert,
          '-days',
          '1',
          '-subj',
          '/CN=127.0.0.1',
          '-addext',
          'subjectAltName=IP:127.0.0.1',
        ],
        { stdio: 'ignore' }
      );
      const tlsServer = new FakeJulesServer({
        key: fs.readFileSync(key, 'utf8'),
        cert: fs.readFileSync(cert, 'utf8'),
      });
      const { baseUrl: httpsBase } = await tlsServer.start();
      tlsServer.state.overrides.push((r) =>
        r.method === 'POST'
          ? {
              status: 302,
              headers: { location: `${secondOrigin}/v1alpha/sessions` },
            }
          : undefined
      );
      const built = buildPlugin({ withWorkspaceSdk: false });
      try {
        const stdout = await new Promise<string>((resolve, reject) => {
          execFile(
            process.execPath,
            [
              path.join(__dirname, 'fixtures', 'create-through-guard.mjs'),
              path.join(built.pluginRoot, 'dist'),
              sdkEntry,
              httpsBase,
            ],
            {
              env: {
                PATH: traps.pathValue,
                HOME: path.join(root, 'home'),
                NODE_EXTRA_CA_CERTS: cert,
                NODE_DISABLE_COMPILE_CACHE: '1',
              },
              cwd: path.join(root, 'tmp'),
              timeout: 60_000,
            },
            (error, out, err) =>
              error
                ? reject(new Error(`${error.message}\n${err}`))
                : resolve(out)
          );
        });
        expect(JSON.parse(stdout)).toEqual({
          ok: false,
          dispatched: true,
          code: 'JULES_UNKNOWN_OUTCOME',
        });
        expect(tlsServer.paths()).toEqual([SOURCE_GET, CREATE_POST]);
        expect(tlsServer.log.every((r) => r.apiKeyPresent)).toBe(true);
        expect(second.log).toEqual([]);
      } finally {
        await tlsServer.stop();
        fs.rmSync(built.root, { recursive: true, force: true });
      }
    },
    90_000
  );
});

describe('reads through the shipped adapter (R9, R15, R18, R10)', () => {
  it('asserts the injected storage bindings and leaves sdk-scratch empty', async () => {
    const adapter = JulesSdkAdapter.connect({
      sdk,
      dataDir,
      apiKey: API_KEY,
      baseUrl,
    });
    expect(process.env['JULES_HOME']).toBe(resolveSdkScratchDir(dataDir));
    server.state.sessions.set('s1', restSession('s1'));
    await adapter.getSession('sessions/s1');
    await adapter.close();
    expect(process.env['JULES_HOME']).toBeUndefined();
    expect(fs.readdirSync(resolveSdkScratchDir(dataDir))).toEqual([]);
  });

  it('a sessions page never primes the cache: getSession issues its own network read', async () => {
    server.state.sessions.set('s1', restSession('s1', { state: 'COMPLETED' }));
    const adapter = JulesSdkAdapter.connect({
      sdk,
      dataDir,
      apiKey: API_KEY,
      baseUrl,
    });
    const page = await adapter.listSessions({ pageSize: 10 });
    const session = await adapter.getSession('sessions/s1');
    await adapter.close();
    expect(page.sessions.map((s) => s.sessionResource)).toEqual([
      'sessions/s1',
    ]);
    expect(session.vendorState).toBe('completed');
    expect(server.paths()).toEqual([
      'GET /v1alpha/sessions',
      'GET /v1alpha/sessions/s1',
    ]);
    expect(server.log[0]?.query).toEqual({ pageSize: '10' });
  });

  it('an unknown REST state maps to unspecified (needs-inspection), never a known state', async () => {
    server.state.sessions.set(
      's1',
      restSession('s1', { state: 'SOMETHING_NEW' })
    );
    const adapter = JulesSdkAdapter.connect({
      sdk,
      dataDir,
      apiKey: API_KEY,
      baseUrl,
    });
    const session = await adapter.getSession('sessions/s1');
    await adapter.close();
    expect(session.vendorState).toBe('unspecified');
  });

  it('paginates activities, dedups a repeated id, and tracks the newest pending plan', async () => {
    const plan = (id: string, t: string) =>
      restActivity('s1', `act-${id}`, t, {
        planGenerated: {
          plan: {
            id,
            createTime: t,
            steps: [{ id: 'step-1', title: 'Inspect', index: 0 }],
          },
        },
      });
    const a1 = plan('plan-1', '2026-09-10T00:00:01Z');
    const a2 = restActivity('s1', 'act-2', '2026-09-10T00:00:02Z', {
      agentMessaged: { agentMessage: 'hello' },
    });
    const a3 = plan('plan-2', '2026-09-10T00:00:03Z');
    server.state.overrides.push((r) =>
      r.path === '/v1alpha/sessions/s1/activities'
        ? r.query['pageToken'] === 'page-2'
          ? { body: { activities: [a2, a3] } }
          : { body: { activities: [a1, a2], nextPageToken: 'page-2' } }
        : undefined
    );
    const adapter = JulesSdkAdapter.connect({
      sdk,
      dataDir,
      apiKey: API_KEY,
      baseUrl,
    });
    const clock = new FakeClock();
    const walk = await walkActivities({
      adapter,
      sessionResource: 'sessions/s1',
      pageSize: 50,
      start: { kind: 'session-start' },
      clock,
      deadline: { expiresAt: clock.now() + 60_000 },
    });
    await adapter.close();
    expect(walk).toMatchObject({
      pages: 2,
      processed: 4,
      complete: true,
      partialPagination: false,
    });
    expect(walk.newIds).toEqual(['act-plan-1', 'act-2', 'act-plan-2']);
    expect(walk.pendingPlan?.planId).toBe('plan-2');
    expect(server.paths()).toEqual([
      'GET /v1alpha/sessions/s1/activities',
      'GET /v1alpha/sessions/s1/activities',
    ]);
    expect(server.log.map((r) => r.query['pageToken'])).toEqual([
      undefined,
      'page-2',
    ]);
  });

  it('a filtered 400 is retried exactly once unfiltered', async () => {
    server.state.rejectFilteredActivities = true;
    server.state.activities.set('s1', [
      restActivity('s1', 'act-1', '2026-09-10T00:10:00Z'),
    ]);
    const adapter = JulesSdkAdapter.connect({
      sdk,
      dataDir,
      apiKey: API_KEY,
      baseUrl,
    });
    const clock = new FakeClock();
    const walk = await walkActivities({
      adapter,
      sessionResource: 'sessions/s1',
      pageSize: 50,
      start: {
        kind: 'watermark',
        createTime: '2026-09-10T00:00:00Z',
        activityId: 'act-0',
      },
      clock,
      deadline: { expiresAt: clock.now() + 60_000 },
    });
    await adapter.close();
    expect(walk.filterRetried).toBe(true);
    expect(walk.complete).toBe(true);
    expect(server.log.map((r) => r.query['filter'])).toEqual([
      'create_time>"2026-09-09T23:55:00.000Z"',
      undefined,
    ]);
  });

  it('terminal outputs: patch, PR, and no patch map through; an unknown artifact stops the walk', async () => {
    const base = 'b'.repeat(40);
    server.state.sessions.set(
      's1',
      restSession('s1', {
        state: 'COMPLETED',
        outputs: [
          {
            changeSet: {
              source: 'sources/github/octo/repo',
              gitPatch: {
                unidiffPatch: 'diff --git a/x b/x\n',
                baseCommitId: base,
                suggestedCommitMessage: 'm',
              },
            },
          },
          {
            pullRequest: {
              url: 'https://github.com/octo/repo/pull/3',
              title: 'T',
              description: 'D',
            },
          },
        ],
      })
    );
    server.state.sessions.set(
      's2',
      restSession('s2', { state: 'COMPLETED', outputs: [] })
    );
    server.state.activities.set('s1', [
      restActivity('s1', 'act-1', '2026-09-10T00:00:01Z', {
        progressUpdated: { title: 't', description: 'd' },
        artifacts: [{ somethingNew: {} }],
      }),
    ]);
    const adapter = JulesSdkAdapter.connect({
      sdk,
      dataDir,
      apiKey: API_KEY,
      baseUrl,
    });
    const s1 = await adapter.getSession('sessions/s1');
    const s2 = await adapter.getSession('sessions/s2');
    const page = await adapter.listActivities('sessions/s1', { pageSize: 10 });
    await adapter.close();
    expect(s1.outputs).toEqual([
      {
        type: 'changeSet',
        source: 'sources/github/octo/repo',
        unidiffPatch: 'diff --git a/x b/x\n',
        baseCommitId: base,
        suggestedCommitMessage: 'm',
      },
      {
        type: 'pullRequest',
        url: 'https://github.com/octo/repo/pull/3',
        title: 'T',
        description: 'D',
      },
    ]);
    expect(s2.outputs).toEqual([]);
    expect(page).toEqual({ activities: [], unmappedActivity: true });
  });

  it('an unknown output type outside a walk is JULES_MALFORMED_RESPONSE', async () => {
    server.state.sessions.set(
      's1',
      restSession('s1', { outputs: [{ mystery: {} }] })
    );
    const adapter = JulesSdkAdapter.connect({
      sdk,
      dataDir,
      apiKey: API_KEY,
      baseUrl,
    });
    let code: string | undefined;
    try {
      await adapter.getSession('sessions/s1');
    } catch (err) {
      code = classifyAdapterError(sdk, err, 'read').code;
    }
    await adapter.close();
    expect(code).toBe('JULES_MALFORMED_RESPONSE');
  });
});

describe('review regressions through the real SDK', () => {
  it('a failed getSession is re-sent by the bounded read retry, not answered from a cache', async () => {
    server.state.sessions.set('s1', restSession('s1'));
    let failures = 1;
    server.state.overrides.push((r) =>
      r.path === '/v1alpha/sessions/s1' && failures-- > 0
        ? { status: 503, body: {} }
        : undefined
    );
    const adapter = JulesSdkAdapter.connect({
      sdk,
      dataDir,
      apiKey: API_KEY,
      baseUrl,
    });
    const clock = new FakeClock();
    const session = await withReadRetry(
      () => adapter.getSession('sessions/s1'),
      {
        clock,
        deadline: { expiresAt: clock.now() + 60_000 },
      }
    );
    await adapter.close();
    expect(session.sessionResource).toBe('sessions/s1');
    expect(server.paths()).toEqual([
      'GET /v1alpha/sessions/s1',
      'GET /v1alpha/sessions/s1',
    ]);
  });

  it('an activity id outside the allowlist stops the page as unmappedActivity', async () => {
    server.state.activities.set('s1', [
      restActivity('s1', 'bad id', '2026-09-10T00:00:01Z'),
    ]);
    const adapter = JulesSdkAdapter.connect({
      sdk,
      dataDir,
      apiKey: API_KEY,
      baseUrl,
    });
    const page = await adapter.listActivities('sessions/s1', { pageSize: 10 });
    await adapter.close();
    expect(page).toEqual({ activities: [], unmappedActivity: true });
  });

  it('a page token outside the allowlist is never followed or returned', async () => {
    server.state.overrides.push((r) =>
      r.path === '/v1alpha/sessions/s1/activities'
        ? {
            body: {
              activities: [restActivity('s1', 'act-1', '2026-09-10T00:00:01Z')],
              nextPageToken: '../../x',
            },
          }
        : undefined
    );
    const adapter = JulesSdkAdapter.connect({
      sdk,
      dataDir,
      apiKey: API_KEY,
      baseUrl,
    });
    const page = await adapter.listActivities('sessions/s1', { pageSize: 10 });
    await adapter.close();
    expect(page.unmappedActivity).toBe(true);
    expect(page.nextPageToken).toBeUndefined();
    expect(page.activities).toHaveLength(1);
  });

  it('the sources probe reads at most two pages even when no source maps', async () => {
    server.state.sources = Array.from({ length: 45 }, (_, i) => ({
      owner: 'bad_owner',
      repo: `r${i}`,
    }));
    const adapter = JulesSdkAdapter.connect({
      sdk,
      dataDir,
      apiKey: API_KEY,
      baseUrl,
    });
    const page = await adapter.listSources({ pageSize: 20 });
    await adapter.close();
    expect(page.truncated).toBe(true);
    expect(page.sources).toEqual([]);
    expect(page.unsupportedReason).toBeDefined();
    expect(
      server.log.filter((r) => r.path === '/v1alpha/sources').length
    ).toBeLessThanOrEqual(2);
  });
});

describe('isolation (R15, R51)', () => {
  it('nothing was written under HOME, XDG_*, TMPDIR, cwd, or sdk-scratch', () => {
    const newer = (dir: string): string[] =>
      execFileSync('find', [dir, '-newer', marker, '-type', 'f'], {
        encoding: 'utf8',
      })
        .split('\n')
        .filter(Boolean)
        // The HTTPS scenario's own certificate and its built plugin live under TMPDIR's sibling cert dir, not here.
        .filter((f) => !f.includes(`${path.sep}cert-`));
    for (const name of ['home', 'xdg-data', 'xdg-config', 'xdg-cache', 'tmp']) {
      expect(newer(path.join(root, name))).toEqual([]);
    }
    expect(newer(resolveSdkScratchDir(dataDir))).toEqual([]);
    expect(fs.existsSync(path.join(process.cwd(), '.jules'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'home', '.jules'))).toBe(false);
  });

  it('every contacted origin was loopback', () => {
    expect(contactedOrigins.size).toBeGreaterThan(0);
    for (const origin of contactedOrigins)
      expect(new URL(origin).hostname).toBe('127.0.0.1');
  });

  it('no trapped tool was invoked', () => {
    expect(traps.entries()).toEqual([]);
  });
});
