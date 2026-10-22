/**
 * yellow-review and yellow-goal each ship lib/sibling-plugin.sh (a plugin
 * cannot source another plugin's lib/ before it has found it). The copies must
 * stay byte-identical, and yellow-goal's commands must find yellow-core
 * through it rather than through `${CLAUDE_PLUGIN_ROOT}/../yellow-core`, which
 * misses the version-suffixed plugin cache (CLAUDE-170).
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import { describe, it, expect } from 'vitest';

const PLUGINS = join(__dirname, '..', '..', 'plugins');
const lib = (plugin: string) => readFileSync(join(PLUGINS, plugin, 'lib', 'sibling-plugin.sh'), 'utf8');

describe('lib/sibling-plugin.sh copies', () => {
  it('yellow-goal holds a byte-identical copy of yellow-review', () => {
    expect(lib('yellow-goal')).toBe(lib('yellow-review'));
  });

  it('yellow-goal commands resolve yellow-core through the shared lookup', () => {
    const dir = join(PLUGINS, 'yellow-goal', 'commands', 'goal');
    for (const name of ['setup.md', 'run-stub.md', 'run-real.md']) {
      const text = readFileSync(join(dir, name), 'utf8');
      expect(text, name).toContain('sp_sibling_file "$1" yellow-core lib/validate-fs.sh');
    }
    for (const name of readdirSync(dir)) {
      expect(readFileSync(join(dir, name), 'utf8'), name).not.toMatch(/CLAUDE_PLUGIN_ROOT[^"\n]*\/\.\.\/yellow-core/);
    }
  });
});
