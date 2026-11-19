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
#   gh pr comment <pr> --body|-b '<the fixed review summary>' (or "...")
# <pr> is this PR's number or URL and the summary's marker names this head,
# both read from the file the gate step writes.
# Exit 2 blocks the call and shows the reason to the agent.
set -u

deny() {
  printf 'Blocked by the review job: %s\n' "$1" >&2
  exit 2
}

cmd=$(jq -r '.tool_input.command // empty') || deny 'unreadable hook input'
[ -n "$cmd" ] || deny 'empty command'

target="$HOME/.claude/hooks/claude-code-review-target"
read -r repo pr head not_reviewed < "$target" 2>/dev/null || deny 'no review target file'
[[ $repo =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ && $pr =~ ^[0-9]+$ && $head =~ ^[0-9a-f]{40}$ ]] ||
  deny 'malformed review target file'
# The fourth field, the number of files the review could not see, is written
# by the gate step since CLAUDE-371; an older workflow leaves it out.
[[ -z $not_reviewed || $not_reviewed =~ ^[0-9]+$ ]] || deny 'malformed review target file'

# Flags are listed one by one: gh's --jq and --template read the process
# environment (jq's env), so a generic "plain argument" rule would leak it.
# <pr> is only this PR's number or URL, so it can never be a flag such as -q
# or another repository.
ref="(${pr}|https://github\\.com/${repo//./\\.}/pull/${pr})"
diff="^gh pr diff ${ref}( --name-only| --patch| --color=never)*\$"
view="^gh pr view ${ref}( --json [A-Za-z,]+| --comments)*\$"
if [[ $cmd =~ $diff || $cmd =~ $view ]]; then
  exit 0
fi

nl=$'\n'
# The not-reviewed line (CLAUDE-371) is required with the gate's count when it
# is above 0 and refused when it is 0. Without a count, either form passes.
skipped_line="changed file\\(s\\) were not reviewed: binary, or too large for GitHub to send\\."
if [[ -z $not_reviewed ]]; then
  extra="(${nl}${nl}[0-9]+ ${skipped_line})?"
elif ((10#$not_reviewed > 0)); then
  extra="${nl}${nl}$((10#$not_reviewed)) ${skipped_line}"
else
  extra=""
fi
summary="## Code review${nl}${nl}(No issues found\\. Checked for bugs and CLAUDE\\.md compliance\\.|Found [0-9]+ issue\\(s\\); see the inline comments\\.)${extra}${nl}${nl}<!-- claude-code-review head=${head} -->${nl}?"
comment="^gh pr comment ${ref} (--body|-b) ('${summary}'|\"${summary}\")\$"
if [[ $cmd =~ $comment ]]; then
  exit 0
fi

deny "only 'gh pr diff <pr>' (--name-only, --patch, --color=never), 'gh pr view <pr>' (--json <fields>, --comments) and 'gh pr comment <pr> --body' with the exact summary for this head may run, where <pr> is this PR's number or URL"
