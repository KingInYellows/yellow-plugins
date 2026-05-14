'use strict';

/**
 * Path-resolution and hook-script helpers for the plugin manifest validator.
 *
 * Extracted from validate-plugin.js (PR-A, findings 007 + 034). These
 * helpers enforce the plugin-directory containment boundary and the
 * filesystem-existence rules; `validatePlugin()` orchestrates them.
 */

const fs = require('fs');
const path = require('path');

const { addError, logSuccess, logWarning } = require('./logging');

// Canonical Claude Code hook events. Module-scope so VALID_HOOK_EVENTS.has()
// is O(1) and the membership test is shared across rules.
const VALID_HOOK_EVENTS = new Set([
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'UserPromptSubmit',
  'Notification',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'SessionStart',
  'SessionEnd',
  'TeammateIdle',
  'TaskCompleted',
  'PreCompact',
]);

// Hook events whose scripts must emit a decision payload (JSON or exit-code
// protocol). SessionStart is included because Claude Code blocks session
// startup if a SessionStart hook exits without {"continue": true}; absence
// of decision output is a soft warning here so authors notice before the
// session-block manifests in production.
const DECISION_PROTOCOL_EVENTS = new Set([
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SessionStart',
]);

/**
 * Resolve a hook command to a script path within the plugin directory.
 * Returns the resolved path, or null if the command is not a "bash <path>"
 * format or the path escapes the plugin directory.
 */
function resolveHookScriptPath(command, pluginDir) {
  const resolved = command.replaceAll('${CLAUDE_PLUGIN_ROOT}', pluginDir);
  const match = resolved.match(/^bash\s+(\S+)/);
  if (!match) return null;
  const scriptPath = match[1];
  const normalized = path.resolve(pluginDir, scriptPath);
  if (!normalized.startsWith(path.resolve(pluginDir) + path.sep)) return null;
  return normalized;
}

/**
 * Resolve `inputPath` against `pluginDir` and return it only if it stays
 * within the plugin directory boundary; null otherwise.
 */
function resolvePluginPath(inputPath, pluginDir) {
  const normalized = path.resolve(pluginDir, inputPath);
  const pluginRoot = path.resolve(pluginDir);
  if (
    normalized === pluginRoot ||
    normalized.startsWith(pluginRoot + path.sep)
  ) {
    return normalized;
  }
  return null;
}

/**
 * Count .md files under `dir` recursively (skipping symlinks). Used by
 * validatePathOrPathsDir to accept the standard nested layouts:
 *   skills/<name>/SKILL.md
 *   commands/<category>/<name>.md
 *   agents/<category>/<name>.md
 * Symlinked entries are skipped to match the symlink-rejection policy in
 * resolvePluginPath / validatePathFile (PR #343).
 */
function countMarkdownRecursive(dir) {
  let count = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        count++;
      }
    }
  }
  return count;
}

/**
 * Validate a path field that must point to an existing file (not a directory).
 * Used for fields like lspServers and monitors that reference config files.
 * @param {string} fieldName  - Field name for error messages (e.g. 'lspServers')
 * @param {string} filePath   - Single path string to validate
 * @param {string} pluginDir  - Absolute plugin root directory
 * @param {string[]} errors   - Error array to push into
 */
function validatePathFile(fieldName, filePath, pluginDir, errors) {
  const resolved = resolvePluginPath(filePath, pluginDir);
  if (!resolved) {
    addError(errors, `${fieldName} path escapes plugin directory: ${filePath}`);
    return;
  }
  if (!fs.existsSync(resolved)) {
    addError(errors, `${fieldName} file not found: ${filePath}`);
    return;
  }
  // Use lstatSync (not statSync) so symlinks are detected before they are
  // followed; a symlink inside the plugin directory could otherwise point at
  // an arbitrary filesystem location and bypass the resolvePluginPath
  // boundary check. Reject symlinks outright.
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink()) {
    addError(
      errors,
      `${fieldName} path is a symlink which is not permitted: ${filePath}`
    );
    return;
  }
  if (stat.isDirectory()) {
    addError(
      errors,
      `${fieldName} must point to a file, not a directory: ${filePath}`
    );
    return;
  }
  logSuccess(`${fieldName}: ${filePath}`);
}

/**
 * Validate a single pathOrPaths entry: must resolve inside the plugin
 * directory and point to a directory containing .md files (or, unless
 * `directoryOnly`, a single .md file). Extracted from the
 * validatePathOrPathsDir loop body (finding 034) so the per-path logic is
 * independently testable and the wrapper is a thin normalize-and-delegate.
 */
function validateSinglePath(fieldName, p, pluginDir, errors, directoryOnly) {
  if (typeof p !== 'string') {
    addError(errors, `${fieldName} entries must be string paths`);
    return;
  }
  const resolved = resolvePluginPath(p, pluginDir);
  if (!resolved) {
    addError(errors, `${fieldName} path escapes plugin directory: ${p}`);
    return;
  }
  if (!fs.existsSync(resolved)) {
    addError(errors, `${fieldName} directory not found: ${p}`);
    return;
  }
  // lstatSync (not statSync): detect symlinks before following them. A
  // symlink inside the plugin directory could otherwise point to a
  // directory outside and let readdirSync enumerate arbitrary filesystem
  // paths past the resolvePluginPath boundary. Reject symlinks outright.
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink()) {
    addError(
      errors,
      `${fieldName} path is a symlink which is not permitted: ${p}`
    );
    return;
  }
  if (stat.isFile()) {
    if (directoryOnly) {
      addError(
        errors,
        `${fieldName} must point to a directory, not a file: ${p}`
      );
      return;
    }
    // Schema's relativePath allows pointing directly at a .md file.
    if (!p.endsWith('.md')) {
      addError(errors, `${fieldName} file path must end with .md: ${p}`);
    } else {
      logSuccess(`${fieldName}: ${p}`);
    }
    return;
  }
  if (!stat.isDirectory()) {
    addError(
      errors,
      `${fieldName} must point to a .md file or a directory: ${p}`
    );
    return;
  }
  // Walk the directory recursively to find any .md files. The 'skills'
  // field uses SKILL.md files inside per-skill subdirectories; 'commands'
  // and 'agents' commonly group .md files into category subdirectories
  // (e.g. setup/all.md, research/best-practices-researcher.md). A
  // single-level readdirSync misses both layouts and false-rejects them.
  // countMarkdownRecursive skips symlinks at every depth, complementing
  // the top-level lstatSync guard above.
  const mdCount = countMarkdownRecursive(resolved);
  if (mdCount === 0) {
    addError(
      errors,
      `${fieldName} directory must contain at least one .md file (recursively): ${p}`
    );
  } else {
    logSuccess(
      `${fieldName}: ${p} (${mdCount} file${mdCount === 1 ? '' : 's'})`
    );
  }
}

/**
 * Validate a pathOrPaths field that must point to a directory containing .md files.
 * Normalizes the raw manifest value (string | string[]) to an array and
 * delegates each entry to validateSinglePath.
 * When `directoryOnly` is true, single-file `.md` paths are rejected — used
 * for outputStyles where the field shape semantically requires a directory
 * even though Anthropic's relativePath schema allows single .md files.
 * @param {string}  fieldName     - Field name for error messages (e.g. 'commands')
 * @param {*}       fieldValue    - Raw manifest value (string | string[] | other)
 * @param {string}  pluginDir     - Absolute plugin root directory
 * @param {string[]} errors       - Error array to push into
 * @param {boolean} directoryOnly - When true, .md file paths produce an error
 */
function validatePathOrPathsDir(
  fieldName,
  fieldValue,
  pluginDir,
  errors,
  directoryOnly = false
) {
  const paths = Array.isArray(fieldValue)
    ? fieldValue
    : typeof fieldValue === 'string'
      ? [fieldValue]
      : null;
  if (paths === null) {
    addError(
      errors,
      `${fieldName} must be a string path or array of string paths`
    );
    return;
  }
  for (const p of paths) {
    validateSinglePath(fieldName, p, pluginDir, errors, directoryOnly);
  }
}

/**
 * Collect inline-form hook entries from either the top-level inline-object
 * form or the array form (which may mix path strings and inline objects).
 * Returns a merged event-keyed dict where each event maps to the
 * concatenated entries arrays from all inline-object sources. Path-string
 * entries are ignored (file existence is enforced separately by RULE 5c).
 *
 * @param {*} hooks - manifest.hooks raw value
 * @returns {Object} event-keyed dict (possibly empty)
 */
function collectInlineHooks(hooks) {
  const sources =
    hooks && typeof hooks === 'object' && !Array.isArray(hooks)
      ? [hooks]
      : Array.isArray(hooks)
        ? hooks.filter((v) => v && typeof v === 'object' && !Array.isArray(v))
        : [];
  const merged = {};
  for (const source of sources) {
    for (const [event, entries] of Object.entries(source)) {
      if (!Array.isArray(entries)) continue;
      if (!merged[event]) merged[event] = [];
      merged[event].push(...entries);
    }
  }
  return merged;
}

/**
 * Apply RULE 6 (existence / readability / executable mode) and RULE 8
 * (shebang / decision-output / set -e) to a single hook script path.
 * Centralizes per-script-path checks so RULE 6 and RULE 8 cannot drift.
 * eventName is required for the DECISION_PROTOCOL_EVENTS gate.
 */
function validateHookScriptPath(scriptPath, eventName, pluginDir, errors) {
  if (!fs.existsSync(scriptPath)) {
    addError(errors, `Hook script not found for ${eventName}: ${scriptPath}`);
    return;
  }
  // Use lstatSync (not statSync) so symlinks are detected before following.
  // A symlink could point outside the plugin directory and bypass the
  // resolvePluginPath boundary check — reject symlinks outright. Also reject
  // directories: a malformed hook entry like "bash ." resolves to a directory
  // and would throw a confusing EISDIR from readFileSync.
  let lstat;
  try {
    lstat = fs.lstatSync(scriptPath);
  } catch (lstatErr) {
    addError(
      errors,
      `Hook script not accessible for ${eventName}: ${scriptPath} (${lstatErr.message})`
    );
    return;
  }
  if (lstat.isSymbolicLink()) {
    addError(
      errors,
      `Hook script path is a symlink which is not permitted for ${eventName}: ${scriptPath}`
    );
    return;
  }
  if (!lstat.isFile()) {
    addError(
      errors,
      `Hook script must point to a file, not a directory or special file for ${eventName}: ${scriptPath}`
    );
    return;
  }
  try {
    fs.accessSync(scriptPath, fs.constants.R_OK);
  } catch (accessErr) {
    logWarning(
      `Hook script not readable: ${scriptPath} (check file permissions)`
    );
  }
  if ((lstat.mode & 0o111) === 0) {
    logWarning(
      `Hook script not executable: ${scriptPath} (check file permissions)`
    );
  }

  let content;
  try {
    content = fs.readFileSync(scriptPath, 'utf-8');
  } catch (readErr) {
    logWarning(`Cannot read hook script: ${scriptPath} (${readErr.message})`);
    return;
  }

  const relPath = path.relative(pluginDir, scriptPath);

  if (!content.startsWith('#!/')) {
    logWarning(`${relPath}: missing shebang line (expected #!/bin/bash)`);
  }

  if (DECISION_PROTOCOL_EVENTS.has(eventName)) {
    const hasJsonOutput =
      /"continue"\s*:/.test(content) || /"decision"\s*:/.test(content);
    const hasExitCodeProtocol =
      /exit\s+0/.test(content) && /exit\s+2/.test(content);
    if (!hasJsonOutput && !hasExitCodeProtocol) {
      logWarning(
        `${relPath}: missing decision output for ${eventName} — expected {"continue": true}, {"decision": ...}, or exit 0/2 protocol`
      );
    }
  }

  if (
    /^\s*set\s+(?:[^#\n]*?\s)?(-[a-zA-Z]*e[a-zA-Z]*|-o\s+errexit)(\s|$)/m.test(
      content
    )
  ) {
    logWarning(
      `${relPath}: uses "set -e" which can prevent JSON output on error — ` +
        'use "set -uo pipefail" instead'
    );
  }
}

module.exports = {
  VALID_HOOK_EVENTS,
  DECISION_PROTOCOL_EVENTS,
  resolveHookScriptPath,
  resolvePluginPath,
  countMarkdownRecursive,
  validatePathFile,
  validateSinglePath,
  validatePathOrPathsDir,
  collectInlineHooks,
  validateHookScriptPath,
};
