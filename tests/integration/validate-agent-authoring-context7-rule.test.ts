/**
 * Integration test for RULE 13 (library-context drift lint) in
 * scripts/validate-agent-authoring.js.
 *
 * RULE 13 fails CI when an agent lists a context7 tool
 * (mcp__context7__resolve-library-id / query-docs / get-library-docs) in
 * `tools:` but neither preloads the canonical fallback chain via
 * `skills: [library-context]` NOR carries the exact inline drift sentinel
 * `context7 unavailable — falling back to` (em dash U+2014) in its body.
 *
 * The canonical chain lives in
 * plugins/yellow-research/skills/library-context/SKILL.md; an agent with
 * context7 tools and no fallback is a silent drift surface. The two real
 * consumers are exempt by construction (code-researcher preloads,
 * best-practices-researcher inlines the sentinel) — these fixtures prove the
 * rule on synthetic agents so the production tree is never touched.
 *
 * The em dash in every PASS fixture is U+2014 (—); the ASCII-dash fixture
 * uses `--` on purpose to prove the rule rejects a corrupted sentinel.
 *
 * The `skills: [library-context]` preload exemption is scoped to agents
 * whose path is rooted under `yellow-research/` — cross-plugin `skills:`
 * resolution is documented as unavailable, so an agent in another plugin
 * that merely lists the preload would never receive the fallback chain at
 * runtime. The sentinel check also strips HTML comments before matching, so
 * a sentinel mentioned only inside a `<!-- ... -->` dev note cannot satisfy
 * the rule.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { runValidator, writeAgent } from './helpers/validator-harness';

// PASS fixture: context7 tool present, `skills: [library-context]` preload —
// no body sentinel needed (the skill injects the chain at spawn).
const PRELOAD_EXEMPT = `---
name: ctx7-preload-fixture
description: Preload-exempt fixture. Use when verifying RULE 13 preload exemption.
model: inherit
skills:
  - library-context
tools:
  - Read
  - mcp__context7__resolve-library-id
---

Body has no sentinel; the preloaded library-context skill supplies the chain.
`;

// PASS fixture: context7 tool present, no preload, but the exact em-dash
// sentinel is in the body (inline cross-plugin pattern).
const INLINE_SENTINEL_EXEMPT = `---
name: ctx7-inline-fixture
description: Inline-sentinel fixture. Use when verifying RULE 13 inline exemption.
model: inherit
tools:
  - Read
  - mcp__context7__query-docs
---

If context7 is missing, log \`context7 unavailable — falling back to WebSearch\`.
`;

// FAIL fixture: context7 tool present, no preload, sentinel uses ASCII \`--\`
// instead of the em dash — must be rejected so a corrupted sentinel is caught.
const ASCII_DASH_NEGATIVE = `---
name: ctx7-asciidash-fixture
description: ASCII-dash fixture. Use when verifying RULE 13 rejects a hyphen sentinel.
model: inherit
tools:
  - Read
  - mcp__context7__get-library-docs
---

If context7 is missing, log \`context7 unavailable -- falling back to WebSearch\`.
`;

// FAIL fixture: context7 tool present, no preload, no sentinel at all.
const PURE_NEGATIVE = `---
name: ctx7-bare-fixture
description: Bare fixture. Use when verifying RULE 13 fires with no exemption.
model: inherit
tools:
  - Read
  - mcp__context7__resolve-library-id
---

This agent queries context7 with no documented fallback.
`;

// PASS fixture: no context7 tool at all — RULE 13 must NOT fire (no over-reach
// onto agents that never touch context7).
const NO_CONTEXT7 = `---
name: no-ctx7-fixture
description: No-context7 fixture. Use when verifying RULE 13 ignores unrelated agents.
model: inherit
tools:
  - Read
  - WebSearch
---

This agent has no context7 tools and no sentinel; RULE 13 is irrelevant here.
`;

// FAIL fixture: context7 tool listed via the bare comma-string \`tools:\` form
// Claude Code accepts. Proves parseList normalizes the comma form to an array
// BEFORE RULE 13's exact Set match — otherwise the tool would be missed.
const COMMA_FORM_NEGATIVE = `---
name: ctx7-comma-fixture
description: Comma-form fixture. Use when verifying RULE 13 sees comma-string tools.
model: inherit
tools: Read, mcp__context7__query-docs
---

This agent declares its tools as a comma string and has no fallback.
`;

// FAIL fixture: context7 tool present, no preload, and the sentinel phrase
// appears ONLY inside an HTML comment (a dev-only annotation, not a real
// instruction in the agent's live prompt body). Proves RULE 13 strips HTML
// comments before the sentinel \`.includes()\` check.
const HTML_COMMENT_SENTINEL_NEGATIVE = `---
name: ctx7-htmlcomment-fixture
description: HTML-comment fixture. Use when verifying RULE 13 strips comments before matching the sentinel.
model: inherit
tools:
  - Read
  - mcp__context7__resolve-library-id
---

<!-- Drift sentinel note: context7 unavailable — falling back to WebSearch. -->

This agent has no real fallback instruction outside the dev comment above.
`;

const AGENT_PATH = 'demo/agents/research/agent.md';
// A path rooted under yellow-research/ — the plugin that owns the
// library-context skill. Used to prove the preload exemption still passes
// for agents that actually live inside the owning plugin.
const YELLOW_RESEARCH_AGENT_PATH = 'yellow-research/agents/research/agent.md';

describe('RULE 13 — library-context drift lint', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rule13-'));
  });

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // On the PASS path, status 0 IS the RULE 13 guard: any error (including a
  // RULE 13 violation) forces the validator to exit 1, and these fixtures are
  // otherwise clean, so exit 0 proves RULE 13 did not fire. The harness reports
  // empty stderr on exit 0, so a stderr assertion here would be vacuous.
  it('passes an agent inside yellow-research/ that preloads library-context (no body sentinel needed)', () => {
    writeAgent(dir, YELLOW_RESEARCH_AGENT_PATH, PRELOAD_EXEMPT);
    const { status } = runValidator(dir);
    expect(status).toBe(0);
  });

  // The preload exemption only holds for agents inside yellow-research/ (the
  // plugin that owns the library-context skill) — cross-plugin `skills:`
  // resolution is documented as unavailable, so an agent elsewhere that
  // merely lists the preload would never receive the fallback chain at
  // runtime and must be rejected here.
  it('fails a cross-plugin agent that only lists the library-context preload', () => {
    writeAgent(dir, AGENT_PATH, PRELOAD_EXEMPT);
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 13');
  });

  it('passes an agent that inlines the exact em-dash sentinel', () => {
    writeAgent(dir, AGENT_PATH, INLINE_SENTINEL_EXEMPT);
    const { status } = runValidator(dir);
    expect(status).toBe(0);
  });

  it('fails an agent whose sentinel uses ASCII -- instead of the em dash', () => {
    writeAgent(dir, AGENT_PATH, ASCII_DASH_NEGATIVE);
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 13');
    // The error names the offending file (relative() yields a path ending in
    // the fixture's agent .md regardless of the tmpdir prefix).
    expect(stderr).toContain('agent.md');
  });

  it('fails an agent with context7 tools but no preload and no sentinel', () => {
    writeAgent(dir, AGENT_PATH, PURE_NEGATIVE);
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 13');
  });

  it('does not fire on an agent with no context7 tools', () => {
    writeAgent(dir, AGENT_PATH, NO_CONTEXT7);
    const { status } = runValidator(dir);
    expect(status).toBe(0);
  });

  it('fails an agent that lists a context7 tool via the comma-string form', () => {
    writeAgent(dir, AGENT_PATH, COMMA_FORM_NEGATIVE);
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 13');
  });

  it('fails an agent whose sentinel only appears inside an HTML comment', () => {
    writeAgent(dir, AGENT_PATH, HTML_COMMENT_SENTINEL_NEGATIVE);
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 13');
  });
});
