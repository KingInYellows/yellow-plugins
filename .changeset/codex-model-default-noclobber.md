---
'yellow-codex': patch
---

Drop the hardcoded `gpt-5.4` model default. Every `codex exec` site now
passes `${CODEX_MODEL:+-m "$CODEX_MODEL"}` — the flag appears only when
`CODEX_MODEL` is set, so codex resolves the model from `~/.codex/config.toml`
and then the account default (OpenAI lists `gpt-5.4` / `gpt-5.4-mini` as
legacy and ChatGPT-account auth rejects them with HTTP 400, exit 1).
`/codex:setup`'s smoke test keeps one explicit cheap model
(`CODEX_SMOKE_MODEL`, default `gpt-5.6-luna`) and retries once without `-m`
on rejection. `codex-reviewer`'s exit-1 arm recognises the model rejection
and returns `verdict=UNAVAILABLE` naming the rejected model. All thirteen
`mktemp` + plain `>`/`2>` redirects in the plugin are now `>|`/`2>|` so the
commands run under zsh `noclobber`. The reviewer's 6-key return contract is
unchanged.
