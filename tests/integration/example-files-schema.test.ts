/**
 * Integration test: every plugin example under `examples/` validates
 * against the canonical `schemas/plugin.schema.json`.
 *
 * Files tested:
 *   - examples/plugin.example.json           -> schemas/plugin.schema.json
 *   - examples/plugin-minimal.example.json   -> schemas/plugin.schema.json
 *   - examples/plugin-extended.example.json  -> schemas/plugin.schema.json
 *
 * Marketplace examples are intentionally NOT covered here:
 * `examples/marketplace.example.json` is sourced from the upstream
 * marketplace fixture and does not match this repo's local
 * `schemas/marketplace.schema.json` shape (uses upstream `name`-based
 * identifiers; local schema requires the legacy `id` field). That
 * pre-existing drift is out of scope for PR-B; the test file scoping
 * to `plugin*.json` prefix keeps the validator-keyword surface
 * exercised without inheriting the unrelated marketplace mismatch.
 *
 * This test prevents plugin example files from drifting out of sync with
 * `schemas/plugin.schema.json` changes. Before this test,
 * `plugin-extended.example.json` was a silent orphan — CI globbed it
 * via `find` but never validated its schema conformance after schema
 * edits.
 *
 * The AjvValidatorFactory used here registers the project's custom keywords
 * (e.g., `semverRange` for `dependencies[].version`), so this test exercises
 * the full validation surface as the production CLI would.
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
  schemaName: 'plugin';
}

function discoverExamples(): ExampleCase[] {
  const cases: ExampleCase[] = [];
  for (const entry of readdirSync(EXAMPLES_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    if (entry.name.startsWith('plugin')) {
      cases.push({ fileName: entry.name, schemaName: 'plugin' });
    }
    // marketplace.example.json is intentionally skipped — see file header.
  }
  return cases;
}

describe('examples/ files validate against their schemas', () => {
  let factory: AjvValidatorFactory;

  beforeAll(async () => {
    factory = new AjvValidatorFactory();
    await factory.loadSchemaFromFile(
      'plugin',
      join(SCHEMAS_DIR, 'plugin.schema.json')
    );
  });

  const cases = discoverExamples();

  // Sanity check: at least one plugin fixture exists. Catches the case
  // where examples/ is empty or the test loader broke.
  it('discovers at least one plugin example', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const c of cases) {
    it(`validates ${c.fileName} against ${c.schemaName} schema`, () => {
      const filePath = join(EXAMPLES_DIR, c.fileName);
      const raw = readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      const result = factory.validate(c.schemaName, data);
      if (!result.valid) {
        // Surface the AJV errors so test failure pinpoints the drift.
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

describe('semverRange custom keyword (PR-B)', () => {
  let factory: AjvValidatorFactory;

  beforeAll(() => {
    factory = new AjvValidatorFactory();
    // Tiny test schema that just exercises the keyword in isolation.
    factory.loadSchema('semver-test', {
      type: 'object',
      properties: {
        version: {
          type: 'string',
          minLength: 1,
          pattern: '^[~^>=<*xXvV0-9]',
          semverRange: true,
        },
      },
      required: ['version'],
    });
  });

  it('accepts ^1.0.0', () => {
    expect(factory.validate('semver-test', { version: '^1.0.0' }).valid).toBe(
      true
    );
  });

  it('accepts ~2.1.0', () => {
    expect(factory.validate('semver-test', { version: '~2.1.0' }).valid).toBe(
      true
    );
  });

  it('accepts >=3.0.0', () => {
    expect(factory.validate('semver-test', { version: '>=3.0.0' }).valid).toBe(
      true
    );
  });

  it('accepts 1.2.3 (exact)', () => {
    expect(factory.validate('semver-test', { version: '1.2.3' }).valid).toBe(
      true
    );
  });

  it('accepts v1.2.3 (exact with v prefix)', () => {
    expect(factory.validate('semver-test', { version: 'v1.2.3' }).valid).toBe(
      true
    );
  });

  it('accepts =1.2.3 (exact with equals prefix)', () => {
    expect(factory.validate('semver-test', { version: '=1.2.3' }).valid).toBe(
      true
    );
  });

  it('accepts * (wildcard)', () => {
    expect(factory.validate('semver-test', { version: '*' }).valid).toBe(true);
  });

  it('rejects "banana" (non-semver)', () => {
    // Pattern gate rejects this before semverRange runs.
    expect(factory.validate('semver-test', { version: 'banana' }).valid).toBe(
      false
    );
  });

  it('rejects "1.banana.0" (passes pattern, fails semverRange)', () => {
    // Starts with digit so pattern accepts; semverRange rejects.
    expect(
      factory.validate('semver-test', { version: '1.banana.0' }).valid
    ).toBe(false);
  });

  it('rejects empty string', () => {
    expect(factory.validate('semver-test', { version: '' }).valid).toBe(false);
  });
});

describe('plugin.schema.json tightening (PR #559) — negative cases', () => {
  let factory: AjvValidatorFactory;
  // Minimal known-valid plugin manifest, read from the committed example so
  // a future required-field change does not silently invalidate this base.
  let base: Record<string, unknown>;

  beforeAll(async () => {
    factory = new AjvValidatorFactory();
    await factory.loadSchemaFromFile(
      'plugin',
      join(SCHEMAS_DIR, 'plugin.schema.json')
    );
    base = JSON.parse(
      readFileSync(join(EXAMPLES_DIR, 'plugin-minimal.example.json'), 'utf8')
    );
  });

  it('accepts string repository (the only form the remote validator allows)', () => {
    const d = { ...base, repository: 'https://github.com/x/y.git' };
    expect(factory.validate('plugin', d).valid).toBe(true);
  });

  it('rejects object (npm-style) repository — remote validator rejects it', () => {
    const d = {
      ...base,
      repository: { type: 'git', url: 'https://github.com/x/y.git' },
    };
    expect(factory.validate('plugin', d).valid).toBe(false);
  });

  it('accepts inline-object hooks keyed by event name', () => {
    const d = {
      ...base,
      hooks: {
        PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'x' }] }],
      },
    };
    expect(factory.validate('plugin', d).valid).toBe(true);
  });

  it('accepts an array of inline hook objects', () => {
    const d = { ...base, hooks: [{ PostToolUse: [] }] };
    expect(factory.validate('plugin', d).valid).toBe(true);
  });

  it('rejects string (file-path) hooks — remote validator rejects indirection', () => {
    const d = { ...base, hooks: './hooks/hooks.json' };
    expect(factory.validate('plugin', d).valid).toBe(false);
  });
});

describe('official-marketplace.schema.json additionalProperties:false (PR #559)', () => {
  let factory: AjvValidatorFactory;
  let liveMarketplace: Record<string, unknown>;

  beforeAll(async () => {
    factory = new AjvValidatorFactory();
    await factory.loadSchemaFromFile(
      'marketplace-official',
      join(SCHEMAS_DIR, 'official-marketplace.schema.json')
    );
    liveMarketplace = JSON.parse(
      readFileSync(
        join(REPO_ROOT, '.claude-plugin', 'marketplace.json'),
        'utf8'
      )
    );
  });

  it('accepts the live .claude-plugin/marketplace.json', () => {
    const result = factory.validate('marketplace-official', liveMarketplace);
    if (!result.valid) {
      const detail = result.errors
        .map((e) => `  ${e.path || '/'}: ${e.message} (${e.keyword})`)
        .join('\n');
      throw new Error(`live marketplace.json failed schema:\n${detail}`);
    }
    expect(result.valid).toBe(true);
  });

  it('rejects an unknown top-level key (e.g. changelog) the remote validator also rejects', () => {
    const d = { ...liveMarketplace, changelog: 'https://example.com/CHANGELOG' };
    expect(factory.validate('marketplace-official', d).valid).toBe(false);
  });
});
