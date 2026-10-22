#!/usr/bin/env bash
# run-one.sh: one model-swap eval run. Spends real model usage.
#
# usage: run-one.sh <out-dir> <run-id> <agent.md> <workdir> <model> <effort> <prompt-file> [tools]
#
# Runs <agent.md>'s body (frontmatter stripped) as the system prompt of a
# nested `claude -p` in <workdir>, with no settings, MCP servers, slash
# commands or memory, so the model and effort are the only variables. Tools
# default to the agent's `tools:` list. Writes <out-dir>/<run-id>.json (the
# CLI's JSON result plus eval_rc and eval_wall_s) and skips a run whose
# output already exists, so a stopped matrix resumes. A file written to
# <workdir>/.debt/scanner-output/ is copied to <out-dir>/<run-id>.scan.json.
set -u
[ $# -ge 7 ] || { printf 'usage: %s <out-dir> <run-id> <agent.md> <workdir> <model> <effort> <prompt-file> [tools]\n' "$0" >&2; exit 2; }
out_dir=$1 id=$2 agent=$3 workdir=$4 model=$5 effort=$6 prompt_file=$7 tools=${8:-}
out=$out_dir/$id.json
[ -s "$out" ] && exit 0
mkdir -p "$out_dir"
sys=$(mktemp) || exit 1
trap 'rm -f "$sys"' EXIT
# Body after the second `---` line.
awk 'n >= 2 { print; next } /^---$/ { n++ }' "$agent" >"$sys"
if [ -z "$tools" ]; then
  # Block-list `tools:` (the only form the eval agents use) to a comma list.
  tools=$(awk '/^---$/ { n++; next } n == 1 && /^tools:/ { t = 1; next }
    n == 1 && t && /^  - / { sub(/^  - /, ""); printf "%s%s", s, $0; s = "," ; next }
    n == 1 && t { t = 0 }' "$agent")
fi
[ -n "$tools" ] || { printf 'run-one: no tools for %s\n' "$agent" >&2; exit 2; }
# Keep the parent session's effort, memory and extra CLAUDE.md out of the run.
unset CLAUDE_EFFORT CLAUDE_CODE_EFFORT_LEVEL CLAUDE_COWORK_MEMORY_PATH_OVERRIDE \
  CLAUDE_MEMORY_STORES CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD CLAUDE_ADDITIONAL_DIRECTORIES
start=$(date +%s)
(cd "$workdir" && timeout 1200 claude -p --setting-sources "" --strict-mcp-config \
  --disable-slash-commands --model "$model" --effort "$effort" \
  --tools "$tools" --allowedTools "$tools" --system-prompt-file "$sys" \
  --output-format json --no-session-persistence "$(cat "$prompt_file")") \
  >"$out.tmp" 2>"$out_dir/$id.err"
rc=$?
wall=$(($(date +%s) - start))
scan=$(find "$workdir/.debt/scanner-output" -maxdepth 1 -name '*.json' -print -quit 2>/dev/null)
[ -n "$scan" ] && cp "$scan" "$out_dir/$id.scan.json"
if jq --arg rc "$rc" --argjson wall "$wall" '. + {eval_rc: ($rc | tonumber), eval_wall_s: $wall}' \
  "$out.tmp" >"$out" 2>/dev/null; then
  rm -f "$out.tmp"
else
  rm -f "$out"
  mv "$out.tmp" "$out_dir/$id.bad"
  printf 'run-one: %s produced no JSON (rc %s); see %s.err\n' "$id" "$rc" "$out_dir/$id" >&2
  exit 1
fi
