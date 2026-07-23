'use strict';

/**
 * Cross-host hook envelope adapter for yellow-ci's SessionStart hook.
 *
 * Replicated per-plugin (NOT imported from gt-workflow) — R34 forbids
 * cross-plugin/sibling-path imports in anything Codex-exposed.
 *
 * Hook INPUT is snake_case on BOTH Claude Code and Codex, so
 * `snakeToCamelEnvelope` runs on both legs. yellow-ci's SessionStart logic
 * does not actually consume the envelope (it reads cwd / $HOME / `gh`), but
 * the normalizer is kept for R35 compliance and forward-compat.
 *
 * Hook OUTPUT for SessionStart is IDENTICAL on both hosts (R36): the object
 * `{"continue": true}`, optionally carrying a `systemMessage`. So a single
 * `formatSessionStartOutput` serves both entrypoints (unlike gt-workflow's
 * PreToolUse, whose block path differs per host).
 *
 * Pure — no I/O beyond the explicit stdout write in formatSessionStartOutput.
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
 * SessionStart output — same shape on Claude Code and Codex (R36):
 *   {"continue": true}                              (no message)
 *   {"systemMessage": "<msg>", "continue": true}    (with message)
 *
 * @param {{systemMessage?: string}} result
 */
function formatSessionStartOutput(result) {
  const msg = result && typeof result.systemMessage === 'string' ? result.systemMessage : '';
  if (msg.length > 0) {
    process.stdout.write(JSON.stringify({ systemMessage: msg, continue: true }) + '\n');
  } else {
    process.stdout.write(JSON.stringify({ continue: true }) + '\n');
  }
}

module.exports = { snakeToCamelEnvelope, formatSessionStartOutput };
