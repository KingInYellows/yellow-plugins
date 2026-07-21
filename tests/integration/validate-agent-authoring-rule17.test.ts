/**
 * Integration test for RULE 17 — the wrapper -> canonical-skill drift lint
 * in scripts/validate-agent-authoring.js.
 *
 * A command markdown file using the shell-03 wrapper idiom ("Invoke the
 * `Skill` tool with `skill: "<name>"`." inside a "## Usage" section) must:
 *   (1) have a matching skills/<name>/SKILL.md in the SAME plugin;
 *   (2) carry "Skill" in its own "allowed-tools" frontmatter.
 *
 * The check is scoped to "## Usage" section content only — a whole-body
 * scan false-flagged pre-existing cross-plugin composition references
 * (e.g. a large multi-phase workflow file invoking a skill that belongs to
 * a different plugin as one step among many), which is a different,
 * legitimate pattern this rule does not validate.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { runValidator, writeAgent } from './helpers/validator-harness';

function wrapperCommand(opts: {
  skillName: string;
  allowedTools: string[];
  usageSentence?: string;
}): string {
  const tools = opts.allowedTools.map((t) => `  - ${t}`).join('\n');
  const usage = opts.usageSentence ?? `Invoke the \`Skill\` tool with \`skill: "${opts.skillName}"\`.`;
  return `---
name: demo-wrapper
description: 'Fixture wrapper command. Use when testing RULE 17.'
allowed-tools:
${tools}
---

# Demo Wrapper

Some descriptive prose about what this wrapper does, mirroring the
shell-03 precedent's shape.

## Usage

${usage}
`;
}

function canonicalSkill(name: string): string {
  return `---
name: ${name}
description: Fixture canonical skill. Use when testing RULE 17.
---

# ${name}

## What It Does

Fixture body.

## When to Use

Fixture body.

## Usage

Fixture body.
`;
}

describe('RULE 17 — wrapper -> canonical-skill drift lint', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rule17-'));
  });

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes when the wrapper has Skill in allowed-tools and the canonical skill exists (green)', () => {
    writeAgent(
      dir,
      'demo-plugin/commands/demo-wrapper.md',
      wrapperCommand({ skillName: 'demo-skill', allowedTools: ['Bash', 'Skill'] })
    );
    writeAgent(dir, 'demo-plugin/skills/demo-skill/SKILL.md', canonicalSkill('demo-skill'));
    const { status } = runValidator(dir);
    expect(status).toBe(0);
  });

  it('fails when allowed-tools is missing Skill (red)', () => {
    writeAgent(
      dir,
      'demo-plugin/commands/demo-wrapper.md',
      wrapperCommand({ skillName: 'demo-skill', allowedTools: ['Bash'] })
    );
    writeAgent(dir, 'demo-plugin/skills/demo-skill/SKILL.md', canonicalSkill('demo-skill'));
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 17');
    expect(stderr).toContain('allowed-tools');
  });

  it('restores to green after adding Skill back to allowed-tools', () => {
    writeAgent(
      dir,
      'demo-plugin/commands/demo-wrapper.md',
      wrapperCommand({ skillName: 'demo-skill', allowedTools: ['Bash'] })
    );
    writeAgent(dir, 'demo-plugin/skills/demo-skill/SKILL.md', canonicalSkill('demo-skill'));
    expect(runValidator(dir).status).toBe(1);

    writeAgent(
      dir,
      'demo-plugin/commands/demo-wrapper.md',
      wrapperCommand({ skillName: 'demo-skill', allowedTools: ['Bash', 'Skill'] })
    );
    expect(runValidator(dir).status).toBe(0);
  });

  it('fails when the referenced skills/<name>/SKILL.md does not exist', () => {
    writeAgent(
      dir,
      'demo-plugin/commands/demo-wrapper.md',
      wrapperCommand({ skillName: 'missing-skill', allowedTools: ['Bash', 'Skill'] })
    );
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 17');
    expect(stderr).toContain('missing-skill');
  });

  it('does not accept a same-named skill in a DIFFERENT plugin (same-plugin only)', () => {
    writeAgent(
      dir,
      'demo-plugin/commands/demo-wrapper.md',
      wrapperCommand({ skillName: 'demo-skill', allowedTools: ['Bash', 'Skill'] })
    );
    writeAgent(dir, 'other-plugin/skills/demo-skill/SKILL.md', canonicalSkill('demo-skill'));
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 17');
  });

  it('ignores a skill: "<name>" reference outside any "## Usage" section (cross-plugin composition in a larger doc)', () => {
    const body = `---
name: big-workflow
description: 'Fixture large multi-step workflow. Use when testing RULE 17 scoping.'
allowed-tools:
  - Bash
---

# Big Workflow

## Phase 1

Delegate to another plugin's skill as one step of many:
invoke the Skill tool with \`skill: "other-plugins-skill"\`.

## Phase 2

More steps here, no "## Usage" heading anywhere in this file.
`;
    writeAgent(dir, 'demo-plugin/commands/big-workflow.md', body);
    // Deliberately do NOT create demo-plugin/skills/other-plugins-skill/ —
    // if RULE 17 scanned the whole body this would fail.
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(0);
    expect(stderr).not.toContain('RULE 17');
  });
});
