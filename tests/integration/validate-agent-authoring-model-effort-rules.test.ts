/**
 * Integration tests for the V1–V4 model/effort lint rules in
 * `scripts/validate-agent-authoring.js`.
 *
 * V1: effort: enum (low|medium|high|xhigh|max) — hard error
 * V2: model: enum (haiku|sonnet|opus|inherit, optionally versioned) — hard error
 * V3: model: inherit on agents/scanners/ or agents/ci/ — non-blocking warning
 * V4: synthesizer/orchestrator name without effort: high — non-blocking warning
 *
 * The test parameterizes the validator via `VALIDATE_PLUGINS_DIR` and runs it
 * as a child process against fixture trees in `os.tmpdir()`. Mirrors the
 * pattern in `validate-agent-authoring-review-rule.test.ts`.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { runValidator, writeAgent } from './helpers/validator-harness';

function agentBody(opts: {
  name: string;
  model?: string;
  effort?: string;
  description?: string;
}): string {
  const lines = ['---', `name: ${opts.name}`];
  lines.push(
    `description: "${opts.description ?? 'Test fixture. Use when verifying lint rules.'}"`
  );
  if (opts.model !== undefined) lines.push(`model: ${opts.model}`);
  if (opts.effort !== undefined) lines.push(`effort: ${opts.effort}`);
  lines.push('tools:', '  - Read', '  - Grep', '  - Glob', '---', '', 'Body.');
  return lines.join('\n') + '\n';
}

describe('validate-agent-authoring V1: effort enum', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-validate-v1-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('passes a valid effort: low', () => {
    writeAgent(
      tmpRoot,
      'yellow-test/agents/workflow/clean.md',
      agentBody({ name: 'clean', model: 'sonnet', effort: 'low' })
    );
    const { status } = runValidator(tmpRoot);
    expect(status).toBe(0);
  });

  it('passes a valid effort: xhigh (canonical enum includes it)', () => {
    writeAgent(
      tmpRoot,
      'yellow-test/agents/workflow/xh.md',
      agentBody({ name: 'xh', model: 'opus', effort: 'xhigh' })
    );
    const { status } = runValidator(tmpRoot);
    expect(status).toBe(0);
  });

  it('errors on invalid effort: hight (typo)', () => {
    writeAgent(
      tmpRoot,
      'yellow-test/agents/workflow/typo.md',
      agentBody({ name: 'typo', model: 'sonnet', effort: 'hight' })
    );
    const { status, stderr } = runValidator(tmpRoot);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/invalid effort: 'hight'/);
  });

  it('errors on a non-scalar effort: [high] (array must not coerce to "high")', () => {
    // YAML parses `effort: [high]` as a list. Plain String() coercion would
    // smuggle it past the enum as "high"; the JSON form keeps V1 flagging it.
    writeAgent(
      tmpRoot,
      'yellow-test/agents/workflow/effort-array.md',
      agentBody({ name: 'effort-array', model: 'sonnet', effort: '[high]' })
    );
    const { status, stderr } = runValidator(tmpRoot);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/invalid effort: '\["high"\]'/);
  });

  it('passes when effort: is absent', () => {
    writeAgent(
      tmpRoot,
      'yellow-test/agents/workflow/nodefault.md',
      agentBody({ name: 'nodefault', model: 'sonnet' })
    );
    const { status } = runValidator(tmpRoot);
    expect(status).toBe(0);
  });
});

describe('validate-agent-authoring V2: model enum', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-validate-v2-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('passes valid bare models (haiku, sonnet, opus, inherit)', () => {
    for (const m of ['haiku', 'sonnet', 'opus', 'inherit']) {
      writeAgent(
        tmpRoot,
        `yellow-test/agents/workflow/${m}.md`,
        agentBody({ name: m, model: m })
      );
    }
    const { status } = runValidator(tmpRoot);
    expect(status).toBe(0);
  });

  it('passes a versioned model: sonnet-4-5', () => {
    writeAgent(
      tmpRoot,
      'yellow-test/agents/workflow/v.md',
      agentBody({ name: 'v', model: 'sonnet-4-5' })
    );
    const { status } = runValidator(tmpRoot);
    expect(status).toBe(0);
  });

  it('errors on model: gpt-4 (foreign provider)', () => {
    writeAgent(
      tmpRoot,
      'yellow-test/agents/workflow/foreign.md',
      agentBody({ name: 'foreign', model: 'gpt-4' })
    );
    const { status, stderr } = runValidator(tmpRoot);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/invalid model: 'gpt-4'/);
  });

  it('errors on model: sonnet-invalid (bad version suffix)', () => {
    writeAgent(
      tmpRoot,
      'yellow-test/agents/workflow/bad.md',
      agentBody({ name: 'bad', model: 'sonnet-invalid' })
    );
    const { status, stderr } = runValidator(tmpRoot);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/invalid model: 'sonnet-invalid'/);
  });

  it('errors on a non-scalar model: [inherit] (array must not coerce to "inherit")', () => {
    // `model: [inherit]` is a list, not a scalar. Coercing it with String()
    // would yield "inherit" and pass V2; the JSON form keeps V2 flagging it.
    writeAgent(
      tmpRoot,
      'yellow-test/agents/workflow/model-array.md',
      agentBody({ name: 'model-array', model: '[inherit]' })
    );
    const { status, stderr } = runValidator(tmpRoot);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/invalid model: '\["inherit"\]'/);
  });

  it('passes when model: is absent', () => {
    writeAgent(
      tmpRoot,
      'yellow-test/agents/workflow/nomodel.md',
      agentBody({ name: 'nomodel' })
    );
    const { status } = runValidator(tmpRoot);
    expect(status).toBe(0);
  });
});

describe('validate-agent-authoring V3: scanner/CI inheritance advisory', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-validate-v3-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('warns on a scanner with model: inherit (status 0, advisory in stdout)', () => {
    writeAgent(
      tmpRoot,
      'yellow-test/agents/scanners/test-scanner.md',
      agentBody({ name: 'test-scanner', model: 'inherit' })
    );
    const { status, stdout } = runValidator(tmpRoot);
    expect(status).toBe(0);
    expect(stdout).toMatch(/\[V3 advisory\]/);
    expect(stdout).toMatch(/test-scanner\.md/);
  });

  it('does NOT warn on a scanner with explicit model: sonnet', () => {
    writeAgent(
      tmpRoot,
      'yellow-test/agents/scanners/explicit-scanner.md',
      agentBody({ name: 'explicit-scanner', model: 'sonnet' })
    );
    const { status, stdout } = runValidator(tmpRoot);
    expect(status).toBe(0);
    expect(stdout).not.toMatch(/V3 advisory/);
  });

  it('warns on agents/ci/ with model: inherit', () => {
    writeAgent(
      tmpRoot,
      'yellow-test/agents/ci/some-ci-agent.md',
      agentBody({ name: 'some-ci-agent', model: 'inherit' })
    );
    const { status, stdout } = runValidator(tmpRoot);
    expect(status).toBe(0);
    expect(stdout).toMatch(/\[V3 advisory\]/);
  });

  it('does NOT warn on agents/workflow/ with model: inherit (V3 is scoped)', () => {
    writeAgent(
      tmpRoot,
      'yellow-test/agents/workflow/wf.md',
      agentBody({ name: 'wf', model: 'inherit' })
    );
    const { status, stdout } = runValidator(tmpRoot);
    expect(status).toBe(0);
    expect(stdout).not.toMatch(/V3 advisory/);
  });

  it('honors MODEL_RULE_ALLOWLIST for failure-analyst.md', () => {
    writeAgent(
      tmpRoot,
      'yellow-ci/agents/ci/failure-analyst.md',
      agentBody({ name: 'failure-analyst', model: 'inherit' })
    );
    const { status, stdout } = runValidator(tmpRoot);
    expect(status).toBe(0);
    expect(stdout).not.toMatch(/V3 advisory/);
  });

  it('honors MODEL_RULE_ALLOWLIST for workflow-optimizer.md', () => {
    writeAgent(
      tmpRoot,
      'yellow-ci/agents/ci/workflow-optimizer.md',
      agentBody({ name: 'workflow-optimizer', model: 'inherit' })
    );
    const { status, stdout } = runValidator(tmpRoot);
    expect(status).toBe(0);
    expect(stdout).not.toMatch(/V3 advisory/);
  });
});

describe('validate-agent-authoring V4: synthesizer effort:high advisory', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-validate-v4-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('warns on a name matching synthesizer pattern without effort: high', () => {
    writeAgent(
      tmpRoot,
      'yellow-test/agents/workflow/test-synthesizer.md',
      agentBody({ name: 'test-synthesizer', model: 'sonnet' })
    );
    const { status, stdout } = runValidator(tmpRoot);
    expect(status).toBe(0);
    expect(stdout).toMatch(/\[V4 advisory\]/);
    expect(stdout).toMatch(/test-synthesizer\.md/);
  });

  it('does NOT warn when effort: high is set', () => {
    writeAgent(
      tmpRoot,
      'yellow-test/agents/workflow/synthesizer-effort.md',
      agentBody({ name: 'test-synthesizer', model: 'sonnet', effort: 'high' })
    );
    const { status, stdout } = runValidator(tmpRoot);
    expect(status).toBe(0);
    expect(stdout).not.toMatch(/V4 advisory/);
  });

  it('does NOT warn when effort: max is set', () => {
    writeAgent(
      tmpRoot,
      'yellow-test/agents/workflow/synthesizer-max.md',
      agentBody({ name: 'test-orchestrator', model: 'sonnet', effort: 'max' })
    );
    const { status, stdout } = runValidator(tmpRoot);
    expect(status).toBe(0);
    expect(stdout).not.toMatch(/V4 advisory/);
  });

  it('does NOT warn when effort: xhigh is set', () => {
    writeAgent(
      tmpRoot,
      'yellow-test/agents/workflow/synthesizer-xhigh.md',
      agentBody({ name: 'test-conductor', model: 'sonnet', effort: 'xhigh' })
    );
    const { status, stdout } = runValidator(tmpRoot);
    expect(status).toBe(0);
    expect(stdout).not.toMatch(/V4 advisory/);
  });

  it('does NOT warn on a non-synthesizer name even if its description mentions synthesize', () => {
    writeAgent(
      tmpRoot,
      'yellow-test/agents/research/plain-researcher.md',
      agentBody({
        name: 'plain-researcher',
        model: 'sonnet',
        description: 'A researcher that may synthesize info from sources.',
      })
    );
    const { status, stdout } = runValidator(tmpRoot);
    expect(status).toBe(0);
    expect(stdout).not.toMatch(/V4 advisory/);
  });

  it('honors MODEL_RULE_ALLOWLIST for devin-orchestrator.md', () => {
    writeAgent(
      tmpRoot,
      'yellow-devin/agents/workflow/devin-orchestrator.md',
      agentBody({ name: 'devin-orchestrator', model: 'inherit' })
    );
    const { status, stdout } = runValidator(tmpRoot);
    expect(status).toBe(0);
    expect(stdout).not.toMatch(/V4 advisory/);
  });

  it('honors MODEL_RULE_ALLOWLIST for knowledge-compounder.md', () => {
    writeAgent(
      tmpRoot,
      'yellow-core/agents/workflow/knowledge-compounder.md',
      agentBody({ name: 'knowledge-compounder', model: 'sonnet' })
    );
    const { status, stdout } = runValidator(tmpRoot);
    expect(status).toBe(0);
    expect(stdout).not.toMatch(/V4 advisory/);
  });

  it('does NOT fire spuriously when V1 already errors on a typo effort', () => {
    // Synthesizer name + invalid effort: V1 must error, V4 must NOT also
    // fire (the author should see one clear message about the typo, not a
    // second confusing advisory about effort: high).
    writeAgent(
      tmpRoot,
      'yellow-test/agents/workflow/synthesizer-typo.md',
      agentBody({
        name: 'test-aggregator',
        model: 'sonnet',
        effort: 'hight',
      })
    );
    const { status, stderr, stdout } = runValidator(tmpRoot);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/invalid effort: 'hight'/);
    expect(stdout).not.toMatch(/V4 advisory/);
  });
});

describe('validate-agent-authoring exit-code semantics: errors vs warnings', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-validate-exit-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('exits nonzero when V1 error AND V3 warning both fire (errors win)', () => {
    // V1 error: invalid effort
    writeAgent(
      tmpRoot,
      'yellow-test/agents/scanners/error-and-warn.md',
      agentBody({ name: 'error-and-warn', model: 'inherit', effort: 'hight' })
    );
    const { status, stderr, stdout } = runValidator(tmpRoot);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/invalid effort: 'hight'/);
    expect(stdout).toMatch(/\[V3 advisory\]/);
  });

  it('exits 0 when only warnings fire (no errors)', () => {
    writeAgent(
      tmpRoot,
      'yellow-test/agents/scanners/warn-only.md',
      agentBody({ name: 'warn-only', model: 'inherit' })
    );
    const { status, stdout } = runValidator(tmpRoot);
    expect(status).toBe(0);
    expect(stdout).toMatch(/\[V3 advisory\]/);
  });
});
