'use strict';

/**
 * Host-agnostic policy for the PostToolUse "warn on non-conventional commit
 * message" hook.
 *
 * Pure — no I/O, no console.*, no timestamps — so both entrypoints and the
 * parity harness can call it directly. Reproduces
 * plugins/gt-workflow/hooks/check-commit-message.sh's logic exactly,
 * including the first-`-m`-flag-wins quirk (double-quoted search runs
 * across the whole command before single-quoted is tried at all, so a
 * later double-quoted `-m` can win over an earlier single-quoted one) and
 * the "missing exit_code defaults to 0, which means validation RUNS" fail-
 * closed behavior.
 */

const CONVENTIONAL_PREFIX_RE =
  /^(feat|fix|refactor|docs|test|chore|perf|ci|build|revert)(\(.+\))?!?:/;

const WARN_MESSAGE =
  '[gt-workflow] Commit message does not follow conventional commits. ' +
  'Consider: gt modify -m "type(scope): description"';

function extractFirstMFlagValue(command) {
  // [^"\n] / [^'\n] (not just [^"] / [^']): JS negated character classes
  // match newlines by default, unlike grep's per-line matching in the
  // deleted bash hook. Excluding \n keeps a literal multiline -m value
  // unmatched here, same as the bash version silently skipping validation
  // for it (grep could never see a complete quoted pair on one line).
  const doubleQuoted = command.match(/-m "([^"\n]*)"/);
  if (doubleQuoted) return doubleQuoted[1];

  const singleQuoted = command.match(/-m '([^'\n]*)'/);
  if (singleQuoted) return singleQuoted[1];

  return '';
}

/**
 * @param {{toolInput?: {command?: string}, toolResult?: {exitCode?: number}, toolResponse?: {exitCode?: number}}} camelCaseEnvelope
 * @returns {{decision: 'allow'|'warn', message: string|null}}
 */
function checkCommitMessage(camelCaseEnvelope) {
  // Type-checked, not just `?? ''`: a non-string command (object, number,
  // array from a malformed envelope) would otherwise reach .includes()/
  // .match() below and throw, and this PostToolUse hook MUST always emit
  // its {"continue": true} response — an uncaught throw here skips that.
  const command =
    typeof camelCaseEnvelope.toolInput?.command === 'string' ? camelCaseEnvelope.toolInput.command : '';

  const isGtCommitCommand =
    command.includes('gt modify') ||
    command.includes('gt commit') ||
    command.includes('gt create');
  if (!isGtCommitCommand) {
    return { decision: 'allow', message: null };
  }

  // Claude's result envelope key is `tool_result` (-> toolResult); Codex's
  // documented hook stdin uses `tool_response` (-> toolResponse) instead —
  // see docs/solutions/integration-issues/codex-plugin-manifest-and-hook-contract.md.
  // Check both before falling back. Absent exit_code defaults to 0 —
  // "fail-closed" here means "run the validation when uncertain" rather
  // than skip it.
  const exitCode = camelCaseEnvelope.toolResult?.exitCode ?? camelCaseEnvelope.toolResponse?.exitCode ?? 0;
  if (Number(exitCode) !== 0) {
    return { decision: 'allow', message: null };
  }

  const message = extractFirstMFlagValue(command);
  if (!message) {
    return { decision: 'allow', message: null };
  }

  if (CONVENTIONAL_PREFIX_RE.test(message)) {
    return { decision: 'allow', message: null };
  }

  return { decision: 'warn', message: WARN_MESSAGE };
}

module.exports = { checkCommitMessage };
