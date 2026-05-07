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

describe('userConfigEntry.pattern field (PR-C)', () => {
  let factory: AjvValidatorFactory;

  beforeAll(async () => {
    factory = new AjvValidatorFactory();
    await factory.loadSchemaFromFile(
      'plugin',
      join(SCHEMAS_DIR, 'plugin.schema.json')
    );
  });

  function pluginWithUserConfig(
    userConfig: Record<string, unknown>
  ): Record<string, unknown> {
    return {
      name: 'test-plugin',
      version: '1.0.0',
      description: 'Test plugin for userConfig pattern AJV-side validation.',
      author: 'KingInYellows',
      userConfig,
    };
  }

  it('accepts a string-typed entry with a valid pattern', () => {
    const data = pluginWithUserConfig({
      api_url: { type: 'string', title: 'API URL', pattern: '^https://' },
    });
    expect(factory.validate('plugin', data).valid).toBe(true);
  });

  it('accepts a directory-typed entry with a pattern', () => {
    const data = pluginWithUserConfig({
      workspace: {
        type: 'directory',
        title: 'Workspace',
        pattern: '^[A-Za-z0-9_./-]+$',
      },
    });
    expect(factory.validate('plugin', data).valid).toBe(true);
  });

  it('accepts a file-typed entry with a pattern', () => {
    const data = pluginWithUserConfig({
      config_file: {
        type: 'file',
        title: 'Config file',
        pattern: '\\.json$',
      },
    });
    expect(factory.validate('plugin', data).valid).toBe(true);
  });

  it('rejects a number-typed entry that also declares a pattern', () => {
    const data = pluginWithUserConfig({
      port: { type: 'number', title: 'Port', pattern: '^[0-9]+$' },
    });
    expect(factory.validate('plugin', data).valid).toBe(false);
  });

  it('rejects a boolean-typed entry that also declares a pattern', () => {
    const data = pluginWithUserConfig({
      flag: {
        type: 'boolean',
        title: 'Flag',
        pattern: '^(true|false)$',
      },
    });
    expect(factory.validate('plugin', data).valid).toBe(false);
  });

  it('rejects a non-string pattern value', () => {
    const data = pluginWithUserConfig({
      api_url: { type: 'string', title: 'API URL', pattern: 123 },
    });
    expect(factory.validate('plugin', data).valid).toBe(false);
  });

  it('rejects an empty string pattern', () => {
    const data = pluginWithUserConfig({
      api_url: { type: 'string', title: 'API URL', pattern: '' },
    });
    expect(factory.validate('plugin', data).valid).toBe(false);
  });

  it('accepts an entry without a pattern (back-compat)', () => {
    const data = pluginWithUserConfig({
      api_url: { type: 'string', title: 'API URL' },
    });
    expect(factory.validate('plugin', data).valid).toBe(true);
  });

  it('rejects pattern on a channels[].userConfig entry with type number (allOf propagates through $ref)', () => {
    const data = {
      name: 'test-plugin',
      version: '1.0.0',
      description:
        'Test plugin to confirm userConfigEntry.allOf rules propagate through channels[].userConfig $ref.',
      author: 'KingInYellows',
      channels: [
        {
          server: 'test-channel',
          userConfig: {
            port: { type: 'number', title: 'Port', pattern: '^[0-9]+$' },
          },
        },
      ],
    };
    expect(factory.validate('plugin', data).valid).toBe(false);
  });

  it('AJV does NOT enforce regex compilability — that is RULE 10 in validate-plugin.js', () => {
    // Documents the intentional two-layer split: AJV checks
    // type+minLength only; the script-level RULE 10 compiles the regex
    // and surfaces SyntaxError. A future schema change that adds a
    // regex-format keyword would silently change this surface; this
    // test pins the boundary.
    const data = pluginWithUserConfig({
      api_url: { type: 'string', title: 'API URL', pattern: '[unclosed' },
    });
    expect(factory.validate('plugin', data).valid).toBe(true);
  });

  it('AJV does NOT enforce default-vs-pattern matching — that is RULE 10 in validate-plugin.js', () => {
    // Same boundary: AJV's allOf only constrains the default's *type*
    // by the userConfig type, not whether the default matches the
    // declared pattern. Script-level RULE 10 owns that check.
    const data = pluginWithUserConfig({
      api_url: {
        type: 'string',
        title: 'API URL',
        pattern: '^https://',
        default: 'http://does-not-match.example',
      },
    });
    expect(factory.validate('plugin', data).valid).toBe(true);
  });
});
