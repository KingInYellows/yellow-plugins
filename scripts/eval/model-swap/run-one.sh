#!/usr/bin/env bash
# run-one.sh: one model-swap eval run. Spends real model usage.
#
# usage: run-one.sh <out-dir> <run-id> <agent.md> <workdir> <model> <effort> <prompt-file> [tools]
#
# Runs <agent.md>'s body (frontmatter stripped) as the system prompt of a
# nested `claude -p` in <workdir>, with no settings, MCP servers, slash
# commands or memory, so the model and effort are the only variables. Tools
# default to the agent's `tools:` list. Writes <out-dir>/<run-id>.json (the
# CLI's JSON result plus eval_rc, eval_wall_s and eval_fingerprint) and skips
# a run whose output already exists with the same $EVAL_FINGERPRINT (eval.py
# sets it from every run input), so a stopped matrix resumes. A file the run
# writes to <workdir>/.debt/scanner-output/ is copied to
# <out-dir>/<run-id>.scan.json.
set -u
[ $# -ge 7 ] || { printf 'usage: %s <out-dir> <run-id> <agent.md> <workdir> <model> <effort> <prompt-file> [tools]\n' "$0" >&2; exit 2; }
out_dir=$1 id=$2 agent=$3 workdir=$4 model=$5 effort=$6 prompt_file=$7 tools=${8:-}
out=$out_dir/$id.json
fp=${EVAL_FINGERPRINT:-}
if [ -s "$out" ]; then
  jq -e --arg fp "$fp" '(.eval_fingerprint // "") == $fp' "$out" >/dev/null 2>&1 && exit 0
  printf 'run-one: %s was made from other inputs; rerunning\n' "$id" >&2
fi
mkdir -p "$out_dir"
# Scanner output from an earlier attempt must not be graded as this one's.
rm -f "$out" "$out_dir/$id.scan.json"
find "$workdir/.debt/scanner-output" -maxdepth 1 -name '*.json' -delete 2>/dev/null
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
scan_ok=1
# A scanner worktree has .debt/scanner-output; its run must write a file there.
[ -d "$workdir/.debt/scanner-output" ] && [ -z "$scan" ] && scan_ok=0
if [ -n "$scan" ]; then
  # A truncated or non-object scanner file fails the run so it reruns.
  jq -e 'type == "object"' "$scan" >/dev/null 2>&1 && cp "$scan" "$out_dir/$id.scan.json" || scan_ok=0
fi
# -s: jq exits 0 with no output on an empty file (a timeout or a crash).
# is_error: a rate limit or max-turns still prints JSON; fail it so it reruns.
if [ "$rc" -eq 0 ] && [ "$scan_ok" -eq 1 ] && [ -s "$out.tmp" ] &&
  jq -e '(.is_error // false) | not' "$out.tmp" >/dev/null 2>&1 &&
  jq -e --arg rc "$rc" --argjson wall "$wall" \
    --arg fp "$fp" '. + {eval_rc: ($rc | tonumber), eval_wall_s: $wall, eval_fingerprint: $fp}' \
    "$out.tmp" >"$out" 2>/dev/null; then
  rm -f "$out.tmp"
else
  rm -f "$out" "$out_dir/$id.scan.json"
  mv "$out.tmp" "$out_dir/$id.bad"
  printf 'run-one: %s failed or produced no JSON (rc %s); see %s.err and .bad\n' "$id" "$rc" "$out_dir/$id" >&2
  exit 1
fi
