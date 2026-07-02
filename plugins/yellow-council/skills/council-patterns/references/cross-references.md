# Cross-references — council-patterns

Provenance and cross-plugin pointers moved verbatim from
`council-patterns` SKILL.md (C6 progressive-disclosure split). This is
non-executed background: nothing at council runtime reads these bullets
(the live CLI flag patterns are inline in SKILL.md's "Reviewer-Specific
CLI Flag Pattern" section, which stays preloaded).

- `yellow-codex:codex-patterns` — Codex CLI invocation conventions, exit
  code catalog, sandbox/approval modes. yellow-council reuses these for the
  Codex reviewer leg via Task spawn — do not duplicate the codex-patterns
  content here.
- `docs/spikes/gemini-cli-output-format-2026-05-04.md` — verified Gemini CLI
  v0.40+ invocation: `gemini -p "..." --approval-mode plan --skip-trust -o text`.
  Do NOT use `--yolo` (issue #13561).
- `docs/spikes/opencode-cli-format-json-2026-05-04.md` — verified OpenCode
  CLI v1.14+ invocation: `opencode run --format json --variant high "..."`
  plus `opencode session delete <id>` cleanup.
