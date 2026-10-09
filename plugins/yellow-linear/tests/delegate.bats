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

@test "allowed-tools grants Write for the delegation packet file" {
  run grep -F '  - Write' "$DELEGATE_MD"
  [ "$status" -eq 0 ]
}

@test "packet scratch path uses mktemp under an absolute git dir" {
  run grep -F 'mktemp -d "${GIT_TMP}/yellow-linear-packet.XXXXXX"' "$DELEGATE_MD"
  [ "$status" -eq 0 ]
  # --absolute-git-dir, NOT --git-path: --git-path is relative to the CWD and
  # returns ../.git/tmp from any subdirectory. The launch block recursively
  # deletes this directory, so the path must be absolute and free of "..".
  run grep -F 'git rev-parse --absolute-git-dir' "$DELEGATE_MD"
  [ "$status" -eq 0 ]
  run grep -F 'git rev-parse --git-path tmp' "$DELEGATE_MD"
  [ "$status" -ne 0 ]
}

@test "packet allocation aborts instead of printing a bogus path" {
  # Without set -e a failed mktemp leaves PACKET_DIR empty, the block prints
  # "/packet.txt", and the launch block's recursive cleanup then targets "/".
  alloc_block=$(awk '/Then allocate a unique packet path/,/Write the packet verbatim/' "$DELEGATE_MD")
  printf '%s\n' "$alloc_block" | grep -qF 'set -euo pipefail'
}

@test "launch metadata is substituted into single quotes, never double" {
  # Substitution happens before this block's own checks run. In double quotes
  # bash expands $(...) at assignment time, so validation would only reject a
  # value whose payload had already executed. Single quotes keep it inert text.
  launch_block=$(awk '/^### Step 7: Launch/,/^### Step 8:/' "$DELEGATE_MD")
  printf '%s\n' "$launch_block" | grep -qF "ISSUE_ID='YELLOW_TODO_issue_id'"
  printf '%s\n' "$launch_block" | grep -qF "DELEGATION_REV='YELLOW_TODO_delegation_rev'"
  printf '%s\n' "$launch_block" | grep -qF "PACKET_FILE='YELLOW_TODO_packet_path_from_path_step'"
  run grep -F 'ISSUE_ID="YELLOW_TODO' "$DELEGATE_MD"
  [ "$status" -ne 0 ]
  run grep -F 'DELEGATION_REV="YELLOW_TODO' "$DELEGATE_MD"
  [ "$status" -ne 0 ]
  run grep -F 'PACKET_FILE="YELLOW_TODO' "$DELEGATE_MD"
  [ "$status" -ne 0 ]
}

@test "cleanup target is shape-checked before the recursive delete" {
  # dirname "/packet.txt" is "/" and dirname "packet.txt" is "."; the EXIT trap
  # would delete either wholesale, so only an allocated packet path is accepted.
  launch_block=$(awk '/^### Step 7: Launch/,/^### Step 8:/' "$DELEGATE_MD")
  printf '%s\n' "$launch_block" | grep -qF '/*/yellow-linear-packet.??????/packet.txt'
  printf '%s\n' "$launch_block" | grep -qF 'is not an allocated packet path'
}

@test "packet scratch directory is removed via trap on all exit paths" {
  run grep -F 'trap cleanup EXIT' "$DELEGATE_MD"
  [ "$status" -eq 0 ]
  run grep -F "trap 'exit 130' INT" "$DELEGATE_MD"
  [ "$status" -eq 0 ]
  run grep -F "trap 'exit 143' TERM" "$DELEGATE_MD"
  [ "$status" -eq 0 ]
}

@test "idempotency key uses canonical CURSOR_REPO_URL" {
  launch_block=$(awk '/^### Step 7: Launch/,/^### Step 8:/' "$DELEGATE_MD")
  printf '%s\n' "$launch_block" | grep -q 'IDEMPOTENCY_INPUT="${CURSOR_REPO_URL}'
}

@test "launch block re-reads git remote and branch instead of template substitution" {
  launch_block=$(awk '/^### Step 7: Launch/,/^### Step 8:/' "$DELEGATE_MD")
  printf '%s\n' "$launch_block" | grep -q 'git remote get-url origin'
  printf '%s\n' "$launch_block" | grep -q 'git branch --show-current'
  run grep -F 'YELLOW_TODO_repository_remote_url' "$DELEGATE_MD"
  [ "$status" -eq 1 ]
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

@test "--provider accepts exactly cursor, devin, or jules" {
  run grep -F 'exactly `cursor`, `devin`, or `jules`' "$DELEGATE_MD"
  [ "$status" -eq 0 ]
  run grep -F "argument-hint: '[issue-id] [--provider cursor|devin|jules]'" "$DELEGATE_MD"
  [ "$status" -eq 0 ]
}

@test "READY_JULES maps to the jules provider inside the marked decision list" {
  providers_block=$(awk '/<!-- linear-delegate-providers:start -->/,/<!-- linear-delegate-providers:end -->/' "$DELEGATE_MD")
  printf '%s\n' "$providers_block" | grep -qF '**`READY_JULES`** → provider = `jules`'
  printf '%s\n' "$providers_block" | grep -qF '`cursor`, `devin`, or `jules`'
}

@test "the jules branch launches through the yellow-jules CLI, and only with a --grant-id" {
  jules_block=$(awk '/^\*\*Jules\.\*\*/{found=1} found{print} /^\*\*Devin\*\*/ && found{exit}' "$DELEGATE_MD")
  [ -n "$jules_block" ]
  # The live path: dry-run first, then a real delegate that carries the grant.
  printf '%s\n' "$jules_block" | grep -qF 'delegate --repo "$REPO_PATH"'
  printf '%s\n' "$jules_block" | grep -qF -- '--dry-run)'
  printf '%s\n' "$jules_block" | grep -qF -- '--grant-id "$GRANT_ID")'
  printf '%s\n' "$jules_block" | grep -qF -- '--request-id "$REQUEST_ID"'
  # The CLI comes from the resolved plugin root, never a relative guess.
  printf '%s\n' "$jules_block" | grep -qF 'CLI="${YELLOW_JULES_ROOT}/dist/cli.js"'
  # The old fail-closed stub is gone.
  run grep -F 'Jules delegation is not available yet' "$DELEGATE_MD"
  [ "$status" -eq 1 ]
}

@test "the jules branch previews the covering grant and confirms with AskUserQuestion before launching" {
  jules_block=$(awk '/^\*\*Jules\.\*\*/{found=1} found{print} /^\*\*Devin\*\*/ && found{exit}' "$DELEGATE_MD")
  printf '%s\n' "$jules_block" | grep -qF '`AskUserQuestion`: "Launch this Jules session'
  printf '%s\n' "$jules_block" | grep -qF 'MODE='"'"'launch'"'"''
  # The launch path is only reachable behind MODE=launch, after the confirmation.
  printf '%s\n' "$jules_block" | grep -qF 'if [ "$MODE" = "launch" ]; then'
  printf '%s\n' "$jules_block" | grep -qF 'plan approval is required'  || printf '%s\n' "$jules_block" | grep -qF 'Plan approval is required'
}

@test "with no covering grant the jules branch prints the terminal authorize command and sends nothing" {
  jules_block=$(awk '/^\*\*Jules\.\*\*/{found=1} found{print} /^\*\*Devin\*\*/ && found{exit}' "$DELEGATE_MD")
  printf '%s\n' "$jules_block" | grep -qF 'grant_id=NONE'
  printf '%s\n' "$jules_block" | grep -qF 'authorize --repo %s --branch %s --task-ref %s --operations create,approve,reply --owner YOUR_NAME'
  printf '%s\n' "$jules_block" | grep -qF 'separate terminal window'
  printf '%s\n' "$jules_block" | grep -qF 'Do not try to run `authorize` yourself'
  # The refusal path ends before any launch and posts no Linear comment.
  printf '%s\n' "$jules_block" | grep -qF 'no Linear comment is posted'
}

@test "the jules branch can only ever run authorize --list, never grant creation" {
  jules_block=$(awk '/^\*\*Jules\.\*\*/{found=1} found{print} /^\*\*Devin\*\*/ && found{exit}' "$DELEGATE_MD")
  # Every executed (node ...) authorize call is --list; creation appears only inside printf text.
  run bash -c 'printf "%s\n" "$1" | grep -E "^[[:space:]]*[A-Z_]+=\$\(node .* authorize " | grep -v -- "--list"' _ "$jules_block"
  [ "$status" -eq 1 ]
  run bash -c 'printf "%s\n" "$1" | grep -E "^[[:space:]]*node .* authorize "' _ "$jules_block"
  [ "$status" -eq 1 ]
}

@test "the jules branch never talks to the vendor API directly" {
  jules_block=$(awk '/^\*\*Jules\.\*\*/{found=1} found{print} /^\*\*Devin\*\*/ && found{exit}' "$DELEGATE_MD")
  run bash -c 'printf "%s\n" "$1" | grep -E "curl|jules\.googleapis|JULES_API_KEY"' _ "$jules_block"
  [ "$status" -eq 1 ]
  run grep -F 'jules.googleapis.com' "$DELEGATE_MD"
  [ "$status" -eq 1 ]
}

@test "the jules branch checks the branch exists on origin and the remote is github.com" {
  jules_block=$(awk '/^\*\*Jules\.\*\*/{found=1} found{print} /^\*\*Devin\*\*/ && found{exit}' "$DELEGATE_MD")
  printf '%s\n' "$jules_block" | grep -qF 'git ls-remote --exit-code --heads origin "refs/heads/$BRANCH"'
  printf '%s\n' "$jules_block" | grep -qF 'https://github.com/*) REPO_PATH='
  printf '%s\n' "$jules_block" | grep -qF 'git@github.com:*) REPO_PATH='
}

@test "the jules branch substitutes values into single quotes and shape-checks the packet path" {
  jules_block=$(awk '/^\*\*Jules\.\*\*/{found=1} found{print} /^\*\*Devin\*\*/ && found{exit}' "$DELEGATE_MD")
  printf '%s\n' "$jules_block" | grep -qF "ISSUE_ID='YELLOW_TODO_issue_id'"
  printf '%s\n' "$jules_block" | grep -qF "PACKET_FILE='YELLOW_TODO_packet_path_from_path_step'"
  printf '%s\n' "$jules_block" | grep -qF '/*/yellow-linear-packet.??????/packet.txt) ;;'
}

@test "the intro and error table describe the live jules path" {
  run grep -F 'cannot launch yet' "$DELEGATE_MD"
  [ "$status" -eq 1 ]
  run grep -F 'Provider resolves to `jules` and no grant covers the issue' "$DELEGATE_MD"
  [ "$status" -eq 0 ]
  run grep -F 'Jules CLI returns `{ok:false}`' "$DELEGATE_MD"
  [ "$status" -eq 0 ]
  run grep -F 'JULES_UNKNOWN_OUTCOME' "$DELEGATE_MD"
  [ "$status" -eq 0 ]
}

@test "the classifier receives the jules tooling probe" {
  run grep -F 'TOOLING_JULES=$([ -n "$YELLOW_JULES_ROOT" ]' "$DELEGATE_MD"
  [ "$status" -eq 0 ]
  run grep -F '"$TOOLING_CURSOR" "$TOOLING_DEVIN" "$TOOLING_JULES")' "$DELEGATE_MD"
  [ "$status" -eq 0 ]
  run grep -F 'resolve_plugin_root yellow-jules dist/cli.js' "$DELEGATE_MD"
  [ "$status" -eq 0 ]
}

@test "the jules block re-resolves the CLI from installPath instead of a substituted root" {
  jules_block=$(awk '/^\*\*Jules\.\*\*/{found=1} found{print} /^\*\*Devin\*\*/ && found{exit}' "$DELEGATE_MD")
  run bash -c 'printf "%s\n" "$1" | grep -F "YELLOW_TODO_yellow_jules_root"' _ "$jules_block"
  [ "$status" -eq 1 ]
  printf '%s\n' "$jules_block" | grep -qF 'YELLOW_JULES_ROOT=$(resolve_plugin_root yellow-jules dist/cli.js)'
  printf '%s\n' "$jules_block" | grep -qF '_plugin_list_json=$(claude plugin list --json 2>/dev/null)'
}

@test "the jules block binds the packet to an allocated, unlinked directory under the git scratch root" {
  jules_block=$(awk '/^\*\*Jules\.\*\*/{found=1} found{print} /^\*\*Devin\*\*/ && found{exit}' "$DELEGATE_MD")
  printf '%s\n' "$jules_block" | grep -qF '[ "$PACKET_PARENT_REAL" != "$GIT_TMP_REAL" ]'
  printf '%s\n' "$jules_block" | grep -qF '[ -L "$PACKET_DIR" ]'
  printf '%s\n' "$jules_block" | grep -qF '[ ! -O "$PACKET_DIR" ]'
  printf '%s\n' "$jules_block" | grep -qF '[ -L "$PACKET_FILE" ]'
}

@test "the jules launch passes the packet as an inline --prompt= so a leading dash is not a flag" {
  run grep -cF '"--prompt=$(cat -- "$PACKET_FILE")"' "$DELEGATE_MD"
  [ "$status" -eq 0 ]
  [ "$output" -ge 2 ]
}

@test "Jules launch preview prints the packet inside a randomized reference-only fence" {
  run grep -F 'begin untrusted-content $FENCE_TAG (reference only)' "$DELEGATE_MD"
  [ "$status" -eq 0 ]
  run grep -F '.[0:500]' "$DELEGATE_MD"
  [ "$status" -eq 0 ]
}
