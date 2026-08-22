/**
 * Integration tests for scripts/validate-provider-groups.js.
 *
 * Each case builds a minimal fixture repository under a temp dir and points
 * the validator at it with VALIDATE_PROVIDER_GROUPS_ROOT, so the assertions
 * exercise the real script end-to-end rather than a re-implementation.
 *
 * The live-repo case at the bottom covers requirement 10's
 * "generated-manifest non-emission of catalog-only metadata": it asserts
 * `capabilityProvider` is present in the committed catalog sources and
 * absent from every artifact the generators emit.
 */

import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

import { describe, it, expect, afterEach } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..');
const VALIDATOR = join(REPO_ROOT, 'scripts', 'validate-provider-groups.js');

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function runValidator(root: string): Run {
  try {
    const stdout = execFileSync('node', [VALIDATOR], {
      env: { ...process.env, VALIDATE_PROVIDER_GROUPS_ROOT: root },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

function write(root: string, relative: string, contents: string): void {
  const full = join(root, relative);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents, 'utf8');
}

interface FixtureOptions {
  providers?: Array<{ plugin: string; group: string; id: string }>;
  setupSection?: string;
  routerGroup?: string;
  routerEntries?: Array<{ id: string; plugin: string }>;
  marketplaceNames?: string[];
  emitProviderInto?: string;
  /**
   * Per-group router-file overrides, keyed by catalog group name. Only
   * consulted when neither `routerGroup` nor `routerEntries` is set (those
   * two remain the single-group legacy path, always targeting the
   * `stacked-pr` router file, unchanged from before this option existed).
   * `omit: true` skips writing that group's router file entirely (for a
   * "router missing" case); `group`/`entries` override what gets written
   * for a "router routes the wrong group" / "member drift" case.
   */
  routerFiles?: Record<
    string,
    {
      group?: string;
      entries?: Array<{ id: string; plugin: string }>;
      omit?: boolean;
    }
  >;
}

const DEFAULT_PROVIDERS = [
  { plugin: 'gt-workflow', group: 'stacked-pr', id: 'graphite' },
  { plugin: 'github-workflow', group: 'stacked-pr', id: 'github' },
];

// Mirrors the real ROUTER_TABLES map in scripts/validate-provider-groups.js —
// duplicated here deliberately, the same way a fixture harness always
// duplicates the thing it's testing against, so the test fails loudly if the
// two ever drift apart rather than silently testing the wrong path.
const ROUTER_TABLE_PATHS: Record<string, string> = {
  'stacked-pr': join(
    'plugins',
    'yellow-core',
    'lib',
    'stack-provider-state.js'
  ),
  'remote-agent': join(
    'plugins',
    'yellow-core',
    'lib',
    'remote-agent-provider-state.js'
  ),
};

function routerFileContent(
  group: string,
  entries: Array<{ id: string; plugin: string }>
): string {
  return [
    "'use strict';",
    `const PROVIDER_GROUP = '${group}';`,
    '// provider-table:start',
    'const PROVIDERS = Object.freeze([',
    ...entries.map(
      (entry) =>
        `  Object.freeze({ id: '${entry.id}', plugin: '${entry.plugin}' }),`
    ),
    ']);',
    '// provider-table:end',
    'module.exports = { PROVIDER_GROUP, PROVIDERS };',
    '',
  ].join('\n');
}

// Every root buildFixture() mkdtemps is tracked here and removed after each
// test, matching the afterEach(rmSync(...)) convention used elsewhere in
// tests/integration/ (e.g. backfill-solution-frontmatter.test.ts).
const createdRoots: string[] = [];

afterEach(() => {
  while (createdRoots.length > 0) {
    rmSync(createdRoots.pop()!, { recursive: true, force: true });
  }
});

/** Build a minimal but structurally faithful fixture repository. */
function buildFixture(options: FixtureOptions = {}): string {
  const providers = options.providers ?? DEFAULT_PROVIDERS;
  const marketplaceNames =
    options.marketplaceNames ?? providers.map((p) => p.plugin);
  const root = mkdtempSync(join(tmpdir(), 'provider-groups-'));
  createdRoots.push(root);

  write(
    root,
    join('catalog', 'catalog.json'),
    JSON.stringify({ pluginOrder: providers.map((p) => p.plugin) }, null, 2)
  );
  for (const provider of providers) {
    write(
      root,
      join('catalog', 'plugins', `${provider.plugin}.json`),
      JSON.stringify(
        { capabilityProvider: { group: provider.group, id: provider.id } },
        null,
        2
      )
    );
    // A plugins/<name>/ directory must exist for the referential check.
    mkdirSync(join(root, 'plugins', provider.plugin), { recursive: true });
    write(
      root,
      join('plugins', provider.plugin, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: provider.plugin, version: '0.1.0' }, null, 2)
    );
  }

  write(
    root,
    join('.claude-plugin', 'marketplace.json'),
    JSON.stringify(
      { plugins: marketplaceNames.map((name) => ({ name })) },
      null,
      2
    )
  );

  const defaultSection = [
    '<!-- setup-all-provider-groups:start -->',
    ...[...new Set(providers.map((p) => p.group))].flatMap((group) => [
      `- \`${group}\` (mutually exclusive: exactly one enabled)`,
      ...providers
        .filter((p) => p.group === group)
        .map((p) => `  - \`${p.plugin}\` → \`${p.id}\``),
    ]),
    '<!-- setup-all-provider-groups:end -->',
    '',
  ].join('\n');
  write(
    root,
    join('plugins', 'yellow-core', 'commands', 'setup', 'all.md'),
    options.setupSection ?? defaultSection
  );

  if (
    options.routerGroup !== undefined ||
    options.routerEntries !== undefined
  ) {
    // Legacy single-router-file path — unchanged behavior, always targets
    // the stacked-pr router regardless of `providers`.
    const routerEntries =
      options.routerEntries ??
      providers.map((p) => ({ id: p.id, plugin: p.plugin }));
    const routerGroup =
      options.routerGroup ?? providers[0]?.group ?? 'stacked-pr';
    write(
      root,
      ROUTER_TABLE_PATHS['stacked-pr'],
      routerFileContent(routerGroup, routerEntries)
    );
  } else {
    // Generalized default: one router file per distinct group present in
    // `providers`, written at that group's canonical path. With the
    // default two-member stacked-pr `providers` list, this writes exactly
    // one file at exactly the same path with exactly the same content the
    // old hardcoded block did — the two branches are behaviorally
    // identical for every pre-existing test.
    for (const group of [...new Set(providers.map((p) => p.group))]) {
      const override = options.routerFiles?.[group];
      if (override?.omit) {
        continue;
      }
      const routerPath = ROUTER_TABLE_PATHS[group];
      if (!routerPath) {
        continue;
      }
      const groupDeclared = override?.group ?? group;
      const entries =
        override?.entries ??
        providers
          .filter((p) => p.group === group)
          .map((p) => ({ id: p.id, plugin: p.plugin }));
      write(root, routerPath, routerFileContent(groupDeclared, entries));
    }
  }

  if (options.emitProviderInto) {
    const target = join(root, options.emitProviderInto);
    const existing = JSON.parse(readFileSync(target, 'utf8'));
    existing.capabilityProvider = {
      group: providers[0].group,
      id: providers[0].id,
    };
    writeFileSync(target, JSON.stringify(existing, null, 2), 'utf8');
  }

  return root;
}

describe('validate-provider-groups', () => {
  it('passes on a well-formed two-member group', () => {
    const run = runValidator(buildFixture());
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('1 capability group(s) verified');
  });

  it('fails when two plugins claim the same provider id in one group', () => {
    const run = runValidator(
      buildFixture({
        providers: [
          { plugin: 'gt-workflow', group: 'stacked-pr', id: 'graphite' },
          { plugin: 'github-workflow', group: 'stacked-pr', id: 'graphite' },
        ],
      })
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('ERROR-PROVIDER-001');
  });

  it('fails when a declared provider plugin is not in the marketplace', () => {
    const run = runValidator(
      buildFixture({ marketplaceNames: ['gt-workflow'] })
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('ERROR-PROVIDER-002');
    expect(run.stderr).toContain('github-workflow');
  });

  it('fails when provider metadata leaks into a generated plugin manifest', () => {
    const run = runValidator(
      buildFixture({
        emitProviderInto: join(
          'plugins',
          'gt-workflow',
          '.claude-plugin',
          'plugin.json'
        ),
      })
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('ERROR-PROVIDER-003');
  });

  it('fails when a group has only one member', () => {
    const run = runValidator(
      buildFixture({
        providers: [
          { plugin: 'gt-workflow', group: 'stacked-pr', id: 'graphite' },
        ],
      })
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('ERROR-PROVIDER-004');
  });

  it('fails when the setup:all section is missing entirely', () => {
    const run = runValidator(
      buildFixture({ setupSection: '# setup all\n\nno markers here\n' })
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('ERROR-PROVIDER-005');
  });

  it('fails when the setup:all section drops a group member', () => {
    const run = runValidator(
      buildFixture({
        setupSection: [
          '<!-- setup-all-provider-groups:start -->',
          '- `stacked-pr` (mutually exclusive: exactly one enabled)',
          '  - `gt-workflow` → `graphite`',
          '<!-- setup-all-provider-groups:end -->',
          '',
        ].join('\n'),
      })
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('ERROR-PROVIDER-005');
    expect(run.stderr).toContain('members drift');
  });

  it('fails when the setup:all section drops the mutual-exclusion clause', () => {
    // The clause is load-bearing prose: without it setup:all no longer tells
    // the reader that enabling both is a conflict, so the heading must stop
    // matching rather than silently pass.
    const run = runValidator(
      buildFixture({
        setupSection: [
          '<!-- setup-all-provider-groups:start -->',
          '- `stacked-pr`',
          '  - `gt-workflow` → `graphite`',
          '  - `github-workflow` → `github`',
          '<!-- setup-all-provider-groups:end -->',
          '',
        ].join('\n'),
      })
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('ERROR-PROVIDER-005');
  });

  it('fails when the shipped router table drifts from the catalog', () => {
    const run = runValidator(
      buildFixture({
        routerEntries: [{ id: 'graphite', plugin: 'gt-workflow' }],
      })
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('ERROR-PROVIDER-006');
    expect(run.stderr).toContain('provider table drifts');
  });

  it('fails when the router routes a group the catalog does not declare', () => {
    const run = runValidator(buildFixture({ routerGroup: 'some-other-group' }));
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('ERROR-PROVIDER-006');
  });
});

describe('validate-provider-groups — remote-agent group (multi-router-table generalization)', () => {
  const REMOTE_AGENT_PROVIDERS = [
    { plugin: 'yellow-cursor', group: 'remote-agent', id: 'cursor' },
    { plugin: 'yellow-devin', group: 'remote-agent', id: 'devin' },
  ];
  const TWO_GROUP_PROVIDERS = [...DEFAULT_PROVIDERS, ...REMOTE_AGENT_PROVIDERS];

  it('passes when both the stacked-pr and remote-agent router tables match the catalog', () => {
    const run = runValidator(buildFixture({ providers: TWO_GROUP_PROVIDERS }));
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('2 capability group(s) verified');
  });

  it('does NOT look up the remote-agent router file when the catalog declares only stacked-pr', () => {
    // Regression guard for the generalization itself: a fixture that never
    // mentions remote-agent must behave exactly as it did before this
    // change added a second table to iterate — no remote-agent-shaped
    // error should appear even though no remote-agent router file exists
    // anywhere under this fixture root.
    const run = runValidator(buildFixture());
    expect(run.status).toBe(0);
    expect(run.stderr).not.toContain('remote-agent');
  });

  it('fails when the remote-agent router file is missing from disk', () => {
    const run = runValidator(
      buildFixture({
        providers: TWO_GROUP_PROVIDERS,
        routerFiles: { 'remote-agent': { omit: true } },
      })
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('ERROR-PROVIDER-006');
    expect(run.stderr).toContain('missing from disk');
    expect(run.stderr).toContain('remote-agent-provider-state.js');
  });

  it('fails when the remote-agent router table drifts (a member missing from the shipped table)', () => {
    const run = runValidator(
      buildFixture({
        providers: TWO_GROUP_PROVIDERS,
        routerFiles: {
          'remote-agent': {
            entries: [{ id: 'cursor', plugin: 'yellow-cursor' }],
          },
        },
      })
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('ERROR-PROVIDER-006');
    expect(run.stderr).toContain('provider table drifts');
    expect(run.stderr).toContain('remote-agent');
  });

  it('a stacked-pr-only router drift is unaffected by an otherwise-healthy remote-agent table', () => {
    const run = runValidator(
      buildFixture({
        providers: TWO_GROUP_PROVIDERS,
        routerFiles: {
          'stacked-pr': {
            entries: [{ id: 'graphite', plugin: 'gt-workflow' }],
          },
        },
      })
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('ERROR-PROVIDER-006');
    expect(run.stderr).toContain('stack-provider-state.js');
    expect(run.stderr).not.toContain(
      'remote-agent-provider-state.js provider table drifts'
    );
  });
});

describe('generated-manifest non-emission (live repository)', () => {
  const declaring = ['gt-workflow', 'github-workflow'];

  it('declares capabilityProvider in the catalog sources', () => {
    for (const name of declaring) {
      const source = JSON.parse(
        readFileSync(
          join(REPO_ROOT, 'catalog', 'plugins', `${name}.json`),
          'utf8'
        )
      );
      expect(source.capabilityProvider).toEqual({
        group: 'stacked-pr',
        id: name === 'gt-workflow' ? 'graphite' : 'github',
      });
    }
  });

  it('emits capabilityProvider into no generated artifact', () => {
    const artifacts = [
      join(REPO_ROOT, '.claude-plugin', 'marketplace.json'),
      join(REPO_ROOT, '.agents', 'plugins', 'marketplace.json'),
      ...declaring.flatMap((name) => [
        join(REPO_ROOT, 'plugins', name, '.claude-plugin', 'plugin.json'),
        join(REPO_ROOT, 'plugins', name, '.codex-plugin', 'plugin.json'),
      ]),
    ].filter((path) => existsSync(path));

    // Guard the guard: if this list ever resolves to nothing, the assertion
    // below would pass vacuously.
    expect(artifacts.length).toBeGreaterThanOrEqual(3);

    for (const artifact of artifacts) {
      const raw = readFileSync(artifact, 'utf8');
      expect(raw).not.toContain('capabilityProvider');
    }
  });

  it('passes against the live repository', () => {
    const run = runValidator(REPO_ROOT);
    expect(run.status).toBe(0);
  });
});
