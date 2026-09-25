# Feature: Durable Review-Findings Ledger for yellow-review

## Overview

`/review:pr` reports residual findings (P2/P3 `safe_auto`, `gated_auto`,
`manual`, simplifier output, the report-only queue) but never persists them, so
an unattended `/review:sweep-all` loses every one of them with the transcript
(PR #840: 10 residual findings, a P1 at confidence 100, none kept). This plan
implements the design locked in
`docs/brainstorms/2026-09-23-review-findings-ledger-brainstorm.md` (Approach A,
Key Decisions 1–6): an append-only JSONL ledger per PR under
`$(git rev-parse --git-common-dir)/yellow-review/findings/`, written by
`/review:pr` and `/review:all`, managed by a new `/review:triage`, surfaced by
the sweep summary and a SessionStart hook.

The brainstorm is the authority; this plan does not revisit its Key Decisions.
It adds the implementation contract (record schema, library API, re-verification
mechanics, `rule` vocabulary), resolves the six design questions deferred from
\#854 (CLAUDE-44…49), answers the brainstorm's Open Questions, and closes gaps
found during planning research.

Detail level: COMPREHENSIVE. Six stacked PRs; each ships its own tests, docs and
changeset.

## Problem Statement

### Current Pain Points

- Residual findings exist only in the chat transcript. `/review:resolve` only
  reads GitHub threads, so a sweep never touches them.
- Re-reviews re-raise findings that were already dismissed:
  `docs/solutions/code-quality/multi-agent-re-review-false-positive-patterns.md`
  measured 38% false positives when prior rationale isn't carried forward.
- Nothing tells the next session, or another worktree, that a PR has outstanding
  review work.

### User Impact

The operator runs attended and unattended reviews across several worktrees of
one clone. Findings must survive across sessions and worktrees, and must never
disappear silently: not on a revert, a restack, a force-push, a deletion, or a
crash mid-write.

## Linear Issues

- CLAUDE-44: Review ledger: dismissal depends_on paths must exist at the PR head
  (#858)
- CLAUDE-45: Review ledger: triage path allowlist rejects valid tracked
  filenames (#859)
- CLAUDE-46: Review ledger: distinguish repeated same-rule findings within one
  scope (#860)
- CLAUDE-47: Review ledger: safe triage path to restore an accidentally deleted
  file (#861)
- CLAUDE-48: Review ledger: re-verify at the current remote head before
  applied→fixed (#862)
- CLAUDE-49: Review ledger: verify scope ancestry at the finding anchor (#863)

## Proposed Solution

### High-Level Architecture

```text
review-pr.md / review-all.md ──(3d+) dismissed-context ──► reviewers
        │ (6) observations  (7) applied  (8) simplifier  (9) fix SHA → fixed
        ▼
lib/review-ledger.sh  (executable, subcommands, JSON on stdin/stdout)
        │  flock per PR · validate · redact · fingerprint · fold · sidecars
        ▼
$(git rev-parse --path-format=absolute --git-common-dir)/yellow-review/findings/
   <pr>.jsonl  <pr>.pending  <pr>.state  <pr>.lock  <pr>.closed  <pr>.jsonl.corrupt-<ts>
        ▲                          ▲                         ▲
/review:triage             sweep.md / sweep-all.md     hooks/scripts/session-start.sh
(attended | --non-interactive | --prune)   (Residual column, prune)   (cheap count)
```

### Decisions made in this plan

These are implementation decisions inside the locked design. The two marked
**(user)** were confirmed with the operator during planning.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Why                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | The library is one executable, `plugins/yellow-review/lib/review-ledger.sh <subcommand>`, invoked as `"${CLAUDE_PLUGIN_ROOT}/lib/review-ledger.sh"`, with JSON on stdin and stdout. It is not sourced by command prose.                                                                                                                                                                                                                                                      | Shell state doesn't survive between a command file's Bash calls; this matches `file-line-counts`. Bats tests source the file directly for unit coverage.                                                                                                  |
| P2  | **(user)** A missing `rule` or `scope` is defaulted to `unclassified` / `unscoped`, not dropped. Coverage reports "N findings defaulted — update yellow-core / yellow-codex". Other required-field violations still drop the whole return.                                                                                                                                                                                                                                   | yellow-core's `security-reviewer` and `performance-reviewer` are versioned separately. Dropping on skew would reproduce the silent loss this project exists to fix.                                                                                       |
| P3  | **(user)** The library sources `cs_redact_secrets` from `${CLAUDE_PLUGIN_ROOT}/../yellow-core/lib/compound-staging.sh`, and `catalog/plugins/yellow-review.json` gains a non-optional `yellow-core` dependency (yellow-debt precedent). If the file is missing at runtime, the library fails closed: it keeps hashes and line hints and withholds every model-authored string.                                                                                               | One pattern list and a declared dependency; a missing dependency never leaks a secret into `.git`.                                                                                                                                                        |
| P4  | `/review:all` gets full parity: the same dismissed-context read and all write points. Both `review-pr.md` and `review-all.md` read one new reference, `references/review-pr/ledger.md`.                                                                                                                                                                                                                                                                                      | `review-all.md` Step 4 inlines `review-pr.md` Steps 3a–9b and never calls `/review:pr`, so without parity it would reproduce the #840 loss. A shared reference also keeps `review-pr.md` (1056 lines, over the RULE 21 advisory limit) from growing much. |
| P5  | `<pr>.jsonl` grows only through a single-`printf` `>>` append under the per-PR `flock`. `cs_atomic_jsonl_write`-style tmp+`mv` is used only for the sidecars and for tail repair.                                                                                                                                                                                                                                                                                            | Keeps an append O(1). An O_APPEND single `write(2)` is not POSIX-atomic for files, so the lock is the real guarantee.                                                                                                                                     |
| P6  | No compaction. Fold cost grows linearly with the file; the hook reads only sidecars. Triage prints a notice when a ledger exceeds 2 MiB.                                                                                                                                                                                                                                                                                                                                     | Rewriting rows would contradict the locked "never rewrite finding records"; prune-on-close bounds the lifetime.                                                                                                                                           |
| P7  | Every line mapping, reproduction check and publication proof needs the objects to be present. Heads are fetched as `git fetch origin "pull/<pr>/head"` (this works for fork PRs), then `FETCH_HEAD` must equal `headRefOid`. A shallow repository (`git rev-parse --is-shallow-repository`) or a missing object makes the result `unverifiable`: the record keeps its state and the triage summary names it. `unverifiable` never counts as reproduced or as not reproduced. | Fail closed and keep failures distinguishable, so a fork or shallow clone never marks a fix published, and never marks a finding `stale`, by accident.                                                                                                    |
| P8  | Every ledger-derived string shown in a terminal (triage display, Step 10, sweep table) has C0/DEL/ANSI stripped at display time, separately from redaction and from prompt fencing.                                                                                                                                                                                                                                                                                          | Redaction and fencing don't neutralize escape sequences (`sweep-all.md` already strips titles this way).                                                                                                                                                  |
| P9  | `plugin-contract-reviewer`'s `breaking_change_class` / `migration_path` are persisted as optional observation fields (redacted, enum-validated).                                                                                                                                                                                                                                                                                                                             | Resolves Open Question 4. Losing the classification would degrade triage of contract findings; the fields are small.                                                                                                                                      |
| P10 | No `claude plugin eval` suite in this stack. Model-driven triage behaviour is covered by a manual checklist (Testing Strategy).                                                                                                                                                                                                                                                                                                                                              | Resolves Open Question 5. Evals are a follow-up once the deterministic core has shipped.                                                                                                                                                                  |
| P11 | `/review:pr`'s Step 10 gains one "Ledger" line: new, carried-over, reopened, pending and attention counts. Per-finding "carried" markers are out of scope.                                                                                                                                                                                                                                                                                                                   | Resolves Open Question 7 at minimal cost.                                                                                                                                                                                                                 |
| P12 | Scope is verified by one verifier, used at write time and at triage time (see CLAUDE-49).                                                                                                                                                                                                                                                                                                                                                                                    | Two independent scope checks could disagree with no code change.                                                                                                                                                                                          |

<!-- deepen-plan: codebase -->

> **Codebase:** P8 precedent, corrected: `sweep-all.md:98` does not strip
> control bytes. It keeps only `[A-Za-z0-9 #/:._\-]` and truncates to 60
> characters. P8's C0/DEL/ANSI strip is deliberately looser so that Unicode
> titles and paths (CLAUDE-45) survive display. Cite sweep-all as a whitelist
> precedent, not as the same rule.

<!-- /deepen-plan -->

### Resolutions of the deferred design questions (CLAUDE-44…49)

Each resolution names the stack stage that implements it and the test that pins
it. None is out of scope.

#### CLAUDE-44 — `depends_on` paths must exist at the PR head · Stages 1, 4

- **Decision.** The shared path validator has three modes (CLAUDE-45): `anchor`,
  `dependency` and `restore`. Only `anchor` may fall back to the base tree, and
  only for the primary anchor of a deletion finding. `dependency` resolves
  against `headRefOid` only and requires a regular-file mode
  (`100644`/`100755`). Each `depends_on` entry is stored as `{path, blob}`,
  where `blob` is `git rev-parse <headRefOid>:<path>`: the Git blob OID, never a
  hash of worktree bytes, so an uncommitted edit can neither satisfy nor break a
  dismissal.
- **Applicability.** A dismissal applies only while the anchor still matches
  and, for every entry, `<currentHead>:<path>` exists, is a regular file, and
  has the same blob OID. If any entry is missing, a symlink, or changed, the
  dismissal is inapplicable: `rl dismissed-context` leaves it out of the
  advisory block, and the next observation appends `reopened`.
- **Creation.** `/review:triage` refuses to record a dismissal whose
  `depends_on` path is absent at `headRefOid`, and tells the human to drop that
  path or keep the finding open.
- **Test** (`review-ledger.bats`). In a temp repo, the base has `lib/guard.sh`
  and `src/sink.sh`, and the finding on `sink.sh` is dismissed with
  `depends_on: [lib/guard.sh]`. Head H2 deletes `lib/guard.sh`. Then
  `rl dismissed-context` at H2 omits the finding, and re-observing it appends
  `reopened`, so pending increases by 1. Variants: guard modified (blob
  changes), and guard replaced by a symlink.

#### CLAUDE-45 — triage allowlist rejects valid tracked names · Stages 1, 4

- **Decision.** Drop the ASCII allowlist. One function,
  `rl_validate_path <mode> <rev> <path>`, is used by every writer,
  `/review:triage`, `dismissed-context` and restore. The same function means the
  same verdicts, and a Bats parity test enforces it. It rejects:
  - an empty path, or one longer than 4096 bytes;
  - invalid UTF-8;
  - any C0 byte or DEL (so no newline, tab or ESC);
  - a leading `/` or `-`;
  - empty, `.` or `..` segments, and a trailing `/`;
  - a path not found at `<rev>` (via
    `git --literal-pathspecs ls-tree -z --full-tree <rev> -- <path>` parsed
    NUL-safely, never the C-quoted default, with the returned name
    string-compared against the requested path so pathspec magic in a tracked
    name — e.g. `:(top)normal` — cannot select an unrelated entry or be rejected
    when the unrelated name is absent), or found with a mode other than
    `100644`/`100755` (`120000` symlinks and `160000` submodules are rejected
    before anything is dereferenced). This lookup is shared by all three modes
    (`anchor`, `dependency`, `restore`) — `--literal-pathspecs` and exact-name
    comparison are not restore-only.

  When the worktree is read (the gate passes), it also requires
  `test -f && ! test -L` on the entry and a `realpath` inside the canonical repo
  root.

- **Handling rules** (enforced by review, and by a Bats grep test over the
  library):
  - A path reaches a command only as its own argv element after `--`, or as a
    single `<sha>:<path>` argument.
  - JSON is built only with `jq --arg`.
  - The Read and Edit tools receive `<repo-root>/<path>` after validation.
  - Terminal display strips control bytes (P8).
- **Test.** Fixture paths `docs/My File.md`, `src/café.ts`, `notes/#1.md`,
  `a@b+c.txt` are accepted at write time and at triage time. `x\ny`, `-rf`,
  `../etc/passwd`, `/etc/passwd`, `a/./b`, `ESC[31m.md`, a tracked symlink, and
  an untracked `.env` are rejected by both. A
  `for each fixture: write-verdict == triage-verdict` loop pins the parity.

#### CLAUDE-46 — repeated same-rule findings in one scope · Stage 1

- **Decision.** Key a finding by its occurrence among identical anchors, only
  when there are several.
  - At observation time the library counts identical anchors (same
    normalized-line hash) inside the canonical scope. If there is more than one,
    the key gains `occ=<k>/<n>` (the 1-based ordinal in file order). With a
    single anchor the key is exactly the locked design's.
  - After minting, identity is resolved by line mapping, not by ordinal.
    `rl_map_line` maps each sibling's stored line hint from its recorded head to
    the target head through `git diff -U0` hunks.
  - A new observation joins the sibling whose mapped line is within ±3 lines of
    it.
  - The ordinal is used only when the recorded head object is unavailable (P7).
- **Invariants kept.**
  - The same defect raised by two reviewers has the same anchor, scope and
    mapped line, so the two merge.
  - A moved but unchanged line maps exactly, so it rematches.
- **Residual failure mode (accepted, documented).** When mapping is unavailable,
  fixing an earlier identical occurrence can make a later one inherit the
  earlier ID, which shows up as a false `reopened`. Over-reporting stays visible
  and never hides a defect.
- **Tests.**
  - Two identical `eval "$cmd"` lines in one function with the same rule produce
    two IDs. Fixing the first leaves the second pending under its own ID, and
    the fixed one stays fixed.
  - Three identical occurrences: fix occurrence 2, add a fourth later. IDs 1 and
    3 stay open, #2 is fixed, and the new occurrence mints a new ID.
  - The same defect from two reviewers still merges.

#### CLAUDE-47 — safe restore of an accidentally deleted file · Stage 4

- **Decision.** Add a "Restore file" action in attended `/review:triage`,
  offered only for a finding with `deletion: true`. It is never available in
  `--non-interactive`. Preconditions:
  1. The edit gate passes: HEAD SHA equals `headRefOid` and the tree is clean.
  2. `rl_validate_path restore <baseRefOid> <path>` passes. `restore` mode
     means: lexical rules as CLAUDE-45, with the tree lookup run as
     `git --literal-pathspecs ls-tree -z --full-tree <baseRefOid> -- <path>` and
     the result string-compared against the requested path, so a deleted
     filename that happens to be pathspec magic (e.g. `:(top)normal`) cannot
     select an unrelated blob; the source is `<baseRefOid>:<path>` (the current
     base, since that is the version the PR deletes) with mode
     `100644`/`100755`; the destination does not exist and is not a symlink
     (`! test -e && ! test -L`); and the nearest existing ancestor directory's
     `realpath` is inside the repo root. Missing parents are created with
     `mkdir -p -- <parent>` and then re-checked.
  3. The restore itself is
     `git --literal-pathspecs checkout <baseRefOid> -- <path>` — `--` alone only
     ends option parsing and does not stop Git from reinterpreting pathspec
     magic in `<path>`, so `--literal-pathspecs` is required at this step too,
     not just at validation. Git refuses to write through a symlinked leading
     directory. The file content is never model-authored.

  After restoring, the usual publication path runs: `applied`, then `applied`
  with the fix SHA, then `fixed` subject to CLAUDE-48.

- **Test.** End-to-end observe→restore (`review-ledger.bats`, task 1.11): a
  fixture where base has `lib/util.sh` and head deletes it. Feed a
  `deletion: true` finding through
  `observe --step 6 --head <headRefOid> --base <baseRefOid>`; assert the anchor
  snapshots from the base tree (not rejected), the observation carries
  `deletion: true`, and fold shows it pending. Then run the restore helper on
  that ledger record; assert restore writes the base blob byte-for-byte and
  `git diff --cached` shows the re-add. This path must not rely on a pre-seeded
  observation — `observe` is the entry point. Refused restore cases (unit tests
  against the helper directly):
  - the parent `lib` is a symlink to `/tmp/outside`;
  - the destination is a dangling symlink;
  - the base mode is `120000`;
  - the tree is dirty;
  - HEAD ≠ `headRefOid`.

#### CLAUDE-48 — re-verify at the current remote head before `applied→fixed` · Stages 1, 3, 4

- **Decision.** Moving to `fixed` needs a publication proof plus a
  `not_reproduced` re-verify at the freshly fetched current `headRefOid`. The
  proof is one of:
  1. the fix SHA is an ancestor of the remote head, or `git patch-id --stable`
     over a `-U0` diff (context-insensitive, so a restack that only touches
     surrounding lines still matches) finds it on the PR branch; or
  2. **fallback, whenever (1) fails** (`unproved` or `abandoned`): the
     `not_reproduced` re-verify result itself, per the brainstorm's
     authoritative fallback — a content check showing the finding no longer
     reproduces at the remote head proves publication exactly as an ancestor or
     patch-id match would. This widens the earlier rule, which applied the
     fallback only when the fix commit was unreachable from every local ref:
     local reachability says nothing about publication to the remote head (a
     restack leaves the old fix SHA on a stale local branch or tag while the
     rewritten fix is already published), so it no longer gates the fallback. It
     only separates `abandoned` from `unproved` when the re-verify reproduces.

  | Publication                                                          | Re-verify                                                                 | Action                                                                               |
  | -------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
  | proved (ancestor / patch-id)                                         | `not_reproduced`                                                          | `applied→fixed`, proof `ancestor` / `patch-id`                                       |
  | proved                                                               | reproduces (a later revert, or an additive fix above an unchanged anchor) | Stay `applied` for `/review:triage`: anchor-only re-verify cannot tell the two apart |
  | `unproved` or `abandoned`                                            | `not_reproduced`                                                          | `applied→fixed`, reason `unproved-content-check`, proof `content-check`              |
  | `abandoned` (unreachable from every local ref and the remote branch) | reproduces                                                                | `applied→reopened`, reason `fix-abandoned` — the defect itself is still there        |
  | `unproved` (still on some local ref)                                 | reproduces                                                                | Stay `applied`: the fix may not be published yet                                     |
  | any                                                                  | `unverifiable` (or publication `unverifiable`)                            | Stay `applied`                                                                       |

  A patch-id miss never reopens a finding by itself — the research below holds
  that it only delays `fixed`. `fix-abandoned` requires the re-verify to
  positively reproduce the defect; an unreachable fix commit whose defect no
  longer reproduces is the successful-restack case, not an abandoned one, and
  settles as `fixed` through the fallback instead — as does a fix commit still
  held by a stale local ref. The third and fourth rows are the trigger for the
  brainstorm's fallback-`fixed` and `applied→reopened` edges. This runs in
  `review-pr.md`/`review-all.md` Step 9 after submission, and in triage
  (attended and `--non-interactive`) for every `applied` record. A content check
  counts only when it evaluates the current remote head.

<!-- deepen-plan: external -->

> **Research:** **Patch-id false negatives.** `git patch-id --stable` hashes
> context lines. A restack that changes any of the 3 surrounding lines therefore
> produces a different ID, and squash-merges never match. Always pass `--stable`
> explicitly, because `--unstable` is the default and the two are incompatible.
> Hashing a `-U0` diff (`git diff-tree -p -U0 <c> | git patch-id --stable`)
> removes the context sensitivity, at some risk of false positives. Since
> CLAUDE-48 also requires re-verification at the current head, a patch-id miss
> only delays `fixed`; it never hides a defect. Sources: https://git-
> scm.com/docs/git-patch-id,
> https://github.com/git/git/blob/master/builtin/patch-id.c

<!-- /deepen-plan -->

- **Re-verify mechanics** (answers brainstorm Open Question 2). Given a target
  head:
  1. Map the line hint from the observation's recorded head.
  2. Test the anchor hash at the mapped line (±3 lines, whitespace normalized)
     within the verified scope.
  3. Only for findings without an occurrence key, do an alias search: same
     scope, a nearest match within ±40 lines.

  Anchor presence approximates the defect, not proves it: `rl_reverify_row`
  (`lib/review-ledger.sh`) hashes the line's text, so a fix that adds a guard
  above an unchanged sink still hashes to `reproduced`, and an edited or
  relocated line whose defect logic is untouched can still hash to
  `not_reproduced`. This one mechanical signal drives all three defect-based
  transitions that read it — `applied→fixed` (CLAUDE-48),
  `open|reopened|report_only→stale`, and the defect-based `stale→reopened` (task
  4.2) — none of them re-run the original rule, only the anchor text. Where the
  signal is ambiguous the design already favors no change over a forced
  transition: `unverifiable` never counts either way, and an `applied` record
  whose anchor merely reproduces is left `applied` rather than forced to
  `reopened` (`rl_settle_one`). Full condition re-verification, which would
  remove the ambiguity by re-running the original rule per finding, is an
  out-of-scope follow-up (see "Out of Scope"), not something this mechanical
  check does; a `reproduced` result here means "the reported line is unchanged,"
  not "the defect still fires," and `not_reproduced` means only "the reported
  line changed," not "the defect is gone."

  The outcome is `reproduced` (hit), `not_reproduced` (no hit), or
  `unverifiable` (P7).

- **Test.** Fix, then publish (the fake remote is a bare repo, with `gh` mocked
  for `headRefOid`), then revert and push. Triage appends `reopened` and never
  `fixed`, and pending increases by 1. Also: a fix that is published and still
  present becomes `fixed`, and a shallow clone leaves the record `applied` with
  a note. Also: a fix commit kept on a stray local branch, absent from the
  remote head, with no patch-id match and the defect gone settles `fixed` via
  `unproved-content-check`.

#### CLAUDE-49 — verify scope ancestry at the anchor · Stages 1, 2

- **Decision.** One verifier, `rl_verify_scope <file> <rev> <line> <claimed>`,
  used at write time (canonicalization) and in triage (P12):
  - **Markdown** (`*.md`, `*.mdx`): an awk heading-stack walk up to the anchor
    line. The claimed scope must equal the joined heading path, or its innermost
    heading when that heading is unique in the file.
  - **Code**: when `ctags` is universal-ctags and supports `--fields=+ne`, run
    `ctags --fields=+neKZ --output-format=json` on the blob, streamed to a temp
    file. Every dotted segment must be a tag whose `[line, end]` contains the
    anchor, nested in order. A bare innermost name expands to the full path only
    when it is unique.
  - **Otherwise**: when ctags is missing, has no parser for the language, lacks
    `end`, or times out after 2 s, the scope is `unscoped`.

  An `unscoped` fingerprint includes the line hint (locked rule), so two sites
  never merge, and line mapping keeps the ID across moves. Generic claims
  (`module`, `file`, `global`, `top-level`) are `unscoped`. The observation
  records `scope_status: verified|unscoped` and `scope_claimed` (redacted).

<!-- deepen-plan: codebase -->

> **Codebase:** universal-ctags is not installed in this environment, so the
> ctags path can't be exercised locally, and CI (ubuntu-latest) doesn't install
> it either. JSON and YAML have no nested-scope tags, so they always resolve to
> `unscoped`. Bash `end` detection is weaker than TypeScript/JavaScript. The
> `unscoped` fallback is therefore the path most runs will take, and the Bats
> suite must treat it as the primary case.

<!-- /deepen-plan -->

<!-- deepen-plan: external -->

> **Research:** **Risk for CLAUDE-49.** universal-ctags fills `end:` only for
> **Go and Python**. The Sh, TypeScript, JavaScript and Rust parsers never set
> it, and Sh tags functions with no scope at all. TypeScript tags
> `const f = () => {}` as kind `constant`, and object-literal methods are not
> tagged. JS object-literal methods do get `scope`/`scopeKind`
> (`handlers.createUser` works). So containment by `[line, end]` works for Go
> and Python only. For the other languages, the verifier should accept a claim
> only when a scope chain exists and the anchor sits between the tag's `line`
> and the next sibling tag's `line`. Otherwise treat it as `unverified` →
> `unscoped`. Always pass `--fields=+neZ`. ctags can't read source from stdin
> (only the experimental `--_interactive`), so write the blob to a temp file
> that keeps the original extension, or use `--language-force`. Sources:
> https://docs.ctags.io/en/latest/man/ctags.1.html,
> https://docs.ctags.io/en/latest/man/ctags-json-output.5.html, universal-ctags
> `Units/parser-{go,python,sh,typescript,javascript}.r` test expectations.

<!-- /deepen-plan -->

- **Test.** Two identical `createUser` bodies inside `admin` and `handlers`,
  split across two cases per the ctags research above: a JS fixture (object-
  literal methods) with ctags masked from PATH proves the `unscoped`, line-keyed
  fallback; a Python fixture (`Admin.create_user` / `Handlers.create_user`,
  where ctags fills `end:`) with real universal-ctags proves that swapping the
  claimed scopes still resolves each finding to its true enclosing scope,
  skipped with a reason when ctags is absent. A markdown variant uses two
  identical paragraphs under different headings. `/review:setup` reports whether
  universal-ctags is present (optional).

## Technical Specifications

### Ledger record schema (answers brainstorm Open Question 1)

Every line is one JSON object with `"v": 1`. There are two record types. The
fold goes **in file (append) order**, never by `at`, so clock skew can't reorder
states.

`observation` — one per finding per run:

```json
{
  "v": 1,
  "type": "observation",
  "finding_id": "<sha256 hex, fixed at first sight>",
  "fingerprint": "<sha256 of the key tuple at this observation>",
  "pr": 854,
  "head_sha": "<40-hex>",
  "base_sha": "<40-hex>",
  "at": "<UTC ISO-8601>",
  "run_id": "<uuid>",
  "source": "review-pr|review-all",
  "step": "6|8",
  "reviewers": ["correctness"],
  "severity": "P1",
  "category": "correctness",
  "category_raw": "logic",
  "rule": "wrong-condition",
  "scope": "handlers.createUser",
  "scope_claimed": "createUser",
  "scope_status": "verified|unscoped",
  "occ": null,
  "file": "src/h.ts",
  "line": 42,
  "deletion": false,
  "anchor_hash": "<sha256 of normalized anchor lines>",
  "anchor_lines": ["..."],
  "anchor_withheld": false,
  "anchor_source": "commit|worktree",
  "confidence": 75,
  "autofix_class": "gated_auto",
  "owner": "downstream-resolver",
  "requires_verification": true,
  "pre_existing": false,
  "title": "<redacted>",
  "suggested_fix": "<redacted or null>",
  "breaking_change_class": null,
  "migration_path": null
}
```

`transition` — a lifecycle change:

```json
{
  "v": 1,
  "type": "transition",
  "finding_id": "…",
  "state": "open|report_only|applied|fixed|dismissed|stale|reopened",
  "reason": "<redacted, ≤500 chars>",
  "head_sha": "…",
  "at": "…",
  "actor": "review-pr|review-all|triage|triage-noninteractive",
  "fix_sha": null,
  "published_head_sha": null,
  "proof": null,
  "depends_on": [{ "path": "lib/guard.sh", "blob": "<40-hex>" }]
}
```

Rules:

- A new `finding_id` is written as an `observation` immediately followed by a
  `transition` (`open`, or `report_only` for the report-only queue), as a single
  `printf` call writing both lines in one `write(2)` (`rl_append_pair` in
  `plugins/yellow-review/lib/review-ledger.sh`), so termination between the two
  records is the exception, not something every append risks.
  - Recovery for the residual case: fold only materializes a finding when both
    its `observation` and a transition exist (`RL_FOLD_JQ`'s
    `$f.obs[.] != null and $f.st[.] != null` filter), so an orphaned
    `observation` counts toward neither `pending` nor `attention` — it is
    invisible, not merged into. It is also invisible to exact-fingerprint
    matching, which only indexes folded findings, so the next `observe` run for
    that fingerprint cannot merge into the orphan; it mints the same
    `finding_id` again (fingerprint-derived, and unclaimed in the index) with a
    fresh observation + opening transition, which fold then reports as the
    current, complete state. No separate repair command is needed.
  - Planned test (`plugins/yellow-review/tests/review-ledger.bats`): hand-append
    an `observation` with no following `transition` to simulate termination
    between the two records; assert `rl fold` counts it in neither `pending` nor
    `attention`; then run `observe` again with a matching candidate and assert
    it reappears as `open` with one coherent history instead of a silently
    dropped finding.
- `anchor_source` records where the anchor was snapshotted: `commit` (the
  default, `head_sha`'s tree) or `worktree`
  (`observe --step 8 --anchor-source worktree`, task 3.4: the post-fix working
  tree, before the fix is committed). Re-verification maps a `commit` anchor's
  line from `head_sha` to the target head; a `worktree` anchor's line is already
  a post-fix coordinate, so it is tested in place rather than mapped as a
  coordinate in `head_sha` (which would mark shifted simplifier findings
  `stale`). A record without the field reads as `commit`.
- Fold result = the latest transition per `finding_id`.
  - pending = latest ∈ {`open`, `reopened`, `applied`}
  - attention = latest ∈ {`report_only`, `stale`}
- Key tuple: `file`, normalized `category`, `rule`, canonical `scope`,
  `anchor_hash`, plus `line` only when `scope_status=unscoped`, plus `occ` only
  when set (CLAUDE-46). `reviewers` and `title` are never keyed.
- Legal edges (enforced by `rl transition`; anything else is rejected with exit
  3):

  | From                              | To                                                                       |
  | --------------------------------- | ------------------------------------------------------------------------ |
  | `open`, `reopened`, `report_only` | `applied`, `dismissed`, `stale`                                          |
  | `applied`                         | `applied` (to add `fix_sha` / `published_head_sha`), `fixed`, `reopened` |
  | `stale`                           | `dismissed`, `reopened`                                                  |
  | `fixed`, `dismissed`              | `reopened`                                                               |

  There is no direct edge into `fixed` except from `applied`.

<!-- deepen-plan: codebase -->

> **Codebase:** No run-ID or UUID helper exists in the repo; `yellow-ci`'s
> `validate_run_id()` checks numeric GitHub Actions IDs, which is unrelated.
> `observe` has to mint its own `run_id`: `uuidgen`, then
> `/proc/sys/kernel/random/uuid`, then `od -An -tx1 -N16 /dev/urandom`. Add a
> `new-run-id` subcommand, or mint the ID when `--run-id` is omitted and echo it
> back.

<!-- /deepen-plan -->

<!-- deepen-plan: external -->

> **Research:** **PR head fetch race.** `git fetch origin pull/<n>/head` works
> for fork PRs and Graphite PRs, and the ref survives branch deletion. GitHub
> documents no update-latency bound, and community reports cite 1–3 minute lags.
> Compare `git ls-remote origin refs/pull/<n>/head` with `headRefOid`, retry
> with backoff (1, 2, 4, 8, 16 s), then check `FETCH_HEAD` and record the OID.
> Never use `refs/pull/<n>/merge`, which is asynchronous and can go stale.
> Sources: https://docs.github.com/en/pull-requests/collaborating-with-pull-
> requests/reviewing-changes-in-pull-requests/checking-out-pull-requests-
> locally, https://github.com/orgs/community/discussions/51962,
> https://github.com/orgs/community/discussions/136918

<!-- /deepen-plan -->

### Sidecars and files (per PR, mode 0600, dir 0700)

| File                      | Content                                                    | Writer                                       |
| ------------------------- | ---------------------------------------------------------- | -------------------------------------------- |
| `<pr>.jsonl`              | append-only records                                        | every writer, under lock (P5)                |
| `<pr>.pending`            | `<pending> <attention> <bytes>`                            | refreshed after every fold, tmp+`mv`         |
| `<pr>.state`              | `<OPEN\|MERGED\|CLOSED> <epoch>`                           | every writer after `gh pr view --json state` |
| `<pr>.lock`               | empty; stable-path `flock` target (never the JSONL itself) | —                                            |
| `<pr>.closed`             | tombstone, written by prune                                | `rl prune`                                   |
| `<pr>.jsonl.corrupt-<ts>` | quarantined unparseable tail                               | tail repair                                  |

`<pr>` must match `^[1-9][0-9]*$` before it touches any path. The ledger dir is
`$(git rev-parse --path-format=absolute --git-common-dir)/yellow-review/findings`.
When `--path-format` isn't supported, the fallback is
`cd "$(git rev-parse --git-common-dir)" && pwd -P`. It is created with
`umask 077`.

### Library API — `plugins/yellow-review/lib/review-ledger.sh`

Exit codes:

| Code | Meaning                         |
| ---- | ------------------------------- |
| 0    | ok                              |
| 2    | usage                           |
| 3    | validation / illegal transition |
| 4    | lock timeout                    |
| 5    | PR closed / tombstoned          |
| 6    | unverifiable (P7)               |

Diagnostics go to stderr with the prefix `[review-ledger]`.

| Subcommand                                                                                                               | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `observe <pr> --run-id <id> --step 6\|8 --head <sha> --base <sha> [--anchor-source commit\|worktree]`                    | stdin: the aggregated findings JSON array. `--anchor-source worktree` is accepted only with `--step 8` and HEAD equal to `--head`; it snapshots anchors from the working tree and persists `anchor_source: worktree` on each observation (default `commit`: the `--head` tree). Under lock it: repairs the tail; checks the tombstone and live state (reopen → drop the tombstone, fresh ledger); validates paths; verifies scope; computes occurrences and fingerprints; snapshots anchors; redacts; dedups (exact → alias/line-map); appends observations and new `open`/`report_only` transitions, or `reopened` for re-observed `fixed`, `stale` or inapplicable `dismissed`; skips re-adding an applicable `dismissed`; refreshes sidecars. stdout: `{new, merged, reopened, suppressed_dismissed, defaulted, rejected:[{ordinal, reason}]}`. Rejected paths are withheld (the ordinal only). |
| `transition <pr> <finding_id> <state> [--reason …] [--fix-sha …] [--published-head …] [--proof …] [--depends-on-json …]` | Validates the edge and appends.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `fold <pr>`                                                                                                              | Prints `{pending, attention, by_state, findings:[latest view]}`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `dismissed-context <pr> --head <sha>`                                                                                    | Applicable dismissals only (CLAUDE-44), as JSON; the command prose fences them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `reverify <pr> <finding_id> --head <sha>`                                                                                | Prints `reproduced` / `not_reproduced` / `unverifiable` (CLAUDE-48).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `publication <pr> <finding_id> --remote-head <sha>`                                                                      | Prints `proved:ancestor` / `proved:patch-id` / `unproved` / `abandoned` / `unverifiable`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `reconcile <pr> --head <sha> --base <sha>`                                                                               | Stage 4. The deterministic core of every triage mode: re-verify, publication, and the stale/reopen/fixed transitions (task 4.2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `validate-path <mode> <rev> <path>`                                                                                      | CLAUDE-45; also used by the triage prose.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `prune <pr>`                                                                                                             | Checks `gh pr view <pr> --json state`, and only if the state is MERGED or CLOSED: under lock, deletes `.jsonl/.pending/.state` and writes `.closed`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `record-state <pr>` / `summary [--all]`                                                                                  | State cache refresh; per-PR counts for sweep-all.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Internal helpers (Bats-tested): `rl_lock`, `rl_repair_tail`, `rl_redact`
(`cs_redact_secrets`, then the fail-closed pass from brainstorm stage 1:
env-style `*_KEY|_TOKEN|_SECRET|_ID|_PASSWORD=` assignments and long
high-entropy tokens → `[withheld: possible credential]`),
`rl_normalize_category`, `rl_validate_rule`, `rl_verify_scope`, `rl_occurrence`,
`rl_map_line`, `rl_fingerprint`, `rl_validate_path`.

Portability: the library needs `bash`, `jq`, `git ≥ 2.31`, `flock`, `realpath`,
`awk`, `sha256sum` or `shasum -a 256`, and optionally universal-ctags. It avoids
`head -n -1` and `sed -i`, and does tail repair with `wc -c`, then
`dd`/`head -c` into a temp file, then `mv`. It uses `flock -w 10` for writers
and `flock -s -w 1` for the hook, and closes fd 9 before spawning children that
might outlive it.

### Category mapping and `rule` vocabulary (brainstorm Key Decision 5)

The source of truth is `plugins/yellow-review/lib/review-ledger-vocab.json`.
`review-pr.md` injects it into every reviewer prompt as a `<rule-vocabulary>`
block, so persona files only gain the two schema fields. Any category not in the
map normalizes to `maintainability` and adds to the `category_unmapped` Coverage
count. A rule not in the list for its category becomes `unclassified` and adds
to the `rule_defaulted` count.

| Category        | Initial `rule` slugs (all categories also accept `unclassified`)                                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| correctness     | `logic-error`, `wrong-condition`, `off-by-one`, `null-handling`, `state-bug`, `wrong-error-path`, `race-condition`, `type-mismatch`, `unreachable-code`                       |
| security        | `missing-input-validation`, `injection`, `path-traversal`, `auth-bypass`, `credential-exposure`, `unfenced-untrusted-input`, `insecure-permissions`, `unsafe-deserialization` |
| reliability     | `missing-error-handling`, `swallowed-error`, `missing-timeout`, `unsafe-retry`, `resource-leak`, `non-atomic-write`, `missing-cleanup`                                        |
| performance     | `n-plus-one`, `unbounded-work`, `redundant-io`, `inefficient-algorithm`, `blocking-call`                                                                                      |
| maintainability | `dead-code`, `duplication`, `premature-abstraction`, `unclear-naming`, `excessive-complexity`, `tight-coupling`, `file-size`                                                  |
| docs            | `stale-doc`, `wrong-doc`, `missing-doc`, `broken-reference`, `count-drift`, `comment-rot`                                                                                     |
| testing         | `missing-test`, `weak-assertion`, `flaky-test`, `untested-edge-case`                                                                                                          |
| contract        | `breaking-rename`, `signature-change`, `removal`, `semantics-change`, `frontmatter-violation`, `schema-drift`                                                                 |

Measurement required by the brainstorm ("how often one defect lands in two
categories"): `fold` reports `category_split`, the number of `anchor_hash` +
`file` pairs that appear under more than one normalized category. Triage prints
it, and it is recorded after the first ten real reviews (Stage 6 checklist).

## Implementation Plan

Tasks are numbered by stack stage. Before submitting, each stage runs
`pnpm validate:agents`, `pnpm lint:plugins`, `pnpm validate:schemas` and
`bats plugins/yellow-review/tests/`, plus `bats plugins/yellow-core/tests/` when
yellow-core changes. Each stage carries its own changeset.

### Stage 1: Ledger library and schema

- [x] 1.1: Create `plugins/yellow-review/lib/review-ledger.sh`: LF endings,
      written via heredoc, `set -uo pipefail`, executable. Set up subcommand
      dispatch, exit codes and the stderr prefix from Technical Specifications.
- [x] 1.2: Resolve the ledger dir and validate the PR key. Add `rl_lock` (per-PR
      `<pr>.lock`, `flock -w 10`), `umask 077`, and single-`printf` appends
      (P5).
- [x] 1.3: `rl_repair_tail` runs under the lock before any append or fold. If
      the tail is valid JSON, it adds the missing final newline. Otherwise it
      quarantines the tail to `.corrupt-<ts>` and truncates to the last newline.
- [x] 1.4: `rl_validate_path` with `anchor|dependency|restore` modes (CLAUDE-44,
      45, 47), using NUL-safe `git ls-tree -z` and mode parsing.
- [x] 1.5: `rl_redact` sources yellow-core `compound-staging.sh`, guarded by
      `command -v cs_redact_secrets`, then runs the fail-closed pass. If the
      source is missing, it withholds everything (P3). A snapshot line that
      fails redaction keeps only its hash and line hint.

<!-- deepen-plan: codebase -->

> **Codebase:** `plugins/yellow-core/lib/compound-staging.sh` is safe to source.
> It has an idempotent guard (`_COMPOUND_STAGING_LOADED`, lines 25–28) and
> deliberately sets no shell options. `cs_redact_secrets` (line 116) reads stdin
> and writes stdout; it takes no argument. On internal failure it prints the
> literal `[REDACTED: sanitization failed]` and returns 1. `rl_redact` must
> treat a non-zero exit as "withhold" and must never persist that literal as
> redacted text.

<!-- /deepen-plan -->

- [x] 1.6: `review-ledger-vocab.json`, `rl_normalize_category` and
      `rl_validate_rule`.
- [x] 1.7: `rl_verify_scope` (CLAUDE-49): a markdown awk heading stack, a
      universal-ctags path with a 2 s timeout, and an `unscoped` fallback.
- [x] 1.8: `rl_map_line` (`git diff -U0` hunk arithmetic) and `rl_occurrence`
      (CLAUDE-46).

<!-- deepen-plan: external -->

> **Research:** **`rl_map_line` algorithm.** Parse `@@ -a[,b] +c[,d] @@` headers
> in order; an omitted count means 1. Keep `delta = 0` and walk the hunks. For a
> pure insertion (`b == 0`, meaning after old line `a`), return `L + delta` when
> `L <= a`. Otherwise, return `L + delta` when `L < a`; when `a <= L <= a+b-1`
> the line is changed, so return `anchored` (to new `c`), not a guess. After
> each hunk, add `d - b` to `delta`. Skip `\ No newline` lines, and treat binary
> files as unmapped. Renames: a pathspec filters both sides. Find the pair with
> `git diff --no-ext-diff --find-renames=50% --name-status -z A B` (no
> pathspec), then run `git diff -U0 A:old B:new`. Pin
> `--no-color --no-ext-diff --no-textconv --no-relative --src-prefix=a/ --dst-prefix=b/`
> and an explicit `--diff-algorithm`; never use `-w`/`-b`. Result model: `exact`
> / `shifted` / `anchored` / `unmapped`. Prior art: git `line-log.c`, Gerrit
> comment porting. Sources:
> https://www.gnu.org/software/diffutils/manual/html_node/Detailed-
> Unified.html, https://git-scm.com/docs/git-diff, https://gerrit-
> review.googlesource.com/Documentation/user-porting-comments.html

<!-- /deepen-plan -->

- [x] 1.9: `rl_fingerprint`, the `finding_id` mint, and the dedup cascade: exact
      match first, then an occurrence or line-map sibling, then an alias. An
      alias has the same file, category, rule and scope, with similarity ≥ 0.8
      on normalized lines within ±40 lines of the mapped hint.
- [x] 1.10: Subcommands `observe`, `transition` (edge table), `fold` (with
      `category_split`), `dismissed-context`, `reverify`, `publication`,
      `prune`, `record-state` and `summary`. Sidecars refresh via tmp+`mv`;
      tombstone and reopen handling.
- [x] 1.11: `plugins/yellow-review/tests/review-ledger.bats` plus
      `tests/helpers/ledger-repo.bash`. The helper builds a temp repo with a
      bare "origin" and reuses `tests/mocks/gh`, extended to answer
      `pr view --json state,headRefOid,baseRefOid`. The suite declares
      `bats_require_minimum_version 1.5.0` and runs background jobs with `3>&-`.
      Coverage:
  - PR-key rejection.
  - Concurrent writers: 10 background `observe`s, then every line parses and the
    counts are exact.
  - Tail repair, both cases.
  - The CLAUDE-44, 45, 46, 47, 48 and 49 tests above, including the
    observe→restore end-to-end for `deletion: true` findings (CLAUDE-47).
  - The locked fingerprint fixtures:
    - a different `rule` on the same statement stays separate;
    - the same `rule` from two reviewers merges;
    - two identical handlers stay separate;
    - a line that moves without a code change rematches.
  - Redaction: a planted `ghp_…`, a `DEVIN_ORG_ID=…`, and a PEM line in the
    anchor, which sets `anchor_withheld: true`.
  - Everything is withheld when yellow-core is missing.
  - Illegal transitions exit 3.
  - `observe --anchor-source worktree`: refused (exit 2) without `--step 8`,
    refused when HEAD ≠ `--head`, and persisted as `anchor_source: worktree`.
  - The fold's pending and attention definitions.
  - Tombstone refusal, and reopen.
  - Prune refuses an OPEN PR.

<!-- deepen-plan: codebase -->

> **Codebase:** `plugins/yellow-review/tests/helpers/` would be a new
> convention: no plugin in the repo has a `tests/helpers/` dir. `tests/mocks/gh`
> is a `case "$ALL_ARGS"` substring dispatcher backed by fixture files, so
> `pr view --json state,headRefOid,baseRefOid` is one more case branch.
> `skill- content.bats:10` already declares
> `bats_require_minimum_version 1.5.0`.

<!-- /deepen-plan -->

- [x] 1.12: Add the non-optional `yellow-core` dependency (P3) to
      `catalog/plugins/yellow-review.json`. Run `pnpm generate:manifests`, then
      refresh the characterization snapshot:
      `pnpm vitest run tests/integration/generate-manifests-characterization.test.ts -u`.

<!-- deepen-plan: codebase -->

> **Codebase:** Confirmed: `schemas/catalog-plugin.schema.json` accepts `hooks`
> (:46), `dependencies` (:53) and `targets.codex.includeHooks` (:134).
> `catalog/plugins/yellow-debt.json` has the `dependencies` entry shape
> (`name/version/optional/reason`), and `catalog/plugins/yellow-core.json:62-65`
> is the precedent for `codex.enabled: true` with `includeHooks: false`. No
> validator requires a README hooks section; that is convention only.

<!-- /deepen-plan -->

- [x] 1.13: Add a "Library" entry to `plugins/yellow-review/CLAUDE.md`; the
      library is internal and not user-facing yet. Also list the new
      non-optional `yellow-core` dependency under Prerequisites in
      `plugins/yellow-review/README.md`: each stage ships on its own, so the
      stage that adds a dependency discloses it. Changeset: `yellow-review`
      patch.

### Stage 2: `rule` and `scope` in compact-return producers

- [x] 2.1: Add `"rule"` and `"scope"` to the schema example of the 13 JSON
      producers:
  - yellow-review: `project-compliance-reviewer`, `correctness-reviewer`,
    `maintainability-reviewer`, `project-standards-reviewer`,
    `reliability-reviewer`, `adversarial-reviewer`, `plugin-contract-reviewer`,
    `cli-readiness-reviewer`, `agent-cli-readiness-reviewer`,
    `agent-native-reviewer`, `thermonuclear-reviewer`.
  - yellow-core: `security-reviewer`, `performance-reviewer`.

  Each file gains one sentence: pick `rule` from the injected
  `<rule-vocabulary>`, and set `scope` to the enclosing dotted symbol path or
  the nearest markdown heading.

<!-- deepen-plan: codebase -->

> **Codebase:** Census confirmed, with no missed producer. Each of the 13 files
> has a "Return findings as JSON matching the compact-return schema" example
> with `category` and no `rule` or `scope`. For example:
> `correctness- reviewer.md:106`, `project-standards-reviewer.md:168`,
> `agent-cli-readiness- reviewer.md:260`, and yellow-core
> `security-reviewer.md:137` and `performance- reviewer.md:115`. The
> legacy-prose five have no compact-return schema, and `codex-reviewer` goes
> through the findings-block branch at `review- pr.md:697-750`.

<!-- /deepen-plan -->

- [x] 2.2: `review-pr.md` changes:
  - Step 5 injects a `<rule-vocabulary>` block, built from
    `review-ledger-vocab.json`, into every reviewer prompt. It is repo-internal
    but still XML-escaped.
  - Step 5 "Compact-return enforcement" and Step 6.1 validation use the 12-field
    schema. A missing `rule` or `scope` is defaulted and counted (P2).
  - The Step 6.0 converter defaults to `rule: unclassified` and
    `scope: unscoped`. That covers the 11 legacy-prose agents and
    `codex-reviewer`.
  - Coverage gains two lines: "Findings defaulted (missing rule/scope)" and
    "Categories unmapped".
- [x] 2.3: Make the same edits in `review-all.md` Step 4 (the parity rule) and
      in the "Finding Output Format" section of
      `skills/pr-review-workflow/SKILL.md`.
- [x] 2.4: Leave Step 6.2's in-run dedup unchanged; its fingerprint is separate
      and in-memory. Document that the library computes the ledger fingerprint
      later.
- [x] 2.5: Tests: extend `skill-content.bats` to assert that every producer in
      the census lists `rule` and `scope`, and that the schema examples in
      `review-pr.md`, `review-all.md` and SKILL.md agree. Also find and update
      any fixture or test that pins the 10-field shape.
- [x] 2.6: Changesets: `yellow-review` patch and `yellow-core` patch.

### Stage 3: Persist findings from `/review:pr` and `/review:all`

- [x] 3.1: Create `plugins/yellow-review/references/review-pr/ledger.md`, the
      single procedure both commands read, just as they read
      `knowledge-compounding.md`. It defines the calls below. If the Read fails,
      stop and report the path rather than improvising.

  **Failure policy.** A library exit other than 0 logs
  `[review:pr] Warning: ledger <step> failed (exit N)` and adds "Ledger: write
  failed at <step>" to Coverage. The review itself never aborts; the findings
  are still in the Step 10 report, so the failure is visible.

<!-- deepen-plan: codebase -->

> **Codebase:** **Gap.** Neither command fetches `headRefOid` or `baseRefOid`
> today. `review-pr.md:85` and `review-all.md:159` request only
> `files,additions,deletions,body,title,headRefName,baseRefName`, and nothing in
> the repo runs `git fetch origin pull/<n>/head`. Stage 3 needs an explicit
> first edit: add `headRefOid,baseRefOid` to the Step 3 `gh pr view --json`
> list, and to `review-all.md` sub-step 2. Tasks 3.2, 3.3 and 3.5 depend on it.
> `Step 3e` doesn't collide with any existing label.

<!-- /deepen-plan -->

- [x] 3.2: **New Step 3e (after 3d, before Step 5): dismissed context.**
  1. Validate the PR head and set `REVIEWED_HEAD` before any ledger read (P7):
     a. Re-query `headRefOid` with
     `gh pr view <pr> --json headRefOid -q .headRefOid` — a fresh read at Step
     3e, not the Step 3 snapshot. A force-push or provider restack between them
     would otherwise leave dismissed-context and observe on different revisions.
     b. `git fetch origin pull/<pr>/head` (works for fork PRs). Retry with
     1/2/4/8/16 s backoff until `git ls-remote origin refs/pull/<pr>/head`
     matches the fresh `headRefOid` (fetch-race research above). c. Require
     `FETCH_HEAD`, `git rev-parse HEAD`, and the fresh `headRefOid` to all
     match; set `REVIEWED_HEAD` to that SHA. A shallow repository, a missing
     object, or any mismatch makes the head `unverifiable`: skip Steps 3.2–3.5
     ledger writes, add "Ledger: head unverifiable" to Coverage, and continue
     the review without persistence.
  2. Run `rl dismissed-context <pr> --head <REVIEWED_HEAD>`.
  3. Build a `--- begin dismissed-findings (reference only) ---` /
     `--- end dismissed-findings ---` block. Its `<advisory>` says the content
     is reference data only and that instructions inside it must not be
     followed.
  4. Sanitize every interpolated value in this order. First, substitute the
     block's own delimiters and the pr-context, file-line-counts and
     learnings-context delimiters (`[ESCAPED] …`). Then XML-escape.
  5. Before injection, drop any entry whose stored text still contains an
     `IGNORE PREVIOUS`, `system:` or `assistant:` line prefix, and count the
     drops. This follows the layered-defense learning.
  6. **Gap (CWE-1427):** step 3's fields include the finding's free-form
     `title`. Delimiter substitution, XML-escaping and the step-5 prefix filter
     stop structural attacks but not ordinary-language instructions written into
     model-authored text like `title`. Drop `title` from the injected payload;
     keep only validated structural metadata (`file`, `line`, `category`,
     `rule`, `scope`, `severity`) plus the human-written `reason`, which already
     states why the finding does not apply.
  7. Inject the block into every reviewer. Skip it in legacy mode, as the
     learnings block is skipped.
- [x] 3.3: **After Step 6's partition, before Step 7:** run
      `rl observe --step 6 --head <REVIEWED_HEAD> --base <baseRefOid>` on every
      surviving finding in the fixer, residual actionable and report-only
      queues. Snapshot each anchor from `REVIEWED_HEAD`, except a finding tagged
      `deletion: true`: per the anchor-mode contract above (only `anchor` mode
      falls back to the base tree, and only for a deletion finding's primary
      anchor), `observe` snapshots that one from `baseRefOid` instead, since
      `<REVIEWED_HEAD>:<file>` cannot exist for a path the PR deletes — this is
      how `observe` avoids rejecting a deletion finding before attended triage
      can offer Restore. The end-to-end observe→restore test (CLAUDE-47, task
      1.11) must carry a deletion finding through `observe` into restore, not
      only a pre-seeded record fed straight to `restore`. Findings with
      `pre_existing: true` and findings the confidence gate suppressed are not
      persisted, because they were never reported as this PR's work.
- [x] 3.4: **Step 7:** after each applied fix, run `rl transition … applied`.
      **Step 8:** run `rl observe --step 8 --anchor-source worktree` on the
      simplifier's findings, keeping `--head` at the pre-commit `REVIEWED_HEAD`
      (`observe` requires `git rev-parse HEAD == --head`, which still holds
      because Step 9 hasn't committed yet). Each finding is tagged
      `anchor_source: worktree`, and re-verification (`rl_reverify_row` in
      `review-ledger.sh`) skips the head-to-target line remap for that tag and
      uses the stored line as-is, so a worktree line is never misread against
      `REVIEWED_HEAD`. Every path must still be tracked at `REVIEWED_HEAD`; a
      finding in a file the fixer just created is rejected (counted under
      `rejected`, not persisted) rather than deferred — accept this as a known
      gap, not something to fix here.

      **Gap:** nothing currently rebases these `anchor_source: worktree`
      findings once Step 9 commits the fix. `rl_reverify_row` skips the
      head-to-target remap for that tag and instead re-probes only ±3 lines
      around the stored line number in the target tree; once a later
      commit or restack inserts enough lines above an otherwise-unchanged
      finding — or any smaller shift for an occurrence-keyed finding, which
      has no alias search — the probe misses and reconciliation mis-marks
      it `stale`. Fix: once Step 9's fix commit exists, run `rl observe`
      again for every `anchor_source: worktree` finding, anchored to that
      commit/tree in place of the worktree coordinate (this needs `observe`
      to accept a post-commit step, alongside its current `--step 6|8`), so
      later reconciliation maps its line the normal way.

- [x] 3.5: **Step 9:**
  1. Once the commit exists, record `applied --fix-sha <sha>` for each applied
     finding.
  2. Once provider submission reports success, run `rl remote-head <pr>` rather
     than a raw `git fetch` compared against the pre-fix `headRefOid`:
     submission moves the PR head, so comparing `FETCH_HEAD` to the value
     captured in Step 3 would reject every successful publication. `remote-head`
     re-reads `headRefOid` from `gh pr view` at call time and retries the fetch
     with backoff until it matches (`review-ledger.sh`'s `cmd_remote_head`).
     Record the printed OID with `applied --published-head <sha>`.
  3. Run `rl publication`, then `rl reverify` at that head, then append `fixed`
     or `reopened` (CLAUDE-48).
  4. If the push is declined or fails, append nothing more. The records stay
     `applied` and count as pending.

  The Graphite and GitHub provider paths make the same calls.

- [x] 3.6: **Step 10:** add the "Ledger" line (P11). Coverage also reports write
      failures, and the dismissed entries injected and filtered.
- [x] 3.7: Mirror 3.2–3.6 in the inlined sub-steps of `review-all.md` Step 4
      (P4), with a parity comment that points at `ledger.md`.

<!-- deepen-plan: codebase -->

> **Codebase:** `review-all.md` has no "Step 9" heading. Its Step 4 sub-steps
> mirror `review-pr.md` as follows: 5 = Step 3d (insert 3e after it), 7 = Step
> 5, 8 = Step 6, 9 = Step 7, 10 = Step 8, 11 = the commit+submit path
> (`review- all.md:275-311`, where the Step 9 ledger calls go), and 14 = Steps
> 9a/9b. Task 3.7 should name these sub-steps.

<!-- /deepen-plan -->

- [x] 3.8: `commands/review/setup.md`: required checks for `flock`, `realpath`,
      `jq`, git ≥ 2.31 and yellow-core's `compound-staging.sh`; an optional
      check for universal-ctags ("scope verification degrades to unscoped"). Add
      a macOS install hint: `brew install flock coreutils universal-ctags`.
- [x] 3.9: Tests:
  - `skill-content.bats` asserts that both commands reference `ledger.md` at
    Steps 3e, 6, 7, 8 and 9, and that the dismissed-findings fence substitutes
    every delimiter.
  - `review-ledger.bats` adds a scripted end-to-end run against the bare-origin
    fixture: observe (step 6), applied, observe (step 8), fix-sha, published,
    fixed.
- [x] 3.10: Update the README and `plugins/yellow-review/CLAUDE.md` with
      `/review:pr` persistence, the ledger's location and lifecycle states, and
      the new prerequisites. Document the ledger trust boundary this stage
      activates in `docs/security.md` (Trust Boundaries): model-derived review
      data stored under `$(git rev-parse --git-common-dir)/yellow-review/` (dir
      0700, files 0600, shared by every worktree of the clone, never pushed);
      redaction before anything is persisted (`cs_redact_secrets` plus the
      fail-closed pass, everything withheld without yellow-core); and
      dismissed-finding context re-injected into later reviewer prompts inside a
      delimiter-substituted reference-only fence. Stage 6 adds only the hook
      row. Changeset: `yellow-review` minor.

### Stage 4: `/review:triage`

- [ ] 4.1: Create `plugins/yellow-review/commands/review/triage.md` with
      `name: review:triage`, a single-line description, and `allowed-tools`
      Bash/Read/Edit/AskUserQuestion/Skill. Usage:
      `[PR# | URL | branch] [--non-interactive]` or `--prune <pr>`. An unknown
      flag is an error, as in `review-pr.md` Step 1.
- [ ] 4.2: Add the library subcommand
      `reconcile <pr> --head <sha> --base <sha>`. It is the deterministic core
      of every triage mode, which makes `--non-interactive` fully Bats-testable.
      For each finding, by latest state:
  - `applied`: check publication and reverify. The result is `fixed`,
    `reopened`, or no change (CLAUDE-48).
  - `open`, `reopened`, `report_only`: reverify. `not_reproduced` → `stale`.
  - `stale`: `reproduced` → `reopened`.
  - `unverifiable`: no transition; the finding is listed.
  - A local-HEAD mismatch never marks an `applied` finding `stale` (locked).

  Deletion findings (`deletion: true`) are an exception to the generic
  `not_reproduced → stale` edge above: the head deliberately has no file for the
  anchor to match, so reconcile re-verifies them with a base-anchor check
  instead (the brainstorm's current-base rule). While the path still exists at
  `baseRefOid` and is still absent, or not a regular file, at the head, the
  result is `reproduced` — never `stale` — so the Restore action (task 4.4)
  stays available. Only a regular file back at the head gives `not_reproduced`.
  If the base itself lacks the path, the finding becomes `dismissed` with reason
  `retired: base deleted path`. If the base tree lookup itself fails (a partial
  clone whose promisor remote is offline), the finding is `unverifiable` and
  unchanged. Test: "reconcile: a deletion finding retires when the base itself
  deleted the path" (base still has the path → no transition; base deletes it
  too → `dismissed`), with the observe → restore end-to-end in task 1.11.

- [ ] 4.3: Triage flow:
  1. Resolve the PR with
     `gh pr view --json number,state,headRefName,headRefOid,baseRefOid,isCrossRepository`.
  2. If the state is MERGED or CLOSED, never prune implicitly.
     `--non-interactive` prints `Ledger: retained (PR <state>)` and stops, so an
     unattended caller that raced a PR closing (sweep's Step 3b) can never
     delete a ledger. Attended triage asks one AskUserQuestion ("Delete the
     ledger for closed PR #N?"); only a yes runs `rl prune`, and either way it
     stops. Retained ledgers are cleaned up by `/review:sweep-all`'s confirmed
     prune step or an explicit `/review:triage --prune <PR#>`.
  3. Fetch `pull/<pr>/head` (P7).
  4. Edit gate: `git rev-parse HEAD` must equal `headRefOid`, and
     `git status --porcelain` must be empty. Otherwise, run read-only.
  5. Run `rl reconcile`.
  6. If the ledger is over 2 MiB, print a notice (P6).
  7. `--non-interactive` stops here and prints its summary.
- [ ] 4.4: The attended loop mirrors `/debt:triage`. A pre-loop AskUserQuestion
      shows the pending and attention counts and offers "review each" or
      "approve all proposed fixes". Then, in severity order, each finding gets a
      display-stripped (P8) card with the proposed change. Its stored fields sit
      inside a `--- begin ledger-finding (reference only) ---` fence, with
      delimiter substitution and XML escaping. The options are:
  - **Apply**: requires the edit gate. If the gate fails, offer to check the PR
    out through the stack-provider router, or refuse.
  - **Dismiss**: offered only when the finding's current state has a legal
    `dismissed` edge (`open`, `reopened`, `report_only`, `stale`), matching the
    ledger's transition table (`rl_edge_ok` in `lib/review-ledger.sh`). An
    `applied` finding has no `applied → dismissed` edge; it must resolve to
    `fixed` or `reopened` on a later reconcile before it can be dismissed.
    Otherwise, asks for a reason and `depends_on` paths, which are validated in
    `dependency` mode at the head (CLAUDE-44).
  - **Restore file**: only for findings with `deletion: true` (CLAUDE-47) whose
    current state has a legal `applied` edge (`open`, `reopened`,
    `report_only`). `stale` has no direct `stale → applied` edge, so a stale
    deletion finding must reopen on a later reconcile before it can be restored.
  - **Skip** and **Stop**.

  A human may fix or dismiss a `report_only` finding, but it is never
  auto-applicable. After edits, commit and submit through
  `stack-provider-router` exactly as `review-pr.md` Step 9 does, push
  confirmation included, then follow the same publication contract.

- [ ] 4.5: Tests:
  - `review-ledger.bats` gains the `reconcile` matrix:
    - fix, then revert (CLAUDE-48);
    - an unreachable fix commit whose defect still reproduces gives `reopened`
      with reason `fix-abandoned`; a restacked fix whose defect no longer
      reproduces settles `fixed` via `unproved-content-check`;
    - a shallow clone gives unverifiable;
    - a fork-style PR head fetched from `pull/<n>/head` in the fixture origin;
    - retirement when the base deleted the path;
    - `stale` → `reopened` on a rematch.
  - The CLAUDE-47 refused-restore cases and the dependency-mode dismissal tests
    (CLAUDE-44) call `validate-path` and the restore helper directly; the
    happy-path observe→restore flow is covered in Stage 1 (task 1.11).
  - `skill-content.bats` asserts triage.md's fence and gate text, that the
    `--non-interactive` path never reaches prune for a MERGED/CLOSED PR, and
    that the attended prune sits behind its AskUserQuestion.
- [ ] 4.6: README and CLAUDE.md: the command list, a "When to Use What" entry,
      and the triage modes. Update root `README.md`'s yellow-review command
      count/inventory for `/review:triage` (AGENTS.md's Documentation
      Expectations). Changeset: `yellow-review` minor.

### Stage 5: Sweep integration

- [ ] 5.1: `sweep.md` gains Step 3b between Step 3 (`/review:resolve`) and Step
      4 (final summary): `/review:triage <pr> --non-interactive`, run every
      time. It applies nothing and costs little, and it is skipped when the PR
      is no longer OPEN; if the PR closes between that check and triage,
      `--non-interactive` triage retains the ledger (task 4.3) rather than
      pruning it. Step 4 reads `rl summary` and gains the line "Ledger:
      <pending> pending, <attention> need attention".
- [ ] 5.2: `sweep-all.md`:
  - The Step 5 table gains a `Residual` column showing `<pending>/<attention>`
    from `rl summary`. It shows `—` when there is no ledger and `?` when the
    library fails.
  - New Step 2b reconciles pruning. It runs
    `gh pr list --state open --limit 1000 --json number`, covering all authors
    and drafts; this is separate from the `--author @me` sweep list. If the call
    fails or returns 1000 rows (the list may be truncated), the step is skipped
    entirely. For each `findings/<pr>.jsonl` whose PR is not in the list, it
    calls `/review:triage --prune <pr>`, which re-checks the state before
    deleting anything.
- [ ] 5.3: Tests: `skill-content.bats` assertions for the new steps and the
      truncation guard. Update the sweep descriptions in the README and
      CLAUDE.md. Changeset: `yellow-review` patch.

### Stage 6: SessionStart hook and final docs

- [ ] 6.1: In `catalog/plugins/yellow-review.json`, add `hooks.SessionStart`
      with `matcher: "*"`, the command
      `bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/session-start.sh"` and
      `"timeout": 3`, and set `targets.codex.includeHooks: false`. The generator
      has no Cursor hook path, so Cursor needs nothing. Run
      `pnpm generate:manifests`, then `pnpm validate:generated`, then refresh
      the snapshot.
- [ ] 6.2: Write `plugins/yellow-review/hooks/scripts/session-start.sh` via
      heredoc with LF endings, in the yellow-debt shape: `set -uo pipefail`,
      always emit `{"continue": true}`, don't read stdin, build the message with
      `jq -n`. Time budget: `git -C "$CLAUDE_PROJECT_DIR" rev-parse` and the
      `*.jsonl` glob run first and stay near 0. The rest shares a single
      deadline (`DEADLINE_MS`, 2.3 s — 0.7 s shy of the 3 s catalog timeout)
      instead of per-phase caps, because independent per-PR budgets (e.g. a 0.2
      s lock wait times several ledgers) can sum past the hook's timeout and get
      the whole output discarded. Each PR's `flock -s -w 0.2` wait and its
      fallback fold (`FOLD_BUDGET_MS`, 1.5 s, shared across all PRs) are both
      bounded by the time remaining until `DEADLINE_MS`; a PR whose lock or fold
      would cross the deadline is reported "pending unknown" instead of waiting.

  Rules:
  - Ignore a sidecar whose `.jsonl` no longer exists.
  - Count a sidecar only when `.state` is `OPEN` and less than 7 days old.
    Otherwise, name the PR as unverified.
  - If the sidecar is missing or its byte size doesn't match, run the fallback
    fold within budget or report "pending unknown".
  - Emit a `systemMessage` only when pending + attention > 0, or when any PR is
    unverified or unknown:
    `[yellow-review] Review ledger: N pending, M need attention (PRs #a, #b); unverified: #c. Run /review:triage <pr>.`
  - The output holds only integers and PR numbers, never ledger text.

<!-- deepen-plan: external -->

> **Research:** **SessionStart output semantics.** On a synchronous hook,
> `systemMessage` is shown to the user only, and Claude does not see it.
> `hookSpecificOutput.additionalContext` (and plain stdout) goes to Claude. If
> Claude should be able to act on the counts, emit both, keeping
> `additionalContext` factual and not phrased as instructions. A hook that times
> out is cancelled and its output discarded; the session continues, but Claude's
> first reply waits for SessionStart hooks, so the explicit `timeout: 3`
> matters. All matching hooks run in parallel. `"*"` is a valid match-all
> matcher (values: `startup`, `resume`, `clear`, `compact`, `fork`). Output
> fields are capped at 10,000 characters. Source:
> https://code.claude.com/docs/en/hooks

<!-- /deepen-plan -->

- [ ] 6.3: `plugins/yellow-review/tests/session-start.bats` covers:
  - no repo or no dir → bare continue;
  - the counts;
  - fixed and dismissed records don't count, even though the append-only file is
    non-empty;
  - an orphan sidecar is ignored;
  - a stale `.state` → unverified;
  - a size mismatch → fallback fold;
  - a lock held by a background writer → "pending unknown" within budget;
  - a malformed sidecar → unknown;
  - the output is valid JSON (`run --separate-stderr`, `jq -e`).
- [ ] 6.4: Docs:
  - `docs/architecture-overview.md`: add a `yellow-review` row to the
    SessionStart table.
  - `docs/security.md`: add a `yellow-review` row to the SessionStart hooks
    table, documenting the new hook's trust boundary (reads ledger state from
    the shared Git directory, emits only integers and PR numbers).
  - `plugins/yellow-review/CLAUDE.md`: replace "the plugin ships no hooks" in
    the Codex section; add Hooks and Testing entries.
  - README: add a "Review ledger" section covering the lifecycle states, where
    the ledger lives, prerequisites, the hook message, and the trade-offs
    (single machine only; lost with the clone).

<!-- deepen-plan: codebase -->

> **Codebase:** Confirmed targets: the "the plugin ships no hooks" sentence is
> at `plugins/yellow-review/CLAUDE.md:266`. `docs/architecture-overview.md:416`
> documents the SessionStart I/O contract (`{"continue": true}` plus an optional
> `systemMessage`, and no `set -e`), and the table is at `:431`.

<!-- /deepen-plan -->

- [ ] 6.5: Manual check in a real Claude Code session, per AGENTS.md, recorded
      in the PR body. Install from the worktree, seed a ledger by running
      `/review:pr` on a scratch PR, start a new session, and confirm the message
      appears. After the first reviews, record the `category_split` value (the
      measurement the brainstorm asks for).
- [ ] 6.6: Changeset: `yellow-review` minor.

## Testing Strategy

- **Unit / behavioural (Bats, required CI job
  `bats plugins/yellow-review/tests/` on ubuntu-latest, where flock and realpath
  exist):** `review-ledger.bats` (Stages 1, 3, 4), `session-start.bats` (Stage
  6), and `skill-content.bats` (prose contracts). Fixtures build throwaway repos
  under `$BATS_TEST_TMPDIR`, with a bare origin and `pull/<n>/head` refs, and
  the existing `tests/mocks/gh`. ctags-dependent cases
  `skip "universal-ctags not installed"`, and the `unscoped` fallback is always
  tested.
- **Generator:** the characterization snapshot (Stages 1, 6) and
  `pnpm validate:generated`.
- **Manual checklist (model-driven parts, P10):**
  1. Attended triage on a PR with one of each state: approve one fix, dismiss
     one with `depends_on`, restore one deleted file, and skip one.
  2. `/review:sweep` on a PR with residual findings: the ledger survives and the
     Residual column is right.
  3. Revert a published fix: the next triage reopens it.
  4. `/review:pr` on a PR with a dismissed finding: reviewers don't re-raise it,
     and do re-raise it after its guard file changes.

## Acceptance Criteria

1. An unattended `/review:sweep-all` persists every residual finding (P2/P3
   `safe_auto`, `gated_auto`, `manual`, simplifier, and report-only including P0
   `human`) to the PR's ledger. Verified by the Stage 3 end-to-end Bats run and
   manual check 2.
2. `/review:all` persists identically to `/review:pr` (Stage 3 parity
   assertions).
3. Nothing leaves the pending or attention sets without a recorded transition.
   `stale`, `unverifiable` and reopen paths stay visible (reconcile matrix).
4. All six deferred issues have their tests passing: CLAUDE-44, 45, 46, 47,
   48, 49.
5. No secret shapes from the planted fixtures appear anywhere under the ledger
   dir, and with yellow-core missing the ledger holds no model-authored text
   (redaction tests).
6. The hook finishes in < 3 s with a held lock and a 5 MB ledger, and always
   emits valid JSON (hook tests).
7. A reviewer return that lacks `rule`/`scope` is kept and counted, not dropped
   (Stage 2 tests).
8. The CI gate is green on every stack PR, and each PR carries a changeset.

## Edge Cases & Error Handling

| Case                                          | Handling                                                                                                                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interrupted append / crash                    | Tail repair on the next locked operation (Stage 1.3)                                                                                                                   |
| Concurrent sweeps on one PR                   | Per-PR `flock -w 10`; timeout gives exit 4 → Coverage warning, review continues                                                                                        |
| Force-push / restack between write and triage | Line mapping from the recorded head if that object is present; otherwise the ordinal/alias fallback; `applied` uses patch-id and the content check at the current head |
| Fork PR                                       | Fetch `pull/<pr>/head` from origin; mismatch with `headRefOid` → unverifiable                                                                                          |
| Shallow clone / missing objects               | `unverifiable`, never `stale` or `fixed` (P7)                                                                                                                          |
| PR closed while a review runs                 | Writer re-checks state under the lock; tombstone refuses (exit 5)                                                                                                      |
| PR reopened                                   | Tombstone removed under the lock; fresh ledger                                                                                                                         |
| Detached HEAD                                 | Gate compares SHAs, not branch names                                                                                                                                   |
| Dirty tree in non-interactive triage          | Read-only reconcile against the fetched head; never edits                                                                                                              |
| yellow-core absent                            | Redaction fails closed (P3); `/review:setup` reports it                                                                                                                |
| ctags absent / slow                           | `unscoped` (line-keyed), 2 s cap per file                                                                                                                              |
| Huge ledger                                   | Notice at 2 MiB; the hook relies on sidecars (P6)                                                                                                                      |
| Model-authored path with control bytes        | Rejected at write (CLAUDE-45); never displayed raw (P8)                                                                                                                |

## Security Considerations

- **Untrusted channels:** every stored string comes from model output over PR
  content. They are:
  - redacted before any write;
  - fenced, with delimiter substitution and XML escaping, before re-entry into
    any prompt;
  - control-stripped before terminal display;
  - filtered for injection markers before the dismissed-context injection.
- **Paths:** one validator with three modes; argv-only after `--`; JSON via
  `jq --arg`; the Git tree mode is checked before any dereference; `realpath`
  containment for worktree reads, and parent containment for restore.
- **Storage:** mode 0700/0600 under `.git`. No GitHub-visible output (locked
  decision 4). Nothing is written to `~/.claude`.
- **Restore** never writes model-authored content, only base-tree blobs.

## Performance Considerations

- `observe` cost is O(findings × (ls-tree + ctags on first use per file)) plus
  one fold. ctags runs once per file per run (the result is cached in a temp dir
  for the run).
- `fold` is linear in ledger size; prune-on-close bounds a ledger's lifetime.
- The hook reads sidecars only; the fallback fold is capped at 1.5 s total.

## Migration & Rollback

- The feature is new, with no existing data. The schema carries `"v": 1`;
  readers skip records with an unknown `v` and count them.
- Rollback: revert the stack. Ledger files under `.git/yellow-review/` are inert
  without the plugin and can be removed with
  `rm -rf "$(git rev-parse --git-common-dir)/yellow-review"`.
- Stage 2 is independently safe: fields are added, and missing ones are
  defaulted.

## Out of Scope (follow-ups)

- Post-commit re-observation of `anchor_source: worktree` findings (task 3.4
  gap): once Step 9's fix commit exists, run `rl observe` again for each
  worktree-anchored finding, anchored to that commit/tree so later
  reconciliation maps its line normally. Needs a new `--step` value alongside
  the current `6|8`.
- Rule-level semantic re-verification in `rl reverify` / `rl_reverify_row`: the
  shipped check hashes anchor text at the mapped line (CLAUDE-48), so
  `reproduced` means "reported line unchanged," not "defect still fires."
  Re-running the original rule per finding belongs in the library stack, not
  this plan.
- `claude plugin eval` suite for triage judgement (P10).
- Compaction / rewrite of long ledgers (P6).
- Per-finding "carried over" markers in the Step 10 tables (P11).
- A `mkdir`-lock fallback for hosts without `flock`. The locked design specifies
  `flock`; `/review:setup` makes a missing binary fail early.
- Cross-machine export of the ledger (the locked trade-off).

## References

- `docs/brainstorms/2026-09-23-review-findings-ledger-brainstorm.md` (authority)
- `docs/research/review-findings-persistence.md`
- `plugins/yellow-review/commands/review/review-pr.md` (Steps 3d, 5, 6, 7, 8,
  9, 10)
- `plugins/yellow-review/commands/review/review-all.md` (Step 4, parity block)
- `plugins/yellow-debt/{lib/validate.sh,hooks/scripts/session-start.sh,commands/debt/triage.md}`
- `plugins/yellow-core/lib/compound-staging.sh` (`cs_redact_secrets`,
  `cs_atomic_jsonl_write`)
- `scripts/lib/generate/emit-codex.js` (`includeHooks`),
  `catalog/plugins/yellow-core.json` (precedent)
- `docs/solutions/security-issues/{prompt-injection-defense-layering-2026,tracked-file-as-untrusted-input-channel,credential-scan-grep-exemption-bypass}.md`
- `docs/solutions/logic-errors/append-only-dedup-blocks-correction-propagation.md`
- git docs: cat-file, ls-tree (`-z`), patch-id (`--stable`), merge-base
  (`--is-ancestor`), rev-parse (`--path-format`)
- universal-ctags `readtags(1)`; codeql-action `fingerprints.ts` (occurrence
  counters)

## Stack Decomposition

<!-- stack-topology: linear -->
<!-- stack-trunk: main -->

Six PRs, each depending on the previous one. The brainstorm's "Setup and docs",
"Changeset" and "Tests" items are folded into the stage that introduces each
behaviour, so every PR passes the CI gate on its own.

### 1. agent/feat/review-ledger-lib

- **Type:** feat
- **Description:** add the review-findings ledger library, schema and rule
  vocabulary to yellow-review
- **Scope:** plugins/yellow-review/lib/review-ledger.sh,
  plugins/yellow-review/lib/review-ledger-vocab.json,
  plugins/yellow-review/tests/review-ledger.bats,
  plugins/yellow-review/tests/helpers/ledger-repo.bash,
  plugins/yellow-review/tests/mocks/gh, catalog/plugins/yellow-review.json,
  plugins/yellow-review/.claude-plugin/plugin.json,
  `tests/integration/__snapshots__/generate-manifests-characterization.test.ts.snap`,
  plugins/yellow-review/CLAUDE.md, .changeset/review-ledger-lib.md
- **Tasks:** 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13
- **Depends on:** (none)
- **Linear:** CLAUDE-44, CLAUDE-45, CLAUDE-46, CLAUDE-48, CLAUDE-49

### 2. agent/feat/review-rule-scope-fields

- **Type:** feat
- **Description:** add rule and scope to the compact-return schema across review
  personas
- **Scope:** plugins/yellow-review/agents/review/\*.md,
  plugins/yellow-core/agents/review/security-reviewer.md,
  plugins/yellow-core/agents/review/performance-reviewer.md,
  plugins/yellow-review/commands/review/review-pr.md,
  plugins/yellow-review/commands/review/review-all.md,
  plugins/yellow-review/skills/pr-review-workflow/SKILL.md,
  plugins/yellow-review/tests/skill-content.bats,
  .changeset/review-rule-scope-fields.md
- **Tasks:** 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
- **Depends on:** #1
- **Linear:** CLAUDE-49

### 3. agent/feat/review-ledger-persistence

- **Type:** feat
- **Description:** persist review:pr and review:all findings to the ledger
- **Scope:** plugins/yellow-review/references/review-pr/ledger.md,
  plugins/yellow-review/commands/review/review-pr.md,
  plugins/yellow-review/commands/review/review-all.md,
  plugins/yellow-review/commands/review/setup.md,
  plugins/yellow-review/tests/review-ledger.bats,
  plugins/yellow-review/tests/skill-content.bats,
  plugins/yellow-review/README.md, plugins/yellow-review/CLAUDE.md,
  .changeset/review-ledger-persistence.md
- **Tasks:** 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10
- **Depends on:** #2
- **Linear:** CLAUDE-44, CLAUDE-48

### 4. agent/feat/review-triage-command

- **Type:** feat
- **Description:** add /review:triage for ledger lifecycle, dismissal, restore
  and prune
- **Scope:** plugins/yellow-review/commands/review/triage.md,
  plugins/yellow-review/lib/review-ledger.sh,
  plugins/yellow-review/tests/review-ledger.bats,
  plugins/yellow-review/tests/skill-content.bats,
  plugins/yellow-review/README.md, plugins/yellow-review/CLAUDE.md, root
  `README.md` (yellow-review command count/inventory),
  .changeset/review-triage-command.md
- **Tasks:** 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
- **Depends on:** #3
- **Linear:** CLAUDE-44, CLAUDE-45, CLAUDE-47, CLAUDE-48

### 5. agent/feat/review-sweep-ledger

- **Type:** feat
- **Description:** show residual ledger counts in sweeps and prune closed-PR
  ledgers
- **Scope:** plugins/yellow-review/commands/review/sweep.md,
  plugins/yellow-review/commands/review/sweep-all.md,
  plugins/yellow-review/tests/skill-content.bats,
  plugins/yellow-review/README.md, plugins/yellow-review/CLAUDE.md,
  .changeset/review-sweep-ledger.md
- **Tasks:** 5.1, 5.2, 5.3
- **Depends on:** #4

### 6. agent/feat/review-ledger-session-hook

- **Type:** feat
- **Description:** add a SessionStart hook that reports pending review-ledger
  findings
- **Scope:** catalog/plugins/yellow-review.json,
  plugins/yellow-review/.claude-plugin/plugin.json,
  plugins/yellow-review/.codex-plugin/plugin.json,
  plugins/yellow-review/hooks/scripts/session-start.sh,
  plugins/yellow-review/tests/session-start.bats,
  `tests/integration/__snapshots__/generate-manifests-characterization.test.ts.snap`,
  docs/architecture-overview.md, docs/security.md,
  plugins/yellow-review/README.md, plugins/yellow-review/CLAUDE.md,
  .changeset/review-ledger-session-hook.md
- **Tasks:** 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
- **Depends on:** #5

## Stack Progress

<!-- Updated by flow:work. Do not edit manually. -->

- [x] 1. agent/feat/review-ledger-lib (completed 2026-09-24)
- [x] 2. agent/feat/review-rule-scope-fields (completed 2026-09-24)
- [x] 3. agent/feat/review-ledger-persistence (completed 2026-09-25)
- [ ] 4. agent/feat/review-triage-command
- [ ] 5. agent/feat/review-sweep-ledger
- [ ] 6. agent/feat/review-ledger-session-hook
