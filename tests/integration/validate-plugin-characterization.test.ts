/**
 * Characterization snapshot suite for `scripts/validate-plugin.js`.
 *
 * Committed BEFORE the PR-A decomposition (extracting the ~585-line
 * `validatePlugin()` god function into per-rule helpers and `scripts/lib/`
 * submodules). It pins the validator's observable contract — the
 * `{ valid, errors }` return value — so any behavior drift during the
 * extraction is caught immediately.
 *
 * Two nets:
 *   1. Every real `plugins/*` manifest must stay `valid: true`. This
 *      exercises all 12 RULE branches against the live catalog — the
 *      strongest regression signal for a refactor that must not change
 *      behavior.
 *   2. Representative invalid fixtures snapshot the `errors` array
 *      (sorted lexically — see `errorsFor`) so per-rule error wording is
 *      pinned. Rule-execution ordering is intentionally NOT pinned here;
 *      `tests/integration/validate-plugin.test.ts` is the source of truth
 *      for any order-sensitive assertions.
 *
 * `validatePlugin` is called in-process (it is `module.exports`-ed) rather
 * than spawned, so the suite is fast and asserts the structured return
 * value directly.
 */

import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, it, expect, afterAll, vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { validatePlugin } = require('../../scripts/validate-plugin.js');

const REPO_ROOT = resolve(__dirname, '..', '..');
const PLUGINS_DIR = join(REPO_ROOT, 'plugins');

// validatePlugin logs heavily to stdout/stderr — silence it so the suite
// output stays readable. The structured return value is what we assert on.
function quietValidate(dir: string): { valid: boolean; errors?: string[] } {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    return validatePlugin(dir);
  } finally {
    log.mockRestore();
    err.mockRestore();
    warn.mockRestore();
  }
}

const realPlugins = readdirSync(PLUGINS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

describe('validate-plugin characterization: real catalog stays valid', () => {
  it.each(realPlugins)('plugins/%s is valid', (name) => {
    const result = quietValidate(join(PLUGINS_DIR, name));
    expect(result).toEqual({ valid: true });
  });
});

describe('validate-plugin characterization: invalid-fixture error arrays', () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-validate-plugin-char-'));

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  // Each fixture is a manifest written to a temp dir whose basename is the
  // plugin name (RULE 2). The returned `errors` array is snapshotted.
  function errorsFor(
    fixtureName: string,
    manifest: Record<string, unknown>,
    extraSetup?: (pluginDir: string) => void
  ): string[] {
    // Use the manifest name as the directory basename unless it would trip
    // RULE 2 on purpose (the wrong-name fixture sets a mismatched name).
    const dirName =
      typeof manifest.name === 'string' && fixtureName !== 'name-mismatch'
        ? manifest.name
        : fixtureName;
    const pluginDir = join(tmpRoot, dirName);
    mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
    if (extraSetup) extraSetup(pluginDir);
    writeFileSync(
      join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );
    const result = quietValidate(pluginDir);
    return (result.errors ?? []).slice().sort();
  }

  const base = {
    name: 'char-fixture',
    description: 'A characterization fixture manifest for validate-plugin.',
    author: 'KingInYellows',
    version: '1.0.0',
  };

  it('RULE 1: missing required fields', () => {
    expect(
      errorsFor('missing-required', { version: '1.0.0' })
    ).toMatchSnapshot();
  });

  it('RULE 2: name does not match directory', () => {
    expect(
      errorsFor('name-mismatch', { ...base, name: 'wrong-name' })
    ).toMatchSnapshot();
  });

  it('RULE 3: invalid version format', () => {
    expect(
      errorsFor('bad-version', { ...base, version: 'v1' })
    ).toMatchSnapshot();
  });

  it('RULE 5: keywords must be an array of strings', () => {
    expect(
      errorsFor('bad-keywords', { ...base, keywords: 'not-an-array' })
    ).toMatchSnapshot();
  });

  it('RULE 5b: commands directory not found', () => {
    expect(
      errorsFor('missing-commands', { ...base, commands: './nope' })
    ).toMatchSnapshot();
  });

  it('RULE 5b: path escapes plugin directory', () => {
    expect(
      errorsFor('escape-path', { ...base, agents: '../escape' })
    ).toMatchSnapshot();
  });

  it('RULE 9: userConfig entry missing type and title', () => {
    expect(
      errorsFor('bad-userconfig', {
        ...base,
        userConfig: { api_key: { description: 'a key' } },
      })
    ).toMatchSnapshot();
  });

  it('RULE 9: userConfig entry with an unsupported field', () => {
    expect(
      errorsFor('userconfig-extra-field', {
        ...base,
        userConfig: {
          api_key: { type: 'string', title: 'API Key', pattern: '^x$' },
        },
      })
    ).toMatchSnapshot();
  });

  it('RULE 7: hooks/hooks.json with events at the top level', () => {
    expect(
      errorsFor(
        'bad-hooks-json',
        base,
        (pluginDir) => {
          mkdirSync(join(pluginDir, 'hooks'), { recursive: true });
          writeFileSync(
            join(pluginDir, 'hooks', 'hooks.json'),
            JSON.stringify({ PostToolUse: [] }, null, 2),
            'utf8'
          );
        }
      )
    ).toMatchSnapshot();
  });
});
