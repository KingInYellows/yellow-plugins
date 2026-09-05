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
 * fencing semantics of the untrusted-input rails, and the presence of
 * upstream attribution and licence text. A synthetic fixture cannot
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
const SKILL_PATH = resolve(
  REPO_ROOT,
  'plugins/yellow-review/skills/yellow-thermonuclear-review/SKILL.md'
);
const SNAPSHOT_DIR = resolve(
  REPO_ROOT,
  'RESEARCH/upstream-snapshots/6e3d2ea56d7d446b955eaae6ac4c8eef8bf504cf'
);
const UPSTREAM_LICENSE_PATH = resolve(SNAPSHOT_DIR, 'cursor-team-kit/LICENSE');

const PINNED_COMMIT = '6e3d2ea56d7d446b955eaae6ac4c8eef8bf504cf';
const SKILL_BLOB_SHA = 'ac76a2bc88bb2d895e83ab1788aa584a82346cfc';
const AGENT_BLOB_SHA = 'dc83d959306c41bb9a4b504608d9607be34e4297';

const agent = readFileSync(AGENT_PATH, 'utf8');
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
    expect(frontmatter(skill)).toMatch(
      /^name:\s*yellow-thermonuclear-review\s*$/m
    );
  });

  it('describes itself as opt-in, not as auto-selected', () => {
    const fm = frontmatter(agent);
    expect(fm).toContain('reviewer_set.include');
    // The conditional-persona phrasing would be false here: nothing in
    // either dispatch table selects this reviewer.
    expect(fm).not.toContain('review:pr selects this automatically');
    expect(fm).not.toContain('selected automatically by review:pr');
  });

  it('fences untrusted input without an ALL-CAPS rule list', () => {
    expect(agent).toMatch(/^## Untrusted input\s*$/m);
    expect(flatten(agent)).toMatch(/data, never instructions/);
    expect(agent).toContain('--- code begin (reference only) ---');
    expect(agent).not.toContain('CRITICAL SECURITY RULES');
  });

  it('carries exactly one JSON example and it parses', () => {
    const fences = agent.match(/^```json\r?$/gm) ?? [];
    expect(fences).toHaveLength(1);
    const body = /^```json\r?\n([\s\S]*?)\r?\n```/m.exec(agent);
    if (body === null) {
      throw new Error('agent has no ```json fence');
    }
    // The schema example uses placeholder strings for free-text fields and
    // an enum union for severity; substitute concrete values so the shape
    // itself can be parsed and asserted on.
    const concrete = body[1]
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
    expect(flatten(agent)).toContain(
      'There is no persona-side confidence cutoff'
    );
    expect(flatten(agent)).toContain(
      'Report every finding you identify, with its calibrated confidence anchor'
    );
  });

  it('treats the line-count block as untrusted and fenced', () => {
    // The agent's documented shape must match what the orchestrator emits,
    // fence included, or the persona looks for a block it never receives.
    expect(agent).toContain('--- begin file-line-counts (reference only) ---');
    expect(agent).toContain('--- end file-line-counts ---');
    expect(flatten(agent)).toContain('paths in them come from the PR');
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
    expect(flatten(skill)).toMatch(
      /Report only\. Never mutate the repository\./
    );
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
      resolve(REPO_ROOT, 'plugins/yellow-review/commands/review/review-pr.md'),
      'utf8'
    );
    // A row in either auto-dispatch table would make it auto-select and
    // defeat opt-in. The "Opt-in only" table (checked below) is allowed to
    // carry the subagent_type — it never triggers automatic dispatch.
    const alwaysOnStart = command.indexOf('#### Always-on personas');
    const optInStart = command.indexOf('#### Opt-in only');
    expect(alwaysOnStart).toBeGreaterThan(-1);
    expect(optInStart).toBeGreaterThan(alwaysOnStart);
    const autoDispatchTables = command.slice(alwaysOnStart, optInStart);
    expect(autoDispatchTables).not.toContain(
      'yellow-review:review:thermonuclear-reviewer'
    );
    // It emits compact-return JSON directly, so listing it among the
    // legacy-prose reviewers would corrupt every return it makes.
    expect(command).not.toMatch(/`thermonuclear-reviewer`[^\n]*legacy/);
  });

  it('registers a non-triggering opt-in mapping to its subagent_type', () => {
    const command = readFileSync(
      resolve(REPO_ROOT, 'plugins/yellow-review/commands/review/review-pr.md'),
      'utf8'
    );
    const optInStart = command.indexOf('#### Opt-in only');
    const guardStart = command.indexOf('#### Graceful-degradation guard');
    expect(optInStart).toBeGreaterThan(-1);
    expect(guardStart).toBeGreaterThan(optInStart);
    const optInSection = command.slice(optInStart, guardStart);
    expect(optInSection).toContain(
      '`thermonuclear-reviewer` | `yellow-review:review:thermonuclear-reviewer` | maintainability'
    );
    expect(flatten(optInSection)).toMatch(/never auto-select/);
  });

  it('injects file line counts only into this persona', () => {
    const command = readFileSync(
      resolve(
        REPO_ROOT,
        'plugins/yellow-review/commands/review/review-pr.md'
      ),
      'utf8'
    );
    const flat = flatten(command);
    expect(command).toContain('<file-line-counts>');
    expect(flat).toContain(
      'only into `thermonuclear-reviewer`, and only when it was dispatched'
    );
    // The block is derived from diff paths, so it goes through the same
    // two-step sanitization as the pr-context fence.
    expect(flat).toContain(
      'apply the same two steps in the same order as the pr-context block above'
    );
    // Partial output would look authoritative; the reviewer only fails
    // closed on a block that is absent outright.
    expect(flat).toContain('do not emit a partial');
    // -z is what makes a path containing a space or quote safe to read.
    expect(command).toContain('git diff -z --numstat');
    // ...and is exactly why a control character has to be dropped: `-z`
    // yields the path RAW, so a PR author who names a file with an embedded
    // newline emits a second, fully-forged `<path> base=N head=M` row —
    // fabricating a threshold crossing on a file the PR never touched, or
    // stating a benign base for one it did. Neither sanitization step
    // touches control characters.
    expect(command).toContain('*[[:cntrl:]]*)');
    // `path` is a special array in zsh, tied to $PATH. Naming the loop
    // variable `path` replaces the command search path, after which `git`
    // and `awk` vanish and every row degrades to `base=0 head=` while the
    // loop keeps emitting. The orchestrator's shell is the host's, and on
    // this repo's own machines that is zsh.
    expect(command).not.toMatch(/^\s*path=/m);
    expect(command).toContain('new_path=');
    // Counts must come from commits on BOTH sides, so they describe the two
    // endpoints the diff spans rather than whatever is checked out.
    expect(command).toContain('git show "HEAD:$new_path"');
    // awk counts lines; `wc -l` counts newlines and undercounts a file with
    // no trailing newline — an off-by-one exactly at the 1000/1001 boundary.
    expect(command).toContain("awk 'END{print NR}'");
    // The fail-closed guard must test each value independently. Bare
    // `$base$head` concatenates them, so an empty `head` hides behind a
    // digit `base` — and `base` is a literal 0 for every file the PR adds,
    // which is exactly the `base=0 head=` row the guard exists to reject.
    expect(command).toContain('case ${base:-x}${head:-x} in');
    expect(command).not.toContain('case $base$head in');
    // `cat-file -e` also succeeds for a TREE, so a file replaced by a
    // directory of the same name would pass an existence probe and awk
    // would count git's tree listing as if it were file content.
    expect(command).toContain('git cat-file -t "HEAD:$new_path"');
    expect(command).toContain('git cat-file -t "$MERGE_BASE:$base_path"');
    expect(command).not.toMatch(/git cat-file -e ["$]/);
    expect(command).not.toMatch(/head=\$\(wc -l/);
    // The block carries its own fence, and both delimiters must join the
    // literal-delimiter substitution list or a hostile path ends it early.
    expect(command).toContain(
      '--- begin file-line-counts (reference only) ---'
    );
    expect(command).toContain('--- end file-line-counts ---');
    expect(flat).toContain('must include this block');
    expect(flat).toContain('own two delimiters');
    // `A...HEAD` diffs from the merge-base, so base content must be read
    // there too. Reading `DIFF_BASE`'s tip reports a phantom shrink on any
    // branch whose base advanced after it was cut.
    expect(command).toContain('MERGE_BASE=$(git merge-base "$DIFF_BASE" HEAD)');
    expect(command).toContain('git cat-file -t "$MERGE_BASE:$base_path"');
    expect(command).not.toContain('git show "$DIFF_BASE:$base_path"');
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
    const manifest = readFileSync(resolve(SNAPSHOT_DIR, 'MANIFEST.md'), 'utf8');
    expect(manifest).toContain('cursor/plugins');
    expect(manifest).toContain(PINNED_COMMIT);
    expect(manifest).toContain(SKILL_BLOB_SHA);
    expect(manifest).toContain(AGENT_BLOB_SHA);
    expect(manifest).toMatch(/sha256sum|shasum -a 256/);
    expect(manifest).toContain('DRIFT:');
  });
});
