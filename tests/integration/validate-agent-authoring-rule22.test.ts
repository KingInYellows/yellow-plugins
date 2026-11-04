/**
 * Integration test for RULE 22 — the durable-bar drift lint in
 * scripts/validate-agent-authoring.js.
 *
 * CE's durable-bar paragraph gates new learnings in knowledge-compounder and
 * staging-scorer. RULE 22 requires each declared copy to sit between the
 * durable-bar markers, to be byte-identical to the other copy, and to match
 * the upstream paragraph once whitespace is normalized. Undeclared copies
 * fail, and a declared file missing from the tree fails in strict mode.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { runValidator, writeAgent } from './helpers/validator-harness';

const COMPOUNDER = 'yellow-core/agents/workflow/knowledge-compounder.md';
const SCORER = 'yellow-core/agents/workflow/staging-scorer.md';

// Wrapped the way Prettier wraps it in the shipped agents.
const BAR = `A learning earns its place only when it holds durable project reasoning that is
not readily recoverable from the final code, tests, types, comments, or existing
documentation, and losing it would plausibly cause recurrence, material risk, or
substantial rediscovery. Apply this counterfactual: if the learning document
disappeared, would a future engineer reading the final implementation still be
likely to repeat the mistake or redo substantial investigation? Completion,
effort, and diff size do not establish eligibility.`;

function agent(name: string, barBody: string | null): string {
  const block =
    barBody === null
      ? 'No bar here.'
      : `<!-- durable-bar:start -->\n\n${barBody}\n\n<!-- durable-bar:end -->`;
  return `---
name: ${name}
description: Fixture agent. Use when testing RULE 22.
model: sonnet
tools:
  - Read
---

Fixture body.

${block}
`;
}

describe('RULE 22 — durable-bar drift lint', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rule22-'));
  });

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('passes when both copies match the upstream paragraph', () => {
    writeAgent(dir, COMPOUNDER, agent('knowledge-compounder', BAR));
    writeAgent(dir, SCORER, agent('staging-scorer', BAR));
    const { status, stderr } = runValidator(dir);
    expect(stderr).not.toContain('RULE 22');
    expect(status).toBe(0);
  });

  it('fails when one copy is rewrapped (not byte-identical)', () => {
    writeAgent(dir, COMPOUNDER, agent('knowledge-compounder', BAR));
    writeAgent(dir, SCORER, agent('staging-scorer', BAR.replace(/\n/g, ' ')));
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 22');
    expect(stderr).toContain('not byte-identical');
  });

  it('fails when both copies are edited the same way (upstream drift)', () => {
    const edited = BAR.replace('substantial rediscovery', 'some rediscovery');
    writeAgent(dir, COMPOUNDER, agent('knowledge-compounder', edited));
    writeAgent(dir, SCORER, agent('staging-scorer', edited));
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain("differs from CE's paragraph");
  });

  it('fails when a declared file lacks the block', () => {
    writeAgent(dir, COMPOUNDER, agent('knowledge-compounder', BAR));
    writeAgent(dir, SCORER, agent('staging-scorer', null));
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('missing durable-bar block');
  });

  it('fails when an undeclared file carries the block', () => {
    writeAgent(dir, COMPOUNDER, agent('knowledge-compounder', BAR));
    writeAgent(dir, 'demo/agents/rogue.md', agent('rogue', BAR));
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('undeclared durable-bar copy');
  });

  it('strict mode fails when a declared file is missing', () => {
    writeAgent(dir, COMPOUNDER, agent('knowledge-compounder', BAR));
    const { status, stderr } = runValidator(dir, {
      VALIDATE_SENTINEL_STRICT: '1',
    });
    expect(status).toBe(1);
    expect(stderr).toContain('declared durable-bar file is missing');
  });
});
