'use strict';

/**
 * Host-agnostic policy for the PreToolUse "block raw git push" hook.
 *
 * Pure — no I/O, no console.*, no timestamps — so both entrypoints and the
 * parity harness can call it directly. Detection is delegated to
 * ./git-push-detector.js, which tokenises the command instead of the
 * deleted plugins/gt-workflow/hooks/check-git-push.sh's substring regex
 * (`(^|[;&()|$`]|\s)git\s+push`, evadable by `/usr/bin/git push`,
 * `git -C dir push`, `bash -c "git push"` — see
 * docs/solutions/security-issues/substring-regex-command-denylist-evasion.md).
 * The field path is NOT the bash script's either: that script (and this
 * file until 2026-09-16) read `command` at the envelope root, a field no
 * host sends. Real PreToolUse envelopes on Claude Code and Codex nest it
 * under `tool_input.command` (-> toolInput after snake->camel), the same
 * shape check-commit-message reads — so the backstop allowed every raw
 * `git push`. See
 * docs/solutions/code-quality/posttooluse-hook-input-schema-field-paths.md.
 */

const { commandInvokesGitPush } = require('./git-push-detector.js');

const BLOCK_MESSAGE = [
  '⛔  Raw `git push` is not allowed in this repo.',
  '   Use `gt submit --no-interactive` instead so Graphite keeps the stack in sync.',
  '   If you need to force-push a single branch, use `gt submit` which handles it safely.',
].join('\n');

const MALFORMED_MESSAGE =
  '⛔  Hook input has a non-string tool_input.command. Cannot verify command safety.';

/**
 * @param {{toolInput?: {command?: unknown}}} camelCaseEnvelope
 * @returns {{decision: 'allow'|'deny', message: string|null}}
 */
function checkGitPush(camelCaseEnvelope) {
  // No root-level `.command` fallback — keeping one would preserve the
  // fail-open path for any envelope that is not the real shape.
  const command = camelCaseEnvelope.toolInput?.command;

  // Absent command (non-Bash tool_input, or no tool_input at all): nothing
  // to check, allow. Present but not a string (object, array, number, null):
  // a shape this hook cannot verify, so it fails closed the same way
  // run-hook.js treats truncated stdin, rather than being stringified by
  // the detector.
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
