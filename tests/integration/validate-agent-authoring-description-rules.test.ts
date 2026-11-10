/**
 * Integration test for the two description rules in
 * scripts/validate-agent-authoring.js that reach beyond SKILL.md:
 *
 *   RULE 15d on agents and commands: a multi-line `description:` is an
 *     advisory (stdout, exit 0), as it already is for SKILL.md.
 *   RULE 23: per-plugin description totals against a committed baseline.
 *     Growth is an error; a drop or a stale entry is a notice.
 *
 * RULE 23 runs in a fixture tree only when VALIDATE_DESCRIPTION_BASELINE
 * names a baseline, so the other validator tests never see it.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { runValidator, writeAgent } from './helpers/validator-harness';

const VALIDATOR = resolve(
  __dirname,
  '..',
  '..',
  'scripts',
  'validate-agent-authoring.js'
);

const TEN = 'abcdefghij';

function command(descriptionLines: string, extra = ''): string {
  return `---\nname: demo:cmd\n${descriptionLines}\n${extra}allowed-tools:\n  - Read\n---\n\nBody.\n`;
}

function agent(descriptionLines: string): string {
  return `---\nname: demo-agent\n${descriptionLines}\ntools:\n  - Read\n---\n\nBody.\n`;
}

function skill(descriptionLines: string): string {
  return `---\nname: demo-skill\n${descriptionLines}\n---\n\n## What It Does\n\nX.\n\n## When to Use\n\nX.\n\n## Usage\n\nX.\n`;
}

describe('validate-agent-authoring description rules', () => {
  let root: string;
  let plugins: string;
  let baselineFile: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'description-rules-'));
    plugins = join(root, 'plugins');
    baselineFile = join(root, 'baseline.json');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeBaseline(entries: Record<string, number>, unit = 'chars') {
    writeFileSync(baselineFile, JSON.stringify({ unit, plugins: entries }));
  }

  // stdout and stderr together: errors go to stderr, the rest to stdout.
  function runBudget(args: string[] = []) {
    const result = spawnSync('node', [VALIDATOR, ...args], {
      env: {
        ...process.env,
        VALIDATE_PLUGINS_DIR: plugins,
        VALIDATE_DESCRIPTION_BASELINE: baselineFile,
      },
      encoding: 'utf8',
    });
    return { status: result.status, output: result.stdout + result.stderr };
  }

  // alpha: command 10 + agent 10 + skill 10 and when_to_use 5 = 35 chars.
  function writeAlpha() {
    writeAgent(
      plugins,
      'alpha/commands/demo/cmd.md',
      command(`description: ${TEN}`)
    );
    writeAgent(
      plugins,
      'alpha/agents/demo-agent.md',
      agent(`description: ${TEN}`)
    );
    writeAgent(
      plugins,
      'alpha/skills/demo-skill/SKILL.md',
      skill(`description: ${TEN}\nwhen_to_use: abcde`)
    );
  }

  describe('RULE 15d on agents and commands', () => {
    it('warns on a block-scalar description in an agent', () => {
      writeAgent(
        plugins,
        'alpha/agents/demo-agent.md',
        agent('description: >\n  Folded fixture. Use when testing.')
      );
      const { status, stdout } = runValidator(plugins);
      expect(status).toBe(0);
      expect(stdout).toContain('[RULE 15d advisory]');
      expect(stdout).toContain('agents/demo-agent.md');
    });

    it('warns on a wrapped quoted description in a command', () => {
      writeAgent(
        plugins,
        'alpha/commands/demo/cmd.md',
        command("description:\n  'Wrapped fixture. Use when\n  testing.'")
      );
      const { status, stdout } = runValidator(plugins);
      expect(status).toBe(0);
      expect(stdout).toContain('[RULE 15d advisory]');
      expect(stdout).toContain('commands/demo/cmd.md');
    });

    it('stays silent on single-line descriptions', () => {
      writeAlpha();
      const { status, stdout } = runValidator(plugins);
      expect(status).toBe(0);
      expect(stdout).not.toContain('RULE 15d');
    });

    it('fails on a command whose frontmatter is not valid YAML', () => {
      // A duplicate key: the budget cannot count this file, so it must not pass.
      writeAgent(
        plugins,
        'alpha/commands/demo/cmd.md',
        command(`description: ${TEN}\ndescription: ${TEN}`)
      );
      const { status, stderr } = runValidator(plugins);
      expect(status).toBe(1);
      expect(stderr).toContain(
        'commands/demo/cmd.md: malformed YAML frontmatter'
      );
    });

    it('reports a SKILL.md violation once', () => {
      writeAgent(
        plugins,
        'alpha/skills/demo-skill/SKILL.md',
        skill('description: >\n  Folded fixture. Use when testing.')
      );
      const { stdout } = runValidator(plugins);
      expect(stdout.match(/RULE 15d/g)).toHaveLength(1);
    });
  });

  describe('RULE 23 description budget', () => {
    it('is skipped in a fixture run that names no baseline', () => {
      writeAlpha();
      const { status, stdout } = runValidator(plugins);
      expect(status).toBe(0);
      expect(stdout).not.toContain('Description budget');
    });

    it('passes at the baseline and prints the split by kind', () => {
      writeAlpha();
      writeBaseline({ alpha: 35 });
      const { status, output } = runBudget();
      expect(status).toBe(0);
      expect(output).toContain(
        'Description budget: 35 chars (commands 10, agents 10, skills 15)'
      );
      expect(output).not.toContain('RULE 23');
    });

    it('fails above the baseline, naming the plugin, numbers and command', () => {
      writeAlpha();
      writeBaseline({ alpha: 34 });
      const { status, output } = runBudget();
      expect(status).toBe(1);
      expect(output).toContain(
        'RULE 23 — alpha: description total 35 chars is over its baseline 34 (+1)'
      );
      expect(output).toContain('pnpm update:description-baseline');
    });

    it('passes below the baseline with a notice', () => {
      writeAlpha();
      writeBaseline({ alpha: 40 });
      const { status, output } = runBudget();
      expect(status).toBe(0);
      expect(output).toContain(
        '[RULE 23 notice] alpha: description total 35 chars is under its baseline 40 (-5)'
      );
    });

    it('treats a plugin with no baseline entry as baseline 0', () => {
      writeAlpha();
      writeBaseline({});
      const { status, output } = runBudget();
      expect(status).toBe(1);
      expect(output).toContain('is over its baseline 0 (+35)');
    });

    it('notes a baseline entry whose plugin directory is gone', () => {
      writeAlpha();
      writeBaseline({ alpha: 35, gone: 9 });
      const { status, output } = runBudget();
      expect(status).toBe(0);
      expect(output).toContain(
        '[RULE 23 notice] baseline entry "gone" has no plugin directory'
      );
    });

    it('does not count generated codex and cursor skill copies', () => {
      writeAlpha();
      for (const target of ['codex', 'cursor']) {
        writeAgent(
          plugins,
          `alpha/${target}/skills/demo-skill/SKILL.md`,
          skill(`description: ${TEN}`)
        );
      }
      writeBaseline({ alpha: 35 });
      expect(runBudget().status).toBe(0);
    });

    it('skips commands with disable-model-invocation: true only', () => {
      writeAgent(
        plugins,
        'alpha/commands/demo/hidden.md',
        command(`description: ${TEN}`, 'disable-model-invocation: true\n')
      );
      writeAgent(
        plugins,
        'alpha/commands/demo/quoted.md',
        command(`description: ${TEN}`, 'disable-model-invocation: "true"\n')
      );
      writeAgent(
        plugins,
        'alpha/commands/demo/plain.md',
        command(`description: ${TEN}`)
      );
      writeBaseline({ alpha: 20 });
      const { status, output } = runBudget();
      expect(status).toBe(0);
      expect(output).toContain('Description budget: 20 chars');
    });

    it.each([
      ['a non-string description', command('description: 12345')],
      ['no description key', command('argument-hint: x')],
      ['no frontmatter', '# Command\n\nBody.\n'],
      [
        'a byte-order mark before the frontmatter',
        '\uFEFF' + command(`description: ${TEN}`),
      ],
    ])('fails on a command with %s, which it cannot count', (_label, body) => {
      writeAgent(plugins, 'alpha/commands/demo/cmd.md', body);
      writeBaseline({ alpha: 0 });
      const { status, output } = runBudget();
      expect(status).toBe(1);
      expect(output).toContain(
        'commands/demo/cmd.md: no string `description:`'
      );
    });

    it('fails on a skill with no description', () => {
      writeAgent(
        plugins,
        'alpha/skills/demo-skill/SKILL.md',
        skill('user-invocable: true')
      );
      writeBaseline({ alpha: 0 });
      const { status, output } = runBudget();
      expect(status).toBe(1);
      expect(output).toContain('SKILL.md: no string `description:`');
    });

    it('counts each file once, and only skills/<name>/SKILL.md as a skill', () => {
      writeAlpha();
      // In both the command and the agent file lists.
      writeAgent(
        plugins,
        'alpha/commands/demo/agents/both.md',
        command(`description: ${TEN}`)
      );
      // Under skills/ but not skill manifests.
      writeAgent(
        plugins,
        'alpha/skills/demo-skill/agents/helper.md',
        agent(`description: ${TEN}`)
      );
      writeAgent(
        plugins,
        'alpha/skills/demo-skill/nested/SKILL.md',
        skill(`description: ${TEN}`)
      );
      writeBaseline({ alpha: 45 });
      const { output } = runBudget();
      expect(output).toContain(
        'Description budget: 45 chars (commands 20, agents 10, skills 15)'
      );
    });

    it('gives a plugin with no counted files a total of 0', () => {
      writeAgent(plugins, 'empty/README.md', '# Empty\n');
      writeBaseline({ empty: 5 });
      const { status, output } = runBudget();
      expect(status).toBe(0);
      expect(output).toContain(
        '[RULE 23 notice] empty: description total 0 chars is under its baseline 5 (-5)'
      );
    });

    it('fails on a baseline entry that is not a non-negative integer', () => {
      writeAlpha();
      writeFileSync(
        baselineFile,
        JSON.stringify({ unit: 'chars', plugins: { alpha: '35' } })
      );
      const { status, output } = runBudget();
      expect(status).toBe(1);
      expect(output).toContain(
        'RULE 23 — alpha: baseline entry must be a non-negative integer'
      );
    });

    it('counts a CRLF file the same as its LF twin', () => {
      writeAgent(
        plugins,
        'alpha/commands/demo/cmd.md',
        command(`description: ${TEN}`).replace(/\n/g, '\r\n')
      );
      writeBaseline({ alpha: 10 });
      const { status, output } = runBudget();
      expect(status).toBe(0);
      expect(output).not.toContain('RULE 23');
    });

    it('fails when the baseline unit is not chars', () => {
      writeAlpha();
      writeBaseline({ alpha: 35 }, 'tokens');
      const { status, output } = runBudget();
      expect(status).toBe(1);
      expect(output).toContain('must have `"unit": "chars"`');
    });

    it('fails when the baseline file is missing', () => {
      writeAlpha();
      const { status, output } = runBudget();
      expect(status).toBe(1);
      expect(output).toContain(
        'RULE 23 — cannot read the description baseline'
      );
    });

    it('--update-description-baseline writes sorted entries and drops stale ones', () => {
      writeAgent(
        plugins,
        'beta/commands/demo/cmd.md',
        command(`description: ${TEN}`)
      );
      writeAlpha();
      writeBaseline({ gone: 9, beta: 99 });
      const { status } = runBudget(['--update-description-baseline']);
      expect(status).toBe(0);
      expect(readFileSync(baselineFile, 'utf8')).toBe(
        '{\n  "unit": "chars",\n  "plugins": {\n    "alpha": 35,\n    "beta": 10\n  }\n}\n'
      );
    });
  });
});
