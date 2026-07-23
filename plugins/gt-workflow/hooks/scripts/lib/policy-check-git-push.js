'use strict';

/**
 * Host-agnostic policy for the PreToolUse "block raw git push" hook.
 *
 * Pure — no I/O, no console.*, no timestamps — so both entrypoints and the
 * parity harness can call it directly. Reproduces
 * plugins/gt-workflow/hooks/check-git-push.sh's logic exactly, including
 * reading `command` at the envelope's top level (not `toolInput.command`)
 * — that field path is preserved as-is from the original bash script per
 * this shell's characterization-testing charter; it is not corrected here.
 */

// Mirrors the bash script's POSIX ERE: (^|[;&()|$`]|[[:space:]])git[[:space:]]+push
const GIT_PUSH_RE = /(^|[;&()|$`]|\s)git\s+push/m;

const BLOCK_MESSAGE = [
  '⛔  Raw `git push` is not allowed in this repo.',
  '   Use `gt submit --no-interactive` instead so Graphite keeps the stack in sync.',
  '   If you need to force-push a single branch, use `gt submit` which handles it safely.',
].join('\n');

/**
 * @param {{command?: string}} camelCaseEnvelope
 * @returns {{decision: 'allow'|'deny', message: string|null}}
 */
function checkGitPush(camelCaseEnvelope) {
  const command = camelCaseEnvelope.command ?? '';

  if (GIT_PUSH_RE.test(command)) {
    return { decision: 'deny', message: BLOCK_MESSAGE };
  }

  return { decision: 'allow', message: null };
}

module.exports = { checkGitPush };
