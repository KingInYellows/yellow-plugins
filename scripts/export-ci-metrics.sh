#!/usr/bin/env bash

# CI Metrics Exporter
# Exports Prometheus-format metrics for GitHub Actions artifact collection
# Used by CI workflows to capture timing and validation data
#
# Usage:
#   ./scripts/export-ci-metrics.sh <stage> <status> [additional-labels]
#
# Arguments:
#   stage: CI stage name (lint, unit_test, integration_test, schema_validation, build)
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

# Validate required arguments
if [ "$STAGE" = "unknown" ] || [ "$STATUS" = "unknown" ]; then
  printf '[ci-metrics] Warning: Missing required arguments (stage=%s, status=%s). Metrics may be incomplete.\n' "$STAGE" "$STATUS" >&2
fi

# Build label string
LABELS="stage=\"${STAGE}\",status=\"${STATUS}\""
for label in "${ADDITIONAL_LABELS[@]}"; do
  key=${label%%=*}
  value=${label#*=}
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
