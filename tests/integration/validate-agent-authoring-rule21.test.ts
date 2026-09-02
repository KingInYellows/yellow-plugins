/**
 * Integration test for RULE 21 — the command/agent line ceilings in
 * scripts/validate-agent-authoring.js (commands > 500 lines, agents > 300).
 *
 * WARNING tier, like RULE 15a: ~25 shipped files exceed the ceilings today,
 * so every trigger case asserts BOTH that the advisory appears on stdout AND
 * that the exit status stays 0. SKILL.md files are RULE 15a's turf and must
 * not be double-reported here.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { runValidator, writeAgent } from './helpers/validator-harness';

function padded(header: string, bodyLines: number): string {
  return header + Array.from({ length: bodyLines }, (_, i) => `line ${i}`).join('\n') + '\n';
}

const COMMAND_HEADER = `---
name: demo:big
description: "Big fixture command. Use when verifying RULE 21."
allowed-tools:
  - Read
---

`;

const AGENT_HEADER = `---
name: big-agent
description: "Big fixture agent. Use when verifying RULE 21."
tools:
  - Read
---

`;

describe('validate-agent-authoring RULE 21 (command/agent line ceilings)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rule21-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('warns (status 0) on a command over 500 lines', () => {
    writeAgent(dir, 'plug/commands/big.md', padded(COMMAND_HEADER, 520));
    const { status, stdout } = runValidator(dir);
    expect(status).toBe(0);
    expect(stdout).toContain('RULE 21 advisory');
    expect(stdout).toContain('command ceiling 500');
  });

  it('warns (status 0) on an agent over 300 lines', () => {
    writeAgent(dir, 'plug/agents/workflow/big-agent.md', padded(AGENT_HEADER, 320));
    const { status, stdout } = runValidator(dir);
    expect(status).toBe(0);
    expect(stdout).toContain('RULE 21 advisory');
    expect(stdout).toContain('agent ceiling 300');
  });

  it('stays silent for a command under 500 and an agent under 300 lines', () => {
    writeAgent(dir, 'plug/commands/small.md', padded(COMMAND_HEADER, 100));
    writeAgent(dir, 'plug/agents/workflow/small-agent.md', padded(AGENT_HEADER, 100));
    const { status, stdout } = runValidator(dir);
    expect(status).toBe(0);
    expect(stdout).not.toContain('RULE 21');
  });
});
