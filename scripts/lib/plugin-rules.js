'use strict';

/**
 * The per-rule validation functions for the plugin manifest validator.
 *
 * Extracted from validate-plugin.js's ~585-line `validatePlugin()` god
 * function (PR-A, finding 001). Each `rule*` function takes the manifest
 * (and whatever context it needs) plus the shared `errors` array, and is
 * a pure check — no process exit, no return value beyond pushing errors.
 * `validatePlugin()` in validate-plugin.js is now a thin orchestrator that
 * calls these in order.
 *
 * Rule numbering follows the original inline comments (1–12; there is no
 * RULE 10 — it was the reverted userConfig `pattern` rule).
 */

const fs = require('fs');
const path = require('path');

const { addError, logWarning, logSuccess } = require('./logging');
const {
  VALID_HOOK_EVENTS,
  resolveHookScriptPath,
  validatePathFile,
  validatePathOrPathsDir,
  validateHookScriptPath,
} = require('./plugin-paths');

// Valid `type` values for a userConfig entry, mirroring the Claude Code
// remote validator's enum. Keep in sync with
// `definitions.userConfigEntry.properties.type.enum` in
// schemas/plugin.schema.json.
const VALID_USER_CONFIG_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'directory',
  'file',
]);

// Fields the Claude Code remote validator accepts on a userConfig entry.
// Any other key (e.g. `pattern` from the reverted PR #409) triggers
// "Unrecognized key" on install — catch it locally.
const ALLOWED_USER_CONFIG_FIELDS = new Set([
  'type',
  'title',
  'description',
  'default',
  'required',
  'sensitive',
  'multiple',
  'min',
  'max',
]);

// RULE 1: Required fields (official format: name, description, author).
function ruleRequiredFields(manifest, errors) {
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
}

// RULE 2: Name matches directory.
function ruleNameMatchesDir(manifest, dirName, errors) {
  if (manifest.name && manifest.name !== dirName) {
    addError(
      errors,
      `Plugin name "${manifest.name}" does not match directory name "${dirName}"`
    );
  }
}

// RULE 3: Version format (if present).
function ruleVersionFormat(manifest, errors) {
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
}

// RULE 4: Description quality (warning only).
function ruleDescriptionQuality(manifest) {
  if (manifest.description && manifest.description.length < 10) {
    logWarning(
      'Description is very short (< 10 chars). Consider being more descriptive.'
    );
  }
}

// RULE 5: Keywords format (if present).
function ruleKeywords(manifest, errors) {
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
}

// RULE 5b/5c: Path existence for outputStyles, commands, agents, skills,
// mcpServers, lspServers, monitors, and hooks. dirOrDirs fields get a
// recursive .md-count check; fileFilesOrInline path forms get a file
// existence check. Inline objects are accepted structurally by JSON Schema.
// outputStyles is directory-only.
function rulePathFields(manifest, pluginDir, errors) {
  // dirOrDirs fields: validatePathOrPathsDir normalizes (string → [string])
  // and validateSinglePath type-checks each entry. Pass the raw value so
  // schema violations like a number in the array surface as typed errors
  // instead of being silently filtered out.
  for (const field of ['outputStyles', 'commands', 'agents', 'skills']) {
    if (manifest[field] !== undefined) {
      validatePathOrPathsDir(
        field,
        manifest[field],
        pluginDir,
        errors,
        field === 'outputStyles'
      );
    }
  }

  // mcpServers / lspServers / monitors / hooks use pathPathsOrInline:
  // string and array-of-strings entries point to JSON config files; the
  // inline-object forms (event-keyed dict for hooks, server config object
  // for mcpServers, etc.) are handled by other rules / JSON Schema. Pass
  // string entries straight to validatePathFile, which type-checks and
  // emits a clear error for non-strings — the previous .filter() silently
  // dropped invalid entries like `[123]`.
  for (const field of ['mcpServers', 'lspServers', 'monitors', 'hooks']) {
    const value = manifest[field];
    if (value === undefined) continue;
    if (typeof value === 'string') {
      validatePathFile(field, value, pluginDir, errors);
    } else if (Array.isArray(value)) {
      for (const p of value) {
        // Skip inline-object entries (valid for hook arrays); pass all
        // other types so validatePathFile reports them.
        if (typeof p === 'object' && p !== null) continue;
        validatePathFile(field, p, pluginDir, errors);
      }
    }
    // Top-level inline-object form passes through unhandled — validated
    // elsewhere.
  }
}

// RULES 6 + 8: Hook script existence + content checks (shebang, decision
// output, set -e) over inline event-keyed hook configs. Both rules iterate
// the same scripts; validateHookScriptPath folds them into one pass.
function ruleInlineHookScripts(
  manifest,
  inlineHooks,
  hasInlineHooks,
  pluginDir,
  errors
) {
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
            // resolveHookScriptPath returns null for non-bash commands (which
            // need no path check) AND for bash commands escaping the plugin
            // directory — the latter is a containment violation.
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
}

// RULE 7 helper: compare the inner hooks array of one entry (command, type,
// timeout). Returns true if any drift was found (and logs each warning).
function compareHookInternals(event, i, mHooks, jHooks) {
  let driftFound = false;
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
  return driftFound;
}

// RULE 7 helper: compare the entries array for a single shared event
// (entry count, per-entry matcher, inner hooks). Returns true if any drift
// was found (and logs each warning).
function compareHookEntries(event, mEntries, jEntries) {
  if (!Array.isArray(mEntries) || !Array.isArray(jEntries)) return false;
  let driftFound = false;
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
    if (compareHookInternals(event, i, mEntry.hooks || [], jEntry.hooks || [])) {
      driftFound = true;
    }
  }
  return driftFound;
}

// RULE 7: hooks.json shape + sync check. Shape and parseability errors block
// CI (Claude Code 2.1.131+ auto-discovers hooks/hooks.json and rejects a
// malformed file at install time). Drift between plugin.json inline hooks
// and hooks.json is a warning only.
function ruleHooksJson(pluginDir, inlineHooks, hasInlineHooks, errors) {
  const hooksJsonPath = path.join(pluginDir, 'hooks', 'hooks.json');
  if (!fs.existsSync(hooksJsonPath)) return;

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
  if (!parseSuccessful) return;

  // Shape check: root must be an object, top-level "hooks" must be a
  // non-null object (not array). Literal `null` parses but fails here.
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
    return;
  }

  // Per-event shape check: each event's value must be an array of hook
  // entries. Runs unconditionally — hooks-only plugins must also be checked.
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

  if (!hasInlineHooks) return;

  // Drift check between plugin.json inline hooks and hooks.json.
  const manifestEvents = new Set(Object.keys(inlineHooks));
  const jsonEvents = new Set(Object.keys(hooksField));
  let driftFound = false;

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
      logWarning(`hooks.json has extra event "${event}" not in plugin.json`);
      driftFound = true;
    }
  }
  for (const event of manifestEvents) {
    if (!jsonEvents.has(event)) continue;
    if (compareHookEntries(event, inlineHooks[event], hooksField[event])) {
      driftFound = true;
    }
  }

  if (driftFound) {
    logWarning('hooks.json sync check completed with drift warnings');
  } else {
    logSuccess('hooks.json sync check passed — no drift');
  }
}

// RULE 9 helper: validate one userConfig object (top-level or per-channel).
function validateUserConfigEntries(userConfig, pathPrefix, errors) {
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
    for (const field of Object.keys(entry)) {
      if (!ALLOWED_USER_CONFIG_FIELDS.has(field)) {
        addError(
          errors,
          `${pathPrefix}.${key} has unsupported field "${field}" — Claude Code's remote validator rejects keys outside {${[...ALLOWED_USER_CONFIG_FIELDS].join(', ')}}`
        );
      }
    }
  }
}

// RULE 9: userConfig entry constraints — covers the top-level `userConfig`
// object AND each `channels[].userConfig` object.
function ruleUserConfig(manifest, errors) {
  if (manifest.userConfig !== undefined) {
    validateUserConfigEntries(manifest.userConfig, 'userConfig', errors);
  }
  if (Array.isArray(manifest.channels)) {
    manifest.channels.forEach((ch, i) => {
      if (ch && typeof ch === 'object' && ch.userConfig !== undefined) {
        validateUserConfigEntries(
          ch.userConfig,
          `channels[${i}].userConfig`,
          errors
        );
      }
    });
  }
}

// RULE 11: cross-plugin dependency declarations. Hard deps (`optional` not
// true) WARN if missing from the marketplace catalog; optional deps stay
// silent.
function ruleDependencies(manifest, marketplacePluginNames) {
  if (!Array.isArray(manifest.dependencies) || !marketplacePluginNames) return;
  for (const dep of manifest.dependencies) {
    const depName = typeof dep === 'string' ? dep : dep && dep.name;
    const depOptional = typeof dep === 'object' && dep && dep.optional === true;
    const depReason = typeof dep === 'object' && dep && dep.reason;
    if (!depName || depOptional) continue;
    if (!marketplacePluginNames.has(depName)) {
      const reasonSuffix = depReason ? ` — reason: ${depReason}` : '';
      logWarning(
        `${manifest.name}: declared dependency "${depName}" is not present in marketplace.json catalog${reasonSuffix}`
      );
    }
  }
}

// RULE 12: credential-bearing MCP servers should use the 3-element fallback
// pattern. A bare `${user_config.X}` interpolation without a `${X:-}`
// self-passthrough clobbers any pre-existing shell env value.
function ruleMcpServerEnv(manifest) {
  if (!manifest.mcpServers || typeof manifest.mcpServers !== 'object') return;
  for (const [serverName, server] of Object.entries(manifest.mcpServers)) {
    if (!server || typeof server !== 'object') continue;
    const env = server.env;
    if (!env || typeof env !== 'object') continue;
    for (const [envKey, envValue] of Object.entries(env)) {
      if (typeof envValue !== 'string') continue;
      const userConfigMatch = envValue.match(
        /\$\{user_config\.([a-zA-Z_][a-zA-Z0-9_]*)(?=[}:])/
      );
      if (!userConfigMatch) continue;
      // The conventional `_USERCONFIG` suffix means the wrapper pattern IS
      // in use (the bare env var holds the resolved value).
      if (envKey.endsWith('_USERCONFIG')) continue;
      const selfFallback = '${' + envKey + ':-';
      if (!envValue.includes(selfFallback)) {
        logWarning(
          `${manifest.name}: mcpServers.${serverName}.env.${envKey} interpolates \${user_config.${userConfigMatch[1]}} directly without a \${${envKey}:-} self-passthrough. Consider the 3-element wrapper pattern (${envKey}_USERCONFIG + ${envKey} with \${${envKey}:-} fallback) so power users on multi-host fleets can use shell env. See plugins/yellow-research/bin/start-*.sh for the canonical pattern.`
        );
      }
    }
  }
}

module.exports = {
  VALID_USER_CONFIG_TYPES,
  ALLOWED_USER_CONFIG_FIELDS,
  ruleRequiredFields,
  ruleNameMatchesDir,
  ruleVersionFormat,
  ruleDescriptionQuality,
  ruleKeywords,
  rulePathFields,
  ruleInlineHookScripts,
  compareHookInternals,
  compareHookEntries,
  ruleHooksJson,
  validateUserConfigEntries,
  ruleUserConfig,
  ruleDependencies,
  ruleMcpServerEnv,
};
