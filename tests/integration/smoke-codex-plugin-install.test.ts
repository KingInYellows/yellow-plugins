import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT = resolve(
  __dirname,
  '../../scripts/smoke-codex-plugin-install.js'
);

function run(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: '',
      CODEX_BIN: '/nonexistent/codex-smoke',
      ...env,
    },
    timeout: 15000,
  });
}

describe('Codex isolated install smoke', () => {
  it('documents the runtime evidence boundary', () => {
    const result = run(['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage:');
    expect(result.stdout).toContain('discovery');
  });

  it('plans exactly the catalog-selected plugins without invoking Codex', () => {
    const result = run(['--dry-run']);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    const root = resolve(__dirname, '../..');
    const catalog = JSON.parse(readFileSync(join(root, 'catalog/catalog.json'), 'utf8'));
    const selected = catalog.pluginOrder.filter((name: string) =>
      JSON.parse(readFileSync(join(root, 'catalog/plugins', name + '.json'), 'utf8')).targets.codex.enabled);
    expect(report.plugins).toEqual(selected);
    expect(report.plugins).not.toContain('yellow-composio');
    expect(report.cliVersion).toBe('0.157.0');
    expect(report.status).toBe('dry-run');
  });

  it.each([
    ['--bad'],
    ['--plugin'],
    ['--plugin', '../yellow-core'],
    ['--plugin', 'yellow-jules'],
  ])('rejects invalid arguments %j', (...args) => {
    expect(run(args).status).toBe(2);
  });

  it('reports a local missing CLI as an explicit skip', () => {
    const result = run([]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).status).toBe('skipped');
  });

  it('fails closed when CI is requested or inherited', () => {
    expect(run(['--ci']).status).toBe(2);
    expect(run([], { CI: 'true' }).status).toBe(2);
  });
});

const scratch = mkdtempSync(join(tmpdir(), 'codex smoke tests '));
const sentinel = join(scratch, 'real-profile-sentinel');
writeFileSync(sentinel, 'unchanged');
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function fakeRun(scenario: string) {
  const fixture = readFileSync(
    resolve(__dirname, '../fixtures/codex-smoke/fake-codex.cjs'),
    'utf8'
  )
    .replace('__SCENARIO__', scenario)
    .replace('__SOURCE_ROOT__', JSON.stringify(resolve(__dirname, '../..')));
  const bin = join(scratch, scenario + '.cjs');
  writeFileSync(bin, fixture, { mode: 0o700 });
  return run(['--plugin', 'yellow-core', '--timeout-ms', '1500'], {
    CODEX_BIN: bin,
    HOME: scratch,
    CODEX_HOME: scratch,
    XDG_CONFIG_HOME: scratch,
    XDG_CACHE_HOME: scratch,
    XDG_DATA_HOME: scratch,
    XDG_STATE_HOME: scratch,
    XDG_RUNTIME_DIR: scratch,
    SMOKE_SECRET: 'synthetic-test-sentinel',
    OPENAI_API_KEY: 'synthetic-test-sentinel',
    HTTPS_PROXY: 'http://127.0.0.1:1',
    NODE_OPTIONS: '--no-warnings',
  });
}

describe('Codex subprocess boundary', () => {
  it('isolates profiles/env and verifies actual discovered paths without a model turn', () => {
    const result = fakeRun('success');
    expect(result.status, result.stderr + result.stdout).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.status).toBe('passed');
    const core = JSON.parse(readFileSync(resolve(__dirname, '../../catalog/plugins/yellow-core.json'), 'utf8'));
    expect(report.loadedSkills).toHaveLength(core.targets.codex.skillAllowlist.length);
    expect(report.runtime.skillInvocation).toBe('not-tested');
    expect(report.runtime.hookExecution).toBe('not-tested');
    expect(report.runtime.mcpConnection).toBe('not-tested');
    expect(existsSync(report.scratch)).toBe(false);
    expect(readFileSync(sentinel, 'utf8')).toBe('unchanged');
    expect(result.stdout).not.toContain('synthetic-test-sentinel');
  });

  it.each([
    ['version', 'Unsupported Codex CLI version'],
    ['install-error', 'CLI command failed'],
    ['malformed-install', 'Malformed CLI JSON'],
    ['escape', 'Path escapes expected root'],
    ['symlink', 'Symlink in expected path'],
    ['bytes', 'Installed skill resource bytes differ'],
    ['resource', 'Unexpected skill resource'],
    ['foreign-user-skill', 'Unexpected non-plugin skill'],
    ['extra-hook', 'Discovered hook inventory mismatch'],
    ['disabled-plugin', 'Installed plugin not enabled/listed'],
    ['missing-skill', 'Missing/duplicate/disabled skill'],
    ['duplicate-skill', 'Missing/duplicate/disabled skill'],
    ['disabled-skill', 'Missing/duplicate/disabled skill'],
    ['extra-skill', 'Unexpected exposed skill'],
    ['warning', 'Discovery reported errors or warnings'],
    ['timeout', 'App-server request timed out'],
    ['server-exit', 'App-server exited before response'],
    ['server-missing', 'App-server failed to start'],
    ['malformed-rpc', 'Malformed app-server JSON'],
    ['rpc-error', 'App-server RPC failed'],
  ])('fails closed and cleans up on %s', (scenario, reason) => {
    const result = fakeRun(scenario);
    expect(result.status, result.stderr + result.stdout).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.status).toBe('failed');
    expect(report.failures.join('\n')).toContain(reason);
    expect(existsSync(report.scratch)).toBe(false);
    expect(readFileSync(sentinel, 'utf8')).toBe('unchanged');
    expect(result.stdout).not.toContain('synthetic-test-sentinel');
  });
});
