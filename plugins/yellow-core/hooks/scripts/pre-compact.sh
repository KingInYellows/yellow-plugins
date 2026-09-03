#!/usr/bin/env bash
# pre-compact.sh — yellow-core PreCompact hook: tell the compaction summary
# what it must preserve.
#
# Contract (Claude Code 2.1.259 hook reference): on exit 0, stdout is
# appended to the compaction prompt as custom compact instructions; exit 2
# blocks compaction; other codes surface stderr to the user and continue.
# So this hook prints PLAIN TEXT, not the `{"continue": true}` JSON the
# Stop/SessionStart hooks emit — JSON here would land inside the prompt.
#
# The wording follows Anthropic's Claude 5-generation guidance on compaction
# summaries (Prompting Claude Fable 5.1, "Tell the model what to preserve in
# compaction summaries"), trimmed to the items a coding session loses most
# often. Synchronous and dependency-free: no jq, no subshell, well under the
# 3s timeout. `-e` omitted so an unexpected non-zero cannot block compaction.
set -uo pipefail

# Consume stdin (hook input JSON: session_id, trigger=manual|auto,
# custom_instructions, ...). Nothing in it changes the instruction, but
# draining it avoids a SIGPIPE in the caller.
cat >/dev/null 2>&1 || true

cat <<'TEXT'
When summarizing this session, preserve the following exactly, not paraphrased:
1. The active plan or spec file path and every task in it that is still unchecked.
2. Each file modified this session, with a one-line reason for the change.
3. Decisions the user made, constraints they stated, and options they ruled out — in their own words.
4. Open questions, promises made, and the agreed next action.
5. The last failing command and its error text.
6. In-flight branch, PR, worktree, and stack names.
Be complete on these even at the cost of length; condense everything else, and keep what the user said closer to their words than your own explanations.
TEXT
exit 0
