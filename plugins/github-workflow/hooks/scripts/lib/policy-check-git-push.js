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

// gt-workflow's regex is `(^|[;&()|$`]|\s)git\s+push`, which only catches the
// bare `git push` form. Two ordinary Git invocations slip past it:
//
//   /usr/bin/git push          — the char before `git` is `/`, not a listed
//                                separator, so the leading alternation fails
//   git -C repo push           — global options sit between `git` and `push`,
//   git --git-dir=... push       so `git\s+push` never matches
//
// Both are normal usage, not exotic evasion, so the advertised
// "provider-only submission path" was not actually enforced. This version
// allows an optional absolute/relative path prefix on the binary and any run
// of global options (`-C <dir>`, `--git-dir=...`, `-c k=v`, …) before the
// subcommand. Kept deliberately broad: over-blocking a `git push` variant is
// a recoverable annoyance, under-blocking silently defeats the hook.
const GIT_PUSH_RE = new RegExp(
  [
    '(^|[;&()|$`]|\\s)', // command start or shell separator
    '(?:[\\w./\\\\-]*/)?', // optional path prefix: /usr/bin/, ./bin/, ../
    'git(?:\\.exe)?', // the binary (Windows-friendly)
    '(?:\\s+(?:-[^\\s]+|--[^\\s]+(?:=[^\\s]+)?|-C\\s+[^\\s]+|-c\\s+[^\\s]+))*', // global options
    '\\s+push', // the subcommand
  ].join(''),
  'm'
);

const BLOCK_MESSAGE = [
  '⛔  Raw `git push` is not allowed in this repo.',
  '   Use the `github-stack-submit` skill (or `/github-stack:submit`)',
  '   instead — it stages, commits, and submits via',
  '   github-stack-runtime.js, which pushes safely through `gh stack submit`.',
].join('\n');

/**
 * @param {{toolInput?: {command?: string}}} camelCaseEnvelope
 * @returns {{decision: 'allow'|'deny', message: string|null}}
 */
function checkGitPush(camelCaseEnvelope) {
  // Real PreToolUse envelopes nest the Bash command under `tool_input`
  // (-> toolInput after snake->camel), the SAME shape as PostToolUse — NOT
  // a root-level `.command`. See docs/solutions/code-quality/
  // posttooluse-hook-input-schema-field-paths.md's 2026-07-20/07-22
  // corrections: gt-workflow's sibling file reads root-level `.command` by
  // design, preserved there only for characterization-testing parity with
  // a deleted bash predecessor. This file has no such predecessor to
  // preserve, so it reads the field path real Claude Code/Codex envelopes
  // actually use.
  const command = typeof camelCaseEnvelope.toolInput?.command === 'string' ? camelCaseEnvelope.toolInput.command : '';

  if (GIT_PUSH_RE.test(command)) {
    return { decision: 'deny', message: BLOCK_MESSAGE };
  }

  return { decision: 'allow', message: null };
}

module.exports = { checkGitPush };
