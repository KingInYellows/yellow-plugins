/**
 * Cursor-target generator behavior suite.
 *
 * Clones tests/integration/generate-manifests-codex.test.ts's structure and
 * fixture-builder pattern for the Cursor target: enablement filtering,
 * version drift, no-op emission (Cursor's own — see below), path
 * portability, symlink rejection in the skill tree, marketplace membership,
 * stale-artifact sweep, and lifecycle metadata validation/non-emission.
 * Every scenario runs against a minimal, self-contained temp fixture (not
 * the full 19-plugin repo fixture) so each test controls its own
 * `targets.cursor` / `lifecycle` shape precisely, and never touches the
 * live catalog.
 *
 * Cursor's emission contract diverges from Codex's in one structural way
 * this suite exercises directly: buildCursorMarketplace returns `null` (no
 * artifact emitted at all, not an empty-array one) both when the root
 * `catalog.targets.cursor` config is absent AND when it's present with zero
 * Cursor-enabled plugins — unlike Codex's always-present empty-state
 * .agents/plugins/marketplace.json.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, afterAll } from 'vitest';

/* eslint-disable @typescript-eslint/no-var-requires -- scripts/ is plain
   CJS, so these are require()'d rather than imported; prettier wraps the
   longer destructured imports below across multiple lines, which would
   desync a per-line eslint-disable-next-line comment from the actual
   require() call. */
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const { generateManifests } = require('../../scripts/generate-manifests.js');
const {
  loadCatalog,
  loadPluginSources,
} = require('../../scripts/lib/generate/catalog-reader.js');
const {
  validateArtifacts,
  runExposureLint,
  scanLifecycleLeaks,
} = require('../../scripts/validate-cursor.js');
const {
  computeCursorTwoWayDrift,
  computeCursorMarketplaceIssues,
} = require('../../scripts/validate-versions.js');
/* eslint-enable @typescript-eslint/no-var-requires */

const REPO_ROOT = join(__dirname, '..', '..');

const fixtureRoots: string[] = [];
afterAll(() => {
  for (const root of fixtureRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

interface PluginFixtureOpts {
  name: string;
  version?: string;
  cursorEnabled?: boolean;
  skillAllowlist?: string[];
  /** Skill directory names to actually write SKILL.md content for —
   * decoupled from skillAllowlist (mirrors generate-manifests-codex.test.ts's
   * separate `skills` field) so a test can declare an allowlist entry
   * without the fixture builder pre-creating a real file at that path
   * (needed when the test itself wants to create a symlink there instead). */
  skills?: string[];
  componentPathsSkills?: string;
  lifecycle?: Record<string, unknown>;
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/** Minimal, self-contained fixture — NOT the full repo fixture. */
function makeCursorFixtureRoot(
  plugins: PluginFixtureOpts[],
  opts: { cursorRoot?: Record<string, unknown> | null } = {}
): string {
  const root = mkdtempSync(join(tmpdir(), 'yellow-generate-cursor-'));
  fixtureRoots.push(root);

  mkdirSync(join(root, 'catalog', 'plugins'), { recursive: true });
  const targets: Record<string, unknown> = {
    claude: {
      marketplaceSchema:
        'https://anthropic.com/claude-code/marketplace.schema.json',
    },
    // catalog-reader.js hard-requires targets.codex regardless of whether
    // this suite's fixtures ever enable Codex — clone the codex twin's full
    // required block rather than trimming it.
    codex: {
      displayName: 'Yellow Plugins',
      category: 'Developer Tools',
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
    },
  };
  // opts.cursorRoot === null means "explicitly omit" (the no-op-by-absence
  // scenario); omitting the option entirely defaults to a minimal present
  // config so most tests don't need to specify it.
  if (opts.cursorRoot !== null) {
    targets.cursor = opts.cursorRoot ?? { name: 'yellow-plugins' };
  }
  writeJson(join(root, 'catalog', 'catalog.json'), {
    name: 'yellow-plugins',
    description: 'Fixture catalog',
    owner: { name: 'Fixture Owner' },
    metadata: { description: 'Fixture', version: '1.0.0' },
    pluginOrder: plugins.map((p) => p.name),
    targets,
  });

  for (const p of plugins) {
    const version = p.version ?? '1.0.0';
    const cursorTarget: Record<string, unknown> = {
      enabled: Boolean(p.cursorEnabled),
    };
    if (p.cursorEnabled) {
      cursorTarget.interface = { displayName: p.name, category: 'automation' };
      if (p.skillAllowlist) {
        cursorTarget.skillAllowlist = p.skillAllowlist;
      }
      if (p.skillAllowlist || p.componentPathsSkills !== undefined) {
        cursorTarget.componentPaths = {
          skills: p.componentPathsSkills ?? './cursor/skills',
        };
      }
    }
    const source: Record<string, unknown> = {
      $schema: 'https://json.schemastore.org/claude-code-plugin-manifest.json',
      description: `Fixture plugin ${p.name}.`,
      author: { name: 'Fixture Owner' },
      homepage: 'https://example.com',
      repository: 'https://example.com/repo',
      license: 'MIT',
      keywords: ['fixture'],
      marketplace: { category: 'development', source: `./plugins/${p.name}` },
      targets: {
        claude: true,
        codex: { enabled: false },
        cursor: cursorTarget,
      },
    };
    if (p.lifecycle !== undefined) {
      source.lifecycle = p.lifecycle;
    }
    writeJson(join(root, 'catalog', 'plugins', `${p.name}.json`), source);

    mkdirSync(join(root, 'plugins', p.name), { recursive: true });
    writeJson(join(root, 'plugins', p.name, 'package.json'), {
      name: p.name,
      version,
    });

    if (p.skills) {
      for (const skillName of p.skills) {
        mkdirSync(join(root, 'plugins', p.name, 'skills', skillName), {
          recursive: true,
        });
        writeFileSync(
          join(root, 'plugins', p.name, 'skills', skillName, 'SKILL.md'),
          `---\nname: ${skillName}\ndescription: "Skill ${skillName}"\n---\n\nBody content for ${skillName}.\n`,
          'utf8'
        );
      }
    }
  }

  return root;
}

function runValidation(root: string) {
  const catalogResult = loadCatalog(join(root, 'catalog'));
  const sourcesResult = loadPluginSources(
    join(root, 'catalog'),
    catalogResult.data.pluginOrder
  );
  const ajv = new Ajv({
    strict: true,
    allErrors: true,
    verbose: true,
    allowUnionTypes: true,
  });
  addFormats(ajv);
  const artifactErrors = validateArtifacts({
    rootDir: root,
    catalog: catalogResult.data,
    sources: sourcesResult.sources,
    ajv,
    schemasDir: join(REPO_ROOT, 'schemas'),
  });
  const exposureErrors = runExposureLint({
    rootDir: root,
    catalog: catalogResult.data,
    sources: sourcesResult.sources,
  });
  const lifecycleErrors = scanLifecycleLeaks({
    rootDir: root,
    catalog: catalogResult.data,
    sources: sourcesResult.sources,
  });
  return { artifactErrors, exposureErrors, lifecycleErrors };
}

describe('Cursor enablement filtering', () => {
  it('absence of targets.cursor is disabled', () => {
    const root = mkdtempSync(join(tmpdir(), 'yellow-generate-cursor-'));
    fixtureRoots.push(root);
    mkdirSync(join(root, 'catalog', 'plugins'), { recursive: true });
    writeJson(join(root, 'catalog', 'catalog.json'), {
      name: 'yellow-plugins',
      description: 'Fixture',
      owner: { name: 'Fixture Owner' },
      metadata: { description: 'Fixture', version: '1.0.0' },
      pluginOrder: ['no-cursor-key'],
      targets: {
        claude: {
          marketplaceSchema:
            'https://anthropic.com/claude-code/marketplace.schema.json',
        },
        codex: {
          displayName: 'Yellow Plugins',
          category: 'Developer Tools',
          policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
        },
      },
    });
    writeJson(join(root, 'catalog', 'plugins', 'no-cursor-key.json'), {
      $schema: 'https://json.schemastore.org/claude-code-plugin-manifest.json',
      description: 'Fixture plugin.',
      author: { name: 'Fixture Owner' },
      homepage: 'https://example.com',
      repository: 'https://example.com/repo',
      license: 'MIT',
      keywords: ['fixture'],
      marketplace: {
        category: 'development',
        source: './plugins/no-cursor-key',
      },
      targets: { claude: true, codex: { enabled: false } }, // no "cursor" key at all
    });
    mkdirSync(join(root, 'plugins', 'no-cursor-key'), { recursive: true });
    writeJson(join(root, 'plugins', 'no-cursor-key', 'package.json'), {
      name: 'no-cursor-key',
      version: '1.0.0',
    });

    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('ok');
    expect(result.written).not.toContain(
      'plugins/no-cursor-key/.cursor-plugin/plugin.json'
    );
  });

  it('enabled:false is disabled; enabled:true is emitted', () => {
    const root = makeCursorFixtureRoot([
      { name: 'enabled-plugin', cursorEnabled: true },
      { name: 'disabled-plugin', cursorEnabled: false },
    ]);
    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('ok');
    expect(result.written).toContain(
      'plugins/enabled-plugin/.cursor-plugin/plugin.json'
    );
    expect(result.written).not.toContain(
      'plugins/disabled-plugin/.cursor-plugin/plugin.json'
    );

    const marketplace = JSON.parse(
      readFileSync(join(root, '.cursor-plugin', 'marketplace.json'), 'utf8')
    );
    expect(marketplace.plugins.map((p: { name: string }) => p.name)).toEqual([
      'enabled-plugin',
    ]);
  });

  it('version comes from package.json, not the catalog source', () => {
    const root = makeCursorFixtureRoot([
      { name: 'versioned-plugin', cursorEnabled: true, version: '3.4.5' },
    ]);
    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('ok');
    const manifest = JSON.parse(
      readFileSync(
        join(
          root,
          'plugins',
          'versioned-plugin',
          '.cursor-plugin',
          'plugin.json'
        ),
        'utf8'
      )
    );
    expect(manifest.version).toBe('3.4.5');
  });
});

describe('no-op emission (root config absent, or zero enabled)', () => {
  it('emits nothing when catalog.targets.cursor is absent, even with a Cursor-enabled plugin', () => {
    const root = makeCursorFixtureRoot([{ name: 'p1', cursorEnabled: true }], {
      cursorRoot: null,
    });
    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('ok');
    expect(existsSync(join(root, '.cursor-plugin', 'marketplace.json'))).toBe(
      false
    );
    // The per-plugin manifest is still emitted — isCursorEnabled is
    // independent of root marketplace config, mirroring Codex's per-plugin
    // gating (only the marketplace artifact is conditioned on root config).
    expect(
      existsSync(join(root, 'plugins', 'p1', '.cursor-plugin', 'plugin.json'))
    ).toBe(true);
  });

  it('emits nothing when the root config is present but zero plugins are enabled', () => {
    const root = makeCursorFixtureRoot([{ name: 'p1', cursorEnabled: false }]);
    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('ok');
    expect(existsSync(join(root, '.cursor-plugin', 'marketplace.json'))).toBe(
      false
    );
  });

  it('is byte-identical (no-op) on regeneration in both no-op states', () => {
    const root = makeCursorFixtureRoot([{ name: 'p1', cursorEnabled: false }]);
    generateManifests({ mode: 'apply', rootDir: root });
    const second = generateManifests({ mode: 'apply', rootDir: root });
    expect(second.status).toBe('ok');
    expect(second.written).toEqual([]);
  });
});

describe('determinism', () => {
  it('a full apply run is byte-identical on a second run', () => {
    const root = makeCursorFixtureRoot([
      {
        name: 'p1',
        cursorEnabled: true,
        skillAllowlist: ['demo'],
        skills: ['demo'],
      },
    ]);
    const first = generateManifests({ mode: 'apply', rootDir: root });
    expect(first.status).toBe('ok');
    expect(first.written.length).toBeGreaterThan(0);
    const second = generateManifests({ mode: 'apply', rootDir: root });
    expect(second.status).toBe('ok');
    expect(second.written).toEqual([]);
  });
});

describe('--check drift detection', () => {
  it('reports drift when a generated artifact is hand-edited, and apply mode restores it', () => {
    const root = makeCursorFixtureRoot([{ name: 'p1', cursorEnabled: true }]);
    generateManifests({ mode: 'apply', rootDir: root });
    const manifestPath = join(
      root,
      'plugins',
      'p1',
      '.cursor-plugin',
      'plugin.json'
    );
    writeFileSync(manifestPath, '{"name":"tampered"}\n', 'utf8');

    const check = generateManifests({ mode: 'check', rootDir: root });
    expect(check.status).toBe('ok');
    expect(
      check.diffs.some(
        (d: { path: string }) =>
          d.path === 'plugins/p1/.cursor-plugin/plugin.json'
      )
    ).toBe(true);

    const apply = generateManifests({ mode: 'apply', rootDir: root });
    expect(apply.written).toContain('plugins/p1/.cursor-plugin/plugin.json');
    const restored = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(restored.name).toBe('p1');
  });
});

describe('stale-artifact sweep', () => {
  it('removes the manifest when a plugin flips from enabled to disabled', () => {
    const root = makeCursorFixtureRoot([{ name: 'p1', cursorEnabled: true }]);
    generateManifests({ mode: 'apply', rootDir: root });
    expect(
      existsSync(join(root, 'plugins', 'p1', '.cursor-plugin', 'plugin.json'))
    ).toBe(true);

    const sourcePath = join(root, 'catalog', 'plugins', 'p1.json');
    const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
    source.targets.cursor = { enabled: false };
    writeJson(sourcePath, source);

    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('ok');
    expect(
      existsSync(join(root, 'plugins', 'p1', '.cursor-plugin', 'plugin.json'))
    ).toBe(false);
  });

  it('removes the root marketplace when the last enabled plugin is disabled', () => {
    const root = makeCursorFixtureRoot([{ name: 'p1', cursorEnabled: true }]);
    generateManifests({ mode: 'apply', rootDir: root });
    expect(existsSync(join(root, '.cursor-plugin', 'marketplace.json'))).toBe(
      true
    );

    const sourcePath = join(root, 'catalog', 'plugins', 'p1.json');
    const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
    source.targets.cursor = { enabled: false };
    writeJson(sourcePath, source);

    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('ok');
    expect(existsSync(join(root, '.cursor-plugin', 'marketplace.json'))).toBe(
      false
    );
  });

  it('removes a skill dropped from skillAllowlist', () => {
    const root = makeCursorFixtureRoot([
      {
        name: 'p1',
        cursorEnabled: true,
        skillAllowlist: ['a', 'b'],
        skills: ['a', 'b'],
      },
    ]);
    generateManifests({ mode: 'apply', rootDir: root });
    expect(
      existsSync(
        join(root, 'plugins', 'p1', 'cursor', 'skills', 'b', 'SKILL.md')
      )
    ).toBe(true);

    const sourcePath = join(root, 'catalog', 'plugins', 'p1.json');
    const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
    source.targets.cursor.skillAllowlist = ['a'];
    writeJson(sourcePath, source);

    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('ok');
    expect(
      existsSync(
        join(root, 'plugins', 'p1', 'cursor', 'skills', 'a', 'SKILL.md')
      )
    ).toBe(true);
    expect(
      existsSync(
        join(root, 'plugins', 'p1', 'cursor', 'skills', 'b', 'SKILL.md')
      )
    ).toBe(false);
  });
});

describe('path portability', () => {
  it('rejects a skill name containing spaces, backslashes, or Windows-drive syntax', () => {
    const root = makeCursorFixtureRoot([
      {
        name: 'exotic-plugin',
        cursorEnabled: true,
        skillAllowlist: [
          'bad name with spaces',
          'C:\\bad\\backslash',
          '..\\wsl\\escape',
        ],
      },
      { name: 'untouched-plugin', cursorEnabled: false },
    ]);
    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('error');
    expect(result.errors.some((e: string) => e.includes('allowlist'))).toBe(
      true
    );
    expect(result.results['exotic-plugin']).toBe('error');
    expect(result.results['untouched-plugin']).toBe('ok');
  });

  it('rejects a path-escaping skill name in the allowlist', () => {
    const root = makeCursorFixtureRoot([
      {
        name: 'escape-plugin',
        cursorEnabled: true,
        skillAllowlist: ['../../../etc/passwd'],
      },
    ]);
    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('error');
    expect(result.errors.some((e: string) => e.includes('allowlist'))).toBe(
      true
    );
  });
});

describe('symlink rejection in skill tree (mirrors buildCodexSkillTree)', () => {
  it('rejects a symlinked skill SKILL.md', () => {
    const root = makeCursorFixtureRoot([
      {
        name: 'symlink-plugin',
        cursorEnabled: true,
        skillAllowlist: ['linked-skill'],
      },
    ]);
    mkdirSync(join(root, 'plugins', 'symlink-plugin', 'skills', 'real-skill'), {
      recursive: true,
    });
    writeFileSync(
      join(
        root,
        'plugins',
        'symlink-plugin',
        'skills',
        'real-skill',
        'SKILL.md'
      ),
      '---\nname: real-skill\ndescription: "target"\n---\n\nBody.\n',
      'utf8'
    );
    mkdirSync(
      join(root, 'plugins', 'symlink-plugin', 'skills', 'linked-skill'),
      { recursive: true }
    );
    symlinkSync(
      join(
        root,
        'plugins',
        'symlink-plugin',
        'skills',
        'real-skill',
        'SKILL.md'
      ),
      join(
        root,
        'plugins',
        'symlink-plugin',
        'skills',
        'linked-skill',
        'SKILL.md'
      )
    );

    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('error');
    expect(
      result.errors.some((e: string) =>
        e.includes('symlinked skill files are not allowed')
      )
    ).toBe(true);
    expect(result.results['symlink-plugin']).toBe('error');
  });
});

describe('marketplace membership by name', () => {
  it('marketplace entries use the "plugins/<name>" source form (no "./" prefix, unlike Codex)', () => {
    const root = makeCursorFixtureRoot([{ name: 'p1', cursorEnabled: true }]);
    generateManifests({ mode: 'apply', rootDir: root });
    const marketplace = JSON.parse(
      readFileSync(join(root, '.cursor-plugin', 'marketplace.json'), 'utf8')
    );
    expect(marketplace.plugins[0].source).toBe('plugins/p1');
  });

  it('computeCursorMarketplaceIssues flags a missing entry, an orphan entry, and a bad path', () => {
    expect(computeCursorMarketplaceIssues(['p1'], [])).toEqual([
      'Cursor marketplace: "p1" is Cursor-enabled but has no entry in .cursor-plugin/marketplace.json',
    ]);
    expect(
      computeCursorMarketplaceIssues(
        [],
        [{ name: 'orphan', source: 'plugins/orphan' }]
      )
    ).toEqual([
      'Cursor marketplace: "orphan" has an entry but is not Cursor-enabled in the catalog',
    ]);
    expect(
      computeCursorMarketplaceIssues(
        ['p1'],
        [{ name: 'p1', source: './plugins/p1' }]
      )
    ).toEqual([
      'Cursor marketplace: "p1" source is "./plugins/p1" (expected "plugins/p1")',
    ]);
    expect(
      computeCursorMarketplaceIssues(
        ['p1'],
        [{ name: 'p1', source: 'plugins/p1' }]
      )
    ).toEqual([]);
  });

  it('computeCursorTwoWayDrift flags a missing or mismatched version', () => {
    expect(computeCursorTwoWayDrift('1.0.0', null)).toMatch(
      /missing or unreadable/
    );
    expect(computeCursorTwoWayDrift('1.0.0', '1.0.1')).toMatch(
      /expected 1\.0\.0/
    );
    expect(computeCursorTwoWayDrift('1.0.0', '1.0.0')).toBeNull();
  });
});

describe('validate-cursor.js integration (artifact + exposure + lifecycle arms)', () => {
  it('a clean fixture passes all three arms', () => {
    const root = makeCursorFixtureRoot([
      {
        name: 'p1',
        cursorEnabled: true,
        skillAllowlist: ['demo'],
        skills: ['demo'],
      },
    ]);
    generateManifests({ mode: 'apply', rootDir: root });
    const { artifactErrors, exposureErrors, lifecycleErrors } =
      runValidation(root);
    expect(artifactErrors).toEqual([]);
    expect(exposureErrors).toEqual([]);
    expect(lifecycleErrors).toEqual([]);
  });
});

describe('lifecycle validation', () => {
  it('rejects an unrecognized status value', () => {
    const root = makeCursorFixtureRoot([
      {
        name: 'p1',
        cursorEnabled: false,
        lifecycle: { status: 'not-a-real-status' },
      },
    ]);
    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('error');
    expect(
      result.errors.some((e: string) => e.includes('lifecycle.status'))
    ).toBe(true);
  });

  it('rejects an unknown field', () => {
    const root = makeCursorFixtureRoot([
      {
        name: 'p1',
        cursorEnabled: false,
        lifecycle: { status: 'active', bogus: true },
      },
    ]);
    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('error');
    expect(
      result.errors.some((e: string) => e.includes('lifecycle.bogus'))
    ).toBe(true);
  });

  it('rejects a "replacement" that names a plugin not in pluginOrder', () => {
    const root = makeCursorFixtureRoot([
      {
        name: 'p1',
        cursorEnabled: false,
        lifecycle: { status: 'legacy', replacement: 'ghost-plugin' },
      },
    ]);
    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('error');
    expect(
      result.errors.some((e: string) => e.includes('lifecycle.replacement'))
    ).toBe(true);
  });

  it('accepts a valid legacy block with a real replacement', () => {
    const root = makeCursorFixtureRoot([
      {
        name: 'old-plugin',
        cursorEnabled: false,
        lifecycle: {
          status: 'legacy',
          installPolicy: 'manual',
          support: 'security-only',
          replacement: 'new-plugin',
        },
      },
      { name: 'new-plugin', cursorEnabled: true },
    ]);
    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('ok');
  });

  it('never emits "lifecycle" into any generated artifact', () => {
    const root = makeCursorFixtureRoot([
      {
        name: 'old-plugin',
        cursorEnabled: true,
        lifecycle: { status: 'legacy', replacement: 'new-plugin' },
      },
      { name: 'new-plugin', cursorEnabled: true },
    ]);
    generateManifests({ mode: 'apply', rootDir: root });
    const { lifecycleErrors } = runValidation(root);
    expect(lifecycleErrors).toEqual([]);

    const manifest = readFileSync(
      join(root, 'plugins', 'old-plugin', '.cursor-plugin', 'plugin.json'),
      'utf8'
    );
    expect(manifest).not.toMatch(/"lifecycle"/);
    const claudeManifest = readFileSync(
      join(root, 'plugins', 'old-plugin', '.claude-plugin', 'plugin.json'),
      'utf8'
    );
    expect(claudeManifest).not.toMatch(/"lifecycle"/);
  });
});
