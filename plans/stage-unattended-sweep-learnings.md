# Feature: Stage unattended sweep learnings

## Problem Statement

`knowledge-compounder` always stops at its M3 `AskUserQuestion` gate before
writing, and it has no non-interactive mode. Even so:

- `/review:pr` Step 9a spawns it under `--non-interactive`.
- `/review:sweep-all` Step 6 reaches it through `/flow:compound`.

Every unattended sweep therefore builds a compounding plan, writes nothing, and
the learnings are lost.
`docs/solutions/workflow/compounder-m3-gate-non-interactive.md` (2026-07-29)
names the compound-staging drain as the sanctioned gate-free path, but the
pipelines were never switched to it.

Source brainstorm:
`docs/brainstorms/2026-09-30-stage-unattended-sweep-learnings-brainstorm.md`.

## Current State

- `plugins/yellow-core/lib/compound-staging.sh` is the staging library.
  - It is a Tier 4 dual-shell library, sourced directly, with no top-level
    `set -e`/`-u`.
  - It provides `cs_derive_project_slug`, `cs_staging_dir_for_slug`,
    `cs_atomic_jsonl_write`, `cs_redact_secrets` and the drain-budget helpers.
  - It has no append or stage function.
- The only producer is the Stop hook
  (`hooks/scripts/_stop-capture-subshell.sh`).
  - It sanitises the session id with `tr -c 'A-Za-z0-9._-' '_'`.
  - It redacts, then hashes the redacted tail.
  - It builds the entry with `jq -nc --arg` as
    `{schema:"1", schema_min_reader:"1", timestamp, session_id, content_hash, cwd, transcript_tail}`.
  - It writes `<staging>/pending/<session_id>.jsonl` via
    `cs_atomic_jsonl_write`, with a caller-added trailing newline.
- The drain is `staging-reviewer`, then `staging-scorer`, then
  `staging-promoter`.
  - It fires at SessionStart once there are 5 or more pending entries, or the
    oldest is over 48h.
  - `session_id` is only a filename and label, and `cwd` is only the reviewer's
    `Project:` input. A synthetic entry is therefore safe.
  - The scorer emits one candidate per entry, capped at 400 characters, with no
    code fences or `---` lines. Rubric: 0.95 for a named file, bug and verified
    fix; 0.85 for a solved problem with a named artifact; 0.55 for a tip. It
    deletes entries below 0.5, or below 0.7 without ruvector.
  - Reviewer Phase 6 rejects fence-like or role-prefixed text. Phase 7 flags
    entries scored 0.8 or above that have no file, command or error marker.
  - The promoter only creates new docs.
- `plugins/yellow-review/references/review-pr/knowledge-compounding.md` Step 9a
  always spawns the compounder when there are P0–P2 findings. It has no
  non-interactive branch; Step 9b does have one.
- `plugins/yellow-review/commands/review/sweep-all.md` Step 6 (the last step)
  always invokes `/flow:compound` once any PR was attempted.
- `/review:pr` has no test or lint verification record. Step 7 auto-applies only
  P0/P1 `safe_auto` fixes. The review-findings ledger records `applied` (with
  `fix_sha`), `open`, `report_only` and similar states.
- `/review:all` has no `--non-interactive` mode and stays attended.
  `/flow:pick-next-shell` is also attended. Neither is in scope.

<!-- deepen-plan: codebase -->

> **Codebase:** The drain trigger is
> `plugins/yellow-core/hooks/scripts/session-start.sh` lines 44–58. It derives
> the slug from the session's `.cwd` (falling back to `CLAUDE_PROJECT_DIR`, then
> `PWD`) via `cs_derive_project_slug`, which uses
> `git rev-parse --show-toplevel`. It dispatches at 5 or more pending entries
> (line 139) or when the oldest is over 48h (lines 146–160). The 7-day PII
> reaper on `pending/` (lines 110–118) runs in the same session. Consequence for
> user decision 5: entries staged under the main checkout's slug only drain, or
> get reaped, when a session starts with the main clone (`yellow-plugins/`) as
> its toplevel. Sessions started in `worktrees/<repo>/<slug>/` or at the non-git
> workspace root never evaluate that slug.

<!-- /deepen-plan -->

## Proposed Solution

Under `--non-interactive`, Step 9a builds one outcome narrative per PR and
stages it through a new yellow-review wrapper. The wrapper calls a new
yellow-core `cs_stage_entry`. Interactive `/review:pr` keeps the M3-gated
compounder unchanged. `/review:sweep-all` Step 6 is removed, because every swept
PR already stages at Step 9a.

### User decisions (brainstorm and planning)

1. **Narrative content.** Each entry is an outcome narrative, one paragraph per
   finding, with literal labels.
2. **Which findings.** Stage all P0–P2 findings, as today. Every finding is
   labelled with its true state:
   - `applied in <short-sha>, not verified by tests`, or
   - `unresolved (open)` / `unresolved (report-only)`.
   - Never write "verified" or "tests pass". There is no record to back it.
3. **sweep-all Step 6.** Drop it.
4. **Missing yellow-core or jq.** Warn and skip. Never abort the review or the
   sweep.
5. **Worktrees.** Stage into the main checkout's slug, resolved via
   `git rev-parse --git-common-dir`, so entries survive worktree removal.

<!-- deepen-plan: codebase -->

> **Codebase:** Correction to decision 5's mechanism. The main checkout is not
> reliably the parent of `--git-common-dir`: that only holds in the default
> layout, and the plan's text omits `--path-format=absolute`. Prior art:
>
> - `ruvector_main_worktree` in
>   `plugins/yellow-ruvector/hooks/scripts/lib/resolve.sh` lines 36–62 takes the
>   first `git worktree list --porcelain` entry, refuses `bare`, and verifies a
>   `--separate-git-dir` layout.
> - `rl_common_dir` in `plugins/yellow-review/lib/review-ledger.sh` lines
>   104–112 uses `--path-format=absolute` and normalises with `pwd -P`.
>
> Use the first porcelain entry, refuse `bare`, and confirm the result with
> `git -C "$p" rev-parse --show-toplevel`. When that fails, fall back to the
> session's own toplevel (stage, don't skip). The success message must not
> promise "drains at a later session start". Say
> `drains at the next session started in <main checkout>`.

<!-- /deepen-plan -->

### Design decisions recorded without asking

- **One entry per PR.** The scorer yields one candidate per entry, and
  per-finding entries would trip the 5-entry drain trigger from a single PR.
  - Include at most 5 findings, ordered applied first, then by severity.
  - Close with a "N further findings omitted" line.
- **`session_id` is `review-pr-<owner>-<repo>-<N>`**, with no run component and
  then sanitised. Re-sweeping a PR overwrites its undrained entry. The content
  hash dedups identical re-runs at drain time.
- **No untrusted text reaches a shell command line.** The model writes the
  narrative to a `mktemp` path with the Write tool, and the wrapper reads that
  file and deletes it.
  - This avoids heredoc delimiter forgery and quoting of model text.
- **Sanitising lives in `cs_stage_entry`, so every non-transcript producer gets
  it:**
  - Cap the narrative at 8 KiB, cut at a line boundary, before redaction.
  - Neutralise lines matching `^---`, code-fence lines (backtick or tilde), and
    `^(system|assistant|human|user):` prefixes.
  - Redact, then hash the redacted text, then write.
  - On redaction failure, stage nothing. Never stage the failure placeholder.
- **Extend `cs_redact_secrets` with `ASIA[0-9A-Z]{16}`** (AWS temporary keys).
  The Stop hook benefits as well.
- **The wrapper mirrors `rl_core_lib_path`'s resolver** and does not refactor
  `review-ledger.sh`.
  - That avoids colliding with the in-flight #950–#955 stack.
  - The duplication is a recorded follow-up.
  - The override variable is `YR_CORE_LIB`.
- **No drain trigger from the sweep.** The existing SessionStart threshold is
  the only trigger.

<!-- deepen-plan: external -->

> **Research:** OWASP LLM01:2025 asks for external content to be kept separate
> and clearly marked. OWASP AISVS C02-01 is more concrete:
>
> - normalise text (NFKC) before matching;
> - strip zero-width characters (U+200B, U+200D), the bidi overrides
>   (U+202A–202E, U+2066–2069) and Unicode tag characters (U+E0000–E007F);
> - make literal delimiters inert, by indenting them or adding a sigil.
>
> Microsoft's Spotlighting work adds that the closing delimiter should be a
> nonce generated when the prompt is built, never stored. That is the drain's
> concern, not this plan's. For this plan:
>
> - Prefix neutralised lines with a sigil (for example `> `) rather than
>   deleting them, so text still reads naturally.
> - Strip C0 control characters, DEL, and the zero-width, bidi and tag code
>   points listed above. A full NFKC pass isn't practical in POSIX shell; note
>   the gap rather than adding a `python3` dependency.
>
> Sources: https://genai.owasp.org/llmrisk/llm01-prompt-injection/ ,
> https://github.com/OWASP/AISVS/blob/main/1.0/research/chapters/C02-User-Input-Validation/C02-01-Prompt-Injection-Defense.md
> ,
> https://www.microsoft.com/en-us/msrc/blog/2025/07/how-microsoft-defends-against-indirect-prompt-injection-attacks

<!-- /deepen-plan -->

## Implementation Plan

### Phase 1: yellow-core staging helper

- [x] 1.1: Add `ASIA[0-9A-Z]{16}` to `cs_redact_secrets` in
      `plugins/yellow-core/lib/compound-staging.sh`, next to the `AKIA` rule.

  <!-- deepen-plan: codebase -->

  > **Codebase:** The AKIA rule is at `compound-staging.sh` line 127:
  > `s/AKIA[0-9A-Z]{16}/[REDACTED:aws-access-key]/g`. Extend that one expression
  > rather than adding a sibling line.

  <!-- /deepen-plan -->

  <!-- deepen-plan: external -->

  > **Research:** gitleaks' current `aws-access-token` rule is
  > `\b((?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16})\b`. trufflehog matches
  > `AKIA|ABIA|ACCA` for long-term keys and has a separate detector for `ASIA`
  > session keys. Widen the rule to `(AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}`, keeping
  > the broader `[0-9A-Z]` tail so older-style IDs still match. Skip `A3T`,
  > which gitleaks itself marks "might not be a valid AWS token". GitHub push
  > protection blocks AWS key pairs, meaning an ID and a secret in the same
  > file. A bare ID is unlikely to be blocked, but keep the split-literal
  > fixtures anyway. Source:
  > https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml ,
  > https://docs.github.com/en/code-security/reference/secret-security/supported-secret-scanning-patterns

  <!-- /deepen-plan -->

- [x] 1.2: Add `cs_stage_entry <cwd> <session_id> <narrative_file>` to the same
      library. The body follows Tier 4 rules:
  - It starts with `if [ -n "${ZSH_VERSION:-}" ]; then emulate -L sh; fi`.
  - It writes with `>|`.
  - It uses no `path`/`status` variables, `BASH_SOURCE`, arrays or `[[ =~ ]]`.
  - It uses `printf`, not `echo`.

  Steps:
  - Validate the arguments, then sanitise `session_id` and reject empty, `.` and
    `..`.
  - Require `jq`.
  - Apply the 8 KiB line-boundary cap, then neutralise fence and role lines.
  - Pipe through `cs_redact_secrets`, failing closed.
  - Hash with `sha256sum`, falling back to `shasum -a 256`.
  - Build the entry with `jq -nc --arg` using the Stop-hook schema.
  - Write via `cs_atomic_jsonl_write` to
    `$(cs_staging_dir_for_slug "$(cs_derive_project_slug "$cwd")")/pending/<sid>.jsonl`.
  - Return codes: 0 staged, 1 bad args, 2 `jq` missing, 3 redaction failed, 4
    write failed.
  - Never print the narrative.

  <!-- deepen-plan: codebase -->

  > **Codebase:** Three corrections to the steps above.
  >
  > 1. **Order: cap, then redact, then neutralise.** Every PEM header and footer
  >    starts with `---`. `cs_redact_secrets` (lines 142–143) matches the block
  >    as a sed range from `-----BEGIN.*PRIVATE KEY-----` to
  >    `-----END.*PRIVATE KEY-----`. Neutralising `^---` lines first breaks that
  >    range, and the key body leaks.
  > 2. **Check `HOME` yourself.** `cs_staging_dir_for_slug` (lines 52–58) only
  >    fails on an empty slug. With `HOME` unset it builds
  >    `/.claude/projects/...`. `cs_stage_entry` must test `[ -n "${HOME:-}" ]`
  >    and return 4.
  > 3. **Redaction failure prints a placeholder.** On failure,
  >    `cs_redact_secrets` writes `[REDACTED: sanitization failed]` to stdout
  >    and returns 1 (lines 147–151). Capture its output, test the exit status,
  >    and discard the output when it is non-zero.
  >
  > Separately, the jq `esc`/`strip` helpers in `review-ledger.sh` lines
  > 2379–2386 strip control bytes, but they are jq-only and tied to the ledger's
  > own delimiters. No bash neutraliser exists to reuse, so writing a new one
  > isn't duplication.

  <!-- /deepen-plan -->

- [x] 1.3: Extend `tests/shell-compat/drivers/yellow-core--compound-staging.sh`
      to call `cs_stage_entry` with a benign narrative and print the
      deterministic fields (hash, file count, `schema`), so bash, zsh and
      zsh+noclobber output match.

  <!-- deepen-plan: codebase -->

  > **Codebase:** `tests/shell-compat/tier4-libraries.bats` requires exit 0,
  > **empty stderr**, and byte-identical stdout under all three shell profiles.
  > Print no timestamps or absolute `HOME`/`TMPD` paths: normalise them, or
  > print only the hash, the count and `schema`.

  <!-- /deepen-plan -->

### Phase 2: yellow-review wrapper

- [ ] 2.1: Create `plugins/yellow-review/lib/stage-learning.sh`. It is
      executable, invoked as
      `bash "${CLAUDE_PLUGIN_ROOT}/lib/stage-learning.sh" ...`, and like
      `review-ledger.sh` it is not a tiered library. Subcommands:
  - `tmpfile`: prints a fresh `mktemp "${TMPDIR:-/tmp}/yr-stage.XXXXXX"` path.
  - `stage <pr> <narrative_file>`:
    - Validate the PR number with `^[1-9][0-9]{0,9}$`.
    - Resolve `<owner>-<repo>` from `gh repo view --json nameWithOwner`, falling
      back to the `origin` URL.
    - Resolve the main checkout from `git rev-parse --git-common-dir` (its
      parent directory when the common dir ends in `.git`, otherwise the
      toplevel).
    - Resolve yellow-core's library in this order: `YR_CORE_LIB`, then the
      sibling `../yellow-core`, then the newest numeric version in the plugin
      cache. This mirrors `review-ledger.sh` `rl_core_lib_path`.
    - Source the library and call `cs_stage_entry`.
    - Always delete the narrative file.
    - Always exit 0.
    - On success print
      `[review:pr] Staged learnings for PR #<N> (drains at a later session start).`
    - On a skip print one line,
      `[review:pr] Warning: learning staging skipped (<reason>)`, where the
      reason is one of `yellow-core not found`, `jq missing`,
      `redaction failed`, `write failed` or `invalid input`.

  <!-- deepen-plan: codebase -->

  > **Codebase:**
  >
  > - **Override variable.** `rl_core_lib_path` is at `review-ledger.sh` lines
  >   285–307 and `rl_load_core` at lines 310–324. Copy the `${RL_CORE_LIB+x}`
  >   semantics for `YR_CORE_LIB`: if it is set but the file is missing, that
  >   means "dependency absent" with no fallback. The tests rely on this.
  > - **Repo name.** `gh repo view --json nameWithOwner -q .nameWithOwner` is
  >   the existing idiom (`commands/review/resolve-pr.md` line 156,
  >   `resolve-stack.md` line 72).
  > - **Main checkout.** Resolve it as the annotation under user decision 5
  >   says, not as the "ends in `.git`" rule above.
  > - **Validators.** No lint rule targets a new untiered `lib/*.sh` in
  >   yellow-review. `review-ledger.sh` already uses the same shape with a
  >   `#!/bin/bash` shebang.

  <!-- /deepen-plan -->

  <!-- deepen-plan: external -->

  > **Research:**
  >
  > - `--path-format=absolute` exists from Git 2.31.0 (2021-03); before that,
  >   `--git-common-dir` can print a relative `.git`.
  > - The `git worktree` docs say the main worktree is always listed first in
  >   `--porcelain` output. Check for a `bare` line before trusting the entry.
  >   Use `-z` if paths can contain newlines.
  > - `dirname` of the common dir is wrong for bare and `--separate-git-dir`
  >   layouts.
  >
  > Source: https://git-scm.com/docs/git-worktree ,
  > https://git-scm.com/docs/git-rev-parse

  <!-- /deepen-plan -->

- [ ] 2.2: Rewrite Step 9a in
      `plugins/yellow-review/references/review-pr/knowledge-compounding.md`.
  - Keep the existing skip guard (no P0–P2 findings).
  - Branch on non-interactive mode.
    - **OFF:** keep the existing compounder spawn text unchanged.
    - **ON:** do not spawn any agent. Instead:
      1. Run `stage-learning.sh tmpfile`.
      2. Use the Write tool to write the narrative to the printed path.
      3. Run `stage-learning.sh stage <N> <path>`.
  - Specify the narrative template in prose, with no code fences inside the
    narrative itself:
    - Header: `Unattended review of PR #<N> (<owner/repo>).`
    - Per finding:
      `Finding <i> [<sev>, <state label>]: <title>. File: <path>. Reviewer: <name>. Root cause: <one sentence>. Fix: <one line>.`
  - Narrative rules:
    - Collapse newlines in every field and cap each field at 200 characters.
    - Do not cite `file:line`, counts, or PR body or comment text.
    - Use only the state labels from user decision 2.
  - Keep the fencing floor: the narrative goes to disk, never into an agent
    prompt.

  <!-- deepen-plan: codebase -->

  > **Codebase:** Gap: the plan doesn't say where each finding's state comes
  > from. Read it from the ledger, not from the model's memory of the run.
  >
  > - Call `review-ledger.sh fold <pr>` and use `.findings[]`: `.state`,
  >   `.fix_sha`, `.obs.severity`, `.obs.file` and `.obs.title` (`fix_sha` is
  >   written at lines 938 and 997).
  > - `cards <pr>` (lines 2379–2407) doesn't print `fix_sha` and filters some
  >   states, so it doesn't fit.
  > - The Step 9 `--fix-sha` record is written before 9a, on a successful
  >   commit, even when the push was declined or failed. So "applied in `<sha>`"
  >   can describe an unpushed commit. Say "committed in `<sha>`" unless the
  >   Step 9 push succeeded.
  > - Map `applied`/`fixed` to the applied label, `open`/`reopened` to
  >   `unresolved (open)`, and `report_only` to `unresolved (report-only)`.
  > - Leave out `dismissed` and `stale` findings.

  <!-- /deepen-plan -->

- [ ] 2.3: Update the `review-pr.md` Step 1 non-interactive paragraph (around
      lines 64–69) and the Steps 9a+9b stub (around 1068–1083) to say that
      non-interactive mode stages to compound-staging instead of spawning the
      compounder. Keep the 9a body in the reference file, since `review-pr.md`
      is already over the line ceiling.

  <!-- deepen-plan: codebase -->

  > **Codebase:**
  >
  > - The Step 1 paragraph is actually at about lines 62–68. Today it says
  >   non-interactive mode suppresses only the Step 9 push gate and the Step 9b
  >   P2 prompt.
  > - `pnpm validate:doc-counts` and `file-line-counts.bats` check line counts,
  >   so keep the `review-pr.md` edits line-neutral.
  > - Existing `skill-content.bats` greps target `review-pr.md` and
  >   `knowledge-compounding.md` text. Run the suite before and after rewriting
  >   9a.

  <!-- /deepen-plan -->

### Phase 3: sweep-all and docs

- [ ] 3.1: In `sweep-all.md`:
  - Delete `### Step 6: Knowledge compounding (conditional)`.
  - Delete the Error Handling bullets about the Step 6 guard and the
    `/flow:compound` failure.
  - Rewrite the header prose (lines 17–19 and 25) to say that each PR's
    `/review:pr` stages learnings for the drain.
  - Add one line to the Step 5 summary noting that staged learnings drain at a
    later session start.
  - Grep for stray `Step 6` and `flow:compound` references.

  <!-- deepen-plan: codebase -->

  > **Codebase:** The `/flow:compound` references are only at lines 17–19
  > (header), 269–296 (Step 6) and 315–318 (Error Handling). Line 25 ("deeper
  > compounding per PR") needs at most a wording tweak. Word the Step 5 line the
  > same way as the success message: drains at the next session started in the
  > main checkout.

  <!-- /deepen-plan -->

- [ ] 3.2: In `sweep.md`, update the wording on line 24, the `/review:all`
      compounding pointer.

  <!-- deepen-plan: codebase -->

  > **Codebase:** Line 24 reads "multi-PR or stack-wide pipelines with
  > compounding, use `/review:all`". It doesn't mention `/flow:compound`, and
  > the only "Step 6" hit in `sweep.md` (line 132) is unrelated. The line is
  > still accurate, so this task may be a no-op; edit it only if the new wording
  > adds something.

  <!-- /deepen-plan -->

- [ ] 3.3: In `plugins/yellow-review/CLAUDE.md`:
  - Fix the `/review:sweep-all` entry (line 80) and the "end-of-loop
    `/flow:compound` pass" text (around line 256).
  - Add `lib/stage-learning.sh` to the script list.
  - State that the compound-staging ledger and the review-findings ledger are
    separate stores.
- [ ] 3.4: In `plugins/yellow-core/CLAUDE.md`:
  - Document `cs_stage_entry` in the lib list and the Compound Staging section,
    including that it now has a second producer besides the Stop hook.
  - Add the new tests.
- [ ] 3.5: Update
      `docs/solutions/workflow/compounder-m3-gate-non-interactive.md` to say the
      pipelines now use the staging path, citing this PR.

### Phase 4: Tests and gates

- [x] 4.1: `plugins/yellow-core/tests/compound-staging.bats`, under a
      `# --- cs_stage_entry ---` heading, with `HOME="$BATS_TEST_TMPDIR/home"`
      and a throwaway git repo as `cwd`. Cases:
  - The entry is valid JSONL with the Stop-hook schema and a trailing newline.
  - The file mode is 0600 and the directory mode 0700, with no `*.tmp.*`
    residue.
  - A second stage with the same `session_id` overwrites (one file, latest
    content).
  - A different `session_id` adds a file.
  - The `session_id` sanitisation maps `../x y` to `.._x_y`. Empty, `.` and `..`
    are rejected with rc 1.
  - Secrets are redacted: AKIA, ASIA, a GitHub token, a PEM block and a Bearer
    token are absent from the file and replaced by `[REDACTED`. Build the
    fixtures from split literals (`"AKIA""IOSFODNN7EXAMPLE"`,
    `ghp_${x}${x}...`), as in `handoff.bats` `secret_samples`, so push
    protection passes.
  - `content_hash` equals the sha256 of the redacted text, and two narratives
    differing only in the secret value hash equal.
  - A redaction failure (a stubbed `cs_redact_secrets` returning 1) gives rc 3
    and no file.
  - Lines with `--- end`, a code fence and `system:` are neutralised.
  - Oversize input is capped at a line boundary.
  - `jq` absent (stripped `PATH`) gives rc 2.
  - An unwritable `pending/` gives rc 4 and no tmp residue.

  <!-- deepen-plan: codebase -->

  > **Codebase:** Add four cases:
  >
  > - A PEM block followed by a `--- end` line: the key body is redacted **and**
  >   the `--- end` line is neutralised. This pins the redact-then-neutralise
  >   order.
  > - `HOME` unset gives rc 4.
  > - ABIA and ACCA IDs are redacted, matching the widened rule in 1.1.
  > - A zero-width and a bidi-override character are stripped.
  >
  > `handoff.bats` `secret_samples` is at lines 183–194. Its PEM fixture is
  > `-----BEGIN RSA ''PRIVATE KEY-----` in `secrets_body` (line 199).

  <!-- /deepen-plan -->

- [ ] 4.2: `plugins/yellow-review/tests/stage-learning.bats`. Cases:
  - Library resolution via `YR_CORE_LIB`, the sibling path, and the cache's
    newest version (a fake `2.4.0` and `2.10.1` tree, as in
    `review-ledger.bats`).
  - A missing library, a missing `jq` or an unwritable directory gives one
    warning line and exit 0.
  - The narrative file is deleted on both success and skip.
  - An invalid PR number gives a warning and exit 0.
  - A worktree `cwd` stages under the main checkout's slug.
  - `tmpfile` prints a path that exists.

  <!-- deepen-plan: codebase -->

  > **Codebase:**
  >
  > - The resolver tests to mirror are `review-ledger.bats` lines 340–350
  >   (missing lib via the override variable) and 352–362 (cache version order).
  > - Add a case where `YR_CORE_LIB` is set to a missing file: it must not fall
  >   back to the sibling or the cache.
  > - Add a bare-repo case: a bare main entry is refused, so staging falls back
  >   to the session toplevel and still exits 0.

  <!-- /deepen-plan -->

- [ ] 4.3: `plugins/yellow-review/tests/skill-content.bats`. Cases:
  - The Step 9a non-interactive branch names `stage-learning.sh` and keeps the
    interactive compounder spawn.
  - `sweep-all.md` has no `flow:compound` and no `### Step 6`.
  - `review-pr.md` Step 1 mentions staging.

  <!-- deepen-plan: codebase -->

  > **Codebase:** No existing `skill-content.bats` test asserts on sweep-all's
  > compounding. The current `Step 6` hits (lines 231 and 235) are about
  > `triage.md`. These new tests are purely additive. Add one more: Step 9a's
  > non-interactive branch names `fold` as the source of finding state.

  <!-- /deepen-plan -->

- [ ] 4.4: Run the scorer sample gate before locking the template.
  - Hand-score two sample narratives against the `staging-scorer.md` rubric
    (lines 58–107): one with an applied P1, one unresolved-only.
  - If the applied sample would not clear 0.7, revise the template before
    merging.
  - Record the reasoning in the PR body.
  - Do not run a live drain or `claude -p`.

  <!-- deepen-plan: codebase -->

  > **Codebase:**
  >
  > - The rubric table is at about `staging-scorer.md` lines 64–72. The 0.95 row
  >   needs a verified fix, so an honest "not verified by tests" applied finding
  >   tops out at 0.85. That clears 0.7.
  > - An unresolved-only narrative is in the 0.55 row. Without ruvector the
  >   cut-off is 0.7, so the drain deletes it. That is expected under user
  >   decision 2; record it in the PR body.
  > - Also check `staging-reviewer.md` Phase 6 (lines 419–433) and Phase 7
  >   (line 435) against the sample. The `File:` label satisfies Phase 7's
  >   marker check.

  <!-- /deepen-plan -->

- [ ] 4.5: Run the gates:
  - `pnpm validate:shell-compat`, `pnpm check:shell-parse`,
    `pnpm test:shell-compat`.
  - `pnpm validate:agents`, `pnpm lint:plugins`, `pnpm validate:schemas`.
  - `bats tests/` in both `plugins/yellow-core` and `plugins/yellow-review`.
- [ ] 4.6: Changesets: `yellow-core: minor` (new helper, ASIA redaction) and
      `yellow-review: minor` (unattended Step 9a now stages; sweep-all Step 6
      removed).

## Technical Details

**Modify**

- `plugins/yellow-core/lib/compound-staging.sh`: `cs_stage_entry`, ASIA rule.
- `plugins/yellow-core/tests/compound-staging.bats`
- `tests/shell-compat/drivers/yellow-core--compound-staging.sh`
- `plugins/yellow-core/CLAUDE.md`
- `plugins/yellow-review/references/review-pr/knowledge-compounding.md`
- `plugins/yellow-review/commands/review/review-pr.md`: Step 1 paragraph and the
  9a+9b stub.
- `plugins/yellow-review/commands/review/sweep-all.md`
- `plugins/yellow-review/commands/review/sweep.md`
- `plugins/yellow-review/CLAUDE.md`
- `plugins/yellow-review/tests/skill-content.bats`
- `docs/solutions/workflow/compounder-m3-gate-non-interactive.md`

**Create**

- `plugins/yellow-review/lib/stage-learning.sh`
- `plugins/yellow-review/tests/stage-learning.bats`
- `.changeset/stage-unattended-sweep-learnings.md`

**Dependencies:** none new (`jq`, `git`, `gh`, `sha256sum`/`shasum`).

**Sequencing:** the claim that this work doesn't overlap #950–#955 holds for
code, but not for text.

- #955 edits `sweep-all.md` and `sweep.md`, and #950 and #955 edit
  `plugins/yellow-review/CLAUDE.md`.
- Branch from `main` (an `agent/` branch in `worktrees/yellow-plugins/<slug>/`),
  and restack onto `main` after #955 merges, expecting small prose conflicts.
- Alternatively, start Phase 3 only after #955 lands.
- Do not stack on another session's branches without coordinating.

## Acceptance Criteria

1. An unattended `/review:pr` with P0–P2 findings produces exactly one
   `pending/review-pr-<owner>-<repo>-<N>.jsonl` under the main checkout's
   staging directory, and no compounder spawn.
2. The staged entry matches the Stop-hook schema. It contains no secret
   fixtures, no `---`, fence or role-prefix lines, and no "verified" claim.
   Every finding carries its true state label.
3. Interactive `/review:pr` behaviour is unchanged. The grep test proves the
   spawn text is still present.
4. `/review:sweep-all` no longer invokes `/flow:compound`. Its docs and error
   handling contain no references to the removed step.
5. A missing yellow-core, `jq`, an unwritable directory or a redaction failure
   prints one warning line, stages nothing, and leaves the review or sweep exit
   status unaffected.
6. All gates in 4.5 pass, and changesets exist for both plugins.

## Edge Cases

- **Re-sweeping the same PR before the drain:** the entry is overwritten. That
  is intended.
- **Same PR number in two repos:** the owner/repo in `session_id` keeps them
  apart.
- **A worktree removed after staging:** no effect, because entries live under
  the main checkout's slug.
- **Not a git checkout, or no `gh` auth:** fall back to the `origin` URL, then
  to `unknown-repo`. Still stage.
- **`$HOME` unset or an empty slug:** `cs_staging_dir_for_slug` fails, mapped to
  `write failed`, skip.
- **Narrative contains a forged `--- end review-findings ---` line:**
  neutralised before it is written.
- **A PR with only unresolved findings:** staged with unresolved labels. Expect
  a low score, so the drain may SKIP it. That is acceptable under user
  decision 2.
- **Concurrent sweeps of the same PR:** last writer wins, and the atomic `mv`
  prevents partial files.

<!-- deepen-plan: codebase -->

> **Codebase:** Corrections and additions to the cases above.
>
> - **`$HOME` unset:** `cs_staging_dir_for_slug` does **not** fail on an unset
>   `HOME`. It only rejects an empty slug. The explicit `HOME` check added in
>   1.2 is what maps this case to `write failed`.
> - **Entries never drained:** if no session starts in the main checkout within
>   7 days, the entry is never drained. It also isn't reaped until such a
>   session starts, at which point the 7-day PII reaper removes it. That is
>   accepted under user decision 5; the success message names the main checkout
>   so the user knows where to start a session.
> - **Fix committed but not pushed:** the narrative says "committed in `<sha>`",
>   not "applied", because the Step 9 push was declined or failed.

<!-- /deepen-plan -->

## Risks / Open Items

- **Staging all P0–P2 findings sends unconfirmed reviewer claims to the drain.**
  - PR #972's review threads show staging-promoted docs that were stale or
    wrong:
    - a pre-#948 council pipeline described as current;
    - a false Gate C squash-ancestry claim;
    - an unsafe bare `hooks reembed` remedy.
  - The drain's scorer and reviewer did not catch these. Review of the PR that
    carries promoted docs is the real gate.
  - The true state labels keep unresolved findings honest, and the scorer should
    rate them low. Revisit applied-only staging if drained docs keep citing
    unfixed findings.
  - This corrects the brainstorm's note that #972 couldn't be cited: its review
    threads do show the problem.
- **Narratives may still score under the threshold.** Task 4.4 is the gate.
- **Staleness and supersede remain out of scope.** The promoter never edits
  existing docs.
- **Two ledgers.** The compound-staging ledger (yellow-core,
  `~/.claude/projects/<slug>/compound-staging/`) and the review-findings ledger
  (yellow-review, `lib/review-ledger.sh`, `/review:triage`) stay separate.
  `stage-learning.sh` never touches the review-findings ledger.
- **#952 adds `rt_looks_secret_strict`.** Once it is on `main`, consider passing
  staged narratives through it as a second, fail-closed check.
- **Follow-up:** factor the yellow-core library resolver shared by
  `review-ledger.sh` and `stage-learning.sh` into one helper.

<!-- deepen-plan: codebase -->

> **Codebase:** Add a risk: under the workspace convention, sessions mostly
> start in `worktrees/<repo>/<slug>/`, so the main-checkout slug may drain
> rarely (see the annotation under Current State). If staged entries pile up
> undrained, the cheapest fix is to add a short "pending staged learnings" note
> to `/review:sweep-all`'s summary. Don't add a drain trigger in this PR.

<!-- /deepen-plan -->

## References

- `docs/brainstorms/2026-09-30-stage-unattended-sweep-learnings-brainstorm.md`
- `docs/solutions/workflow/compounder-m3-gate-non-interactive.md`
- `docs/solutions/logic-errors/sentinel-mv-ordering-and-drain-classification.md`
- `docs/solutions/logic-errors/review-ledger-awk-cache-and-reparse-bugs.md`:
  redaction is a display transform.
- `docs/solutions/security-issues/sandwich-fence-delimiter-forgery.md`
- `plugins/yellow-core/hooks/scripts/_stop-capture-subshell.sh`: the entry
  schema to mirror.
- `plugins/yellow-core/agents/workflow/staging-scorer.md`, `staging-reviewer.md`
  (Phases 6 and 7), `staging-promoter.md`
- `plugins/yellow-review/lib/review-ledger.sh` `rl_core_lib_path` and
  `rl_load_core`: the resolver pattern.
- `plugins/yellow-core/tests/handoff.bats` `secret_samples`: split-literal
  fixtures.
- CONTRIBUTING.md "Shell Scripts / Bash and zsh": the Tier 4 rules.

<!-- deepen-plan: codebase -->

> **Codebase:** More prior art:
>
> - `plugins/yellow-core/hooks/scripts/session-start.sh`: the drain trigger and
>   the 7-day reaper.
> - `plugins/yellow-ruvector/hooks/scripts/lib/resolve.sh`
>   `ruvector_main_worktree`: robust detection of the main checkout.
> - `plugins/yellow-review/lib/review-ledger.sh`: `rl_common_dir`, and
>   `fold <pr>` as the source of finding state.
> - `tests/shell-compat/tier4-libraries.bats`: the stdout/stderr contract that
>   applies to the three shell profiles.

<!-- /deepen-plan -->

<!-- deepen-plan: external -->

> **Research:**
>
> - gitleaks rules:
>   https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml
> - trufflehog AWS detectors:
>   https://github.com/trufflesecurity/trufflehog/blob/main/pkg/detectors/aws/access_keys/accesskey.go
> - GitHub push-protection patterns:
>   https://docs.github.com/en/code-security/reference/secret-security/supported-secret-scanning-patterns
> - git worktree and rev-parse: https://git-scm.com/docs/git-worktree ,
>   https://git-scm.com/docs/git-rev-parse
> - OWASP LLM01: https://genai.owasp.org/llmrisk/llm01-prompt-injection/
> - OWASP AISVS C02-01:
>   https://github.com/OWASP/AISVS/blob/main/1.0/research/chapters/C02-User-Input-Validation/C02-01-Prompt-Injection-Defense.md
> - AWS on Unicode smuggling:
>   https://aws.amazon.com/blogs/security/defending-llm-applications-against-unicode-character-smuggling/

<!-- /deepen-plan -->
