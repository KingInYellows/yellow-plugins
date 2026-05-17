#!/usr/bin/env bash

# CI Metrics Exporter
# Exports Prometheus-format metrics for GitHub Actions artifact collection
# Used by CI workflows to capture timing and validation data
#
# Usage:
#   ./scripts/export-ci-metrics.sh <stage> <status> [additional-labels]
#
# Arguments:
#   stage: CI stage name. Built-ins: lint, unit_test, integration_test,
#          schema_validation, contract_drift, security_audit, build.
#          Custom stages accepted as long as they match ^[a-zA-Z][a-zA-Z0-9_]*$
#          (e.g., custom_stage, new_stage — see docs/operations/ci-pipeline.md).
#   status: Job status (success, failure, cancelled)
#   additional-labels: Optional K=V pairs (e.g., target="marketplace")
#
# Output:
#   Writes Prometheus text format metrics to stdout
#
# Architecture References:
# - docs/operations/metrics.md: CI Validation Metrics
# - CRIT-021: CI runtime budget enforcement
# - NFR-MAINT-002: CI performance targets

set -euo pipefail

# Configuration
METRIC_PREFIX="yellow_plugins_ci"
TIMESTAMP=$(date +%s)

# Parse arguments
STAGE="${1:-unknown}"
STATUS="${2:-unknown}"
if [[ $# -ge 2 ]]; then
  shift 2
else
  set --
fi
ADDITIONAL_LABELS=()

# Parse additional label arguments (format: key=value)
while [[ $# -gt 0 ]]; do
  ADDITIONAL_LABELS+=("$1")
  shift
done

# STAGE / STATUS are embedded directly into Prometheus label values below.
# An unrecognized value (typo, or a crafted argument containing a quote)
# could break out of the label quoting and inject arbitrary metric lines.
# Validate against the injection-safe shape that Prometheus also requires
# for label values it round-trips cleanly (debt finding 009).
#
# STAGE accepts any label that matches `^[a-zA-Z][a-zA-Z0-9_]*$` so the
# documented extension flow in `docs/operations/ci.md` and
# `docs/operations/ci-pipeline.md` (which shows `custom_stage` /
# `new_stage` as user-supplied stage names) keeps working without
# requiring code changes per new callsite. STATUS stays a closed list —
# the Prometheus convention is a small fixed enum of job outcomes.
VALID_STATUSES="success failure cancelled"
SAFE_LABEL_PATTERN='^[a-zA-Z][a-zA-Z0-9_]*$'

validate_in_allowlist() {
  # $1=value  $2=space-separated allowlist  $3=field name
  local v="$1" allow="$2" field="$3" item
  for item in $allow; do
    [ "$v" = "$item" ] && return 0
  done
  printf '[ci-metrics] Error: invalid %s "%s" — must be one of: %s\n' \
    "$field" "$v" "$allow" >&2
  exit 1
}

validate_safe_label() {
  # $1=value  $2=field name
  local v="$1" field="$2"
  # Reject embedded newlines / carriage returns up front. `grep -qE` is
  # line-oriented, so a multiline value like $'lint\nattack_total{p="q"'
  # passes the first-line match while the rest of the string still flows
  # into the Prometheus label and forges metric lines (codex P2 review).
  if [ "$v" != "$(printf '%s' "$v" | tr -d '\n\r')" ]; then
    printf '[ci-metrics] Error: %s contains a newline or carriage return\n' \
      "$field" >&2
    exit 1
  fi
  # Whole-string match. The newline rejection above means `grep -qE` here
  # cannot succeed on a partial first-line match — but keep the anchors
  # for defense in depth in case a future edit drops the tr guard.
  if printf '%s' "$v" | grep -qE "$SAFE_LABEL_PATTERN"; then
    return 0
  fi
  printf '[ci-metrics] Error: invalid %s "%s" — must match %s\n' \
    "$field" "$v" "$SAFE_LABEL_PATTERN" >&2
  exit 1
}

# Validate each provided argument independently. The "unknown" sentinel means
# the argument was omitted entirely — keep the existing warn-and-continue
# behavior for that field only; a provided value that fails validation is
# still a hard error even when the other field is omitted.
if [ "$STAGE" = "unknown" ] || [ "$STATUS" = "unknown" ]; then
  printf '[ci-metrics] Warning: Missing required arguments (stage=%s, status=%s). Metrics may be incomplete.\n' "$STAGE" "$STATUS" >&2
fi
[ "$STAGE" != "unknown" ] && validate_safe_label "$STAGE" stage
[ "$STATUS" != "unknown" ] && validate_in_allowlist "$STATUS" "$VALID_STATUSES" status

# Build label string
LABELS="stage=\"${STAGE}\",status=\"${STATUS}\""
for label in "${ADDITIONAL_LABELS[@]}"; do
  key=${label%%=*}
  value=${label#*=}
  # Label key must be a valid Prometheus label name.
  case "$key" in
    '' | *[!a-zA-Z0-9_]* | [0-9]*)
      printf '[ci-metrics] Error: invalid label key "%s" — must match [a-zA-Z_][a-zA-Z0-9_]*\n' "$key" >&2
      exit 1
      ;;
  esac
  # Label value must not contain characters that would break out of the
  # double-quoted Prometheus label (quote, backslash, brace) or split the
  # metric line (newline / carriage return).
  case "$value" in
    *'"'* | *'\'* | *'{'* | *'}'*)
      printf '[ci-metrics] Error: label value for "%s" contains a forbidden character (one of: " \\ { })\n' "$key" >&2
      exit 1
      ;;
  esac
  if [ "$value" != "$(printf '%s' "$value" | tr -d '\n\r')" ]; then
    printf '[ci-metrics] Error: label value for "%s" contains a newline\n' "$key" >&2
    exit 1
  fi
  LABELS="${LABELS},${key}=\"${value}\""
done

# Calculate elapsed time based on CI-provided timers
if [[ -n "${CI_STAGE_DURATION:-}" ]]; then
  ELAPSED="${CI_STAGE_DURATION}"
elif [[ -n "${CI_JOB_START:-}" ]]; then
  NOW=$(date +%s)
  ELAPSED=$((NOW - CI_JOB_START))
elif [[ -n "${SECONDS:-}" ]]; then
  ELAPSED="${SECONDS}"
else
  ELAPSED="0"
fi

# ELAPSED is interpolated verbatim into the Prometheus heredoc below.
# An env-supplied value (CI_STAGE_DURATION especially) could contain a
# newline or non-numeric content that breaks out of the metric line; force
# it to a non-negative integer.
case "$ELAPSED" in
  '' | *[!0-9]*)
    printf '[ci-metrics] Warning: non-numeric ELAPSED %q — defaulting to 0\n' "$ELAPSED" >&2
    ELAPSED=0
    ;;
esac

# Output Prometheus metrics
cat <<EOF
# HELP ${METRIC_PREFIX}_duration_seconds Duration of CI validation stages in seconds
# TYPE ${METRIC_PREFIX}_duration_seconds gauge
${METRIC_PREFIX}_duration_seconds{${LABELS}} ${ELAPSED}

# HELP ${METRIC_PREFIX}_validations_total Total number of CI validation runs
# TYPE ${METRIC_PREFIX}_validations_total counter
${METRIC_PREFIX}_validations_total{${LABELS}} 1

# HELP ${METRIC_PREFIX}_timestamp_seconds Unix timestamp of metric collection
# TYPE ${METRIC_PREFIX}_timestamp_seconds gauge
${METRIC_PREFIX}_timestamp_seconds{${LABELS}} ${TIMESTAMP}
EOF

printf '[ci-metrics] Exported metrics for stage=%s status=%s\n' "$STAGE" "$STATUS" >&2

# Optional: Include resource usage if available
if command -v time &> /dev/null; then
  # CPU and memory stats not easily available in GitHub Actions without custom tooling
  # This is a placeholder for future enhancement
  :
fi
