/**
 * Integration test: every Cursor example under `examples/` validates
 * against its `schemas/cursor-*.schema.json` counterpart.
 *
 * Mirrors tests/integration/codex-schema-examples.test.ts's shape exactly
 * (which itself mirrors tests/integration/example-files-schema.test.ts):
 * AjvValidatorFactory + loadSchemaFromFile + prefix-based discovery, plus a
 * dedicated negative-case describe block per schema.
 *
 * Files tested:
 *   - examples/cursor-plugin.example.json       -> schemas/cursor-plugin.schema.json
 *   - examples/cursor-marketplace.example.json  -> schemas/cursor-marketplace.schema.json
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
  schemaName: 'cursor-plugin' | 'cursor-marketplace';
}

function discoverExamples(): ExampleCase[] {
  const cases: ExampleCase[] = [];
  for (const entry of readdirSync(EXAMPLES_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    if (entry.name.startsWith('cursor-plugin')) {
      cases.push({ fileName: entry.name, schemaName: 'cursor-plugin' });
    } else if (entry.name.startsWith('cursor-marketplace')) {
      cases.push({ fileName: entry.name, schemaName: 'cursor-marketplace' });
    }
  }
  return cases;
}

describe('examples/cursor-*.json files validate against their schemas', () => {
  let factory: AjvValidatorFactory;

  beforeAll(async () => {
    factory = new AjvValidatorFactory();
    await factory.loadSchemaFromFile(
      'cursor-plugin',
      join(SCHEMAS_DIR, 'cursor-plugin.schema.json')
    );
    await factory.loadSchemaFromFile(
      'cursor-marketplace',
      join(SCHEMAS_DIR, 'cursor-marketplace.schema.json')
    );
  });

  const cases = discoverExamples();

  // Sanity check: both fixtures exist. Catches the case where examples/ is
  // missing a file or the test loader broke.
  it('discovers both cursor example fixtures', () => {
    expect(cases.length).toBe(2);
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
        throw new Error(
          `${c.fileName} failed ${c.schemaName} schema:\n${detail}`
        );
      }
      expect(result.valid).toBe(true);
    });
  }
});

describe('cursor-plugin.schema.json — negative cases', () => {
  let factory: AjvValidatorFactory;
  let base: Record<string, unknown>;

  beforeAll(async () => {
    factory = new AjvValidatorFactory();
    await factory.loadSchemaFromFile(
      'cursor-plugin',
      join(SCHEMAS_DIR, 'cursor-plugin.schema.json')
    );
    base = JSON.parse(
      readFileSync(join(EXAMPLES_DIR, 'cursor-plugin.example.json'), 'utf8')
    );
  });

  it('accepts the base example', () => {
    expect(factory.validate('cursor-plugin', base).valid).toBe(true);
  });

  it('accepts a minimal manifest with only "name"', () => {
    expect(
      factory.validate('cursor-plugin', { name: 'hello-world' }).valid
    ).toBe(true);
  });

  it('rejects a manifest missing "name"', () => {
    const { name: _name, ...rest } = base;
    expect(factory.validate('cursor-plugin', rest).valid).toBe(false);
  });

  it('rejects a name that is not kebab-case', () => {
    const d = { ...base, name: 'Hello World' };
    expect(factory.validate('cursor-plugin', d).valid).toBe(false);
  });

  it('rejects a nested "interface" object (Codex-style nesting, not upstream Cursor shape)', () => {
    const {
      displayName: _displayName,
      category: _category,
      ...rest
    } = base as Record<string, unknown>;
    const d = {
      ...rest,
      interface: { displayName: 'Hello World', category: 'Developer Tools' },
    };
    expect(factory.validate('cursor-plugin', d).valid).toBe(false);
  });

  it('rejects an author object carrying a "url" field (upstream author is {name, email?} only)', () => {
    const d = {
      ...base,
      author: { name: 'Yellow Plugins', url: 'https://example.com' },
    };
    expect(factory.validate('cursor-plugin', d).valid).toBe(false);
  });

  it('rejects an unknown top-level key', () => {
    const d = { ...base, claudeOnlyField: true };
    expect(factory.validate('cursor-plugin', d).valid).toBe(false);
  });

  it('accepts commands/agents/rules as either a string or an array of strings', () => {
    const asString = { ...base, commands: './commands' };
    const asArray = {
      ...base,
      commands: ['./commands/a.md', './commands/b.md'],
    };
    expect(factory.validate('cursor-plugin', asString).valid).toBe(true);
    expect(factory.validate('cursor-plugin', asArray).valid).toBe(true);
  });
});

describe('cursor-marketplace.schema.json — negative cases', () => {
  let factory: AjvValidatorFactory;
  let base: Record<string, unknown>;

  beforeAll(async () => {
    factory = new AjvValidatorFactory();
    await factory.loadSchemaFromFile(
      'cursor-marketplace',
      join(SCHEMAS_DIR, 'cursor-marketplace.schema.json')
    );
    base = JSON.parse(
      readFileSync(
        join(EXAMPLES_DIR, 'cursor-marketplace.example.json'),
        'utf8'
      )
    );
  });

  it('accepts the base example', () => {
    expect(factory.validate('cursor-marketplace', base).valid).toBe(true);
  });

  it('accepts a minimal marketplace with an empty plugins array', () => {
    expect(
      factory.validate('cursor-marketplace', {
        name: 'yellow-plugins',
        plugins: [],
      }).valid
    ).toBe(true);
  });

  it('rejects a root-level "interface" wrapper (Codex-style, not upstream Cursor shape)', () => {
    const d = {
      name: 'yellow-plugins',
      interface: { displayName: 'Yellow Plugins' },
      plugins: [],
    };
    expect(factory.validate('cursor-marketplace', d).valid).toBe(false);
  });

  it('rejects an entry missing "source"', () => {
    const plugins = base.plugins as Record<string, unknown>[];
    const { source: _source, ...rest } = plugins[0];
    const d = { ...base, plugins: [rest] };
    expect(factory.validate('cursor-marketplace', d).valid).toBe(false);
  });

  it('rejects an entry with a "policy" object (Codex-style, not upstream Cursor shape)', () => {
    const plugins = base.plugins as Record<string, unknown>[];
    const d = {
      ...base,
      plugins: [
        {
          ...plugins[0],
          policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
        },
      ],
    };
    expect(factory.validate('cursor-marketplace', d).valid).toBe(false);
  });

  it('rejects an entry with an object-shaped source ({source, path}, Codex-style, not a bare string)', () => {
    const plugins = base.plugins as Record<string, unknown>[];
    const d = {
      ...base,
      plugins: [
        {
          ...plugins[0],
          source: { source: 'local', path: './plugins/hello-world' },
        },
      ],
    };
    expect(factory.validate('cursor-marketplace', d).valid).toBe(false);
  });

  it('rejects an unknown top-level key', () => {
    const d = { ...base, claudeOnlyField: true };
    expect(factory.validate('cursor-marketplace', d).valid).toBe(false);
  });
});
