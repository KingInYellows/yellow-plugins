#!/usr/bin/env bash
# jev-prefilter.sh — optional TypeSafe Jev pre-filter for compound staging.
#
# Sourced by hooks/scripts/_stop-capture-subshell.sh. Asks Jev (a typed-
# decision "System One" model) whether a finished session's redacted
# transcript tail looks worth staging, and appends the answer to
# <staging>/jev-shadow.jsonl. Shadow mode only: the answer never changes
# whether the pending entry is written, so the log can be compared with
# staging-scorer's real outcomes before any skip logic ships.
#
# Opt-in through the environment (hooks receive the user's shell env):
#   COMPOUND_JEV_PREFILTER=shadow   enable; any other value is off
#   TYPESAFE_API_KEY                required; absent means off
#   COMPOUND_JEV_MODEL              default jev-1.13.0 (pinned, not jev-latest)
#   COMPOUND_JEV_URL                default https://api.typesafe.ai/v1/systemone
#   COMPOUND_JEV_TIMEOUT_S          default 5 (curl --max-time)
#
# Every failure path is silent and leaves staging untouched. The log stores
# decisions and numbers only, never transcript text.

JEV_DEFAULT_MODEL='jev-1.13.0'
JEV_DEFAULT_URL='https://api.typesafe.ai/v1/systemone'
# Cap on the projected dialogue sent as state (chars). Jev's state budget is
# roughly 32K tokens; staying near 6K tokens also limits distractor content.
JEV_STATE_MAX_CHARS=24000
# Thresholds behind the logged would_skip flag. Raw probabilities are logged
# too, so these can be re-tuned offline without new data.
JEV_SKIP_MIN_CONFIDENCE='0.9'
JEV_SKIP_MAX_INSTRUCTION='0.2'

# Return 0 when the pre-filter is enabled and usable.
jev_prefilter_enabled() {
  [ "${COMPOUND_JEV_PREFILTER:-}" = "shadow" ] || return 1
  [ -n "${TYPESAFE_API_KEY:-}" ] || return 1
  command -v curl >/dev/null 2>&1 || return 1
  command -v jq >/dev/null 2>&1 || return 1
  return 0
}

# Project transcript JSONL lines (stdin) to user and assistant text only,
# dropping tool calls, tool results and metadata, then cap the length.
# Lines that are not JSON are skipped.
jev_project_dialogue() {
  jq -Rr '
    (fromjson? // empty)
    | select(.type == "user" or .type == "assistant")
    | .message.content as $c
    | (if ($c | type) == "string" then $c
       elif ($c | type) == "array" then
         [ $c[] | select(type == "object" and .type == "text") | .text ] | join("\n")
       else "" end) as $t
    | select($t != "")
    | "\(.type): \($t)"
  ' 2>/dev/null | head -c "$JEV_STATE_MAX_CHARS"
}

# Build the request body for the given state text (stdin).
jev_build_request() {
  jq -Rs --arg model "${COMPOUND_JEV_MODEL:-$JEV_DEFAULT_MODEL}" '{
    model: $model,
    state: .,
    questions: {
      durable: {
        type: "choice",
        instructions: "What kind of work session is this excerpt from?",
        criteria: {
          "trivial-qa": "Quick questions or chat with nothing worth remembering later.",
          "routine-edit": "Ordinary edits or commands with no new lesson, decision or convention.",
          "durable-lesson": "A bug cause, fix, gotcha or technique worth remembering for future work.",
          "decision-or-convention": "A project decision, preference or convention was set or changed.",
          "other": "None of the above fit, or it is unclear."
        }
      },
      has_instruction: {
        type: "noul",
        instructions: "The user asks the assistant to adopt a new standing behaviour, such as always or never doing something from now on."
      }
    }
  }'
}

# Ask Jev about one session and append a shadow-log line.
# Args: $1 staging dir, $2 session id, $3 content hash; stdin: redacted tail.
jev_prefilter_shadow() {
  local staging="$1" sid="$2" hash="$3"
  jev_prefilter_enabled || return 0
  [ -n "$staging" ] && [ -d "$staging" ] || return 0

  local state body resp latency
  state=$(jev_project_dialogue)
  [ -n "$state" ] || return 0
  body=$(printf '%s' "$state" | jev_build_request) || return 0

  # The key goes through a curl config on stdin so it never appears in argv.
  # -w appends curl's own total time on a final line, split off below.
  resp=$(printf 'header = "Authorization: Bearer %s"\n' "$TYPESAFE_API_KEY" \
    | curl -sS --fail --max-time "${COMPOUND_JEV_TIMEOUT_S:-5}" \
        -K - \
        -H 'Content-Type: application/json' \
        --data-binary "$body" \
        -w '\n%{time_total}' \
        "${COMPOUND_JEV_URL:-$JEV_DEFAULT_URL}" 2>/dev/null) || return 0
  latency=$(printf '%s' "$resp" | tail -n 1)
  resp=$(printf '%s' "$resp" | sed '$d')
  case "$latency" in
    ''|*[!0-9.]*) latency=null ;;
  esac

  local line
  line=$(printf '%s' "$resp" | jq -c \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg sid "$sid" \
    --arg hash "$hash" \
    --argjson latency "$latency" \
    --argjson minconf "$JEV_SKIP_MIN_CONFIDENCE" \
    --argjson maxinst "$JEV_SKIP_MAX_INSTRUCTION" \
    --argjson chars "${#state}" '
    .answers.durable as $d
    | .answers.has_instruction as $h
    | select(($d.choice | type) == "string" and ($h.noul | type) == "number")
    | {
        schema: "1",
        timestamp: $ts,
        session_id: $sid,
        content_hash: $hash,
        model: (.model // null),
        state_chars: $chars,
        latency_s: $latency,
        durable: $d.choice,
        durable_confidence: ($d.confidence // null),
        durable_probabilities: ($d.probabilities // null),
        has_instruction: $h.noul,
        would_skip: (
          ($d.choice == "trivial-qa" or $d.choice == "routine-edit")
          and (($d.confidence // 0) >= $minconf)
          and ($h.noul <= $maxinst)
        ),
        input_tokens: (.usage.input_tokens // null)
      }' 2>/dev/null) || return 0
  [ -n "$line" ] || return 0
  printf '%s\n' "$line" >> "${staging}/jev-shadow.jsonl" 2>/dev/null || return 0
  return 0
}
