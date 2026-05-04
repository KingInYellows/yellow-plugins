# yellow-council: GodModeSkill Integration Brainstorm

**Date:** 2026-05-03
**Source investigation:** `research/GodModeSkill Integration Investigation.md`
**GodModeSkill reference commit:** `b693d1da498cbcfc2e5cba1f85b3d341205bfeb0`

---

## What We're Building

A new dedicated plugin — `yellow-council` — that provides on-demand, advisory,
cross-lineage code review by fanning out to three external model families
(Codex CLI, Gemini CLI, OpenCode CLI) in parallel, synthesizing their verdicts
inline in the active conversation, and persisting the full report to
`docs/council/<date>-<slug>.md`.

The command surface is `/council <mode> [input]` with four explicit modes:
`plan`, `review`, `debug`, `question`. The user invokes it deliberately,
at any point in development — planning, implementation, debugging, or pre-merge
review. It is not wired into the existing yellow-review 14-reviewer pipeline;
that pipeline runs unchanged.

V1 is synchronous, inline, and advisory. V2 evolves toward GodModeSkill's
native persistent-session model with lineage-weighted quorum aggregation and
quote-backed evidence verification. V1 must not foreclose V2.

---

## Why This Approach

### Why a new plugin, not a modification of yellow-review

The existing yellow-review pipeline is a Claude-only multi-agent system with
a mature confidence-rubric aggregator, schema-validated compact-return findings,
and a tiered persona dispatch table. Adding external binary dependencies (Codex,
Gemini, OpenCode CLIs) to that pipeline would break the clean "no sidecar
process" contract that every yellow-review reviewer follows. The council is a
different kind of tool — it fans out to external runtimes the user has
installed — and deserves its own manifest, its own command surface, and its own
failure semantics (partial results on timeout, CLI not installed = graceful skip).

### Why synchronous inline for V1

The user explicitly invokes `/council` when they want cross-lineage input. They
accept the wait. Async fire-and-watch adds session state management, a
`/council status` command, and a polling or notification model — none of which
are needed when the human is present and waiting. V1 accepts a 5-10 minute
blocking wait; per-reviewer timeout is 600 seconds with partial-result reporting
if any reviewer misses the cutoff.

### Why yellow-codex as optional dep, not bundled

Yellow-codex already encodes all correct Codex CLI invocation conventions:
`codex exec` flags, exit-124 timeout detection, JSONL output parsing, structured
review schema, credential redaction (8-pattern awk block), injection fencing.
Duplicating that inside yellow-council would create two diverging implementations
of the same underlying CLI. Instead, when yellow-codex is installed, yellow-council
spawns `yellow-codex:review:codex-reviewer` via Task and gets the right output
shape automatically. When it is absent, yellow-council soft-skips Codex with a
warning and runs with 2 of 3 reviewers.

### Why explicit modes, not magic inference

The four modes (plan / review / debug / question) produce deterministic,
per-mode context packs. The user always knows what context the council will
receive before invoking it. This is both safer (no surprise context assembly)
and V2-portable (GodModeSkill's XML pack templates map one-to-one to these
same four modes).

---

## Key Decisions

### Decision 1: External model families, separate pipeline, on-demand

- This is NOT a modification of yellow-review. Separate plugin, separate
  command surface, separate invocation lifecycle.
- On-demand only. `/council` is never triggered automatically by
  yellow-review, yellow-debt, or any other plugin.
- Invocable at any point in the development process: planning, implementation,
  debugging, or review. Input shape is flexible by mode.
- Advisory output only. Results never block a merge, never trigger an automatic
  fix pass, never auto-commit.

### Decision 2: Synchronous parallel fan-out, 600s per-reviewer timeout

- All three CLI reviewers are spawned in parallel (not sequentially).
- Per-reviewer timeout: 600 seconds (configurable via `COUNCIL_TIMEOUT` env
  var). This is intentionally generous — the user invoked the heavyweight tool
  and accepts the wait.
- Partial results on timeout: if Codex finishes in 90s but Gemini times out at
  600s, the synthesis report includes Codex's verdict and notes
  "Gemini timed out at 600s — omitted from council report."
- Timeout detection follows the yellow-codex `codex-patterns` convention:
  exit 124 from `timeout --signal=TERM --kill-after=10 600 <cli> ...`.
- V1 design. V2 trajectory: persistent sessions, event-driven
  `inotifywait`-equivalent wait, multi-round iterative review with `## DONE`
  markers. V2 must be addable without breaking V1 single-shot semantics.

### Decision 3: New `yellow-council` plugin, yellow-codex as optional dep

Plugin layout (V1):

```
plugins/yellow-council/
  .claude-plugin/
    plugin.json
  agents/
    review/
      gemini-reviewer.md
      opencode-reviewer.md
  commands/
    council/
      council.md          # main /council command (plan/review/debug/question)
  skills/
    council-patterns/
      SKILL.md            # Gemini + OpenCode CLI flags, pack templates, timeout
                          # patterns, output fencing. Cross-references
                          # codex-patterns (yellow-codex) rather than duplicating.
  docs/
    council/              # runtime output directory (created on first use)
  CLAUDE.md
  README.md
  package.json
  CHANGELOG.md
```

- `yellow-codex` declared as optional dep (documentation-only convention,
  same as yellow-codex's existing cross-plugin pattern — no `optionalDependencies`
  field in plugin.json schema today).
- `yellow-core` stays untouched. No binary deps enter the foundation.
- V2 adds `agents/fleet/` and commands `council/fleet.md` under the same plugin
  without restructuring.

### Decision 4: Explicit mode + input

Four V1 modes:

| Mode | Invocation | Context packed |
|------|-----------|----------------|
| `plan` | `/council plan <path-or-text>` | File/text content + repo CLAUDE.md + relevant conventions |
| `review` | `/council review [--base <ref>]` | Diff (HEAD vs base) + changed file content + base/head SHAs. Truncation guards from GodModeSkill `work-pack-build` pattern. |
| `debug` | `/council debug "<symptom>" [--paths <files>]` | Symptom + cited file content + surrounding code + recent git log on those files |
| `question` | `/council question "<text>" [--paths <files>]` | Question + optional file content + CLAUDE.md |

- Bare `/council` with no args: print the four modes with one-line descriptions
  and exit. No magic inference.
- Per-mode pack templates live in `council-patterns` SKILL.md as markdown with
  explicit slot fills. These are the V2 swap surface for GodModeSkill's XML pack
  format (`<file-path>` / `<line-number>` / `<quoted-line>` CDATA evidence
  contract).
- Input sanitization: all user-supplied free text and file paths are wrapped in
  injection fences before passing to any CLI. Path validation: reject `..`
  traversal and any character outside `^[a-zA-Z0-9._/-]+$` before constructing
  shell arguments. Follows MEMORY.md shell-script-security patterns.
- `--paths` injection on debug/question modes: limit total injected content to
  a per-mode cap (exact cap to be specified in plan phase — likely 8K chars per
  file, 3 files max in V1 to avoid blowing context windows on Gemini/OpenCode).

### Decision 5: Inline synthesis + file write

**V1 synthesizer structure:**

```
## Council Report — <mode>: <topic> — <date>

### Headline
<All 3 reviewers APPROVE> / <Split — 2 APPROVE, 1 REVISE> / etc.
Council ran with N of 3 reviewers. [If any skipped: "<name> timed out at 600s" /
"<name> not installed (yellow-codex absent)"]

### Agreement (cited by 2+ reviewers)
- file:line — <finding>
  - Codex: "<their phrasing>"
  - Gemini: "<their phrasing>"

### Disagreement (unique to one reviewer or conflicting verdicts)
- <finding> — Codex only
- Verdict conflict at path/to/file.ts:42: Codex APPROVE, Gemini REVISE

Full reviewer outputs: see docs/council/<slug>.md
```

**Inline conversation:** synthesis report only (Headline + Agreement +
Disagreement sections). Raw reviewer outputs are NOT pasted inline — they
reference the file path.

**File at `docs/council/YYYY-MM-DD-<slug>.md`:** synthesis report + three
labeled raw output sections:

```markdown
## Codex Output
--- begin council-output (reference only) ---
<full Codex reviewer output, post-fence-redaction>
--- end council-output ---

## Gemini Output
...

## OpenCode Output
...
```

**Slug derivation:** `<mode>-<first-N-words-of-topic>`, normalized to
`^[a-z0-9]+(?:-[a-z0-9]+)*$` (no trailing or consecutive hyphens — per
MEMORY.md path-validation rule). Same-day collision: append `-2`, `-3`, etc.

**V1 synthesizer non-goals (explicit deferrals to V2):**
- No lineage-weighted quorum (V1 uses raw count only)
- No quote-verification pass against repository source (V1 trusts reviewer
  output as-is, just fences and redacts it)
- No XML-structured findings parsing — V1 parses loose markdown structure
- No confidence scoring or priority weighting beyond each reviewer's own
  P1/P2/P3 labels
- No ranking of reviewers against each other
- No `/council history` browse command (file is there; browsing is manual in V1)

---

## CLI Invocation Notes (from live environment check, 2026-05-03)

Both Gemini and OpenCode CLIs are present on this machine.

**Gemini CLI (`gemini`):**
- Non-interactive one-shot: `gemini "prompt"` (positional, no `-p` flag —
  deprecated)
- Auto-accept all actions: `--approval-mode yolo` or `-y`
- Structured output: `-o json` or `-o stream-json`
- Model selection: `-m <model>`
- Stdin: accepts piped context before the positional prompt
- Output destination: stdout (capture with shell substitution or temp file)

**OpenCode CLI (`opencode`):**
- Non-interactive execution: `opencode run "message"`
- File attachments: `-f <file>` (array, can repeat)
- JSON event stream: `--format json`
- Model selection: `-m provider/model`
- Session management: `-c` (continue last), `-s <id>` (specific session)
- Agent selection: `--agent <name>`
- Variant (reasoning effort): `--variant high|max|minimal`

**Spike needed in implementation phase:**
- Confirm Gemini's `-o json` output schema for non-review prompts (the
  structured output shape for freeform question/debug/plan modes is not yet
  verified from live output)
- Confirm `opencode run --format json` event schema and how to extract the
  final assistant message (analogous to Codex's `agentMessage` / `text` field)
- Verify Gemini `--approval-mode yolo` behavior for read-only review (does it
  attempt any write actions that yolo would approve, or is it safe for
  read-only council use?)
- Determine if `opencode run` is truly ephemeral by default or if it persists
  a session that needs explicit cleanup

---

## V2 Trajectory — What V1 Must Not Foreclose

The following V2 features must be addable without rewriting V1:

1. **XML evidence contract.** V1 asks each reviewer to emit findings as
   markdown with `file:line` + quoted line where applicable. The per-mode
   pack templates in `council-patterns` SKILL.md must be structured so that V2
   can tighten the output spec to GodModeSkill's full XML evidence contract
   (`<file-path>` / `<line-number>` / `<quoted-line><![CDATA[...]]></quoted-line>`)
   by editing the template only — not by changing the agent or command structure.

2. **Lineage-weighted quorum aggregation.** V1 uses raw count + verbatim
   presentation. V2 swaps in quorum logic (agreement requires >=1 reviewer from
   each available lineage, findings that cannot be verified against repository
   source are downgraded). The V1 synthesizer must be isolated (its own
   agent or prose section) so it can be replaced without touching the fan-out
   or pack-build stages.

3. **Multi-round iterative review.** V1 is single-shot. V2 must be able to add
   `/council review --round 2` or a `resume` subcommand that injects the V1
   output as prior context into a second council round, with round-aware context
   trimming (unchanged long-tail context omitted in round 2 per GodModeSkill
   `work-pack-build` pattern).

4. **Fleet management subcommand surface.** V1 has no persistent sessions.
   V2 will add `/council fleet status`, `/council fleet restart`, and
   persistent tmux-style session management. The V1 command file
   (`commands/council/council.md`) must reserve the `fleet` subcommand word
   and print a "fleet management not available in V1" message if invoked, so
   the V2 PR can wire it without a naming conflict.

5. **`## DONE` event-driven waiting.** V1 blocks on subprocess exit.
   V2 may move to inotifywait-style waiting for `## DONE` markers in reviewer
   output. V1's per-reviewer timeout guard (exit 124) and partial-result
   collection logic must be isolated in `council-patterns` SKILL.md so V2
   can swap the wait mechanism.

---

## Open Questions for `/workflows:plan`

These are unresolved specifics that the plan phase must address before writing
implementation files:

1. **Soft-skip vs minimal Codex bundle when yellow-codex absent.** Decision
   is soft-skip (Council ran with 2 of 3 reviewers), but confirm: should
   yellow-council ship a minimal fallback `codex-reviewer` of its own as a
   future option, or is soft-skip permanent? Plan should specify which.

2. **Gemini output parsing for non-review modes.** The `-o json` schema for
   freeform `question`/`debug`/`plan` prompts must be verified with a live
   spike before the gemini-reviewer agent is finalized. Plan should include a
   spike step.

3. **OpenCode final-message extraction from `--format json` event stream.**
   The event schema for `opencode run --format json` is analogous to Codex's
   JSONL but unverified. Spike required. If the schema is unstable or
   undocumented, plan should note `--format default` (plain text capture) as
   the safe fallback for V1.

4. **`--paths` content cap for debug/question modes.** V1 needs an explicit
   per-mode character limit on injected file content before passing to Gemini/
   OpenCode (both have context window limits that differ from Codex's 128K).
   Gemini 2.5 Pro has a 1M token window; OpenCode's limit depends on the
   configured model. Plan should specify a conservative V1 default (suggestion:
   8K chars per file, 3 files max) with a flag to override.

5. **Slug derivation for `/council plan <path>`** when input is a file path:
   use the filename stem (e.g., `plan-2026-05-03-yellow-council-design`) vs
   the first N words of the file's first heading? Needs a concrete rule in the
   plan to avoid ambiguity.

6. **`plugin.json` `optionalDependencies` field.** Confirm whether the current
   plugin schema supports this field (current evidence says no — yellow-codex's
   cross-plugin dep is docs-only). If not, plan should document the convention
   used (docs + graceful soft-skip guard) so a future schema addition does not
   leave stale docs.

7. **Credential redaction scope for Gemini and OpenCode output.** Yellow-codex's
   8-pattern awk redaction block (sk-, ghp_, AKIA, Bearer, Authorization,
   PEM keys) should be replicated in `council-patterns` SKILL.md as the
   canonical redaction surface for all three reviewers. Confirm whether
   OpenCode's JSON event stream requires redaction of any additional fields
   (e.g., embedded tool-call arguments).

---

## Anti-Patterns Explicitly Avoided

These patterns from GodModeSkill are intentionally excluded from both V1 and V2:

- **tmux fleet management in V1.** No tmux session spawning, no babysit loops,
  no `work-fleet-restart` equivalent. V2 may add persistent session support,
  but V1 is pure subprocess spawn-and-wait.
- **Home-directory binary placement.** No `~/.local/bin/council` executor.
  All behavior lives in the plugin's markdown commands and agents under
  `plugins/yellow-council/`.
- **Global installer prompts.** No `INSTALL.md` paste-into-Claude flow. Yellow-
  council installs via `/plugin marketplace add` like every other yellow-plugins
  plugin.
- **Auto-modifying git workflows.** The council never stages, commits, or pushes.
  It reads diffs and files; it writes to `docs/council/` only.
- **Blocking merge gating.** Council output is advisory. It is never wired into
  CI, merge queues, or any automatic gate. The user decides what to do with
  the verdicts.
- **Magic mode inference.** Bare `/council` with no mode argument prints help
  and exits. No attempt to infer intent from the input text.
- **Duplicating yellow-codex Codex invocation conventions.** When yellow-codex
  is installed, yellow-council reuses `codex-reviewer` via Task. No parallel
  Codex implementation inside yellow-council.
- **Pulling external CLI deps into yellow-core.** Yellow-core stays clean.
  All binary-dependent agents live in yellow-council.

---

## Attribution

GodModeSkill patterns referenced in this brainstorm are from
`99xAgency/GodModeSkill` at commit `b693d1da498cbcfc2e5cba1f85b3d341205bfeb0`,
licensed MIT. No code has been copied; this brainstorm borrows algorithmic
ideas and workflow patterns only. If implementation files later lift verbatim
code from `skill/work-converge` or `skill/work-pack-build`, add
`third_party/GodModeSkill.LICENSE` and per-file headers noting source repo,
original path, commit SHA, and modifications.
