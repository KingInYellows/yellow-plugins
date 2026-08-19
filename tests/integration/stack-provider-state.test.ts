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

import { execFileSync } from 'child_process';
import { readFileSync, mkdtempSync, symlinkSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { describe, it, expect, afterAll } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const provider = require('../../plugins/yellow-core/lib/stack-provider-state.js');

const {
  STATES,
  PROVIDERS,
  PROVIDER_GROUP,
  INTENT_INVALID_REASONS,
  parseIntentText,
  readIntentFile,
  resolveIntent,
  summarizeProviders,
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

describe('parseIntentText — structured result, no I/O', () => {
  it('reads a bare provider value', () => {
    expect(parseIntentText('provider: github\n')).toEqual({
      kind: 'valid',
      provider: 'github',
    });
  });

  it('reads quoted values and ignores trailing comments', () => {
    expect(parseIntentText('provider: "graphite"\n')).toEqual({
      kind: 'valid',
      provider: 'graphite',
    });
    expect(parseIntentText("provider: 'github'\n")).toEqual({
      kind: 'valid',
      provider: 'github',
    });
    expect(parseIntentText('provider: github # chosen 2026-08\n')).toEqual({
      kind: 'valid',
      provider: 'github',
    });
  });

  it('treats an empty or unrelated file as missing-provider-key, not a default', () => {
    expect(parseIntentText('')).toEqual({
      kind: 'invalid',
      reason: INTENT_INVALID_REASONS.MISSING_KEY,
    });
    expect(parseIntentText('# nothing here\nother: value\n')).toEqual({
      kind: 'invalid',
      reason: INTENT_INVALID_REASONS.MISSING_KEY,
    });
  });

  it('treats a present-but-empty value as empty-value, distinct from missing-key', () => {
    expect(parseIntentText('provider:\n')).toEqual({
      kind: 'invalid',
      reason: INTENT_INVALID_REASONS.EMPTY_VALUE,
    });
    expect(parseIntentText('provider: ""\n')).toEqual({
      kind: 'invalid',
      reason: INTENT_INVALID_REASONS.EMPTY_VALUE,
    });
  });

  it('does not read the value off the following line — malformed, not a guess', () => {
    // `\s*` would match the newline and silently adopt "github" here; the
    // pattern uses `[ \t]*` precisely to prevent that. The key line itself
    // (`provider:` with nothing after it) is the same shape as
    // `provider:\n` above: an empty value, not malformed syntax.
    expect(parseIntentText('provider:\ngithub\n')).toEqual({
      kind: 'invalid',
      reason: INTENT_INVALID_REASONS.EMPTY_VALUE,
    });
  });

  it('flags an unknown provider id as invalid, not as a mismatch to resolve downstream', () => {
    expect(parseIntentText('provider: phabricator\n')).toEqual({
      kind: 'invalid',
      reason: INTENT_INVALID_REASONS.UNKNOWN_PROVIDER,
      rawValue: 'phabricator',
    });
  });

  it('flags duplicate provider: keys regardless of whether the values agree', () => {
    expect(
      parseIntentText('provider: github\nprovider: github\n')
    ).toEqual({ kind: 'invalid', reason: INTENT_INVALID_REASONS.DUPLICATE_KEYS });
    expect(
      parseIntentText('provider: github\nprovider: graphite\n')
    ).toEqual({ kind: 'invalid', reason: INTENT_INVALID_REASONS.DUPLICATE_KEYS });
  });

  it('flags an unterminated quote as malformed syntax', () => {
    expect(parseIntentText('provider: "github\n')).toEqual({
      kind: 'invalid',
      reason: INTENT_INVALID_REASONS.MALFORMED_SYNTAX,
    });
  });
});

describe('readIntentFile / resolveIntent — filesystem-level cases', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'yellow-stack-intent-'));
  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('reports absent for a path that does not exist', () => {
    const missing = join(scratch, 'does-not-exist.yml');
    expect(readIntentFile(missing)).toEqual({ kind: 'absent' });
    expect(resolveIntent(missing)).toEqual({
      kind: 'absent',
      provider: null,
      invalid: null,
    });
  });

  it('reports absent when no path is given at all', () => {
    expect(resolveIntent(null)).toEqual({
      kind: 'absent',
      provider: null,
      invalid: null,
    });
    expect(resolveIntent(undefined)).toEqual({
      kind: 'absent',
      provider: null,
      invalid: null,
    });
  });

  it('reads a well-formed regular file end to end', () => {
    const target = join(scratch, 'valid.yml');
    writeFileSync(target, 'provider: github\n', 'utf8');
    expect(resolveIntent(target)).toEqual({
      kind: 'valid',
      provider: 'github',
      invalid: null,
    });
  });

  it('refuses a symlink without following it, even to a valid file', () => {
    const real = join(scratch, 'real-target.yml');
    writeFileSync(real, 'provider: graphite\n', 'utf8');
    const link = join(scratch, 'symlinked.yml');
    symlinkSync(real, link);
    expect(readIntentFile(link)).toEqual({
      kind: 'invalid',
      reason: INTENT_INVALID_REASONS.SYMLINK,
    });
    expect(resolveIntent(link)).toEqual({
      kind: 'invalid',
      provider: null,
      invalid: { reason: INTENT_INVALID_REASONS.SYMLINK },
    });
  });

  it('refuses a non-regular file (a directory at the intent path)', () => {
    const dirPath = join(scratch, 'a-directory.yml');
    mkdirSync(dirPath);
    expect(resolveIntent(dirPath)).toEqual({
      kind: 'invalid',
      provider: null,
      invalid: { reason: INTENT_INVALID_REASONS.NON_REGULAR_FILE },
    });
  });

  it('surfaces an existing-but-empty file as invalid, never as absent', () => {
    const empty = join(scratch, 'empty.yml');
    writeFileSync(empty, '', 'utf8');
    expect(resolveIntent(empty)).toEqual({
      kind: 'invalid',
      provider: null,
      invalid: { reason: INTENT_INVALID_REASONS.MISSING_KEY },
    });
  });

  it('carries rawValue through resolveIntent for an unknown provider', () => {
    const target = join(scratch, 'unknown-provider.yml');
    writeFileSync(target, 'provider: bitbucket\n', 'utf8');
    expect(resolveIntent(target)).toEqual({
      kind: 'invalid',
      provider: null,
      invalid: {
        reason: INTENT_INVALID_REASONS.UNKNOWN_PROVIDER,
        rawValue: 'bitbucket',
      },
    });
  });
});

describe('classifyProviderState — the eight states', () => {
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

  it('case 6d: CONFIG_INVALID — malformed intent file, never collapsed to UNSELECTED', () => {
    const result = classifyProviderState({
      plugins: fixture('both-installed-graphite-enabled'),
      intent: null,
      intentInvalid: { reason: INTENT_INVALID_REASONS.DUPLICATE_KEYS },
      projectPath: PROJECT_PATH,
    });
    expect(result.state).toBe(STATES.CONFIG_INVALID);
    expect(result.intentInvalid).toEqual({ reason: INTENT_INVALID_REASONS.DUPLICATE_KEYS });
    expect(result.detail).toContain('duplicate-keys');
  });

  it('case 6e: CONFIG_INVALID outranks CONFIG_MISMATCH and UNSELECTED', () => {
    // Even though nothing is enabled (which would otherwise be UNSELECTED),
    // a broken intent file is a worse starting point and must win.
    const result = classifyProviderState({
      plugins: fixture('none-enabled'),
      intent: null,
      intentInvalid: { reason: INTENT_INVALID_REASONS.UNKNOWN_PROVIDER, rawValue: 'bitbucket' },
      projectPath: PROJECT_PATH,
    });
    expect(result.state).toBe(STATES.CONFIG_INVALID);
    expect(result.detail).toContain('bitbucket');
  });

  it('case 6f: CONFLICT still outranks CONFIG_INVALID (worst-first)', () => {
    const result = classifyProviderState({
      plugins: fixture('both-enabled'),
      intent: null,
      intentInvalid: { reason: INTENT_INVALID_REASONS.MALFORMED_SYNTAX },
      projectPath: PROJECT_PATH,
    });
    expect(result.state).toBe(STATES.CONFLICT);
  });

  it('case 6g: a valid, known intent never carries intentInvalid', () => {
    const result = classifyProviderState({
      plugins: fixture('both-installed-graphite-enabled'),
      intent: 'graphite',
      projectPath: PROJECT_PATH,
    });
    expect(result.intentInvalid).toBeNull();
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

  it('case 7c: managed force-disable overridden by a lower-scope enable => MANAGED_CONFLICT, with NO .yellow-stack.yml intent', () => {
    // The bug this guards: a managed row force-disabling a provider while
    // a retained user-scope row still has `enabled: true` must classify as
    // MANAGED_CONFLICT even when `.yellow-stack.yml` is absent (intent is
    // null) — the administrator's setting overrides the lower scope
    // regardless of repository intent.
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
      {
        id: 'github-workflow@yellow-plugins',
        version: '0.1.0',
        scope: 'user',
        enabled: true,
        installPath: '/fixture/user/plugins/github-workflow/0.1.0',
        installedAt: '2026-01-01T00:00:00.000Z',
        lastUpdated: '2026-01-01T00:00:00.000Z',
      },
    ];
    const result = classifyProviderState({ plugins, projectPath: PROJECT_PATH });
    expect(result.intent).toBeNull();
    expect(result.state).toBe(STATES.MANAGED_CONFLICT);
    expect(result.detail).toContain('github-workflow');
    expect(result.detail).toContain('force-disabled');
  });

  it('case 7d: force-disabled-and-not-otherwise-enabled is the ordinary state, NOT a conflict', () => {
    // `managedDisabled` alone must not become MANAGED_CONFLICT — a
    // provider the administrator disabled and that is not enabled
    // anywhere else is simply not enabled.
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
    const result = classifyProviderState({ plugins, projectPath: PROJECT_PATH });
    expect(result.state).not.toBe(STATES.MANAGED_CONFLICT);
    expect(result.state).toBe(STATES.UNSELECTED);
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

  it('CLI: --tooling-github unknown means NOT CHECKED, never PARTIAL_TOOLING', () => {
    // The probes in /stack:status, the router skill, and /setup:all emit
    // `unknown` when `gh extension list` itself fails. That must land in
    // "not checked", not in "checked and absent" — the latter tells the
    // user to reinstall tooling whose state was never read. This exercises
    // the real CLI flag rather than the library map, because the flag is
    // what the command markdown actually passes.
    const lib = join(
      __dirname,
      '..',
      '..',
      'plugins',
      'yellow-core',
      'lib',
      'stack-provider-state.js'
    );
    const fixturePath = join(FIXTURE_DIR, 'both-installed-github-enabled.json');
    const run = (toolingGithub: string): { state: string; toolingKnown: boolean } =>
      JSON.parse(
        execFileSync(
          process.execPath,
          [
            lib,
            'classify',
            '--plugins-file',
            fixturePath,
            '--tooling-graphite',
            'no',
            '--tooling-github',
            toolingGithub,
          ],
          { encoding: 'utf8' }
        )
      );

    const unknown = run('unknown');
    expect(unknown.toolingKnown).toBe(false);
    expect(unknown.state).toBe(STATES.READY_GITHUB);

    // The contrast that matters: a probe that RAN and found nothing is a
    // real PARTIAL_TOOLING, and must stay distinguishable from the above.
    const absent = run('no');
    expect(absent.toolingKnown).toBe(true);
    expect(absent.state).toBe(STATES.PARTIAL_TOOLING);
  });

  it('CLI: a malformed --intent-file produces CONFIG_INVALID end to end', () => {
    const lib = join(
      __dirname,
      '..',
      '..',
      'plugins',
      'yellow-core',
      'lib',
      'stack-provider-state.js'
    );
    const fixturePath = join(FIXTURE_DIR, 'both-installed-graphite-enabled.json');
    const scratch = mkdtempSync(join(tmpdir(), 'yellow-stack-cli-intent-'));
    const intentPath = join(scratch, '.yellow-stack.yml');
    writeFileSync(intentPath, 'provider: github\nprovider: graphite\n', 'utf8');
    try {
      const result = JSON.parse(
        execFileSync(
          process.execPath,
          [lib, 'classify', '--plugins-file', fixturePath, '--intent-file', intentPath],
          { encoding: 'utf8' }
        )
      );
      expect(result.state).toBe(STATES.CONFIG_INVALID);
      expect(result.intentInvalid).toEqual({ reason: INTENT_INVALID_REASONS.DUPLICATE_KEYS });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('CLI: an absent --intent-file classifies exactly as before (no regression)', () => {
    const lib = join(
      __dirname,
      '..',
      '..',
      'plugins',
      'yellow-core',
      'lib',
      'stack-provider-state.js'
    );
    const fixturePath = join(FIXTURE_DIR, 'both-installed-graphite-enabled.json');
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [
          lib,
          'classify',
          '--plugins-file',
          fixturePath,
          '--intent-file',
          join(FIXTURE_DIR, 'does-not-exist.yml'),
        ],
        { encoding: 'utf8' }
      )
    );
    expect(result.state).toBe(STATES.READY_GRAPHITE);
    expect(result.intentInvalid).toBeNull();
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

describe('summarizeProviders — scope sanitization for display', () => {
  it('does not propagate an unrecognized scope value verbatim into rendered scopes', () => {
    // `claude plugin list --json` is untrusted CLI output. A crafted scope
    // string must never reach a rendered report (e.g. /stack:status's
    // Scopes column) verbatim.
    const plugins = [
      {
        id: 'gt-workflow@yellow-plugins',
        version: '0.1.0',
        scope: 'user; printf PWNED',
        enabled: true,
        installPath: '/fixture/user/plugins/gt-workflow/0.1.0',
        installedAt: '2026-01-01T00:00:00.000Z',
        lastUpdated: '2026-01-01T00:00:00.000Z',
      },
    ];
    const { providers } = summarizeProviders(plugins, { projectPath: PROJECT_PATH });
    expect(providers.graphite.scopes).toEqual(['unknown']);
    expect(providers.graphite.enabledScopes).toEqual(['unknown']);
    // The raw value must still be available to callers (planProviderSwitch)
    // that need to refuse on it rather than mask it — see the
    // "refuses a malformed scope" test in planProviderSwitch below.
    expect(providers.graphite.scopesRaw).toEqual(['user; printf PWNED']);
    expect(providers.graphite.enabledScopesRaw).toEqual(['user; printf PWNED']);
  });

  it('leaves known scope values (including managed) untouched', () => {
    const { providers } = summarizeProviders(fixture('managed-conflict'), {
      projectPath: PROJECT_PATH,
    });
    expect(providers.graphite.scopes).toEqual(['user']);
    expect(providers.github.scopes).toEqual(['managed']);
  });
});

describe('classifyProviderState — raw scopes never reach classifier output', () => {
  // Same crafted scope string as the summarizeProviders/planProviderSwitch
  // malformed-scope tests above/below — the classifier used to leak it
  // under scopesRaw/enabledScopesRaw even after `scopes`/`enabledScopes`
  // were sanitized (fresh evidence after the earlier scopes finding).
  const MALFORMED_SCOPE = 'user; printf PWNED';
  const plugins = [
    {
      id: 'gt-workflow@yellow-plugins',
      version: '0.1.0',
      scope: MALFORMED_SCOPE,
      enabled: true,
      installPath: '/fixture/user/plugins/gt-workflow/0.1.0',
      installedAt: '2026-01-01T00:00:00.000Z',
      lastUpdated: '2026-01-01T00:00:00.000Z',
    },
  ];

  it('does not expose the raw scope anywhere in the serialized classifier output', () => {
    const result = classifyProviderState({ plugins, projectPath: PROJECT_PATH });
    expect(result.providers.graphite.scopesRaw).toBeUndefined();
    expect(result.providers.graphite.enabledScopesRaw).toBeUndefined();
    // Strongest form: assert the malformed value is absent from the WHOLE
    // serialized object, not just the two known keys — this also catches
    // any future field that starts leaking the same channel, which a
    // key-by-key assertion would miss.
    expect(JSON.stringify(result)).not.toContain(MALFORMED_SCOPE);
  });

  it('planProviderSwitch still refuses on the same malformed input', () => {
    // Guards against "fixing" the classifier leak by sanitizing the value
    // too early — planProviderSwitch needs the raw value intact to refuse
    // correctly (see "refuses a malformed scope" below).
    const plan = planProviderSwitch({
      plugins,
      target: 'github',
      scope: 'user',
      projectPath: PROJECT_PATH,
    });
    expect(plan.status).toBe('refused');
    expect(plan.reason).toBe('invalid-scope');
    expect(plan.steps).toEqual([]);
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
      'claude plugin disable gt-workflow@yellow-plugins --scope user',
      'claude plugin enable github-workflow@yellow-plugins --scope user',
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

  it('disables the enabled provider BEFORE installing an absent target', () => {
    // Regression guard for the install-first ordering bug: `claude plugin
    // install` leaves the new plugin enabled, so emitting install before the
    // disable would put both providers in the enabled state between steps,
    // breaking the single-provider invariant. Order, not just membership, is
    // the contract here.
    const plugins = fixture('both-installed-graphite-enabled').filter(
      (row) => (row as { id: string }).id !== 'github-workflow@yellow-plugins'
    );
    const plan = planProviderSwitch({
      plugins,
      target: 'github',
      scope: 'user',
      projectPath: PROJECT_PATH,
    });
    expect(plan.status).toBe('ok');
    expect(plan.steps.map((s: { action: string }) => s.action)).toEqual([
      'disable',
      'install',
      'enable',
    ]);
    expect(plan.steps.map((s: { command: string }) => s.command)).toEqual([
      'claude plugin disable gt-workflow@yellow-plugins --scope user',
      'claude plugin install github-workflow@yellow-plugins --scope user',
      'claude plugin enable github-workflow@yellow-plugins --scope user',
    ]);
    // Installing still needs an explicit yes even when it is no longer first.
    expect(
      plan.steps.find((s: { action: string }) => s.action === 'install')
        ?.requiresConfirmation
    ).toBe(true);
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

  it('refuses a malformed scope on the OTHER provider instead of interpolating it into a command', () => {
    // `claude plugin list --json` is untrusted CLI output. A row reporting
    // an unexpected scope must be refused before the disable loop builds a
    // step around it — never shell-escaped, never passed through.
    const plugins = [
      {
        id: 'gt-workflow@yellow-plugins',
        version: '0.1.0',
        scope: 'user; printf PWNED',
        enabled: true,
        installPath: '/fixture/user/plugins/gt-workflow/0.1.0',
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
    expect(plan.reason).toBe('invalid-scope');
    expect(plan.steps).toEqual([]);
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
    expect(outcome.failedStep.action).toBe('disable');
    expect(outcome.notRun.map((s: { action: string }) => s.action)).toEqual(['enable']);
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
