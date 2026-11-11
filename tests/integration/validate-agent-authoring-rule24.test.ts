/**
 * Integration test for RULE 24 in scripts/validate-agent-authoring.js: a
 * command and a skill in the same plugin must not share a `name:`. Claude
 * Code resolves such a pair to the command, which leaves the skill body
 * unreachable.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { runValidator, writeAgent } from './helpers/validator-harness';

function command(name: string): string {
  return `---\nname: ${name}\ndescription: Fixture command. Use when testing RULE 24.\nallowed-tools:\n  - Read\n---\n\nBody.\n`;
}

function skill(name: string): string {
  return `---\nname: ${name}\ndescription: Fixture skill. Use when testing RULE 24.\nuser-invocable: true\n---\n\n## What It Does\n\nX.\n\n## When to Use\n\nX.\n\n## Usage\n\nX.\n`;
}

describe('validate-agent-authoring RULE 24 (command/skill name collision)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rule24-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('fails when a command and a skill in one plugin share a name', () => {
    writeAgent(dir, 'alpha/commands/demo.md', command('demo'));
    writeAgent(dir, 'alpha/skills/demo/SKILL.md', skill('demo'));
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 24 — skill name "demo"');
    expect(stderr).toContain('commands/demo.md');
  });

  it('uses the file name of a command that has no name key', () => {
    writeAgent(
      dir,
      'alpha/commands/demo.md',
      command('demo').replace('name: demo\n', '')
    );
    writeAgent(dir, 'alpha/skills/demo/SKILL.md', skill('demo'));
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 24 — skill name "demo"');
  });

  it('compares the skill name key, not its directory', () => {
    writeAgent(dir, 'alpha/commands/demo.md', command('demo'));
    writeAgent(dir, 'alpha/skills/other-dir/SKILL.md', skill('demo'));
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 24 — skill name "demo"');
  });

  it('fails for a user-invocable: false skill too, which the command still shadows', () => {
    writeAgent(dir, 'alpha/commands/demo.md', command('demo'));
    writeAgent(
      dir,
      'alpha/skills/demo/SKILL.md',
      skill('demo').replace('user-invocable: true', 'user-invocable: false')
    );
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 24 — skill name "demo"');
  });

  it('passes when the names differ, as in the wrapper layout other plugins use', () => {
    writeAgent(dir, 'alpha/commands/demo/run.md', command('demo:run'));
    writeAgent(dir, 'alpha/skills/demo-run/SKILL.md', skill('demo-run'));
    const { status, stdout, stderr } = runValidator(dir);
    expect(status).toBe(0);
    expect(stdout + stderr).not.toContain('RULE 24');
  });

  it('passes when the same name is used by a command and a skill in different plugins', () => {
    writeAgent(dir, 'alpha/commands/demo.md', command('demo'));
    writeAgent(dir, 'beta/skills/demo/SKILL.md', skill('demo'));
    const { status, stdout, stderr } = runValidator(dir);
    expect(status).toBe(0);
    expect(stdout + stderr).not.toContain('RULE 24');
  });

  it('ignores a generated codex copy of a skill', () => {
    writeAgent(dir, 'alpha/commands/demo.md', command('demo'));
    writeAgent(dir, 'alpha/codex/skills/demo/SKILL.md', skill('demo'));
    const { status, stdout, stderr } = runValidator(dir);
    expect(status).toBe(0);
    expect(stdout + stderr).not.toContain('RULE 24');
  });
});
