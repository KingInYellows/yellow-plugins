#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const YAML = require('yaml');

const ROOT = path.resolve(__dirname, '..');
// Allow tests to point the validator at a fixture tree by setting
// VALIDATE_PLUGINS_DIR. Production runs leave it unset and use plugins/.
const PLUGINS_DIR = process.env.VALIDATE_PLUGINS_DIR
  ? path.resolve(process.env.VALIDATE_PLUGINS_DIR)
  : path.join(ROOT, 'plugins');

// W1.5 rule: review/ agents must be read-only.
// Any agent at plugins/<name>/agents/review/<file>.md must not list Bash,
// Write, Edit, or MultiEdit in its `tools:` set. Reviewers analyze; they do
// not act. This containment limits the blast radius of prompt-injection
// attempts in the untrusted PR diff and comment text reviewers consume.
// MultiEdit is a batch file-write tool just like Write/Edit — omitting it
// here left a fail-open path (a reviewer could list `MultiEdit` in `tools:`
// and still mutate files); it is denied alongside Write/Edit.
const REVIEW_AGENT_DENIED_TOOLS = ['Bash', 'Write', 'Edit', 'MultiEdit'];

// W1.5b rule: the write-capable tools a review/ agent with `memory:` set MUST
// deny via `disallowedTools` to preserve the read-only contract. `memory:`
// auto-enables Read/Write/Edit regardless of the `tools:` list, which bypasses
// the W1.5 `tools:` check above. MultiEdit is included defensively (it is NOT
// memory-granted) so the deny set the shipped review agents already declare —
// `[Write, Edit, MultiEdit]` — is enforced and stays consistent with
// REVIEW_AGENT_DENIED_TOOLS. Named REQUIRED_DISALLOWED (not MEMORY_GRANTED_*)
// because MultiEdit is a required deny, not a tool memory grants.
const REVIEW_AGENT_REQUIRED_DISALLOWED_TOOLS = ['Write', 'Edit', 'MultiEdit'];

// Valid `memory:` scope values per Claude Code docs. Only these three
// activate per-agent memory (and the Read/Write/Edit auto-grant); any other
// value (e.g. `memory: true`) is silently ignored by Claude Code, so W1.5b
// must NOT fire on it — otherwise the author gets a misleading error.
const VALID_MEMORY_SCOPES = new Set(['user', 'project', 'local']);

// RULE 13 — library-context drift lint. The canonical context7 → EXA →
// WebSearch fallback chain lives in
// plugins/yellow-research/skills/library-context/SKILL.md. Any agent that
// lists a context7 tool in `tools:` MUST either preload that skill
// (`skills: [library-context]`, which injects the chain at spawn) OR carry an
// inline copy of the safe chain — proven present by the exact drift sentinel
// below. An agent with context7 tools but neither is a silent drift surface:
// it queries context7 with no documented fallback when the user-level MCP is
// absent. This turns that into a CI failure (the repo's "prose alone is
// insufficient" enforcement philosophy — cf. W1.5/RULE 14).
const CONTEXT7_TOOLS = new Set([
  'mcp__context7__resolve-library-id',
  'mcp__context7__query-docs',
  'mcp__context7__get-library-docs',
]);
// The wildcard form (`mcp__server__*`, documented for `allowed-tools` in
// docs/claude-code-plugin-research.md) grants every context7 tool at once.
// AGENTS.md discourages wildcards in `tools:`, but RULE 13 must not silently
// no-op if an author uses one anyway — checked as a literal alongside the
// three exact tool names below.
const CONTEXT7_WILDCARD_TOOL = 'mcp__context7__*';
// The exact phrase every inlined copy of the safe chain must contain. The dash
// is an em dash (U+2014) — written as a literal `—` here so the source is
// unambiguous. An ASCII `--`/`-` substitution (typography auto-correct,
// copy-from-rendered-markdown) fails this exact-substring check, which is the
// intended catch: a corrupted sentinel means the inline copy can no longer be
// drift-detected and must be repaired.
const LIBRARY_CONTEXT_SENTINEL = 'context7 unavailable — falling back to';

// Documented exceptions to the read-only rule. Each entry must be a
// plugins-relative POSIX path. Any exception requires a "Tool Surface —
// Documented … Exception" section in the agent body explaining why the
// containment is dropped and bounding legitimate use.
const REVIEW_AGENT_ALLOWLIST = new Set([
  // codex-reviewer invokes the codex CLI binary as its core function; read-
  // only restriction would break the agent. See agent body for rationale.
  // Decision recorded in plans/everyinc-merge.md W1.2 (2026-04-29).
  'yellow-codex/agents/review/codex-reviewer.md',
  // gemini-reviewer and opencode-reviewer wrap external CLIs (gemini, opencode)
  // for the on-demand cross-lineage council. Same containment rationale as
  // codex-reviewer: Bash is required for binary invocation; read-only contract
  // is enforced via prose discipline + explicit prompt design. See plan
  // plans/yellow-council-godmodeskill-integration.md (2026-05-04).
  'yellow-council/agents/review/gemini-reviewer.md',
  'yellow-council/agents/review/opencode-reviewer.md',
]);

// V1/V2/V3/V4 — model/effort frontmatter lint rules (see M-A-01 plan).
// V1: effort: enum (low|medium|high|xhigh|max) — hard error
// V2: model: enum (haiku|sonnet|opus|inherit, optionally versioned) — hard error
// V3: model: inherit on a scanner/CI agent — non-blocking warning
// V4: synthesizer/orchestrator name without effort: high — non-blocking warning
// `inherit` is a bare keyword (no version suffix). Real model IDs (haiku,
// sonnet, opus) accept an optional one- or two-segment numeric suffix
// (e.g., `sonnet-4-6`).
const MODEL_VALUE_PATTERN = /^(haiku|sonnet|opus)(-\d+(-\d+)?)?$|^inherit$/;
const EFFORT_VALUES = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
// Effort tiers that satisfy V4's "extended chain-of-thought" requirement.
// Subset of EFFORT_VALUES — keep in sync if EFFORT_VALUES grows.
const HIGH_EFFORT = new Set(['high', 'xhigh', 'max']);
const SYNTHESIZER_NAME_PATTERN =
  /(synthesizer|orchestrator|conductor|aggregator|compounder)/i;

// Files exempt from V3/V4 advisory warnings — intentional inheritance
// or intentional default-effort. Each entry must be a plugins-relative
// POSIX path. Adding a file here is a documented decision that the
// agent's role does NOT match the rule's intent (e.g., failure-analyst
// in agents/ci/ is a workflow integration agent, not a scanner).
const MODEL_RULE_ALLOWLIST = new Set([
  // failure-analyst is a CI failure diagnosis orchestrator that delegates
  // to runner-diagnostics for deep work — its model: inherit is intentional.
  'yellow-ci/agents/ci/failure-analyst.md',
  // workflow-optimizer is a CI workflow analysis agent whose output quality
  // scales with the parent session's model — intentional inherit.
  'yellow-ci/agents/ci/workflow-optimizer.md',
  // devin-orchestrator coordinates Devin V3 sessions; its name matches V4's
  // synthesizer/orchestrator pattern but the effort default is intentional —
  // sub-sessions run independently in Devin.
  'yellow-devin/agents/workflow/devin-orchestrator.md',
  // knowledge-compounder dispatches sub-agents that handle synthesis;
  // its own role is orchestration without Opus-level reasoning. The name
  // matches V4's pattern but the brainstorm explicitly decided no
  // effort: high because the heavy work happens in sub-agents.
  'yellow-core/agents/workflow/knowledge-compounder.md',
]);

// RULE 16 — ruvector memory-protocol drift lint. The protocol constants
// (recall top_k=5 / score<0.5 / top-3 / 800-char truncation / dedup
// top_k=1 score>0.82) are load-bearing at runtime and are specified in
// FOUR skill files across two plugins, because cross-plugin `skills:`
// preload is unavailable (claude-code#15944; ruling in
// docs/solutions/code-quality/cross-plugin-shared-skill-pattern.md).
// The canonical home is yellow-ruvector's memory-query skill (that plugin
// owns the MCP tools); the three yellow-core files are marked replicas.
// Every file below must carry the sentinel line byte-identically (same
// mechanism as RULE 13: exact-substring match so any corruption — a
// changed constant, a reflowed line, a smart-quote substitution — fails
// loudly), and no other markdown file under plugins/ (CHANGELOG.md
// excluded, matching the shared markdownFiles walk) may carry it
// (containment: an undeclared copy would drift invisibly — the failure
// mode this rule exists to close — and an explicit closed file list
// avoids RULE 13's original exemption-scoping bug, where a membership
// check without a plugin-ownership check let cross-plugin files pass;
// see PR #597 / commit 3c8f6962).
//
// The consuming COMMAND files listed in the replicas' blockquotes
// (recall consumers: brainstorm.md, plan.md, spec.md, workflows/review.md,
// compound.md, work.md, review-pr.md plus its
// references/review-pr/knowledge-compounding.md, resolve-pr.md,
// review-all.md, resolve-stack.md, ruvector/search.md, ruvector/memory.md;
// remember consumers: compound.md, work.md, workflows/review.md,
// review-pr.md, review-all.md) are exempt from the byte-identity check (1):
// they inline context-adapted paraphrases (different step numbering, query
// sources, error handlers), not sentinel copies, so byte-identity is not
// enforceable there. They are still inside the containment scan (2) like
// every other plugins/ markdown file. Two known divergences are
// documented in the replica blockquotes rather than linted:
// ruvector/search.md uses top_k=10 (intentional — user-facing search
// breadth, not the recall-before-act protocol) and ruvector/learn.md
// carries no protocol constants at all (missing the dedup check its
// purpose implies — flagged as a maintainer question in the C7 PR, not
// silently "fixed").
//
// Sentinel design: single line, ASCII only (RULE 13's em-dash sentinel
// corruption incidents motivated avoiding non-ASCII here). Each sentinel
// is preceded by a `<!-- prettier-ignore -->` comment in its file —
// .prettierrc's `proseWrap: always` + `printWidth: 80` for *.md would
// otherwise rewrap the ~160-char line and break the exact-substring
// match in all copies at once. Files absent from the tree are skipped
// ONLY in fixture runs (VALIDATE_PLUGINS_DIR set); in a production run a
// missing declared file is a hard error — otherwise deleting or renaming
// the canonical source (or any replica) would silently disable its own
// check while CI stays green.
const MEMORY_PROTOCOL_SENTINEL =
  'ruvector-protocol-constants v1: recall top_k=5, discard score < 0.5, ' +
  'keep top 3, truncate 800 chars at word boundary; dedup top_k=1, skip ' +
  'if score > 0.82.';
// Plugins-relative POSIX path of the canonical source (bound explicitly,
// not by array position, so a reorder of the list below cannot silently
// repoint the error-message hint at a replica).
const MEMORY_PROTOCOL_CANONICAL_FILE =
  'yellow-ruvector/skills/memory-query/SKILL.md';
// Plugins-relative POSIX paths: canonical source + the three replicas.
const MEMORY_PROTOCOL_SENTINEL_FILES = [
  MEMORY_PROTOCOL_CANONICAL_FILE,
  'yellow-core/skills/memory-recall-pattern/SKILL.md',
  'yellow-core/skills/memory-remember-pattern/SKILL.md',
  'yellow-core/skills/mcp-integration-patterns/SKILL.md',
];

// RULE 15 (a–d) — SKILL.md authoring lint, ALL warning-tier. AGENTS.md and
// the root CLAUDE.md document these skill-authoring conventions but until
// this rule nothing enforced them (docs/optimization/analysis.md §3.4 calls
// the authoring standard "partly aspirational"). Warning tier is deliberate:
// several shipped skills fail 15b today, and a hard error would block
// unrelated PRs on pre-existing debt. Warnings do NOT affect exit code (see
// main()).
//   15a: SKILL.md over 500 lines, measured over the whole file (frontmatter
//        included) — matching the repo's own create-agent-skills convention.
//        The guidance the ceiling comes from says "body" ("Keep SKILL.md
//        body under 500 lines for optimal performance",
//        platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices);
//        the few frontmatter lines are deliberately counted here.
//   15b: missing one of the three standard headings
//        (## What It Does / ## When to Use / ## Usage).
//   15c: `description:` without a "Use when" trigger clause — weak
//        descriptions make Claude Code's skill selection unreliable.
//   15d: multi-line `description:` value — block scalars (`>` / `|`),
//        multi-line quoted strings, and wrapped plain scalars are ALL
//        silently truncated by Claude Code's frontmatter parser (see
//        docs/solutions/code-quality/skill-frontmatter-attribute-and-format-requirements.md).
const SKILL_MAX_LINES = 500;
const SKILL_REQUIRED_HEADINGS = [
  '## What It Does',
  '## When to Use',
  '## Usage',
];
// Precompiled column-0, CRLF-tolerant anchors for the three headings —
// the headings are constants, so build the regexes once, not per file.
const SKILL_HEADING_PATTERNS = SKILL_REQUIRED_HEADINGS.map((heading) => ({
  heading,
  re: new RegExp(
    `^${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*\\r?$`,
    'm'
  ),
}));

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
};

function walk(dir, predicate = () => true) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(fullPath, predicate));
      continue;
    }
    if (predicate(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

function extractFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  return match ? match[1] : null;
}

// Parse a frontmatter block with the real YAML parser (the `yaml` devDep) so
// the validator interprets frontmatter the way Claude Code does: inline
// comments stripped, quotes resolved, and flow/block lists normalized to
// arrays. Returns the parsed object on success, {} for empty/scalar/array
// frontmatter (so key lookups yield undefined → null/[]), and null when the
// YAML is malformed (callers degrade safely; validateAgentFile surfaces a
// clear error). Replacing the old hand-rolled regex parser fixes two bugs an
// audit confirmed change behavior on ZERO currently-shipped files:
//   1. `memory: project # note` previously returned "project # note" (not a
//      valid scope), silently disabling the W1.5b read-only gate. YAML strips
//      the comment → "project" → the gate fires, matching runtime behavior.
//   2. The comma-string list form Claude Code accepts (`disallowedTools:
//      Write, Edit`) is now honored — see parseList.
// Memoized on the raw frontmatter string: every agent file parses the same
// block up to ~6 times (model/effort/memory/name + tools/disallowedTools/
// skills), and YAML.parse is heavier than the regex parser it replaced.
// Identical input always yields the same result, so caching is safe — and the
// validator is spawned as a fresh child process per run (see the test harness),
// so the Map starts empty each invocation and never leaks across runs.
const frontmatterCache = new Map();

function parseFrontmatter(frontmatter) {
  if (frontmatter == null) return null;
  if (frontmatterCache.has(frontmatter)) {
    return frontmatterCache.get(frontmatter);
  }
  let data;
  try {
    data = YAML.parse(frontmatter);
  } catch {
    // Malformed YAML caches as null so the parse-error gate fires consistently.
    frontmatterCache.set(frontmatter, null);
    return null;
  }
  const result =
    data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  frontmatterCache.set(frontmatter, result);
  return result;
}

// Read a scalar frontmatter value as a string. Primitive non-strings are
// coerced (e.g. `memory: true` → "true", which is not a VALID_MEMORY_SCOPE, so
// the scope-gate still treats memory as inactive — preserving prior behavior
// and the W1.5b scope-gate test). A non-scalar node (array/object) is INVALID
// frontmatter for a scalar field: plain String() would smuggle `model:
// [inherit]` → "inherit" or `effort: [high]` → "high" past the V1/V2 enum
// checks the old regex parser flagged. Returning the JSON form instead keeps
// those checks failing loudly, and for `memory:` an array/object scope is not a
// VALID_MEMORY_SCOPE so the W1.5b gate stays inactive — matching Claude Code,
// which ignores a non-scalar memory value (no Read/Write/Edit auto-grant → no
// read-only-contract risk).
function parseScalar(frontmatter, key) {
  const data = parseFrontmatter(frontmatter);
  if (!data) return null;
  const value = data[key];
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// Read a list-typed frontmatter value (tools/disallowedTools/skills) as a
// string array. Claude Code accepts THREE forms for these fields: a YAML block
// list, a YAML flow list (`[A, B]`), and a bare comma-separated string
// (`A, B`) — see docs/research/all-possible-subagent-frontmatter-config.md.
// yaml.parse returns an array for the first two and a STRING for the comma
// form, so a string result is split on commas. Anything else (or an absent
// key) yields []. ALWAYS returns a real array so RULE 14's exact-match
// `.includes()` anti-bypass invariant holds on every accepted form (a naive
// yaml.parse swap without this split would degrade RULE 14 to substring
// matching on the comma-string form).
function parseList(frontmatter, key) {
  const data = parseFrontmatter(frontmatter);
  if (!data) return [];
  const value = data[key];
  if (Array.isArray(value)) {
    return value
      .map((item) => (item == null ? '' : String(item).trim()))
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function relative(filePath) {
  return path.relative(ROOT, filePath) || '.';
}

function logInfo(message) {
  console.log(`${colors.blue}ℹ INFO:${colors.reset} ${message}`);
}

function logError(message) {
  console.error(`${colors.red}✗ ERROR:${colors.reset} ${message}`);
}

function logWarning(message) {
  console.log(`${colors.yellow}⚠ WARN:${colors.reset} ${message}`);
}

function logSuccess(message) {
  console.log(`${colors.green}✓ PASS:${colors.reset} ${message}`);
}

// Patterns used by the agent and markdown scans. Module-scoped constants.
const skillReferencePattern = /`([a-z0-9][a-z0-9-]*)`\s+skill\b/gi;
const pluginSubagentPattern =
  /subagent_type\s*(?:=|:)\s*["']?([a-z0-9-]+:[a-z0-9-]+(?::[a-z0-9-]+)?)["']?/g;
// Colon-less subagent_type values (e.g. `subagent_type: "runner-assignment"`)
// are invisible to pluginSubagentPattern (which requires >=1 colon) and fail
// silently at runtime. Optional backticks/quotes cover inline-code-wrapped
// values; the negative lookahead stops partial matches against the first
// segment of a fully-qualified colon-ful reference.
const colonlessSubagentPattern =
  /subagent_type\s*(?:=|:)\s*[`"']*([a-z0-9-]+)(?![a-z0-9:-])/g;
// Task(bareword): shorthand (e.g. `Task(test-runner): "..."`) — not a real
// dispatch form; the canonical form is Task(subagent_type="plugin:dir:name").
const taskBarewordPattern = /\bTask\(\s*([a-z0-9-]+)\s*\)\s*:/g;

// Strip YAML frontmatter and fenced code blocks. Shared by RULE 15b, RULE 18,
// and the colon-less/bareword subagent reference checks (fence-aware:
// teaching docs show illustrative examples inside fences and must not trip
// the checks).
// Implemented as a line scan rather than a single multiline regex: the lazy
// [\s\S]*? close-fence search was measurably quadratic on files with many
// near-miss fence-marker lines, and this helper now runs on every markdown
// file, not just SKILL.md.
//
// THE MODEL (4th rewrite of this helper — read this before changing it):
// each line is modeled as (blockquote depth, list content column, content),
// where "content" is the line with ONLY its verified `>` block-quote prefix
// removed — never its indentation, which is load-bearing data, not noise:
//
//   - blockquote depth is the count of `>` markers a line's prefix carries
//     (unchanged from earlier rounds).
//   - list content column is the indentation continuation lines of the
//     current innermost list item must reach to still belong to it — e.g.
//     for a line starting `- `, that's column 2. A stack of active columns
//     is maintained as lines are scanned: a marker line pushes a new
//     column, and any line (blank lines excepted — see below) whose
//     indentation falls short of the top of the stack pops it, and
//     everything shallower, back to whichever list item it still belongs
//     to (or none).
//
// A fence OPENS only when, relative to the active list content column
// (0 outside any list), the marker sits at 0-3 extra spaces of indent — the
// same CommonMark tolerance as before, just measured from the container's
// content column instead of from column 0. 4+ spaces past that column is an
// INDENTED CODE BLOCK, not a fence opener, and is left as ordinary content
// (scanned normally, not hidden) — this is finding 1 from the 4th review
// round: the previous version stripped a line's indentation unconditionally
// before checking, so a 4-space-indented fence-looking line at top level was
// misread as a valid (0-indent) opener, which could truncate everything
// after it as "unclosed fence" content and hide a live dispatch past it.
//
// A candidate BACKTICK marker only opens a fence if its info string (the
// rest of the line after the marker run) contains no backtick — per
// CommonMark, a backtick-fence info string cannot itself contain a
// backtick (there is no such restriction for tilde fences). This is finding
// 3 from the 5th review round: a line like ```` ```lang`suffix ```` was
// being treated as a valid opener even though CommonMark does not read it
// as a fence at all, so an absent closer let the EOF "unclosed fence"
// truncation (below) discard a live dispatch that followed it. A rejected
// candidate is left as ordinary content, scanned normally — the same
// "scan more, not less" bias as the indented-code-block case above.
//
// A fence CLOSES on any of:
//   - a matching marker (same char, length >= opener) at the same
//     blockquote depth as the opener, indented at or within the same 0-3
//     space tolerance past the opener's list content column (the same
//     tolerance OPEN uses — a closer isn't required to line up EXACTLY with
//     the opener's column, only to still be within it);
//   - blockquote depth dropping below the opener's — per CommonMark a block
//     quote ends at the first line lacking its `>` marker (a truly blank
//     line has none, so it ends the quote; lazy continuation only applies
//     to paragraph text) and the quote ending also ends any fence scoped
//     inside it, closer or no closer;
//   - the list content column active at fence-open time no longer being
//     reachable — i.e. a later NON-BLANK line's indentation falls short of
//     it, meaning the list item (or block within it) that contained the
//     fence has ended. This is finding 2 from the 4th round: the earlier
//     version tracked blockquote depth only, so an unclosed fence nested in
//     a list item stayed "open" through EOF even after the surrounding
//     prose plainly outdented back to top level, truncating a live dispatch
//     that followed.
//   - EOF, per CommonMark's "unterminated fence runs to end of document".
//
// Blank lines never end a list item on their own (loose lists tolerate a
// blank line between an item's blocks), so they don't trigger the
// list-column pop/close check — only a subsequent non-blank, under-indented
// line does. Blank lines DO still end a block quote (no `>` marker to
// carry), matching CommonMark and unchanged from earlier rounds. Content
// inside a fence is never re-parsed as a list marker or examined for a new
// column — it's literal.
//
// When a container ends mid-fence, the line that ended it is treated as
// plain content, deliberately NOT re-examined as a potential new fence
// opener even if it happens to be fence-shaped itself (same conservative
// choice earlier rounds made for the blockquote case, now extended to
// lists): a legitimately reopened fence landing exactly on a container
// boundary is scanned as prose instead of being re-hidden. Between the two
// failure modes — treating closed prose as still-hidden fence content (which
// can swallow a real, live broken dispatch) vs. treating truly-fenced text
// as prose (a rare false positive a human review catches instantly) — this
// helper always picks the side that scans more, not less: a false positive
// is cheap, a swallowed finding is not.
//
// Honest limits: this is a normalization heuristic, not a full CommonMark
// block parser. List content columns are computed from a single regex pass
// per marker line (`-`, `*`, `+`, or `N.`/`N)` followed by whitespace) and
// do not implement CommonMark's full list-item-start algorithm (tab
// expansion, lazy continuation inside paragraphs, etc.) — it is accurate for
// the straightforward single- and nested-bullet Markdown this repo's docs
// actually use, not adversarial or exotic list constructs.
const fenceOpenerRe = /^[ \t]{0,3}(`{3,}|~{3,})/;
// `{0,3}`, not `*`: a block-quote marker may carry at most three leading
// spaces. At four the line is an indented code block and the `>` is literal
// content, so `    > ```text` must NOT be read as a depth-1 quote wrapping a
// fence opener — doing so hid every following quoted line as fence content
// through EOF and let a broken dispatch evade RULE 18. Matches the same
// three-space bound `fenceOpenerRe` above already applies.
const blockquotePrefixRe = /^(?:[ \t]{0,3}>[ \t]?)*/;
// A list-item marker at the very start of `rest` (already blockquote-
// stripped): `-`/`*`/`+`, or `N.`/`N)`, followed by whitespace or EOL.
const listMarkerRe = /^([ \t]*)([-*+]|\d+[.)])([ \t]+|$)/;

function splitBlockquotePrefix(line) {
  const match = blockquotePrefixRe.exec(line);
  const prefix = match ? match[0] : '';
  let depth = 0;
  for (const ch of prefix) {
    if (ch === '>') depth++;
  }
  return { depth, rest: line.slice(prefix.length) };
}

function leadingIndentOf(str) {
  let i = 0;
  while (i < str.length && (str[i] === ' ' || str[i] === '\t')) i++;
  return i;
}

// The content column a list item starting at `rest` establishes for its own
// continuation lines, or -1 if `rest` doesn't open a list item here. Per
// CommonMark, that column is the marker's indent plus the marker text plus
// the whitespace after it — capped to 1 space if that whitespace is absent
// or is 5+ characters (in both cases the rest of the line, if any, would
// itself read as an indented code block inside the item, not the item's
// normal content start).
function listItemContentColumn(rest) {
  const match = listMarkerRe.exec(rest);
  if (!match) return -1;
  const gap = match[3].length;
  const effectiveGap = gap === 0 || gap >= 5 ? 1 : gap;
  return match[1].length + match[2].length + effectiveGap;
}

// `stripFrontmatter` MUST be false when the caller has already sliced the
// frontmatter off, or passes a mid-document section. The leading-`---` regex
// below cannot tell a frontmatter block from a body that simply OPENS with a
// `---` thematic break and contains another one later: it would delete
// everything between them. That is a silent masking bug — a live
// `skill: "<ns>:<cmd>"` sitting between two horizontal rules would never reach
// RULE 18. Only a caller holding the ORIGINAL file content may strip here.
function stripFencedContent(content, { stripFrontmatter = true } = {}) {
  const lines = (
    stripFrontmatter ? content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '') : content
  ).split('\n');
  const kept = [];
  let inFence = false;
  let fenceStart = -1;
  let fenceChar = '';
  let fenceLen = 0;
  let fenceDepth = 0;
  let fenceListColumn = 0;
  const listStack = []; // ascending content columns of active list items

  for (const line of lines) {
    const { depth, rest } = splitBlockquotePrefix(line);
    const isBlank = rest.trim() === '';
    const indent = leadingIndentOf(rest);

    if (inFence) {
      const containerEnded = depth < fenceDepth || (!isBlank && indent < fenceListColumn);
      if (containerEnded) {
        // The container (block quote or list item) the fence opened inside
        // ended before a matching closer showed up — see the block comment
        // above for why this line is kept as plain content rather than
        // re-examined as a potential new opener.
        kept.length = fenceStart;
        inFence = false;
        kept.push(line);
        continue;
      }
      const contentForClose = indent >= fenceListColumn ? rest.slice(fenceListColumn) : rest;
      const closerRe = new RegExp(`^[ \\t]{0,3}\\${fenceChar}{${fenceLen},}[ \\t]*\\r?$`);
      if (depth === fenceDepth && closerRe.test(contentForClose)) {
        kept.length = fenceStart; // drop opener..closer inclusive
        kept.push(''); // preserve the blank the old regex replacement left
        inFence = false;
      } else {
        kept.push(line); // provisional fence content — kept only if unclosed
      }
      continue;
    }

    // Not in a fence. Pop any list contexts this line has outdented past
    // (blank lines never end a list item on their own — see block comment).
    if (!isBlank) {
      while (listStack.length && indent < listStack[listStack.length - 1]) {
        listStack.pop();
      }
    }
    const containerColumn = listStack.length ? listStack[listStack.length - 1] : 0;

    if (indent - containerColumn <= 3) {
      const openerMatch = fenceOpenerRe.exec(rest.slice(containerColumn));
      const marker = openerMatch ? openerMatch[1] : '';
      const infoString = openerMatch
        ? rest.slice(containerColumn + openerMatch[0].length)
        : '';
      const validOpener = openerMatch && (marker[0] !== '`' || !infoString.includes('`'));
      if (validOpener) {
        inFence = true;
        fenceStart = kept.length;
        fenceChar = marker[0];
        fenceLen = marker.length;
        fenceDepth = depth;
        fenceListColumn = containerColumn;
      }
      // else: indent within tolerance but either not fence-shaped, or a
      // backtick opener whose info string itself contains a backtick — not
      // a fence per CommonMark. Ordinary text either way.
    }
    // else: 4+ spaces past the container's content column — an indented
    // code block, not a fence opener. Left as ordinary content below, which
    // means it IS scanned normally (finding 1: scanning is the safe side).
    kept.push(line); // provisional when opening — kept only if unclosed

    if (!isBlank) {
      const newColumn = listItemContentColumn(rest);
      if (newColumn !== -1) listStack.push(newColumn);
    }
  }
  // Unclosed fence reaching EOF: per CommonMark, an unterminated fenced code
  // block implicitly runs to the end of the document — everything from the
  // opener onward is fence content, not prose. The "provisional keep" above
  // exists only to be undone once a genuine matching closer or container
  // exit shows up mid-document; it was never meant to survive to EOF.
  // Retroactively drop it with the same fenceStart truncation the other
  // branches use, so an unresolvable example inside a never-closed fence is
  // stripped like any other fenced content instead of being scanned as live.
  if (inFence) {
    kept.length = fenceStart;
  }
  return kept.join('\n');
}

// Map final agent-name segment → Set of fully-qualified 3-segment refs.
// The colon-less/bareword checks gate on registry membership (RULE 13
// lesson: membership logic must be anchored to actual plugin ownership,
// not token shape) so built-in agent types like "general-purpose" and
// incidental prose never trip them.
function buildLastSegmentIndex(pluginAgents) {
  const index = new Map();
  const twoSegOnly = new Map();
  for (const ref of pluginAgents) {
    const parts = ref.split(':');
    if (parts.length === 3) {
      if (!index.has(parts[2])) index.set(parts[2], new Set());
      index.get(parts[2]).add(ref);
    } else if (parts.length === 2) {
      if (!twoSegOnly.has(parts[1])) twoSegOnly.set(parts[1], new Set());
      twoSegOnly.get(parts[1]).add(ref);
    }
  }
  // A flat agent (agents/<name>.md, no subdirectory) registers only the
  // 2-segment form. Fall back to it per segment so such agents still gate
  // the colon-less/bareword checks; when a 3-segment form exists it wins so
  // suggestions always name the runtime dispatch form.
  for (const [last, refs] of twoSegOnly) {
    if (!index.has(last)) index.set(last, refs);
  }
  return index;
}

// Validate a single agent .md file. Pushes findings into ctx.errors /
// ctx.warnings and registers discovered agent names in ctx.pluginAgents.
function validateAgentFile(filePath, ctx) {
  const { errors, warnings, pluginAgents } = ctx;
  const content = fs.readFileSync(filePath, 'utf8');
  const frontmatter = extractFrontmatter(content);

  if (!frontmatter) {
    errors.push(`${relative(filePath)}: missing frontmatter`);
    return;
  }

  // Malformed YAML would make every parseScalar/parseList return null/[],
  // silently disabling W1.5/W1.5b/V1/V2/RULE 14. Fail loud with the parser's
  // message instead of letting the security gates go dark.
  try {
    YAML.parse(frontmatter);
  } catch (e) {
    errors.push(
      `${relative(filePath)}: malformed YAML frontmatter — ${String(e.message).split('\n')[0]}`
    );
    return;
  }

  // Derive plugin name from the path relative to PLUGINS_DIR so the validator
  // works with VALIDATE_PLUGINS_DIR fixture trees that are not under a
  // literal `.../plugins/...` ancestor directory.
  const relPath = path.relative(PLUGINS_DIR, filePath);
  const relSegments = relPath.split(path.sep);
  const pluginName = relSegments[0];
  // Hoist segment computations used by V3/V4 + W1.5 + 3-segment registration.
  // POSIX-form path keeps allowlist matching consistent across platforms.
  const agentsIdx = relSegments.indexOf('agents');
  const subdir = agentsIdx >= 0 ? relSegments[agentsIdx + 1] : null;
  const pluginsRelPath = relSegments.join('/');
  const allowlisted = MODEL_RULE_ALLOWLIST.has(pluginsRelPath);

  // V1: effort: enum (low | medium | high | xhigh | max). Hard error.
  // Catches typos (e.g., effort: hight) that would otherwise silently fall
  // back to the default and make the assignment a no-op.
  const effortVal = parseScalar(frontmatter, 'effort');
  const effortValid = effortVal === null || EFFORT_VALUES.has(effortVal);
  if (effortVal !== null && !EFFORT_VALUES.has(effortVal)) {
    errors.push(
      `${relative(filePath)}: invalid effort: '${effortVal}' ` +
        `(must be one of low|medium|high|xhigh|max)`
    );
  }

  // V2: model: enum (haiku | sonnet | opus | inherit, optionally with a
  // version suffix like sonnet-4-5). Hard error. Catches typos and invalid
  // model IDs that would otherwise fall back to the session default.
  const modelVal = parseScalar(frontmatter, 'model');
  if (modelVal !== null && !MODEL_VALUE_PATTERN.test(modelVal)) {
    errors.push(
      `${relative(filePath)}: invalid model: '${modelVal}' ` +
        `(must match ^(haiku|sonnet|opus)(-\\d+(-\\d+)?)?$|^inherit$)`
    );
  }

  // V3: model: inherit on a scanner/CI agent — non-blocking warning.
  // Nudge authors to make an explicit model choice for narrow-role agents
  // where inheritance is usually wasteful (Opus session → scanner doing
  // taxonomy matching).
  if (
    modelVal === 'inherit' &&
    !allowlisted &&
    (subdir === 'scanners' || subdir === 'ci')
  ) {
    warnings.push(
      `[V3 advisory] ${relative(filePath)}: model: inherit on a ` +
        `${subdir}/ agent — consider explicit model: sonnet or model: ` +
        `haiku based on task complexity.`
    );
  }

  // V4: synthesizer/orchestrator agents without effort: high — non-blocking
  // warning. Matches against the name field (not description) to reduce
  // false positives on integration agents that mention "synthesize" or
  // "merge" in passing. Skipped when V1 already errors on effortVal so
  // authors get one clear message instead of two.
  const name = parseScalar(frontmatter, 'name');
  if (
    name &&
    SYNTHESIZER_NAME_PATTERN.test(name) &&
    effortValid &&
    !HIGH_EFFORT.has(effortVal) &&
    !allowlisted
  ) {
    warnings.push(
      `[V4 advisory] ${relative(filePath)}: synthesizer/orchestrator ` +
        `agent without effort: high — consider extended chain-of-thought.`
    );
  }

  if (!name) {
    errors.push(`${relative(filePath)}: missing agent name`);
  } else {
    pluginAgents.add(`${pluginName}:${name}`);
    // Claude Code's Task registry resolves cross-plugin agents by the
    // three-segment plugin:directory:name form. For an agent file at
    // `<pluginName>/agents/<dir>/<name>.md`, the runtime dispatch form
    // is `<pluginName>:<dir>:<name>`. Both forms are registered so
    // existing 2-segment callers continue to validate, but the
    // markdown-scan loop below emits a warning when a 2-segment hit has
    // an available 3-segment equivalent — turning silent runtime
    // failures into loud CI signal for new code.
    if (agentsIdx >= 0 && relSegments.length > agentsIdx + 2) {
      pluginAgents.add(`${pluginName}:${subdir}:${name}`);
    }
  }

  const hasAllowedTools = /^allowed-tools:/m.test(frontmatter);
  if (hasAllowedTools) {
    errors.push(`${relative(filePath)}: use "tools:" instead of "allowed-tools:"`);
  }

  if (!hasAllowedTools) {
    const tools = parseList(frontmatter, 'tools');
    if (tools.length === 0) {
      errors.push(`${relative(filePath)}: missing or empty "tools:" list`);
    }

    // W1.5 — Rule X: review/ agents must be read-only (no Bash, Write, Edit)
    // unless explicitly allowlisted with a documented exception. Tool
    // comparison is case-insensitive so lowercase variants (e.g., `bash`)
    // cannot bypass the security check. Reuses subdir/pluginsRelPath
    // computed once at the top of the loop body.
    if (subdir === 'review') {
      if (!REVIEW_AGENT_ALLOWLIST.has(pluginsRelPath)) {
        const deniedLower = REVIEW_AGENT_DENIED_TOOLS.map((t) =>
          t.toLowerCase()
        );
        const toolsLower = tools.map((t) => t.toLowerCase());
        const violations = REVIEW_AGENT_DENIED_TOOLS.filter((_, i) =>
          toolsLower.includes(deniedLower[i])
        );
        if (violations.length > 0) {
          errors.push(
            `${relative(filePath)}: review/ agent must not include ` +
              `${violations.join(', ')} in "tools:" — reviewers are ` +
              `read-only (W1.5 rule). To document a justified exception, ` +
              `add the plugins-relative path to REVIEW_AGENT_ALLOWLIST in ` +
              `scripts/validate-agent-authoring.js and add a "Tool ` +
              `Surface — Documented Exception" section to the agent body.`
          );
        }

        // W1.5b — `memory:` auto-enables Read/Write/Edit regardless of the
        // `tools:` list (per Claude Code docs), so the tools-only check
        // above is bypassed whenever a review/ agent sets `memory:`. Such an
        // agent MUST restore the read-only contract with a `disallowedTools`
        // entry denying Write, Edit, and MultiEdit. Without this, a review
        // agent processing untrusted PR diffs runs write-capable. Every
        // shipped memory:-bearing review agent already carries
        // `disallowedTools: [Write, Edit, MultiEdit]`; this rule prevents a
        // future review/ agent from regressing silently.
        const memoryScope = parseScalar(frontmatter, 'memory');
        if (memoryScope && VALID_MEMORY_SCOPES.has(memoryScope)) {
          const disallowedLower = parseList(
            frontmatter,
            'disallowedTools'
          ).map((t) => t.toLowerCase());
          const missingDenies = REVIEW_AGENT_REQUIRED_DISALLOWED_TOOLS.filter(
            (t) => !disallowedLower.includes(t.toLowerCase())
          );
          if (missingDenies.length > 0) {
            errors.push(
              `${relative(filePath)}: review/ agent sets \`memory: ` +
                `${memoryScope}\` (auto-enables Read/Write/Edit) but ` +
                `\`disallowedTools\` is missing ${missingDenies.join(', ')} ` +
                `— add \`disallowedTools: [Write, Edit, MultiEdit]\` to ` +
                `restore the read-only contract (W1.5b rule). The \`tools:\` ` +
                `list alone does not contain the memory-granted write access.`
            );
          }
        }
      }
    }

    const skills = new Set(parseList(frontmatter, 'skills'));

    // RULE 13 — context7 consumers must preload library-context OR carry the
    // inline drift sentinel. `tools` is the parsed `tools:` list, so an empty
    // list is vacuously exempt (the "missing tools" gate above already fired).
    // The sentinel is matched against the BODY only (frontmatter stripped, same
    // CRLF-tolerant pattern as RULE 14b) with HTML comments also stripped —
    // otherwise a sentinel phrase quoted only inside a `<!-- ... -->` dev note
    // (documenting the pattern, not instructing the agent — see
    // best-practices-researcher.md's inline-copy comment) would satisfy
    // `.includes()` with no real fallback instruction in the agent's live
    // prompt body. A stray sentinel in a YAML comment still cannot satisfy the
    // rule either, since frontmatter is stripped first.
    // Exact Set match on tool names and exact-substring match on the em-dash
    // sentinel are both intentionally strict so an ASCII-dash corruption is
    // caught, not silently accepted.
    // The `skills: [library-context]` preload exemption is scoped to agents
    // inside plugins/yellow-research/ — the plugin that owns the skill.
    // Cross-plugin `skills:` resolution is documented as unavailable
    // (anthropics/claude-code#15944, closed not planned — see
    // plugins/yellow-research/skills/library-context/SKILL.md), so an agent
    // in another plugin that merely lists `skills: [library-context]` would
    // pass a plugin-unscoped check yet never receive the fallback chain at
    // runtime; such agents must inline the sentinel instead.
    if (
      tools.some((t) => CONTEXT7_TOOLS.has(t) || t === CONTEXT7_WILDCARD_TOOL)
    ) {
      const body = content
        .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
        .replace(/<!--[\s\S]*?-->/g, '');
      const preloadExempt =
        pluginName === 'yellow-research' &&
        [...skills].some((s) => s.toLowerCase() === 'library-context');
      if (!preloadExempt && !body.includes(LIBRARY_CONTEXT_SENTINEL)) {
        const fixHint =
          pluginName === 'yellow-research'
            ? `either add \`library-context\` to \`skills:\` frontmatter, ` +
              `OR include the exact phrase \`${LIBRARY_CONTEXT_SENTINEL}\` ` +
              `(em dash U+2014) in the agent body.`
            : `include the exact phrase \`${LIBRARY_CONTEXT_SENTINEL}\` (em ` +
              `dash U+2014) in the agent body — the \`skills: ` +
              `[library-context]\` preload only satisfies this rule for ` +
              `agents inside plugins/yellow-research/ (cross-plugin skills: ` +
              `resolution is unavailable at runtime).`;
        errors.push(
          `${relative(filePath)}: references a context7 tool without a ` +
            `documented fallback (RULE 13). Fix: ${fixHint}`
        );
      }
    }

    const referencedSkills = new Set();
    for (const match of content.matchAll(skillReferencePattern)) {
      referencedSkills.add(match[1].toLowerCase());
    }

    if (referencedSkills.size > 0) {
      const hasSkillTool = tools.includes('Skill');
      for (const skill of referencedSkills) {
        if (!skills.has(skill) && !hasSkillTool) {
          errors.push(
            `${relative(filePath)}: references skill "${skill}" without frontmatter "skills:" preload or Skill tool access`
          );
        }
      }
    }
  }
}

// Map plugin:name → plugin:dir:name (when unambiguous). Used to suggest
// the 3-segment form to authors who wrote a 2-segment dispatch.
function buildTwoToThreeSegmentMap(pluginAgents) {
  const twoToThreeSegment = new Map();
  for (const ref of pluginAgents) {
    const parts = ref.split(':');
    if (parts.length !== 3) continue;
    const twoSeg = `${parts[0]}:${parts[2]}`;
    if (twoToThreeSegment.has(twoSeg)) {
      twoToThreeSegment.set(twoSeg, null); // ambiguous
    } else {
      twoToThreeSegment.set(twoSeg, ref);
    }
  }
  return twoToThreeSegment;
}

// Validate subagent_type references across all markdown files against the
// discovered agent registry. Pushes hard errors into ctx.errors; emits
// advisory info logs for legacy 2-segment dispatch forms.
function validateSubagentReferences(markdownFiles, ctx) {
  const { pluginNames, pluginAgents, twoToThreeSegment, errors } = ctx;
  const lastSegmentIndex = buildLastSegmentIndex(pluginAgents);
  for (const filePath of markdownFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const match of content.matchAll(pluginSubagentPattern)) {
      const subagentType = match[1];
      const pluginName = subagentType.split(':', 1)[0];
      if (!pluginNames.has(pluginName)) {
        continue;
      }
      if (!pluginAgents.has(subagentType)) {
        errors.push(
          `${relative(filePath)}: subagent_type "${subagentType}" does not match any declared plugin agent`
        );
        continue;
      }
      // The 2-segment form remains valid (transitional) but the runtime
      // requires 3-segment. Warn when a 2-segment hit has an unambiguous
      // 3-segment equivalent so authors update before the runtime fails.
      const segments = subagentType.split(':');
      if (segments.length === 2) {
        const suggestion = twoToThreeSegment.get(subagentType);
        if (suggestion) {
          logInfo(
            `${relative(filePath)}: subagent_type "${subagentType}" uses the legacy 2-segment form — runtime expects "${suggestion}" (3-segment). Update before this CI gate becomes hard-fail.`
          );
        }
      }
    }

    // Fence-aware scans: illustrative examples inside fenced code blocks are
    // exempt (teaching docs deliberately show them), so both checks run on
    // fence-stripped content only. Real dispatch sites converted to the
    // canonical subagent_type="plugin:dir:name" form are covered by the
    // raw-content registry scan above regardless of fencing. Note RULE 15b
    // shares this fence-stripping (stripFencedContent).
    const prose = stripFencedContent(content);
    for (const match of prose.matchAll(colonlessSubagentPattern)) {
      const bare = match[1];
      const candidates = lastSegmentIndex.get(bare);
      if (!candidates) continue;
      const suggestion = [...candidates].map((r) => `"${r}"`).join(' or ');
      errors.push(
        `${relative(filePath)}: colon-less subagent_type "${bare}" — the runtime requires the fully-qualified 3-segment form; use ${suggestion}`
      );
    }
    for (const match of prose.matchAll(taskBarewordPattern)) {
      const bare = match[1];
      const candidates = lastSegmentIndex.get(bare);
      if (!candidates) continue;
      const suggestion = [...candidates]
        .map((r) => `Task(subagent_type="${r}")`)
        .join(' or ');
      errors.push(
        `${relative(filePath)}: Task(${bare}): shorthand is not a real dispatch form — use the canonical ${suggestion} form`
      );
    }
  }
}

// RULE 14 — staging-promoter frontmatter MUST contain
// `disallowedTools: [AskUserQuestion]` (in YAML list form, with or without
// flow-style brackets). This is the load-bearing structural enforcement
// of D8 in plans/background-compounding-triggers.md: the
// staging-promoter is dispatched from a background `claude -p` drain
// session where AskUserQuestion would block indefinitely (no human
// in the loop). If a future edit removes the deny, the drain breaks
// silently. RULE 14 turns that into a CI failure.
function validateStagingPromoterFrontmatter(agentFiles, errors) {
  // RULE 14 applies to BOTH staging-promoter AND staging-reviewer — both
  // run non-interactively under bypassPermissions; both must hard-deny
  // AskUserQuestion at the frontmatter level (prose-only enforcement is
  // insufficient — see docs/solutions/code-quality/subagent-frontmatter-field-catalog.md).
  const checkedAgents = [
    'staging-promoter.md',
    'staging-reviewer.md',
  ];

  for (const basename of checkedAgents) {
    const agentPath = agentFiles.find(
      (f) =>
        f.endsWith(
          `${path.sep}yellow-core${path.sep}agents${path.sep}workflow${path.sep}${basename}`
        )
    );
    if (!agentPath) {
      // Agent not yet present (e.g., stack item #2 not merged).
      // Don't fail; the agent itself is what's checked, not its absence.
      continue;
    }
    const content = fs.readFileSync(agentPath, 'utf8');
    const frontmatter = extractFrontmatter(content) || '';

    // Use the parseList() helper to extract disallowedTools as a real
    // string array, then check whether 'AskUserQuestion' is a complete
    // entry. parseList handles both flow form (`[A, B]`) and block form
    // (`- A\n- B`) and strips surrounding quotes. A `.includes()` test
    // on the parsed array is impossible to fool with substring tricks —
    // values like `'foo AskUserQuestion'`, `'AskUserQuestion(bar)'`, or
    // `'AskUserQuestion-disabled'` parse to entries that are NOT equal
    // to the bare string `'AskUserQuestion'`, so they fail the check.
    // Earlier regex-only approaches (`\b` boundaries, then lookarounds)
    // were repeatedly bypassed — see PR #544 round-1/round-2/round-3
    // review comments — because regex cannot cleanly distinguish "the
    // entry IS AskUserQuestion" from "the entry CONTAINS AskUserQuestion".
    // Parsing first sidesteps the entire problem.
    const disallowed = parseList(frontmatter, 'disallowedTools');
    if (!disallowed.includes('AskUserQuestion')) {
      errors.push(
        `${relative(agentPath)}: RULE 14 — frontmatter MUST contain \`disallowedTools: [AskUserQuestion]\` (load-bearing D8 enforcement for background-compounding drain pipeline; staging-promoter and staging-reviewer both run non-interactively)`
      );
    }
  }
}

// RULE 14b — V1 prose-only: scan staging-promoter body for any Write/Edit
// invocation that targets MEMORY.md but is not gated to the `## Session
// Notes` section. Full AST lint deferred to V2. V1 catches the most
// common drift: someone editing the agent to also append to other
// MEMORY.md sections (CORE_RULES, USER_PREFERENCES, KNOWN_PROJECTS).
function validateMemoryWriteSectionGate(agentFiles, errors) {
  const promoter = agentFiles.find(
    (f) =>
      f.endsWith(
        `${path.sep}yellow-core${path.sep}agents${path.sep}workflow${path.sep}staging-promoter.md`
      )
  );
  if (!promoter) {
    return;
  }
  const content = fs.readFileSync(promoter, 'utf8');
  // Strip frontmatter so we don't false-positive on metadata. CRLF-tolerant:
  // WSL2-authored files arrive with \r\n line endings before `.gitattributes`
  // normalization, and this regex must match either form (mirrors the pattern
  // used by extractFrontmatter()).
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

  // RULE 14b heuristic: the body must document that
  //  (a) writes target `## Session Notes` ONLY (with explicit write-
  //      restriction phrasing, not a bare "Session Notes" mention),
  //  (b) the three protected sections (CORE_RULES, USER_PREFERENCES,
  //      KNOWN_PROJECTS) are explicitly forbidden in a paragraph that
  //      also contains a "Never modify|write|touch" verb.
  //
  // Session Notes gate (a): bare `/Session Notes/` would let any
  // unrelated mention (e.g., "Session Notes section exists") satisfy
  // the rule, so a body that talks about Session Notes without claiming
  // write-restriction could pass. Bind the check to a write-restriction
  // anchor within ±200 chars: `only|ONLY .* Session Notes`,
  // `Session Notes .* section ONLY|never any other`, or
  // `append .* Session Notes .* [Nn]ever`.
  const sessionNotesGateRe = new RegExp(
    // Form A: "ONLY ... Session Notes" within 200 chars
    '(?:only|ONLY)[\\s\\S]{0,200}Session Notes' +
      // Form B: "Session Notes ... section only / ONLY / never any|other"
      '|Session Notes[\\s\\S]{0,200}(?:section\\s+only|ONLY|never\\s+(?:any|other))' +
      // Form C: "append ... Session Notes ... Never" within 200 chars
      '|append[\\s\\S]{0,200}Session Notes[\\s\\S]{0,200}[Nn]ever',
    ''
  );
  const hasSessionNotesGate = sessionNotesGateRe.test(body);

  // Never-modify invariant (b): paragraph co-location prevents the
  // global-boolean false negative where a "Never modify staging entries"
  // sentence elsewhere in the body satisfies the rule without actually
  // protecting any section. A SINGLE paragraph (text between blank lines)
  // must contain a "Never modify|write|touch" verb AND name all three
  // protected sections. This admits multi-line invariants ("Never touch
  // `## CORE_RULES`,\n `## USER_PREFERENCES`, or `## KNOWN_PROJECTS`")
  // while rejecting decoys.
  const paragraphs = body.split(/\n\s*\n/);
  const hasNeverModifyInvariant = paragraphs.some(
    (p) =>
      /[Nn]ever (?:modif|write|touch)/.test(p) &&
      /CORE_RULES/.test(p) &&
      /USER_PREFERENCES/.test(p) &&
      /KNOWN_PROJECTS/.test(p)
  );

  if (!hasSessionNotesGate || !hasNeverModifyInvariant) {
    errors.push(
      `${relative(promoter)}: RULE 14b — staging-promoter body must reference \`## Session Notes\` write gate AND state a "Never modify" invariant that enumerates ALL THREE protected sections (CORE_RULES, USER_PREFERENCES, KNOWN_PROJECTS) within the same paragraph as the Never-verb (D9-L1 memory-partition enforcement)`
    );
  }
}

// Validate that command files do not source plugin files via BASH_SOURCE.
function validateCommandFiles(commandFiles, errors) {
  for (const filePath of commandFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    const frontmatter = extractFrontmatter(content);
    const codeBlocks = content.match(/```[^\n]*\n[\s\S]*?```/g) || [];
    const codeContent = (frontmatter || '') + '\n' + codeBlocks.join('\n');
    if (codeContent.includes('BASH_SOURCE')) {
      errors.push(
        `${relative(filePath)}: markdown command sources plugin files via BASH_SOURCE; use \${CLAUDE_PLUGIN_ROOT} or a real script path`
      );
    }
  }
}

// RULE 16 — memory-protocol drift lint (see the constant block above for
// the full rationale and scope decisions). Two checks:
//   (1) every declared sentinel file that EXISTS must contain
//       MEMORY_PROTOCOL_SENTINEL as an exact substring (byte-identical);
//   (2) no other markdown file under plugins/ may contain the sentinel
//       prefix (`ruvector-protocol-constants`) — an undeclared copy is a
//       drift surface the lint cannot see, so it must either be added to
//       MEMORY_PROTOCOL_SENTINEL_FILES or removed.
// The containment check matches on the version-less prefix deliberately:
// a stray `ruvector-protocol-constants v2:` line must be caught too.
function validateMemoryProtocolSentinel(markdownFiles, errors) {
  // Compute the declared absolute paths once; the Set serves the
  // containment loop, the array serves the declared-file loop.
  const declaredPaths = MEMORY_PROTOCOL_SENTINEL_FILES.map((rel) =>
    path.join(PLUGINS_DIR, ...rel.split('/'))
  );
  const declared = new Set(declaredPaths);
  // Fixture runs (VALIDATE_PLUGINS_DIR set) write only the declared files
  // a given test exercises, so absence is expected there. In a production
  // run every declared file must exist — a deleted/renamed canonical or
  // replica must not silently disable its own check.
  const fixtureRun = Boolean(process.env.VALIDATE_PLUGINS_DIR);
  const strict =
    !fixtureRun || process.env.VALIDATE_SENTINEL_STRICT === '1';

  for (const filePath of declaredPaths) {
    if (!fs.existsSync(filePath)) {
      if (strict) {
        errors.push(
          `${relative(filePath)}: RULE 16 — declared sentinel file is ` +
            `missing. Every file in MEMORY_PROTOCOL_SENTINEL_FILES ` +
            `(scripts/validate-agent-authoring.js) must exist; if this ` +
            `file was intentionally moved or removed, update the list ` +
            `(and the canonical/replica blockquotes) in the same commit.`
        );
      }
      continue;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.includes(MEMORY_PROTOCOL_SENTINEL)) {
      errors.push(
        `${relative(filePath)}: RULE 16 — missing or corrupted memory-` +
          `protocol sentinel. This declared sentinel file must contain ` +
          `this exact line: "${MEMORY_PROTOCOL_SENTINEL}" (canonical ` +
          `source: plugins/${MEMORY_PROTOCOL_CANONICAL_FILE}). A partial ` +
          `match means a constant was changed in one copy only — update ` +
          `MEMORY_PROTOCOL_SENTINEL and every file in ` +
          `MEMORY_PROTOCOL_SENTINEL_FILES (scripts/validate-agent-` +
          `authoring.js: ${MEMORY_PROTOCOL_SENTINEL_FILES.join(', ')}) ` +
          `in the same commit, then sweep the consuming command files ` +
          `listed in the replica blockquotes.`
      );
    }
  }

  for (const filePath of markdownFiles) {
    if (declared.has(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    if (content.includes('ruvector-protocol-constants')) {
      errors.push(
        `${relative(filePath)}: RULE 16 — undeclared copy of the memory-` +
          `protocol sentinel. Only the files in ` +
          `MEMORY_PROTOCOL_SENTINEL_FILES (scripts/validate-agent-` +
          `authoring.js) may carry it. If this file is a deliberate new ` +
          `replica of the canonical protocol, add it to the list and ` +
          `keep the sentinel byte-identical; otherwise remove the line ` +
          `and paraphrase the constants instead.`
      );
    }
  }
}

// RULE 17 — wrapper -> canonical-skill drift lint. A command markdown file
// using the shell-03 wrapper idiom ("Invoke the `Skill` tool with `skill:
// "<name>"`.") must have a matching skills/<name>/SKILL.md in the SAME
// plugin, and the wrapper's own "allowed-tools" frontmatter must include
// "Skill". Generic (not gt-workflow-specific) — also covers
// plugins/yellow-core/commands/plan/status.md. This only checks that
// "Skill" is PRESENT in allowed-tools, not that the wrapper's original
// tools were preserved alongside it (anti-pattern #28: dropping Bash from
// a wrapper whose invoked skill body runs Bash loses the grant) — the set
// of "original tools" a wrapper needs isn't independently knowable from
// the file alone, so that remains a manual-review concern.
//
// Scoped to the content of a "## Usage" section ONLY, not the whole body —
// a naive whole-body scan false-flagged pre-existing, unrelated
// cross-plugin composition references (e.g.
// plugins/yellow-core/commands/flow/work.md invoking
// `skill: "smart-submit"` as one step of a much larger multi-phase
// document, where smart-submit belongs to a DIFFERENT plugin — a
// legitimate pattern this rule was never meant to validate). Every false
// positive found empirically lacked a "## Usage" heading entirely, while
// the shell-03 precedent (plan/status.md) and every wrapper this rule
// targets structure their body as descriptive prose followed by a
// "## Usage" section whose content IS the skill-invocation sentence.
const SKILL_REF_RE = /\bskill:\s*"([a-zA-Z0-9_-]+)"/g;

function extractUsageSection(body) {
  const headingMatch = body.match(/^## Usage[ \t]*\r?\n/m);
  if (!headingMatch) return '';
  const rest = body.slice(headingMatch.index + headingMatch[0].length);
  const nextHeadingMatch = rest.match(/^#{1,6} /m);
  return nextHeadingMatch ? rest.slice(0, nextHeadingMatch.index) : rest;
}

function validateSkillWrapperDrift(commandFiles, errors) {
  for (const filePath of commandFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    const fmBlockMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    const frontmatter = fmBlockMatch ? extractFrontmatter(content) : null;
    const body = fmBlockMatch ? content.slice(fmBlockMatch[0].length) : content;
    const usageSection = extractUsageSection(body);

    // Fence-strip before matching (shared stripFencedContent helper) so a
    // fenced code-block example inside "## Usage" (e.g. illustrating the
    // `skill: "..."` syntax without actually invoking it) isn't mistaken
    // for a live wrapper invocation.
    const skillNames = new Set();
    // A mid-document section, not whole-file content: never strip frontmatter
    // from it (a `---` rule inside the section is not a frontmatter fence).
    for (const match of stripFencedContent(usageSection, {
      stripFrontmatter: false,
    }).matchAll(SKILL_REF_RE)) {
      skillNames.add(match[1]);
    }
    if (skillNames.size === 0) continue;

    // Derive plugin name from the path relative to PLUGINS_DIR (not ROOT)
    // so this works with VALIDATE_PLUGINS_DIR fixture trees — mirrors
    // validateAgentFile's pluginName derivation.
    const relSegments = path.relative(PLUGINS_DIR, filePath).split(path.sep);
    const pluginName = relSegments[0];

    const allowedTools = parseList(frontmatter, 'allowed-tools');
    if (!allowedTools.includes('Skill')) {
      errors.push(
        `${relative(filePath)}: RULE 17 — body invokes the Skill tool ` +
          `(\`skill: "..."\`) but "allowed-tools" frontmatter does not ` +
          `include "Skill" — add it alongside the command's existing ` +
          `tools (do not replace them; see command-authoring anti-pattern #28)`
      );
    }

    for (const skillName of skillNames) {
      const skillFile = path.join(PLUGINS_DIR, pluginName, 'skills', skillName, 'SKILL.md');
      if (!fs.existsSync(skillFile)) {
        errors.push(
          `${relative(filePath)}: RULE 17 — references skill "${skillName}" ` +
            `via \`skill: "${skillName}"\` but plugins/${pluginName}/skills/` +
            `${skillName}/SKILL.md does not exist`
        );
      }
    }
  }
}

// RULE 18 — namespaced `skill:` dispatch targets must resolve to a real
// command `name:`.
//
// RULE 17 above cannot do this and never could: its SKILL_REF_RE character
// class `[a-zA-Z0-9_-]` EXCLUDES the colon, so a namespaced value like
// `skill: "flow:spec"` has never matched it. That blind spot was found while
// renaming the `workflows:` namespace to `flow:` — nine live dispatch targets
// pointed at command names that would have silently stopped resolving at
// runtime, and no validator anywhere would have said a word.
//
// This is deliberately a STANDING rule, not a migration one-off. The failure
// it catches — a command gets renamed, its callers do not — recurs on every
// rename, and the migration that motivated it is the least interesting
// instance.
//
// Differences from RULE 17, all deliberate:
//   - Scans the WHOLE body, not just a `## Usage` section. Namespaced
//     dispatch happens mid-document in multi-phase orchestrators (that is
//     exactly why RULE 17 scoped itself to `## Usage` — those files were its
//     false positives). Here they are the intended subjects.
//   - Resolves against EVERY plugin's commands, not the owning plugin's.
//     Cross-plugin dispatch is the normal case: yellow-linear dispatches
//     `flow:plan`, yellow-review dispatches `flow:compound`.
//   - Only namespaced values (containing `:`) are checked. Bare names stay
//     RULE 17's business, so the two rules never double-report the same value.
//
// Extraction is deliberately UNRESTRICTED inside the quotes — unlike RULE
// 17's SKILL_REF_RE, it does not require the value to match a narrow
// `[a-zA-Z0-9_-]` character class. An earlier version of this rule did, and
// that class silently swallowed malformed dispatch targets: a value like
// `flow:spec.name` (stray `.`) or `flow:spec/extra` (stray `/`) fell outside
// the class, so the whole match failed and the rule said nothing about a
// dispatch that will fail at runtime just the same as a plain typo. Casting
// a wide net here and letting resolution (buildDispatchTargetIndex lookup)
// be the actual gate means "value contains a `:` but isn't a real command or
// placeholder" is always reported, regardless of which character broke it.
// Also accepts single-quoted values (`skill: 'flow:spec'`) alongside the
// documented double-quoted form, matching how RULE 17 already tolerates only
// double quotes for its narrower bare-name case — namespaced dispatch has no
// such narrower guarantee to lean on, so both quoting forms are captured.
const SKILL_DISPATCH_VALUE_RE = /\bskill:\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)')/g;

// Illustrative names used by the two reviewer agents that TEACH the
// plugin-qualified dispatch syntax. They spell it out in prose rather than in
// a code fence, so fence-stripping does not reach them, and the plugins they
// name ("plugin", "yellow-X") do not exist.
//
// Note what these are NOT: they are not evidence that `plugin:skill` is a
// bogus form. It is the documented Skill-tool form for plugin skills, and
// this rule resolves it (see buildDispatchTargetIndex) — an early draft
// indexed only commands and would have rejected every legitimate
// plugin-qualified skill dispatch, e.g.
// `skill: "gt-workflow:stack-decomposition-format"`.
//
// Scoped to an exact (declaring file, placeholder) pair — codex P2 finding:
// an earlier version exempted these two strings ANYWHERE under plugins/, so
// a live command that accidentally copied `skill: "plugin:skill-name"` or
// `skill: "yellow-X:skill-name"` would have silently passed RULE 18 even
// though nothing resolves it. Only the two known teaching sites below may use
// their placeholder; the identical string anywhere else is a real,
// unresolvable dispatch and must be reported like any other. Kept as an
// explicit literal map (same idiom as MODEL_RULE_ALLOWLIST above) rather than
// a "looks like a placeholder" heuristic — a heuristic loose enough to catch
// `plugin:skill-name` would also swallow real typos, which is the entire
// class of bug this rule exists to catch.
//
// The map's own staleness is linted below (see the fixtureRun-gated check
// inside validateSkillDispatchResolution): if a listed file is deleted, or no
// longer contains its declared placeholder, that is stale-allowlist rot and
// becomes a hard error naming the entry — the same precedent RULE 16 sets for
// MEMORY_PROTOCOL_SENTINEL_FILES — so the exemption cannot silently outlive
// the prose it was carved out for.
const SKILL_DISPATCH_PLACEHOLDER_ALLOWLIST = new Map([
  [
    'yellow-review/agents/review/plugin-contract-reviewer.md',
    new Set(['plugin:skill-name']),
  ],
  [
    'yellow-review/agents/review/project-compliance-reviewer.md',
    new Set(['yellow-X:skill-name']),
  ],
]);

/**
 * Index every dispatchable namespaced target under PLUGINS_DIR.
 *
 * TWO kinds, and missing either one makes the rule wrong:
 *
 *   1. Command `name:` frontmatter — e.g. `flow:work`, `review:pr`. Already
 *      namespaced in the file itself.
 *   2. Plugin-qualified SKILL ids — `<plugin>:<skill-dir>`, e.g.
 *      `gt-workflow:stack-decomposition-format`. This is the documented
 *      Skill-tool form for plugin skills (the reviewer agents in
 *      SKILL_DISPATCH_PLACEHOLDERS above teach exactly this syntax), and it
 *      is namespaced only by virtue of the owning plugin's directory name —
 *      the SKILL.md's own `name:` is bare.
 *
 * Indexing commands alone would reject every legitimate plugin-qualified
 * skill dispatch. Today's call sites all happen to write skill ids bare, so
 * that bug would have stayed invisible until the first author used the
 * documented form.
 *
 * @param {string[]} commandFiles
 * @param {string[]} skillFiles
 * @returns {Map<string, string>} dispatch target -> declaring file path
 */
function buildDispatchTargetIndex(commandFiles, skillFiles) {
  const index = new Map();

  for (const filePath of commandFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    // extractFrontmatter returns the raw block STRING, not a parsed object —
    // parseScalar is the accessor the rest of this file pairs it with.
    const frontmatter = extractFrontmatter(content);
    if (!frontmatter) continue;
    const name = parseScalar(frontmatter, 'name');
    if (typeof name === 'string' && name.trim()) {
      index.set(name.trim(), filePath);
    }
  }

  for (const filePath of skillFiles) {
    // plugins/<plugin>/**/skills/<skill>/SKILL.md — take the plugin from the
    // first path segment, so nested layouts (e.g. codex/skills/<name>/)
    // resolve the same way.
    //
    // The skill half comes from the frontmatter `name:`, NOT the directory.
    // `name:` is the runtime identifier; the directory is only where the file
    // happens to live. Indexing the directory would register an id the
    // runtime does not expose whenever the two disagree, so a dispatch to that
    // stale directory-qualified value would pass this rule and then fail to
    // resolve in a live session — precisely the class RULE 18 exists to catch.
    // The directory remains the fallback for a SKILL.md with no parseable
    // `name:`, which RULE 15's structural gate reports separately.
    const relSegments = path.relative(PLUGINS_DIR, filePath).split(path.sep);
    const pluginName = relSegments[0];
    const skillDir = relSegments[relSegments.length - 2];
    if (!pluginName || !skillDir) continue;
    const skillFm = extractFrontmatter(fs.readFileSync(filePath, 'utf8'));
    const declaredName = skillFm ? parseScalar(skillFm, 'name') : null;
    const skillName = (declaredName || '').trim() || skillDir;
    const qualified = `${pluginName}:${skillName}`;
    if (!index.has(qualified)) index.set(qualified, filePath);
  }

  return index;
}

function validateSkillDispatchResolution(markdownFiles, commandFiles, skillFiles, errors) {
  const dispatchTargets = buildDispatchTargetIndex(commandFiles, skillFiles);

  for (const filePath of markdownFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    const fmBlockMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    const body = fmBlockMatch ? content.slice(fmBlockMatch[0].length) : content;

    // Fence-strip first: authoring guides show the `skill: "plugin:name"`
    // syntax inside code fences as illustration, and those placeholders
    // ("plugin:skill-name", "yellow-X:skill-name") name nothing real.
    const seen = new Set();
    // `body` already had its frontmatter sliced off above — see
    // stripFencedContent's `stripFrontmatter` note for why re-stripping here
    // would eat a body that opens with a `---` thematic break.
    for (const match of stripFencedContent(body, {
      stripFrontmatter: false,
    }).matchAll(SKILL_DISPATCH_VALUE_RE)) {
      const value = match[1] !== undefined ? match[1] : match[2];
      // No colon at all: a bare name, e.g. `skill: "old-name"` — RULE 17's
      // domain, not this rule's. This is the ONLY skip condition; every
      // colon-bearing value below is checked, resolved shapes and malformed
      // ones alike, so a shape RULE 17's narrower class never reaches (like
      // `flow:spec.name`) still gets reported instead of silently passing.
      if (!value.includes(':')) continue;
      seen.add(value);
    }
    if (seen.size === 0) continue;

    // Placeholder allowlist is scoped per DECLARING FILE, not global — the
    // identical placeholder string in any other file is a real, unresolvable
    // dispatch (see SKILL_DISPATCH_PLACEHOLDER_ALLOWLIST above).
    const pluginsRelPath = path
      .relative(PLUGINS_DIR, filePath)
      .split(path.sep)
      .join('/');
    const allowedPlaceholders = SKILL_DISPATCH_PLACEHOLDER_ALLOWLIST.get(pluginsRelPath);

    for (const target of seen) {
      if (dispatchTargets.has(target)) continue;
      if (allowedPlaceholders && allowedPlaceholders.has(target)) continue;
      errors.push(
        `${relative(filePath)}: RULE 18 — dispatches \`skill: "${target}"\` ` +
          `but nothing under plugins/ provides it: no command declares ` +
          `\`name: ${target}\`, and no plugin skill resolves as ` +
          `\`<plugin>:<skill-dir>\`. Either the target was renamed and this ` +
          `caller was missed, or the name is a typo — this dispatch fails ` +
          `at runtime.`
      );
    }
  }

  // Stale-allowlist-rot check: a declared (file, placeholder) entry that no
  // longer exists, or whose file no longer contains the placeholder, is a
  // hard error naming the entry — mirrors RULE 16's declared-sentinel-file
  // check (MEMORY_PROTOCOL_SENTINEL_FILES above) so this exemption cannot
  // silently outlive the prose it was carved out for. Skipped in fixture
  // runs by default (the temp-dir trees the RULE 18 integration tests build
  // do not carry these two real files) unless a test opts back in, matching
  // RULE 16's VALIDATE_SENTINEL_STRICT precedent.
  const fixtureRun = Boolean(process.env.VALIDATE_PLUGINS_DIR);
  const strict = !fixtureRun || process.env.VALIDATE_PLACEHOLDER_ALLOWLIST_STRICT === '1';
  if (strict) {
    for (const [relPath, placeholders] of SKILL_DISPATCH_PLACEHOLDER_ALLOWLIST) {
      const absPath = path.join(PLUGINS_DIR, ...relPath.split('/'));
      if (!fs.existsSync(absPath)) {
        errors.push(
          `${relPath}: RULE 18 — declared placeholder-allowlist entry no ` +
            `longer exists. Remove it from SKILL_DISPATCH_PLACEHOLDER_ALLOWLIST ` +
            `(scripts/validate-agent-authoring.js) in the same commit that ` +
            `deleted or moved this file.`
        );
        continue;
      }
      const declaringContent = fs.readFileSync(absPath, 'utf8');
      for (const placeholder of placeholders) {
        if (!declaringContent.includes(placeholder)) {
          errors.push(
            `${relPath}: RULE 18 — declared placeholder "${placeholder}" no ` +
              `longer appears in this file. Remove the stale entry from ` +
              `SKILL_DISPATCH_PLACEHOLDER_ALLOWLIST (scripts/validate-agent-` +
              `authoring.js), or restore the placeholder text if it was ` +
              `edited by accident.`
          );
        }
      }
    }
  }
}

// RULE 15 — SKILL.md authoring rules (see the constant block above for the
// rule catalog and rationale). RULE 15 sub-rules push warning-tier findings
// only; ctx.errors receives just the malformed-YAML structural gate below —
// the same fail-loud gate agent files get in validateAgentFile.
function validateSkillFiles(skillFiles, ctx) {
  const { errors, warnings } = ctx;
  for (const filePath of skillFiles) {
    const content = fs.readFileSync(filePath, 'utf8');

    // 15a — line ceiling. Counts logical lines: newline-separated segments,
    // including a final unterminated line (a file with no trailing newline
    // still counts its last line). For files that end with a trailing
    // newline — the common case for markdown here — this equals `wc -l`; a
    // file lacking one deliberately reports one more line than `wc -l`
    // would, so the ceiling still sees the unterminated last line.
    const lineCount =
      content.split('\n').length - (content.endsWith('\n') ? 1 : 0);
    if (lineCount > SKILL_MAX_LINES) {
      warnings.push(
        `[RULE 15a advisory] ${relative(filePath)}: ${lineCount} lines ` +
          `(ceiling ${SKILL_MAX_LINES}) — move conditional or late-sequence ` +
          `detail into references/ files behind imperative load stubs.`
      );
    }

    // 15b — three standard headings. Matched per-line at column 0 so a
    // heading quoted mid-sentence or nested deeper (### What It Does) does
    // not satisfy the rule. CRLF-tolerant tail like the other body regexes.
    // Frontmatter and fenced code blocks are stripped first (shared
    // stripFencedContent helper) so a heading that only appears inside a
    // fenced authoring example (e.g. a skill documenting the three-heading
    // layout) cannot satisfy the presence check while the document's real
    // sections are missing.
    const body = stripFencedContent(content);
    const missingHeadings = SKILL_HEADING_PATTERNS.filter(
      ({ re }) => !re.test(body)
    ).map(({ heading }) => heading);
    if (missingHeadings.length > 0) {
      warnings.push(
        `[RULE 15b advisory] ${relative(filePath)}: missing standard ` +
          `heading(s) ${missingHeadings.join(', ')} — SKILL.md uses the ` +
          `three-heading layout (## What It Does / ## When to Use / ## Usage).`
      );
    }

    const frontmatter = extractFrontmatter(content);

    // Malformed YAML would make parseScalar return null and route the file
    // into 15c's "missing description" message — the wrong diagnosis, with
    // the real parse error discarded. Fail loud instead, exactly like
    // validateAgentFile does for agent files (no other pass walks SKILL.md,
    // so this is the only place a broken skill frontmatter can surface).
    if (frontmatter !== null) {
      try {
        YAML.parse(frontmatter);
      } catch (e) {
        errors.push(
          `${relative(filePath)}: malformed YAML frontmatter — ${String(e.message).split('\n')[0]}`
        );
        continue;
      }
    }

    const description = frontmatter
      ? parseScalar(frontmatter, 'description')
      : null;

    // 15c — trigger clause. Literal case-insensitive "use when" keeps the
    // rule predictable; the repo convention (Tier 1 C1, PR #601) writes
    // trigger clauses as "Use when ...".
    if (description === null) {
      warnings.push(
        `[RULE 15c advisory] ${relative(filePath)}: missing \`description:\` ` +
          `frontmatter — add a single-line description with a "Use when" ` +
          `trigger clause.`
      );
    } else if (!/use when/i.test(description)) {
      warnings.push(
        `[RULE 15c advisory] ${relative(filePath)}: \`description:\` lacks a ` +
          `"Use when" trigger clause — concrete triggers make skill ` +
          `selection reliable.`
      );
    }

    // 15d — multi-line description. Checked against the RAW frontmatter
    // text (not the parsed value): YAML folds block scalars, multi-line
    // quoted strings, and wrapped plain scalars into one normal string, so
    // only the raw form reveals the truncation hazard. Two shapes:
    //   (a) block scalar — value starts with `>` or `|`;
    //   (b) continuation — an indented line follows `description:`, which
    //       in a top-level frontmatter mapping can only be a continuation
    //       of the description value (covers multi-line quoted strings and
    //       wrapped plain scalars — the forms this repo has actually been
    //       bitten by; both parse to a folded string, so 15c alone cannot
    //       catch them when the folded text contains "use when"). Blank
    //       lines between `description:` and the indented continuation are
    //       tolerated — YAML permits them inside a quoted scalar, so a
    //       blank separator must not let the continuation slip past.
    // `[ \t]*` not `\s*` — \s matches the newline and would false-positive
    // on the next line's first character. `.` in the capture tolerates a
    // trailing `\r` on CRLF input.
    if (frontmatter) {
      const descLine = frontmatter.match(/^description:[ \t]*(.*)$/m);
      if (descLine) {
        const isBlockScalar = /^[>|]/.test(descLine[1]);
        const afterDescLine = frontmatter.slice(
          descLine.index + descLine[0].length
        );
        const hasContinuation = /^\r?\n(?:[ \t]*\r?\n)*[ \t]+\S/.test(
          afterDescLine
        );
        if (isBlockScalar || hasContinuation) {
          warnings.push(
            `[RULE 15d advisory] ${relative(filePath)}: \`description:\` ` +
              `spans multiple lines (block scalar, multi-line quoted ` +
              `string, or wrapped plain scalar) — Claude Code silently ` +
              `truncates multi-line descriptions; use a single-line ` +
              `description.`
          );
        }
      }
    }
  }
}

function main() {
  const pluginNames = new Set(
    fs
      .readdirSync(PLUGINS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  );

  const agentFiles = walk(
    PLUGINS_DIR,
    (filePath) =>
      filePath.includes(`${path.sep}agents${path.sep}`) &&
      filePath.endsWith('.md')
  );
  // Skip CHANGELOG.md files: they document history including agents that have
  // since been deleted/renamed, so subagent_type references in CHANGELOG prose
  // are not live dispatches and must not be validated against the current
  // agent registry. See `docs/solutions/build-errors/` for context.
  const markdownFiles = walk(
    PLUGINS_DIR,
    (filePath) =>
      filePath.endsWith('.md') &&
      path.basename(filePath).toUpperCase() !== 'CHANGELOG.MD'
  );
  const commandFiles = walk(
    PLUGINS_DIR,
    (filePath) =>
      filePath.includes(`${path.sep}commands${path.sep}`) &&
      filePath.endsWith('.md')
  );
  // SKILL.md manifests only — references/*.md and other files under skills/
  // are free-form and not subject to RULE 15.
  const skillFiles = walk(
    PLUGINS_DIR,
    (filePath) =>
      filePath.includes(`${path.sep}skills${path.sep}`) &&
      path.basename(filePath) === 'SKILL.md'
  );

  logInfo(
    `Validating ${agentFiles.length} agents and ${markdownFiles.length} markdown files...`
  );

  const errors = [];
  const warnings = [];
  const pluginAgents = new Set();

  for (const filePath of agentFiles) {
    validateAgentFile(filePath, { errors, warnings, pluginAgents });
  }

  const twoToThreeSegment = buildTwoToThreeSegmentMap(pluginAgents);
  validateSubagentReferences(markdownFiles, {
    pluginNames,
    pluginAgents,
    twoToThreeSegment,
    errors,
  });
  validateCommandFiles(commandFiles, errors);
  validateSkillWrapperDrift(commandFiles, errors);
  validateSkillDispatchResolution(markdownFiles, commandFiles, skillFiles, errors);
  validateSkillFiles(skillFiles, { errors, warnings });
  validateMemoryProtocolSentinel(markdownFiles, errors);
  validateStagingPromoterFrontmatter(agentFiles, errors);
  validateMemoryWriteSectionGate(agentFiles, errors);

  // Print warnings first so they remain visible above the trailing
  // success/error block. Warnings do NOT affect exit code; only errors do.
  for (const warning of warnings) {
    logWarning(warning);
  }

  if (errors.length > 0) {
    for (const error of errors) {
      logError(error);
    }
    process.exit(1);
  }

  logSuccess(
    `Validated ${agentFiles.length} agents and ${markdownFiles.length} markdown files`
  );
}

main();
