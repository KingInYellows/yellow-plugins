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

  // RULE 6: Hook script existence (if hooks declared as inline object)
  if (manifest.hooks && typeof manifest.hooks === 'object') {
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

  // RULE 7: hooks.json sync check (if both plugin.json hooks and hooks.json exist)
  if (manifest.hooks && typeof manifest.hooks === 'object') {
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

  // RULE 8: Hook script basics (shebang, JSON output, no set -e)
  if (manifest.hooks && typeof manifest.hooks === 'object') {
    for (const [, hookEntries] of Object.entries(manifest.hooks)) {
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

          // Heuristic: check if script source contains JSON output or exit-code protocol
          const hasJsonOutput = /"continue"\s*:/.test(content);
          const hasExitCodeProtocol =
            /exit\s+0/.test(content) && /exit\s+2/.test(content);
          if (!hasJsonOutput && !hasExitCodeProtocol) {
            logWarning(
              `${relPath}: missing hook output — expected {"continue": true} or exit 0/2 protocol`
            );
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
    // Validate resolved path is within project root
    if (!pluginRoot.startsWith(PROJECT_ROOT)) {
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
