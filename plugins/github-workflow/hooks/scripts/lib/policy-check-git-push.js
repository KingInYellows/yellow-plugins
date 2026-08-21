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
 * tests/hooks.bats's "malformed JSON fails open" case). NOT the same
 * detection regex or envelope field path: this file's regex is
 * deliberately broader (see below) and reads the envelope field path real
 * Claude Code/Codex hosts actually use, rather than gt-workflow's
 * root-level field (see the field-path comment on `checkGitPush` below).
 * A provider-appropriate block message only otherwise. Kept as an
 * independent file rather than a cross-plugin require so github-workflow
 * has no runtime dependency on
 * gt-workflow being installed — this repo's "never fall back to the other
 * provider" invariant extends to "never require the other provider's
 * files to be present" for a provider's own safety hook.
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
//
// A second bypass class: `--git-dir`, `--work-tree`, and `--namespace` also
// accept their value as a SEPARATE token (`git --git-dir /repo push`), not
// just `--opt=value`. The generic `--[^\s]+(?:=[^\s]+)?` alternative only
// absorbs the attached-`=value` form; a space-separated value leaves the
// value token unconsumed, so the required `\s+push` literal never lines up
// and the whole match fails. The extra alternative below handles the
// space-separated form the same way the existing `-C\s+[^\s]+`/`-c\s+[^\s]+`
// alternatives already handle `-C`/`-c`.
const GIT_PUSH_RE = new RegExp(
  [
    '(^|[;&()|$`]|\\s)', // command start or shell separator
    '(?:[\\w./\\\\-]*/)?', // optional path prefix: /usr/bin/, ./bin/, ../
    'git(?:\\.exe)?', // the binary (Windows-friendly)
    '(?:\\s+(?:-[^\\s]+|--[^\\s]+(?:=[^\\s]+)?|-C\\s+[^\\s]+|-c\\s+[^\\s]+|--(?:git-dir|work-tree|namespace)\\s+[^\\s]+))*', // global options
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
