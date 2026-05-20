/**
 * Integration test for RULE 14 (staging-promoter/-reviewer frontmatter
 * disallowedTools: [AskUserQuestion]) and RULE 14b (staging-promoter body
 * Session-Notes write gate + Never-modify invariant naming all three
 * protected memory sections) in scripts/validate-agent-authoring.js.
 *
 * Both rules are the load-bearing CI enforcement for D8 + D9-L1 in the
 * background-compounding pipeline (PRs #540-544). Without these rules,
 * a future edit could silently break the drain pipeline:
 *   - RULE 14: removing disallowedTools allows AskUserQuestion calls,
 *     blocking the non-interactive drain indefinitely.
 *   - RULE 14b: removing the Never-modify invariant allows the promoter
 *     to write to CORE_RULES, USER_PREFERENCES, or KNOWN_PROJECTS — the
 *     three sections that MUST remain human-managed.
 *
 * The test parameterizes the validator via VALIDATE_PLUGINS_DIR so it
 * never touches the real plugins/ tree.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { runValidator, writeAgent } from './helpers/validator-harness';

// Frontmatter helpers — minimal fixtures that pass all OTHER validator
// rules so we isolate RULE 14 / 14b behavior.

const PROMOTER_FM_OK = `---
name: staging-promoter
description: Promoter test fixture. Use when verifying RULE 14/14b.
model: inherit
tools:
  - Read
  - Write
  - Edit
disallowedTools:
  - AskUserQuestion
---
`;

const PROMOTER_FM_MISSING_DENY = `---
name: staging-promoter
description: Promoter test fixture. Use when verifying RULE 14/14b.
model: inherit
tools:
  - Read
  - Write
  - Edit
---
`;

const REVIEWER_FM_OK = `---
name: staging-reviewer
description: Reviewer test fixture. Use when verifying RULE 14 staging-reviewer extension.
model: inherit
tools:
  - Task
  - Read
disallowedTools:
  - AskUserQuestion
---

Body for reviewer fixture.
`;

const REVIEWER_FM_MISSING_DENY = `---
name: staging-reviewer
description: Reviewer test fixture. Use when verifying RULE 14 staging-reviewer extension.
model: inherit
tools:
  - Task
  - Read
---

Body for reviewer fixture.
`;

// Body that satisfies RULE 14b: documents Session Notes gate AND has a
// paragraph naming all three sections in a "Never modify|write|touch"
// context.
const PROMOTER_BODY_OK = `
## Session Notes write gate

Promoter writes ONLY to MEMORY.md's \`## Session Notes\` section.

## Never modify these sections

Never touch \`## CORE_RULES\`, \`## USER_PREFERENCES\`, or
\`## KNOWN_PROJECTS\`. These are human-managed.
`;

// Body that mentions Session Notes but lacks the Never-modify invariant
// — the typical drift after a refactor that removes the security rules.
const PROMOTER_BODY_MISSING_INVARIANT = `
## Session Notes write gate

Promoter writes ONLY to MEMORY.md's \`## Session Notes\` section.

Other sections exist (CORE_RULES, USER_PREFERENCES, KNOWN_PROJECTS) but
this body does not explicitly forbid touching them.
`;

// Decoy body: has a "Never modify" sentence AND mentions all three
// sections, but they are in different paragraphs — the global-boolean
// check would pass this, but the paragraph-co-location check rejects it.
const PROMOTER_BODY_DECOY = `
## Session Notes

Promoter writes to MEMORY.md's Session Notes section.

Never modify staging entries after dispatch.

A separate paragraph discussing CORE_RULES.

Another paragraph about USER_PREFERENCES and KNOWN_PROJECTS in a totally
non-protective context.
`;

let pluginsDir: string;

beforeEach(() => {
  pluginsDir = mkdtempSync(join(tmpdir(), 'validate-rule14-'));
});

afterEach(() => {
  rmSync(pluginsDir, { recursive: true, force: true });
});

describe('validate-agent-authoring RULE 14 (disallowedTools frontmatter)', () => {
  it('passes when staging-promoter has disallowedTools: [AskUserQuestion]', () => {
    writeAgent(
      pluginsDir,
      'yellow-core/agents/workflow/staging-promoter.md',
      PROMOTER_FM_OK + PROMOTER_BODY_OK
    );
    const result = runValidator(pluginsDir);
    expect(result.status).toBe(0);
  });

  it('fails when staging-promoter frontmatter is missing disallowedTools', () => {
    writeAgent(
      pluginsDir,
      'yellow-core/agents/workflow/staging-promoter.md',
      PROMOTER_FM_MISSING_DENY + PROMOTER_BODY_OK
    );
    const result = runValidator(pluginsDir);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/RULE 14/);
  });

  it('passes when staging-promoter.md is absent (graceful skip)', () => {
    // RULE 14 is conditional — if the agent file does not exist yet,
    // the rule is a no-op (handles pre-merge stack state).
    const result = runValidator(pluginsDir);
    expect(result.status).toBe(0);
  });

  it('passes when staging-reviewer has disallowedTools: [AskUserQuestion]', () => {
    writeAgent(
      pluginsDir,
      'yellow-core/agents/workflow/staging-reviewer.md',
      REVIEWER_FM_OK
    );
    const result = runValidator(pluginsDir);
    expect(result.status).toBe(0);
  });

  it('fails when staging-reviewer frontmatter is missing disallowedTools', () => {
    writeAgent(
      pluginsDir,
      'yellow-core/agents/workflow/staging-reviewer.md',
      REVIEWER_FM_MISSING_DENY
    );
    const result = runValidator(pluginsDir);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/RULE 14/);
  });
});

describe('validate-agent-authoring RULE 14b (Session Notes write gate)', () => {
  it('passes when promoter body has the Session-Notes gate AND a Never-modify paragraph with all three sections', () => {
    writeAgent(
      pluginsDir,
      'yellow-core/agents/workflow/staging-promoter.md',
      PROMOTER_FM_OK + PROMOTER_BODY_OK
    );
    const result = runValidator(pluginsDir);
    expect(result.status).toBe(0);
  });

  it('fails when promoter body mentions Session Notes but lacks the Never-modify invariant', () => {
    writeAgent(
      pluginsDir,
      'yellow-core/agents/workflow/staging-promoter.md',
      PROMOTER_FM_OK + PROMOTER_BODY_MISSING_INVARIANT
    );
    const result = runValidator(pluginsDir);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/RULE 14b/);
  });

  it('fails on the decoy: "Never modify" elsewhere, sections in unrelated paragraphs', () => {
    // This is the false-negative that the paragraph-co-location check
    // is meant to catch — the previous global-boolean check passed
    // this even though no actual protective statement existed.
    writeAgent(
      pluginsDir,
      'yellow-core/agents/workflow/staging-promoter.md',
      PROMOTER_FM_OK + PROMOTER_BODY_DECOY
    );
    const result = runValidator(pluginsDir);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/RULE 14b/);
  });
});
