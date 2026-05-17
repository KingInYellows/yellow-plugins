'use strict';

/**
 * Shared console logging helpers for the `scripts/` validators.
 *
 * Extracted from validate-plugin.js (PR-A, finding 007) so the colour
 * palette and the `addError` (push + emit) pairing are defined once. The
 * colour escape codes and PASS/WARN/ERROR/INFO prefixes are part of the
 * validators' observable output contract — keep them stable.
 */

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function logError(message) {
  console.error(`${colors.red}✗ ERROR:${colors.reset} ${message}`);
}

function logWarning(message) {
  console.warn(`${colors.yellow}⚠ WARNING:${colors.reset} ${message}`);
}

function logInfo(message) {
  console.log(`${colors.blue}ℹ INFO:${colors.reset} ${message}`);
}

function logSuccess(message) {
  console.log(`${colors.green}✓ PASS:${colors.reset} ${message}`);
}

/**
 * Append a validation error and emit it to stderr atomically. Centralizes
 * the prior errors.push + logError pair so the structured error returned to
 * callers and the developer-facing log line never drift apart.
 */
function addError(errors, message) {
  errors.push(message);
  logError(message);
}

module.exports = {
  colors,
  logError,
  logWarning,
  logInfo,
  logSuccess,
  addError,
};
