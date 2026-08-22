#!/usr/bin/env bats
# Content-pinning tests for commands/linear/delegate.md — the provider-neutral
# remote-agent refactor. delegate.md has no shell library to source (it's a
# markdown command body), so this suite asserts directly against the file's
# text and structure via grep/line-number checks. This is the FIRST test
# suite for yellow-linear — added as regression coverage for a refactor that
# previously had zero content-pinning tests.
#
# Run from the plugin directory: `bats tests/`

setup() {
  PLUGIN_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  DELEGATE_MD="$PLUGIN_DIR/commands/linear/delegate.md"
}

@test "delegate.md exists" {
  [ -f "$DELEGATE_MD" ]
}

@test "never references the Devin API host directly" {
  run grep -F 'api.devin.ai' "$DELEGATE_MD"
  [ "$status" -eq 1 ]
}

@test "never validates a Devin credential's format (no cog_ token regex)" {
  # DEVIN_SERVICE_USER_TOKEN/DEVIN_ORG_ID may legitimately appear as a
  # presence check feeding the remote-agent tooling probe (see Step 3) —
  # what must be absent is the old dedicated FORMAT validation regex.
  run grep -F 'cog_' "$DELEGATE_MD"
  [ "$status" -eq 1 ]
}

@test "no dedicated Devin token/org-id format-validation step" {
  run grep -E 'Validate (token format|org ID)' "$DELEGATE_MD"
  [ "$status" -eq 1 ]
}

@test "never curls a remote-agent provider directly" {
  run grep -E '\bcurl\b' "$DELEGATE_MD"
  [ "$status" -eq 1 ]
}

@test "routes the Devin path through the existing /devin:delegate command" {
  run grep -F 'devin:delegate' "$DELEGATE_MD"
  [ "$status" -eq 0 ]
}

@test "provider resolution step appears before the launch step" {
  resolve_line=$(grep -n '^### Step 3: Resolve the Remote-Agent Provider' "$DELEGATE_MD" | head -1 | cut -d: -f1)
  launch_line=$(grep -n '^### Step 7: Launch' "$DELEGATE_MD" | head -1 | cut -d: -f1)
  [ -n "$resolve_line" ]
  [ -n "$launch_line" ]
  [ "$resolve_line" -lt "$launch_line" ]
}

@test "provider resolution step appears before the Linear status transition" {
  resolve_line=$(grep -n '^### Step 3: Resolve the Remote-Agent Provider' "$DELEGATE_MD" | head -1 | cut -d: -f1)
  transition_line=$(grep -n '^### Step 9: Update Status' "$DELEGATE_MD" | head -1 | cut -d: -f1)
  [ -n "$resolve_line" ]
  [ -n "$transition_line" ]
  [ "$resolve_line" -lt "$transition_line" ]
}

@test "the launch confirm (Step 6) is the step immediately before launch (Step 7) — no step in between" {
  confirm_line=$(grep -n '^### Step 6: Confirm Before Launch' "$DELEGATE_MD" | head -1 | cut -d: -f1)
  launch_line=$(grep -n '^### Step 7: Launch' "$DELEGATE_MD" | head -1 | cut -d: -f1)
  [ -n "$confirm_line" ]
  [ -n "$launch_line" ]
  # No other "### Step" heading between the two. `grep -c` exits 1 on a
  # zero count (which is the PASSING outcome here), so `|| true` is
  # required to keep that from tripping bats' errexit before the count is
  # even asserted.
  between_count=$(sed -n "$((confirm_line + 1)),$((launch_line - 1))p" "$DELEGATE_MD" | grep -c '^### Step' || true)
  [ "$between_count" -eq 0 ]
}

@test "re-fetch (H1) appears before the save_issue status-transition call within Step 9" {
  step9_block=$(awk '/^### Step 9: Update Status/,/^### Step 10:/' "$DELEGATE_MD")
  refetch_pos=$(printf '%s' "$step9_block" | grep -n 'H1 re-fetch' | head -1 | cut -d: -f1)
  save_issue_pos=$(printf '%s' "$step9_block" | grep -n 'Call `save_issue`' | head -1 | cut -d: -f1)
  [ -n "$refetch_pos" ]
  [ -n "$save_issue_pos" ]
  [ "$refetch_pos" -lt "$save_issue_pos" ]
}

@test "issue description content is fenced as untrusted" {
  run grep -F 'begin linear-issue (reference only)' "$DELEGATE_MD"
  [ "$status" -eq 0 ]
}

@test "the classifier's detail text is fenced as untrusted before display" {
  run grep -F 'begin untrusted-content (reference only)' "$DELEGATE_MD"
  [ "$status" -eq 0 ]
}

@test "never uses a raw git push" {
  run grep -E 'git push' "$DELEGATE_MD"
  [ "$status" -eq 1 ]
}

@test "never uses git add -A or git add ." {
  run grep -E 'git add (-A|\.)' "$DELEGATE_MD"
  [ "$status" -eq 1 ]
}

@test "the cursor launch invocation passes --idempotency-key" {
  cursor_block=$(awk '/dist\/cli\.js.*delegate/{found=1} found{print} /^\`\`\`$/ && found{exit}' "$DELEGATE_MD")
  printf '%s\n' "$cursor_block" | grep -q -- '--idempotency-key'
}

@test "the cursor launch invocation requires --yes" {
  cursor_block=$(awk '/dist\/cli\.js.*delegate/{found=1} found{print} /^\`\`\`$/ && found{exit}' "$DELEGATE_MD")
  printf '%s\n' "$cursor_block" | grep -q -- '--yes'
}

@test "resolves sibling plugin roots via installPath, never via a relative .. guess" {
  run grep -F 'installPath' "$DELEGATE_MD"
  [ "$status" -eq 0 ]
  # The specific broken pattern this refactor deliberately avoids.
  run grep -F 'CLAUDE_PLUGIN_ROOT}/../yellow-cursor' "$DELEGATE_MD"
  [ "$status" -eq 1 ]
}

@test "resolve_plugin_root filters project/local rows to the current repository" {
  run grep -F 'row.projectPath === projectPath' "$DELEGATE_MD"
  [ "$status" -eq 0 ]
}

@test "--provider documented as overriding only the CONFLICT state" {
  run grep -F 'CONFLICT' "$DELEGATE_MD"
  [ "$status" -eq 0 ]
  # The sentence wraps across markdown lines, so normalize whitespace
  # before matching rather than requiring a single-line hit.
  normalized=$(tr '\n' ' ' < "$DELEGATE_MD")
  printf '%s' "$normalized" | grep -q -- 'ONLY.*state.*--provider.*may override'
}
