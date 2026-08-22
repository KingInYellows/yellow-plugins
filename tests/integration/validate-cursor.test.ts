/**
 * validate-cursor.js behavior suite.
 *
 * Complements tests/integration/generate-manifests-cursor.test.ts's
 * "validate-cursor.js integration" describe block (which covers the
 * clean-fixture happy path already) with the negative cases: schema
 * violations, exposure-lint hits for every DIRECT_CHECKS category, the
 * lifecycle-leak scan firing, and the no-cursor-config clean-exit contract.
 * Mirrors the fixture-builder pattern in generate-manifests-cursor.test.ts
 * (not the subprocess validator-harness pattern — validate-codex.js's own
 * test coverage uses direct function import against a temp fixture, not a
 * CLI subprocess with a ROOT env override, and validate-cursor.js follows
 * that same precedent).
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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
/* eslint-enable @typescript-eslint/no-var-requires */

const REPO_ROOT = join(__dirname, '..', '..');
const SCHEMAS_DIR = join(REPO_ROOT, 'schemas');

const fixtureRoots: string[] = [];
afterAll(() => {
  for (const root of fixtureRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

interface PluginFixtureOpts {
  name: string;
  cursorEnabled?: boolean;
  skillAllowlist?: string[];
  skillBody?: string;
  descriptionOverride?: string;
}

/** Same minimal-fixture shape as generate-manifests-cursor.test.ts. */
function makeFixtureRoot(
  plugins: PluginFixtureOpts[],
  cursorRoot: Record<string, unknown> | null = { name: 'yellow-plugins' }
): string {
  const root = mkdtempSync(join(tmpdir(), 'yellow-validate-cursor-'));
  fixtureRoots.push(root);

  mkdirSync(join(root, 'catalog', 'plugins'), { recursive: true });
  const targets: Record<string, unknown> = {
    claude: {
      marketplaceSchema:
        'https://anthropic.com/claude-code/marketplace.schema.json',
    },
    codex: {
      displayName: 'Yellow Plugins',
      category: 'Developer Tools',
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
    },
  };
  if (cursorRoot !== null) {
    targets.cursor = cursorRoot;
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
    const cursorTarget: Record<string, unknown> = {
      enabled: Boolean(p.cursorEnabled),
    };
    if (p.cursorEnabled) {
      cursorTarget.interface = { displayName: p.name, category: 'automation' };
      if (p.descriptionOverride !== undefined) {
        cursorTarget.description = p.descriptionOverride;
      }
      if (p.skillAllowlist) {
        cursorTarget.skillAllowlist = p.skillAllowlist;
        cursorTarget.componentPaths = { skills: './cursor/skills' };
      }
    }
    writeJson(join(root, 'catalog', 'plugins', `${p.name}.json`), {
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
    });

    mkdirSync(join(root, 'plugins', p.name), { recursive: true });
    writeJson(join(root, 'plugins', p.name, 'package.json'), {
      name: p.name,
      version: '1.0.0',
    });

    if (p.skillAllowlist) {
      for (const skillName of p.skillAllowlist) {
        mkdirSync(join(root, 'plugins', p.name, 'skills', skillName), {
          recursive: true,
        });
        const body = p.skillBody ?? `Body content for ${skillName}.`;
        writeFileSync(
          join(root, 'plugins', p.name, 'skills', skillName, 'SKILL.md'),
          `---\nname: ${skillName}\ndescription: "Skill ${skillName}"\n---\n\n${body}\n`,
          'utf8'
        );
      }
    }
  }

  return root;
}

function makeAjv() {
  const ajv = new Ajv({
    strict: true,
    allErrors: true,
    verbose: true,
    allowUnionTypes: true,
  });
  addFormats(ajv);
  return ajv;
}

function loadFixture(root: string) {
  const catalogResult = loadCatalog(join(root, 'catalog'));
  const sourcesResult = loadPluginSources(
    join(root, 'catalog'),
    catalogResult.data.pluginOrder
  );
  return { catalog: catalogResult.data, sources: sourcesResult.sources };
}

describe('validateArtifacts — valid pass', () => {
  it('a clean generated fixture passes with zero errors', () => {
    const root = makeFixtureRoot([{ name: 'p1', cursorEnabled: true }]);
    generateManifests({ mode: 'apply', rootDir: root });
    const { catalog, sources } = loadFixture(root);
    const errors = validateArtifacts({
      rootDir: root,
      catalog,
      sources,
      ajv: makeAjv(),
      schemasDir: SCHEMAS_DIR,
    });
    expect(errors).toEqual([]);
  });
});

describe('validateArtifacts — schema violations', () => {
  it('fails when the manifest is hand-corrupted to violate the schema', () => {
    const root = makeFixtureRoot([{ name: 'p1', cursorEnabled: true }]);
    generateManifests({ mode: 'apply', rootDir: root });
    const manifestPath = join(
      root,
      'plugins',
      'p1',
      '.cursor-plugin',
      'plugin.json'
    );
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.name = 'Not Kebab Case!';
    writeJson(manifestPath, manifest);

    const { catalog, sources } = loadFixture(root);
    const errors = validateArtifacts({
      rootDir: root,
      catalog,
      sources,
      ajv: makeAjv(),
      schemasDir: SCHEMAS_DIR,
    });
    expect(errors.some((e: string) => e.includes('ERROR-CURSOR-002'))).toBe(
      true
    );
  });

  it('fails when the manifest carries an unknown top-level key', () => {
    const root = makeFixtureRoot([{ name: 'p1', cursorEnabled: true }]);
    generateManifests({ mode: 'apply', rootDir: root });
    const manifestPath = join(
      root,
      'plugins',
      'p1',
      '.cursor-plugin',
      'plugin.json'
    );
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.interface = { displayName: 'P1', category: 'automation' }; // codex-style nesting, rejected upstream
    writeJson(manifestPath, manifest);

    const { catalog, sources } = loadFixture(root);
    const errors = validateArtifacts({
      rootDir: root,
      catalog,
      sources,
      ajv: makeAjv(),
      schemasDir: SCHEMAS_DIR,
    });
    expect(errors.some((e: string) => e.includes('ERROR-CURSOR-002'))).toBe(
      true
    );
  });

  it('fails when the root marketplace is missing but a plugin is enabled', () => {
    const root = makeFixtureRoot([{ name: 'p1', cursorEnabled: true }]);
    generateManifests({ mode: 'apply', rootDir: root });
    rmSync(join(root, '.cursor-plugin', 'marketplace.json'));

    const { catalog, sources } = loadFixture(root);
    const errors = validateArtifacts({
      rootDir: root,
      catalog,
      sources,
      ajv: makeAjv(),
      schemasDir: SCHEMAS_DIR,
    });
    expect(errors.some((e: string) => e.includes('ERROR-CURSOR-001'))).toBe(
      true
    );
  });
});

describe('runExposureLint — Claude-only construct detection', () => {
  const cases: { name: string; body: string; expectSubstring: string }[] = [
    {
      name: '$ARGUMENTS',
      body: 'Uses $ARGUMENTS to read input.',
      expectSubstring: 'claude-argument-interpolation',
    },
    {
      name: '.claude/ path',
      body: 'Writes to .claude/settings.json.',
      expectSubstring: 'claude-config-dir-write',
    },
    {
      name: 'CLAUDE_ env var',
      body: 'Reads ${CLAUDE_PLUGIN_ROOT} for the plugin dir.',
      expectSubstring: 'claude-env-var-reference',
    },
    {
      name: 'subagent_type',
      body: 'Pass subagent_type: "example" to Task.',
      expectSubstring: 'agent-reference',
    },
    {
      name: 'userConfig',
      body: 'Reads userConfig for the setting.',
      expectSubstring: 'user-config-reference',
    },
  ];

  for (const c of cases) {
    it(`catches ${c.name} in an exposed skill`, () => {
      const root = makeFixtureRoot([
        {
          name: 'p1',
          cursorEnabled: true,
          skillAllowlist: ['demo'],
          skillBody: c.body,
        },
      ]);
      generateManifests({ mode: 'apply', rootDir: root });
      const { catalog, sources } = loadFixture(root);
      const errors = runExposureLint({ rootDir: root, catalog, sources });
      expect(errors.some((e: string) => e.includes(c.expectSubstring))).toBe(
        true
      );
      expect(errors.every((e: string) => e.includes('ERROR-CURSOR-005'))).toBe(
        true
      );
    });
  }

  it('catches a hard-coded mcp__plugin_* tool name naming a real server', () => {
    // yellow-devin ships a real deepwiki MCP server on the live repo — reuse
    // its registered name via a fixture that mirrors a Claude-enabled
    // sibling plugin declaring an mcpServers block, so the registry the
    // exposure lint builds from committed .claude-plugin/plugin.json files
    // has something real to match against.
    const root = mkdtempSync(join(tmpdir(), 'yellow-validate-cursor-mcp-'));
    fixtureRoots.push(root);
    mkdirSync(join(root, 'catalog', 'plugins'), { recursive: true });
    writeJson(join(root, 'catalog', 'catalog.json'), {
      name: 'yellow-plugins',
      description: 'Fixture',
      owner: { name: 'Fixture Owner' },
      metadata: { description: 'Fixture', version: '1.0.0' },
      pluginOrder: ['mcp-owner', 'cursor-plugin'],
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
        cursor: { name: 'yellow-plugins' },
      },
    });
    writeJson(join(root, 'catalog', 'plugins', 'mcp-owner.json'), {
      $schema: 'https://json.schemastore.org/claude-code-plugin-manifest.json',
      description: 'Owns an MCP server.',
      author: { name: 'Fixture Owner' },
      homepage: 'https://example.com',
      repository: 'https://example.com/repo',
      license: 'MIT',
      keywords: ['fixture'],
      mcpServers: { widget: { command: 'node', args: ['server.js'] } },
      marketplace: { category: 'development', source: './plugins/mcp-owner' },
      targets: { claude: true, codex: { enabled: false } },
    });
    mkdirSync(join(root, 'plugins', 'mcp-owner'), { recursive: true });
    writeJson(join(root, 'plugins', 'mcp-owner', 'package.json'), {
      name: 'mcp-owner',
      version: '1.0.0',
    });

    writeJson(join(root, 'catalog', 'plugins', 'cursor-plugin.json'), {
      $schema: 'https://json.schemastore.org/claude-code-plugin-manifest.json',
      description: 'Leaks a hard-coded MCP tool name.',
      author: { name: 'Fixture Owner' },
      homepage: 'https://example.com',
      repository: 'https://example.com/repo',
      license: 'MIT',
      keywords: ['fixture'],
      marketplace: {
        category: 'development',
        source: './plugins/cursor-plugin',
      },
      targets: {
        claude: true,
        codex: { enabled: false },
        cursor: {
          enabled: true,
          interface: { displayName: 'Cursor Plugin', category: 'automation' },
          skillAllowlist: ['demo'],
          componentPaths: { skills: './cursor/skills' },
        },
      },
    });
    mkdirSync(join(root, 'plugins', 'cursor-plugin'), { recursive: true });
    writeJson(join(root, 'plugins', 'cursor-plugin', 'package.json'), {
      name: 'cursor-plugin',
      version: '1.0.0',
    });
    mkdirSync(join(root, 'plugins', 'cursor-plugin', 'skills', 'demo'), {
      recursive: true,
    });
    writeFileSync(
      join(root, 'plugins', 'cursor-plugin', 'skills', 'demo', 'SKILL.md'),
      '---\nname: demo\ndescription: "Demo"\n---\n\nCall mcp__plugin_mcp-owner_widget__do_thing to proceed.\n',
      'utf8'
    );

    const genResult = generateManifests({ mode: 'apply', rootDir: root });
    expect(genResult.status).toBe('ok');
    const { catalog, sources } = loadFixture(root);
    const errors = runExposureLint({ rootDir: root, catalog, sources });
    expect(
      errors.some((e: string) => e.includes('hardcoded-mcp-tool-name'))
    ).toBe(true);
  });

  it('does not flag ordinary prose about paths or plugins', () => {
    const root = makeFixtureRoot([
      {
        name: 'p1',
        cursorEnabled: true,
        skillAllowlist: ['demo'],
        skillBody:
          'This skill reads config from /etc and mentions "the plugin" in prose.',
      },
    ]);
    generateManifests({ mode: 'apply', rootDir: root });
    const { catalog, sources } = loadFixture(root);
    const errors = runExposureLint({ rootDir: root, catalog, sources });
    expect(errors).toEqual([]);
  });
});

describe('lifecycle-leak detection', () => {
  it('fires when a generated artifact is hand-edited to carry a "lifecycle" key', () => {
    const root = makeFixtureRoot([{ name: 'p1', cursorEnabled: true }]);
    generateManifests({ mode: 'apply', rootDir: root });
    const manifestPath = join(
      root,
      'plugins',
      'p1',
      '.cursor-plugin',
      'plugin.json'
    );
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.lifecycle = { status: 'legacy' };
    writeJson(manifestPath, manifest);

    const { catalog, sources } = loadFixture(root);
    const errors = scanLifecycleLeaks({ rootDir: root, catalog, sources });
    expect(errors.some((e: string) => e.includes('ERROR-CURSOR-007'))).toBe(
      true
    );
    expect(
      errors.some((e: string) => e.includes('.cursor-plugin/plugin.json'))
    ).toBe(true);
  });

  it('is clean on a normally-generated fixture', () => {
    const root = makeFixtureRoot([{ name: 'p1', cursorEnabled: true }]);
    generateManifests({ mode: 'apply', rootDir: root });
    const { catalog, sources } = loadFixture(root);
    expect(scanLifecycleLeaks({ rootDir: root, catalog, sources })).toEqual([]);
  });

  it('still runs (and stays clean) when no plugin is Cursor-enabled', () => {
    const root = makeFixtureRoot([{ name: 'p1', cursorEnabled: false }], null);
    generateManifests({ mode: 'apply', rootDir: root });
    const { catalog, sources } = loadFixture(root);
    expect(scanLifecycleLeaks({ rootDir: root, catalog, sources })).toEqual([]);
  });
});

describe('no-cursor-config clean exit', () => {
  it('validateArtifacts and runExposureLint report zero errors when zero plugins are Cursor-enabled', () => {
    const root = makeFixtureRoot([{ name: 'p1', cursorEnabled: false }], null);
    generateManifests({ mode: 'apply', rootDir: root });
    const { catalog, sources } = loadFixture(root);
    const artifactErrors = validateArtifacts({
      rootDir: root,
      catalog,
      sources,
      ajv: makeAjv(),
      schemasDir: SCHEMAS_DIR,
    });
    const exposureErrors = runExposureLint({ rootDir: root, catalog, sources });
    expect(artifactErrors).toEqual([]);
    expect(exposureErrors).toEqual([]);
  });

  it('is clean when the root config is absent entirely (no "cursor" key on catalog.targets)', () => {
    const root = makeFixtureRoot([{ name: 'p1', cursorEnabled: false }], null);
    generateManifests({ mode: 'apply', rootDir: root });
    const { catalog, sources } = loadFixture(root);
    const artifactErrors = validateArtifacts({
      rootDir: root,
      catalog,
      sources,
      ajv: makeAjv(),
      schemasDir: SCHEMAS_DIR,
    });
    expect(artifactErrors).toEqual([]);
  });
});
