/**
 * Integration test for RULE 20 — the `user-invokable` (k) frontmatter key is
 * not a Claude Code key. The CLI (verified against 2.1.259) parses only
 * `user-invocable`, so the k spelling is silently ignored: a skill declared
 * `user-invokable: false` still shows up in the `/` menu. RULE 20 is ERROR
 * tier (exit 1) so the old spelling cannot creep back through stale
 * templates; the correct key and a file with neither key both pass.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { runValidator, writeAgent } from './helpers/validator-harness';

function skill(name: string, invocationLine: string): string {
  return `---
name: ${name}
description: ${name} fixture. Use when verifying RULE 20 behaviour.
${invocationLine}---

# ${name}

## What It Does

Body content.

## When to Use

Body content.

## Usage

Body content.
`;
}

const OLD_KEY_SKILL = skill('old-key-skill', 'user-invokable: false\n');
const NEW_KEY_SKILL = skill('new-key-skill', 'user-invocable: false\n');
const NO_KEY_SKILL = skill('no-key-skill', '');

// A fenced example mentioning the old key must NOT trip the rule — only the
// parsed frontmatter mapping is inspected.
const FENCED_MENTION_SKILL = `---
name: fenced-mention-skill
description: Fenced fixture. Use when verifying RULE 20 ignores body mentions.
user-invocable: false
---

# Fenced Mention Skill

## What It Does

Documents the migration:

\`\`\`yaml
user-invokable: false
\`\`\`

## When to Use

Body content.

## Usage

Body content.
`;

describe('validate-agent-authoring RULE 20 (user-invocable key spelling)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rule20-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('fails hard (exit 1) on the ignored user-invokable key', () => {
    writeAgent(dir, 'plug/skills/old/SKILL.md', OLD_KEY_SKILL);
    const result = runValidator(dir);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('RULE 20');
    expect(result.stdout + result.stderr).toContain('user-invocable');
  });

  it('passes with the user-invocable key', () => {
    writeAgent(dir, 'plug/skills/new/SKILL.md', NEW_KEY_SKILL);
    const result = runValidator(dir);
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).not.toContain('RULE 20');
  });

  it('passes when neither key is present', () => {
    writeAgent(dir, 'plug/skills/none/SKILL.md', NO_KEY_SKILL);
    const result = runValidator(dir);
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).not.toContain('RULE 20');
  });

  it('ignores the old key when it only appears inside a fenced body example', () => {
    writeAgent(dir, 'plug/skills/fenced/SKILL.md', FENCED_MENTION_SKILL);
    const result = runValidator(dir);
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).not.toContain('RULE 20');
  });
});
