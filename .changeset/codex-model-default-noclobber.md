---
'yellow-codex': patch
---

Drop the hardcoded `gpt-5.4` model default. Every `codex exec` site now
passes `${CODEX_MODEL:+-m} ${CODEX_MODEL:+"$CODEX_MODEL"}` — the flag appears only when
`CODEX_MODEL` is set, so codex resolves the model from `~/.codex/config.toml`
and then the account default (OpenAI lists `gpt-5.4` / `gpt-5.4-mini` as
legacy and ChatGPT-account auth rejects them with HTTP 400, exit 1).
`/codex:setup`'s smoke test probes the same no-`-m` shape (`CODEX_SMOKE_MODEL`
forces a model for the probe only, retried without it on a 400) and reports
timeouts and 400s distinctly. Every `--json` site now captures stdout and
stderr into one diagnostics file — with `--json` the API refusal is a stdout
JSONL `{"type":"error"}` event — and reads only those events: model
rejection is diagnosed by name at every site (`codex-reviewer` returns
`verdict=UNAVAILABLE`), rate limits are detected again, and the generic arm
prints a bounded, fenced, redacted excerpt instead of a raw dump. All sixteen
`mktemp` + plain `>`/`2>` redirects in the plugin are now `>|`/`2>|` so the
commands run under zsh `noclobber`. The reviewer's 6-key return contract is
unchanged.
