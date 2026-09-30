import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdapterError, throwAppError } from '../src/errors.js';
import { setup } from '../src/runtime.js';
import type { SdkProbe } from '../src/sdk-resolver.js';

import { FakeSdkAdapter, makeDeps } from './fake-sdk.js';
import { codeOfAsync } from './support/app-error.js';

vi.setConfig({ testTimeout: 30_000 });

let dataDir: string;
let fake: FakeSdkAdapter;

beforeEach(async () => {
  dataDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'yellow-jules-setup-')
  );
  fake = new FakeSdkAdapter();
});

afterEach(async () => {
  await fs.promises.rm(dataDir, { recursive: true, force: true });
});

const DATA_DIR_PROBE: SdkProbe = {
  resolution: 'data-dir',
  sdkVersion: '0.2.0',
  sdkIntegrity: 'sha512-abc',
  sdkEntrySha256: 'e'.repeat(64),
  entryPath: '/x',
};

describe('setup', () => {
  it('reports credential absence without contacting the vendor', async () => {
    const deps = makeDeps(dataDir, fake, { env: {} });
    const result = await setup(deps, { installSdk: false });
    expect(result).toMatchObject({
      credentialSource: 'none',
      sdkResolution: 'workspace',
      sourcesReachable: {
        supported: false,
        reason: 'JULES_API_KEY is not set',
      },
      requiresAttention: true,
    });
    expect(result.attention).toEqual(['credentialSource', 'sourcesReachable']);
    expect(fake.calls).toEqual([]);
  });

  it('never echoes the credential value', async () => {
    const result = await setup(makeDeps(dataDir, fake), { installSdk: false });
    expect(JSON.stringify(result)).not.toContain('dummy-test-key');
    expect(result.credentialSource).toBe('env');
  });

  it('reports a missing SDK without contacting the vendor', async () => {
    const deps = makeDeps(dataDir, fake, {
      probeSdk: () => ({ resolution: 'missing' }),
    });
    const result = await setup(deps, { installSdk: false });
    expect(result).toMatchObject({
      sdkResolution: 'missing',
      sourcesReachable: {
        supported: false,
        reason: 'the Jules SDK is not installed',
      },
    });
    expect(result.attention).toEqual(['sdkResolution', 'sourcesReachable']);
    expect(fake.calls).toEqual([]);
  });

  it('reports the data-dir install with both integrity fields', async () => {
    const result = await setup(
      makeDeps(dataDir, fake, { probeSdk: () => DATA_DIR_PROBE }),
      { installSdk: false }
    );
    expect(result).toMatchObject({
      sdkResolution: 'data-dir',
      sdkIntegrity: 'sha512-abc',
      sdkEntrySha256: 'e'.repeat(64),
    });
  });

  it('installs only when --install-sdk is passed', async () => {
    const installSdk = vi.fn(async () => DATA_DIR_PROBE);
    const deps = makeDeps(dataDir, fake, { installSdk });
    await setup(deps, { installSdk: false });
    expect(installSdk).not.toHaveBeenCalled();
    const result = await setup(deps, { installSdk: true });
    expect(installSdk).toHaveBeenCalledOnce();
    expect(result.installed).toBe(true);
  });

  it('an integrity failure is an error envelope, never "missing"', async () => {
    const deps = makeDeps(dataDir, fake, {
      probeSdk: () =>
        throwAppError('JULES_SDK_INTEGRITY', 'entry sha mismatch'),
    });
    await expect(
      codeOfAsync(() => setup(deps, { installSdk: false }))
    ).resolves.toBe('JULES_SDK_INTEGRITY');
  });

  it('probes one page of 20 sources and reports truncation', async () => {
    fake.sources = Array.from({ length: 25 }, (_, i) => ({
      sourceResource: `sources/github/acme/r${i}`,
      owner: 'acme',
      repo: `r${i}`,
    }));
    const result = await setup(makeDeps(dataDir, fake), { installSdk: false });
    expect(fake.callsTo('listSources')[0]?.args[0]).toEqual({ pageSize: 20 });
    expect(result.sourcesReachable).toEqual({
      supported: true,
      value: { count: 20, truncated: true },
    });
    expect(result.requiresAttention).toBeUndefined();
  });

  it('degrades a non-GitHub source to supported: false instead of failing', async () => {
    fake.listSourcesImpl = async () => ({
      sources: [],
      truncated: false,
      unsupportedReason: 'not GitHub',
    });
    const result = await setup(makeDeps(dataDir, fake), { installSdk: false });
    expect(result.sourcesReachable).toEqual({
      supported: false,
      reason: 'not GitHub',
    });
    expect(result.attention).toEqual(['sourcesReachable']);
  });

  it('an inaccessible source list (403) is JULES_AUTH_FAILED', async () => {
    fake.listSourcesImpl = async () => {
      throw new AdapterError('auth', 'forbidden', { status: 403 });
    };
    await expect(
      codeOfAsync(() => setup(makeDeps(dataDir, fake), { installSdk: false }))
    ).resolves.toBe('JULES_AUTH_FAILED');
  });

  it('refuses a group-writable data dir before anything else', async () => {
    if (process.platform === 'win32') return;
    fs.chmodSync(dataDir, 0o777);
    await expect(
      codeOfAsync(() => setup(makeDeps(dataDir, fake), { installSdk: false }))
    ).resolves.toBe('JULES_DATA_DIR');
    expect(fake.calls).toEqual([]);
  });
});
