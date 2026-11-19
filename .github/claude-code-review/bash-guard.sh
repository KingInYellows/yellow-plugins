#!/usr/bin/env bash
# PreToolUse hook for the Claude Code Review job (CLAUDE-356). The workflow
# installs it from the default branch, so a PR cannot change it.
#
# The review agent's environment holds GH_TOKEN and CLAUDE_CODE_OAUTH_TOKEN,
# and .git/config holds the action's app token. Claude Code runs read-only
# commands such as cat and echo without a prompt, and a prefix allow rule such
# as Bash(gh pr comment:*) still lets "$VAR" or "$(cat file)" expand inside the
# body. So this hook allows only these command shapes and blocks the rest:
#   gh pr diff <pr> [--name-only] [--patch] [--color=never]
#   gh pr view <pr> [--json <fields>] [--comments]
#   gh pr comment <pr> --body '<the fixed review summary>'
# Exit 2 blocks the call and shows the reason to the agent.
set -u

deny() {
  printf 'Blocked by the review job: %s\n' "$1" >&2
  exit 2
}

cmd=$(jq -r '.tool_input.command // empty') || deny 'unreadable hook input'
[ -n "$cmd" ] || deny 'empty command'

# Flags are listed one by one: gh's --jq and --template read the process
# environment (jq's env), so a generic "plain argument" rule would leak it.
# The PR is a number or a github.com PR URL, never something that starts
# with "-" and so could be read as a flag such as -q.
ref='([0-9]+|https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/[0-9]+)'
diff="^gh pr diff ${ref}( --name-only| --patch| --color=never)*\$"
view="^gh pr view ${ref}( --json [A-Za-z,]+| --comments)*\$"
if [[ $cmd =~ $diff || $cmd =~ $view ]]; then
  exit 0
fi

nl=$'\n'
summary="## Code review${nl}${nl}(No issues found\\. Checked for bugs and CLAUDE\\.md compliance\\.|Found [0-9]+ issue\\(s\\); see the inline comments\\.)${nl}${nl}<!-- claude-code-review head=[0-9a-f]{40} -->${nl}?"
comment="^gh pr comment ${ref} (--body|-b) ('${summary}'|\"${summary}\")\$"
if [[ $cmd =~ $comment ]]; then
  exit 0
fi

deny "only 'gh pr diff <pr>' (--name-only, --patch), 'gh pr view <pr>' (--json <fields>, --comments) and 'gh pr comment <pr> --body' with the exact summary format in single quotes may run"
