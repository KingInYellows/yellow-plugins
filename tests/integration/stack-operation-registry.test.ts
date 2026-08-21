/**
 * Deterministic tests for the provider-operation registry
 * (plugins/yellow-core/lib/stack-operation-registry.js).
 *
 * The registry module itself is dependency-free (no fs/path); THIS file
 * owns the filesystem cross-check GOAL.md requires: "Every registry target
 * resolves to a real skill/command" and "Catalog and runtime provider
 * tables agree." (GOAL.md is archived at
 * plans/complete/2026-08-19-github-stack-end-to-end-authoring-brief.md.)
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { describe, it, expect } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const registry = require('../../plugins/yellow-core/lib/stack-operation-registry.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const providerState = require('../../plugins/yellow-core/lib/stack-provider-state.js');

const {
  PROVIDER_IDS,
  OPERATIONS,
  PRIMITIVES,
  isSupported,
  listOperations,
  listPrimitives,
  getOperation,
  getPrimitive,
} = registry;

const REPO_ROOT = join(__dirname, '..', '..');

/** Resolve a `{plugin, ref}` command entry to the .md file it names. */
function commandFilePath(plugin: string, ref: string): string {
  const segments = ref.split(':');
  const fileName = `${segments[segments.length - 1]}.md`;
  return join(REPO_ROOT, 'plugins', plugin, 'commands', ...segments.slice(0, -1), fileName);
}

describe('registry shape', () => {
  it('declares exactly the nine required neutral operations', () => {
    expect(listOperations().sort()).toEqual(
      ['amend', 'cleanup', 'merge', 'nav', 'plan', 'setup', 'status', 'submit', 'sync'].sort()
    );
  });

  it('declares every operation for both providers, with no third key (no fallback field)', () => {
    for (const name of listOperations()) {
      const entry = OPERATIONS[name];
      expect(Object.keys(entry).sort()).toEqual([...PROVIDER_IDS].sort());
    }
  });

  it('declares every primitive for both providers', () => {
    for (const name of listPrimitives()) {
      const entry = PRIMITIVES[name];
      expect(Object.keys(entry).sort()).toEqual([...PROVIDER_IDS].sort());
    }
  });

  it('getOperation/getPrimitive throw on an unknown name or provider rather than returning undefined silently', () => {
    expect(() => getOperation('deploy', 'graphite')).toThrow(/unknown operation/);
    expect(() => getOperation('setup', 'bitbucket')).toThrow(/unknown provider/);
    expect(() => getPrimitive('teleport', 'github')).toThrow(/unknown primitive/);
  });
});

describe('every operation has an explicit result for every provider (no operation entry is ever undefined)', () => {
  it.each(listOperations())('operation "%s"', (name: string) => {
    for (const providerId of PROVIDER_IDS) {
      const entry = getOperation(name, providerId);
      // Every operation in THIS registry is supported by both providers —
      // there is no `null` entry today. This test still calls
      // isSupported() (rather than a bare truthiness check) so the
      // assertion reads as "this is a supported-operation contract check",
      // and so a future genuinely-unsupported entry fails loudly here
      // instead of silently degrading some other test's coverage.
      expect(isSupported(entry)).toBe(true);
      expect(entry.type).toBe('command');
    }
  });
});

describe('every command-type registry entry resolves to a real file whose frontmatter name matches the ref', () => {
  const commandEntries: Array<{ op: string; providerId: string; entry: { plugin: string; ref: string } }> = [];
  for (const name of listOperations()) {
    for (const providerId of PROVIDER_IDS) {
      const entry = getOperation(name, providerId);
      if (entry && entry.type === 'command') {
        commandEntries.push({ op: name, providerId, entry });
      }
    }
  }

  it('has at least one command entry to check (sanity — an empty list would make every it.each below vacuous)', () => {
    expect(commandEntries.length).toBeGreaterThan(0);
  });

  it.each(commandEntries)('$op / $providerId -> $entry.plugin:$entry.ref', ({ entry }) => {
    const filePath = commandFilePath(entry.plugin, entry.ref);
    expect(existsSync(filePath)).toBe(true);
    const frontmatter = readFileSync(filePath, 'utf8');
    const nameMatch = /^name:\s*(.+)$/m.exec(frontmatter);
    expect(nameMatch).not.toBeNull();
    expect((nameMatch as RegExpExecArray)[1].trim()).toBe(entry.ref);
  });
});

describe('cli-type and adapter-type primitive entries', () => {
  it('every graphite primitive is a real gt subcommand or the shared trunk-metadata primitive', () => {
    const knownGtSubcommands = ['log', 'create', 'checkout', 'modify', 'submit', 'restack', 'continue', 'abort'];
    for (const name of listPrimitives()) {
      const entry = getPrimitive(name, 'graphite');
      if (entry.type === 'cli') {
        expect(entry.bin).toBe('gt');
        expect(knownGtSubcommands).toContain(entry.args[0]);
      } else {
        expect(entry.type).toBe('shared');
      }
    }
  });

  it('every github primitive is an adapter op or the shared trunk-metadata primitive', () => {
    for (const name of listPrimitives()) {
      const entry = getPrimitive(name, 'github');
      expect(['adapter', 'shared']).toContain(entry.type);
    }
  });
});

describe('catalog and runtime provider tables agree', () => {
  it('catalog/plugins/*.json capabilityProvider entries match stack-provider-state.js PROVIDERS', () => {
    for (const provider of providerState.PROVIDERS) {
      const catalogPath = join(REPO_ROOT, 'catalog', 'plugins', `${provider.plugin}.json`);
      const catalogJson = JSON.parse(readFileSync(catalogPath, 'utf8'));
      expect(catalogJson.capabilityProvider).toEqual({ group: 'stacked-pr', id: provider.id });
    }
  });

  it('every registry provider id in OPERATIONS/PRIMITIVES has a corresponding stack-provider-state.js PROVIDERS entry', () => {
    const stateProviderIds = providerState.PROVIDERS.map((p: { id: string }) => p.id).sort();
    expect([...PROVIDER_IDS].sort()).toEqual(stateProviderIds);
  });
});
