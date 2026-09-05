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

import { readFileSync, readdirSync } from 'node:fs';
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
const FILE_LINE_COUNTS_SCRIPT_PATH = resolve(
  REPO_ROOT,
  'plugins/yellow-review/skills/pr-review-workflow/scripts/file-line-counts'
);
const REVIEW_PR_PATH = resolve(
  REPO_ROOT,
  'plugins/yellow-review/commands/review/review-pr.md'
);
const REVIEW_ALL_PATH = resolve(
  REPO_ROOT,
  'plugins/yellow-review/commands/review/review-all.md'
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

// Shared parser for the `<path> base=<n> head=<n>` row the script prints and
// the `file-line-counts rows=<n> dropped=<n> skipped=<n>` header above it.
// One regex applied to BOTH the documented examples (review-pr.md, the
// persona file) and the script's own printf formats is what catches the
// three independent encodings (bash printf, bats string match, vitest)
// drifting apart — a change to one without the others fails here instead
// of surfacing as a silent reviewer-side parse mismatch.
const LINE_COUNT_ROW_RE = /^(.+) base=(\d+) head=(\d+)$/;
const LINE_COUNT_HEADER_RE =
  /^file-line-counts rows=(\d+) dropped=(\d+) skipped=(\d+)$/;

function parseLineCountRow(
  line: string
): { path: string; base: number; head: number } | null {
  const m = LINE_COUNT_ROW_RE.exec(line);
  if (m === null) return null;
  return { path: m[1] ?? '', base: Number(m[2]), head: Number(m[3]) };
}

function parseLineCountHeader(
  line: string
): { rows: number; dropped: number; skipped: number } | null {
  const m = LINE_COUNT_HEADER_RE.exec(line);
  if (m === null) return null;
  return { rows: Number(m[1]), dropped: Number(m[2]), skipped: Number(m[3]) };
}

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
    const command = readFileSync(REVIEW_PR_PATH, 'utf8');
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
    // review-pr.md delegates to the extracted script by explicit path,
    // passing the diff base as an argument, and re-derives DIFF_BASE in the
    // same Bash call — shell state does not survive between fences.
    expect(command).toContain(
      '"${CLAUDE_PLUGIN_ROOT}/skills/pr-review-workflow/scripts/file-line-counts" "$DIFF_BASE"'
    );
    expect(command).not.toContain('git diff -z --numstat');
    expect(command).not.toContain("awk 'END{print NR}'");
    const item6 = command.slice(
      command.indexOf('6. A `<file-line-counts>` block'),
      command.indexOf('#### Compact-return enforcement')
    );
    expect(item6).toContain('DIFF_BASE="origin/<baseRefName>"');
    expect(item6).toContain('elif git rev-parse --verify --quiet "<baseRefName>"');
    // Header and footer bracket the payload; the header line itself now
    // belongs INSIDE the fence (rows/dropped/skipped are persona signal).
    expect(flat).toContain('the header line itself belongs inside the fence');
    expect(flat).toContain('the rows between them must number exactly `N`');
    expect(command).toContain('file-line-counts rows=1 dropped=0 skipped=0');
    // The block carries its own fence, and both delimiters must join the
    // literal-delimiter substitution list or a hostile path ends it early.
    expect(command).toContain('--- begin file-line-counts (reference only) ---');
    expect(command).toContain('--- end file-line-counts ---');
    const item2 = command.slice(
      command.indexOf('Literal-delimiter substitution (REQUIRED'),
      command.indexOf('6. A `<file-line-counts>` block')
    );
    expect(item2).toContain('[ESCAPED] end file-line-counts');
    expect(flat).toContain('must include this block');
    expect(flat).toContain('own two delimiters');
  });

  it('the extracted file-line-counts script carries the safety properties review-pr.md used to inline', () => {
    const script = readFileSync(FILE_LINE_COUNTS_SCRIPT_PATH, 'utf8');
    expect(script.startsWith('#!/bin/bash\n')).toBe(true);
    expect(script).toContain('set -uo pipefail');
    // Locale-independent bracket-expression classes.
    expect(script).toContain('export LC_ALL=C');
    // Every ambient input git would otherwise take is pinned: rename
    // detection and its limit, cwd-relative paths, and in-tree attributes.
    expect(script).toContain(
      'git -c diff.renameLimit=0 --attr-source="$LC_EMPTY_TREE" diff -z --numstat --find-renames --no-relative "$DIFF_BASE"...HEAD'
    );
    expect(script).toContain('LC_EMPTY_TREE=$(git hash-object -t tree /dev/null) || exit 1');
    // An unresolved merge-base must stop the block rather than read the
    // index, and a truncated record stream must exit, never break.
    expect(script).toContain('MERGE_BASE=$(git merge-base "$DIFF_BASE" HEAD) || exit 1');
    expect(script).toContain("IFS= read -r -d '' base_path || exit 1");
    expect(script).not.toContain('base_path || break');
    // Safe-path allowlist covers forgery AND argument/traversal injection,
    // on both paths of a rename, and never echoes the rejected path.
    expect(script).toContain(
      "''|*[[:cntrl:]]*|*[[:space:]]*|*=*|-*|/*|..|../*|*/../*|*/..)"
    );
    expect(script).toContain('for lc_probe in "$new_path" "$base_path"; do');
    expect(script).toContain('(path withheld: PR-controlled)');
    expect(script).not.toMatch(/^\s*path=/m);
    // Object classification goes through ONE batch-check call, whose
    // `missing` answer is distinguishable from a probe failure; a failure
    // stops the block instead of silently shortening it.
    expect(script).toContain(
      "git cat-file --batch-check='%(objectname) %(objecttype)'"
    );
    expect(script).not.toMatch(/git cat-file -[te] /);
    expect(script).not.toContain('git ls-tree');
    expect(script).toContain('object probe failed; omitting file-line-counts');
    // Counts come from COMMITS on both sides, read through a file (not a
    // pipe) and counted by awk (lines), never wc -l (newlines).
    expect(script).toContain('git show "$MERGE_BASE:$base_path" >|"$LC_TMP" || exit 1');
    expect(script).toContain('git show "HEAD:$new_path" >|"$LC_TMP" || exit 1');
    expect(script).toContain("awk 'END{print NR}' \"$LC_TMP\"");
    expect(script).not.toMatch(/\$\(wc -l|\| *wc -l/);
    // The fail-closed guard tests each value independently.
    expect(script).toContain('case ${base:-x}${head:-x} in');
    expect(script).not.toContain('case $base$head in');
    // The 500-file cap is enforced before any file is measured.
    const capIndex = script.indexOf('-gt 500');
    const firstMeasureIndex = script.indexOf("awk 'END{print NR}'");
    expect(capIndex).toBeGreaterThan(-1);
    expect(firstMeasureIndex).toBeGreaterThan(-1);
    expect(capIndex).toBeLessThan(firstMeasureIndex);
    // Header AND footer are printed only after the loop, and carry all
    // three counters so the persona and the orchestrator read one shape.
    expect(script).toContain(
      "printf 'file-line-counts rows=%s dropped=%s skipped=%s\\n' \"$rows\" \"$dropped\" \"$skipped\""
    );
    expect(script).toContain(
      "printf 'file-line-counts end rows=%s dropped=%s skipped=%s\\n' \"$rows\" \"$dropped\" \"$skipped\""
    );
  });

  it('the row and header formats round-trip through one parser across the script and the documented examples', () => {
    const script = readFileSync(FILE_LINE_COUNTS_SCRIPT_PATH, 'utf8');
    expect(script).toContain(
      "printf '%s base=%s head=%s\\n' \"$new_path\" \"$base\" \"$head\""
    );
    expect(parseLineCountRow('src/foo.ts base=986 head=1034')).toEqual({
      path: 'src/foo.ts',
      base: 986,
      head: 1034,
    });
    expect(
      parseLineCountHeader('file-line-counts rows=1 dropped=0 skipped=0')
    ).toEqual({ rows: 1, dropped: 0, skipped: 0 });
    expect(parseLineCountRow('src/foo.ts base=986 head=')).toBeNull();
    expect(parseLineCountHeader('file-line-counts rows=1 dropped=0')).toBeNull();

    // The documented examples in the persona file and review-pr.md must
    // parse under the same regex used against real script output.
    const command = readFileSync(REVIEW_PR_PATH, 'utf8');
    for (const doc of [agent, command]) {
      const rowLine = doc
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith('path/to/file.ts base='));
      expect(rowLine).toBeDefined();
      expect(parseLineCountRow(rowLine ?? '')).toEqual({
        path: 'path/to/file.ts',
        base: 986,
        head: 1034,
      });
      const headerLine = doc
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.startsWith('file-line-counts rows='));
      expect(headerLine).toBeDefined();
      expect(parseLineCountHeader(headerLine ?? '')).toEqual({
        rows: 1,
        dropped: 0,
        skipped: 0,
      });
    }
  });

  it('review-all.md delegates to review-pr.md Step 5 item 6 instead of duplicating the collection logic', () => {
    const reviewAll = readFileSync(REVIEW_ALL_PATH, 'utf8');
    const flat = flatten(reviewAll);
    expect(flat).toContain('Step 5 item');
    expect(flat).toContain('Do not reconstruct');
    expect(reviewAll).not.toContain('git diff -z --numstat');
    expect(reviewAll).not.toContain('scripts/file-line-counts" "$DIFF_BASE"');
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

describe('cross-host distribution', () => {
  const HOSTS = [
    { name: 'codex', dir: 'codex' },
    { name: 'cursor', dir: 'cursor' },
  ] as const;

  it.each(HOSTS)('exposes only the allowlisted skill to $name', ({ dir }) => {
    const catalog = JSON.parse(
      readFileSync(
        resolve(REPO_ROOT, 'catalog/plugins/yellow-review.json'),
        'utf8'
      )
    ) as { targets: Record<string, { skillAllowlist?: string[] }> };
    expect(catalog.targets[dir].skillAllowlist).toEqual([
      'yellow-thermonuclear-review',
    ]);
    // The generator copies only SKILL.md plus a flat references/*.md from
    // inside skills/<name>/, so an over-broad allowlist is the only way
    // extra surface leaks out; assert the host tree holds nothing but the
    // one skill directory and that the manifest exposes no agents or
    // commands.
    const hostRoot = resolve(REPO_ROOT, `plugins/yellow-review/${dir}`);
    expect(readdirSync(hostRoot).sort()).toEqual(['skills']);
    const tree = readdirSync(resolve(hostRoot, 'skills')).sort();
    expect(tree).toEqual(['yellow-thermonuclear-review']);
    const manifest = JSON.parse(
      readFileSync(
        resolve(REPO_ROOT, `plugins/yellow-review/.${dir}-plugin/plugin.json`),
        'utf8'
      )
    ) as Record<string, unknown>;
    expect(manifest.skills).toBe(`./${dir}/skills`);
    expect(manifest).not.toHaveProperty('agents');
    expect(manifest).not.toHaveProperty('commands');
    // Frontmatter must be normalised to name + description only: any other
    // key (user-invocable, tools, model) is a Claude-only contract leaking.
    const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(
      readFileSync(
        resolve(hostRoot, 'skills/yellow-thermonuclear-review/SKILL.md'),
        'utf8'
      )
    );
    expect(fm).not.toBeNull();
    const keys = (fm as RegExpExecArray)[1]
      .split(/\r?\n/)
      .filter((l) => /^[a-z-]+:/.test(l))
      .map((l) => l.replace(/:.*$/, ''))
      .sort();
    expect(keys).toEqual(['description', 'name']);
  });

  it.each(HOSTS)('ships the source body verbatim to $name', ({ dir }) => {
    // Frontmatter is normalised to name + description, but the BODY must
    // arrive byte-for-byte: everything the rails, the fail-closed size rule
    // and the MIT notice depend on lives there, and neither host applies the
    // agent's `tools:` restriction to make up for a lossy copy.
    //
    // Asserting equality rather than re-checking each property individually
    // is deliberate. The source-side tests above already prove the body
    // contains the licence, the pinned SHAs and the rails; equality then
    // carries all of it — including anything added later that nobody
    // remembers to write a substring check for — and catches any generator
    // transform, not just the handful of properties we thought to enumerate.
    const body = (source: string): string =>
      source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
    const distributed = readFileSync(
      resolve(
        REPO_ROOT,
        `plugins/yellow-review/${dir}/skills/yellow-thermonuclear-review/SKILL.md`
      ),
      'utf8'
    );
    expect(body(distributed)).toBe(body(skill));
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
