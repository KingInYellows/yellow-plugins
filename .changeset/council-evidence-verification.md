---
'yellow-council': minor
'yellow-core': patch
---

feat: evidence verification and the five-bucket council report.

- `yellow-council`: Step 5b numbers every finding (`S<n>-F<k>`) in shell and
  checks its quoted `Evidence:` line against the cited file in the background:
  a strict citation parse first, then Tier 1, an exact match within three
  lines through yellow-core's `quote-ground.sh batch`, then Tier 2, a fuzzy
  match (`max(ratio, partial_ratio)` at 85) through the optional python3
  `rapidfuzz` (`sudo apt install python3-rapidfuzz` on Debian/Ubuntu), capped
  at 50 candidates per reviewer label. Verification classifies and never
  drops a finding.
- `yellow-council`: rubric correctness is verification-backed instead of
  self-assessed, and 5e assigns five buckets in shell — Agreement (verified),
  Agreement (unverified), Disagreement, Single-Reviewer Findings (verified),
  Unverified Claims (each with its reason). Codex findings carry no quote, so
  they are always `no-evidence` (#1180).
- `yellow-council`: the synthesis helpers move to a Tier 4 library,
  `lib/council-synthesis.sh` (F1); an unclosed fence is normalized as
  ordinary text (F3); emphasis stripping keeps identifiers such as
  `__init__`, `_private_fn` and `*ptr` (F4); Step 7 stages the synthesis
  through a token-checked file instead of a heredoc (F2).
- `yellow-council` now declares yellow-core `>=2.8.0` as a required
  dependency: Claude Code disables yellow-council when yellow-core is
  missing, disabled or older.
- `yellow-core`: the README's quote-grounding note names its yellow-council
  caller.
