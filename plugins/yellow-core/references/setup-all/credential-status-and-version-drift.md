# Steps 1.6 + 1.7 — credential status files and plugin version drift

Loaded by `/setup:all` (commands/setup/all.md). Content moved verbatim
from the command file (C6 progressive-disclosure split). Run these two
probes exactly as written — the jq field extraction, cache TTL, and
`sort -V` comparison are load-bearing.

## Step 1.6: Credential Status Files

Credential-bearing plugins — exactly those listed in the marker-delimited
`for plugin in ...` loop below, which CI validates against the hooks that
actually emit the file — write a `credential-status.json` from a SessionStart
hook so the dashboard can classify them accurately without probing the
system keychain. See
`docs/plugin-credential-status-protocol.md`. yellow-morph will join the
protocol in a follow-up; until then its classification block reads
Step 1's env+userConfig probe directly.

Run one Bash block to read each plugin's status file:

```bash
printf '\n=== Credential Status Files ===\n'
PLUGIN_DATA_DIR="$HOME/.claude/plugins/data"
# setup-all-credential-status-plugins:start
for plugin in yellow-research yellow-composio yellow-semgrep; do
  status_file="$PLUGIN_DATA_DIR/$plugin/credential-status.json"
  if [ -f "$status_file" ] && command -v jq >/dev/null 2>&1; then
    # Single jq invocation per plugin — extract all fields as TSV.
    read -r present_count total_count user_config_count shell_env_count version <<EOF
$(jq -r '[
  ([.credentials[] | select(.present == true)] | length),
  (.credentials | length),
  ([.credentials[] | select(.source == "userConfig")] | length),
  ([.credentials[] | select(.source == "shell_env")] | length),
  (.version // "unknown")
] | @tsv' "$status_file" 2>/dev/null)
EOF
    printf '%-22s %s/%s present (uc:%s env:%s, v%s)\n' \
      "$plugin:" "${present_count:-0}" "${total_count:-0}" \
      "${user_config_count:-0}" "${shell_env_count:-0}" "${version:-unknown}"
  elif [ -f "$status_file" ]; then
    printf '%-22s status file present but jq missing\n' "$plugin:"
  else
    printf '%-22s no status file (restart Claude Code or /plugin disable && enable)\n' "$plugin:"
  fi
done
# setup-all-credential-status-plugins:end
```

The status file is the AUTHORITATIVE source for classification. When it
exists, prefer its `present_count` over shell-env-only probes. When it is
absent, fall back to the legacy shell-env-only check (and emit a hint that
the user should restart Claude Code to populate the file).

## Step 1.7: Plugin Version Drift Check

Detect plugins where the installed version is older than the marketplace
catalog version (e.g., user installed a plugin months ago and the catalog
has shipped multiple minor releases since). Uses `claude plugin list --json
--available` with a 24h cache to avoid a network call on every dashboard
invocation.

```bash
printf '\n=== Plugin Version Drift ===\n'
DRIFT_CACHE="$HOME/.claude/plugins/data/yellow-core/version-check-cache.json"
DRIFT_CACHE_DIR=$(dirname "$DRIFT_CACHE")

# Feature-detect: `claude plugin list --json --available` may not be available
# on older Claude Code releases. Soft-skip if `claude` is missing or the flag
# is not supported.
if ! command -v claude >/dev/null 2>&1; then
  printf 'version_drift: SKIPPED (claude CLI not found)\n'
elif ! claude plugin list --help 2>&1 | grep -q -- '--available'; then
  printf 'version_drift: SKIPPED (claude plugin list --available not supported in this release)\n'
else
  # 24h TTL: re-fetch only if cache is missing or older than 86400 seconds.
  refresh_cache=1
  if [ -f "$DRIFT_CACHE" ]; then
    cache_age=$(( $(date +%s) - $(stat -c %Y "$DRIFT_CACHE" 2>/dev/null || stat -f %m "$DRIFT_CACHE" 2>/dev/null || printf 0) ))
    [ "$cache_age" -lt 86400 ] && refresh_cache=0
  fi

  if [ "$refresh_cache" -eq 1 ]; then
    mkdir -p "$DRIFT_CACHE_DIR" 2>/dev/null
    if claude plugin list --json --available 2>/dev/null > "$DRIFT_CACHE.tmp"; then
      mv -f "$DRIFT_CACHE.tmp" "$DRIFT_CACHE" 2>/dev/null
      cache_age=0  # fresh cache — otherwise the stale pre-refresh age is reported below
    else
      rm -f "$DRIFT_CACHE.tmp" 2>/dev/null
      printf 'version_drift: SKIPPED (claude plugin list --json --available failed)\n'
    fi
  fi

  if [ -f "$DRIFT_CACHE" ] && command -v jq >/dev/null 2>&1; then
    # Emit (id, installed, available) triples for every plugin present in both
    # arrays. Schema observed:
    # {"installed":[{"id":"<plugin>@<marketplace>","version":"X.Y.Z","scope":"user|project|local"}],
    #  "available":[...]}. The `available` array shape is not fully documented;
    # parse defensively and skip plugins that lack an available record.
    drift_pairs=$(jq -r '
      .installed[] as $i
      | (.available // [])[]
      | select(.id == $i.id)
      | "\($i.id)\t\($i.version)\t\(.version)"
    ' "$DRIFT_CACHE" 2>/dev/null)

    # Use sort -V (semver-aware version sort) to flag OUTDATED only when the
    # installed version sorts strictly before the available one. Plain
    # inequality would also flag installed-newer-than-available (local
    # prereleases, ahead-of-marketplace builds) as outdated, which produces
    # confusing downgrade guidance.
    outdated_count=0
    outdated_report=""
    while IFS=$(printf '\t') read -r pkg_id installed_ver available_ver; do
      [ -z "$pkg_id" ] && continue
      [ "$installed_ver" = "$available_ver" ] && continue
      sorted_first=$(printf '%s\n%s\n' "$installed_ver" "$available_ver" \
        | LC_ALL=C sort -V 2>/dev/null | head -n1)
      if [ "$sorted_first" = "$installed_ver" ]; then
        outdated_count=$((outdated_count + 1))
        outdated_report="${outdated_report}  OUTDATED: ${pkg_id} installed=${installed_ver} → available=${available_ver}
"
      fi
    done <<EOF
$drift_pairs
EOF
    if [ "$outdated_count" -gt 0 ]; then
      printf 'version_drift: %s outdated\n' "$outdated_count"
      printf '%s' "$outdated_report"
    else
      printf 'version_drift: all current\n'
    fi
    cache_age_hours=$(( cache_age / 3600 ))
    printf 'version_drift_cache_age_h: %s\n' "${cache_age_hours:-0}"
  elif [ -f "$DRIFT_CACHE" ]; then
    printf 'version_drift: SKIPPED (jq not found)\n'
  fi
fi
```

When OUTDATED plugins are reported, suggest: `/plugin update <name>` to
upgrade. After update, run `/setup:all` again — outdated plugins may need
`/plugin disable && /plugin enable` to re-trigger userConfig prompts for
any new fields the upgrade introduced (per
[anthropics/claude-code#39827](https://github.com/anthropics/claude-code/issues/39827)).
