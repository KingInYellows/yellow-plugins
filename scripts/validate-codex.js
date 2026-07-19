#!/usr/bin/env node

'use strict';

/**
 * validate-codex.js (`pnpm validate:codex`, R10)
 *
 * Two independent checks over every Codex-enabled plugin's generated
 * artifacts:
 *
 *   1. Artifact validation — plugins/<name>/.codex-plugin/plugin.json,
 *      plugins/<name>/hooks/codex-hooks.json (when present), and
 *      .agents/plugins/marketplace.json each validate against their
 *      schemas/codex-*.schema.json (R11). Uses the `ajv`/`ajv-formats` npm
 *      packages directly (plain CJS `require`, not the TS
 *      `AjvValidatorFactory` — packages/infrastructure is ESM-only and
 *      scripts/ cannot `require()` it; this mirrors how
 *      generate-manifests.js and the rest of scripts/lib/generate/ are
 *      pure CJS).
 *   2. Exposure lint (R15) — every Codex-exposed file (the plugin manifest
 *      and its copied skill tree under plugins/<name>/codex/skills/, or
 *      the plugin's targets.codex.componentPaths.skills override when set)
 *      is scanned for Claude-only constructs that must never reach a Codex
 *      session: Claude-only tool names, slash-command syntax, $ARGUMENTS,
 *      .claude/ writes, sibling-plugin paths, hard-coded mcp__plugin_*
 *      names, userConfig, output styles, and agent references. Checks scan
 *      RAW file content INCLUDING fenced code blocks — unlike
 *      validate-agent-authoring.js's authoring-convention checks (which
 *      strip fences to avoid false-positiving on illustrative examples), a
 *      leaked construct hidden inside a fence still reaches the model's
 *      context once Codex reads the file, so it must not be excluded here.
 *      Checks are registry-gated where a real registry exists (actual
 *      plugin names, actual generated mcp__plugin_* tool names) rather than
 *      matching on token shape alone, per R15.
 *
 *      DEFERRED (R15, not implemented here): a declaration-aware check
 *      that flags Codex-exposed content referencing an undeclared
 *      executable or MCP server dependency. Blocked on: (a) no
 *      declared-executables schema/registry exists anywhere in this repo
 *      (Claude side or Codex side) to check references against; (b)
 *      schemas/codex-plugin.schema.json's `mcpServers` field is explicitly
 *      pass-through/unvalidated pending a live `codex plugin add` /
 *      `codex plugin list --json` spike (see that schema's $comment); (c)
 *      no plugin sets codex.enabled: true yet (every
 *      catalog/plugins/<name>.json has targets.codex.enabled === false as
 *      of this writing), so there is no real Codex-exposed artifact to
 *      validate the check's shape against. Implement once a real
 *      Codex-enabled plugin exists and the mcpServers contract is spiked.
 *
 * Exit codes:
 *   0 - no schema violations, no exposure-lint violations
 *   1 - at least one violation (details on stderr)
 */

const { existsSync, readFileSync, readdirSync, realpathSync } = require('fs');
const { join, resolve, sep } = require('path');

const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const { loadCatalog, loadPluginSources } = require('./lib/generate/catalog-reader');
const { isClaudeEnabled } = require('./lib/generate/emit-claude');
const { isCodexEnabled } = require('./lib/generate/emit-codex');
const { assertWithinRoot } = require('./lib/generate/write');

const DEFAULT_ROOT = resolve(__dirname, '..');
const SCHEMAS_DIR_NAME = 'schemas';

function makeAjv() {
  // Mirrors packages/infrastructure/src/validation/ajvFactory.ts's
  // configuration (strict, allErrors, formats) so scripts/ and packages/
  // apply the same validation rules even though they can't share the
  // compiled factory class across the ESM/CJS wall.
  const ajv = new Ajv({ strict: true, allErrors: true, verbose: true, allowUnionTypes: true });
  addFormats(ajv);
  return ajv;
}

function loadCompiledSchema(ajv, schemasDir, name) {
  const schemaPath = join(schemasDir, `${name}.schema.json`);
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  return ajv.compile(schema);
}

/**
 * Validate every Codex-enabled plugin's generated artifacts against their
 * schemas. Pure function of the already-loaded catalog/sources — no
 * generation, only validation of what's already on disk.
 *
 * @returns {string[]} errors (empty when everything validates)
 */
function validateArtifacts({ rootDir, catalog, sources, ajv, schemasDir }) {
  const errors = [];
  const validateManifest = loadCompiledSchema(ajv, schemasDir, 'codex-plugin');
  const validateHooks = loadCompiledSchema(ajv, schemasDir, 'codex-hooks');
  const validateMarketplace = loadCompiledSchema(ajv, schemasDir, 'codex-marketplace');

  const marketplacePath = join(rootDir, '.agents', 'plugins', 'marketplace.json');
  if (!existsSync(marketplacePath)) {
    errors.push(`.agents/plugins/marketplace.json: not found — run \`pnpm generate:manifests\` first`);
  } else {
    let data;
    try {
      data = JSON.parse(readFileSync(marketplacePath, 'utf8'));
    } catch (err) {
      errors.push(`.agents/plugins/marketplace.json: invalid JSON: ${err.message}`);
    }
    if (data !== undefined && !validateMarketplace(data)) {
      for (const err of validateMarketplace.errors) {
        errors.push(`.agents/plugins/marketplace.json${err.instancePath}: ${err.message}`);
      }
    }
  }

  for (const name of catalog.pluginOrder) {
    const source = sources[name];
    if (!isCodexEnabled(source)) {
      continue;
    }
    const manifestPath = join(rootDir, 'plugins', name, '.codex-plugin', 'plugin.json');
    if (!existsSync(manifestPath)) {
      errors.push(`plugins/${name}/.codex-plugin/plugin.json: not found — run \`pnpm generate:manifests\` first`);
      continue;
    }
    let manifestData;
    try {
      manifestData = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      errors.push(`plugins/${name}/.codex-plugin/plugin.json: invalid JSON: ${err.message}`);
    }
    if (manifestData !== undefined && !validateManifest(manifestData)) {
      for (const err of validateManifest.errors) {
        errors.push(`plugins/${name}/.codex-plugin/plugin.json${err.instancePath}: ${err.message}`);
      }
    }

    const hooksPath = join(rootDir, 'plugins', name, 'hooks', 'codex-hooks.json');
    if (manifestData !== undefined && manifestData.hooks && !existsSync(hooksPath)) {
      // The manifest declares a hooks pointer (set by buildCodexPluginManifest
      // whenever the plugin has hooks) but the generated file it points at is
      // missing — a partial/corrupted generation. Cross-check against the
      // manifest instead of only gating on existsSync so this can't silently
      // pass.
      errors.push(`plugins/${name}/hooks/codex-hooks.json: declared in plugin.json "hooks" field but file not found — run \`pnpm generate:manifests\` first`);
    } else if (existsSync(hooksPath)) {
      let hooksData;
      try {
        hooksData = JSON.parse(readFileSync(hooksPath, 'utf8'));
      } catch (err) {
        errors.push(`plugins/${name}/hooks/codex-hooks.json: invalid JSON: ${err.message}`);
      }
      if (hooksData !== undefined && !validateHooks(hooksData)) {
        for (const err of validateHooks.errors) {
          errors.push(`plugins/${name}/hooks/codex-hooks.json${err.instancePath}: ${err.message}`);
        }
      }
    }
  }
  return errors;
}

// --- Exposure lint (R15) ---

// Unambiguous Claude-only constructs: no legitimate Codex-exposed content
// needs these regardless of context, so a direct pattern match (not
// registry-gated) is sufficient and doesn't need a "real generated output"
// comparison.
const DIRECT_CHECKS = [
  {
    name: 'claude-argument-interpolation',
    pattern: /\$ARGUMENTS\b/g,
    message: '$ARGUMENTS is a Claude-only primitive (no equivalent on Codex per the spike doc finding (a)); rewrite as prose referencing "the argument text after the skill name".',
  },
  {
    name: 'claude-config-dir-write',
    pattern: /\.claude\//g,
    message: '.claude/ is a Claude-only config directory; Codex-exposed content must never read or write it.',
  },
  {
    name: 'user-config-reference',
    pattern: /\buserConfig\b|\$\{user_config\./g,
    message: 'userConfig is a Claude-only manifest field; Codex has no equivalent user_config templating.',
  },
  {
    name: 'output-styles-reference',
    pattern: /\boutputStyles\b|\boutput-styles\//g,
    message: 'outputStyles/output-styles/ is a Claude-only manifest field and directory convention.',
  },
  {
    name: 'agent-reference',
    pattern: /\bsubagent_type\b/g,
    message: 'subagent_type is a Claude-only Task-tool parameter; Codex has no agent-dispatch equivalent (per the spec, delegation instructs built-in worker/explorer instead).',
  },
  {
    name: 'claude-env-var-reference',
    // Canonical list of Claude Code hook/runtime env vars (see
    // docs/solutions/code-quality/claude-code-bare-flag-and-hook-recursion-guard.md
    // item 6): CLAUDE_PROJECT_DIR, CLAUDE_PLUGIN_ROOT, CLAUDE_PLUGIN_DATA,
    // CLAUDE_ENV_FILE, CLAUDE_EFFORT, CLAUDE_CODE_REMOTE. \b before CLAUDE_
    // matches after both "$" and "${" (neither is a word character), so this
    // catches the bare name, "$NAME", and "${NAME}" forms in one pattern.
    pattern: /\bCLAUDE_(?:PLUGIN_ROOT|PLUGIN_DATA|PROJECT_DIR|ENV_FILE|EFFORT|CODE_REMOTE)\b/g,
    message: 'Claude Code hook/runtime environment variables (e.g. ${CLAUDE_PLUGIN_ROOT}) exist only in the Claude plugin runtime and are unset in a Codex session; rewrite to avoid referencing them.',
  },
];

// A leading "/" followed by a lowercase command-name token, optionally
// namespaced (plugin:command), immediately after start-of-line/space/
// backtick — the shape Claude Code slash commands are invoked with.
// Deliberately excludes bare filesystem paths like "a/b" by requiring the
// preceding character be a command-invocation boundary, not any "/". Moved
// out of DIRECT_CHECKS (and into runRegistryGatedChecks below) because a
// pure shape match also matches legitimate single-segment absolute-path
// prose like "write to /tmp" or "read /etc" — registry-gating against the
// real command-name set (below) resolves that without losing detection of
// an actually-leaked Claude command reference.
const SLASH_COMMAND_PATTERN = /(^|[\s`])\/([a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)*)\b(?!\/)/gm;

/**
 * Registry-gated checks — flag a literal construct ONLY when it matches a
 * real, currently-known name (an actual sibling plugin, an actual
 * generated mcp__plugin_* tool name), not any token shaped like one. This
 * is what R15 means by "registry-gate against the actual per-target
 * generated output (never token shape)": a Codex skill's prose is free to
 * say the word "plugin" or describe an MCP server hypothetically; it must
 * not name one that actually exists elsewhere in this marketplace.
 *
 * @returns {{ name: string, message: string, matches: string[] }[]}
 */
function runRegistryGatedChecks(content, { pluginName, siblingPluginNames, mcpToolNames, commandNames }) {
  const findings = [];

  const siblingMatches = new Set();
  for (const sibling of siblingPluginNames) {
    if (sibling === pluginName) continue;
    // Matches both the "plugins/<sibling>" path form and relative
    // path-escape forms ("../<sibling>", "../../<sibling>", ...) so a
    // Codex-exposed skill can't dodge this lint by referencing a sibling
    // plugin via a relative path instead of the "plugins/" prefix.
    // `sibling` is drawn from catalog.pluginOrder, which loadCatalog()
    // already validated against NAME_RE (/^[a-zA-Z0-9_-]+$/) before this
    // function ever runs — no regex metacharacters can reach the dynamic
    // RegExp below, and the pattern itself has no nested quantifiers over
    // overlapping variable-length input, so this is not a ReDoS vector
    // despite being built from a template string.
    const re = new RegExp(`(?:plugins/|(?:\\.\\./)+)${sibling}(?![a-zA-Z0-9_-])`, 'g');
    const found = content.match(re);
    if (found) {
      for (const match of found) siblingMatches.add(match);
    }
  }
  if (siblingMatches.size > 0) {
    findings.push({
      name: 'sibling-plugin-path',
      message: 'references another plugin\'s directory by path; Codex-exposed content must be self-contained within its own plugin.',
      matches: [...siblingMatches],
    });
  }

  const mcpMatches = new Set();
  for (const toolName of mcpToolNames) {
    if (content.includes(toolName)) {
      mcpMatches.add(toolName);
    }
  }
  if (mcpMatches.size > 0) {
    findings.push({
      name: 'hardcoded-mcp-tool-name',
      message: 'hard-codes a real mcp__plugin_* tool name; MCP tool names are Claude-target-specific (the "mcp__plugin_{pluginName}_{serverName}__{toolName}" convention) and must not be hard-coded into Codex-exposed content.',
      matches: [...mcpMatches],
    });
  }

  const slashCommandMatches = new Set();
  SLASH_COMMAND_PATTERN.lastIndex = 0;
  let slashMatch;
  while ((slashMatch = SLASH_COMMAND_PATTERN.exec(content)) !== null) {
    if (commandNames.has(slashMatch[2])) {
      slashCommandMatches.add(`/${slashMatch[2]}`);
    }
  }
  if (slashCommandMatches.size > 0) {
    findings.push({
      name: 'slash-command-syntax',
      message: 'slash-command syntax (/command-name) referencing a real Claude Code command is Claude-only; per the spike doc finding (a), Codex skills receive prompt text with no command-invocation primitive.',
      matches: [...slashCommandMatches],
    });
  }

  return findings;
}

/**
 * Build the real mcp__plugin_* tool-name registry by reading every
 * Claude-enabled plugin's committed .claude-plugin/plugin.json for its
 * mcpServers keys. Approximation: this lists server names (the
 * "mcp__plugin_{pluginName}_{serverName}" prefix), not individual tool
 * names (the full "...__{toolName}" suffix requires querying each live MCP
 * server, out of scope for a static file scan) — still catches the common
 * case of a skill hard-coding a real plugin+server pair.
 */
function buildMcpToolNameRegistry(rootDir, pluginOrder, sources) {
  const names = new Set();
  for (const name of pluginOrder) {
    if (!isClaudeEnabled(sources[name])) continue;
    const manifestPath = join(rootDir, 'plugins', name, '.claude-plugin', 'plugin.json');
    if (!existsSync(manifestPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      continue;
    }
    if (manifest.mcpServers && typeof manifest.mcpServers === 'object' && !Array.isArray(manifest.mcpServers)) {
      for (const serverName of Object.keys(manifest.mcpServers)) {
        names.add(`mcp__plugin_${name}_${serverName}__`);
      }
    }
  }
  return names;
}

// Duplicated from scripts/validate-setup-all.js's parseFrontmatterName (not
// imported — that file has no module.exports) for the same reason emit-codex.js
// duplicates its own FRONTMATTER_RE: match Claude Code's own frontmatter
// parsing, not a hand-rolled approximation. Keep in sync if the source
// regex changes.
function parseFrontmatterName(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return null;
  const nameMatch = match[1].match(/^name:\s*(.+)$/m);
  return nameMatch ? nameMatch[1].trim().replace(/^['"]|['"]$/g, '') : null;
}

/**
 * Build the real Claude slash-command-name registry by reading every
 * plugin's commands/ directory (recursively) for each *.md file's
 * frontmatter `name:` field — the literal
 * invocation token (e.g. "ci:setup", "gt-amend") Claude Code slash-command
 * syntax refers to, independent of directory nesting depth.
 */
function buildCommandNameRegistry(rootDir, pluginOrder) {
  const names = new Set();
  for (const name of pluginOrder) {
    const commandsDir = join(rootDir, 'plugins', name, 'commands');
    if (!existsSync(commandsDir)) continue;
    collectCommandNames(commandsDir, names);
  }
  return names;
}

function collectCommandNames(dir, names) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectCommandNames(entryPath, names);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const commandName = parseFrontmatterName(readFileSync(entryPath, 'utf8'));
      if (commandName) names.add(commandName);
    }
  }
}

/**
 * @returns {{ files: string[], errors: string[] }}
 */
function collectCodexExposedFiles(rootDir, name, source) {
  const files = [];
  const errors = [];
  const manifestPath = join(rootDir, 'plugins', name, '.codex-plugin', 'plugin.json');
  if (existsSync(manifestPath)) {
    files.push(manifestPath);
  }
  // Same default-fallback resolution buildCodexSkillTree (emit-codex.js) and
  // generateManifests' stale-artifact sweep (generate-manifests.js) use, so
  // this scan agrees with wherever a plugin's skills were actually
  // generated — including the supported
  // targets.codex.componentPaths.skills override — instead of assuming the
  // 'codex/skills' convention.
  const codex = source.targets.codex;
  const skillsPath = (codex && codex.componentPaths && codex.componentPaths.skills) || './codex/skills';
  const pluginRoot = join(rootDir, 'plugins', name);
  const skillsDir = join(pluginRoot, skillsPath);

  // R15/R7 containment: componentPaths.skills is catalog-authored and can
  // carry a path-escaping override (e.g. '../other-plugin/skills'), which
  // would otherwise make this lint traverse and read outside the current
  // plugin. Mirrors buildCodexSkillTree's (emit-codex.js) two-step
  // containment check: a lexical assertWithinRoot() first (catches `../`
  // escapes even when skillsDir doesn't exist yet), then — once existence is
  // confirmed — a realpathSync()-based check binding to the plugin's real
  // (symlink-resolved) root, so a symlinked skillsDir or a symlinked
  // ancestor is rejected too. Same containment strategy, reused rather than
  // reinvented, for consistency between generation and validation.
  try {
    assertWithinRoot(skillsDir, pluginRoot);
  } catch (_) {
    errors.push(`plugins/${name}/targets.codex.componentPaths.skills ("${skillsPath}"): path must stay within the plugin's own directory`);
    return { files, errors };
  }

  // Build set of expected skills from the allowlist so we can detect missing
  // generated files. Declared outside the existsSync(skillsDir) guard below
  // so a fully-deleted skills directory (not just a missing individual skill
  // subdirectory) is still caught as a missing-skill error rather than
  // silently skipping the check.
  const allowlist = (codex && codex.skillAllowlist) || [];
  const foundSkills = new Set();

  if (existsSync(skillsDir)) {
    const pluginRootReal = realpathSync(pluginRoot);
    const skillsDirReal = realpathSync(skillsDir);
    if (skillsDirReal !== pluginRootReal && !skillsDirReal.startsWith(pluginRootReal + sep)) {
      errors.push(`plugins/${name}/targets.codex.componentPaths.skills ("${skillsPath}"): symlinked skills directories (including a symlinked ancestor) are not allowed`);
      return { files, errors };
    }

    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillFile = join(skillsDir, entry.name, 'SKILL.md');
      if (existsSync(skillFile)) {
        files.push(skillFile);
        foundSkills.add(entry.name);
      }
    }
  }

  // Report missing skills that are in the allowlist but not generated.
  const skillsRelPath = skillsDir.slice(rootDir.length + 1);
  for (const skillName of allowlist) {
    if (!foundSkills.has(skillName)) {
      errors.push(`${skillsRelPath}/${skillName}/SKILL.md: missing generated skill file (declared in targets.codex.skillAllowlist) — run \`pnpm generate:manifests\` first`);
    }
  }
  return { files, errors };
}

/**
 * @returns {string[]} errors (empty when clean)
 */
function runExposureLint({ rootDir, catalog, sources }) {
  const errors = [];
  const pluginOrder = catalog.pluginOrder;
  const mcpToolNames = buildMcpToolNameRegistry(rootDir, pluginOrder, sources);
  const commandNames = buildCommandNameRegistry(rootDir, pluginOrder);

  for (const name of pluginOrder) {
    const source = sources[name];
    if (!isCodexEnabled(source)) {
      continue;
    }
    const collected = collectCodexExposedFiles(rootDir, name, source);
    errors.push(...collected.errors);
    for (const filePath of collected.files) {
      const relPath = filePath.slice(rootDir.length + 1);
      const content = readFileSync(filePath, 'utf8');

      for (const check of DIRECT_CHECKS) {
        check.pattern.lastIndex = 0;
        const matches = content.match(check.pattern);
        if (matches && matches.length > 0) {
          errors.push(`${relPath}: [${check.name}] ${check.message} (found: ${[...new Set(matches)].join(', ')})`);
        }
      }

      const gated = runRegistryGatedChecks(content, {
        pluginName: name,
        siblingPluginNames: pluginOrder,
        mcpToolNames,
        commandNames,
      });
      for (const finding of gated) {
        errors.push(`${relPath}: [${finding.name}] ${finding.message} (found: ${finding.matches.join(', ')})`);
      }
    }
  }
  return errors;
}

function main() {
  const rootDir = DEFAULT_ROOT;
  const schemasDir = join(rootDir, SCHEMAS_DIR_NAME);

  const catalogResult = loadCatalog(join(rootDir, 'catalog'));
  if (catalogResult.status !== 'ok') {
    console.error(`[validate-codex] ERROR: ${catalogResult.status === 'missing' ? `catalog not found at ${catalogResult.path}` : catalogResult.errors.join('; ')}`);
    process.exit(1);
  }
  const catalog = catalogResult.data;

  const sourcesResult = loadPluginSources(join(rootDir, 'catalog'), catalog.pluginOrder);
  if (sourcesResult.status !== 'ok') {
    console.error(`[validate-codex] ERROR: ${sourcesResult.errors.join('; ')}`);
    process.exit(1);
  }
  const sources = sourcesResult.sources;

  const ajv = makeAjv();
  const artifactErrors = validateArtifacts({ rootDir, catalog, sources, ajv, schemasDir });
  const exposureErrors = runExposureLint({ rootDir, catalog, sources });

  const allErrors = [...artifactErrors, ...exposureErrors];
  if (allErrors.length > 0) {
    console.error('[validate-codex] ✗ violations found:');
    for (const err of allErrors) {
      console.error(`  ${err}`);
    }
    process.exit(1);
  }

  const enabledCount = catalog.pluginOrder.filter((n) => isCodexEnabled(sources[n])).length;
  console.log(`[validate-codex] ✓ ${enabledCount} Codex-enabled plugin(s) pass artifact validation and the exposure lint`);
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = {
  validateArtifacts,
  runExposureLint,
  runRegistryGatedChecks,
  buildMcpToolNameRegistry,
  buildCommandNameRegistry,
  DIRECT_CHECKS,
};
