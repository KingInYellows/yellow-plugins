---
title: 'Constraints when extending council.md with per-reviewer steps or anonymization'
date: 2026-09-30
category: code-quality
track: knowledge
problem: 'council.md has validator-locked loops, a fixed 4-column state file, per-fence subprocess isolation and mirrored cleanup sites that constrain new synthesis steps'
tags: [yellow-council, council-md, validator, state-file, anonymization, synthesis, temp-artifacts, flag-parsing, determinism]
components: [yellow-council]
---

# Constraints when extending council.md

## Context

Constraints in `plugins/yellow-council/commands/council/council.md` that bite
at implementation time, not plan time. Verified against the shipped file
(synthesis pipeline, Step 5).

## Guidance

1. **One fixed reviewer loop.** `scripts/validate-council-roster.js` Rule D1
   requires exactly one column-0 line matching
   `^for reviewer in ([a-z0-9 ]+); do$` (the Step 7 appendix loop). New
   per-reviewer loops must iterate `"${STATE_REVIEWERS[@]}"` or use another
   variable name. The order of that fixed loop drives report-section order.
2. **Cross-fence state is a printed literal.** Each bash fence is a fresh
   subprocess. `$STATE_FILE` (`.git/council-state.tsv`) has exactly four TSV
   columns (reviewer, verdict, confidence, fenced_path), is truncated in Step 4,
   and does not persist summary or findings text. Do not add rows or columns:
   Steps 6/7/8/9 parse every row as a reviewer. Pass new values between fences
   as a printed literal substituted into the next fence (the
   `CLAUDE_FENCED_FILE` pattern). Step 5 hands off its staging directory the
   same way: a printed `mktemp -d /tmp/council-synth-*` literal plus a `.token`
   check, guarded by shape and identity when substituted.
3. **Add synthesis stages to the existing Step 5 fences.** 5a stages, 5b holds
   the `council-synthesis-lib` (`council_normalize_text`, `council_fence_block`,
   `council_assign_labels`) and 5e substitutes literals. Extend those rather
   than adding parallel fences.
4. **Synthesis-input fences are uniform and anonymous.** Every leg is fenced as
   `council-output:S<n>`, with `S<n>` a random bijection from
   `council_assign_labels`. Do not reintroduce reviewer-named labels there. The
   raw-output appendix in the persisted report keeps `council-output:<reviewer>`
   (`codex-output` for Codex), and `[ESCAPED]` substitution must cover both
   delimiter forms. Reviewer-specific severity spellings (Codex `[P1]`) are
   canonicalized to `severity=P<n>` by the normalizer.
5. **Normalize before verify is a latent coupling.** Style normalization must
   preserve backtick code spans, `<file>:<line>` citations and the verbatim
   quoted source line byte-for-byte. `verify_finding()` compares the quote to
   the file; stripping `**` or `_` (valid in code) makes true citations fail.
6. **Stage untrusted reviewer text with the Write tool, not a heredoc.** Write
   into a not-yet-existing child of the mktemp dir (see
   `docs/solutions/security-issues/heredoc-delimiter-collision.md`). Codex's
   summary exists only in its Agent return, because its fenced file holds
   findings only, so synthesis input cannot be read uniformly from fenced
   files.
7. **Every new temp artifact needs reclaiming on every exit path.** The
   per-reviewer shape-checked cleanup is mirrored by hand in Step 6
   (`council_cleanup_temps`), Step 8 and Step 9; change one, change all. The
   Step 7 guard (`council_cleanup_claude_only`) is a separate case: it runs
   when the state file is missing or unusable, so it only reclaims the minted
   Claude fenced path and the state file, not per-reviewer files. A new
   artifact that exists before reviewer rows are readable needs its own
   reclaim there. Fenced files also fall to Step 4's age-gated stale sweep. The Step 5 `council-synth-*` directory has
   its own `council_synth_abort`, 5e removal and a second age-gated sweep in 5a.
8. **Flags are parsed per fence.** Step 3's loop ignores unknown flags
   (`*) shift`), so a new flag is a silent no-op until it gets an arm.
   `--single-pass` is stripped by an identical `sed` in Steps 2, 3 and 6, which
   `tests/synthesis.bats` keeps in sync; later fences re-derive `REST` the same
   way.
9. **Finding ids are stable, flip detection is prompt-level.** The Pass A
   enumerator (the Step 5c prompt, not `council_normalize_text`) assigns
   `S<n>-F<k>` ids, and Pass B reuses them so the two tables compare per id.
   Id stability is a prompt-level property, not a deterministic guarantee. The comparison is made by the orchestrator in one context, so it is a
   positional-consistency check, not a blind second evaluation. A flipped finding
   is tagged `low-confidence-synthesis` and never changes bucket.
10. **Randomness comes from `/dev/urandom` via `od`, not `shuf` or `$RANDOM`.**
    `council_assign_labels` draws one `od -An -N4 -tu4` key per reviewer and
    orders with `sort -n`, failing closed when the entropy source is unreadable
    (Step 1 probes it before the fan-out). Reuse that helper for any new
    shuffle; do not fall back to a fixed order.
11. **Validator interplay.** `validate-council-roster.js` Rules T/C/O lint
    numerals next to reviewer nouns. Rule R only proves each redaction-awk
    carrier is represented in the roster; byte-identity of the copies is checked
    by `plugins/yellow-council/tests/redaction.bats`. Assemble bats marker
    strings at runtime, as the `M_ANCHOR` and `M_INNER` assignments in
    `extract.bats`'s `setup()` do.

## When to Apply

Any change to council.md steps 4-9, the synthesis pipeline, or roster handling.
Run `pnpm validate:schemas` (includes council-roster) and
`bats plugins/yellow-council/tests/` after edits.
