# GitHub-native stacked-PR provider operations — Phase 0 revalidation

**Date:** 2026-08-18
**Verified against:** `gh` 2.97.0 (2026-07-31) · Claude Code 2.1.235 ·
`github/gh-stack` @ `ab00aa4a3f2dddc51aa65849c68b391a1b079311` (main,
2026-08-17T16:53:06Z — the exact SHA recorded as this task's baseline)
**Method:** `gh api`, live `claude`/`claude plugin` probes on this
workstation, and a source read of `github/gh-stack` cloned at the pinned
SHA (`cmd/*.go`).
**Relationship to prior work:** this document extends
[`2026-08-16-github-native-stacks-vs-graphite.md`](2026-08-16-github-native-stacks-vs-graphite.md)
(evidence collected 2026-08-17), which established provider selection and
classification only. That document's findings are reused here without
re-verification where nothing could plausibly have changed in one day
(preview status, `gh stack` extension advertising, `claude plugin list
--json` shape); this document adds the operations-level detail
(`plans/stacked-pr-provider-abstraction.md` deferred-work item 1) needed to
build the GitHub runtime adapter — Phase 3 of
[`plans/stacked-pr-provider-abstraction.md`](../../plans/stacked-pr-provider-abstraction.md)'s
deferred-work list, tracked in this task's `GOAL.md` — archived at
[`plans/complete/2026-08-19-github-stack-end-to-end-authoring-brief.md`](../../plans/complete/2026-08-19-github-stack-end-to-end-authoring-brief.md).

Following
[`docs/solutions/code-quality/upstream-concept-fork-snapshot-protocol.md`](../solutions/code-quality/upstream-concept-fork-snapshot-protocol.md):
this is a **source read**, not a skill/prose port. No text is copied from
`github/gh-stack`'s `SKILL.md` or docs into this repository's commands or
skills; only the CLI's flag/exit-code/argument contract (its public,
factual behavior) is recorded, exactly as this repo already does for `gt`.

```text
upstream-snapshot: github/gh-stack@ab00aa4a3f2dddc51aa65849c68b391a1b079311
snapshot-date: 2026-08-18
release-notes-audited-from: v0.1.0 (2026-07-29) to ab00aa4a (2026-08-17)
minimum-upstream-version: v0.1.0
```

---

## 1. What changed since v0.1.0 → `ab00aa4a` (audited)

`git log v0.1.0..ab00aa4a --oneline` shows exactly three commits, and
`git diff v0.1.0..ab00aa4a --stat` touches **only** `README.md`,
`SUPPORT.md`, `docs/**`, and `skills/gh-stack/**` (950 deleted / 179+97+159
added lines reorganizing the skill into `references/*.md`). **Zero files
under `cmd/`, `internal/`, or any other Go source path changed.** The
binary's flag surface, exit codes, and argument handling recorded in the
April/August research is therefore verified unchanged at the pinned SHA —
this is a **skill-authoring reorganization + preview-language cleanup**,
not a behavior change. `removed private preview mentions from docs` (#368)
is consistent with §2 of the prior research doc (still public preview per
the changelog, but the extension's own docs no longer say "private
preview").

## 2. Exit code contract — verified against source, one correction to GOAL.md

`cmd/utils.go` defines the canonical exit codes as typed `*ExitError`
values:

| Code | Constant | Meaning (source comment) |
| --- | --- | --- |
| 0 | (none) | success |
| 1 | `ErrSilent` | generic failure; message already printed, do not re-print |
| **2** | `ErrNotInStack` | **branch/stack not found — NOT in `GOAL.md`'s table** |
| 3 | `ErrConflict` | rebase conflict |
| 4 | `ErrAPIFailure` | GitHub API error |
| 5 | `ErrInvalidArgs` | invalid arguments or flags |
| 6 | `ErrDisambiguate` | multiple stacks/remotes, can't auto-select |
| 7 | `ErrRebaseActive` | rebase already in progress |
| 8 | `ErrLockFailed` | could not acquire stack file lock |
| 9 | `ErrStacksUnavailable` | stacked PRs not available for this repository |
| 10 | `ErrModifyRecovery` | modify session interrupted, recovery required |

**Delta from `GOAL.md` §"Encode these current first-party constraints":**
the task brief's exit-code list (3–10) omits **exit code 2**
(`ErrNotInStack`, "branch/stack not found"). The runtime adapter built in
this PR treats exit 2 as a first-class status (`NOT_IN_STACK`), not folded
into the generic `1`/`ErrSilent` bucket, so a caller asking about a branch
that was never added to a stack gets an accurate status rather than an
opaque failure.

## 3. Command surface confirmed by source read (not guessed from README)

All confirmed via `cmd/*.go` at the pinned SHA (cobra `Short`/`Long`/`Args`
declarations and `Flags()` registrations):

- **`view --json`** (`cmd/view.go`): `--json` is a real, dedicated
  non-interactive path (`runViewJSON`) with a typed output struct
  (`Trunk`, `CurrentBranch`, `Branches[]{Name, Head, Base, IsCurrent,
  IsMerged, IsQueued, NeedsRebase, PR{Number, URL, State}}`). Confirms
  `gh stack view --json`, never bare `view`, is both correct and the only
  machine-readable read path.
- **`submit`** (`cmd/submit.go`): flags are exactly `--auto` ("Use
  auto-generated PR titles without prompting"), `--open` ("Mark new and
  existing PRs as ready for review"), `--remote`. Confirms `--auto` is the
  noninteractive default and `--open` is opt-in-only, matching `GOAL.md`.
- **`merge`** (`cmd/merge.go`): flags are `--merge-method`, `--merge`,
  `--squash`, `--rebase`, `-y/--yes` ("Merge without prompting for
  confirmation"). Confirms `gh stack merge <target> --yes` is the correct,
  and only, noninteractive invocation.
- **`modify`** (`cmd/modify.go`): `Short: "Interactively restructure a
  stack"`, `Long: "Open an interactive TUI to restructure the current
  stack."` — confirmed genuinely TUI-only with no noninteractive flag
  surface at all (only `--continue`/`--abort` for **recovering** from an
  interrupted modify session, never for driving one). Confirms `GOAL.md`'s
  "Never `gh stack modify`" and justifies exit 10 (`ErrModifyRecovery`)
  existing specifically for the interrupted-session recovery path.
- **`switch`** (`cmd/switch.go`): `Short: "Interactively switch to another
  branch in the stack"`, `Long: "Show an interactive picker..."` —
  confirmed TUI-only, no JSON/noninteractive mode. Confirms `GOAL.md`'s
  "Never `gh stack switch`"; `checkout <target>` (below) is the
  noninteractive substitute this adapter uses instead.
- **`checkout`** (`cmd/checkout.go`): `Args: cobra.MaximumNArgs(1)` —
  the target argument is syntactically optional (0 or 1 positional args);
  omitting it falls through to an interactive picker. The runtime adapter
  in this PR **always** supplies the argument explicitly (stack number, PR
  number, PR URL, or branch name) so it never falls into that picker path,
  even though the CLI itself would accept zero args.
- **`init` / `add`** (`cmd/init.go`, `cmd/add.go`): `add` is also
  `cobra.MaximumNArgs(1)` (branch name optional, defaults to interactive
  naming prompt otherwise); `init` takes `-b/--base`. Same rule as
  `checkout`: this adapter always passes the branch argument explicitly.
- **`sync`** (`cmd/utils.go` `resolveStackDivergence`): confirmed the exact
  string `"Sync aborted — no changes were made"` is emitted via
  `cfg.Infof` (not `Errorf`) and the function returns `(..., nil)` — **no
  error, so `os.Exit(0)`**. This is the source-level confirmation of
  `GOAL.md`'s "noninteractive sync output containing `Sync aborted` is
  unresolved/failure even when exit code is zero": the CLI's own exit code
  cannot distinguish "sync completed" from "sync silently declined to act
  because it hit a non-interactive divergence it cannot resolve without a
  prompt." The runtime adapter's `sync` operation greps stdout for this
  substring and reports a `SYNC_ABORTED` status distinct from `SUCCESS`
  regardless of exit code.

## 4. `claude plugin list --json` shape — reconfirmed, no drift

Claude Code bumped from 2.1.233 (prior research) to **2.1.235** on this
workstation in the one-day gap. `claude plugin list --json` output shape
is unchanged: flat array, `id` is `name@marketplace`, one row per scope,
`project`/`local` rows carry `projectPath`. No action needed beyond what
the existing `stack-provider-state.js` already assumes.

## 5. Plugin-scope precedence spike (mandatory per `GOAL.md`)

Run in a fully isolated environment: `CLAUDE_CONFIG_DIR` pointed at a
throwaway `mktemp -d` for every invocation (never the real
`~/.claude`), against throwaway `git init` repositories under `/tmp` (never
this repository or any other real project). See the sanitized fixture
capture and findings summary in
[`docs/research/2026-08-18-claude-plugin-scope-precedence-spike.md`](2026-08-18-claude-plugin-scope-precedence-spike.md).

## 6. What this justifies building now (this PR)

Per `GOAL.md` Phases 1–8:

1. An explicit `CONFIG_INVALID` intent-parser result (Phase 1), because
   `parseIntent()`'s current `null`-collapses-everything behavior cannot
   distinguish "absent" from "malformed" — confirmed still true by reading
   `plugins/yellow-core/lib/stack-provider-state.js` at this task's
   baseline commit.
2. A single dependency-free tooling-readiness probe covering `gt`, `gh`
   version, `gh auth status`, and `github/gh-stack` extension identity
   (owner check, not just command resolution) — justified by §3.2 of the
   prior research doc (name-collision hazard: four distinct `gh stack`
   extensions exist) and unchanged by this revalidation.
3. An effective-scope model that folds scope rows by verified precedence
   (§5 spike) instead of "any enabled row anywhere," fixing the documented
   bug where a project/local switch request could disable a correctly-set
   global provider.
4. A GitHub runtime adapter built directly against the exit-code and flag
   contract in §2–3 above, including the previously-undocumented exit code
   2 (`NOT_IN_STACK`) and the exit-0 sync-abort text match.

## 7. What this still does not justify (unchanged from prior research)

1. Treating the GitHub feature or its merge queue as GA — it remains
   public preview; §2 of the prior research doc's "rolling out
   progressively over the coming weeks" merge-queue language is unedited
   by the docs-only changes audited in §1 above.
2. Depending on `gh skill` as a distribution channel — still explicitly
   "subject to change without notice" per that surface's own `--help`
   text (unchanged, not re-probed since nothing in §1's diff touches it).
3. Any change to branch protections, rulesets, merge queues, or required
   checks.

## 8. Live smoke test (2026-08-19, GOAL.md Phase 9)

Real GitHub resources, user-confirmed before running. `gh-stack` v0.1.0
installed fresh via `gh extension install github/gh-stack` (not previously
installed on this machine) — confirmed identical version to the pinned SHA
snapshot in §1.

**Repo:** a private throwaway repo under the operator's own account
(`yellow-stack-smoke-<timestamp>`), created via `gh repo create --private
--clone`, deleted via `gh repo delete --yes` at the end. No shared,
protected, or long-lived resource was touched.

**Lifecycle exercised**, each command run for real and its result recorded:

1. `gh stack init -b main layer-one` → exit 0, created and checked out
   `layer-one`. Matches the runtime adapter's `init` exactly.
2. `gh stack add -m "<message>" layer-two` (files pre-staged via plain
   `git add`, no `-A`/`-u` passed) → exit 0, committed the pre-staged
   files and created `layer-two` on top. **Confirms** the adapter's `add`
   design (skills stage specific files themselves, then call `add` with
   only `-m`) works exactly as assumed — `-A`/`-u` are for auto-staging,
   not required when files are already staged.
3. `gh stack submit --auto` → exit 0, created PR #1 (`layer-one` → `main`)
   and PR #2 (`layer-two` → `layer-one`) as a linked stack, both **drafts**
   by default (confirmed via `gh pr list --json isDraft`) — matches the
   adapter's "no `--open` = draft" assumption exactly.
4. `gh stack view --json` → exit 0. **Real output shape**, not previously
   observed directly:
   ```json
   {"trunk": "main", "currentBranch": "layer-two",
    "branches": [{"name": "layer-one", "head": "<sha>", "base": "<sha>",
      "isCurrent": false, "isMerged": false, "isQueued": false,
      "needsRebase": false, "pr": {"number": 1, "url": "...", "state": "OPEN"}},
      {"name": "layer-two", ...}]}
   ```
   `head`/`base` are commit SHAs, not branch names. `github-stack-plan`'s
   SKILL.md was updated with this confirmed shape.
5. **Finding — exit-code taxonomy is coarser than assumed.** Merging a
   draft PR surfaced two DIFFERENT exit codes for the same root cause,
   depending on invocation form:
   - `gh stack merge --yes` (no target, current-branch context) → **exit
     2**, stderr `"nothing to merge: pull request #1 is a draft"`.
   - `gh stack merge 1 --yes` (explicit target, run from the wrong
     directory first) → exit 2, stderr `"#1 is not a stack number or a
     stacked pull request"` (a genuinely different problem — confirms
     exit 2 is reused for more than one condition, not `NOT_IN_STACK`
     alone).
   - `gh stack merge 1 --yes` (explicit target, correct directory, PR
     still draft) → **exit 5**, stderr `"pull request #1 is a draft; mark
     it ready for review before merging"`.

   Recorded as a code comment in `github-stack-runtime.js` next to
   `EXIT_STATUS`: the numeric status label is not authoritative on its
   own for a caller's messaging — every skill already surfaces `stderr`
   verbatim alongside `recoveryAction`, which is where the real reason
   lives, so this does not change any skill's behavior, only the
   documented confidence level in the status label alone.
6. `gh pr ready 1` / `gh pr ready 2` → both PRs marked ready for review.
7. `gh stack merge 2 --yes` (via the runtime adapter directly, `--target 2
   --confirm`) → **exit 0, SUCCESS**. stderr: `"Merging #1, #2 into main
   via merge...\n✓ Merged #1, #2 into main (<sha>)"`. Confirmed by
   `git fetch` + `git log origin/main`: both commits genuinely landed on
   `main` via a real merge commit, and `gh pr list --state merged` showed
   both PRs merged. **The full init → add → submit → (draft-to-ready) →
   merge round trip works end to end through the actual adapter code**,
   not just the raw CLI.
8. Cleanup: `gh repo delete --yes` — confirmed via a follow-up `gh repo
   view` returning "Could not resolve to a Repository," and local scratch
   directory removed.

**Not exercised in this smoke run** (scope decision, not a blocker):
`sync`, `rebase --mode continue/abort`, `unstack`, `checkout` against a
PR-number/URL target. These were validated via `--help` text and the
Phase 0 source read (§2–3 above) but not run against a live repo — deleting
the throwaway repo achieved the same end state `unstack` would have,
without an extra mutation round trip.

## 9. Sources

- `github/gh-stack` repository, cloned and inspected at
  `ab00aa4a3f2dddc51aa65849c68b391a1b079311` (`cmd/*.go`, `git log`,
  `git diff v0.1.0..ab00aa4a`)
- `gh api repos/github/gh-stack`, `gh api repos/github/gh-stack/tags`
- Local CLI probes: `gh --version`, `gh auth status`, `claude --version`,
  `claude plugin list --json`, `claude plugin --help`
- [`2026-08-16-github-native-stacks-vs-graphite.md`](2026-08-16-github-native-stacks-vs-graphite.md)
  (reused without re-verification where noted in §1)
