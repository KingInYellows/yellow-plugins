---
'yellow-council': minor
'yellow-codex': minor
'yellow-review': patch
---

feat: quota-exhaustion handling and OpenCode fourth-lineage routing for the
four-reviewer council.

- `yellow-council`: a new `QUOTA_EXHAUSTED` verdict, excluded from synthesis like
  `UNAVAILABLE`, returned by each reviewer with the parsed reset ETA,
  `confidence=N/A`, `fenced_output_path=/dev/null` and an empty findings block.
  The headline reads `<reviewer> quota exhausted (<ETA>)`. Detection is
  error-string driven: gemini matches `RESOURCE_EXHAUSTED` only, opencode matches
  provider quota text and HTTP 402, and `/council` classifies a failed claude
  spawn against Claude's session, weekly and Opus limit strings. Transient rate
  limits and HTTP 529 stay `ERROR`. `/dev/null` is accepted only under this
  verdict at the Step 7 appendix, and the unlink loops skip it.
- `yellow-council`: `COUNCIL_OPENCODE_MODEL` selects the OpenCode model by
  presence. Unset routes to `openrouter/deepseek/deepseek-v4-pro`, set but empty
  passes no `--model` (V1), and a non-empty value is passed verbatim. A missing
  model, an unauthenticated provider or HTTP 401/403 returns `UNAVAILABLE` naming
  the fix. `/council` Step 1 prints each slot's resolved model and lineage, warns
  without blocking on a lineage collision or a missing OpenRouter credential, and
  the report header carries a `Models` row. `/council:setup` checks for an
  OpenRouter credential. The routing spike on opencode 1.18.34 is recorded in
  `docs/spikes/opencode-cli-format-json-2026-05-04.md`.
- Upgrade note: with `COUNCIL_OPENCODE_MODEL` unset the OpenCode slot now needs
  OpenRouter auth (`opencode auth login --provider openrouter`). Without it the
  slot returns `UNAVAILABLE` where V1 ran. Set `COUNCIL_OPENCODE_MODEL=""` to keep
  V1 behaviour, or `COUNCIL_OPENCODE_MODEL=opencode/deepseek-v4-pro` for OpenCode
  Zen.
- `yellow-codex`: `codex-reviewer` returns `QUOTA_EXHAUSTED` for
  `insufficient_quota` and `model_cap_exceeded`, checked before the transient
  `rate_limit_exceeded` arm.
- `yellow-review`: `/review:pr` treats a codex `QUOTA_EXHAUSTED` as a skipped
  reviewer and unlinks only an exact `/tmp/council-codex-fenced-*.txt` path, never
  `/dev/null`.
