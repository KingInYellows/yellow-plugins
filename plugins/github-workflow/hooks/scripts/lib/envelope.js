'use strict';

/**
 * Cross-host hook envelope adapter.
 *
 * Hook INPUT is snake_case on BOTH Claude Code and Codex (confirmed against
 * code.claude.com/docs/en/hooks and this repo's own check-commit-message.sh,
 * which reads `.tool_input.command` / `.tool_result.exit_code` directly from
 * Claude's stdin) — `snakeToCamelEnvelope` runs on both legs, not Codex
 * only. Hook OUTPUT differs: Claude's PreToolUse denial is exit code 2 +
 * a plain-text stderr message (no JSON at all); Codex's is a camelCase
 * `hookSpecificOutput` JSON object. PostToolUse output is the same
 * `{"continue": true, ...}` camelCase JSON shape on both hosts.
 *
 * Pure — no I/O beyond the explicit stdout/stderr writes in the format*
 * functions, no timestamps.
 */

function snakeToCamelKey(key) {
  return key.replace(/_([a-z0-9])/g, (_match, char) => char.toUpperCase());
}

function snakeToCamelEnvelope(value) {
  if (Array.isArray(value)) {
    return value.map(snakeToCamelEnvelope);
  }
  if (value !== null && typeof value === 'object') {
    const result = {};
    for (const [key, val] of Object.entries(value)) {
      result[snakeToCamelKey(key)] = snakeToCamelEnvelope(val);
    }
    return result;
  }
  return value;
}

/**
 * @param {'PreToolUse'|'PostToolUse'} hookEvent
 * @param {{decision: string, message: string|null}} result
 */
function formatClaudeOutput(hookEvent, result) {
  if (hookEvent === 'PreToolUse') {
    if (result.decision === 'deny') {
      process.exitCode = 2;
      process.stderr.write(result.message + '\n');
    }
    // allow: no output, default exit code 0 — matches check-git-push.sh.
    return;
  }
  if (hookEvent === 'PostToolUse') {
    if (result.decision === 'warn') {
      process.stdout.write(JSON.stringify({ continue: true, systemMessage: result.message }) + '\n');
      return;
    }
    process.stdout.write(JSON.stringify({ continue: true }) + '\n');
    return;
  }
  throw new Error(`formatClaudeOutput: unsupported hook event "${hookEvent}"`);
}

/**
 * @param {'PreToolUse'|'PostToolUse'} hookEvent
 * @param {{decision: string, message: string|null}} result
 */
function formatCodexOutput(hookEvent, result) {
  if (hookEvent === 'PreToolUse') {
    if (result.decision === 'deny') {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: result.message,
          },
        }) + '\n'
      );
    }
    // allow: no output — symmetric with formatClaudeOutput's allow path.
    return;
  }
  if (hookEvent === 'PostToolUse') {
    if (result.decision === 'warn') {
      process.stdout.write(JSON.stringify({ continue: true, systemMessage: result.message }) + '\n');
      return;
    }
    process.stdout.write(JSON.stringify({ continue: true }) + '\n');
    return;
  }
  throw new Error(`formatCodexOutput: unsupported hook event "${hookEvent}"`);
}

module.exports = { snakeToCamelEnvelope, formatClaudeOutput, formatCodexOutput };
