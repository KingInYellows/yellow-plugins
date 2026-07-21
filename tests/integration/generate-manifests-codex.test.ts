/**
 * Codex-target generator behavior suite (R43 partial: codex-generator-tests).
 *
 * Complements tests/integration/generate-manifests.test.ts (which covers
 * the Claude-target byte-identity/determinism suite unchanged since shell
 * 01) with the Codex-specific scenarios R43 calls out: enablement
 * filtering, four-way version drift, empty-state marketplace, path
 * portability, symlink/path-escape rejection, and the hook-authority rule
 * (R20). Every scenario runs against a minimal, self-contained temp
 * fixture (not the full 17-plugin repo fixture) so each test controls its
 * own `targets.codex` shape precisely.
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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Ajv = require('ajv');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const addFormats = require('ajv-formats');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { generateManifests } = require('../../scripts/generate-manifests.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { loadCatalog, loadPluginSources } = require('../../scripts/lib/generate/catalog-reader.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { validateArtifacts } = require('../../scripts/validate-codex.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { computeCodexTwoWayDrift, computeCodexMarketplaceIssues } = require('../../scripts/validate-versions.js');

const fixtureRoots: string[] = [];
afterAll(() => {
  for (const root of fixtureRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

interface PluginFixtureOpts {
  name: string;
  version?: string;
  codexEnabled?: boolean;
  includeHooks?: boolean;
  skillAllowlist?: string[];
  componentPathsSkills?: string;
  hooks?: Record<string, unknown>;
  skills?: Record<string, { name: string; description: string; extraFrontmatter?: Record<string, unknown> }>;
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/** Minimal, self-contained fixture — NOT the full 17-plugin repo fixture. */
function makeCodexFixtureRoot(plugins: PluginFixtureOpts[]): string {
  const root = mkdtempSync(join(tmpdir(), 'yellow-generate-codex-'));
  fixtureRoots.push(root);

  mkdirSync(join(root, 'catalog', 'plugins'), { recursive: true });
  writeJson(join(root, 'catalog', 'catalog.json'), {
    name: 'yellow-plugins',
    description: 'Fixture catalog',
    owner: { name: 'Fixture Owner' },
    metadata: { description: 'Fixture', version: '1.0.0' },
    pluginOrder: plugins.map((p) => p.name),
    targets: {
      claude: { marketplaceSchema: 'https://anthropic.com/claude-code/marketplace.schema.json' },
      codex: {
        displayName: 'Yellow Plugins',
        category: 'Developer Tools',
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
      },
    },
  });

  for (const p of plugins) {
    const version = p.version ?? '1.0.0';
    const codexTarget: Record<string, unknown> = { enabled: Boolean(p.codexEnabled) };
    if (p.codexEnabled) {
      codexTarget.interface = { displayName: p.name, category: 'Developer Tools' };
      if (p.includeHooks !== undefined) {
        codexTarget.includeHooks = p.includeHooks;
      }
      if (p.skillAllowlist) {
        codexTarget.skillAllowlist = p.skillAllowlist;
      }
      // Decoupled from skillAllowlist so a fixture can set componentPaths.skills
      // without an allowlist (regression coverage for the "skills path with no
      // allowlisted skills" gap below).
      if (p.skillAllowlist || p.componentPathsSkills !== undefined) {
        codexTarget.componentPaths = { skills: p.componentPathsSkills ?? './codex/skills' };
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
      ...(p.hooks ? { hooks: p.hooks } : {}),
      marketplace: { category: 'development', source: `./plugins/${p.name}` },
      targets: { claude: true, codex: codexTarget },
    });

    mkdirSync(join(root, 'plugins', p.name), { recursive: true });
    writeJson(join(root, 'plugins', p.name, 'package.json'), { name: p.name, version });

    if (p.skills) {
      for (const [skillDir, skill] of Object.entries(p.skills)) {
        mkdirSync(join(root, 'plugins', p.name, 'skills', skillDir), { recursive: true });
        const frontmatter = { name: skill.name, description: skill.description, ...skill.extraFrontmatter };
        const fmLines = Object.entries(frontmatter)
          .map(([k, v]) => `${k}: ${typeof v === 'string' ? JSON.stringify(v) : v}`)
          .join('\n');
        writeFileSync(
          join(root, 'plugins', p.name, 'skills', skillDir, 'SKILL.md'),
          `---\n${fmLines}\n---\n\nBody content for ${skill.name}.\n`,
          'utf8'
        );
      }
    }
  }

  return root;
}

describe('Codex enablement filtering', () => {
  it('a codex.enabled:true plugin gets Codex artifacts; a false one does not', () => {
    const root = makeCodexFixtureRoot([
      { name: 'enabled-plugin', codexEnabled: true },
      { name: 'disabled-plugin', codexEnabled: false },
    ]);
    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('ok');
    expect(result.written).toContain('plugins/enabled-plugin/.codex-plugin/plugin.json');
    expect(result.written).not.toContain('plugins/disabled-plugin/.codex-plugin/plugin.json');

    const codexMarketplace = JSON.parse(readFileSync(join(root, '.agents', 'plugins', 'marketplace.json'), 'utf8'));
    expect(codexMarketplace.plugins.map((p: { name: string }) => p.name)).toEqual(['enabled-plugin']);
  });
});

describe('empty-state marketplace', () => {
  it('emits plugins: [] when no plugin is Codex-enabled, and is byte-identical on regeneration', () => {
    const root = makeCodexFixtureRoot([{ name: 'claude-only-plugin', codexEnabled: false }]);
    const first = generateManifests({ mode: 'apply', rootDir: root });
    expect(first.status).toBe('ok');
    const marketplacePath = join(root, '.agents', 'plugins', 'marketplace.json');
    const data = JSON.parse(readFileSync(marketplacePath, 'utf8'));
    expect(data.plugins).toEqual([]);

    const second = generateManifests({ mode: 'apply', rootDir: root });
    expect(second.status).toBe('ok');
    expect(second.written).toEqual([]); // byte-identical, nothing rewritten
  });
});

describe('path portability — plugin/skill names', () => {
  it('rejects a skill name containing spaces, backslashes, or Windows-drive syntax', () => {
    const root = makeCodexFixtureRoot([
      {
        name: 'exotic-plugin',
        codexEnabled: true,
        skillAllowlist: ['bad name with spaces', 'C:\\bad\\backslash', '..\\wsl\\escape'],
      },
    ]);
    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('error');
    expect(result.errors.some((e: string) => e.includes('allowlist'))).toBe(true);
  });
});

describe('symlink and path-escape rejection (mirrors catalog-reader.js)', () => {
  it('rejects a symlinked skill SKILL.md', () => {
    const root = makeCodexFixtureRoot([
      { name: 'symlink-plugin', codexEnabled: true, skillAllowlist: ['linked-skill'] },
    ]);
    // Create a real skill elsewhere, then symlink it into the allowlisted slot.
    mkdirSync(join(root, 'plugins', 'symlink-plugin', 'skills', 'real-skill'), { recursive: true });
    writeFileSync(
      join(root, 'plugins', 'symlink-plugin', 'skills', 'real-skill', 'SKILL.md'),
      '---\nname: real-skill\ndescription: "target"\n---\n\nBody.\n',
      'utf8'
    );
    mkdirSync(join(root, 'plugins', 'symlink-plugin', 'skills', 'linked-skill'), { recursive: true });
    symlinkSync(
      join(root, 'plugins', 'symlink-plugin', 'skills', 'real-skill', 'SKILL.md'),
      join(root, 'plugins', 'symlink-plugin', 'skills', 'linked-skill', 'SKILL.md')
    );

    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('error');
    expect(result.errors.some((e: string) => e.includes('symlinked skill files are not allowed'))).toBe(true);
  });

  it('rejects a path-escaping skill name in the allowlist', () => {
    const root = makeCodexFixtureRoot([
      { name: 'escape-plugin', codexEnabled: true, skillAllowlist: ['../../../etc/passwd'] },
    ]);
    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('error');
    expect(result.errors.some((e: string) => e.includes('allowlist'))).toBe(true);
  });

  it('rejects a symlinked skill directory', () => {
    const root = makeCodexFixtureRoot([
      { name: 'symlinked-dir-plugin', codexEnabled: true, skillAllowlist: ['linked-skill-dir'] },
    ]);
    // Real skill content lives outside the allowlisted plugin's skills/ tree;
    // the allowlisted <skillName> slot is itself a symlink to it.
    const external = mkdtempSync(join(tmpdir(), 'yellow-generate-codex-external-'));
    fixtureRoots.push(external);
    writeFileSync(
      join(external, 'SKILL.md'),
      '---\nname: real-skill\ndescription: "target"\n---\n\nBody.\n',
      'utf8'
    );
    mkdirSync(join(root, 'plugins', 'symlinked-dir-plugin', 'skills'), { recursive: true });
    symlinkSync(external, join(root, 'plugins', 'symlinked-dir-plugin', 'skills', 'linked-skill-dir'));

    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('error');
    expect(result.errors.some((e: string) => e.includes('symlinked skill directories') && e.includes('linked-skill-dir'))).toBe(true);
  });

  it('rejects a symlinked skills/ ancestor directory (not just the skillName leaf)', () => {
    // Fresh evidence (round 3): lstat(skillDir) alone only rejects skillDir
    // itself being a symlink. When plugins/<name>/skills is the symlink,
    // the OS resolves that ancestor while walking the path to skillDir, so
    // skillDir's own lstat sees a perfectly ordinary directory on the far
    // side of the symlink. Live repro: symlink `skills/` itself (not a
    // skillName subdirectory) to an external directory containing a real
    // allowlisted skill.
    const root = makeCodexFixtureRoot([
      { name: 'symlinked-ancestor-plugin', codexEnabled: true, skillAllowlist: ['real-skill'] },
    ]);
    const external = mkdtempSync(join(tmpdir(), 'yellow-generate-codex-external-'));
    fixtureRoots.push(external);
    mkdirSync(join(external, 'real-skill'), { recursive: true });
    writeFileSync(
      join(external, 'real-skill', 'SKILL.md'),
      '---\nname: real-skill\ndescription: "target"\n---\n\nBody.\n',
      'utf8'
    );
    // plugins/symlinked-ancestor-plugin/skills is the symlink — its child
    // real-skill/ directory is an ordinary directory on the external side.
    symlinkSync(external, join(root, 'plugins', 'symlinked-ancestor-plugin', 'skills'));

    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('error');
    expect(result.errors.some((e: string) => e.includes('symlinked skill directories') && e.includes('real-skill'))).toBe(true);
  });

  it('rejects an in-plugin symlinked skill directory (allowlisted name aliasing a non-allowlisted one)', () => {
    // Fresh evidence: the realpath containment check only rejects
    // skillDirReal values OUTSIDE pluginRootReal, so an allowlisted
    // skillName that is itself a symlink to a DIFFERENT, non-allowlisted
    // directory INSIDE the same plugin root (e.g. skills/allowed ->
    // skills/private) resolves to a path that still starts with
    // pluginRootReal + sep, bypassing the allowlist guarantee entirely for
    // in-plugin symlink indirection. Live repro: symlink an allowlisted
    // skill directory at a non-allowlisted sibling directory, both under
    // the same plugin's skills/.
    const root = makeCodexFixtureRoot([
      { name: 'in-plugin-symlink-plugin', codexEnabled: true, skillAllowlist: ['allowed'] },
    ]);
    mkdirSync(join(root, 'plugins', 'in-plugin-symlink-plugin', 'skills', 'private'), { recursive: true });
    writeFileSync(
      join(root, 'plugins', 'in-plugin-symlink-plugin', 'skills', 'private', 'SKILL.md'),
      '---\nname: private\ndescription: "target"\n---\n\nBody.\n',
      'utf8'
    );
    symlinkSync(
      join(root, 'plugins', 'in-plugin-symlink-plugin', 'skills', 'private'),
      join(root, 'plugins', 'in-plugin-symlink-plugin', 'skills', 'allowed')
    );

    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('error');
    expect(
      result.errors.some((e: string) => e.includes('symlinked skill directories') && e.includes('allowed'))
    ).toBe(true);
  });

  it('rejects a symlinked skills/ ancestor that redirects INSIDE the same plugin root', () => {
    // Fresh evidence (round 4): the realpath containment check only rejected
    // skillDirReal values OUTSIDE pluginRootReal. When plugins/<name>/skills
    // itself is a symlink to a DIFFERENT directory still inside the same
    // plugin root (e.g. skills -> other-content), the resolved skillDir
    // still starts with pluginRootReal + sep, so the old containment check
    // passed it through — unlike the earlier "symlinked skills/ ancestor"
    // test (external target) and "in-plugin symlinked skill directory" test
    // (skillName leaf itself symlinked), neither of which cover an ancestor
    // symlink redirecting to another in-plugin directory. Live repro:
    // symlink plugins/<name>/skills to a sibling plugins/<name>/other-content
    // directory containing an allowlisted-named skill with different content.
    const root = makeCodexFixtureRoot([
      { name: 'in-plugin-ancestor-plugin', codexEnabled: true, skillAllowlist: ['allowed'] },
    ]);
    mkdirSync(join(root, 'plugins', 'in-plugin-ancestor-plugin', 'other-content', 'allowed'), { recursive: true });
    writeFileSync(
      join(root, 'plugins', 'in-plugin-ancestor-plugin', 'other-content', 'allowed', 'SKILL.md'),
      '---\nname: allowed\ndescription: "smuggled"\n---\n\nBody.\n',
      'utf8'
    );
    symlinkSync(
      join(root, 'plugins', 'in-plugin-ancestor-plugin', 'other-content'),
      join(root, 'plugins', 'in-plugin-ancestor-plugin', 'skills')
    );

    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('error');
    expect(
      result.errors.some((e: string) => e.includes('symlinked skill directories') && e.includes('allowed'))
    ).toBe(true);
  });
});

describe('skill frontmatter "name" vs. allowlisted directory name mismatch', () => {
  it('rejects a SKILL.md whose frontmatter "name" disagrees with its allowlisted directory name', () => {
    // The allowlist and the stale-artifact sweep both reason about the
    // directory name only — a catalog typo or rename in SKILL.md's
    // frontmatter "name" would otherwise expose the wrong skill name under
    // Codex while both layers still believe "foo" was copied.
    const root = makeCodexFixtureRoot([
      {
        name: 'name-mismatch-plugin',
        codexEnabled: true,
        skillAllowlist: ['foo'],
        skills: { foo: { name: 'bar', description: 'Mismatched name.' } },
      },
    ]);
    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('error');
    expect(
      result.errors.some(
        (e: string) => e.includes('frontmatter "name"') && e.includes('"bar"') && e.includes('"foo"')
      )
    ).toBe(true);
  });
});

describe('componentPaths.skills emptiness validation', () => {
  it('rejects a whitespace-only componentPaths.skills value (not just fully empty)', () => {
    // A whitespace-only string like "   " is truthy, so a bare `.length > 0`
    // check lets it through, silently reproducing the same
    // unreachable-skills failure mode a fully empty string causes:
    // buildCodexSkillTree still writes the copied skills somewhere, but the
    // declared componentPaths.skills value is unusable as a real path.
    const root = makeCodexFixtureRoot([
      {
        name: 'whitespace-skills-plugin',
        codexEnabled: true,
        skillAllowlist: ['real-skill'],
        componentPathsSkills: '   ',
      },
    ]);
    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('error');
    expect(
      result.errors.some((e: string) => e.includes('componentPaths.skills') && e.includes('non-empty string'))
    ).toBe(true);
  });
});

describe('manifest "skills" field omitted without allowlisted skills', () => {
  it('omits manifest.skills when componentPaths.skills is set but skillAllowlist is missing', () => {
    // buildCodexSkillTree() only copies skills from a non-empty
    // skillAllowlist; a componentPaths.skills value with no allowlist would
    // otherwise make buildCodexPluginManifest() point Codex at a skills
    // directory that is never written.
    const root = makeCodexFixtureRoot([
      { name: 'no-allowlist-plugin', codexEnabled: true, componentPathsSkills: './codex/skills' },
    ]);
    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('ok');
    const manifest = JSON.parse(
      readFileSync(join(root, 'plugins', 'no-allowlist-plugin', '.codex-plugin', 'plugin.json'), 'utf8')
    );
    expect(manifest.skills).toBeUndefined();
  });
});

describe('stale-artifact sweep symlink containment (mirrors buildCodexSkillTree)', () => {
  it('rejects a symlinked componentPaths.skills ancestor instead of sweeping through it', () => {
    // The stale-artifact sweep's assertWithinRoot() check is purely lexical
    // (string-prefix comparison) — it never touches the filesystem, so a
    // componentPaths.skills value that resolves cleanly on paper can still
    // escape the plugin directory if an ancestor path component (e.g. the
    // default './codex' directory itself) is actually a symlink on disk.
    // Live repro: symlink plugins/<name>/codex to an external directory
    // that has its own skills/<name>/SKILL.md underneath it, then confirm
    // the sweep neither enumerates nor deletes anything under it.
    const root = makeCodexFixtureRoot([{ name: 'sweep-symlink-plugin', codexEnabled: false }]);
    const external = mkdtempSync(join(tmpdir(), 'yellow-generate-codex-external-'));
    fixtureRoots.push(external);
    mkdirSync(join(external, 'skills', 'evil-skill'), { recursive: true });
    const markerPath = join(external, 'skills', 'evil-skill', 'SKILL.md');
    writeFileSync(markerPath, '---\nname: evil-skill\ndescription: "target"\n---\n\nBody.\n', 'utf8');
    symlinkSync(external, join(root, 'plugins', 'sweep-symlink-plugin', 'codex'));

    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('error');
    expect(
      result.errors.some((e: string) => e.includes('componentPaths.skills') && e.includes('symlink'))
    ).toBe(true);
    // The file outside the plugin directory must survive untouched.
    expect(readFileSync(markerPath, 'utf8')).toContain('evil-skill');
  });
});

describe('stale-artifact sweep source-skills overlap rejection', () => {
  it("rejects componentPaths.skills equal to the plugin's own source skills/ directory", () => {
    // Staying within the plugin's own directory (the containment check
    // above) is not enough on its own: componentPaths.skills set to the
    // Claude-side source "skills/" dir itself is also "within the plugin",
    // but would make the stale sweep enumerate every real
    // plugins/<name>/skills/<skill>/SKILL.md as a stale generated artifact
    // and delete it. The sweep runs unconditionally (not gated on
    // codex.enabled), so this must be rejected regardless of enablement.
    const root = makeCodexFixtureRoot([
      {
        name: 'source-overlap-plugin',
        codexEnabled: true,
        skillAllowlist: ['allowed-skill'],
        componentPathsSkills: 'skills',
        skills: { 'allowed-skill': { name: 'allowed-skill', description: 'Allowed.' } },
      },
    ]);
    const result = generateManifests({ mode: 'check', rootDir: root });
    expect(result.status).toBe('error');
    expect(
      result.errors.some((e: string) => e.includes('componentPaths.skills') && e.includes('source'))
    ).toBe(true);
  });
});

describe('stale-artifact sweep source-skills overlap rejection via symlink indirection', () => {
  it('rejects componentPaths.skills reached through a symlink that resolves to the source skills/ directory', () => {
    // The lexical overlap check above only compares the unresolved
    // componentPaths.skills string against the source "skills/" path — it
    // is blind to a symlink indirection where the resolved (real) skills
    // directory equals the source skills/ dir even though the two strings
    // never match lexically (e.g. "codex/skills" symlinked to "skills").
    // The sweep runs unconditionally (not gated on codex.enabled), so a
    // real plugins/<name>/skills/<skill>/SKILL.md must survive untouched.
    const root = makeCodexFixtureRoot([
      {
        name: 'symlink-overlap-plugin',
        codexEnabled: false,
        skills: { 'real-skill': { name: 'real-skill', description: 'Real.' } },
      },
    ]);
    const sourceSkillsDir = join(root, 'plugins', 'symlink-overlap-plugin', 'skills');
    const markerPath = join(sourceSkillsDir, 'real-skill', 'SKILL.md');
    mkdirSync(join(root, 'plugins', 'symlink-overlap-plugin', 'codex'), { recursive: true });
    symlinkSync(sourceSkillsDir, join(root, 'plugins', 'symlink-overlap-plugin', 'codex', 'skills'));

    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('error');
    expect(
      result.errors.some((e: string) => e.includes('componentPaths.skills') && e.includes('symlink'))
    ).toBe(true);
    // The real source skill file must survive untouched — not deleted as a
    // stale generated artifact through the symlink.
    expect(readFileSync(markerPath, 'utf8')).toContain('real-skill');
  });
});

describe('stale-artifact sweep symlink-alias rejection', () => {
  it('flags a symlinked skill entry as stale even when it resolves to a still-expected skill directory', () => {
    // Fresh evidence after the earlier symlink stale-sweep fix: that branch
    // recorded the symlink target's real SKILL.md, not the symlink entry
    // itself. If codex/skills/old is a symlink to an allowlisted directory
    // like codex/skills/current, expectedPaths contains the real
    // current/SKILL.md, so the resolved candidate matched it and the sweep
    // silently skipped "old" — leaving the removed alias in the
    // manifest-declared skills tree while --check reported clean.
    const root = makeCodexFixtureRoot([
      {
        name: 'symlink-alias-plugin',
        codexEnabled: true,
        skillAllowlist: ['current'],
        skills: { current: { name: 'current', description: 'Current skill.' } },
      },
    ]);
    const first = generateManifests({ mode: 'apply', rootDir: root });
    expect(first.status).toBe('ok');

    const skillsDir = join(root, 'plugins', 'symlink-alias-plugin', 'codex', 'skills');
    const currentSkillMd = join(skillsDir, 'current', 'SKILL.md');
    const originalBytes = readFileSync(currentSkillMd, 'utf8');
    // Simulate a leftover alias from a prior generation: a symlink whose
    // target is a directory that IS still expected.
    symlinkSync(join(skillsDir, 'current'), join(skillsDir, 'old'));

    const checked = generateManifests({ mode: 'check', rootDir: root });
    expect(checked.status).toBe('ok');
    expect(
      checked.diffs.some(
        (d: { path: string; state: string }) =>
          d.path === 'plugins/symlink-alias-plugin/codex/skills/old' && d.state === 'stale'
      )
    ).toBe(true);

    const applied = generateManifests({ mode: 'apply', rootDir: root });
    expect(applied.status).toBe('ok');
    expect(applied.written).toContain('plugins/symlink-alias-plugin/codex/skills/old');
    expect(existsSync(join(skillsDir, 'old'))).toBe(false);
    // The real, still-expected skill directory must survive untouched —
    // removal must delete only the symlink alias, never reach through it.
    expect(readFileSync(currentSkillMd, 'utf8')).toBe(originalBytes);
  });
});

describe('generator hook-authority rule (R20)', () => {
  it('a reference-only hooks/hooks.json mirror on disk is never treated as authoritative for either target', () => {
    const inlineHooks = {
      SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: 'bash ${CLAUDE_PLUGIN_ROOT}/real.sh', timeout: 3 }] }],
    };
    const root = makeCodexFixtureRoot([
      { name: 'hook-plugin', codexEnabled: true, hooks: inlineHooks },
    ]);
    // yellow-ci's documented reference-only mirror pattern: a hooks/hooks.json
    // file sitting on disk with DIFFERENT content than the inline `hooks`
    // field. If either emitter ever reads it, the generated output would
    // reflect this decoy content instead of `source.hooks`.
    mkdirSync(join(root, 'plugins', 'hook-plugin', 'hooks'), { recursive: true });
    writeJson(join(root, 'plugins', 'hook-plugin', 'hooks', 'hooks.json'), {
      SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: 'bash DECOY-NEVER-READ.sh', timeout: 99 }] }],
    });

    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('ok');

    const claudeManifest = JSON.parse(
      readFileSync(join(root, 'plugins', 'hook-plugin', '.claude-plugin', 'plugin.json'), 'utf8')
    );
    expect(claudeManifest.hooks).toEqual(inlineHooks);
    expect(JSON.stringify(claudeManifest)).not.toContain('DECOY-NEVER-READ');

    const codexHooks = JSON.parse(
      readFileSync(join(root, 'plugins', 'hook-plugin', 'hooks', 'codex-hooks.json'), 'utf8')
    );
    // codex-hooks.json carries a commandWindows field (same value as
    // command) that source.hooks itself does not — see the commandWindows
    // describe block below for a focused test of that transform.
    expect(codexHooks).toEqual({
      hooks: {
        SessionStart: [
          {
            matcher: '*',
            hooks: [
              {
                type: 'command',
                command: 'bash ${CLAUDE_PLUGIN_ROOT}/real.sh',
                commandWindows: 'bash ${CLAUDE_PLUGIN_ROOT}/real.sh',
                timeout: 3,
              },
            ],
          },
        ],
      },
    });
    expect(JSON.stringify(codexHooks)).not.toContain('DECOY-NEVER-READ');

    const codexManifest = JSON.parse(
      readFileSync(join(root, 'plugins', 'hook-plugin', '.codex-plugin', 'plugin.json'), 'utf8')
    );
    expect(codexManifest.hooks).toBe('./hooks/codex-hooks.json');
  });
});

describe('commandWindows emission (Windows command override)', () => {
  it('adds commandWindows immediately after command on every hook definition, unchanged from command', () => {
    // Node entrypoints are platform-uniform (see entrypoint-claude.js's
    // header comment) — commandWindows is always the same string as command,
    // never a distinct Windows-specific invocation, for every hook this repo
    // currently ships.
    const inlineHooks = {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/entrypoint-claude.js --hook check-git-push', timeout: 1 }],
        },
      ],
      PostToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/entrypoint-claude.js --hook check-commit-message', timeout: 1 }],
        },
      ],
    };
    const root = makeCodexFixtureRoot([{ name: 'windows-hook-plugin', codexEnabled: true, hooks: inlineHooks }]);

    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('ok');

    const codexHooks = JSON.parse(readFileSync(join(root, 'plugins', 'windows-hook-plugin', 'hooks', 'codex-hooks.json'), 'utf8'));
    expect(codexHooks.hooks.PreToolUse[0].hooks[0].commandWindows).toBe(inlineHooks.PreToolUse[0].hooks[0].command);
    expect(codexHooks.hooks.PostToolUse[0].hooks[0].commandWindows).toBe(inlineHooks.PostToolUse[0].hooks[0].command);
    // Key order: commandWindows sits immediately after command.
    expect(Object.keys(codexHooks.hooks.PreToolUse[0].hooks[0])).toEqual(['type', 'command', 'commandWindows', 'timeout']);

    // Determinism: regenerating (a second apply run) produces byte-identical
    // output — required for Codex's hash-keyed hook trust to stay stable.
    const firstBytes = readFileSync(join(root, 'plugins', 'windows-hook-plugin', 'hooks', 'codex-hooks.json'), 'utf8');
    const second = generateManifests({ mode: 'apply', rootDir: root });
    expect(second.status).toBe('ok');
    const secondBytes = readFileSync(join(root, 'plugins', 'windows-hook-plugin', 'hooks', 'codex-hooks.json'), 'utf8');
    expect(secondBytes).toBe(firstBytes);
  });
});

describe('targets.codex.includeHooks opt-out (R22)', () => {
  it('omits hooks/codex-hooks.json and the manifest "hooks" field when includeHooks is false', () => {
    // R22: a plugin can need Codex enablement (skills) while its Claude-side
    // hooks (e.g. background-compounding SessionStart/Stop) must stay out of
    // its Codex exposure entirely. Without this opt-out, R20's unconditional
    // carryover would silently include them the moment codex.enabled flips.
    const inlineHooks = {
      SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: 'bash ${CLAUDE_PLUGIN_ROOT}/real.sh', timeout: 3 }] }],
    };
    const root = makeCodexFixtureRoot([
      { name: 'no-hooks-plugin', codexEnabled: true, includeHooks: false, hooks: inlineHooks },
    ]);

    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('ok');
    expect(result.written).not.toContain('plugins/no-hooks-plugin/hooks/codex-hooks.json');
    expect(existsSync(join(root, 'plugins', 'no-hooks-plugin', 'hooks', 'codex-hooks.json'))).toBe(false);

    // The Claude manifest is unaffected — its own hooks stay intact.
    const claudeManifest = JSON.parse(
      readFileSync(join(root, 'plugins', 'no-hooks-plugin', '.claude-plugin', 'plugin.json'), 'utf8')
    );
    expect(claudeManifest.hooks).toEqual(inlineHooks);

    const codexManifest = JSON.parse(
      readFileSync(join(root, 'plugins', 'no-hooks-plugin', '.codex-plugin', 'plugin.json'), 'utf8')
    );
    expect(codexManifest.hooks).toBeUndefined();
  });

  it('rejects a non-boolean includeHooks instead of silently falling through to the default carryover behavior', () => {
    // buildCodexHookConfig() only skips carryover on a strict `=== false`
    // check, so a typo'd string value ("false") would otherwise pass
    // through undetected and carry hooks over anyway.
    const root = makeCodexFixtureRoot([{ name: 'bad-includehooks-plugin', codexEnabled: true }]);
    const catalogPath = join(root, 'catalog', 'plugins', 'bad-includehooks-plugin.json');
    const catalogSource = JSON.parse(readFileSync(catalogPath, 'utf8'));
    catalogSource.targets.codex.includeHooks = 'false';
    writeJson(catalogPath, catalogSource);

    const result = generateManifests({ mode: 'apply', rootDir: root });
    expect(result.status).toBe('error');
    expect(result.errors.some((e: string) => e.includes('includeHooks') && e.includes('boolean'))).toBe(true);
  });
});

describe('validateArtifacts — declared-but-missing hooks file (P2)', () => {
  it('flags a manifest "hooks" pointer whose target file is missing from disk, instead of silently passing', () => {
    const inlineHooks = {
      SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: 'bash ${CLAUDE_PLUGIN_ROOT}/real.sh', timeout: 3 }] }],
    };
    const root = makeCodexFixtureRoot([{ name: 'missing-hooks-plugin', codexEnabled: true, hooks: inlineHooks }]);
    const generated = generateManifests({ mode: 'apply', rootDir: root });
    expect(generated.status).toBe('ok');

    // Simulate a partial/corrupted generation: the manifest still declares
    // the hooks pointer, but the generated file it points at is gone.
    rmSync(join(root, 'plugins', 'missing-hooks-plugin', 'hooks', 'codex-hooks.json'));

    const catalog = loadCatalog(join(root, 'catalog')).data;
    const sources = loadPluginSources(join(root, 'catalog'), catalog.pluginOrder).sources;
    const ajv = new Ajv({ strict: true, allErrors: true, verbose: true, allowUnionTypes: true });
    addFormats(ajv);
    const schemasDir = join(__dirname, '..', '..', 'schemas');

    const errors = validateArtifacts({ rootDir: root, catalog, sources, ajv, schemasDir });
    expect(
      errors.some(
        (e: string) => e.includes('plugins/missing-hooks-plugin/hooks/codex-hooks.json') && e.includes('not found')
      )
    ).toBe(true);
  });
});

describe('four-way version drift (Claude plugin, Codex plugin, catalog track, marketplace snapshot)', () => {
  // The Claude-plugin leg and the catalog-track leg already have dedicated
  // coverage (this file's sibling generate-manifests.test.ts's byte-identity
  // suite, and validate-catalog-track.test.ts's computeTrackViolations
  // suite, both from shell 01) — this block covers the two NEW legs Step 11
  // added: the Codex plugin two-way check and the Codex marketplace
  // snapshot check, both pure/exported from scripts/validate-versions.js.
  it('Codex plugin leg: flags a version mismatch between package.json and .codex-plugin/plugin.json', () => {
    expect(computeCodexTwoWayDrift('1.2.0', '1.1.0')).toContain('expected 1.2.0');
    expect(computeCodexTwoWayDrift('1.2.0', '1.2.0')).toBeNull();
  });

  it('Codex marketplace snapshot leg: flags membership, order, and path drift independently', () => {
    const missing = computeCodexMarketplaceIssues(['a', 'b'], [{ name: 'a', source: { path: './plugins/a' } }]);
    expect(missing.some((i: string) => i.includes('"b"') && i.includes('no entry'))).toBe(true);

    const wrongOrder = computeCodexMarketplaceIssues(
      ['a', 'b'],
      [
        { name: 'b', source: { path: './plugins/b' } },
        { name: 'a', source: { path: './plugins/a' } },
      ]
    );
    expect(wrongOrder.some((i: string) => i.includes('does not match catalog canonical order'))).toBe(true);

    const wrongPath = computeCodexMarketplaceIssues(['a'], [{ name: 'a', source: { path: './plugins/wrong' } }]);
    expect(wrongPath.some((i: string) => i.includes('source.path'))).toBe(true);
  });
});
