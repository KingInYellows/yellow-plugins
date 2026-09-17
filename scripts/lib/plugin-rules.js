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
  HOOK_SCRIPT_PREFIX_SRC,
  UNTERMINATED_HOOK_SCRIPT_QUOTE,
  hookCommandInterpreter,
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

// Placeholder quoting, checked only on the shape RULE 6 parses — the
// script argument right after `bash`/`node` (and any interpreter flags).
// A placeholder elsewhere in a command (inside a longer double-quoted
// string, say) is not word-split and is not this check's business.
// The official hook docs: "in shell form, wrap each placeholder in double
// quotes". Unquoted word-splits on a plugin-cache path with a space and
// the hook fails open; single-quoted is worse — `sh -c` never expands it,
// so the command targets a literal path named "${CLAUDE_PLUGIN_ROOT}/…".
// Both are errors: this validator only runs over this repo's own
// catalog-generated manifests, so there is no third-party leniency to
// preserve, and a warning cannot stop the fail-open form from regressing
// under a green CI.
const UNQUOTED_PLUGIN_ROOT_RE = new RegExp(
  `${HOOK_SCRIPT_PREFIX_SRC}\\$\\{CLAUDE_PLUGIN_ROOT\\}`
);
const SINGLE_QUOTED_PLUGIN_ROOT_RE = new RegExp(
  `${HOOK_SCRIPT_PREFIX_SRC}'\\$\\{CLAUDE_PLUGIN_ROOT\\}`
);

// RULES 6 + 8: Hook script existence + content checks (shebang, decision
// output, set -e) over inline event-keyed hook configs. Both rules iterate
// the same scripts; validateHookScriptPath folds them into one pass. A
// string-valued `hooks` field gets only the RULE 5c path-existence check
// in this module (rulePathFields); rejecting the string form is the
// schema gate's job (schemas/plugin.schema.json allows only inline hooks,
// enforced by the CI AJV step), which runs separately from this script.
function ruleInlineHookScripts(inlineHooks, pluginDir, errors) {
  if (Object.keys(inlineHooks).length > 0) {
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
          // Quoting first, and stop on a hit: resolving a mis-quoted
          // command would only add a second, misleading error (the
          // unquoted form under a spaced plugin path resolves to a
          // truncated first word and reads as a containment escape).
          if (UNQUOTED_PLUGIN_ROOT_RE.test(hook.command)) {
            addError(
              errors,
              `${eventName} hook command has unquoted \${CLAUDE_PLUGIN_ROOT} — word-splits on paths with spaces and the hook fails open; write bash "\${CLAUDE_PLUGIN_ROOT}/…": ${hook.command}`
            );
            continue;
          }
          if (SINGLE_QUOTED_PLUGIN_ROOT_RE.test(hook.command)) {
            addError(
              errors,
              `${eventName} hook command single-quotes \${CLAUDE_PLUGIN_ROOT} — the shell never expands it, so the script can never be found; use double quotes: ${hook.command}`
            );
            continue;
          }
          const interpreter = hookCommandInterpreter(hook.command);
          const scriptPath = resolveHookScriptPath(hook.command, pluginDir);
          if (scriptPath === UNTERMINATED_HOOK_SCRIPT_QUOTE) {
            // The script argument opens a quote it never closes (e.g.
            // `bash "${CLAUDE_PLUGIN_ROOT}/hooks/guard.sh` with no closing
            // `"`). `sh -c` rejects the command outright — even if a file
            // happens to exist at the quote-stripped path, the hook never
            // runs, so this must fail rather than silently pass or fold
            // into the "escapes plugin directory" message below.
            addError(
              errors,
              `${eventName} hook command has an unterminated quote in the script path — the shell will reject this command: ${hook.command}`
            );
            continue;
          }
          if (!scriptPath) {
            // resolveHookScriptPath returns null for commands that are not
            // `bash <path>` / `node <path>` (which get no path check) AND
            // for those that escape the plugin directory — the latter is a
            // containment violation.
            if (interpreter) {
              addError(
                errors,
                `Hook script path escapes plugin directory: ${hook.command}`
              );
            } else if (hook.command.includes('${CLAUDE_PLUGIN_ROOT}')) {
              logWarning(
                `${eventName} hook command uses an unrecognized interpreter — script existence and containment not checked (RULE 6 parses \`bash\`/\`node\` only): ${hook.command}`
              );
            }
            continue;
          }
          validateHookScriptPath(
            scriptPath,
            eventName,
            pluginDir,
            errors,
            interpreter
          );
        }
      }
    }
  }
}

// RULE 7: hooks/hooks.json must not exist. Claude Code auto-discovers the
// file as a second hook source (observed on 2.1.272: it loaded six
// "reference-only" mirrors alongside the inline plugin.json block and fired
// every hook twice). In this marketplace hook config lives only in catalog/
// and is generated into plugin.json, so a hand-written hooks/hooks.json is
// an un-cataloged source that emit-codex.js never mirrors and RULES 6/8
// never inspect. Presence is the error; there is nothing left to validate
// inside the file. Repo policy, not a Claude Code rule — upstream still
// documents hooks-only plugins as valid.
function ruleHooksJson(pluginDir, errors) {
  const hooksJsonPath = path.join(pluginDir, 'hooks', 'hooks.json');
  if (!fs.existsSync(hooksJsonPath)) return;
  addError(
    errors,
    'hooks/hooks.json: not allowed — Claude Code auto-loads it as a second hook source; hook config lives in catalog/plugins/<name>.json#hooks and is generated into plugin.json. Delete this file.'
  );
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
  ruleHooksJson,
  validateUserConfigEntries,
  ruleUserConfig,
  ruleDependencies,
  ruleMcpServerEnv,
};
