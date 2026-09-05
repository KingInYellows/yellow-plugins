# Cross-references — council-patterns

Provenance and cross-plugin pointers moved verbatim from
`council-patterns` SKILL.md (C6 progressive-disclosure split). This is
non-executed background: nothing at council runtime reads these bullets
(the live CLI flag patterns are inline in SKILL.md's "Reviewer-Specific
CLI Flag Pattern" section, which stays preloaded).

- `yellow-codex:codex-patterns` — Codex CLI invocation conventions, exit
  code catalog, sandbox/approval modes. yellow-council reuses these for the
  Codex reviewer leg via the Agent tool spawn — do not duplicate the codex-patterns
  content here.
- `docs/spikes/antigravity-cli-headless-2026-08.md` — verified Antigravity
  CLI (agy 1.0.2) invocation for the Gemini slot: `cd <pack-dir> && agy
  --sandbox --print-timeout <duration> -p "<pointer>"` with ingest-token
  echo verification. agy ignores piped stdin; `--sandbox` does NOT block
  writes (cwd containment + prompt prohibition instead); do NOT use
  `--dangerously-skip-permissions`.
- `docs/spikes/gemini-cli-output-format-2026-05-04.md` — provenance only:
  the retired consumer-tier Gemini CLI invocation this plugin used before
  Google's 2026-06-18 shutdown.
- `docs/spikes/opencode-cli-format-json-2026-05-04.md` — verified OpenCode
  CLI v1.14+ invocation: `opencode run --format json --variant high "..."`
  plus `opencode session delete <id>` cleanup.
