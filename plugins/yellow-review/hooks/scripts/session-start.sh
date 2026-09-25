#!/bin/bash
# session-start.sh — one line about pending review-ledger findings.
#
# Reads only the per-PR sidecars that lib/review-ledger.sh keeps next to
# each ledger in $(git rev-parse --git-common-dir)/yellow-review/findings/:
#   <pr>.pending  "<pending> <attention> <jsonl-bytes>"
#   <pr>.state    "<OPEN|MERGED|CLOSED> <epoch>"
# A sidecar counts only while its <pr>.jsonl exists, its byte count still
# matches, and <pr>.state says OPEN and is under 7 days old; otherwise the PR
# is named as unverified, or folded within budget, or named as unknown.
# Each category names at most 10 PRs, then "+N more". Past the overall
# deadline the remaining ledgers are only counted as unknown: no clock
# reads, locks or folds per file, so a clone with hundreds of ledgers
# still finishes inside the budget.
# Output holds integers and PR numbers only — never ledger text.
#
# NOTE: SessionStart hooks run in parallel across plugins; this one is
# independent. stdin is intentionally not read. Budget 3 s (catalog
# timeout): git ~50 ms, per-PR shared lock <= 0.2 s, fallback folds capped
# at 1.5 s in total.

# Intentionally omit -e: a SessionStart hook must always print
# {"continue": true}, and -e would exit on the first failed probe.
set -uo pipefail

finish() {
  printf '{"continue": true}\n'
  exit 0
}

command -v jq >/dev/null 2>&1 || finish
command -v git >/dev/null 2>&1 || finish
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
common=$(git -C "$PROJECT_DIR" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || finish
case "$common" in /*) ;; *) finish ;; esac
DIR="$common/yellow-review/findings"
[ -d "$DIR" ] || finish

now_ms() {
  local t
  t=$(date +%s%N 2>/dev/null)
  case "$t" in
    *N | '') printf '%s000' "$(date +%s)" ;;
    *) printf '%s' "${t:0:13}" ;;
  esac
}
FOLD_BUDGET_MS=1500
# stop starting new PRs (and cap each fold) 0.7 s before the 3 s timeout
DEADLINE_MS=${RL_HOOK_DEADLINE_MS:-2300}
fold_spent=0
start_ms=$(now_ms)
now=$(date +%s)
week=$((7 * 24 * 3600))

# Minimal fold: latest transition per finding, in file order.
FOLD_JQ='split("\n") | map(select(length > 0) | (try fromjson catch null) | select(type == "object" and .v == 1 and .type == "transition"))
  | reduce .[] as $t ({}; .[$t.finding_id] = $t.state) | [.[]]
  | "\(map(select(. == "open" or . == "reopened" or . == "applied")) | length) \(map(select(. == "report_only" or . == "stale")) | length)"'

pending=0 attention=0
# per category: a count of every PR, and a list of only the first LIST_MAX
LIST_MAX=10
counted='' unverified='' unknown=''
n_counted=0 n_unverified=0 n_unknown=0

# list_add <category> <pr>
list_add() {
  local n_var="n_$1" n
  n=$((${!n_var} + 1))
  printf -v "$n_var" '%s' "$n"
  if [ "$n" -le "$LIST_MAX" ]; then
    printf -v "$1" '%s #%s' "${!1}" "$2"
  fi
}

# list_show <category>: "#1, #2" or "#1, …, #10, +N more"
list_show() {
  local n_var="n_$1" s more
  s=${!1# }
  s=${s// /, }
  more=$((${!n_var} - LIST_MAX))
  [ "$more" -gt 0 ] && s="$s, +$more more"
  printf '%s' "$s"
}

# Read one PR's counts (runs in a subshell holding the shared lock).
# Prints "<pending> <attention> <fold-ms-spent>", or "x x <ms>" when unknown.
read_counts() {
  local pr="$1" p a b size t0 t1 out
  if [ -f "$DIR/$pr.pending" ] && read -r p a b <"$DIR/$pr.pending" 2>/dev/null &&
    [[ "$p" =~ ^[0-9]+$ && "$a" =~ ^[0-9]+$ && "$b" =~ ^[0-9]+$ ]]; then
    size=$(wc -c <"$DIR/$pr.jsonl")
    size=${size//[!0-9]/}
    if [ "$b" = "$size" ]; then
      printf '%s %s 0' "$p" "$a"
      return 0
    fi
  fi
  if [ "$fold_spent" -ge "$FOLD_BUDGET_MS" ] || ! command -v timeout >/dev/null 2>&1; then
    printf 'x x 0'
    return 0
  fi
  t0=$(now_ms)
  local left=$((FOLD_BUDGET_MS - fold_spent)) until_deadline
  until_deadline=$((DEADLINE_MS - ($(now_ms) - start_ms)))
  [ "$until_deadline" -lt "$left" ] && left=$until_deadline
  if [ "$left" -le 0 ]; then
    printf 'x x 0'
    return 0
  fi
  out=$(timeout "$(printf '%d.%03d' $((left / 1000)) $((left % 1000)))" \
    jq -R -s -r "$FOLD_JQ" "$DIR/$pr.jsonl" 2>/dev/null) || out=''
  t1=$(now_ms)
  [[ "$out" =~ ^[0-9]+\ [0-9]+$ ]] || out='x x'
  printf '%s %s' "$out" "$((t1 - t0))"
}

past_deadline=0
for f in "$DIR"/*.jsonl; do
  [ -f "$f" ] || continue
  pr=${f##*/}
  pr=${pr%.jsonl}
  [[ "$pr" =~ ^[1-9][0-9]{0,9}$ ]] || continue
  # overall deadline (DEADLINE_MS, 2.3 s): locks and folds must not push
  # the hook past its 3 s catalog timeout. Once it passes, every remaining
  # ledger is just counted as unknown, without reading the clock again.
  if [ "$past_deadline" = 1 ] || [ $(($(now_ms) - start_ms)) -ge "$DEADLINE_MS" ]; then
    past_deadline=1
    list_add unknown "$pr"
    continue
  fi
  st='' ts=0
  [ -f "$DIR/$pr.state" ] && read -r st ts <"$DIR/$pr.state" 2>/dev/null
  [[ "$ts" =~ ^[0-9]+$ ]] || ts=0
  if [ "$st" != OPEN ] || [ $((now - ts)) -ge "$week" ]; then
    list_add unverified "$pr"
    continue
  fi
  counts=''
  if [ ! -e "$DIR/$pr.lock" ]; then
    counts=$(read_counts "$pr")
  elif command -v flock >/dev/null 2>&1; then
    counts=$( (
      exec 9<"$DIR/$pr.lock" || exit 1
      flock -s -w 0.2 9 || exit 1
      read_counts "$pr"
    ) 2>/dev/null) || counts=''
  fi
  spent=${counts##* }
  [[ "$spent" =~ ^[0-9]+$ ]] && fold_spent=$((fold_spent + spent))
  counts=${counts% *}
  if [[ "$counts" =~ ^([0-9]+)\ ([0-9]+)$ ]]; then
    p=${BASH_REMATCH[1]} a=${BASH_REMATCH[2]}
    pending=$((pending + p))
    attention=$((attention + a))
    [ $((p + a)) -gt 0 ] && list_add counted "$pr"
  else
    list_add unknown "$pr"
  fi
done

if [ $((pending + attention)) -eq 0 ] && [ "$n_unverified" -eq 0 ] && [ "$n_unknown" -eq 0 ]; then
  finish
fi

prs=$(list_show counted)
unv=$(list_show unverified)
unk=$(list_show unknown)
first=$(printf '%s %s %s' "$counted" "$unknown" "$unverified" | tr -s ' ' | sed 's/^ //' | cut -d' ' -f1)
msg="[yellow-review] Review ledger: $pending pending, $attention need attention"
[ -n "$prs" ] && msg="$msg (PRs $prs)"
[ -n "$unk" ] && msg="$msg; pending unknown: $unk"
[ -n "$unv" ] && msg="$msg; unverified: $unv"
msg="$msg. Run /review:triage ${first#\#}."
ctx="Review-findings ledger for this repository: $pending pending and $attention needing attention"
[ -n "$prs" ] && ctx="$ctx on PRs $prs"
[ -n "$unk" ] && ctx="$ctx; counts unknown for $unk"
[ -n "$unv" ] && ctx="$ctx; PR state not verified for $unv"
ctx="$ctx. /review:triage <PR> works through them."
jq -cn --arg msg "$msg" --arg ctx "$ctx" \
  '{continue: true, systemMessage: $msg, hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: $ctx}}' 2>/dev/null || finish
