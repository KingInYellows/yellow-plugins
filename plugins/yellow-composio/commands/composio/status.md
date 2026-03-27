---
name: composio:status
description: "Show Composio usage dashboard with execution counts and threshold warnings. Use when checking budget, verifying connectivity, or monitoring usage across sessions."
argument-hint: ''
allowed-tools:
  - Bash
  - Read
  - ToolSearch
---

# Composio Usage Dashboard

Display local execution counts, per-tool breakdown, daily history, and threshold
warnings. Also probe MCP server health.

## Workflow

### Step 1: Read usage counter

Read `.claude/composio-usage.json`. If missing:

```text
[yellow-composio] Usage counter not found. Run /composio:setup first.
```

Stop.

If the file exists, parse it via Bash:

```bash
USAGE_FILE=".claude/composio-usage.json"
if [ ! -f "$USAGE_FILE" ]; then
  printf '[yellow-composio] Usage counter not found. Run /composio:setup first.\n'
  exit 1
fi

# jq is required for JSON parsing throughout this command
if ! command -v jq >/dev/null 2>&1; then
  printf '[yellow-composio] jq is required for usage dashboard. Install jq and retry.\n'
  exit 1
fi

if ! jq -e '.version' "$USAGE_FILE" >/dev/null 2>&1; then
  printf '[yellow-composio] Usage counter is corrupted. Run /composio:setup to reset.\n'
  exit 1
fi

MONTH=$(date -u +%Y-%m)
MONTH_NAME=$(date -u +"%B %Y")
DAY_OF_MONTH=$(date -u +%d | sed 's/^0//')

# Extract current month stats
TOTAL=$(jq -r --arg m "$MONTH" '.periods[$m].total // 0' "$USAGE_FILE")
MONTHLY_WARN=$(jq -r '.thresholds.monthly_warn // 8000' "$USAGE_FILE")
DAILY_WARN=$(jq -r '.thresholds.daily_warn // 200' "$USAGE_FILE")

# Calculate daily average and projection (awk for POSIX portability)
if [ "$DAY_OF_MONTH" -gt 0 ] 2>/dev/null; then
  DAILY_AVG=$(awk -v t="$TOTAL" -v d="$DAY_OF_MONTH" 'BEGIN {printf "%.1f", t / d}' 2>/dev/null || echo "N/A")
  DAYS_IN_MONTH=30  # Approximation -- not calendar-aware
  PROJECTED=$(awk -v t="$TOTAL" -v d="$DAY_OF_MONTH" -v m="$DAYS_IN_MONTH" 'BEGIN {printf "%d", t / d * m}' 2>/dev/null || echo "N/A")
else
  DAILY_AVG="N/A"
  PROJECTED="N/A"
fi

# Today's count for daily threshold
TODAY=$(date -u +%Y-%m-%d)
TODAY_COUNT=$(jq -r --arg m "$MONTH" --arg d "$TODAY" '.periods[$m].by_day[$d] // 0' "$USAGE_FILE")

# Percentage of monthly threshold
if [ "$MONTHLY_WARN" -gt 0 ] 2>/dev/null; then
  PCT=$(awk -v t="$TOTAL" -v w="$MONTHLY_WARN" 'BEGIN {printf "%.1f", t * 100 / w}' 2>/dev/null || echo "N/A")
  WARN_80=$(awk -v w="$MONTHLY_WARN" 'BEGIN {printf "%d", w * 0.8}' 2>/dev/null || echo "0")
fi

# Threshold status (warn at 80%, prominent warning at 100%)
if [ "$TOTAL" -ge "$MONTHLY_WARN" ] 2>/dev/null; then
  THRESHOLD_STATUS="EXCEEDED"
elif [ "$TOTAL" -ge "${WARN_80:-0}" ] 2>/dev/null; then
  THRESHOLD_STATUS="WARNING (80% of monthly threshold reached)"
elif [ "$PROJECTED" != "N/A" ] && [ "$PROJECTED" -ge "$MONTHLY_WARN" ] 2>/dev/null; then
  THRESHOLD_STATUS="WARNING (projected to exceed)"
else
  THRESHOLD_STATUS="OK"
fi

# Daily threshold check
DAILY_STATUS="OK"
if [ "$TODAY_COUNT" -ge "$DAILY_WARN" ] 2>/dev/null; then
  DAILY_STATUS="EXCEEDED ($TODAY_COUNT / $DAILY_WARN)"
fi

printf 'Month Total: %s\n' "$TOTAL"
printf 'Monthly Warn: %s\n' "$MONTHLY_WARN"
printf 'Daily Avg: %s\n' "$DAILY_AVG"
printf 'Projected: %s\n' "${PROJECTED:-N/A}"
printf 'Pct: %s%%\n' "${PCT:-0}"
printf 'Status: %s\n' "$THRESHOLD_STATUS"
printf 'Daily Warn: %s\n' "$DAILY_WARN"
printf 'Today Count: %s\n' "$TODAY_COUNT"
printf 'Daily Status: %s\n' "$DAILY_STATUS"
```

### Step 2: Extract per-tool breakdown

```bash
USAGE_FILE=".claude/composio-usage.json"
MONTH=$(date -u +%Y-%m)
jq -r --arg m "$MONTH" '
  .periods[$m].by_tool // {} | to_entries | sort_by(-.value) |
  .[] | "  \(.key): \(.value)"
' "$USAGE_FILE" 2>/dev/null || printf '  (no tool data)\n'
```

### Step 3: Extract last 7 days

```bash
USAGE_FILE=".claude/composio-usage.json"
MONTH=$(date -u +%Y-%m)
jq -r --arg m "$MONTH" '
  .periods[$m].by_day // {} | to_entries | sort_by(.key) |
  reverse | .[0:7] | reverse |
  .[] | "  \(.key): \(.value)"
' "$USAGE_FILE" 2>/dev/null || printf '  (no daily data)\n'
```

### Step 4: Probe MCP health

Quick ToolSearch for `"COMPOSIO_REMOTE_WORKBENCH"` to check if the MCP server
is still available. Do NOT execute a Composio tool call -- just verify the tool
is discoverable.

Report: "connected" if found, "offline" if not found.

### Step 5: Display dashboard

Assemble results from Steps 1-4 into a formatted dashboard:

```text
Composio Usage Dashboard
========================
MCP Server:        [connected|offline]
Current Month:     [month name]
Executions:        [total] / [threshold] ([pct]%)
Daily Average:     [avg] calls/day
Today:             [today_count] / [daily_warn] -- [OK|EXCEEDED]
Projected Monthly: ~[projected] calls
Threshold:         [threshold] (warning) -- [OK|WARNING|EXCEEDED]

Top Tools (this month):
  COMPOSIO_REMOTE_WORKBENCH:   [count]
  COMPOSIO_MULTI_EXECUTE_TOOL: [count]
  COMPOSIO_SEARCH_TOOLS:       [count]

Last 7 Days:
  [date]: [count]
  [date]: [count]
  ...
========================
```

If `THRESHOLD_STATUS` is "EXCEEDED", add a prominent warning:

```text
WARNING: Monthly execution count ([total]) exceeds threshold ([threshold]).
You may incur overage charges on paid tiers or hit free tier limits.
Adjust thresholds in .claude/composio-usage.json if this is expected.
```

If `THRESHOLD_STATUS` starts with "WARNING", add:

```text
Note: Projected monthly usage (~[projected]) may exceed threshold ([threshold]).
```
