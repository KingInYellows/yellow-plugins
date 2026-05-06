---
"yellow-research": patch
---

# Fix `/research:setup` Perplexity diagnostic + correct stale shell-env docs

Two related fixes that address user confusion after the v2.0.0 migration
to userConfig-backed credentials.

## Setup-time diagnostic

Append a v2.0.0 migration hint to the Perplexity / Tavily / EXA "INVALID
(HTTP 401)" decision branch in `/research:setup` Step 3. When a user has
a key set only in shell env (not userConfig), the curl probe runs and may
return HTTP 401 — but that 401 is structurally ambiguous. Two distinct
causes:

- (a) The key is genuinely expired or revoked.
- (b) The key in shell env is valid, but `plugin.json` now reads
  `${user_config.<name>}` rather than the shell env, so the MCP never
  sees the key and fails at startup (Perplexity) or runtime (EXA /
  Tavily) regardless.

The new message names both causes and tells the user how to act on
each: regenerate at the provider dashboard for (a), `/plugin disable
yellow-research && /plugin enable yellow-research` to answer the
userConfig prompt for (b). Ceramic's branch is unaffected — it has no
userConfig entry; its REST probe and MCP authentication are independent
and the diagnostic is gated on `provider_has_userconfig_path=1`.

Implementation detail: each of the three userConfig-capable provider
probe blocks now sets `provider_has_userconfig_path=1`; Ceramic sets
it to `0`. The shared decision tree's 401/403 branch reads the flag
together with `SKIP_CURL_PROBE` to distinguish "key from shell env" from
"key from userConfig" runs.

## Doc corrections

The README and `research-patterns` SKILL.md still instructed users to
`export *_API_KEY` in `~/.zshrc` and "restart Claude Code." That guidance
became stale on PR #259 / v2.0.0 (May 5, 2026) — `plugin.json` reads
`${user_config.<key>}` exclusively. Following the old instructions
silently traps every new user: shell env appears configured but the MCPs
never see the key. The instructions are replaced with the
`/plugin disable && /plugin enable` userConfig prompt path, with the
shell-env-only fallback documented for power users who want a wrapper
script.

`CERAMIC_API_KEY` is still documented as a shell-env var because it
gates the REST live-probe in `/research:setup`, not the MCP server (which
uses OAuth) — that part is correct and unchanged.

## Out of scope

- Restoring shell-env-as-MCP-input. PR #259 deliberately moved auth to
  the OS keychain as a hardening pass; that decision stands.
- Investigating whether the user's specific Perplexity key is itself
  expired. The diagnostic distinguishes the two failure modes so the
  user can act on the right one.
