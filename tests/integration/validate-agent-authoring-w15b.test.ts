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

// memory: as a non-scalar (flow list) — Claude Code ignores a non-scalar scope
// value, so memory is NOT active, no Read/Write/Edit auto-grant, and W1.5b must
// NOT fire (no disallowedTools present). Guards the parseScalar non-scalar
// rejection: an array scope must coerce to a non-VALID_MEMORY_SCOPE value, not
// to "project".
const REVIEW_FM_MEMORY_ARRAY_SCOPE = `---
name: w15b-fixture
description: W1.5b review fixture. Use when verifying a non-scalar memory scope.
model: inherit
memory: [project]
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

// memory: with a trailing inline YAML comment. The pre-yaml regex parser
// returned "project # scoped" (not a valid scope), silently disabling W1.5b —
// the fail-open bypass. Claude Code (real YAML) strips the comment → "project"
// → memory IS active → the deny is required. MUST FAIL.
const REVIEW_FM_MEMORY_INLINE_COMMENT = `---
name: w15b-fixture
description: W1.5b review fixture. Use when verifying inline-comment handling.
model: inherit
memory: project # scoped to project memory
tools:
  - Read
  - Grep
  - Glob
---

Body for W1.5b fixture.
`;

// Comma-string disallowedTools — a list form Claude Code accepts. The deny set
// is complete, so this MUST PASS (the pre-yaml parser returned [] for this
// form and wrongly failed it).
const REVIEW_FM_MEMORY_COMMA_DENY = `---
name: w15b-fixture
description: W1.5b review fixture. Use when verifying comma-string disallowedTools.
model: inherit
memory: project
tools:
  - Read
  - Grep
  - Glob
disallowedTools: Write, Edit, MultiEdit
---

Body for W1.5b fixture.
`;

// Flow-list disallowedTools with a complete deny set. MUST PASS.
const REVIEW_FM_MEMORY_FLOW_DENY = `---
name: w15b-fixture
description: W1.5b review fixture. Use when verifying flow-list disallowedTools.
model: inherit
memory: project
tools:
  - Read
  - Grep
  - Glob
disallowedTools: [Write, Edit, MultiEdit]
---

Body for W1.5b fixture.
`;

// Denies Write and Edit but NOT MultiEdit — must fail now that W1.5b requires
// the full [Write, Edit, MultiEdit] deny set. MUST FAIL, naming MultiEdit.
const REVIEW_FM_MEMORY_MISSING_MULTIEDIT = `---
name: w15b-fixture
description: W1.5b review fixture. Use when verifying the MultiEdit requirement.
model: inherit
memory: project
tools:
  - Read
  - Grep
  - Glob
disallowedTools:
  - Write
  - Edit
---

Body for W1.5b fixture.
`;

// Quoted scalar memory value + flow deny — quotes must resolve to the scope
// "project" and the deny is complete. MUST PASS.
const REVIEW_FM_MEMORY_QUOTED = `---
name: w15b-fixture
description: W1.5b review fixture. Use when verifying quoted memory scope.
model: inherit
memory: "project"
tools:
  - Read
  - Grep
  - Glob
disallowedTools: [Write, Edit, MultiEdit]
---

Body for W1.5b fixture.
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

  it('does NOT fire on a non-scalar scope (memory: [project]) — array not coerced to a valid scope', () => {
    // A list memory value is ignored by Claude Code (no write auto-grant), so
    // the read-only contract is intact and W1.5b must stay silent. Guards
    // against String() coercing [project] → "project" and falsely activating
    // the gate (which would demand a disallowedTools entry that isn't needed).
    writeAgent(
      pluginsDir,
      'yellow-core/agents/review/w15b-fixture.md',
      REVIEW_FM_MEMORY_ARRAY_SCOPE
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

  it('fires on memory: project with a trailing inline comment (no deny) — the bypass fix', () => {
    writeAgent(
      pluginsDir,
      'yellow-core/agents/review/w15b-fixture.md',
      REVIEW_FM_MEMORY_INLINE_COMMENT
    );
    const result = runValidator(pluginsDir);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/W1\.5b/);
  });

  it('passes a complete comma-string deny (disallowedTools: Write, Edit, MultiEdit)', () => {
    writeAgent(
      pluginsDir,
      'yellow-core/agents/review/w15b-fixture.md',
      REVIEW_FM_MEMORY_COMMA_DENY
    );
    const result = runValidator(pluginsDir);
    expect(result.status).toBe(0);
  });

  it('passes a complete flow-list deny (disallowedTools: [Write, Edit, MultiEdit])', () => {
    writeAgent(
      pluginsDir,
      'yellow-core/agents/review/w15b-fixture.md',
      REVIEW_FM_MEMORY_FLOW_DENY
    );
    const result = runValidator(pluginsDir);
    expect(result.status).toBe(0);
  });

  it('fails a partial deny missing MultiEdit (Write + Edit present)', () => {
    writeAgent(
      pluginsDir,
      'yellow-core/agents/review/w15b-fixture.md',
      REVIEW_FM_MEMORY_MISSING_MULTIEDIT
    );
    const result = runValidator(pluginsDir);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/W1\.5b/);
    // The error names the specifically-missing tool.
    expect(result.stdout + result.stderr).toMatch(/MultiEdit/);
  });

  it('passes a quoted memory scope ("project") with a complete deny', () => {
    writeAgent(
      pluginsDir,
      'yellow-core/agents/review/w15b-fixture.md',
      REVIEW_FM_MEMORY_QUOTED
    );
    const result = runValidator(pluginsDir);
    expect(result.status).toBe(0);
  });
});

// Malformed frontmatter must fail LOUD, not silently disable the security
// gates (which all depend on the YAML parse succeeding).
const MALFORMED_YAML_FM = `---
name: malformed-fixture
description: "Malformed YAML fixture. Use when verifying the parse-error gate."
model: inherit
tools: [Read, Grep
---

Body for malformed fixture.
`;

describe('validate-agent-authoring malformed YAML frontmatter', () => {
  let pluginsDir2: string;

  beforeEach(() => {
    pluginsDir2 = mkdtempSync(join(tmpdir(), 'validate-malformed-'));
  });

  afterEach(() => {
    rmSync(pluginsDir2, { recursive: true, force: true });
  });

  it('errors with a clear message instead of silently passing', () => {
    writeAgent(
      pluginsDir2,
      'yellow-core/agents/workflow/malformed-fixture.md',
      MALFORMED_YAML_FM
    );
    const result = runValidator(pluginsDir2);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/malformed YAML/i);
  });
});
