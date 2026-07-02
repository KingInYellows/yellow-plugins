/**
 * Integration test for RULE 15 (a–d) — the SKILL.md authoring lint in
 * scripts/validate-agent-authoring.js.
 *
 * All four sub-rules are WARNING-tier: they document repo conventions that
 * predate the lint, and several shipped skills fail them today, so a hard
 * error would block unrelated PRs on pre-existing debt. Every trigger case
 * therefore asserts BOTH that the warning appears on stdout AND that the
 * exit status stays 0 — the "warnings do not affect exit code" contract is
 * itself part of the rule.
 *
 *   15a: SKILL.md over 500 lines (official Anthropic skill guidance).
 *   15b: missing one of ## What It Does / ## When to Use / ## Usage.
 *   15c: `description:` absent or lacking a "Use when" trigger clause.
 *   15d: folded/literal block-scalar `description: >` or `|` (Claude Code
 *        silently truncates multi-line descriptions).
 *
 * Only files named SKILL.md under a skills/ directory are in scope —
 * references/*.md companions are free-form and must not be linted.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { runValidator, writeAgent } from './helpers/validator-harness';

// PASS fixture: compliant on all four sub-rules — under 500 lines, all three
// standard headings, single-line description with a "Use when" clause.
const COMPLIANT_SKILL = `---
name: compliant-skill
description: Compliant fixture. Use when verifying RULE 15 stays silent on a conforming skill.
user-invokable: true
---

# Compliant Skill

## What It Does

Demonstrates a fully conforming SKILL.md.

## When to Use

In RULE 15 fixture tests only.

## Usage

Run the validator against this tree.
`;

// 15b trigger: ## Usage is missing (the other two headings are present).
const MISSING_HEADING_SKILL = `---
name: missing-heading-skill
description: Missing-heading fixture. Use when verifying RULE 15b fires.
---

# Missing Heading Skill

## What It Does

Omits the Usage heading on purpose.

## When to Use

In RULE 15b trigger tests.
`;

// 15c trigger: description present but no "Use when" clause anywhere.
const NO_TRIGGER_CLAUSE_SKILL = `---
name: no-trigger-skill
description: A skill description without any trigger clause at all.
---

# No Trigger Skill

## What It Does

Body content.

## When to Use

Body content.

## Usage

Body content.
`;

// 15c trigger (missing-description variant): no description key at all.
const NO_DESCRIPTION_SKILL = `---
name: no-description-skill
---

# No Description Skill

## What It Does

Body content.

## When to Use

Body content.

## Usage

Body content.
`;

// 15d trigger: folded block-scalar description. The folded text CONTAINS
// "Use when", which proves 15d fires independently of 15c (YAML folds the
// block into a normal string before the 15c check sees it).
const FOLDED_DESCRIPTION_SKILL = `---
name: folded-description-skill
description: >
  Folded fixture. Use when verifying RULE 15d catches block scalars.
---

# Folded Description Skill

## What It Does

Body content.

## When to Use

Body content.

## Usage

Body content.
`;

// 15d trigger (literal block scalar): `description: |` — pins the char
// class so a regression narrowing `[>|]` to `[>]` fails this test.
const LITERAL_DESCRIPTION_SKILL = FOLDED_DESCRIPTION_SKILL.replace(
  'description: >',
  'description: |'
);

// 15d trigger (multi-line quoted string): YAML folds this into one string
// containing "Use when", so 15c stays silent — only the raw-continuation
// check can catch it. This is the exact truncation shape the repo has been
// bitten by (see the solutions doc cited by the rule).
const QUOTED_MULTILINE_DESCRIPTION_SKILL = `---
name: quoted-multiline-skill
description: 'Quoted fixture spanning lines.
  Use when verifying RULE 15d catches quoted multi-line descriptions.'
---

# Quoted Multiline Skill

## What It Does

Body content.

## When to Use

Body content.

## Usage

Body content.
`;

// 15a trigger: compliant frontmatter/headings, then filler pushing the file
// past the 500-line ceiling.
const OVERSIZED_SKILL =
  COMPLIANT_SKILL + Array.from({ length: 510 }, (_, i) => `Filler ${i}.`).join('\n') + '\n';

// Out-of-scope fixture: a references/ companion that violates everything
// (no frontmatter, no headings, >500 lines). RULE 15 must not touch it.
const OVERSIZED_REFERENCE =
  Array.from({ length: 520 }, (_, i) => `Reference filler ${i}.`).join('\n') + '\n';

const SKILL_PATH = 'demo/skills/fixture-skill/SKILL.md';

// Boundary fixtures: pad the compliant skill to an exact total line count
// (LF-terminated, so logical lines == wc -l) to pin the `>` comparison at
// the 500-line ceiling — a `>=` regression fails the 500-line case.
function skillWithExactLines(total: number): string {
  const baseLines = COMPLIANT_SKILL.split('\n').length - 1;
  return (
    COMPLIANT_SKILL +
    Array.from({ length: total - baseLines }, (_, i) => `Pad ${i}.`).join('\n') +
    '\n'
  );
}

describe('RULE 15 — SKILL.md authoring lint (warning-tier)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rule15-'));
  });

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stays silent on a fully compliant SKILL.md', () => {
    writeAgent(dir, SKILL_PATH, COMPLIANT_SKILL);
    const { status, stdout } = runValidator(dir);
    expect(status).toBe(0);
    expect(stdout).not.toContain('RULE 15');
  });

  it('warns (15a) on a SKILL.md over 500 lines without failing the run', () => {
    writeAgent(dir, SKILL_PATH, OVERSIZED_SKILL);
    const { status, stdout } = runValidator(dir);
    expect(status).toBe(0);
    expect(stdout).toContain('RULE 15a');
    expect(stdout).toContain('SKILL.md');
  });

  it('warns (15b) when a standard heading is missing, naming the heading', () => {
    writeAgent(dir, SKILL_PATH, MISSING_HEADING_SKILL);
    const { status, stdout } = runValidator(dir);
    expect(status).toBe(0);
    expect(stdout).toContain('RULE 15b');
    expect(stdout).toContain('## Usage');
    // The two present headings must not be reported missing.
    expect(stdout).not.toContain('## What It Does,');
  });

  it('warns (15c) when the description lacks a "Use when" clause', () => {
    writeAgent(dir, SKILL_PATH, NO_TRIGGER_CLAUSE_SKILL);
    const { status, stdout } = runValidator(dir);
    expect(status).toBe(0);
    expect(stdout).toContain('RULE 15c');
  });

  it('warns (15c) when the description is missing entirely', () => {
    writeAgent(dir, SKILL_PATH, NO_DESCRIPTION_SKILL);
    const { status, stdout } = runValidator(dir);
    expect(status).toBe(0);
    expect(stdout).toContain('RULE 15c');
    expect(stdout).toContain('missing');
  });

  it('warns (15d) on a folded block-scalar description even when it contains "Use when"', () => {
    writeAgent(dir, SKILL_PATH, FOLDED_DESCRIPTION_SKILL);
    const { status, stdout } = runValidator(dir);
    expect(status).toBe(0);
    expect(stdout).toContain('RULE 15d');
    // Proves 15d and 15c are independent: the folded text has a trigger
    // clause, so only the block-scalar rule may fire.
    expect(stdout).not.toContain('RULE 15c');
  });

  it('stays silent at exactly 500 lines and warns at 501 (15a boundary)', () => {
    writeAgent(dir, SKILL_PATH, skillWithExactLines(500));
    const atCeiling = runValidator(dir);
    expect(atCeiling.status).toBe(0);
    expect(atCeiling.stdout).not.toContain('RULE 15a');

    writeAgent(dir, SKILL_PATH, skillWithExactLines(501));
    const overCeiling = runValidator(dir);
    expect(overCeiling.status).toBe(0);
    expect(overCeiling.stdout).toContain('RULE 15a');
  });

  it('warns (15d) on a literal block-scalar description (|)', () => {
    writeAgent(dir, SKILL_PATH, LITERAL_DESCRIPTION_SKILL);
    const { status, stdout } = runValidator(dir);
    expect(status).toBe(0);
    expect(stdout).toContain('RULE 15d');
  });

  it('warns (15d) on a multi-line QUOTED description that 15c cannot catch', () => {
    writeAgent(dir, SKILL_PATH, QUOTED_MULTILINE_DESCRIPTION_SKILL);
    const { status, stdout } = runValidator(dir);
    expect(status).toBe(0);
    expect(stdout).toContain('RULE 15d');
    // The folded value contains "Use when", so 15c must stay silent —
    // proving the raw-continuation check is what catches this shape.
    expect(stdout).not.toContain('RULE 15c');
  });

  it('ignores non-SKILL.md files under skills/ (references companions)', () => {
    writeAgent(dir, SKILL_PATH, COMPLIANT_SKILL);
    writeAgent(
      dir,
      'demo/skills/fixture-skill/references/huge.md',
      OVERSIZED_REFERENCE
    );
    const { status, stdout } = runValidator(dir);
    expect(status).toBe(0);
    expect(stdout).not.toContain('RULE 15');
  });
});
