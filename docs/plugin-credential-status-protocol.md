# Plugin Credential Status Protocol

A shared JSON file written by each credential-bearing plugin during
SessionStart. `/setup:all` reads these files to classify plugins as
READY / PARTIAL / NEEDS SETUP without probing the system keychain.

## File Location

```
${CLAUDE_PLUGIN_DATA}/credential-status.json
```

Resolves to `~/.claude/plugins/data/<plugin-id>/credential-status.json` on
disk (per official Claude Code [plugins reference](https://code.claude.com/docs/en/plugins-reference)).

One file per plugin. Files for different plugins live in different
directories — no cross-plugin write contention.

## Schema

```json
{
  "plugin": "yellow-composio",
  "version": "1.3.0",
  "session_ts": "2026-05-13T18:42:31Z",
  "credentials": [
    {
      "field": "composio_mcp_url",
      "source": "userConfig",
      "present": true,
      "valid": true
    },
    {
      "field": "composio_api_key",
      "source": "shell_env",
      "present": true,
      "valid": null
    }
  ]
}
```

### Fields

| Field | Type | Meaning |
|-------|------|---------|
| `plugin` | string | Plugin name (must match `name` in plugin.json) |
| `version` | string | Plugin version at write time |
| `session_ts` | string | ISO 8601 UTC timestamp when written |
| `credentials` | array | One entry per credential-bearing field |
| `credentials[].field` | string | Field name (must match a `userConfig` key) |
| `credentials[].source` | enum | `"userConfig"` \| `"shell_env"` \| `"absent"` |
| `credentials[].present` | boolean | True if the resolved value is non-empty |
| `credentials[].valid` | boolean\|null | Optional: `true` after a live probe, `false` if probe failed, `null` if unverified |

### Forbidden

The file MUST NOT contain credential values. Only the resolution source
(`userConfig` / `shell_env` / `absent`) and presence boolean. This rule
is currently enforced via code review on the SessionStart hook contents;
a `validate-credential-status.js` companion to `validate-plugin.js`
checking written status files for recognizable credential patterns
(40+ char strings, `sk_*`, `sgp_*`, etc.) is planned but not yet shipped.

## Lifecycle

| Event | Behavior |
|-------|----------|
| First SessionStart after install | File created with all `userConfig` fields enumerated |
| Subsequent SessionStarts | Full overwrite (no append; no merge) |
| `/plugin disable <name>` | File becomes orphaned. Claude Code does not<br/>expose a plugin-disable hook event, so the file persists<br/>until the next SessionStart of an installed-and-enabled<br/>instance overwrites it. Readers treat a stale file as<br/>"status unknown" once the plugin no longer appears in<br/>`claude plugin list`. |
| `/plugin update <name>` | Stale until next SessionStart populates a new file |
| Hook crash / write failure | Silently skipped — readers treat missing file as "unknown" |

## Writer Contract (SessionStart hooks)

Hooks emit JSON via the shared helper:

```bash
source "${CLAUDE_PLUGIN_ROOT}/../yellow-core/lib/credential-status.sh"
# or, if cross-plugin sourcing is not available, copy the helper inline

fields_json=$(cat <<'__EOF__'
[
  {"field": "composio_mcp_url",
   "source": "userConfig",
   "present": true,
   "valid": null},
  {"field": "composio_api_key",
   "source": "shell_env",
   "present": true,
   "valid": null}
]
__EOF__
)

write_credential_status "yellow-composio" "1.3.0" "$fields_json"
```

The helper:

1. Resolves `${CLAUDE_PLUGIN_DATA}` (falls back to
   `~/.claude/plugins/data/<plugin>/`).
2. Writes to a per-invocation unique temp file
   (`credential-status.json.tmp.XXXXXX` via `mktemp`) so concurrent
   SessionStart writers cannot clobber each other's tmp path.
3. Atomically renames to `credential-status.json` (POSIX rename atomicity).
4. Silently exits on any failure — never blocks SessionStart.

The helper does NOT emit `{"continue": true}`. That JSON is the
SessionStart hook's contract with Claude Code, not the writer's. Every
hook that sources this helper is responsible for emitting the response
itself, e.g.:

```bash
source "${CLAUDE_PLUGIN_ROOT}/../yellow-core/lib/credential-status.sh"
write_credential_status "yellow-foo" "1.2.3" "$fields_json"
printf '{"continue": true}\n'
```

## Reader Contract (`/setup:all`)

The dashboard reads each plugin's status file via plain Bash + jq:

```bash
STATUS_FILE="$HOME/.claude/plugins/data/${plugin}/credential-status.json"
if [ -f "$STATUS_FILE" ] && command -v jq >/dev/null 2>&1; then
  present_count=$(jq '[.credentials[] | select(.present == true)] | length' "$STATUS_FILE" 2>/dev/null)
  total_count=$(jq '.credentials | length' "$STATUS_FILE" 2>/dev/null)
else
  # File absent → "credential status unknown"
  present_count=""
  total_count=""
fi
```

Three states the reader handles:

- **File present + parseable** → use the field/source/present data to
  drive classification.
- **File present + malformed JSON** → treat as "status unknown" and emit
  a warning to stderr.
- **File absent** → treat as "status unknown — restart Claude Code or run
  `/plugin disable && /plugin enable`."

The reader NEVER attempts to read the system keychain or shell env vars
not visible to the dashboard Bash subprocess.

## Known Bugs (May 2026)

- [anthropics/claude-code#41156](https://github.com/anthropics/claude-code/issues/41156) —
  writes to `${CLAUDE_PLUGIN_DATA}` may trigger a protected-directory
  prompt even in `bypassPermissions` mode. Hooks must `2>/dev/null || true`
  the write and never block SessionStart.
- [anthropics/claude-code#51398](https://github.com/anthropics/claude-code/issues/51398) —
  in Cowork Desktop, `${CLAUDE_PLUGIN_DATA}` is session-scoped, not
  persistent. Readers treat "file absent" as expected, not as a
  configuration error.

## Why This Protocol

Claude Code does not expose a programmatic API for "which userConfig
fields are populated for this plugin?" outside the plugin's own
subprocess (where `CLAUDE_PLUGIN_OPTION_<KEY>` env vars are injected).
The status file is a deliberate, low-cost bridge between plugin
subprocess context and dashboard context — every credential-bearing
plugin emits one identical-shape file so `/setup:all` can render an
accurate dashboard without per-plugin special-casing.

Plugins planned to emit this file (per the
`plans/plugin-install-resilience.md` stack — adopters land in follow-up
PRs after this foundation merges):

- yellow-research (perplexity/tavily/exa userConfig keys; ceramic/parallel
  are OAuth-managed and have no userConfig field, so they are intentionally
  omitted from the credentials array)
- yellow-morph (morph key)
- yellow-semgrep (semgrep token)
- yellow-composio (URL + API key)

Plugins that intentionally do NOT emit this file:

- yellow-devin (uses shell env only; setup:all probes `DEVIN_*` env vars
  directly)
- yellow-linear, yellow-chatprd, yellow-codex (OAuth flows — status is
  ToolSearch-visibility, not credential-presence)
