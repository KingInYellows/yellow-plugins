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
// script sanity, and hooks.json drift. Always run both together via
// `pnpm validate:schemas` — running this script alone does not catch schema
// shape violations in fields like monitors, channels, userConfig, and
// dependencies.

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.cwd();

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
  if (normalized === pluginRoot || normalized.startsWith(pluginRoot + path.sep)) {
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
    errors.push(`${fieldName} path escapes plugin directory: ${filePath}`);
    logError(`${fieldName} path escapes plugin directory: ${filePath}`);
  } else if (!fs.existsSync(resolved)) {
    errors.push(`${fieldName} file not found: ${filePath}`);
    logError(`${fieldName} file not found: ${filePath}`);
  } else if (fs.statSync(resolved).isDirectory()) {
    errors.push(`${fieldName} must point to a file, not a directory: ${filePath}`);
    logError(`${fieldName} must point to a file, not a directory: ${filePath}`);
  } else {
    logSuccess(`${fieldName}: ${filePath}`);
  }
}

/**
 * Validate a pathOrPaths field that must point to a directory containing .md files.
 * @param {string} fieldName  - Field name for error messages (e.g. 'commands')
 * @param {*}      fieldValue - Raw manifest value (string | string[] | other)
 * @param {string} pluginDir  - Absolute plugin root directory
 * @param {string[]} errors   - Error array to push into
 */
function validatePathOrPathsDir(fieldName, fieldValue, pluginDir, errors) {
  const paths = Array.isArray(fieldValue)
    ? fieldValue
    : typeof fieldValue === 'string'
      ? [fieldValue]
      : null;
  if (paths === null) {
    errors.push(`${fieldName} must be a string path or array of string paths`);
    logError(`${fieldName} must be a string path or array of string paths`);
    return;
  }
  for (const p of paths) {
    if (typeof p !== 'string') {
      errors.push(`${fieldName} entries must be string paths`);
      logError(`${fieldName} entries must be string paths`);
      continue;
    }
    const resolved = resolvePluginPath(p, pluginDir);
    if (!resolved) {
      errors.push(`${fieldName} path escapes plugin directory: ${p}`);
      logError(`${fieldName} path escapes plugin directory: ${p}`);
    } else if (!fs.existsSync(resolved)) {
      errors.push(`${fieldName} directory not found: ${p}`);
      logError(`${fieldName} directory not found: ${p}`);
    } else if (!fs.statSync(resolved).isDirectory()) {
      errors.push(`${fieldName} must point to a directory: ${p}`);
      logError(`${fieldName} must point to a directory: ${p}`);
    } else {
      // Walk the directory recursively to find any .md files. The 'skills'
      // field uses SKILL.md files inside per-skill subdirectories; 'commands'
      // and 'agents' commonly group .md files into category subdirectories
      // (e.g. setup/all.md, research/best-practices-researcher.md). A
      // single-level readdirSync misses both layouts and false-rejects them.
      const mdCount = countMarkdownRecursive(resolved);
      if (mdCount === 0) {
        errors.push(
          `${fieldName} directory must contain at least one .md file (recursively): ${p}`
        );
        logError(
          `${fieldName} directory must contain at least one .md file (recursively): ${p}`
        );
      } else {
        logSuccess(
          `${fieldName}: ${p} (${mdCount} file${mdCount === 1 ? '' : 's'})`
        );
      }
    }
  }
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
    errors.push('Missing required field: "name"');
    logError('Missing required field: "name"');
  }

  if (!manifest.description || typeof manifest.description !== 'string') {
    errors.push('Missing required field: "description"');
    logError('Missing required field: "description"');
  }

  if (!manifest.author) {
    errors.push('Missing required field: "author"');
    logError('Missing required field: "author"');
  } else if (typeof manifest.author === 'object' && !manifest.author.name) {
    errors.push('author.name is required');
    logError('author.name is required');
  }

  // RULE 2: Name matches directory
  if (manifest.name && manifest.name !== dirName) {
    errors.push(
      `Plugin name "${manifest.name}" does not match directory name "${dirName}"`
    );
    logError(
      `Plugin name "${manifest.name}" does not match directory name "${dirName}"`
    );
  }

  // RULE 3: Version format (if present)
  if (manifest.version) {
    const semverPattern = /^[0-9]+\.[0-9]+\.[0-9]+$/;
    if (!semverPattern.test(manifest.version)) {
      errors.push(`Invalid version format: ${manifest.version}`);
      logError(
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
      errors.push('keywords must be an array');
      logError('keywords must be an array');
    } else {
      const invalidKeywords = manifest.keywords.filter(
        (kw) => typeof kw !== 'string'
      );
      if (invalidKeywords.length > 0) {
        errors.push('All keywords must be strings');
        logError('All keywords must be strings');
      }
    }
  }

  // RULE 5b: output styles directory (if present)
  // Per schema, outputStyles may be a single path string or an array of path strings.
  if (manifest.outputStyles !== undefined) {
    const stylePaths = Array.isArray(manifest.outputStyles)
      ? manifest.outputStyles
      : typeof manifest.outputStyles === 'string'
        ? [manifest.outputStyles]
        : null;
    if (stylePaths === null) {
      errors.push('outputStyles must be a string path or array of string paths');
      logError('outputStyles must be a string path or array of string paths');
    } else {
      for (const stylePath of stylePaths) {
        if (typeof stylePath !== 'string') {
          errors.push('outputStyles entries must be string paths');
          logError('outputStyles entries must be string paths');
          continue;
        }
        const stylesDir = resolvePluginPath(stylePath, pluginDir);
        if (!stylesDir) {
          errors.push(`outputStyles path escapes plugin directory: ${stylePath}`);
          logError(`outputStyles path escapes plugin directory: ${stylePath}`);
        } else if (!fs.existsSync(stylesDir)) {
          errors.push(`outputStyles directory not found: ${stylePath}`);
          logError(`outputStyles directory not found: ${stylePath}`);
        } else if (!fs.statSync(stylesDir).isDirectory()) {
          errors.push(`outputStyles must point to a directory: ${stylePath}`);
          logError(`outputStyles must point to a directory: ${stylePath}`);
        } else {
          const styleFiles = fs
            .readdirSync(stylesDir, { withFileTypes: true })
            .filter((entry) => entry.isFile() && entry.name.endsWith('.md'));
          if (styleFiles.length === 0) {
            errors.push(
              `outputStyles directory must contain at least one .md file: ${stylePath}`
            );
            logError(
              `outputStyles directory must contain at least one .md file: ${stylePath}`
            );
          } else {
            logSuccess(
              `Output styles: ${stylePath} (${styleFiles.length} file${styleFiles.length === 1 ? '' : 's'})`
            );
          }
        }
      }
    }
  }

  // RULE 5c: Path existence for commands, agents, skills, mcpServers,
  // lspServers, monitors, and hooks. These fields accept pathOrPaths
  // (commands/agents/skills) or pathPathsOrInline (mcpServers/lspServers/
  // monitors/hooks). Validate only the string-path forms; inline objects
  // are structurally accepted by JSON Schema and need no filesystem check
  // here.
  for (const field of ['commands', 'agents', 'skills']) {
    if (manifest[field] !== undefined && typeof manifest[field] !== 'object') {
      // non-object = string or array of strings → validate as directory paths
      validatePathOrPathsDir(field, manifest[field], pluginDir, errors);
    } else if (Array.isArray(manifest[field])) {
      // array may mix path strings and inline objects — validate only strings
      const stringPaths = manifest[field].filter((v) => typeof v === 'string');
      if (stringPaths.length > 0) {
        validatePathOrPathsDir(field, stringPaths, pluginDir, errors);
      }
    }
  }
  // mcpServers uses pathPathsOrInline — string/array entries point to JSON
  // config files, not directories. Inline-object form (keyed by server name)
  // is structurally validated by JSON Schema and needs no filesystem check.
  if (manifest.mcpServers !== undefined && typeof manifest.mcpServers === 'string') {
    validatePathFile('mcpServers', manifest.mcpServers, pluginDir, errors);
  } else if (Array.isArray(manifest.mcpServers)) {
    for (const p of manifest.mcpServers.filter((v) => typeof v === 'string')) {
      validatePathFile('mcpServers', p, pluginDir, errors);
    }
  }
  // lspServers uses pathPathsOrInline — paths point to JSON config files, not
  // directories, so use file-existence check (not directory + .md check).
  if (manifest.lspServers !== undefined && typeof manifest.lspServers === 'string') {
    validatePathFile('lspServers', manifest.lspServers, pluginDir, errors);
  } else if (Array.isArray(manifest.lspServers)) {
    for (const p of manifest.lspServers.filter((v) => typeof v === 'string')) {
      validatePathFile('lspServers', p, pluginDir, errors);
    }
  }
  // monitors uses pathPathsOrInline — when declared as a path string it points
  // to a config file; inline array entries are objects validated by JSON Schema.
  if (manifest.monitors !== undefined && typeof manifest.monitors === 'string') {
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

  // RULE 6: Hook script existence (if hooks declared as inline object).
  // Skip when hooks is an array (the path-array form added by the extended
  // schema) — array entries are paths/objects, not event-keyed, so the
  // event-name validation below does not apply.
  if (
    manifest.hooks &&
    typeof manifest.hooks === 'object' &&
    !Array.isArray(manifest.hooks)
  ) {
    const VALID_HOOK_EVENTS = [
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
    ];

    for (const [eventName, hookEntries] of Object.entries(manifest.hooks)) {
      // Validate event name
      if (!VALID_HOOK_EVENTS.includes(eventName)) {
        logWarning(
          `Unknown hook event "${eventName}". Known events: ${VALID_HOOK_EVENTS.join(', ')}`
        );
      }

      if (!Array.isArray(hookEntries)) continue;

      for (const entry of hookEntries) {
        if (!entry.hooks || !Array.isArray(entry.hooks)) continue;

        for (const hook of entry.hooks) {
          if (hook.type !== 'command' || !hook.command) continue;

          const scriptPath = resolveHookScriptPath(hook.command, pluginDir);
          if (!scriptPath) {
            // Check if it was a bash command that escaped the plugin dir
            const resolved = hook.command.replaceAll(
              '${CLAUDE_PLUGIN_ROOT}',
              pluginDir
            );
            if (/^bash\s+/.test(resolved)) {
              errors.push(
                `Hook script path escapes plugin directory: ${hook.command}`
              );
              logError(
                `Hook script path escapes plugin directory: ${hook.command}`
              );
            }
            continue;
          }

          if (!fs.existsSync(scriptPath)) {
            errors.push(
              `Hook script not found: ${hook.command} (resolved: ${scriptPath})`
            );
            logError(
              `Hook script not found for ${eventName}: ${hook.command}`
            );
          } else {
            try {
              fs.accessSync(scriptPath, fs.constants.R_OK);
            } catch (accessErr) {
              logWarning(
                `Hook script not readable: ${scriptPath} (check file permissions)`
              );
            }
            try {
              const mode = fs.statSync(scriptPath).mode;
              if ((mode & 0o111) === 0) {
                logWarning(
                  `Hook script not executable: ${scriptPath} (check file permissions)`
                );
              }
            } catch (statErr) {
              logWarning(
                `Cannot inspect hook script mode: ${scriptPath} (${statErr.message})`
              );
            }
          }
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

  // RULE 7: hooks.json sync check (if both plugin.json hooks and hooks.json exist).
  // Only meaningful for inline-object hooks; array form has no event keys.
  if (
    manifest.hooks &&
    typeof manifest.hooks === 'object' &&
    !Array.isArray(manifest.hooks)
  ) {
    const hooksJsonPath = path.join(pluginDir, 'hooks', 'hooks.json');
    if (fs.existsSync(hooksJsonPath)) {
      try {
        const hooksJson = JSON.parse(
          fs.readFileSync(hooksJsonPath, 'utf-8')
        );
        const hooksJsonHooks = hooksJson.hooks || {};
        const manifestHooks = manifest.hooks;
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

          for (
            let i = 0;
            i < Math.min(mEntries.length, jEntries.length);
            i++
          ) {
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
            for (
              let j = 0;
              j < Math.min(mHooks.length, jHooks.length);
              j++
            ) {
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
      } catch (parseErr) {
        logWarning(`Cannot parse hooks.json: ${parseErr.message}`);
      }
    }
  }

  // RULE 8: Hook script basics (shebang, decision output, no set -e)
  if (
    manifest.hooks &&
    typeof manifest.hooks === 'object' &&
    !Array.isArray(manifest.hooks)
  ) {
    const DECISION_PROTOCOL_EVENTS = new Set([
      'PreToolUse',
      'PostToolUse',
      'Stop',
    ]);

    for (const [eventName, hookEntries] of Object.entries(manifest.hooks)) {
      if (!Array.isArray(hookEntries)) continue;

      for (const entry of hookEntries) {
        if (!entry.hooks || !Array.isArray(entry.hooks)) continue;

        for (const hook of entry.hooks) {
          if (hook.type !== 'command' || !hook.command) continue;

          const scriptPath = resolveHookScriptPath(hook.command, pluginDir);
          if (!scriptPath || !fs.existsSync(scriptPath)) continue;

          let content;
          try {
            content = fs.readFileSync(scriptPath, 'utf-8');
          } catch (readErr) {
            logWarning(
              `Cannot read hook script: ${scriptPath} (${readErr.message})`
            );
            continue;
          }

          const relPath = path.relative(pluginDir, scriptPath);

          // Check shebang
          if (!content.startsWith('#!/')) {
            logWarning(`${relPath}: missing shebang line (expected #!/bin/bash)`);
          }

          if (DECISION_PROTOCOL_EVENTS.has(eventName)) {
            // Decision hooks should either emit a JSON decision or use exit 0/2.
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

          // Check for set -e anti-pattern (matches -e flag or -o errexit)
          if (
            /^\s*set\s+(-[a-zA-Z]*e[a-zA-Z]*|-o\s+errexit)(\s|$)/m.test(
              content
            )
          ) {
            logWarning(
              `${relPath}: uses "set -e" which can prevent JSON output on error — ` +
                'use "set -uo pipefail" instead'
            );
          }
        }
      }
    }
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
    if (pluginRoot !== PROJECT_ROOT && !pluginRoot.startsWith(PROJECT_ROOT + path.sep)) {
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
