/**
 * Integration test: every Codex example under `examples/` validates
 * against its `schemas/codex-*.schema.json` counterpart (R11).
 *
 * Mirrors tests/integration/example-files-schema.test.ts's shape exactly:
 * AjvValidatorFactory + loadSchemaFromFile + prefix-based discovery, plus
 * a dedicated negative-case describe block per schema (matching that
 * file's "tightening — negative cases" blocks).
 *
 * Files tested:
 *   - examples/codex-plugin.example.json       -> schemas/codex-plugin.schema.json
 *   - examples/codex-marketplace.example.json  -> schemas/codex-marketplace.schema.json
 *   - examples/codex-hooks.example.json        -> schemas/codex-hooks.schema.json
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, it, expect, beforeAll } from 'vitest';

import { AjvValidatorFactory } from '../../packages/infrastructure/src/validation/ajvFactory.js';

const REPO_ROOT = resolve(__dirname, '..', '..');
const SCHEMAS_DIR = join(REPO_ROOT, 'schemas');
const EXAMPLES_DIR = join(REPO_ROOT, 'examples');

interface ExampleCase {
  fileName: string;
  schemaName: 'codex-plugin' | 'codex-marketplace' | 'codex-hooks';
}

function discoverExamples(): ExampleCase[] {
  const cases: ExampleCase[] = [];
  for (const entry of readdirSync(EXAMPLES_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    if (entry.name.startsWith('codex-plugin')) {
      cases.push({ fileName: entry.name, schemaName: 'codex-plugin' });
    } else if (entry.name.startsWith('codex-marketplace')) {
      cases.push({ fileName: entry.name, schemaName: 'codex-marketplace' });
    } else if (entry.name.startsWith('codex-hooks')) {
      cases.push({ fileName: entry.name, schemaName: 'codex-hooks' });
    }
  }
  return cases;
}

describe('examples/codex-*.json files validate against their schemas', () => {
  let factory: AjvValidatorFactory;

  beforeAll(async () => {
    factory = new AjvValidatorFactory();
    await factory.loadSchemaFromFile('codex-plugin', join(SCHEMAS_DIR, 'codex-plugin.schema.json'));
    await factory.loadSchemaFromFile('codex-marketplace', join(SCHEMAS_DIR, 'codex-marketplace.schema.json'));
    await factory.loadSchemaFromFile('codex-hooks', join(SCHEMAS_DIR, 'codex-hooks.schema.json'));
  });

  const cases = discoverExamples();

  // Sanity check: all three fixtures exist. Catches the case where
  // examples/ is missing a file or the test loader broke.
  it('discovers all three codex example fixtures', () => {
    expect(cases.length).toBe(3);
  });

  for (const c of cases) {
    it(`validates ${c.fileName} against ${c.schemaName} schema`, () => {
      const filePath = join(EXAMPLES_DIR, c.fileName);
      const raw = readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      const result = factory.validate(c.schemaName, data);
      if (!result.valid) {
        const detail = result.errors
          .map((e) => `  ${e.path || '/'}: ${e.message} (${e.keyword})`)
          .join('\n');
        throw new Error(`${c.fileName} failed ${c.schemaName} schema:\n${detail}`);
      }
      expect(result.valid).toBe(true);
    });
  }
});

describe('codex-plugin.schema.json — negative cases', () => {
  let factory: AjvValidatorFactory;
  let base: Record<string, unknown>;

  beforeAll(async () => {
    factory = new AjvValidatorFactory();
    await factory.loadSchemaFromFile('codex-plugin', join(SCHEMAS_DIR, 'codex-plugin.schema.json'));
    base = JSON.parse(readFileSync(join(EXAMPLES_DIR, 'codex-plugin.example.json'), 'utf8'));
  });

  it('accepts the base example', () => {
    expect(factory.validate('codex-plugin', base).valid).toBe(true);
  });

  it('rejects a manifest missing interface.category', () => {
    const d = { ...base, interface: { displayName: 'Hello World' } };
    expect(factory.validate('codex-plugin', d).valid).toBe(false);
  });

  it('rejects an inline-object hooks value (must be a string path, unlike Claude)', () => {
    const d = { ...base, hooks: { SessionStart: [] } };
    expect(factory.validate('codex-plugin', d).valid).toBe(false);
  });

  it('rejects a non-semver version', () => {
    const d = { ...base, version: 'not-a-version' };
    expect(factory.validate('codex-plugin', d).valid).toBe(false);
  });

  it('rejects an unknown top-level key', () => {
    const d = { ...base, claudeOnlyField: true };
    expect(factory.validate('codex-plugin', d).valid).toBe(false);
  });
});

describe('codex-marketplace.schema.json — negative cases', () => {
  let factory: AjvValidatorFactory;
  let base: Record<string, unknown>;

  beforeAll(async () => {
    factory = new AjvValidatorFactory();
    await factory.loadSchemaFromFile('codex-marketplace', join(SCHEMAS_DIR, 'codex-marketplace.schema.json'));
    base = JSON.parse(readFileSync(join(EXAMPLES_DIR, 'codex-marketplace.example.json'), 'utf8'));
  });

  it('accepts the base example', () => {
    expect(factory.validate('codex-marketplace', base).valid).toBe(true);
  });

  it('accepts the committed empty-state artifact shape (plugins: [])', () => {
    const empty = { name: 'yellow-plugins', displayName: 'Yellow Plugins', plugins: [] };
    expect(factory.validate('codex-marketplace', empty).valid).toBe(true);
  });

  it('rejects an entry carrying a version field (Codex marketplace is version-less, R5/R12)', () => {
    const plugins = base.plugins as Record<string, unknown>[];
    const d = { ...base, plugins: [{ ...plugins[0], version: '1.0.0' }] };
    expect(factory.validate('codex-marketplace', d).valid).toBe(false);
  });

  it('rejects a bare-string source (Claude-style, not the Codex {source, path} object)', () => {
    const plugins = base.plugins as Record<string, unknown>[];
    const d = { ...base, plugins: [{ ...plugins[0], source: './plugins/hello-world' }] };
    expect(factory.validate('codex-marketplace', d).valid).toBe(false);
  });

  it('rejects a name other than "yellow-plugins"', () => {
    const d = { ...base, name: 'something-else' };
    expect(factory.validate('codex-marketplace', d).valid).toBe(false);
  });
});

describe('codex-hooks.schema.json — negative cases', () => {
  let factory: AjvValidatorFactory;
  let base: Record<string, unknown>;

  beforeAll(async () => {
    factory = new AjvValidatorFactory();
    await factory.loadSchemaFromFile('codex-hooks', join(SCHEMAS_DIR, 'codex-hooks.schema.json'));
    base = JSON.parse(readFileSync(join(EXAMPLES_DIR, 'codex-hooks.example.json'), 'utf8'));
  });

  it('accepts the base example', () => {
    expect(factory.validate('codex-hooks', base).valid).toBe(true);
  });

  it('rejects an empty object (minProperties: 1 — an empty hooks file must not be emitted)', () => {
    expect(factory.validate('codex-hooks', {}).valid).toBe(false);
  });

  it('rejects a hook entry missing command', () => {
    const d = { SessionStart: [{ matcher: '*', hooks: [{ type: 'command' }] }] };
    expect(factory.validate('codex-hooks', d).valid).toBe(false);
  });

  it('rejects a hook type other than "command"', () => {
    const d = { SessionStart: [{ matcher: '*', hooks: [{ type: 'script', command: 'x' }] }] };
    expect(factory.validate('codex-hooks', d).valid).toBe(false);
  });
});
