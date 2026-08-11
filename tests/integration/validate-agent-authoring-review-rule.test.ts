/**
 * Integration test for the W1.5 read-only-reviewer rule in
 * `scripts/validate-agent-authoring.js`.
 *
 * Verifies that:
 *   1. A synthetic violator (a `agents/review/<file>.md` listing `Bash` in
 *      its `tools:` block, at a path NOT in REVIEW_AGENT_ALLOWLIST) is
 *      detected and the validator exits with a non-zero code.
 *   2. A file at the allowlisted path
 *      (`yellow-codex/agents/review/codex-reviewer.md`) with the same
 *      violation passes — the documented exception is honored.
 *   3. A clean review agent (`tools: [Read, Grep, Glob]`) passes.
 *
 * The test parameterizes the validator via `VALIDATE_PLUGINS_DIR` so it
 * never touches the real `plugins/` tree. Each case writes a small fixture
 * to a temp directory under `os.tmpdir()` and runs the validator as a child
 * process.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { runValidator, writeAgent } from './helpers/validator-harness';

const REVIEW_AGENT_BASH_VIOLATOR = `---
name: synth-violator
description: "Test fixture. Use when verifying W1.5 rule fires."
model: inherit
tools:
  - Read
  - Grep
  - Glob
  - Bash
---

Body for synth-violator. The 'tools:' list above includes Bash, which is
forbidden for review/ agents that are not on the allowlist.
`;

const REVIEW_AGENT_CLEAN = `---
name: clean-reviewer
description: "Test fixture. Use when verifying clean review agents pass W1.5."
model: inherit
tools:
  - Read
  - Grep
  - Glob
---

Clean reviewer body.
`;

describe('validate-agent-authoring W1.5 read-only reviewer rule', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-validate-w15-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('flags a non-allowlisted review agent that lists Bash in tools', () => {
    writeAgent(
      tmpRoot,
      'yellow-test/agents/review/synth-violator.md',
      REVIEW_AGENT_BASH_VIOLATOR
    );

    const { status, stderr } = runValidator(tmpRoot);

    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/synth-violator\.md/);
    expect(stderr).toMatch(/review\/ agent must not include Bash/);
    expect(stderr).toMatch(/W1\.5 rule/);
  });

  it('honors REVIEW_AGENT_ALLOWLIST for codex-reviewer.md (documented exception)', () => {
    writeAgent(
      tmpRoot,
      'yellow-codex/agents/review/codex-reviewer.md',
      REVIEW_AGENT_BASH_VIOLATOR.replace(
        'synth-violator',
        'codex-reviewer'
      )
    );

    const { status, stderr } = runValidator(tmpRoot);

    expect(status).toBe(0);
    expect(stderr).not.toMatch(/codex-reviewer\.md.*review\/ agent/);
  });

  it('honors REVIEW_AGENT_ALLOWLIST for claude-reviewer.md when tools: match its granted set (Write only)', () => {
    writeAgent(
      tmpRoot,
      'yellow-council/agents/review/claude-reviewer.md',
      REVIEW_AGENT_CLEAN.replace('clean-reviewer', 'claude-reviewer').replace(
        '  - Glob',
        '  - Glob\n  - Write'
      )
    );

    const { status, stderr } = runValidator(tmpRoot);

    expect(status).toBe(0);
    expect(stderr).not.toMatch(/claude-reviewer\.md.*review\/ agent/);
  });

  it('still flags claude-reviewer.md gaining Bash — a per-file allowlist entry does not cover tools outside its granted set', () => {
    // claude-reviewer's REVIEW_AGENT_ALLOWLIST entry grants Write only (it
    // has no CLI to invoke, unlike codex/gemini/opencode-reviewer). Bare
    // set-membership on the old REVIEW_AGENT_ALLOWLIST (a Set of paths) would
    // have let ANY denied tool ride the exception; the fix keys the
    // exception to a per-file allowed-tool set, so Bash — outside that
    // set — must still trip W1.5.
    writeAgent(
      tmpRoot,
      'yellow-council/agents/review/claude-reviewer.md',
      REVIEW_AGENT_BASH_VIOLATOR.replace(
        'synth-violator',
        'claude-reviewer'
      ).replace('  - Bash', '  - Write\n  - Bash')
    );

    const { status, stderr } = runValidator(tmpRoot);

    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/claude-reviewer\.md/);
    expect(stderr).toMatch(/review\/ agent must not include Bash/);
  });

  it('passes a clean review agent with [Read, Grep, Glob] only', () => {
    writeAgent(
      tmpRoot,
      'yellow-test/agents/review/clean-reviewer.md',
      REVIEW_AGENT_CLEAN
    );

    const { status, stderr } = runValidator(tmpRoot);

    expect(status).toBe(0);
    expect(stderr).not.toMatch(/clean-reviewer\.md.*review\/ agent/);
  });

  it('flags Write and Edit (not just Bash) in review agent tools', () => {
    const writeViolator = REVIEW_AGENT_BASH_VIOLATOR
      .replace('synth-violator', 'write-violator')
      .replace('  - Bash', '  - Write\n  - Edit');
    writeAgent(
      tmpRoot,
      'yellow-test/agents/review/write-violator.md',
      writeViolator
    );

    const { status, stderr } = runValidator(tmpRoot);

    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/write-violator\.md/);
    expect(stderr).toMatch(/Write, Edit/);
  });

  it('flags MultiEdit in review agent tools (W1.5 deny-set includes MultiEdit)', () => {
    // MultiEdit is a batch file-write tool; listing it in a review agent's
    // tools: is the fail-open path W1.5 now closes alongside Write/Edit.
    const multiEditViolator = REVIEW_AGENT_BASH_VIOLATOR.replace(
      'synth-violator',
      'multiedit-violator'
    ).replace('  - Bash', '  - MultiEdit');
    writeAgent(
      tmpRoot,
      'yellow-test/agents/review/multiedit-violator.md',
      multiEditViolator
    );

    const { status, stderr } = runValidator(tmpRoot);

    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/multiedit-violator\.md/);
    expect(stderr).toMatch(/MultiEdit/);
  });

  it('does NOT flag non-review agents (e.g., agents/workflow/)', () => {
    // pr-comment-resolver legitimately needs Bash and Edit; it lives under
    // agents/workflow/ not agents/review/ and Rule X does not apply.
    writeAgent(
      tmpRoot,
      'yellow-test/agents/workflow/some-worker.md',
      REVIEW_AGENT_BASH_VIOLATOR.replace('synth-violator', 'some-worker')
    );

    const { status, stderr } = runValidator(tmpRoot);

    expect(status).toBe(0);
    expect(stderr).not.toMatch(/some-worker\.md.*review\/ agent/);
  });
});
