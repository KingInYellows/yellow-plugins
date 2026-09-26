#!/usr/bin/env bash
# Summarize a log file: count lines per level (ERROR, WARN, INFO) in the
# last N lines.
#
# Usage: summarize-log.sh <logfile> [max_lines]
set -euo pipefail

logfile="${1:?usage: summarize-log.sh <logfile> [max_lines]}"
max_lines="${2:-100}"

echo Summarizing $logfile

if [[ ! -r "$logfile" ]]; then
  echo "cannot read $logfile" >&2
  exit 1
fi

recent="$(tail -n "$max_lines" "$logfile")"

for level in ERROR WARN INFO; do
  count="$(printf '%s\n' "$recent" | grep -c "$level" || true)"
  printf '%-5s %s\n' "$level" "$count"
done
