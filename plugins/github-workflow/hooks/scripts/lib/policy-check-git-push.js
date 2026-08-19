'use strict';

/**
 * Host-agnostic policy for the PreToolUse "block raw git push" hook.
 *
 * GitHub-provider mirror of
 * plugins/gt-workflow/hooks/scripts/lib/policy-check-git-push.js — same
 * detection regex and edge-case handling (see run-hook.js's truncation/
 * malformed-JSON fail-closed comments, copied verbatim into this plugin's
 * own run-hook.js), a provider-appropriate block message only. Kept as an
 * independent file rather than a cross-plugin require so github-workflow
 * has no runtime dependency on gt-workflow being installed — this repo's
 * "never fall back to the other provider" invariant extends to "never
 * require the other provider's files to be present" for a provider's own
 * safety hook.
 *
 * Pure — no I/O, no console.*, no timestamps.
 */

// Identical to gt-workflow's GIT_PUSH_RE: (^|[;&()|$`]|[[:space:]])git[[:space:]]+push
const GIT_PUSH_RE = /(^|[;&()|$`]|\s)git\s+push/m;

const BLOCK_MESSAGE = [
  '⛔  Raw `git push` is not allowed in this repo.',
  '   Use the `github-stack-submit` skill (or `/github-stack:submit`)',
  '   instead — it stages, commits, and submits via',
  '   github-stack-runtime.js, which pushes safely through `gh stack submit`.',
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
