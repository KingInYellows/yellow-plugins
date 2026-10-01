---
title: 'Constraints when extending council.md with per-reviewer steps or anonymization'
date: 2026-09-30
category: code-quality
track: knowledge
problem: 'council.md has validator-locked loops, a fixed 4-column state file and identity-leaking fence labels that constrain new synthesis steps'
tags: [yellow-council, council-md, validator, state-file, anonymization, synthesis, plan-time, temp-artifacts, flag-parsing, determinism]
components: [yellow-council]
---

# Constraints when extending council.md

## Context

Found while planning synthesis bias mitigation (council-v2 shell 03) against
`plugins/yellow-council/commands/council/council.md`. Each bites at
implementation time, not plan time.

## Guidance

1. **One fixed reviewer loop.** `scripts/validate-council-roster.js` Rule D1
   requires exactly one column-0 line matching
   `^for reviewer in ([a-z0-9 ]+); do$` (the Step 7 appendix loop). New
   per-reviewer loops must iterate `"${STATE_REVIEWERS[@]}"` or use another
   variable name. The order of that fixed loop drives report-section order.
2. **Cross-fence state is a printed literal.** Each bash fence is a fresh
   subprocess. `$STATE_FILE` (`.git/council-state.tsv`) has exactly four TSV
   columns (reviewer, verdict, confidence, fenced_path), is truncated in Step 4,
   and does not persist summary or findings text. Pass new values (label map,
   pass count) by printed literal plus placeholder substitution (the
   `CLAUDE_FENCED_FILE` pattern). Do not add state-file rows or columns; Steps
   7/8/9 assume the fixed shape.
3. **Anonymize the fence label too.** Synthesis fences reviewers as
   `council-output:<reviewer>`, and Codex uses a native `codex-output` label;
   both leak identity. A blind pipeline needs a uniform `council-output:S<n>`
   fence for all legs, with `[ESCAPED]` substitution still covering both
   delimiter forms. Reviewer-specific severity formats (Codex `[P1]`) also leak
   and need canonicalizing.
4. **Normalize before verify is a latent coupling.** Style normalization must
   preserve backtick code spans, `<file>:<line>` citations and the verbatim
   quoted source line byte-for-byte. `verify_finding()` compares the quote to
   the file; stripping `**` or `_` (valid in code) makes true citations fail.

## When to Apply

Any change to council.md steps 4-9, the synthesis pipeline, or roster handling.
Run `pnpm validate:schemas` (includes council-roster) after edits.

---

## Update — 2026-09-30

Additional constraints found while grounding the same shell.

5. **Step 5 had no bash when this was written; it now does (resolved).**
   Step 5 now holds a 5a staging fence, a 5b `council-synthesis-lib` fence
   (`council_normalize_text` and the `council-output:S<n>` label permutation)
   and the 5e literal-substitution fences. Add any new mechanical stage to
   those existing fences rather than creating parallel ones. The pattern is
   unchanged: hand off between fences with a printed
   `mktemp -d /tmp/council-synth-*` literal (plus a `.token` check),
   substituted later and guarded by shape and identity. Do not add
   `$STATE_FILE` rows: Steps 6/7/8/9 parse every row as a reviewer.
6. **Stage untrusted reviewer text with the Write tool, not a heredoc.** Write
   into a not-yet-existing child of the mktemp dir (see
   `docs/solutions/security-issues/heredoc-delimiter-collision.md`). Codex's
   summary exists only in its Agent return, because its fenced file holds
   findings only, so synthesis input cannot be read uniformly from fenced
   files.
7. **Every new temp artifact must be cleaned at five sites.** These are the
   Step 6 `council_cleanup_temps`, the Step 7 guard, Step 8, Step 9, and the
   Step 4 age-gated stale sweep.
8. **Step 3's flag loop ignores unknown flags (`*) shift`).** A new flag such
   as `--single-pass` is a silent no-op until an arm is added. Later fences
   must re-parse `$ARGUMENTS` to see it.
9. **Make flip detection deterministic.** Assign stable finding IDs
   (`[S<n>-F<k>]`) at normalization and have each order-swap pass emit a TSV
   joined with awk. Do not ask the model to self-report flips.
10. **Randomness idiom.** council.md has no `shuf` or `$RANDOM`. Seed awk
    `srand(seed)` from `od -An -N.. /dev/urandom` and run Fisher-Yates in awk.
    Bare `srand()` is weak, and zsh arrays are 1-based, so avoid shell array
    indexing.
11. **Validator interplay.** `validate-council-roster.js` Rules T/C/O lint
    numerals next to reviewer nouns, and Rule R requires byte-identical
    redaction awk. Assemble bats marker strings at runtime
    (`extract.bats:17-21`).
