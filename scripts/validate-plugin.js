#!/usr/bin/env node

/**
 * Plugin Manifest Validator
 *
 * Validates plugin.json files inside each plugin's .claude-plugin directory.
 * Checks both the official minimal format and optional extended fields.
 *
 * Usage:
 *   node scripts/validate-plugin.js                      # Validate all plugins in plugins/
 *   node scripts/validate-plugin.js plugins/yellow-starter  # Validate specific plugin
 *
 * Exit codes:
 *   0 - All valid
 *   1 - Validation failed
 *   2 - Plugin not found
 */

// NOTE: JSON Schema validation (AJV) runs separately via validate-schemas.js /
// `pnpm validate:schemas`. This script enforces additional rules not expressible
// in JSON Schema: path existence, directory structure, .md file presence, hook
// script sanity, hooks.json drift, and (since the userConfig type/title fix
// per docs/solutions/build-errors/userconfig-type-title-remote-validator-drift.md)
// the userConfig shape constraints. Always run both together via
// `pnpm validate:schemas` — running this script alone does not catch schema
// shape violations in fields like monitors and dependencies.

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.cwd();

// Canonical Claude Code hook events. Module-scope so VALID_HOOK_EVENTS.has()
// is O(1) and the membership test is shared across rules instead of
// re-allocated per validatePlugin call.
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

// Valid `type` values for a userConfig entry, mirroring the Claude Code
// remote validator's enum. Module-scope so RULE 9 can reuse the Set across
// both the top-level userConfig walk and the per-channel walk without
// reallocating it per validatePlugin call (matches the VALID_HOOK_EVENTS
// pattern above). Keep in sync with `definitions.userConfigEntry.properties.type.enum`
// in schemas/plugin.schema.json.
const VALID_USER_CONFIG_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'directory',
  'file',
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
 * Validate a pathOrPaths field that must point to a directory containing .md files.
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
    if (typeof p !== 'string') {
      addError(errors, `${fieldName} entries must be string paths`);
      continue;
    }
    const resolved = resolvePluginPath(p, pluginDir);
    if (!resolved) {
      addError(errors, `${fieldName} path escapes plugin directory: ${p}`);
      continue;
    }
    if (!fs.existsSync(resolved)) {
      addError(errors, `${fieldName} directory not found: ${p}`);
      continue;
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
      continue;
    }
    if (stat.isFile()) {
      if (directoryOnly) {
        addError(
          errors,
          `${fieldName} must point to a directory, not a file: ${p}`
        );
        continue;
      }
      // Schema's relativePath allows pointing directly at a .md file.
      if (!p.endsWith('.md')) {
        addError(errors, `${fieldName} file path must end with .md: ${p}`);
      } else {
        logSuccess(`${fieldName}: ${p}`);
      }
      continue;
    }
    if (!stat.isDirectory()) {
      addError(
        errors,
        `${fieldName} must point to a .md file or a directory: ${p}`
      );
      continue;
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
}

/**
 * Collect inline-form hook entries from either the top-level inline-object
 * form or the array form (which may mix path strings and inline objects).
 * Returns a merged event-keyed dict where each event maps to the
 * concatenated entries arrays from all inline-object sources. Path-string
 * entries are ignored (file existence is enforced separately by RULE 5c).
 *
 * The schema's fileFilesOrInline allows array items to be inline event-keyed
 * configs (e.g. [{"PreToolUse": [...]}]), and those inline objects need to
 * be subjected to RULES 6/7/8 just like the top-level inline-object form.
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

/**
 * Apply RULE 6 (existence / readability / executable mode) and RULE 8
 * (shebang / decision-output / set -e) to a single hook script path.
 * Centralizes per-script-path checks so RULE 6 and RULE 8 cannot drift —
 * previously the inline-object branch ran two separate loops over the same
 * scripts. eventName is required for the DECISION_PROTOCOL_EVENTS gate.
 */
function validateHookScriptPath(scriptPath, eventName, pluginDir, errors) {
  if (!fs.existsSync(scriptPath)) {
    addError(errors, `Hook script not found for ${eventName}: ${scriptPath}`);
    return;
  }
  // Use lstatSync (not statSync) so symlinks are detected before following.
  // A symlink could point outside the plugin directory and bypass the
  // resolvePluginPath boundary check — reject symlinks outright (same policy
  // as resolvePluginPath and validatePathOrPathsDir). Also reject directories:
  // a malformed hook entry like "bash ." resolves to a directory and would
  // throw a confusing EISDIR from readFileSync; make it a hard error instead
  // of a warning so the manifest fails validation.
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

/**
 * Validate a single plugin directory
 */
function validatePlugin(pluginDir) {
  const manifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');
  const dirName = path.basename(pluginDir);
  const errors = [];

  // Check manifest exists
  if (!fs.existsSync(manifestPath)) {
    let reason = 'file not found';
    try {
      fs.lstatSync(manifestPath);
      reason = 'broken symbolic link';
    } catch (lstatErr) {
      if (lstatErr.code === 'EACCES') reason = 'permission denied';
      else if (lstatErr.code === 'ENOTDIR')
        reason = 'parent is not a directory';
    }
    logError(`plugin.json not found at: ${manifestPath} (${reason})`);
    return { valid: false, errors: [`manifest not found: ${reason}`] };
  }

  // Parse JSON
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (err) {
    const detail = err.code ? ` [${err.code}]` : '';
    logError(`Invalid JSON in ${manifestPath}: ${err.message}${detail}`);
    return { valid: false, errors: [`invalid JSON: ${err.message}`] };
  }

  console.log(`\n${colors.cyan}Validating plugin: ${dirName}${colors.reset}`);

  // RULE 1: Required fields (official format: name, description, author)
  if (!manifest.name || typeof manifest.name !== 'string') {
    addError(errors, 'Missing required field: "name"');
  }

  if (!manifest.description || typeof manifest.description !== 'string') {
    addError(errors, 'Missing required field: "description"');
  }

  if (!manifest.author) {
    addError(errors, 'Missing required field: "author"');
  } else if (typeof manifest.author === 'object' && !manifest.author.name) {
    addError(errors, 'author.name is required');
  }

  // RULE 2: Name matches directory
  if (manifest.name && manifest.name !== dirName) {
    addError(
      errors,
      `Plugin name "${manifest.name}" does not match directory name "${dirName}"`
    );
  }

  // RULE 3: Version format (if present). Push the more-informative message
  // (with the MAJOR.MINOR.PATCH hint) into both the structured errors array
  // and stderr — prior code dropped the hint from the errors array.
  if (manifest.version) {
    const semverPattern = /^[0-9]+\.[0-9]+\.[0-9]+$/;
    if (!semverPattern.test(manifest.version)) {
      addError(
        errors,
        `Invalid version format: ${manifest.version} (must be MAJOR.MINOR.PATCH)`
      );
    } else {
      logSuccess(`Version: ${manifest.version}`);
    }
  }

  // RULE 4: Description quality
  if (manifest.description && manifest.description.length < 10) {
    logWarning(
      'Description is very short (< 10 chars). Consider being more descriptive.'
    );
  }

  // RULE 5: Keywords format (if present)
  if (manifest.keywords) {
    if (!Array.isArray(manifest.keywords)) {
      addError(errors, 'keywords must be an array');
    } else {
      const invalidKeywords = manifest.keywords.filter(
        (kw) => typeof kw !== 'string'
      );
      if (invalidKeywords.length > 0) {
        addError(errors, 'All keywords must be strings');
      }
    }
  }

  // RULE 5b/5c: Path existence for outputStyles, commands, agents, skills,
  // mcpServers, lspServers, monitors, and hooks. The schema narrows these
  // into two type-distinct shapes:
  //   - dirOrDirs        (outputStyles/commands/agents/skills) → directory paths
  //   - fileFilesOrInline (mcpServers/hooks/lspServers/monitors) → file paths
  //                                                                or inline objects
  // The validator therefore only enforces filesystem existence: directory
  // checks via validatePathOrPathsDir (recursive .md count, accepts the
  // standard nested layouts), file checks via validatePathFile. Inline
  // objects are structurally accepted by JSON Schema and need no
  // filesystem check here.
  // outputStyles is directory-only: even though Anthropic's relativePath
  // schema accepts a single .md file, the field's runtime semantics need a
  // directory whose .md files are loaded as named output styles. The other
  // dirOrDirs fields (commands/agents/skills) accept single .md files.
  for (const field of ['outputStyles', 'commands', 'agents', 'skills']) {
    const directoryOnly = field === 'outputStyles';
    if (manifest[field] !== undefined && typeof manifest[field] === 'string') {
      // string form — single directory path
      validatePathOrPathsDir(
        field,
        manifest[field],
        pluginDir,
        errors,
        directoryOnly
      );
    } else if (Array.isArray(manifest[field])) {
      // array form — only string entries are filesystem-checked here;
      // any non-string entries would be a schema violation caught by AJV.
      const stringPaths = manifest[field].filter((v) => typeof v === 'string');
      if (stringPaths.length > 0) {
        validatePathOrPathsDir(
          field,
          stringPaths,
          pluginDir,
          errors,
          directoryOnly
        );
      }
    }
  }
  // mcpServers uses pathPathsOrInline — string/array entries point to JSON
  // config files, not directories. Inline-object form (keyed by server name)
  // is structurally validated by JSON Schema and needs no filesystem check.
  if (
    manifest.mcpServers !== undefined &&
    typeof manifest.mcpServers === 'string'
  ) {
    validatePathFile('mcpServers', manifest.mcpServers, pluginDir, errors);
  } else if (Array.isArray(manifest.mcpServers)) {
    for (const p of manifest.mcpServers.filter((v) => typeof v === 'string')) {
      validatePathFile('mcpServers', p, pluginDir, errors);
    }
  }
  // lspServers uses pathPathsOrInline — paths point to JSON config files, not
  // directories, so use file-existence check (not directory + .md check).
  if (
    manifest.lspServers !== undefined &&
    typeof manifest.lspServers === 'string'
  ) {
    validatePathFile('lspServers', manifest.lspServers, pluginDir, errors);
  } else if (Array.isArray(manifest.lspServers)) {
    for (const p of manifest.lspServers.filter((v) => typeof v === 'string')) {
      validatePathFile('lspServers', p, pluginDir, errors);
    }
  }
  // monitors uses pathPathsOrInline — when declared as a path string it points
  // to a config file; inline array entries are objects validated by JSON Schema.
  if (
    manifest.monitors !== undefined &&
    typeof manifest.monitors === 'string'
  ) {
    validatePathFile('monitors', manifest.monitors, pluginDir, errors);
  } else if (Array.isArray(manifest.monitors)) {
    for (const p of manifest.monitors.filter((v) => typeof v === 'string')) {
      validatePathFile('monitors', p, pluginDir, errors);
    }
  }
  // hooks uses pathPathsOrInline — string/array entries point to hooks.json
  // config files. The inline-object form is handled by RULES 6/7/8 below;
  // those rules short-circuit on the !Array.isArray guard, so path-string
  // and path-array forms would otherwise pass with no existence check.
  if (manifest.hooks !== undefined && typeof manifest.hooks === 'string') {
    validatePathFile('hooks', manifest.hooks, pluginDir, errors);
  } else if (Array.isArray(manifest.hooks)) {
    for (const p of manifest.hooks.filter((v) => typeof v === 'string')) {
      validatePathFile('hooks', p, pluginDir, errors);
    }
  }

  // RULES 6/7/8 operate on inline event-keyed hook configs. The
  // fileFilesOrInline schema permits these as either the top-level
  // inline-object form OR as inline objects mixed inside an array form,
  // so collectInlineHooks merges both into a single event-keyed dict.
  const inlineHooks = collectInlineHooks(manifest.hooks);
  const hasInlineHooks = Object.keys(inlineHooks).length > 0;

  // RULES 6 + 8: Hook script existence + content checks (shebang, decision
  // output, set -e). Both rules iterate the same scripts; folding them into a
  // single pass via validateHookScriptPath eliminates duplicate filesystem
  // I/O and removes the prior message drift between the two loops.
  if (hasInlineHooks) {
    for (const [eventName, hookEntries] of Object.entries(inlineHooks)) {
      if (!VALID_HOOK_EVENTS.has(eventName)) {
        logWarning(
          `Unknown hook event "${eventName}". Known events: ${[...VALID_HOOK_EVENTS].join(', ')}`
        );
      }

      if (!Array.isArray(hookEntries)) continue;

      for (const entry of hookEntries) {
        if (!entry.hooks || !Array.isArray(entry.hooks)) continue;

        for (const hook of entry.hooks) {
          if (hook.type !== 'command' || !hook.command) continue;

          const scriptPath = resolveHookScriptPath(hook.command, pluginDir);
          if (!scriptPath) {
            // resolveHookScriptPath returns null both for non-bash commands
            // (echo "...", inline node -e, etc., which need no path check)
            // and for bash commands that escape the plugin directory. The
            // latter is a containment violation and must error.
            const resolved = hook.command.replaceAll(
              '${CLAUDE_PLUGIN_ROOT}',
              pluginDir
            );
            if (/^bash\s+/.test(resolved)) {
              addError(
                errors,
                `Hook script path escapes plugin directory: ${hook.command}`
              );
            }
            continue;
          }

          validateHookScriptPath(scriptPath, eventName, pluginDir, errors);
        }
      }
    }
  } else if (typeof manifest.hooks === 'string') {
    // String hooks field — check for known anti-pattern
    if (
      manifest.hooks === './hooks/hooks.json' ||
      manifest.hooks === 'hooks/hooks.json'
    ) {
      logWarning(
        'hooks field points to standard hooks/hooks.json — Claude Code auto-discovers this file. ' +
          'Explicit declaration may cause duplicate hooks error in Claude Code v2.1+. ' +
          'Consider using inline hooks in plugin.json instead.'
      );
    }
  }

  // RULE 7: hooks.json shape + sync check.
  // Shape and parseability errors block CI: Claude Code 2.1.131+ auto-discovers
  // hooks/hooks.json and validates against { hooks: Record<EventName, ...> },
  // rejecting plugins with a malformed file at install time (e.g., events at
  // the top level instead of nested under "hooks" produces "Hook load failed:
  // expected record, received undefined at path [\"hooks\"]"). Drift between
  // plugin.json inline hooks and hooks.json remains a warning — both files
  // are individually valid, mismatch only signals one was updated without
  // the other.
  const hooksJsonPath = path.join(pluginDir, 'hooks', 'hooks.json');
  if (fs.existsSync(hooksJsonPath)) {
    let hooksJson;
    let parseSuccessful = false;
    try {
      hooksJson = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf-8'));
      parseSuccessful = true;
    } catch (parseErr) {
      addError(
        errors,
        `hooks/hooks.json: cannot parse — must be valid JSON for Claude Code to load the hook config (${parseErr.message})`
      );
    }

    if (parseSuccessful) {
      // Shape check: root must be an object, top-level "hooks" must be a
      // non-null object (not array). A file containing literal `null` parses
      // successfully but must still fail the shape check.
      const rootIsObject =
        typeof hooksJson === 'object' &&
        hooksJson !== null &&
        !Array.isArray(hooksJson);
      const hooksField = rootIsObject ? hooksJson.hooks : undefined;
      const hasValidShape =
        typeof hooksField === 'object' &&
        hooksField !== null &&
        !Array.isArray(hooksField);

      if (!hasValidShape) {
        addError(
          errors,
          'hooks/hooks.json: top-level "hooks" key is required and must be a non-null object — Claude Code 2.1.131+ rejects plugins with a different shape'
        );
      } else {
        // Per-event shape check: each event's value must be an array of hook
        // entries. Claude Code's runtime expects Record<EventName, Array<...>>;
        // a non-array value (string, object, number) passes the top-level
        // shape check but fails at install time. Runs unconditionally — hooks-
        // only plugins (no inline hooks in plugin.json) must also be validated.
        // Event-name recognition mirrors the inline-hooks check above so typos
        // (e.g., "SesionStart") are caught even when plugin.json has no inline
        // hooks to trigger that branch.
        for (const [event, value] of Object.entries(hooksField)) {
          if (!VALID_HOOK_EVENTS.has(event)) {
            logWarning(
              `hooks/hooks.json: unknown hook event "${event}". Known events: ${[...VALID_HOOK_EVENTS].join(', ')}`
            );
          }
          if (!Array.isArray(value)) {
            addError(
              errors,
              `hooks/hooks.json: event "${event}" must be an array of hook entries — got ${value === null ? 'null' : typeof value}; Claude Code 2.1.131+ rejects non-array event values`
            );
          }
        }
      }

      if (hasValidShape && hasInlineHooks) {
        // Drift check between plugin.json inline hooks and hooks.json.
        const hooksJsonHooks = hooksField;
        const manifestHooks = inlineHooks;
        let driftFound = false;

        // Compare event names
        const manifestEvents = new Set(Object.keys(manifestHooks));
        const jsonEvents = new Set(Object.keys(hooksJsonHooks));

        for (const event of manifestEvents) {
          if (!jsonEvents.has(event)) {
            logWarning(
              `hooks.json missing event "${event}" declared in plugin.json`
            );
            driftFound = true;
          }
        }
        for (const event of jsonEvents) {
          if (!manifestEvents.has(event)) {
            logWarning(
              `hooks.json has extra event "${event}" not in plugin.json`
            );
            driftFound = true;
          }
        }

        // Compare matchers for shared events
        for (const event of manifestEvents) {
          if (!jsonEvents.has(event)) continue;
          const mEntries = manifestHooks[event];
          const jEntries = hooksJsonHooks[event];
          if (!Array.isArray(mEntries) || !Array.isArray(jEntries)) continue;

          if (mEntries.length !== jEntries.length) {
            logWarning(
              `hooks.json entry count mismatch for ${event}: ` +
                `plugin.json has ${mEntries.length}, hooks.json has ${jEntries.length}`
            );
            driftFound = true;
          }

          for (let i = 0; i < Math.min(mEntries.length, jEntries.length); i++) {
            const mEntry = mEntries[i] || {};
            const jEntry = jEntries[i] || {};

            if (mEntry.matcher !== jEntry.matcher) {
              logWarning(
                `hooks.json matcher drift for ${event}[${i}]: ` +
                  `plugin.json="${mEntry.matcher}" vs hooks.json="${jEntry.matcher}"`
              );
              driftFound = true;
            }

            // Compare hooks within each entry (command, timeout, type)
            const mHooks = mEntry.hooks || [];
            const jHooks = jEntry.hooks || [];
            if (mHooks.length !== jHooks.length) {
              logWarning(
                `hooks.json inner hooks count mismatch for ${event}[${i}]: ` +
                  `plugin.json has ${mHooks.length}, hooks.json has ${jHooks.length}`
              );
              driftFound = true;
            }
            for (let j = 0; j < Math.min(mHooks.length, jHooks.length); j++) {
              if (mHooks[j].command !== jHooks[j].command) {
                logWarning(
                  `hooks.json command drift for ${event}[${i}].hooks[${j}]: ` +
                    `plugin.json="${mHooks[j].command}" vs hooks.json="${jHooks[j].command}"`
                );
                driftFound = true;
              }
              if (mHooks[j].type !== jHooks[j].type) {
                logWarning(
                  `hooks.json type drift for ${event}[${i}].hooks[${j}]: ` +
                    `plugin.json="${mHooks[j].type}" vs hooks.json="${jHooks[j].type}"`
                );
                driftFound = true;
              }
              if (mHooks[j].timeout !== jHooks[j].timeout) {
                logWarning(
                  `hooks.json timeout drift for ${event}[${i}].hooks[${j}]: ` +
                    `plugin.json=${mHooks[j].timeout} vs hooks.json=${jHooks[j].timeout}`
                );
                driftFound = true;
              }
            }
          }
        }

        if (driftFound) {
          logWarning('hooks.json sync check completed with drift warnings');
        } else {
          logSuccess('hooks.json sync check passed — no drift');
        }
      }
    }
  }

  // (RULE 8 — shebang / decision-output / set -e content checks — folded
  // into RULES 6+8 single-pass loop above via validateHookScriptPath.)

  // RULE 9 + RULE 10: userConfig entry constraints. Local CI mirrors the
  // Claude Code remote validator here because schemas/plugin.schema.json is
  // not currently AJV-loaded by validate-plugin.js — without these checks
  // the drift only surfaces at install time. Both rules cover the top-level
  // `userConfig` object AND each `channels[].userConfig` object, because
  // `channels[*].userConfig` reuses the same `userConfigEntry` schema
  // definition and carries the same constraints.
  //
  // RULE 9: every entry must declare `type` (one of string|number|boolean|
  //   directory|file) and a non-empty `title` string. The remote validator
  //   rejects entries missing either field. See
  //   docs/solutions/build-errors/userconfig-type-title-remote-validator-drift.md
  //
  // RULE 10: optional `pattern` regex constraint. When present, `pattern`
  //   must be a non-empty string that compiles as a JavaScript RegExp, and
  //   `type` must be one of {string, directory, file} (number/boolean values
  //   cannot meaningfully carry a regex constraint). When `default` is also
  //   set as a string, the default itself must match the pattern — otherwise
  //   the manifest ships an internally inconsistent constraint. See
  //   docs/solutions/build-errors/userconfig-pattern-field-schema-extension.md
  const PATTERN_VALID_TYPES = new Set(['string', 'directory', 'file']);
  function validateUserConfigEntries(userConfig, pathPrefix) {
    if (
      typeof userConfig !== 'object' ||
      userConfig === null ||
      Array.isArray(userConfig)
    ) {
      addError(errors, `${pathPrefix} must be an object keyed by config name`);
      return;
    }
    for (const [key, entry] of Object.entries(userConfig)) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        addError(errors, `${pathPrefix}.${key} must be an object`);
        continue;
      }
      if (entry.type == null) {
        addError(
          errors,
          `${pathPrefix}.${key} is missing required field "type" (one of: string, number, boolean, directory, file)`
        );
      } else if (!VALID_USER_CONFIG_TYPES.has(entry.type)) {
        addError(
          errors,
          `${pathPrefix}.${key}.type "${entry.type}" is invalid — must be one of: string, number, boolean, directory, file`
        );
      }
      if (entry.title == null) {
        addError(
          errors,
          `${pathPrefix}.${key} is missing required field "title" (human-readable UI label)`
        );
      } else if (typeof entry.title !== 'string' || entry.title.length === 0) {
        addError(errors, `${pathPrefix}.${key}.title must be a non-empty string`);
      }
      // RULE 10: pattern field validation
      if (entry.pattern !== undefined) {
        if (typeof entry.pattern !== 'string' || entry.pattern.length === 0) {
          addError(
            errors,
            `${pathPrefix}.${key}.pattern must be a non-empty string`
          );
        } else if (
          entry.type != null &&
          VALID_USER_CONFIG_TYPES.has(entry.type) &&
          !PATTERN_VALID_TYPES.has(entry.type)
        ) {
          addError(
            errors,
            `${pathPrefix}.${key}.pattern is only valid when type is one of: string, directory, file (got "${entry.type}")`
          );
        } else {
          let compiled = null;
          try {
            compiled = new RegExp(entry.pattern);
          } catch (e) {
            addError(
              errors,
              `${pathPrefix}.${key}.pattern is not a valid regular expression: ${e.message}`
            );
          }
          if (
            compiled !== null &&
            typeof entry.default === 'string' &&
            !compiled.test(entry.default)
          ) {
            addError(
              errors,
              `${pathPrefix}.${key}.default "${entry.default}" does not match pattern "${entry.pattern}"`
            );
          }
        }
      }
    }
  }

  if (manifest.userConfig !== undefined) {
    validateUserConfigEntries(manifest.userConfig, 'userConfig');
  }
  if (Array.isArray(manifest.channels)) {
    manifest.channels.forEach((ch, i) => {
      if (ch && typeof ch === 'object' && ch.userConfig !== undefined) {
        validateUserConfigEntries(ch.userConfig, `channels[${i}].userConfig`);
      }
    });
  }

  // Summary
  if (errors.length === 0) {
    logSuccess(`Plugin "${manifest.name}" is valid`);
    if (manifest.version) logInfo(`  Version: ${manifest.version}`);
    if (manifest.author)
      logInfo(
        `  Author: ${typeof manifest.author === 'object' ? manifest.author.name : manifest.author}`
      );
    return { valid: true };
  }

  return { valid: false, errors };
}

/**
 * Discover and validate all plugins in the plugins/ directory
 */
function discoverPlugins() {
  const pluginsDir = path.join(PROJECT_ROOT, 'plugins');

  if (!fs.existsSync(pluginsDir)) {
    logWarning('No plugins/ directory found. Nothing to validate.');
    return [];
  }

  const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => path.join(pluginsDir, e.name));
}

// CLI entry point
if (require.main === module) {
  // Support: node validate-plugin.js [pluginDir]
  //          node validate-plugin.js --plugin <manifest-path>
  let pluginArg = process.argv[2];
  let pluginDirs;

  if (pluginArg === '--plugin' && process.argv[3]) {
    // CI passes --plugin <manifest-path> (e.g., plugins/yellow-linear/.claude-plugin/plugin.json)
    // Resolve to the plugin root directory (two levels up from plugin.json)
    const manifestPath = process.argv[3];
    const fullManifest = path.isAbsolute(manifestPath)
      ? manifestPath
      : path.join(PROJECT_ROOT, manifestPath);
    const pluginRoot = path.dirname(path.dirname(fullManifest));
    pluginArg = pluginRoot;
    // Validate resolved path is within project root.
    // Must use path.sep boundary to prevent sibling-directory bypass:
    // a path like /projects-evil/x would otherwise pass when PROJECT_ROOT=/projects.
    if (
      pluginRoot !== PROJECT_ROOT &&
      !pluginRoot.startsWith(PROJECT_ROOT + path.sep)
    ) {
      logError(`--plugin path escapes project root: ${manifestPath}`);
      process.exit(2);
    }
  }

  if (pluginArg) {
    const fullPath = path.isAbsolute(pluginArg)
      ? pluginArg
      : path.join(PROJECT_ROOT, pluginArg);
    if (!fs.existsSync(fullPath)) {
      logError(`Plugin directory not found: ${pluginArg}`);
      process.exit(2);
    }
    pluginDirs = [fullPath];
  } else {
    pluginDirs = discoverPlugins();
  }

  if (pluginDirs.length === 0) {
    logInfo('No plugins found to validate.');
    process.exit(0);
  }

  console.log(
    `\n${colors.cyan}========================================${colors.reset}`
  );
  console.log(
    `${colors.cyan}  Plugin Validator (Official Format)${colors.reset}`
  );
  console.log(
    `${colors.cyan}========================================${colors.reset}`
  );
  logInfo(`Validating ${pluginDirs.length} plugin(s)\n`);

  let hasErrors = false;

  for (const dir of pluginDirs) {
    const result = validatePlugin(dir);
    if (!result.valid) hasErrors = true;
  }

  console.log(
    `\n${colors.cyan}========================================${colors.reset}`
  );
  console.log(`${colors.cyan}  Validation Summary${colors.reset}`);
  console.log(
    `${colors.cyan}========================================${colors.reset}\n`
  );

  if (hasErrors) {
    console.log(
      `${colors.red}✗ Some plugins failed validation${colors.reset}\n`
    );
    process.exit(1);
  } else {
    console.log(
      `${colors.green}✓ All plugins passed validation${colors.reset}\n`
    );
    process.exit(0);
  }
}

module.exports = { validatePlugin };
