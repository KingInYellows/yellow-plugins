/**
 * Integration test for the W1.5b rule in scripts/validate-agent-authoring.js.
 *
 * W1.5b closes a blind spot in the W1.5 read-only rule: `memory:` auto-enables
 * Read/Write/Edit regardless of the `tools:` list, so a review/ agent that sets
 * `memory:` without a `disallowedTools` entry containing Write and Edit runs
 * write-capable against untrusted PR diffs even though `tools:` looks read-only.
 * W1.5b fails CI when that combination occurs (PR #560).
 *
 * Scope-gate detail: only the documented scope values (user|project|local)
 * activate memory + the write auto-grant. `memory: true` (and any other value)
 * is silently ignored by Claude Code, so W1.5b must NOT fire on it — otherwise
 * the author gets a misleading "auto-enables Write/Edit" error.
 *
 * Parameterized via VALIDATE_PLUGINS_DIR so it never touches the real
 * plugins/ tree.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { runValidator, writeAgent } from './helpers/validator-harness';

// A review/ agent fixture missing the memory write-deny — the regression
// W1.5b is built to catch.
const REVIEW_FM_MEMORY_NO_DENY = `---
name: w15b-fixture
description: W1.5b review fixture. Use when verifying the memory write-deny rule.
model: inherit
memory: project
tools:
  - Read
  - Grep
  - Glob
---

Body for W1.5b fixture.
`;

// Same agent, now restoring the read-only contract with the full deny set.
const REVIEW_FM_MEMORY_WITH_DENY = `---
name: w15b-fixture
description: W1.5b review fixture. Use when verifying the memory write-deny rule.
model: inherit
memory: project
tools:
  - Read
  - Grep
  - Glob
disallowedTools:
  - Write
  - Edit
  - MultiEdit
---

Body for W1.5b fixture.
`;

// Denies Write but not Edit — partial deny must still fail (Edit is
// memory-granted and write-capable).
const REVIEW_FM_MEMORY_PARTIAL_DENY = `---
name: w15b-fixture
description: W1.5b review fixture. Use when verifying the memory write-deny rule.
model: inherit
memory: project
tools:
  - Read
  - Grep
  - Glob
disallowedTools:
  - Write
---

Body for W1.5b fixture.
`;

// memory: true is an invalid scope — Claude Code ignores it, no write grant,
// so W1.5b must NOT fire (scope-gate). No disallowedTools present.
const REVIEW_FM_MEMORY_INVALID_SCOPE = `---
name: w15b-fixture
description: W1.5b review fixture. Use when verifying the memory write-deny rule.
model: inherit
memory: true
tools:
  - Read
  - Grep
  - Glob
---

Body for W1.5b fixture.
`;

// A review/ agent with NO memory: at all — W1.5b is a no-op (the W1.5
// tools-list check is the only relevant rule, and Read/Grep/Glob pass it).
const REVIEW_FM_NO_MEMORY = `---
name: w15b-fixture
description: W1.5b review fixture. Use when verifying the memory write-deny rule.
model: inherit
tools:
  - Read
  - Grep
  - Glob
---

Body for W1.5b fixture.
`;

// An allowlisted CLI-wrapper reviewer (codex-reviewer) with memory: and no
// deny — W1.5b must skip allowlisted agents (same allowlist as W1.5).
const ALLOWLISTED_FM_MEMORY_NO_DENY = `---
name: codex-reviewer
description: Codex reviewer fixture. Use when verifying the W1.5b allowlist skip.
model: inherit
memory: project
tools:
  - Read
  - Grep
  - Glob
---

Body for allowlisted fixture.
`;

let pluginsDir: string;

beforeEach(() => {
  pluginsDir = mkdtempSync(join(tmpdir(), 'validate-w15b-'));
});

afterEach(() => {
  rmSync(pluginsDir, { recursive: true, force: true });
});

describe('validate-agent-authoring W1.5b (memory: requires disallowedTools)', () => {
  it('fails when a review/ agent sets memory: project but has no disallowedTools', () => {
    writeAgent(
      pluginsDir,
      'yellow-core/agents/review/w15b-fixture.md',
      REVIEW_FM_MEMORY_NO_DENY
    );
    const result = runValidator(pluginsDir);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/W1\.5b/);
  });

  it('passes when memory: project is paired with disallowedTools [Write, Edit, MultiEdit]', () => {
    writeAgent(
      pluginsDir,
      'yellow-core/agents/review/w15b-fixture.md',
      REVIEW_FM_MEMORY_WITH_DENY
    );
    const result = runValidator(pluginsDir);
    expect(result.status).toBe(0);
  });

  it('fails on a partial deny (Write present, Edit missing)', () => {
    writeAgent(
      pluginsDir,
      'yellow-core/agents/review/w15b-fixture.md',
      REVIEW_FM_MEMORY_PARTIAL_DENY
    );
    const result = runValidator(pluginsDir);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/W1\.5b/);
    // The error names the specifically-missing tool.
    expect(result.stdout + result.stderr).toMatch(/Edit/);
  });

  it('does NOT fire on an invalid scope (memory: true) — scope-gate', () => {
    writeAgent(
      pluginsDir,
      'yellow-core/agents/review/w15b-fixture.md',
      REVIEW_FM_MEMORY_INVALID_SCOPE
    );
    const result = runValidator(pluginsDir);
    expect(result.status).toBe(0);
  });

  it('is a no-op when no memory: is set', () => {
    writeAgent(
      pluginsDir,
      'yellow-core/agents/review/w15b-fixture.md',
      REVIEW_FM_NO_MEMORY
    );
    const result = runValidator(pluginsDir);
    expect(result.status).toBe(0);
  });

  it('skips allowlisted reviewers (codex-reviewer) even with memory: and no deny', () => {
    writeAgent(
      pluginsDir,
      'yellow-codex/agents/review/codex-reviewer.md',
      ALLOWLISTED_FM_MEMORY_NO_DENY
    );
    const result = runValidator(pluginsDir);
    expect(result.status).toBe(0);
  });
});
