---
"yellow-devin": patch
"yellow-research": patch
"yellow-morph": patch
"yellow-semgrep": patch
---

# Fix `userConfig` manifest validator drift — add required `type` and `title`

Add `"type": "string"` and `"title": "<sentence-case label>"` to every
`userConfig` entry in the four plugins that declared user-supplied
credentials. The Claude Code remote validator (surfaced via `claude doctor`)
rejects any `userConfig` entry missing either field; local CI was passing
because `schemas/plugin.schema.json` made `type` optional and used `label`
instead of `title`.

Affected entries (7 total):

- `yellow-devin`: `devin_service_user_token`, `devin_org_id`
- `yellow-research`: `perplexity_api_key`, `tavily_api_key`, `exa_api_key`
- `yellow-morph`: `morph_api_key`
- `yellow-semgrep`: `semgrep_app_token`

Companion changes outside the plugins (no changeset needed — repo root):

- `schemas/plugin.schema.json` — `userConfigEntry` tightened: `type` and
  `title` now required, `type` enum extended with `directory` and `file`
  (parity with remote validator), unused `label` property removed, dead
  `allOf` branch (the `if not required type` fall-through) removed,
  `directory`/`file` default-type-string constraint branches added.
- `scripts/validate-plugin.js` — RULE 9 added: hand-rolled `userConfig`
  enforcement (per-entry `type` enum check + `title` non-empty string
  check). The repo's local CI does not currently AJV-load
  `plugin.schema.json`, so script-level enforcement is what actually
  catches this drift before `claude doctor`.
- `docs/solutions/build-errors/userconfig-type-title-remote-validator-drift.md` —
  new solutions doc cross-referencing the prior `changelog`/`repository`
  drift incidents.

**Behavior change for users:** `sensitive: true` (or `false` for
`devin_org_id`) is preserved verbatim — keychain storage and credential
masking are unchanged. The new `title` field is a UI label only; it never
carries the credential value. Plugin install behavior is unchanged for
existing users; the change unblocks fresh installs that hit the strict
remote validator.
