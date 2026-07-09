/**
 * Integration test for the colon-less subagent_type and Task(bareword):
 * shorthand checks in scripts/validate-agent-authoring.js.
 *
 * Both checks are:
 *   - registry-gated: they only fire when the bare value matches the final
 *     segment of a registered plugin agent (RULE 13 lesson — membership
 *     logic anchored to plugin ownership, so built-in agent types like
 *     "general-purpose" never trip them);
 *   - fence-aware: illustrative examples inside fenced code blocks are
 *     exempt (gap #7 — teaching docs deliberately show anti-pattern forms).
 *
 * Red/green proof: a colon-less or bareword reference in prose fails; the
 * same reference rewritten to the canonical 3-segment form passes.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { runValidator, writeAgent } from './helpers/validator-harness';

// Registers demo:fixture-agent (2-seg) and demo:testing:fixture-agent (3-seg).
const AGENT_PATH = 'demo/agents/testing/fixture-agent.md';

const AGENT_BODY = `---
name: fixture-agent
description: "Test fixture. Use when verifying subagent reference lint rules."
tools:
  - Read
  - Grep
  - Glob
---

Body.
`;

const REFERENCE_PATH = 'demo/commands/run.md';

function commandBody(referenceLine: string): string {
  return `---
description: "Fixture command. Use when verifying subagent reference lint rules."
---

# Fixture command

${referenceLine}
`;
}

describe('subagent reference hardening — colon-less + Task(bareword):', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'subagent-refs-'));
    writeAgent(dir, AGENT_PATH, AGENT_BODY);
  });

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes with a canonical 3-segment subagent_type reference (green)', () => {
    writeAgent(
      dir,
      REFERENCE_PATH,
      commandBody(
        'Spawn via Task(subagent_type="demo:testing:fixture-agent") with the context.'
      )
    );
    const result = runValidator(dir);
    expect(result.status).toBe(0);
  });

  it('errors on a colon-less subagent_type naming a registered agent (red)', () => {
    writeAgent(
      dir,
      REFERENCE_PATH,
      commandBody('Spawn the agent (subagent_type: `"fixture-agent"`).')
    );
    const result = runValidator(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('colon-less subagent_type "fixture-agent"');
    expect(result.stderr).toContain('demo:testing:fixture-agent');
  });

  it('errors on Task(bareword): shorthand naming a registered agent (red)', () => {
    writeAgent(
      dir,
      REFERENCE_PATH,
      commandBody('Task(fixture-agent): "Do the fixture work."')
    );
    const result = runValidator(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Task(fixture-agent): shorthand');
    expect(result.stderr).toContain(
      'Task(subagent_type="demo:testing:fixture-agent")'
    );
  });

  it('does not flag colon-less or bareword forms inside fenced code blocks (FP guard)', () => {
    writeAgent(
      dir,
      REFERENCE_PATH,
      commandBody(
        [
          'Anti-pattern examples (illustrative only):',
          '',
          '```',
          'Task(fixture-agent): "Do the fixture work."',
          'subagent_type: "fixture-agent"',
          '```',
        ].join('\n')
      )
    );
    const result = runValidator(dir);
    expect(result.status).toBe(0);
  });

  it('does not flag colon-less values that match no registered agent', () => {
    writeAgent(
      dir,
      REFERENCE_PATH,
      commandBody('Fall back to subagent_type: "general-purpose" when needed.')
    );
    const result = runValidator(dir);
    expect(result.status).toBe(0);
  });

  it('red then fixed: rewriting to the 3-segment form turns the tree green', () => {
    writeAgent(
      dir,
      REFERENCE_PATH,
      commandBody('Spawn the agent (subagent_type: `"fixture-agent"`).')
    );
    expect(runValidator(dir).status).toBe(1);

    writeAgent(
      dir,
      REFERENCE_PATH,
      commandBody(
        'Spawn the agent (subagent_type: `"demo:testing:fixture-agent"`).'
      )
    );
    expect(runValidator(dir).status).toBe(0);
  });
});
