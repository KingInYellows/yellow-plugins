/**
 * Deterministic fixture tests for the remote-agent provider state model.
 *
 * `/linear:delegate` is markdown and cannot be fixture-tested directly.
 * Every classification rule for the `remote-agent` capability group
 * (yellow-cursor vs. yellow-devin) therefore lives in
 * plugins/yellow-core/lib/remote-agent-provider-state.js, and this suite is
 * what actually verifies the six-state enum and its precedence.
 *
 * Fixtures are sanitized `claude plugin list --json` snapshots; see
 * fixtures/remote-agent-provider/README.md.
 */

import { execFileSync } from 'child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { describe, it, expect, afterAll } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const provider = require('../../plugins/yellow-core/lib/remote-agent-provider-state.js');

const {
  STATES,
  PROVIDERS,
  PROVIDER_GROUP,
  PREFERRED_PROVIDER_ID,
  summarizeProviders,
  classifyRemoteAgentState,
} = provider;

const FIXTURE_DIR = join(__dirname, 'fixtures', 'remote-agent-provider');
const PROJECT_PATH = '/fixture/projects/yellow-plugins';
const LIB = join(
  __dirname,
  '..',
  '..',
  'plugins',
  'yellow-core',
  'lib',
  'remote-agent-provider-state.js'
);

function fixture(name: string): unknown[] {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.json`), 'utf8'));
}

function runCli(args: string[]): {
  status: number;
  stdout: string;
  stderr: string;
} {
  try {
    const stdout = execFileSync(process.execPath, [LIB, ...args], {
      encoding: 'utf8',
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

describe('provider table', () => {
  it('declares exactly the two remote-agent providers, cursor first (preferred)', () => {
    expect(PROVIDER_GROUP).toBe('remote-agent');
    expect(PROVIDERS.map((p: { id: string }) => p.id)).toEqual([
      'cursor',
      'devin',
    ]);
    expect(PROVIDERS.map((p: { plugin: string }) => p.plugin)).toEqual([
      'yellow-cursor',
      'yellow-devin',
    ]);
    expect(PREFERRED_PROVIDER_ID).toBe('cursor');
  });
});

describe('classifyRemoteAgentState — the six states', () => {
  it('case 1: neither provider installed => UNSELECTED', () => {
    const result = classifyRemoteAgentState({
      plugins: fixture('neither-installed'),
      projectPath: PROJECT_PATH,
    });
    expect(result.state).toBe(STATES.UNSELECTED);
    expect(result.providers.cursor.installed).toBe(false);
    expect(result.providers.devin.installed).toBe(false);
    expect(result.detail).toContain('No remote-agent provider is installed');
    expect(result.detail).toContain('yellow-cursor (preferred)');
  });

  it('case 2: both installed, cursor enabled => READY_CURSOR', () => {
    const result = classifyRemoteAgentState({
      plugins: fixture('both-installed-cursor-enabled'),
      tooling: { cursor: true },
      projectPath: PROJECT_PATH,
    });
    expect(result.state).toBe(STATES.READY_CURSOR);
    expect(result.providers.devin.installed).toBe(true);
    expect(result.providers.devin.enabled).toBe(false);
    expect(result.toolingKnown).toBe(true);
  });

  it('case 3: both installed, devin enabled => READY_DEVIN', () => {
    const result = classifyRemoteAgentState({
      plugins: fixture('both-installed-devin-enabled'),
      tooling: { devin: true },
      projectPath: PROJECT_PATH,
    });
    expect(result.state).toBe(STATES.READY_DEVIN);
    expect(result.providers.cursor.installed).toBe(true);
    expect(result.providers.cursor.enabled).toBe(false);
  });

  it('case 4: both enabled => CONFLICT, with cursor-preferred guidance', () => {
    const result = classifyRemoteAgentState({
      plugins: fixture('both-enabled'),
      projectPath: PROJECT_PATH,
    });
    expect(result.state).toBe(STATES.CONFLICT);
    expect(result.detail).toContain(
      'More than one remote-agent provider is enabled'
    );
    expect(result.detail).toContain('yellow-cursor is the preferred choice');
  });

  it('case 5: installed but neither enabled => UNSELECTED, distinct detail from case 1', () => {
    const result = classifyRemoteAgentState({
      plugins: fixture('none-enabled'),
      projectPath: PROJECT_PATH,
    });
    expect(result.state).toBe(STATES.UNSELECTED);
    expect(result.providers.cursor.installed).toBe(true);
    expect(result.providers.devin.installed).toBe(true);
    expect(result.detail).toContain('Installed but not enabled');
    expect(result.detail).toContain('yellow-cursor (preferred)');
  });

  it('PARTIAL_TOOLING: cursor enabled, its CLI probed as unresolved', () => {
    const result = classifyRemoteAgentState({
      plugins: fixture('both-installed-cursor-enabled'),
      tooling: { cursor: false },
      projectPath: PROJECT_PATH,
    });
    expect(result.state).toBe(STATES.PARTIAL_TOOLING);
  });

  it('PARTIAL_TOOLING: devin enabled, its credential env vars probed as absent', () => {
    const result = classifyRemoteAgentState({
      plugins: fixture('both-installed-devin-enabled'),
      tooling: { devin: false },
      projectPath: PROJECT_PATH,
    });
    expect(result.state).toBe(STATES.PARTIAL_TOOLING);
  });

  it('an unrun tooling probe does NOT become PARTIAL_TOOLING, but is reported as unknown', () => {
    const result = classifyRemoteAgentState({
      plugins: fixture('both-installed-cursor-enabled'),
      projectPath: PROJECT_PATH,
    });
    expect(result.state).toBe(STATES.READY_CURSOR);
    expect(result.toolingKnown).toBe(false);
  });

  it('CONFIG_INVALID: a non-array `plugins` value is classified, not thrown', () => {
    const result = classifyRemoteAgentState({
      plugins: { not: 'an array' },
      projectPath: PROJECT_PATH,
    });
    expect(result.state).toBe(STATES.CONFIG_INVALID);
    expect(result.providers).toEqual({});
    expect(result.toolingKnown).toBeNull();
  });

  it('precedence: CONFIG_INVALID outranks CONFLICT (worst-first, checked before anything else)', () => {
    // A malformed `plugins` value can never even be inspected for conflict,
    // so CONFIG_INVALID must win regardless of what a valid array might have
    // shown — there is nothing else it could be here since `plugins` isn't
    // an array at all.
    const result = classifyRemoteAgentState({ plugins: 'not even an object' });
    expect(result.state).toBe(STATES.CONFIG_INVALID);
  });

  it('precedence: CONFLICT outranks UNSELECTED and PARTIAL_TOOLING', () => {
    const result = classifyRemoteAgentState({
      plugins: fixture('both-enabled'),
      tooling: { cursor: false, devin: false },
      projectPath: PROJECT_PATH,
    });
    expect(result.state).toBe(STATES.CONFLICT);
  });

  it('filters project-scope rows belonging to a different repository', () => {
    // Without filtering, another repo's enabled yellow-devin row would read
    // as a second enabled provider here and report CONFLICT.
    const filtered = classifyRemoteAgentState({
      plugins: fixture('foreign-project-scope'),
      projectPath: PROJECT_PATH,
    });
    expect(filtered.state).toBe(STATES.READY_CURSOR);
    expect(filtered.projectScopeFiltered).toBe(true);

    const unfiltered = classifyRemoteAgentState({
      plugins: fixture('foreign-project-scope'),
    });
    expect(unfiltered.state).toBe(STATES.CONFLICT);
    expect(unfiltered.projectScopeFiltered).toBe(false);
  });
});

describe('summarizeProviders', () => {
  it('folds one row per scope into a single enabled/installed verdict', () => {
    const { providers } = summarizeProviders(
      fixture('both-installed-cursor-enabled'),
      {
        projectPath: PROJECT_PATH,
      }
    );
    expect(providers.cursor.enabled).toBe(true);
    expect(providers.cursor.enabledScopes).toEqual(['user']);
    expect(providers.devin.enabled).toBe(false);
    expect(providers.devin.enabledScopes).toEqual([]);
  });

  it('does not match a same-named plugin published under a different marketplace', () => {
    const plugins = [
      {
        id: 'yellow-cursor@some-other-marketplace',
        version: '0.1.0',
        scope: 'user',
        enabled: true,
        installPath: '/fixture/other/yellow-cursor/0.1.0',
        installedAt: '2026-01-01T00:00:00.000Z',
        lastUpdated: '2026-01-01T00:00:00.000Z',
      },
    ];
    const { providers } = summarizeProviders(plugins, {
      projectPath: PROJECT_PATH,
    });
    expect(providers.cursor.installed).toBe(false);
    expect(providers.cursor.enabled).toBe(false);
  });
});

describe('CLI — classify end to end', () => {
  it('classifies a fixture file to READY_CURSOR', () => {
    const run = runCli([
      'classify',
      '--plugins-file',
      join(FIXTURE_DIR, 'both-installed-cursor-enabled.json'),
      '--project-path',
      PROJECT_PATH,
      '--tooling-cursor',
      'yes',
    ]);
    expect(run.status).toBe(0);
    const parsed = JSON.parse(run.stdout);
    expect(parsed.state).toBe(STATES.READY_CURSOR);
    expect(parsed.toolingKnown).toBe(true);
  });

  it('--tooling-devin unknown means NOT CHECKED, never PARTIAL_TOOLING', () => {
    const run = runCli([
      'classify',
      '--plugins-file',
      join(FIXTURE_DIR, 'both-installed-devin-enabled.json'),
      '--tooling-devin',
      'unknown',
    ]);
    const parsed = JSON.parse(run.stdout);
    expect(parsed.state).toBe(STATES.READY_DEVIN);
    expect(parsed.toolingKnown).toBe(false);
  });

  describe('malformed input, exit-code divergence from stack-provider-state.js', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'remote-agent-provider-cli-'));
    afterAll(() => {
      rmSync(scratch, { recursive: true, force: true });
    });

    it('valid JSON of the wrong shape classifies as CONFIG_INVALID with exit 0', () => {
      const wrongShape = join(scratch, 'wrong-shape.json');
      writeFileSync(wrongShape, JSON.stringify({ not: 'an array' }), 'utf8');
      const run = runCli(['classify', '--plugins-file', wrongShape]);
      expect(run.status).toBe(0);
      const parsed = JSON.parse(run.stdout);
      expect(parsed.state).toBe(STATES.CONFIG_INVALID);
    });

    it('genuinely unparseable JSON text fails the CLI (exit 1) — there is no value to classify', () => {
      const badJson = join(scratch, 'bad-json.txt');
      writeFileSync(badJson, '{not valid json', 'utf8');
      const run = runCli(['classify', '--plugins-file', badJson]);
      expect(run.status).toBe(1);
      expect(run.stderr).toContain('could not parse plugin list as JSON');
    });

    it('a missing --plugins-file path is reported as a missing argument, exit 1', () => {
      const run = runCli([
        'classify',
        '--plugins-file',
        join(scratch, 'does-not-exist.json'),
      ]);
      expect(run.status).toBe(1);
      expect(run.stderr).toContain('--plugins-file is required');
    });
  });
});
