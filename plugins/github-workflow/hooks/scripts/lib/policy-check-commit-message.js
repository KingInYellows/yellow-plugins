'use strict';

/**
 * Host-agnostic policy for the PostToolUse "warn on non-conventional commit
 * message" hook.
 *
 * GitHub-provider mirror of
 * plugins/gt-workflow/hooks/scripts/lib/policy-check-commit-message.js —
 * same `-m`-flag extraction and conventional-commit check, triggered on
 * plain `git commit` (this plugin's actual commit path — see
 * github-stack-submit/amend skills) instead of `gt modify`/`gt commit`/
 * `gt create`. Kept as an independent file for the same
 * no-cross-plugin-runtime-dependency reason documented in this directory's
 * policy-check-git-push.js.
 *
 * Pure — no I/O, no console.*, no timestamps.
 */

const CONVENTIONAL_PREFIX_RE =
  /^(feat|fix|refactor|docs|test|chore|perf|ci|build|revert)(\(.+\))?!?:/;

const WARN_MESSAGE =
  '[github-workflow] Commit message does not follow conventional commits. ' +
  'Consider: git commit -m "type(scope): description"';

function extractFirstMFlagValue(command) {
  // See gt-workflow's sibling file for why \n is excluded from both
  // character classes (JS negated classes match newlines by default,
  // unlike this policy's line-oriented predecessor).
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
  const command =
    typeof camelCaseEnvelope.toolInput?.command === 'string' ? camelCaseEnvelope.toolInput.command : '';

  const isGitCommitCommand = command.includes('git commit');
  if (!isGitCommitCommand) {
    return { decision: 'allow', message: null };
  }

  // Claude's result envelope key is `tool_result` (-> toolResult); Codex's
  // documented hook stdin uses `tool_response` (-> toolResponse) instead.
  // Absent exit_code defaults to 0 — fail-closed here means "run the
  // validation when uncertain" rather than skip it.
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
