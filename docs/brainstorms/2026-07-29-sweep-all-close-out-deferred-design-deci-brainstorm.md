# Sweep-All Close-Out: Deferred Design Decisions

**Date:** 2026-07-29
**Context:** Four design questions deliberately deferred out of the
yellow-plugins sweep-all close-out (PRs #670–#672, follow-up PR #676).
Each was small enough to combine into one brainstorm doc rather than
splitting into four.

## What We're Building

Four independent fixes/decisions, each scoped to a specific file and
behavior:

1. **devin-orchestrator cap-safety rework**
   (`plugins/yellow-devin/agents/workflow/devin-orchestrator.md`, ~lines
   66–80, plus `Cap:` line render sites at ~146 and ~162). Splits the
   current single "omit cap + disclose" behavior into two explicitly
   separate branches:
   - **Non-interactive branch:** the spawn prompt must explicitly declare
     non-interactive mode. If declared and no cap was given, omit
     `max_acu_limit` as a documented, deliberate default — no runtime
     "detection" of user absence (the current wording relies on an
     undetectable "no user available" signal that four reviewers flagged
     as having no way to actually fire).
   - **Interactive, invalid-input-twice branch:** when a user is present,
     picks `Other`, and fails cap validation twice, the agent must
     re-prompt once more with an explicit `Launch uncapped` option
     (distinct from a numeric-cap option) — the user must actively choose
     uncapped rather than fall into it by failing validation twice.
   - Both `Cap:` line render sites (currently
     `"none (max_acu_limit omitted — no user available)"` at lines 146
     and 162) need updating to reflect which branch actually produced the
     uncapped launch, since today's string is reused across both branches
     and is factually wrong on the interactive path.

2. **generate-manifests failure scoping** — **SUPERSEDED**, see
   `plans/sweep-670-672-deferred-design-decisions.md:25-29`: apply mode
   stays all-or-nothing atomic (no partial writes); only the *reporting*
   becomes per-plugin (result object + error output). The scoping
   description below is the brainstorm's original, since-revised framing —
   left for rationale context, not as the design to implement.
   (`scripts/generate-manifests.js`, target-assembly + write loops around
   lines 260–600). ~~Moves from abort-all (one plugin's
   validation/pollution error blocks regeneration of every plugin) to
   per-plugin scoping (unaffected plugins regenerate normally; only the
   polluted/invalid plugin's targets are held back)~~ — with an explicit
   safeguard: each plugin's validation result must be individually
   asserted/logged, never folded into one global success flag.

3. **Polish batch** — one dedicated PR bundling:
   - `<int>` placeholder cleanup — **8 files**, not 6: the canonical
     `plugins/yellow-review/commands/review/review-pr.md` plus its seven
     reviewer-agent mirrors under `plugins/yellow-review/agents/review/`
     (see `plans/sweep-670-672-deferred-design-decisions.md:32-34`)
   - the #667 plan's own deferred-P3 list (symlink helper dedup,
     `refDirBad` inlining, sibling-regex precompile)
   - error-message wording consistency in `generate-manifests.js`
   - (NOT included: "opencode rationale-comment dedup" — could not be
     confirmed; see Open Questions)

4. **Codacy MD041 changeset false positive** — a manual dashboard action
   (Codacy repo settings → ignored paths, add `.changeset/**`) plus a
   memory-doc update recording why the existing repo-file exclude
   (`.codacy/codacy.yaml`, added PR #560) never fixed this.

## Why This Approach

**Item 1 — separating the two branches instead of one shared behavior:**
The two paths that currently share "omit + disclose" have fundamentally
different risk profiles. The non-interactive path is a caller obligation
problem — `AskUserQuestion` cannot reliably signal "no user exists" at
runtime, so making the caller *declare* non-interactive mode (mirroring
the already-solved pattern in `compounder-m3-gate-non-interactive`) turns
an undetectable runtime inference into an explicit, auditable input. The
interactive path is a cost-safety problem — a user who is actively
engaged and fails validation twice should not silently end up paying for
an uncapped session; requiring one more explicit choice (`Launch
uncapped`) keeps the safety prompt meaningful without hard-blocking a
legitimate "I really do want no cap" case.

**Item 2 — per-plugin scoping with a mandatory per-plugin assertion:**
Verified directly in `scripts/generate-manifests.js:594` that current
abort-all behavior is already atomic (the `errors.length > 0` check
happens after all targets are assembled but before either write loop
runs — no partial writes from validation/pollution errors today; the
unrelated per-target try/catch inside the write loops handles I/O
failures separately and was not in scope here). The learnings pre-pass
surfaced a prior incident
(`docs/solutions/logic-errors/manifest-generator-value-shape-validation.md`)
where presence-only validation let a malformed value silently drop a
plugin from generated output with a clean "all files match" result.
Per-plugin scoping is chosen because unaffected plugins currently pay for
one plugin's foreign-content problem, but the design explicitly carries
forward that incident's lesson: scoping must not regress into a silent
per-plugin drop, so each plugin's result has to be individually
loud/logged rather than aggregated into a single pass/fail flag.

**Item 3 — bundle confirmed items, exclude the unconfirmed one:**
The `<int>` placeholders, the #667 deferred-P3 list, and the
generate-manifests wording items are all directly verifiable, low-risk,
and small enough that bundling avoids per-item PR overhead. The opencode
"rationale-comment dedup" item could not be confirmed by search (no
duplication found repo-wide; `opencode-reviewer.md:41,52` have two
separate "rationale" cross-references that are a plausible but unproven
referent) — recording it as resolved would be an unsupported claim, so it
is excluded from the batch and flagged as unresolved instead.

**Item 4 — dashboard fix over another repo-file attempt:**
Verified that `.codacy/codacy.yaml`'s `exclude_paths` already contains
`.changeset/**` (added PR #560, merged 2026-05-29) and that `markdownlint` isn't
even in that file's `tools:` list — combined with no `.github/workflows/*.yml`
invoking `.codacy/cli.sh`, this confirms the cloud GitHub App check (the
one that actually gates PRs) reads its tool/exclude configuration from
the Codacy dashboard, not this repo file. A third attempt at the
repo-file fix would repeat the same miss; the dashboard is the surface
that needs the change, and it requires manual action (no repo commit can
make it).

> **Correction (2026-07-30):** superseded during planning — the plan's
> Phase 4 research found a committed-file fix IS possible after all (a
> ROOT-level `.codacy.yml` is read by Codacy Cloud; the prior attempt
> used the wrong file). The fix shipped as PR #680; the dashboard route
> above is retained only as fallback.

## Key Decisions

- **devin-orchestrator, non-interactive path:** caller-declared
  non-interactive mode required in the spawn prompt; if declared and no
  cap given, omit `max_acu_limit` as a documented default. No runtime
  inference of user absence.
- **devin-orchestrator, invalid-input-twice path:** explicit confirm — a
  third prompt offering `Launch uncapped` as a distinct, actively-chosen
  option, not a fallthrough from repeated invalid input.
- **devin-orchestrator, `Cap:` line accuracy:** both render sites
  (~146, ~162) need to reflect which of the two branches produced the
  uncapped launch — the current shared "no user available" string is
  wrong on the interactive path and must not be reused verbatim once the
  branches diverge. This is a three-site edit (~80, ~146, ~162).
- **generate-manifests:** per-plugin failure scoping, replacing
  global abort-all — contingent on each plugin's validation result being
  individually asserted/logged (never folded into one aggregate
  success/failure flag), specifically to avoid recreating the silent
  per-plugin drop from `manifest-generator-value-shape-validation.md`.
- **Polish batch:** one dedicated PR now, covering the `<int>`
  placeholders, the #667 deferred-P3 list, and generate-manifests
  wording consistency. The opencode item is excluded pending
  confirmation (see Open Questions).
- **Codacy MD041:** fix via the Codacy dashboard's ignored-paths setting
  (manual action, not a repo change) plus a memory-doc update to
  `codacy-md041-changeset-false-positive` recording the local-CLI vs.
  cloud-check config split, so the repo-file fix isn't attempted a third
  time.
  > **Correction (2026-07-30):** superseded — see the correction at lines
  > 119-123. The fix shipped as a committed root `.codacy.yml` (PR #680),
  > not a dashboard change; the dashboard route above is retained only as
  > fallback. The memory-doc update to
  > `codacy-md041-changeset-false-positive` should record the root-file
  > fix, not a dashboard-only split.

## Open Questions

- **Opencode "rationale-comment dedup"** (item 3): could not be confirmed
  or refuted by search. If it turns out to be real, the plausible
  referent is the "Same rationale as…" cross-reference at
  `plugins/yellow-council/agents/review/opencode-reviewer.md:41`.
  Needs a closer manual read of that file (or the original review thread
  that raised it) before it can be scoped into a fix.
- **Exact wording for the divergent `Cap:` line strings** (item 1): the
  brainstorm establishes that the two branches need distinguishable
  disclosure text, but the precise strings (e.g., `"none (uncapped —
  non-interactive default)"` vs. `"none (launched uncapped by explicit
  user choice after invalid input)"`) are an implementation-plan-level
  detail, not decided here.
- **Per-plugin result reporting format for generate-manifests** (item 2):
  the decision requires "individually asserted/logged" results per
  plugin, but the concrete shape (e.g., a `results: { [plugin]: 'ok' |
  'error' }` map vs. per-plugin log lines vs. a summary table) is left to
  the implementation plan.
- **Codacy dashboard access**: item 4's fix requires whoever has Codacy
  repo-settings access to perform the manual ignored-paths change — this
  brainstorm records the decision and rationale but the action itself is
  outside repo tooling and outside this session's reach.
  > **Correction (2026-07-30):** moot — see the correction at lines
  > 119-123. The fix shipped as a committed root `.codacy.yml` (PR #680),
  > which needs only a normal repo commit, not Codacy dashboard access.
