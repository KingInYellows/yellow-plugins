# Codex plugin contract spike — six empirical findings

**Date:** 2026-07-16
**Verified against:** codex-cli 0.144.1 · Claude Code 2.1.211 (provenance only — latest CLI is the support target)
**Method:** throwaway `spike-fixture` plugin + local `.agents/plugins/marketplace.json` marketplace in a temp `CODEX_HOME`; throwaway Claude plugin + local marketplace in a temp `CLAUDE_CONFIG_DIR`. Live `codex exec` sessions ran against real auth (copied into the temp home for the session, deleted after).
**Consumes/updates:** the three unverified items in `docs/solutions/integration-issues/codex-plugin-manifest-and-hook-contract.md` plus the Claude-side re-tests in `docs/solutions/build-errors/ci-schema-drift-hooks-inline-vs-string.md`. Input to shells 02–05 of `plans/specs/claude-code-codex-plugin-pilot.md` (R17).

## (a) How arguments reach a Codex skill

**Finding: prompt-text pass-through; no `$ARGUMENTS` primitive.**
`codex exec "/spike-echo hello-from-spike-42"` delivered the invocation as
the verbatim user message. The model saw the plugin's skills listed in
context as `spike-fixture:spike-echo: <description> (file: <cached
SKILL.md path>)`, read the SKILL.md itself (`sed -n '1,240p' …SKILL.md`),
and followed its instruction to echo "the literal argument text the user
provided after the skill name" — output `SPIKE-ARG-RECEIVED=hello-from-spike-42`.
**Working pattern for ports:** write Codex-side SKILL.md bodies to reference
"the argument text the user provided after the skill name" in prose; any
Claude `$ARGUMENTS` interpolation must be rewritten to that phrasing.
Skills are namespaced `<plugin-name>:<skill-name>` in the model's context.

## (b) Scriptable plugin-list surface

**Finding: `codex plugin list --json` and `--available` both exist and work.**
`codex plugin list --help` documents `--json` ("Output plugin list as
JSON") and `--available` ("Include uninstalled marketplace plugins in the
JSON output"), with `codex plugin list --available --json` as a verbatim
help example. Observed output shape:

```json
{
  "installed": [ { "pluginId": "spike-fixture@spike-marketplace",
    "name": "…", "marketplaceName": "…", "version": "local",
    "installed": true, "enabled": true,
    "source": { "source": "local", "path": "…" },
    "marketplaceSource": { "sourceType": "local", "source": "…" },
    "installPolicy": "AVAILABLE", "authPolicy": "ON_INSTALL" } ],
  "available": [ ]
}
```

`version` is `null` for an uninstalled local-source entry and `"local"`
once installed. `codex plugin add` requires `<plugin>@<marketplace>` (or
`--marketplace`); bare `codex plugin add spike-fixture` errors. Safe to
script CI against.

## (c) `agents/openai.yaml` non-implicit skill invocation field

**Finding: the file is not parsed from plugins at all on 0.144.1.**
A plugin shipping `agents/openai.yaml` with
`skills: [{name: spike-echo, allow_implicit_invocation: false}]` changed
nothing observable: the skill still appeared in the model's skill list
identically, and no session content referenced the file. Falsification
test: replacing it with **syntactically invalid YAML** produced zero
errors or warnings at `codex plugin add`, at session start, and in
`codex doctor`. Conclusion: there is no functioning openai.yaml surface in
plugins on this version — treat the third-party `allow_implicit_invocation`
claim as nonexistent until a future CLI parses the file.

## (d) Manifest hook-path override (`"hooks": "./hooks/codex-hooks.json"`)

**Finding: accepted by the manifest parser, but plugin hooks never execute
— the `plugin_hooks` feature is stage `removed` on 0.144.1.**
Install with the override succeeded (plugin enabled, no validation error).
A SessionStart hook writing a sentinel file never fired across multiple
`codex exec` sessions. `codex features list` shows `hooks` stable/true and
`plugins` stable/true but `plugin_hooks` **removed/false**; force-setting
`features.plugin_hooks=true` in config.toml and passing
`--enable plugin_hooks` still produced no hook execution. Consequence for
the pilot: **hooks cannot be distributed via Codex plugins on 0.144.1** —
Codex-side hook delivery must go through repo/user hook configuration, and
any generated `codex-hooks.json` is inert until upstream restores the
feature. Re-test `codex features list | grep plugin_hooks` on future CLI
versions before building on this.

## (e) File-referenced `mcpServers` on Claude (`"mcpServers": "./.mcp.json"`)

**Finding: accepted by both `claude plugin validate` and a clean install.**
A fixture with `"mcpServers": "./.mcp.json"` (server defs in the
referenced file) passed `claude plugin validate` ("Validation passed",
exit 0) and installed cleanly via
`claude plugin marketplace add <local dir>` +
`claude plugin install claude-spike-fixture@spike-claude-marketplace`
(user scope) in a fresh `CLAUDE_CONFIG_DIR` on 2.1.211.

## (f) String file path for `hooks` on Claude (Feb 2026 inline-only re-test)

**Finding: now accepted — the Feb 2026 inline-only restriction is gone.**
The same fixture carried `"hooks": "./hooks/hooks.json"` (string path, not
inline object) through both `claude plugin validate` and the clean install
above without any error on 2.1.211. The earlier remote-validator rejection
of string hook paths (see
`docs/solutions/build-errors/ci-schema-drift-hooks-inline-vs-string.md`)
no longer reproduces. Note this repo's local `schemas/plugin.schema.json`
may still be stricter than the live validator — local schema policy is a
separate decision from what Claude Code itself accepts.

## Incidental observations

- The Codex marketplace contract from the planning research reproduced
  exactly: `.agents/plugins/marketplace.json` with version-less entries
  (`name`, `source: {source: "local", path}`, `category`,
  `policy.installation`, `policy.authentication`) installs and lists.
- `codex plugin add` copies the plugin to
  `$CODEX_HOME/plugins/cache/<marketplace>/<plugin>/local` and records
  `[marketplaces.<name>]` + `[plugins."<name>@<marketplace>"] enabled = true`
  in `config.toml`.
- A `CODEX_HOME` under `/tmp` triggers a benign warning: codex refuses to
  create PATH-alias helper binaries there.
- `codex plugin remove` requires the full `<plugin>@<marketplace>` id.
