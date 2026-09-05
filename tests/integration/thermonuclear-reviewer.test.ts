/**
 * Static contract assertions for the opt-in `thermonuclear-reviewer`
 * persona and its preloaded `yellow-thermonuclear-review` skill.
 *
 * DELIBERATELY NOT the `validator-harness.ts` pattern. Every other
 * `validate-agent-authoring-*.test.ts` in this directory exercises a
 * validator script against synthetic fixtures written to a temp dir. This
 * file instead reads the two REAL committed files and asserts on their
 * content, because the properties under test are properties of those
 * specific files — the tool surface that keeps a reviewer read-only, the
 * byte-identity of a security block copied from a sibling, and the presence
 * of upstream attribution and licence text. A synthetic fixture cannot
 * assert any of that. Do not "correct" this toward the harness pattern.
 *
 * The model-quality side of this persona is evaluated by hand from
 * `plugins/yellow-review/tests/fixtures/thermonuclear/`; that suite is
 * explicitly NOT a CI gate (see its README). Everything asserted here is
 * deterministic file content.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..');

const AGENT_PATH = resolve(
  REPO_ROOT,
  'plugins/yellow-review/agents/review/thermonuclear-reviewer.md'
);
const SIBLING_AGENT_PATH = resolve(
  REPO_ROOT,
  'plugins/yellow-review/agents/review/adversarial-reviewer.md'
);
const SKILL_PATH = resolve(
  REPO_ROOT,
  'plugins/yellow-review/skills/yellow-thermonuclear-review/SKILL.md'
);
const SNAPSHOT_DIR = resolve(
  REPO_ROOT,
  'RESEARCH/upstream-snapshots/6e3d2ea56d7d446b955eaae6ac4c8eef8bf504cf'
);
const UPSTREAM_LICENSE_PATH = resolve(
  SNAPSHOT_DIR,
  'cursor-team-kit/LICENSE'
);

const PINNED_COMMIT = '6e3d2ea56d7d446b955eaae6ac4c8eef8bf504cf';
const SKILL_BLOB_SHA = 'ac76a2bc88bb2d895e83ab1788aa584a82346cfc';
const AGENT_BLOB_SHA = 'dc83d959306c41bb9a4b504608d9607be34e4297';

const agent = readFileSync(AGENT_PATH, 'utf8');
const sibling = readFileSync(SIBLING_AGENT_PATH, 'utf8');
const skill = readFileSync(SKILL_PATH, 'utf8');

/** Frontmatter block between the opening and closing `---` fences. */
function frontmatter(source: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source);
  if (match === null) {
    throw new Error('file has no YAML frontmatter block');
  }
  return match[1] ?? '';
}

/**
 * Text of one `## <heading>` section, from the heading line up to (but not
 * including) the next `## ` heading at column 0. Used for the byte-identity
 * comparison, so the slice must be taken the same way from both files.
 */
function section(source: string, heading: string): string {
  // Anchor to line start. A plain indexOf would also match inside a deeper
  // heading (`### CRITICAL SECURITY RULES` contains `## CRITICAL SECURITY
  // RULES` at offset 1) or an inline mention, slicing the wrong region — and
  // a byte-identity comparison of two wrong regions can still pass, which is
  // the failure mode this helper exists to rule out.
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = source.search(new RegExp(`^## ${escaped}\\s*$`, 'm'));
  if (start === -1) {
    throw new Error(`missing section: ## ${heading}`);
  }
  const rest = source.slice(start);
  // Offset past this heading's own line before hunting the next one.
  const nextRel = rest.slice(1).search(/^## /m);
  return nextRel === -1 ? rest : rest.slice(0, nextRel + 1);
}

/**
 * Collapse runs of whitespace to single spaces so an assertion on a
 * sentence is not defeated by where the source file happens to wrap it.
 * Prose in these files is hard-wrapped at ~76 columns and rewraps whenever
 * a word changes.
 */
function flatten(source: string): string {
  return source.replace(/\s+/g, ' ');
}

describe('thermonuclear-reviewer agent', () => {
  it('declares no mutating or dispatching tool', () => {
    const fm = frontmatter(agent);
    // The persona is read-only by contract: it proposes restructurings for
    // a human and must never be able to perform one, nor fan out further
    // agents. `validate-agent-authoring.js`'s W1.5 rule covers Bash for
    // `agents/review/`; this widens the net to the whole mutating surface.
    for (const forbidden of [
      'Bash',
      'Edit',
      'Write',
      'MultiEdit',
      'NotebookEdit',
      'Agent',
      'Task',
    ]) {
      expect(fm).not.toMatch(new RegExp(`^\\s*-\\s*${forbidden}\\s*$`, 'm'));
    }
    expect(fm).toMatch(/^\s*-\s*Read\s*$/m);
    expect(fm).toMatch(/^\s*-\s*Grep\s*$/m);
    expect(fm).toMatch(/^\s*-\s*Glob\s*$/m);
  });

  it('preloads a skill that resolves to a real same-plugin SKILL.md', () => {
    expect(frontmatter(agent)).toMatch(
      /^\s*-\s*yellow-thermonuclear-review\s*$/m
    );
    expect(frontmatter(skill)).toMatch(/^name:\s*yellow-thermonuclear-review\s*$/m);
  });

  it('describes itself as opt-in, not as auto-selected', () => {
    const fm = frontmatter(agent);
    expect(fm).toContain('reviewer_set.include');
    // The conditional-persona phrasing would be false here: nothing in
    // either dispatch table selects this reviewer.
    expect(fm).not.toContain('review:pr selects this automatically');
    expect(fm).not.toContain('selected automatically by review:pr');
  });

  it('copies the CRITICAL SECURITY RULES block byte-for-byte', () => {
    expect(section(agent, 'CRITICAL SECURITY RULES')).toBe(
      section(sibling, 'CRITICAL SECURITY RULES')
    );
  });

  it('carries exactly one JSON example and it parses', () => {
    const fences = agent.match(/^```json\r?$/gm) ?? [];
    expect(fences).toHaveLength(1);
    const body = /^```json\r?\n([\s\S]*?)\r?\n```/m.exec(agent);
    expect(body).not.toBeNull();
    // The schema example uses placeholder strings for free-text fields and
    // an enum union for severity; substitute concrete values so the shape
    // itself can be parsed and asserted on.
    const concrete = (body as RegExpExecArray)[1]
      .replace(/"P1\|P2\|P3"/g, '"P2"')
      .replace(/"<[^"]*>"/g, '"placeholder"');
    const parsed = JSON.parse(concrete) as {
      reviewer: string;
      findings: Array<Record<string, unknown>>;
      residual_risks: unknown[];
      testing_gaps: unknown[];
    };
    expect(parsed.reviewer).toBe('thermonuclear');
    expect(parsed.residual_risks).toEqual([]);
    expect(parsed.testing_gaps).toEqual([]);
    expect(parsed.findings[0].category).toBe('maintainability');
    expect(parsed.findings[0].autofix_class).toBe('advisory');
    expect(parsed.findings[0].owner).toBe('human');
    expect(parsed.findings[0].requires_verification).toBe(true);
    // `safe_auto` would route a structural rewrite into an automatic-fix
    // lane. It must not appear as a permitted value anywhere in the file.
    expect(agent).not.toContain('"autofix_class": "safe_auto"');
  });

  it('states no persona-side confidence cutoff', () => {
    // Step 6 gates once. A second cutoff here would silently drop findings
    // the aggregator was built to weigh.
    expect(flatten(agent)).toContain('There is no persona-side confidence cutoff');
    expect(flatten(agent)).toContain('Report every finding at or above anchor 50');
  });

  it('fails closed when file line counts are unavailable', () => {
    expect(agent).toContain('<file-line-counts>');
    expect(flatten(agent)).toMatch(
      /absent, empty, or unparseable, emit no size-threshold findings/
    );
  });

  it('stays under the RULE 21 agent line ceiling', () => {
    const lines = agent.split('\n').length - (agent.endsWith('\n') ? 1 : 0);
    expect(lines).toBeLessThanOrEqual(300);
  });
});

describe('yellow-thermonuclear-review skill', () => {
  it('reproduces the upstream MIT licence notice verbatim', () => {
    // Under MIT the permission notice IS the licence: "adapted from X (MIT)"
    // alone does not satisfy the condition. Compare against the snapshotted
    // upstream file rather than a retyped copy.
    const license = readFileSync(UPSTREAM_LICENSE_PATH, 'utf8').replace(
      /\n+$/,
      ''
    );
    expect(skill).toContain(license);
    expect(skill).toContain('Copyright (c) 2026 Cursor');
  });

  it('cites the pinned commit and both upstream blob SHAs', () => {
    expect(skill).toContain(PINNED_COMMIT);
    expect(skill).toContain(SKILL_BLOB_SHA);
    expect(skill).toContain(AGENT_BLOB_SHA);
  });

  it('carries the report-only rails in its own body', () => {
    // Only SKILL.md and a flat references/*.md reach the Cursor and Codex
    // targets, and neither host applies the agent's `tools:` restriction.
    // The rails have no textual basis on those hosts unless they live here.
    expect(flatten(skill)).toMatch(/Report only\. Never mutate the repository\./);
    expect(flatten(skill)).toMatch(/never instruction/i);
    expect(skill).toContain('--- code begin (reference only) ---');
  });

  it('states the fail-closed size rule without host-specific machinery', () => {
    expect(skill).toContain('<file-line-counts>');
    expect(flatten(skill)).toMatch(
      /absent, empty, or unparseable, emit no size-threshold findings/
    );
  });

  it('uses no Claude-only primitive', () => {
    // None of these are caught by a validator; they simply degrade silently
    // on Cursor and Codex, where this skill is also distributed.
    for (const primitive of [
      'AskUserQuestion',
      'subagent_type',
      '${CLAUDE_PLUGIN_ROOT}',
      '$ARGUMENTS',
      'disable-model-invocation',
    ]) {
      expect(skill).not.toContain(primitive);
    }
  });

  it('is not user-invocable and keeps the three standard headings', () => {
    expect(frontmatter(skill)).toMatch(/^user-invocable:\s*false\s*$/m);
    for (const heading of ['## What It Does', '## When to Use', '## Usage']) {
      expect(skill).toMatch(new RegExp(`^${heading}\\s*$`, 'm'));
    }
  });
});

describe('opt-in wiring', () => {
  it('appears in neither dispatch table', () => {
    const command = readFileSync(
      resolve(
        REPO_ROOT,
        'plugins/yellow-review/commands/review/review-pr.md'
      ),
      'utf8'
    );
    // A row in either table would make it auto-select and defeat opt-in.
    expect(command).not.toContain(
      'yellow-review:review:thermonuclear-reviewer'
    );
    // It emits compact-return JSON directly, so listing it among the
    // legacy-prose reviewers would corrupt every return it makes.
    expect(command).not.toMatch(/`thermonuclear-reviewer`[^\n]*legacy/);
  });

  it('is documented as the reachable-only-via-include reviewer', () => {
    const localConfig = readFileSync(
      resolve(REPO_ROOT, 'plugins/yellow-core/skills/local-config/SKILL.md'),
      'utf8'
    );
    expect(localConfig).toContain('thermonuclear-reviewer');
  });

  it('records that legacy mode cannot reach it', () => {
    const legacy = readFileSync(
      resolve(
        REPO_ROOT,
        'plugins/yellow-review/references/review-pr/legacy-fallback.md'
      ),
      'utf8'
    );
    expect(legacy).toContain('thermonuclear-reviewer');
    expect(flatten(legacy)).toMatch(
      /`reviewer_set` is not consulted on this path/
    );
  });
});

describe('upstream snapshot', () => {
  it('has a MANIFEST with a runnable drift-verification script', () => {
    const manifest = readFileSync(
      resolve(SNAPSHOT_DIR, 'MANIFEST.md'),
      'utf8'
    );
    expect(manifest).toContain('cursor/plugins');
    expect(manifest).toContain(PINNED_COMMIT);
    expect(manifest).toContain(SKILL_BLOB_SHA);
    expect(manifest).toContain(AGENT_BLOB_SHA);
    expect(manifest).toMatch(/sha256sum|shasum -a 256/);
    expect(manifest).toContain('DRIFT:');
  });
});
