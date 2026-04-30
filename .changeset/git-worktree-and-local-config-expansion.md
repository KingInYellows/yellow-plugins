---
"yellow-core": patch
---

Wave 3 — git-worktree skill fixes (W3.4) + local-config schema expansion (W3.6).

`yellow-core` (PATCH — additive documentation):

- **`git-worktree` skill (W3.4):** Add two new sections covering common
  worktree pitfalls:
  - Auto-trust mise/direnv configs after worktree creation. Trust is
    keyed on absolute path, so a new worktree starts untrusted until
    `mise trust` / `direnv allow` runs in the new directory.
  - `.git`-is-a-file detection (submodule and linked-worktree cases).
    Naive `[ -d .git ]` checks misclassify both cases as "not a git
    repo"; use `git rev-parse --git-dir` instead. Includes a typed
    detector pattern (`git_dir_kind`).
- **`local-config` skill (W3.6):** Expand the W2.7 minimum schema to
  document the three forward-compatible Wave 3 keys:
  - `stack` — array of `ts`/`py`/`rust`/`go` to scope language-specific
    review behavior (acted on by W3-pending polyglot scoping).
  - `agent_native_focus` — boolean to force the W3.5 agent-native
    reviewer triplet regardless of diff triggers (acted on by W3.5).
  - `confidence_threshold` — integer 0–100 to override the Wave 2
    aggregation gate (acted on by W3.13b).
  Adds a "Consumer adoption status" table making per-key pending state
  explicit, plus validation rules covering each new key (clamping,
  unknown-entry handling, type coercion). Replaces the prior "Wave 3
  expansion (preview)" stub with first-class schema documentation.

No consumer commands change in this PR — the keys remain documented but
ignored until W3.5 / W3.13b / polyglot scoping land. Authors may set
them today; the existing forward-compatibility rule (unknown keys emit
a warning, do not abort) keeps the file valid both before and after the
consumer commands adopt them.
