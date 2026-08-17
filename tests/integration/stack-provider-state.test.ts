/**
 * Deterministic fixture tests for the stacked-PR provider state model.
 *
 * `/stack:status` and `/stack:select` are markdown and cannot be
 * fixture-tested. Every classification rule and switch precondition
 * therefore lives in plugins/yellow-core/lib/stack-provider-state.js, and
 * this suite is what actually verifies the seven-state enum — asserting
 * that the command markdown *mentions* seven states would be a check of
 * the prose, not of the behaviour.
 *
 * Fixtures are sanitized `claude plugin list --json` snapshots; see
 * fixtures/stack-provider/README.md.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { describe, it, expect } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const provider = require('../../plugins/yellow-core/lib/stack-provider-state.js');

const {
  STATES,
  PROVIDERS,
  PROVIDER_GROUP,
  parseIntent,
  classifyProviderState,
  planProviderSwitch,
  summarizeSwitchOutcome,
} = provider;

const FIXTURE_DIR = join(__dirname, 'fixtures', 'stack-provider');
const PROJECT_PATH = '/fixture/projects/yellow-plugins';

function fixture(name: string): unknown[] {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.json`), 'utf8'));
}

describe('provider table', () => {
  it('declares exactly the two stacked-pr providers', () => {
    expect(PROVIDER_GROUP).toBe('stacked-pr');
    expect(PROVIDERS.map((p: { id: string }) => p.id)).toEqual(['graphite', 'github']);
    expect(PROVIDERS.map((p: { plugin: string }) => p.plugin)).toEqual([
      'gt-workflow',
      'github-workflow',
    ]);
  });
});

describe('parseIntent', () => {
  it('reads a bare provider value', () => {
    expect(parseIntent('provider: github\n')).toBe('github');
  });

  it('reads quoted values and ignores trailing comments', () => {
    expect(parseIntent('provider: "graphite"\n')).toBe('graphite');
    expect(parseIntent("provider: 'github'\n")).toBe('github');
    expect(parseIntent('provider: github # chosen 2026-08\n')).toBe('github');
  });

  it('treats an absent, empty, or unrelated file as no intent', () => {
    expect(parseIntent(null)).toBeNull();
    expect(parseIntent('')).toBeNull();
    expect(parseIntent('# nothing here\nother: value\n')).toBeNull();
    expect(parseIntent('provider:\n')).toBeNull();
  });

  it('does not read the value off the following line', () => {
    // `\s*` would match the newline and silently adopt "github" here; the
    // pattern uses `[ \t]*` precisely to prevent that.
    expect(parseIntent('provider:\ngithub\n')).toBeNull();
  });
});

describe('classifyProviderState — the seven states', () => {
  it('case 1: neither provider installed => UNSELECTED', () => {
    const result = classifyProviderState({
      plugins: fixture('neither-installed'),
      projectPath: PROJECT_PATH,
    });
    expect(result.state).toBe(STATES.UNSELECTED);
    expect(result.providers.graphite.installed).toBe(false);
    expect(result.providers.github.installed).toBe(false);
    expect(result.detail).toContain('No stacked-PR provider is installed');
  });

  it('case 2: both installed, Graphite enabled => READY_GRAPHITE', () => {
    const result = classifyProviderState({
      plugins: fixture('both-installed-graphite-enabled'),
      tooling: { graphite: true },
      projectPath: PROJECT_PATH,
    });
    expect(result.state).toBe(STATES.READY_GRAPHITE);
    expect(result.providers.github.installed).toBe(true);
    expect(result.providers.github.enabled).toBe(false);
    expect(result.toolingKnown).toBe(true);
  });

  it('case 3: both installed, GitHub enabled => READY_GITHUB', () => {
    const result = classifyProviderState({
      plugins: fixture('both-installed-github-enabled'),
      tooling: { github: true },
      projectPath: PROJECT_PATH,
    });
    expect(result.state).toBe(STATES.READY_GITHUB);
    expect(result.providers.graphite.installed).toBe(true);
    expect(result.providers.graphite.enabled).toBe(false);
  });

  it('case 4: both enabled => CONFLICT', () => {
    const result = classifyProviderState({
      plugins: fixture('both-enabled'),
      projectPath: PROJECT_PATH,
    });
    expect(result.state).toBe(STATES.CONFLICT);
    expect(result.detail).toContain('More than one stacked-PR provider is enabled');
  });

  it('case 5: installed but no provider enabled, no intent => UNSELECTED', () => {
    const result = classifyProviderState({
      plugins: fixture('none-enabled'),
      projectPath: PROJECT_PATH,
    });
    expect(result.state).toBe(STATES.UNSELECTED);
    // Distinct from case 1 on the same state: both are installed here, and
    // the detail says so rather than claiming nothing is installed.
    expect(result.providers.graphite.installed).toBe(true);
    expect(result.providers.github.installed).toBe(true);
    expect(result.detail).toContain('Installed but not enabled');
  });

  it('case 6a: repository intent mismatches the enabled provider => CONFIG_MISMATCH', () => {
    const result = classifyProviderState({
      plugins: fixture('both-installed-graphite-enabled'),
      intent: 'github',
      projectPath: PROJECT_PATH,
    });
    expect(result.state).toBe(STATES.CONFIG_MISMATCH);
    expect(result.detail).toContain('"github"');
    expect(result.detail).toContain('gt-workflow');
  });

  it('case 6b: intent recorded but nothing enabled => CONFIG_MISMATCH, not UNSELECTED', () => {
    const result = classifyProviderState({
      plugins: fixture('none-enabled'),
      intent: 'graphite',
      projectPath: PROJECT_PATH,
    });
    expect(result.state).toBe(STATES.CONFIG_MISMATCH);
  });

  it('case 6c: intent naming an unknown provider => CONFIG_MISMATCH with intentKnown false', () => {
    const result = classifyProviderState({
      plugins: fixture('both-installed-graphite-enabled'),
      intent: 'phabricator',
      projectPath: PROJECT_PATH,
    });
    expect(result.state).toBe(STATES.CONFIG_MISMATCH);
    expect(result.intentKnown).toBe(false);
  });

  it('case 7: a managed-scope provider outranks CONFLICT => MANAGED_CONFLICT', () => {
    const result = classifyProviderState({
      plugins: fixture('managed-conflict'),
      projectPath: PROJECT_PATH,
    });
    expect(result.state).toBe(STATES.MANAGED_CONFLICT);
    expect(result.detail).toContain('managed scope');
  });

  it('case 7b: intent unreachable because the other provider is managed => MANAGED_CONFLICT', () => {
    const result = classifyProviderState({
      plugins: fixture('managed-conflict'),
      intent: 'graphite',
      projectPath: PROJECT_PATH,
    });
    expect(result.state).toBe(STATES.MANAGED_CONFLICT);
  });

  it('PARTIAL_TOOLING: right provider enabled, its CLI probed as missing', () => {
    const result = classifyProviderState({
      plugins: fixture('both-installed-graphite-enabled'),
      intent: 'graphite',
      tooling: { graphite: false },
      projectPath: PROJECT_PATH,
    });
    expect(result.state).toBe(STATES.PARTIAL_TOOLING);
  });

  it('an unrun tooling probe does NOT become PARTIAL_TOOLING, but is reported as unknown', () => {
    const result = classifyProviderState({
      plugins: fixture('both-installed-graphite-enabled'),
      projectPath: PROJECT_PATH,
    });
    expect(result.state).toBe(STATES.READY_GRAPHITE);
    expect(result.toolingKnown).toBe(false);
  });

  it('filters project-scope rows belonging to a different repository', () => {
    // Without filtering, another repo's enabled github-workflow row would
    // read as a second enabled provider here and report CONFLICT.
    const filtered = classifyProviderState({
      plugins: fixture('foreign-project-scope'),
      projectPath: PROJECT_PATH,
    });
    expect(filtered.state).toBe(STATES.READY_GRAPHITE);
    expect(filtered.projectScopeFiltered).toBe(true);

    const unfiltered = classifyProviderState({ plugins: fixture('foreign-project-scope') });
    expect(unfiltered.state).toBe(STATES.CONFLICT);
    expect(unfiltered.projectScopeFiltered).toBe(false);
  });
});

describe('planProviderSwitch — preview only, never executed', () => {
  it('case 9: returns the exact ordered command plan without running anything', () => {
    const plan = planProviderSwitch({
      plugins: fixture('both-installed-graphite-enabled'),
      target: 'github',
      scope: 'user',
      projectPath: PROJECT_PATH,
    });
    expect(plan.status).toBe('ok');
    expect(plan.steps.map((s: { command: string }) => s.command)).toEqual([
      'claude plugin enable github-workflow@yellow-plugins --scope user',
      'claude plugin disable gt-workflow@yellow-plugins --scope user',
    ]);
    // Every step carries --scope explicitly: enable/disable default to
    // auto-detect, which would pick a scope the user never asked for.
    for (const step of plan.steps) {
      expect(step.command).toContain('--scope user');
    }
    expect(plan.reloadHint).toBe('/reload-plugins');
  });

  it('adds a confirmation-gated install step when the target is not installed', () => {
    const plan = planProviderSwitch({
      plugins: fixture('neither-installed'),
      target: 'github',
      scope: 'project',
      projectPath: PROJECT_PATH,
    });
    expect(plan.status).toBe('ok');
    expect(plan.steps[0].action).toBe('install');
    expect(plan.steps[0].requiresConfirmation).toBe(true);
    expect(plan.steps[0].command).toBe(
      'claude plugin install github-workflow@yellow-plugins --scope project'
    );
    expect(plan.steps[1].action).toBe('enable');
    // Nothing to disable — the other provider is not enabled anywhere.
    expect(plan.steps.some((s: { action: string }) => s.action === 'disable')).toBe(false);
  });

  it('disables the other provider at every writable scope where it is enabled', () => {
    const plugins = [
      ...fixture('both-installed-github-enabled'),
      {
        id: 'gt-workflow@yellow-plugins',
        version: '1.6.2',
        scope: 'local',
        enabled: true,
        installPath: '/fixture/.claude/plugins/cache/yellow-plugins/gt-workflow/1.6.2',
        installedAt: '2026-01-01T00:00:00.000Z',
        lastUpdated: '2026-01-01T00:00:00.000Z',
        projectPath: PROJECT_PATH,
      },
    ];
    const plan = planProviderSwitch({
      plugins,
      target: 'github',
      scope: 'user',
      projectPath: PROJECT_PATH,
    });
    expect(plan.status).toBe('ok');
    expect(
      plan.steps
        .filter((s: { action: string }) => s.action === 'disable')
        .map((s: { command: string }) => s.command)
    ).toEqual(['claude plugin disable gt-workflow@yellow-plugins --scope local']);
  });

  it('case 7 (switch side): refuses a managed conflict and emits NO steps', () => {
    const plan = planProviderSwitch({
      plugins: fixture('managed-conflict'),
      target: 'graphite',
      scope: 'user',
      projectPath: PROJECT_PATH,
    });
    expect(plan.status).toBe('refused');
    expect(plan.reason).toBe('managed-conflict');
    // Fail closed: a partial plan would invite exactly the half-switched
    // state the model exists to prevent.
    expect(plan.steps).toEqual([]);
    expect(plan.detail).toContain('github-workflow');
  });

  it('refuses to enable a provider force-disabled at managed scope', () => {
    const plugins = [
      {
        id: 'github-workflow@yellow-plugins',
        version: '0.1.0',
        scope: 'managed',
        enabled: false,
        installPath: '/fixture/managed/plugins/github-workflow/0.1.0',
        installedAt: '2026-01-01T00:00:00.000Z',
        lastUpdated: '2026-01-01T00:00:00.000Z',
      },
    ];
    const plan = planProviderSwitch({
      plugins,
      target: 'github',
      scope: 'user',
      projectPath: PROJECT_PATH,
    });
    expect(plan.status).toBe('refused');
    expect(plan.reason).toBe('managed-conflict');
    expect(plan.steps).toEqual([]);
  });

  it('refuses an unknown provider and an unwritable scope without guessing', () => {
    const unknown = planProviderSwitch({
      plugins: fixture('none-enabled'),
      target: 'phabricator',
      projectPath: PROJECT_PATH,
    });
    expect(unknown.status).toBe('refused');
    expect(unknown.reason).toBe('unknown-provider');
    expect(unknown.steps).toEqual([]);

    const managedScope = planProviderSwitch({
      plugins: fixture('none-enabled'),
      target: 'github',
      scope: 'managed',
      projectPath: PROJECT_PATH,
    });
    expect(managedScope.status).toBe('refused');
    expect(managedScope.reason).toBe('invalid-scope');
    expect(managedScope.steps).toEqual([]);
  });
});

describe('summarizeSwitchOutcome — case 8: enable/disable command failure', () => {
  const plan = planProviderSwitch({
    plugins: fixture('both-installed-graphite-enabled'),
    target: 'github',
    scope: 'user',
    projectPath: PROJECT_PATH,
  });

  it('reports success only when every step succeeded', () => {
    const outcome = summarizeSwitchOutcome(plan, [{ ok: true }, { ok: true }]);
    expect(outcome.status).toBe('applied');
    expect(outcome.notRun).toEqual([]);
    expect(outcome.message).toContain('/reload-plugins');
  });

  it('aborts at the first failure and reports the remaining steps as NOT RUN', () => {
    const outcome = summarizeSwitchOutcome(plan, [{ ok: false, exitCode: 1 }, { ok: true }]);
    expect(outcome.status).toBe('failed');
    expect(outcome.failedStep.action).toBe('enable');
    expect(outcome.notRun.map((s: { action: string }) => s.action)).toEqual(['disable']);
    // No silent fallback: the message must say the other provider was not
    // substituted in.
    expect(outcome.message).toContain('no other provider was enabled in its place');
  });

  it('reports an unknown end state when fewer results than steps came back', () => {
    const outcome = summarizeSwitchOutcome(plan, [{ ok: true }]);
    expect(outcome.status).toBe('incomplete');
    expect(outcome.message).toContain('Provider state is unknown');
  });
});
