/**
 * Symlink containment integration tests for `scripts/validate-plugin.js`.
 * Split from validate-plugin.test.ts to stay under Codacy file-length limits.
 */

import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const VALIDATOR = resolve(
  __dirname,
  '..',
  '..',
  'scripts',
  'validate-plugin.js'
);

interface ValidatorRun {
  status: number;
  stdout: string;
  stderr: string;
}

function runValidator(pluginDir: string, cwd?: string): ValidatorRun {
  const result = spawnSync('node', pluginDir ? [VALIDATOR, pluginDir] : [VALIDATOR], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function writePluginManifest(
  pluginDir: string,
  manifest: Record<string, unknown>
): void {
  const manifestDir = join(pluginDir, '.claude-plugin');
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(
    join(manifestDir, 'plugin.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );
}

function writeHookScript(
  pluginDir: string,
  relativePath: string,
  content: string
): void {
  const fullPath = join(pluginDir, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');
  chmodSync(fullPath, 0o755);
}

const VALID_BASE_MANIFEST = {
  name: 'test-plugin',
  description:
    'A test fixture plugin used by validate-plugin integration tests.',
  author: 'KingInYellows',
  version: '1.0.0',
};

const SHEBANG_HOOK = `#!/usr/bin/env bash
set -uo pipefail
# Test fixture hook script. Outputs a continue decision.
printf '{"continue": true}\\n'
exit 0
`;

describe('validate-plugin symlink hardening: hook script ancestors, both-sides realpath, dangling hooks/hooks.json', () => {
  let tmpRoot: string;
  let pluginDir: string;

  const hookManifest = (command: string) => ({
    ...VALID_BASE_MANIFEST,
    hooks: {
      UserPromptSubmit: [
        { matcher: '*', hooks: [{ type: 'command', command, timeout: 5000 }] },
      ],
    },
  });

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-validate-plugin-symlink-'));
    pluginDir = join(tmpRoot, 'test-plugin');
    mkdirSync(pluginDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('errors when hooks/ is a symlink to a directory outside the plugin (symlinked ancestor)', () => {
    const outside = join(tmpRoot, 'outside-hooks');
    mkdirSync(join(outside, 'scripts'), { recursive: true });
    writeFileSync(join(outside, 'scripts', 'guard.sh'), SHEBANG_HOOK, 'utf8');
    chmodSync(join(outside, 'scripts', 'guard.sh'), 0o755);
    symlinkSync(outside, join(pluginDir, 'hooks'), 'dir');
    writePluginManifest(
      pluginDir,
      hookManifest('bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/guard.sh"')
    );
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/passes through a symlinked directory \(hooks\)/);
  });

  it('errors when hooks/ is a symlink even to a directory INSIDE the plugin (reject-symlinks-outright policy)', () => {
    mkdirSync(join(pluginDir, 'real-hooks', 'scripts'), { recursive: true });
    writeFileSync(join(pluginDir, 'real-hooks', 'scripts', 'guard.sh'), SHEBANG_HOOK, 'utf8');
    chmodSync(join(pluginDir, 'real-hooks', 'scripts', 'guard.sh'), 0o755);
    symlinkSync(join(pluginDir, 'real-hooks'), join(pluginDir, 'hooks'), 'dir');
    writePluginManifest(
      pluginDir,
      hookManifest('bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/guard.sh"')
    );
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/passes through a symlinked directory \(hooks\)/);
  });

  it('passes when the plugin directory itself is reached through a symlinked parent (both-sides realpath)', () => {
    writeHookScript(pluginDir, 'hooks/scripts/guard.sh', SHEBANG_HOOK);
    writePluginManifest(
      pluginDir,
      hookManifest('bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/guard.sh"')
    );
    const linkRoot = join(tmpRoot, 'link-root');
    symlinkSync(tmpRoot, linkRoot, 'dir');
    const { status, stderr } = runValidator(join(linkRoot, 'test-plugin'));
    expect(stderr).not.toMatch(/symlink/);
    expect(status).toBe(0);
  });

  it('still errors when the hook script file itself is a symlink (existing final-component check)', () => {
    writeHookScript(pluginDir, 'hooks/scripts/real.sh', SHEBANG_HOOK);
    symlinkSync(
      join(pluginDir, 'hooks', 'scripts', 'real.sh'),
      join(pluginDir, 'hooks', 'scripts', 'guard.sh'),
      'file'
    );
    writePluginManifest(
      pluginDir,
      hookManifest('bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/guard.sh"')
    );
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/Hook script path is a symlink/);
  });

  it('rejects a `..` component in the script path even when it normalises inside the plugin (review P2)', () => {
    const outside = join(tmpRoot, 'elsewhere');
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(pluginDir, 'docs'), 'dir');
    writeHookScript(pluginDir, 'hooks/scripts/guard.sh', SHEBANG_HOOK);
    writePluginManifest(
      pluginDir,
      hookManifest('bash "${CLAUDE_PLUGIN_ROOT}/docs/../hooks/scripts/guard.sh"')
    );
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/Hook script path escapes plugin directory/);
  });

  it('errors when the plugin root itself is a symlink (review P2: neither the ancestor walk nor realpath sees it)', () => {
    const realPlugin = join(tmpRoot, 'real-plugin');
    mkdirSync(realPlugin, { recursive: true });
    writeHookScript(realPlugin, 'hooks/scripts/guard.sh', SHEBANG_HOOK);
    writePluginManifest(realPlugin, {
      ...hookManifest('bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/guard.sh"'),
      name: 'linked-plugin',
    });
    const link = join(tmpRoot, 'linked-plugin');
    symlinkSync(realPlugin, link, 'dir');
    const { status, stderr } = runValidator(link);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/Plugin directory is a symlink/);
  });

  it('errors when the plugin root is a symlink even with no hooks at all (root check runs first)', () => {
    const realPlugin = join(tmpRoot, 'real-plain');
    mkdirSync(realPlugin, { recursive: true });
    writePluginManifest(realPlugin, { ...VALID_BASE_MANIFEST, name: 'plain-linked' });
    const link = join(tmpRoot, 'plain-linked');
    symlinkSync(realPlugin, link, 'dir');
    const { status, stderr } = runValidator(link);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/Plugin directory is a symlink/);
  });

  it('auto-discovery (no argument) visits a symlinked plugins/<name> entry and refuses a symlinked plugins/ directory', () => {
    const project = join(tmpRoot, 'project');
    const realPlugin = join(project, 'plugins', 'real-one');
    mkdirSync(realPlugin, { recursive: true });
    writePluginManifest(realPlugin, { ...VALID_BASE_MANIFEST, name: 'real-one' });
    const elsewhere = join(tmpRoot, 'elsewhere-plugin');
    mkdirSync(elsewhere, { recursive: true });
    writePluginManifest(elsewhere, { ...VALID_BASE_MANIFEST, name: 'linked-one' });
    symlinkSync(elsewhere, join(project, 'plugins', 'linked-one'), 'dir');

    let result = runValidator('', project);
    expect(result.status).toBeGreaterThan(0);
    expect(result.stderr).toMatch(/Plugin directory is a symlink/);
    expect(result.stdout + result.stderr).toMatch(/real-one/);

    const project2 = join(tmpRoot, 'project2');
    mkdirSync(project2, { recursive: true });
    symlinkSync(join(project, 'plugins'), join(project2, 'plugins'), 'dir');
    result = runValidator('', project2);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/plugins\/ is a symlink/);

    const project3 = join(tmpRoot, 'project3');
    mkdirSync(project3, { recursive: true });
    symlinkSync(join(tmpRoot, 'nonexistent'), join(project3, 'plugins'), 'dir');
    result = runValidator('', project3);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/plugins\/ is a symlink/);
  });

  it('errors when the symlinked plugin root is given with a trailing slash (lstat would follow it)', () => {
    const realPlugin = join(tmpRoot, 'real-slash');
    mkdirSync(realPlugin, { recursive: true });
    writePluginManifest(realPlugin, { ...VALID_BASE_MANIFEST, name: 'slash-linked' });
    const link = join(tmpRoot, 'slash-linked');
    symlinkSync(realPlugin, link, 'dir');
    const { status, stderr } = runValidator(link + '/');
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/Plugin directory is a symlink/);
  });

  it('rejects `..` and symlinked ancestors in path fields (agents/commands/skills), not only in hook scripts', () => {
    const outside = join(tmpRoot, 'outside');
    mkdirSync(join(outside, 'agents'), { recursive: true });
    writeFileSync(join(outside, 'agents', 'a.md'), '# a\n', 'utf8');
    symlinkSync(outside, join(pluginDir, 'shared'), 'dir');
    writePluginManifest(pluginDir, { ...VALID_BASE_MANIFEST, agents: './shared/agents' });
    let result = runValidator(pluginDir);
    expect(result.status).toBeGreaterThan(0);
    expect(result.stderr).toMatch(/agents path passes through a symlinked directory \(shared\)/);

    mkdirSync(join(pluginDir, 'commands'), { recursive: true });
    writeFileSync(join(pluginDir, 'commands', 'c.md'), '# c\n', 'utf8');
    writePluginManifest(pluginDir, { ...VALID_BASE_MANIFEST, commands: './docs/../commands' });
    result = runValidator(pluginDir);
    expect(result.status).toBeGreaterThan(0);
    expect(result.stderr).toMatch(/commands path escapes plugin directory/);
  });

  it('errors on a dangling hooks/hooks.json symlink (RULE 7 uses lstat, not existsSync)', () => {
    mkdirSync(join(pluginDir, 'hooks'), { recursive: true });
    symlinkSync(
      join(tmpRoot, 'does-not-exist.json'),
      join(pluginDir, 'hooks', 'hooks.json'),
      'file'
    );
    writePluginManifest(pluginDir, VALID_BASE_MANIFEST);
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/hooks\/hooks\.json: not allowed/);
  });

  it('treats hooks/hooks.json as absent when `hooks` is a plain file (ENOTDIR — one policy with the generator)', () => {
    writeFileSync(join(pluginDir, 'hooks'), 'not a directory\n', 'utf8');
    writePluginManifest(pluginDir, VALID_BASE_MANIFEST);
    const { status, stderr } = runValidator(pluginDir);
    expect(stderr).not.toMatch(/hooks\/hooks\.json/);
    expect(status).toBe(0);
  });
});
