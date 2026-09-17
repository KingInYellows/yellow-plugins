'use strict';

/**
 * Host-agnostic policy for the PreToolUse "block raw git push" hook.
 *
 * Pure — no I/O, no console.*, no timestamps — so both entrypoints and the
 * parity harness can call it directly. Reproduces the deleted
 * plugins/gt-workflow/hooks/check-git-push.sh's blocking regex; the field
 * path is NOT reproduced: that script (and this file until 2026-09-16) read
 * `command` at the envelope root, a field no host sends. Real PreToolUse
 * envelopes on Claude Code and Codex nest it under `tool_input.command`
 * (-> toolInput after snake->camel), the same shape check-commit-message
 * reads — so the backstop allowed every raw `git push`. See
 * docs/solutions/code-quality/posttooluse-hook-input-schema-field-paths.md.
 */

// Mirrors the bash script's POSIX ERE: (^|[;&()|$`]|[[:space:]])git[[:space:]]+push
const GIT_PUSH_RE = /(^|[;&()|$`]|\s)git\s+push/m;

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
  // run-hook.js treats truncated stdin, rather than being coerced by the
  // regex test — `RegExp.test` stringifies its argument.
  if (command === undefined) {
    return { decision: 'allow', message: null };
  }
  if (typeof command !== 'string') {
    return { decision: 'deny', message: MALFORMED_MESSAGE };
  }

  if (GIT_PUSH_RE.test(command)) {
    return { decision: 'deny', message: BLOCK_MESSAGE };
  }

  return { decision: 'allow', message: null };
}

module.exports = { checkGitPush };
