'use strict';

/**
 * Host-agnostic policy for the PreToolUse "block raw git push" hook.
 *
 * GitHub-provider counterpart of
 * plugins/gt-workflow/hooks/scripts/lib/policy-check-git-push.js — same
 * purpose (block raw `git push`) and the same run-hook.js edge-case
 * handling (see that file's comments, copied verbatim into this plugin's
 * own run-hook.js): oversized (>64KB) stdin fails CLOSED — `runHook`
 * synthesizes a `deny` result without ever calling this policy — while
 * malformed JSON or a null/non-object envelope fails OPEN for this hook
 * specifically (`runHook` returns with no output, i.e. no PreToolUse
 * decision, which Claude Code/Codex both treat as allow — see
 * tests/hooks.bats's "malformed JSON fails open" case). Two distinct
 * shapes, two distinct outcomes: an ABSENT `tool_input`/`command` or an
 * unparseable envelope fails OPEN (nothing to verify, defensive); a PRESENT
 * but non-string `tool_input.command` fails CLOSED (a shape the policy
 * cannot verify, denied like gt-workflow's sibling rather than coerced to
 * `''` and allowed, which this file did until 2026-09-17). Same detection
 * (./git-push-detector.js, a byte-identical copy of gt-workflow's — see
 * that file's header) but a provider-appropriate block message. Both files
 * read the same envelope field path (`tool_input.command` ->
 * `toolInput.command`) since 2026-09-16 — see the field-path comment on
 * `checkGitPush` below for gt-workflow's history there. Kept as an
 * independent file rather than a cross-plugin require so github-workflow
 * has no runtime dependency on
 * gt-workflow being installed — this repo's "never fall back to the other
 * provider" invariant extends to "never require the other provider's
 * files to be present" for a provider's own safety hook.
 *
 * Pure — no I/O, no console.*, no timestamps.
 */

// History: this file's regex was deliberately broader than gt-workflow's
// (`/usr/bin/git push`, `git -C repo push`, space-separated `--git-dir`),
// but a regex over raw text still missed `bash -c "git push"` and tripped
// on quoted literals. The shared tokenising detector replaces both regexes
// — see docs/solutions/security-issues/substring-regex-command-denylist-evasion.md.
const { commandInvokesGitPush } = require('./git-push-detector.js');

const BLOCK_MESSAGE = [
  '⛔  Raw `git push` is not allowed in this repo.',
  '   Use the `github-stack-submit` skill (or `/github-stack:submit`)',
  '   instead — it stages, commits, and submits via',
  '   github-stack-runtime.js, which pushes safely through `gh stack submit`.',
].join('\n');

const MALFORMED_MESSAGE =
  '⛔  Hook input has a non-string tool_input.command. Cannot verify command safety.';

/**
 * @param {{toolInput?: {command?: unknown}}} camelCaseEnvelope
 * @returns {{decision: 'allow'|'deny', message: string|null}}
 */
function checkGitPush(camelCaseEnvelope) {
  // Real PreToolUse envelopes nest the Bash command under `tool_input`
  // (-> toolInput after snake->camel), the SAME shape as PostToolUse — NOT
  // a root-level `.command`. See docs/solutions/code-quality/
  // posttooluse-hook-input-schema-field-paths.md; gt-workflow's sibling
  // reads the same path since 2026-09-16.
  const command = camelCaseEnvelope.toolInput?.command;

  // Absent: nothing to check (non-Bash tool_input, or no tool_input at all)
  // — the documented fail-open. Present but not a string (object, array,
  // number, null): fail closed, mirroring gt-workflow.
  if (command === undefined) {
    return { decision: 'allow', message: null };
  }
  if (typeof command !== 'string') {
    return { decision: 'deny', message: MALFORMED_MESSAGE };
  }

  if (commandInvokesGitPush(command)) {
    return { decision: 'deny', message: BLOCK_MESSAGE };
  }

  return { decision: 'allow', message: null };
}

module.exports = { checkGitPush };
