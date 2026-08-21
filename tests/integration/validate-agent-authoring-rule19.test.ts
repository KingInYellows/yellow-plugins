/**
 * Integration test for RULE 19 — the Skill-tool-grant consistency lint in
 * scripts/validate-agent-authoring.js.
 *
 * Any command or agent markdown file whose body instructs invoking the
 * `Skill` tool must declare `Skill` in its own tool grant (`allowed-tools`
 * for commands, `tools` for agents) — without the grant the invocation
 * cannot run at all.
 *
 * Deliberately broader than RULE 17: RULE 17 only scans a wrapper command's
 * "## Usage" section and only covers command files. This rule scans the
 * whole body (fence + frontmatter stripped) of BOTH command and agent
 * files, so it catches invocations mid-document in multi-phase
 * orchestrators and in agent files RULE 17 never looks at at all.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { runValidator, writeAgent } from './helpers/validator-harness';

function commandWithInvocation(opts: { allowedTools: string[]; fenced?: boolean }): string {
  const tools = opts.allowedTools.map((t) => `  - ${t}`).join('\n');
  const invocation = opts.fenced
    ? ['```text', 'Invoke the `Skill` tool with `skill: "some-skill"`.', '```'].join('\n')
    : 'Invoke the `Skill` tool with `skill: "some-skill"`.';
  return `---
name: demo:orchestrator
description: 'Fixture multi-phase command. Use when testing RULE 19.'
allowed-tools:
${tools}
---

# Demo Orchestrator

## Phase 1

Some prose well outside any "## Usage" heading, mirroring the multi-phase
orchestrators (plan/complete.md, review-pr.md) where RULE 19's target
invocations actually live.

${invocation}

## Phase 2

More steps here.
`;
}

function agentWithInvocation(opts: { tools: string[] }): string {
  const tools = opts.tools.map((t) => `  - ${t}`).join('\n');
  return `---
name: demo-agent
description: 'Fixture agent. Use when testing RULE 19.'
model: sonnet
tools:
${tools}
---

# demo-agent

Resolve the active stacked-PR provider first: invoke the \`Skill\` tool with
\`skill: "stack-provider-router"\` and read \`state\` from its result.
`;
}

describe('RULE 19 — Skill-tool invocation requires a declared grant', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rule19-'));
  });

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes when a command invokes Skill mid-document and grants it in allowed-tools (green)', () => {
    writeAgent(
      dir,
      'demo-plugin/commands/orchestrator.md',
      commandWithInvocation({ allowedTools: ['Bash', 'Skill'] })
    );
    const { status } = runValidator(dir);
    expect(status).toBe(0);
  });

  it('fails when a command invokes Skill mid-document but allowed-tools omits it (red)', () => {
    writeAgent(
      dir,
      'demo-plugin/commands/orchestrator.md',
      commandWithInvocation({ allowedTools: ['Bash'] })
    );
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 19');
    expect(stderr).toContain('allowed-tools');
  });

  it('restores to green after adding Skill back to allowed-tools', () => {
    writeAgent(
      dir,
      'demo-plugin/commands/orchestrator.md',
      commandWithInvocation({ allowedTools: ['Bash'] })
    );
    expect(runValidator(dir).status).toBe(1);

    writeAgent(
      dir,
      'demo-plugin/commands/orchestrator.md',
      commandWithInvocation({ allowedTools: ['Bash', 'Skill'] })
    );
    expect(runValidator(dir).status).toBe(0);
  });

  it('passes when an agent invokes Skill and grants it in tools (green)', () => {
    writeAgent(
      dir,
      'demo-plugin/agents/remediation/demo-agent.md',
      agentWithInvocation({ tools: ['Read', 'Edit', 'Write', 'Bash', 'Skill'] })
    );
    const { status } = runValidator(dir);
    expect(status).toBe(0);
  });

  it('fails when an agent invokes Skill but tools omits it — the class RULE 17 cannot see (red)', () => {
    // RULE 17 only walks commandFiles, so an agent file with this exact
    // defect (debt-fixer.md's real shape) is invisible to it. RULE 19 must
    // catch it on its own.
    writeAgent(
      dir,
      'demo-plugin/agents/remediation/demo-agent.md',
      agentWithInvocation({ tools: ['Read', 'Edit', 'Write', 'Bash'] })
    );
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 19');
    expect(stderr).toContain('"tools"');
  });

  it('ignores a Skill-tool mention shown inside a fenced code example', () => {
    writeAgent(
      dir,
      'demo-plugin/commands/orchestrator.md',
      commandWithInvocation({ allowedTools: ['Bash'], fenced: true })
    );
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(0);
    expect(stderr).not.toContain('RULE 19');
  });

  it('stays silent for a file that never mentions the Skill tool at all', () => {
    writeAgent(
      dir,
      'demo-plugin/commands/plain.md',
      `---
name: demo:plain
description: 'Fixture command with no Skill invocation. Use when testing RULE 19.'
allowed-tools:
  - Bash
---

# demo:plain

Ordinary prose that never mentions dispatching to another capability.
`
    );
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(0);
    expect(stderr).not.toContain('RULE 19');
  });
});
