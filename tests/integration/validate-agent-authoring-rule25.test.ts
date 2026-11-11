/**
 * Integration test for RULE 25 in scripts/validate-agent-authoring.js. An
 * entry point with `disable-model-invocation: true` is refused by the Skill
 * tool, so nothing may dispatch it by name.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { runValidator, writeAgent } from './helpers/validator-harness';

const DISABLED = 'disable-model-invocation: true\n';

function command(name: string, extra = '', body = 'Body.'): string {
  return `---\nname: ${name}\ndescription: Fixture command. Use when testing RULE 25.\n${extra}allowed-tools:\n  - Read\n  - Skill\n---\n\n${body}\n`;
}

function skill(name: string, extra = ''): string {
  return `---\nname: ${name}\ndescription: Fixture skill. Use when testing RULE 25.\n${extra}---\n\n## What It Does\n\nX.\n\n## When to Use\n\nX.\n\n## Usage\n\nX.\n`;
}

function agent(skills: string): string {
  return `---\nname: demo-agent\ndescription: Fixture agent. Use when testing RULE 25.\nmodel: inherit\ntools:\n  - Read\nskills:\n  - ${skills}\n---\n\nBody.\n`;
}

describe('validate-agent-authoring RULE 25 (disable-model-invocation)', () => {
  let root: string;
  let dir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rule25-'));
    dir = join(root, 'plugins');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('passes when nothing dispatches the flagged command', () => {
    writeAgent(
      dir,
      'alpha/commands/alpha/run.md',
      command('alpha:run', DISABLED)
    );
    writeAgent(dir, 'alpha/commands/alpha/other.md', command('alpha:other'));
    const { status, stdout } = runValidator(dir);
    expect(status).toBe(0);
    expect(stdout).not.toContain('RULE 25');
  });

  it('fails when another command dispatches a flagged command', () => {
    writeAgent(
      dir,
      'alpha/commands/alpha/run.md',
      command('alpha:run', DISABLED)
    );
    writeAgent(
      dir,
      'beta/commands/beta/chain.md',
      command('beta:chain', '', 'Invoke `skill: "alpha:run"` next.')
    );
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('beta/commands/beta/chain.md: RULE 25');
    expect(stderr).toContain('"alpha:run"');
    expect(stderr).toContain('alpha/commands/alpha/run.md sets');
  });

  it('ignores a dispatch shown inside a code fence', () => {
    writeAgent(
      dir,
      'alpha/commands/alpha/run.md',
      command('alpha:run', DISABLED)
    );
    writeAgent(
      dir,
      'beta/commands/beta/chain.md',
      command('beta:chain', '', '```text\nskill: "alpha:run"\n```')
    );
    expect(runValidator(dir).status).toBe(0);
  });

  it.each([
    ['its qualified name', 'beta', 'alpha:helper'],
    ['its bare name from the same plugin', 'alpha', 'helper'],
  ])(
    'fails when a flagged skill is dispatched by %s',
    (_label, plugin, value) => {
      writeAgent(
        dir,
        'alpha/skills/helper/SKILL.md',
        skill('helper', `user-invocable: true\n${DISABLED}`)
      );
      writeAgent(
        dir,
        `${plugin}/commands/${plugin}/chain.md`,
        command(`${plugin}:chain`, '', `Invoke \`skill: "${value}"\` next.`)
      );
      const { status, stderr } = runValidator(dir);
      expect(status).toBe(1);
      expect(stderr).toContain(`RULE 25 — dispatches \`skill:\` "${value}"`);
    }
  );

  it('does not match a bare skill name from another plugin', () => {
    writeAgent(
      dir,
      'alpha/skills/helper/SKILL.md',
      skill('helper', `user-invocable: true\n${DISABLED}`)
    );
    writeAgent(dir, 'beta/skills/helper/SKILL.md', skill('helper'));
    writeAgent(
      dir,
      'beta/commands/beta/chain.md',
      command('beta:chain', '', 'Invoke `skill: "helper"` next.')
    );
    const { stderr } = runValidator(dir);
    expect(stderr).not.toContain('RULE 25');
  });

  it('fails when an agent preloads a flagged skill', () => {
    writeAgent(
      dir,
      'alpha/skills/helper/SKILL.md',
      skill('helper', `user-invocable: true\n${DISABLED}`)
    );
    writeAgent(dir, 'alpha/agents/demo-agent.md', agent('helper'));
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 25 — preloads the skill "helper"');
  });

  it('fails when the setup list delegates to a flagged command', () => {
    writeAgent(
      dir,
      'alpha/commands/alpha/setup.md',
      command('alpha:setup', DISABLED)
    );
    writeAgent(
      dir,
      'yellow-core/commands/setup/all.md',
      command(
        'setup:all',
        '',
        '<!-- setup-all-delegated-commands:start -->\n\n1. `alpha:setup`\n<!-- setup-all-delegated-commands:end -->'
      )
    );
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 25 — delegates setup to "alpha:setup"');
  });

  it('fails when the stack-operation registry routes to a flagged skill', () => {
    writeAgent(
      dir,
      'alpha/skills/sync/SKILL.md',
      skill('sync', `user-invocable: true\n${DISABLED}`)
    );
    writeAgent(
      dir,
      'yellow-core/lib/stack-operation-registry.js',
      "module.exports = { OPERATIONS: { sync: { graphite: { type: 'command', plugin: 'alpha', ref: 'sync' } } }, PRIMITIVES: {} };\n"
    );
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 25 — routes an operation to "sync"');
  });

  it('fails when a skill sets the key and user-invocable: false', () => {
    writeAgent(
      dir,
      'alpha/skills/helper/SKILL.md',
      skill('helper', `user-invocable: false\n${DISABLED}`)
    );
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('neither the model nor the user');
  });

  it('fails when the value is a string, which the budget would still count', () => {
    writeAgent(
      dir,
      'alpha/commands/alpha/run.md',
      command('alpha:run', 'disable-model-invocation: "true"\n')
    );
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('must be the boolean true or false, not "true"');
  });

  it('accepts an explicit false', () => {
    writeAgent(
      dir,
      'alpha/commands/alpha/run.md',
      command('alpha:run', 'disable-model-invocation: false\n')
    );
    writeAgent(
      dir,
      'beta/commands/beta/chain.md',
      command('beta:chain', '', 'Invoke `skill: "alpha:run"` next.')
    );
    expect(runValidator(dir).status).toBe(0);
  });

  it.each([
    ['a hook script', 'plugins/alpha/hooks/scripts/session-start.sh'],
    ['the root CLAUDE.md', 'CLAUDE.md'],
  ])('warns when %s names a flagged command', (_label, relPath) => {
    writeAgent(
      dir,
      'alpha/commands/alpha/run.md',
      command('alpha:run', DISABLED)
    );
    writeAgent(root, relPath, 'Run /alpha:run to continue.\n');
    const { status, stdout } = runValidator(dir);
    expect(status).toBe(0);
    expect(stdout).toContain('[RULE 25 advisory]');
    expect(stdout).toContain('names `/alpha:run`');
  });

  it('uses the path of a flagged command that has no name key', () => {
    writeAgent(
      dir,
      'alpha/commands/alpha/run.md',
      command('alpha:run', DISABLED).replace('name: alpha:run\n', '')
    );
    writeAgent(
      dir,
      'beta/commands/beta/chain.md',
      command('beta:chain', '', 'Invoke `skill: "alpha:run"` next.')
    );
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 25 — dispatches `skill:` "alpha:run"');
  });

  it('fails when the registry routes to a flagged command', () => {
    writeAgent(
      dir,
      'alpha/commands/alpha/run.md',
      command('alpha:run', DISABLED)
    );
    writeAgent(
      dir,
      'yellow-core/lib/stack-operation-registry.js',
      "module.exports = { OPERATIONS: { run: { github: { type: 'command', plugin: 'alpha', ref: 'alpha:run' } } } };\n"
    );
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 25 — routes an operation to "alpha:run"');
  });

  it('reports only the flagged entry of a longer setup list', () => {
    writeAgent(dir, 'alpha/commands/alpha/setup.md', command('alpha:setup'));
    writeAgent(
      dir,
      'beta/commands/beta/setup.md',
      command('beta:setup', DISABLED)
    );
    writeAgent(
      dir,
      'yellow-core/commands/setup/all.md',
      command(
        'setup:all',
        '',
        '<!-- setup-all-delegated-commands:start -->\n\n1. `alpha:setup`\n2. `beta:setup`\n<!-- setup-all-delegated-commands:end -->'
      )
    );
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 25 — delegates setup to "beta:setup"');
    expect(stderr).not.toContain('delegates setup to "alpha:setup"');
  });

  it('fails when the setup list markers are missing', () => {
    writeAgent(
      dir,
      'alpha/commands/alpha/run.md',
      command('alpha:run', DISABLED)
    );
    writeAgent(dir, 'yellow-core/commands/setup/all.md', command('setup:all'));
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain(
      'RULE 25 — cannot find the delegated-commands markers'
    );
  });

  it('fails when the registry routes a primitive to a flagged command', () => {
    writeAgent(
      dir,
      'alpha/commands/alpha/run.md',
      command('alpha:run', DISABLED)
    );
    writeAgent(
      dir,
      'yellow-core/lib/stack-operation-registry.js',
      "module.exports = { OPERATIONS: {}, PRIMITIVES: { run: { github: { type: 'command', plugin: 'alpha', ref: 'alpha:run' } } } };\n"
    );
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 25 — routes an operation to "alpha:run"');
  });

  it('fails when the registry exports no OPERATIONS', () => {
    writeAgent(
      dir,
      'alpha/commands/alpha/run.md',
      command('alpha:run', DISABLED)
    );
    writeAgent(
      dir,
      'yellow-core/lib/stack-operation-registry.js',
      'module.exports = { operations: {} };\n'
    );
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain(
      'RULE 25 — the registry exports no OPERATIONS object'
    );
  });

  it('fails when a skill sets a quoted value', () => {
    writeAgent(
      dir,
      'alpha/skills/helper/SKILL.md',
      skill(
        'helper',
        'user-invocable: true\ndisable-model-invocation: "true"\n'
      )
    );
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('must be the boolean true or false, not "true"');
  });

  it('matches a flagged skill by its name key, not its directory', () => {
    writeAgent(
      dir,
      'alpha/skills/helper/SKILL.md',
      skill('renamed', `user-invocable: true\n${DISABLED}`)
    );
    writeAgent(
      dir,
      'beta/commands/beta/chain.md',
      command('beta:chain', '', 'Invoke `skill: "alpha:renamed"` next.')
    );
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 25 — dispatches `skill:` "alpha:renamed"');
  });

  it('fails when the registry cannot be loaded', () => {
    writeAgent(
      dir,
      'alpha/commands/alpha/run.md',
      command('alpha:run', DISABLED)
    );
    writeAgent(
      dir,
      'yellow-core/lib/stack-operation-registry.js',
      "throw new Error('broken');\n"
    );
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain(
      'RULE 25 — cannot load the stack-operation registry'
    );
  });

  it('fails when an agent preloads a flagged skill by its qualified name', () => {
    writeAgent(
      dir,
      'alpha/skills/helper/SKILL.md',
      skill('helper', `user-invocable: true\n${DISABLED}`)
    );
    writeAgent(dir, 'beta/agents/demo-agent.md', agent('alpha:helper'));
    const { stderr } = runValidator(dir);
    expect(stderr).toContain('RULE 25 — preloads the skill "alpha:helper"');
  });

  it.each([
    [
      'a path that ends in the command name',
      'plugins/alpha/hooks/a.sh',
      'See scripts/alpha:run for details.\n',
    ],
    [
      'a fixture directory named hooks outside a plugin hooks folder',
      'plugins/alpha/tests/fixtures/hooks/a.sh',
      'Run /alpha:run to continue.\n',
    ],
  ])('does not warn on %s', (_label, relPath, text) => {
    writeAgent(
      dir,
      'alpha/commands/alpha/run.md',
      command('alpha:run', DISABLED)
    );
    writeAgent(root, relPath, text);
    const { status, stdout } = runValidator(dir);
    expect(status).toBe(0);
    expect(stdout).not.toContain('RULE 25');
  });

  it('does not warn on the bare name of a flagged skill', () => {
    writeAgent(
      dir,
      'alpha/skills/helper/SKILL.md',
      skill('helper', `user-invocable: true\n${DISABLED}`)
    );
    writeAgent(root, 'plugins/alpha/hooks/a.sh', 'Run /helper to continue.\n');
    const { stdout } = runValidator(dir);
    expect(stdout).not.toContain('RULE 25');
  });

  it('does not warn on a longer command name that starts the same way', () => {
    writeAgent(
      dir,
      'alpha/commands/alpha/run.md',
      command('alpha:run', DISABLED)
    );
    writeAgent(root, 'CLAUDE.md', 'Run /alpha:run-all to continue.\n');
    const { stdout } = runValidator(dir);
    expect(stdout).not.toContain('RULE 25');
  });
});
