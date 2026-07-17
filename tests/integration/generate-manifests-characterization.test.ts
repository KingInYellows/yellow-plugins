/**
 * Characterization snapshot suite for the manifest generation targets.
 *
 * Committed BEFORE `scripts/generate-manifests.js` exists (R4: the baseline
 * is captured before the generator lands). It pins the raw UTF-8 bytes of
 * every generated-artifact target — `.claude-plugin/marketplace.json` and
 * each `plugins/<name>/.claude-plugin/plugin.json` — so the generator's
 * byte-identity contract has a fixed reference: regenerating from `catalog/`
 * must reproduce these snapshots exactly.
 *
 * The plugin inventory itself is snapshotted as an explicit sorted name
 * list (never a bare count) so adding, removing, or renaming a plugin is
 * visible by name in the snapshot diff.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..');
const PLUGINS_DIR = join(REPO_ROOT, 'plugins');
const MARKETPLACE_PATH = join(REPO_ROOT, '.claude-plugin', 'marketplace.json');

const realPlugins = readdirSync(PLUGINS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

describe('manifest byte-identity baseline', () => {
  it('plugin inventory (explicit sorted names)', () => {
    expect(realPlugins).toMatchSnapshot();
  });

  it('.claude-plugin/marketplace.json raw bytes', () => {
    expect(readFileSync(MARKETPLACE_PATH, 'utf8')).toMatchSnapshot();
  });

  it.each(realPlugins)(
    'plugins/%s/.claude-plugin/plugin.json raw bytes',
    (name) => {
      expect(
        readFileSync(
          join(PLUGINS_DIR, name, '.claude-plugin', 'plugin.json'),
          'utf8'
        )
      ).toMatchSnapshot();
    }
  );
});
