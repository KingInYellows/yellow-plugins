/**
 * The github-workflow runtime shim (`lib/run-github-stack-runtime.js`) that
 * consumer plugins call instead of `${CLAUDE_PLUGIN_ROOT}/../github-workflow/...`,
 * which only resolves in the source tree. Each test copies the shim into a
 * fake plugin tree and runs it from there, so the lookup is exercised the
 * way an installed plugin enters it.
 */

import { execFileSync, spawnSync } from 'child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { describe, it, expect, afterEach } from 'vitest';

const REPO = join(__dirname, '..', '..');
const PLUGINS = join(REPO, 'plugins');
const SHIM = 'run-github-stack-runtime.js';
const CONSUMERS = ['yellow-core', 'yellow-debt', 'yellow-devin', 'yellow-review', 'yellow-semgrep'];
const CANONICAL = join(PLUGINS, 'yellow-core', 'lib', SHIM);

// A stub runtime that echoes which copy ran, its argv, and stdin, then exits
// with RUNTIME_EXIT so exit-code passthrough is observable.
const STUB = (tag: string): string =>
  `const fs = require('fs');
let stdin = '';
try { stdin = fs.readFileSync(0, 'utf8'); } catch {}
console.log(JSON.stringify({ tag: ${JSON.stringify(tag)}, argv: process.argv.slice(2), stdin }));
process.exit(Number(process.env.RUNTIME_EXIT || 0));
`;

let tmp: string;

function plant(runtimeDir: string, tag: string): void {
  mkdirSync(join(runtimeDir, 'lib'), { recursive: true });
  writeFileSync(join(runtimeDir, 'lib', 'github-stack-runtime.js'), STUB(tag));
}

function installShim(pluginRoot: string): string {
  mkdirSync(join(pluginRoot, 'lib'), { recursive: true });
  const dest = join(pluginRoot, 'lib', SHIM);
  copyFileSync(CANONICAL, dest);
  return dest;
}

function run(shim: string, args: string[], opts: { input?: string; env?: Record<string, string>; cwd?: string } = {}) {
  return spawnSync(process.execPath, [shim, ...args], {
    encoding: 'utf8',
    input: opts.input ?? '',
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
  });
}

// Write <configDir>/plugins/installed_plugins.json with these entries under
// one key; returns the env that points the shim at it.
function installed(configDir: string, key: string, entries: unknown): Record<string, string> {
  mkdirSync(join(configDir, 'plugins'), { recursive: true });
  writeFileSync(join(configDir, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { [key]: entries } }));
  return { CLAUDE_CONFIG_DIR: configDir };
}

// A cache with github-workflow 1.9.0 and 1.10.0 and the shim under yellow-review.
function cacheWithTwoVersions(prefix: string): { market: string; shim: string } {
  tmp = mkdtempSync(join(tmpdir(), prefix));
  const market = join(tmp, 'cache', 'yellow-plugins');
  const shim = installShim(join(market, 'yellow-review', '3.1.0'));
  plant(join(market, 'github-workflow', '1.9.0'), 'v1.9.0');
  plant(join(market, 'github-workflow', '1.10.0'), 'v1.10.0');
  return { market, shim };
}

const tagOf = (res: ReturnType<typeof run>): string => JSON.parse(res.stdout).tag;

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('run-github-stack-runtime.js', () => {
  it('ships byte-identical in every consumer plugin', () => {
    const canonical = readFileSync(CANONICAL);
    for (const plugin of CONSUMERS) {
      expect(readFileSync(join(PLUGINS, plugin, 'lib', SHIM)).equals(canonical), plugin).toBe(true);
    }
  });

  it('is what every plugin command, agent, and skill calls', () => {
    const offenders: string[] = [];
    const users = new Set<string>();
    const walk = (dir: string): void => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) {
          if (ent.name !== 'node_modules' && ent.name !== 'tests') walk(p);
        } else if (ent.name.endsWith('.md') && ent.name !== 'CHANGELOG.md') {
          const text = readFileSync(p, 'utf8');
          if (text.includes('/../github-workflow/lib/github-stack-runtime.js')) offenders.push(p);
          if (text.includes(`\${CLAUDE_PLUGIN_ROOT}/lib/${SHIM}`)) users.add(p.split('/plugins/')[1].split('/')[0]);
        }
      }
    };
    walk(PLUGINS);
    expect(offenders).toEqual([]);
    for (const plugin of users) expect(CONSUMERS, plugin).toContain(plugin);
  });

  it('finds the source-tree sibling first', () => {
    tmp = mkdtempSync(join(tmpdir(), 'ghsr-src-'));
    const shim = installShim(join(tmp, 'plugins', 'yellow-review'));
    plant(join(tmp, 'plugins', 'github-workflow'), 'source');
    const out = execFileSync(process.execPath, [shim, '--locate'], { encoding: 'utf8' }).trim();
    expect(out).toBe(join(tmp, 'plugins', 'yellow-review', '..', 'github-workflow', 'lib', 'github-stack-runtime.js'));
  });

  it('finds the highest numeric version in the installed cache', () => {
    tmp = mkdtempSync(join(tmpdir(), 'ghsr-cache-'));
    const market = join(tmp, 'cache', 'yellow-plugins');
    const shim = installShim(join(market, 'yellow-review', '3.1.0'));
    plant(join(market, 'github-workflow', '1.9.0'), 'v1.9.0');
    plant(join(market, 'github-workflow', '1.10.0'), 'v1.10.0');
    plant(join(market, 'github-workflow', '2.0.0-rc.1'), 'prerelease');
    // A newer version directory without the runtime is skipped.
    mkdirSync(join(market, 'github-workflow', '1.11.0'), { recursive: true });

    const res = run(shim, ['submit', '--json-args', '-'], { input: '{"x":1}', env: { RUNTIME_EXIT: '0' } });
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual({ tag: 'v1.10.0', argv: ['submit', '--json-args', '-'], stdin: '{"x":1}' });
  });

  it('prefers the active install recorded in installed_plugins.json over a newer orphan', () => {
    const { market, shim } = cacheWithTwoVersions('ghsr-active-');
    const env = installed(join(tmp, 'config'), 'github-workflow@yellow-plugins', [
      { scope: 'user', installPath: join(market, 'github-workflow', '1.9.0'), version: '1.9.0' },
    ]);
    expect(tagOf(run(shim, ['view'], { env }))).toBe('v1.9.0');
  });

  it('lets a project-scoped install for the cwd beat the user-scoped one', () => {
    const { market, shim } = cacheWithTwoVersions('ghsr-project-');
    plant(join(market, 'github-workflow', '1.8.0'), 'v1.8.0');
    const project = join(tmp, 'project');
    const other = join(tmp, 'other');
    mkdirSync(join(project, 'sub'), { recursive: true });
    mkdirSync(other, { recursive: true });
    const env = installed(join(tmp, 'config'), 'github-workflow@yellow-plugins', [
      { scope: 'user', installPath: join(market, 'github-workflow', '1.9.0') },
      { scope: 'project', projectPath: project, installPath: join(market, 'github-workflow', '1.8.0') },
    ]);
    expect(tagOf(run(shim, ['view'], { env, cwd: join(project, 'sub') }))).toBe('v1.8.0');
    expect(tagOf(run(shim, ['view'], { env, cwd: other }))).toBe('v1.9.0');
  });

  it('falls back to the highest version when the active entry is unusable', () => {
    const { market, shim } = cacheWithTwoVersions('ghsr-fallback-');
    const config = join(tmp, 'config');
    // No file at all.
    expect(tagOf(run(shim, ['view'], { env: { CLAUDE_CONFIG_DIR: config } }))).toBe('v1.10.0');
    // An installPath outside <marketplace>/github-workflow/.
    const outside = join(tmp, 'elsewhere', '1.0.0');
    plant(outside, 'outside');
    let env = installed(config, 'github-workflow@yellow-plugins', [{ installPath: outside }]);
    expect(tagOf(run(shim, ['view'], { env }))).toBe('v1.10.0');
    // A recorded version directory without the runtime.
    mkdirSync(join(market, 'github-workflow', '1.5.0'), { recursive: true });
    env = installed(config, 'github-workflow@yellow-plugins', [{ installPath: join(market, 'github-workflow', '1.5.0') }]);
    expect(tagOf(run(shim, ['view'], { env }))).toBe('v1.10.0');
    // Another marketplace's entry.
    env = installed(config, 'github-workflow@other-market', [{ installPath: join(market, 'github-workflow', '1.9.0') }]);
    expect(tagOf(run(shim, ['view'], { env }))).toBe('v1.10.0');
    // Malformed JSON.
    writeFileSync(join(config, 'plugins', 'installed_plugins.json'), '{not json');
    expect(tagOf(run(shim, ['view'], { env }))).toBe('v1.10.0');
  });

  it("passes the runtime's exit code through", () => {
    tmp = mkdtempSync(join(tmpdir(), 'ghsr-exit-'));
    const shim = installShim(join(tmp, 'plugins', 'yellow-core'));
    plant(join(tmp, 'plugins', 'github-workflow'), 'source');
    expect(run(shim, ['bogus'], { env: { RUNTIME_EXIT: '1' } }).status).toBe(1);
  });

  it('reports RUNTIME_NOT_FOUND as a runtime-shaped result when github-workflow is absent', () => {
    tmp = mkdtempSync(join(tmpdir(), 'ghsr-none-'));
    const shim = installShim(join(tmp, 'cache', 'yellow-plugins', 'yellow-core', '2.0.0'));
    const res = run(shim, ['view']);
    expect(res.status).toBe(0);
    const result = JSON.parse(res.stdout);
    expect(result.status).toBe('RUNTIME_NOT_FOUND');
    expect(result.operation).toBe('view');
    expect(result.mayHaveMutated).toBe(false);
    expect(result.recoveryAction).toMatch(/github-workflow/);
    expect(run(shim, ['--locate']).status).toBe(1);
  });
});
