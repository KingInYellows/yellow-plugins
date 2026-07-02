/**
 * Integration test for RULE 16 — the ruvector memory-protocol drift lint
 * in scripts/validate-agent-authoring.js.
 *
 * The protocol constants (recall top_k=5 / score<0.5 / top-3 / 800-char
 * truncation / dedup top_k=1 score>0.82) live in four skill files across
 * three plugins (canonical: yellow-ruvector/skills/memory-query; replicas
 * in yellow-core). RULE 16 enforces:
 *   (1) every declared file that exists carries the sentinel line
 *       byte-identically (exact substring — a one-parameter desync fails);
 *   (2) no undeclared plugins/ markdown file carries the sentinel prefix
 *       (containment: an undeclared copy would drift invisibly);
 *   (3) declared files absent from the tree are skipped (fixture trees).
 *
 * This is the red/green test the C7 plan requires: desync one parameter
 * in one replica → lint fails; restore → passes.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { runValidator, writeAgent } from './helpers/validator-harness';

// Must stay byte-identical to MEMORY_PROTOCOL_SENTINEL in
// scripts/validate-agent-authoring.js — the PASS fixtures below prove the
// validator accepts exactly this line.
const SENTINEL =
  'ruvector-protocol-constants v1: recall top_k=5, discard score < 0.5, ' +
  'keep top 3, truncate 800 chars at word boundary; dedup top_k=1, skip ' +
  'if score > 0.82.';

// One parameter desynced: top_k=7 instead of top_k=5.
const DESYNCED_SENTINEL = SENTINEL.replace('top_k=5', 'top_k=7');

const CANONICAL_PATH = 'yellow-ruvector/skills/memory-query/SKILL.md';
const REPLICA_PATH = 'yellow-core/skills/memory-recall-pattern/SKILL.md';

function skillWithSentinel(name: string, sentinelLine: string): string {
  return `---
name: ${name}
description: Fixture skill. Use when testing RULE 16.
---

# ${name}

## What It Does

Fixture body.

## When to Use

Fixture body.

## Usage

Protocol sentinel (RULE 16, byte-identical in every copy):
${sentinelLine}
`;
}

describe('RULE 16 — memory-protocol drift lint', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rule16-'));
  });

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes when canonical and replica carry the exact sentinel (green)', () => {
    writeAgent(dir, CANONICAL_PATH, skillWithSentinel('memory-query', SENTINEL));
    writeAgent(
      dir,
      REPLICA_PATH,
      skillWithSentinel('memory-recall-pattern', SENTINEL)
    );
    const { status } = runValidator(dir);
    expect(status).toBe(0);
  });

  it('fails when one replica desyncs one parameter (red)', () => {
    writeAgent(dir, CANONICAL_PATH, skillWithSentinel('memory-query', SENTINEL));
    writeAgent(
      dir,
      REPLICA_PATH,
      skillWithSentinel('memory-recall-pattern', DESYNCED_SENTINEL)
    );
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 16');
    expect(stderr).toContain('memory-recall-pattern');
  });

  it('restore after desync passes again (green after red)', () => {
    writeAgent(dir, CANONICAL_PATH, skillWithSentinel('memory-query', SENTINEL));
    writeAgent(
      dir,
      REPLICA_PATH,
      skillWithSentinel('memory-recall-pattern', DESYNCED_SENTINEL)
    );
    expect(runValidator(dir).status).toBe(1);
    // Restore: overwrite the replica with the exact sentinel.
    writeAgent(
      dir,
      REPLICA_PATH,
      skillWithSentinel('memory-recall-pattern', SENTINEL)
    );
    expect(runValidator(dir).status).toBe(0);
  });

  it('fails when a declared file exists but lacks the sentinel entirely', () => {
    writeAgent(
      dir,
      CANONICAL_PATH,
      skillWithSentinel('memory-query', 'No sentinel here.')
    );
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 16');
    expect(stderr).toContain('memory-query');
  });

  it('fails when an UNDECLARED file carries the sentinel (containment)', () => {
    writeAgent(dir, CANONICAL_PATH, skillWithSentinel('memory-query', SENTINEL));
    writeAgent(
      dir,
      'demo/skills/rogue-copy/SKILL.md',
      skillWithSentinel('rogue-copy', SENTINEL)
    );
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 16');
    expect(stderr).toContain('rogue-copy');
  });

  it('catches an undeclared copy even with a bumped version prefix', () => {
    writeAgent(dir, CANONICAL_PATH, skillWithSentinel('memory-query', SENTINEL));
    writeAgent(
      dir,
      'demo/skills/rogue-v2/SKILL.md',
      skillWithSentinel(
        'rogue-v2',
        'ruvector-protocol-constants v2: recall top_k=9.'
      )
    );
    const { status, stderr } = runValidator(dir);
    expect(status).toBe(1);
    expect(stderr).toContain('RULE 16');
  });

  it('stays silent when no declared sentinel file exists in the tree', () => {
    writeAgent(
      dir,
      'demo/skills/unrelated/SKILL.md',
      skillWithSentinel('unrelated', 'Nothing protocol-related here.')
    );
    const { status, stdout } = runValidator(dir);
    expect(status).toBe(0);
    expect(stdout).not.toContain('RULE 16');
  });
});
