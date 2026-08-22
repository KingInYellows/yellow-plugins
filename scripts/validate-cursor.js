#!/usr/bin/env node

'use strict';

/**
 * validate-cursor.js (`pnpm validate:cursor`)
 *
 * Three independent checks:
 *
 *   1. Artifact validation — plugins/<name>/.cursor-plugin/plugin.json and
 *      the root .cursor-plugin/marketplace.json (when at least one plugin is
 *      Cursor-enabled) validate against schemas/cursor-plugin.schema.json
 *      and schemas/cursor-marketplace.schema.json (local mirrors of the
 *      verified upstream Cursor plugin schemas). Uses the `ajv`/`ajv-formats`
 *      npm packages directly, mirroring validate-codex.js's own CJS-only
 *      approach (packages/infrastructure is ESM-only and scripts/ cannot
 *      `require()` it).
 *
 *   2. Exposure lint — every Cursor-exposed file (the plugin manifest and
 *      its copied skill tree under plugins/<name>/cursor/skills/, or the
 *      plugin's targets.cursor.componentPaths.skills override when set) is
 *      scanned for Claude-only constructs that must never reach a Cursor
 *      session. This reuses validate-codex.js's exported DIRECT_CHECKS,
 *      runRegistryGatedChecks, buildSiblingRegexps, buildMcpToolNameRegistry,
 *      and buildCommandNameRegistry verbatim via require() — the check
 *      logic and registries are target-agnostic (Claude-only constructs are
 *      Claude-only regardless of which non-Claude target is scanning for
 *      them); only file discovery (collectCursorExposedFiles below) is
 *      Cursor-specific.
 *
 *   3. Lifecycle non-emission scan — the catalog-only `lifecycle` field
 *      (schemas/catalog-plugin.schema.json) must never appear in ANY
 *      generated artifact on ANY target (Claude, Codex, or Cursor). This
 *      check is independent of Cursor enablement — it runs unconditionally
 *      so it still guards Claude/Codex output even on a catalog with no
 *      Cursor plugins at all.
 *
 * Exit codes:
 *   0 - no schema violations, no exposure-lint violations, no lifecycle leaks
 *   1 - at least one violation (details on stderr)
 *
 * When no plugin is Cursor-enabled, arms 1 and 2 have nothing to check and
 * report cleanly; arm 3 still runs. The process exits 0 in that case.
 */

const {
  existsSync,
  readdirSync,
  readFileSync,
  lstatSync,
  realpathSync,
} = require('fs');
const { join, resolve, sep } = require('path');

const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const {
  loadCatalog,
  loadPluginSources,
} = require('./lib/generate/catalog-reader');
const { isClaudeEnabled } = require('./lib/generate/emit-claude');
const { isCodexEnabled } = require('./lib/generate/emit-codex');
const { isCursorEnabled, REF_FILE_RE } = require('./lib/generate/emit-cursor');
const { assertWithinRoot } = require('./lib/generate/write');
const {
  DIRECT_CHECKS,
  runRegistryGatedChecks,
  buildSiblingRegexps,
  buildMcpToolNameRegistry,
  buildCommandNameRegistry,
} = require('./validate-codex');

const DEFAULT_ROOT = resolve(__dirname, '..');
const SCHEMAS_DIR_NAME = 'schemas';

// Same ESM/CJS bridge constraint documented in
// packages/domain/src/validation/errorCatalog.ts next to the CURSOR_* entries:
// the catalog is ESM, scripts/ is CJS, so this file assembles the same
// ERROR-CURSOR-NNN strings via concatenation rather than importing the TS
// literals — scripts/lint-error-codes.js's CODE_PATTERN scan does not detect
// split-string assembly, so a literal 'ERROR-CURSOR-NNN' must never appear
// verbatim in this file. Any change to a code here requires a paired edit in
// packages/domain/src/validation/errorCatalog.ts.
const CURSOR = 'ERROR-' + 'CURSOR';
const CODES = {
  ARTIFACT_MISSING: CURSOR + '-001',
  SCHEMA_VIOLATION: CURSOR + '-002',
  EXPOSURE_LEAK: CURSOR + '-005',
  LIFECYCLE_LEAKED: CURSOR + '-007',
  SKILL_MISSING: CURSOR + '-008',
};

function makeAjv() {
  const ajv = new Ajv({
    strict: true,
    allErrors: true,
    verbose: true,
    allowUnionTypes: true,
  });
  addFormats(ajv);
  return ajv;
}

function loadCompiledSchema(ajv, schemasDir, name) {
  const schemaPath = join(schemasDir, `${name}.schema.json`);
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  return ajv.compile(schema);
}

/**
 * Validate every Cursor-enabled plugin's generated artifacts against their
 * schemas. Pure function of the already-loaded catalog/sources — no
 * generation, only validation of what's already on disk.
 *
 * @returns {string[]} errors (empty when everything validates)
 */
function validateArtifacts({ rootDir, catalog, sources, ajv, schemasDir }) {
  const errors = [];
  const validateManifest = loadCompiledSchema(ajv, schemasDir, 'cursor-plugin');
  const validateMarketplace = loadCompiledSchema(
    ajv,
    schemasDir,
    'cursor-marketplace'
  );

  const cursorEnabledNames = catalog.pluginOrder.filter((n) =>
    isCursorEnabled(sources[n])
  );
  const marketplacePath = join(rootDir, '.cursor-plugin', 'marketplace.json');

  // Unlike Codex's always-present empty-state marketplace, the root Cursor
  // marketplace legitimately does not exist when zero plugins are
  // Cursor-enabled (see emit-cursor.js's buildCursorMarketplace) — skip the
  // check entirely in that case rather than reporting a false "missing"
  // error. When at least one plugin IS enabled, the file must exist.
  if (cursorEnabledNames.length > 0) {
    if (!existsSync(marketplacePath)) {
      errors.push(
        `[${CODES.ARTIFACT_MISSING}] .cursor-plugin/marketplace.json: not found — run \`pnpm generate:manifests\` first`
      );
    } else {
      let data;
      try {
        data = JSON.parse(readFileSync(marketplacePath, 'utf8'));
      } catch (err) {
        errors.push(
          `[${CODES.SCHEMA_VIOLATION}] .cursor-plugin/marketplace.json: invalid JSON: ${err.message}`
        );
      }
      if (data !== undefined && !validateMarketplace(data)) {
        for (const err of validateMarketplace.errors) {
          errors.push(
            `[${CODES.SCHEMA_VIOLATION}] .cursor-plugin/marketplace.json${err.instancePath}: ${err.message}`
          );
        }
      }
    }
  }

  for (const name of cursorEnabledNames) {
    const manifestPath = join(
      rootDir,
      'plugins',
      name,
      '.cursor-plugin',
      'plugin.json'
    );
    if (!existsSync(manifestPath)) {
      errors.push(
        `[${CODES.ARTIFACT_MISSING}] plugins/${name}/.cursor-plugin/plugin.json: not found — run \`pnpm generate:manifests\` first`
      );
      continue;
    }
    let manifestData;
    try {
      manifestData = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      errors.push(
        `[${CODES.SCHEMA_VIOLATION}] plugins/${name}/.cursor-plugin/plugin.json: invalid JSON: ${err.message}`
      );
    }
    if (
      manifestData !== undefined &&
      (manifestData === null ||
        typeof manifestData !== 'object' ||
        Array.isArray(manifestData))
    ) {
      errors.push(
        `[${CODES.SCHEMA_VIOLATION}] plugins/${name}/.cursor-plugin/plugin.json: must be a JSON object`
      );
      manifestData = undefined;
    }
    if (manifestData !== undefined && !validateManifest(manifestData)) {
      for (const err of validateManifest.errors) {
        errors.push(
          `[${CODES.SCHEMA_VIOLATION}] plugins/${name}/.cursor-plugin/plugin.json${err.instancePath}: ${err.message}`
        );
      }
    }
  }
  return errors;
}

/**
 * Cursor-specific counterpart to validate-codex.js's collectCodexExposedFiles.
 * Collects the manifest plus the copied skill tree (and its references/*.md
 * sidecars) for one Cursor-enabled plugin. No hooks file to collect — the
 * Cursor target does not carry a generated hooks artifact.
 *
 * @returns {{ files: string[], errors: string[] }}
 */
function collectCursorExposedFiles(rootDir, name, source) {
  const files = [];
  const errors = [];
  const manifestPath = join(
    rootDir,
    'plugins',
    name,
    '.cursor-plugin',
    'plugin.json'
  );
  if (existsSync(manifestPath)) {
    files.push(manifestPath);
  }
  const cursor = source.targets.cursor;
  const skillsPath =
    (cursor && cursor.componentPaths && cursor.componentPaths.skills) ||
    './cursor/skills';
  const pluginRoot = join(rootDir, 'plugins', name);
  const skillsDir = join(pluginRoot, skillsPath);

  try {
    assertWithinRoot(skillsDir, pluginRoot);
  } catch (_) {
    errors.push(
      `plugins/${name}/targets.cursor.componentPaths.skills ("${skillsPath}"): path must stay within the plugin's own directory`
    );
    return { files, errors };
  }

  const allowlist = (cursor && cursor.skillAllowlist) || [];
  const foundSkills = new Set();

  if (existsSync(skillsDir)) {
    const pluginRootReal = realpathSync(pluginRoot);
    const skillsDirReal = realpathSync(skillsDir);
    if (
      skillsDirReal !== pluginRootReal &&
      !skillsDirReal.startsWith(pluginRootReal + sep)
    ) {
      errors.push(
        `plugins/${name}/targets.cursor.componentPaths.skills ("${skillsPath}"): symlinked skills directories (including a symlinked ancestor) are not allowed`
      );
      return { files, errors };
    }

    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        errors.push(
          `${join(skillsDir, entry.name).slice(rootDir.length + 1)}: symlinked skill directories are not allowed in generated output`
        );
        foundSkills.add(entry.name);
        continue;
      }
      if (!entry.isDirectory()) continue;
      const skillFile = join(skillsDir, entry.name, 'SKILL.md');
      let skillFileStat = null;
      try {
        skillFileStat = lstatSync(skillFile);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          errors.push(`cannot read ${skillFile}: ${err.message}`);
        }
      }
      if (skillFileStat !== null) {
        if (skillFileStat.isSymbolicLink()) {
          errors.push(
            `${skillFile.slice(rootDir.length + 1)}: symlinked SKILL.md is not allowed in generated output`
          );
          foundSkills.add(entry.name);
        } else if (skillFileStat.isFile()) {
          files.push(skillFile);
          foundSkills.add(entry.name);
        } else {
          errors.push(
            `${skillFile.slice(rootDir.length + 1)}: exists but is not a regular file`
          );
          foundSkills.add(entry.name);
        }
      }
      const refDir = join(skillsDir, entry.name, 'references');
      let refDirStat = null;
      try {
        refDirStat = lstatSync(refDir);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          errors.push(`cannot read ${refDir}: ${err.message}`);
        }
      }
      if (refDirStat !== null) {
        if (refDirStat.isSymbolicLink()) {
          errors.push(
            `${refDir.slice(rootDir.length + 1)}: symlinked references directories are not allowed in generated output`
          );
        } else if (!refDirStat.isDirectory()) {
          errors.push(
            `${refDir.slice(rootDir.length + 1)}: unexpected non-directory "references" entry in generated output`
          );
        } else {
          let refEntries = [];
          try {
            if (
              realpathSync(refDir) !==
              join(skillsDirReal, entry.name, 'references')
            ) {
              errors.push(
                `${refDir.slice(rootDir.length + 1)}: symlinked references directories (including a symlinked ancestor) are not allowed in generated output`
              );
            } else {
              refEntries = readdirSync(refDir, { withFileTypes: true });
            }
          } catch (err) {
            errors.push(`cannot read ${refDir}: ${err.message}`);
          }
          for (const refEntry of refEntries) {
            if (refEntry.isSymbolicLink()) {
              errors.push(
                `${join(refDir, refEntry.name).slice(rootDir.length + 1)}: symlinked reference files are not allowed in generated output`
              );
            } else if (!refEntry.isFile() || !REF_FILE_RE.test(refEntry.name)) {
              errors.push(
                `${join(refDir, refEntry.name).slice(rootDir.length + 1)}: only flat, regular [a-zA-Z0-9_-]+.md reference files are allowed in generated output`
              );
            } else {
              files.push(join(refDir, refEntry.name));
            }
          }
        }
      }
    }
  }

  const skillsRelPath = skillsDir.slice(rootDir.length + 1);
  for (const skillName of allowlist) {
    if (!foundSkills.has(skillName)) {
      errors.push(
        `[${CODES.SKILL_MISSING}] ${skillsRelPath}/${skillName}/SKILL.md: missing generated skill file (declared in targets.cursor.skillAllowlist) — run \`pnpm generate:manifests\` first`
      );
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
  const siblingRegexps = buildSiblingRegexps(pluginOrder);

  for (const name of pluginOrder) {
    const source = sources[name];
    if (!isCursorEnabled(source)) {
      continue;
    }
    const collected = collectCursorExposedFiles(rootDir, name, source);
    errors.push(...collected.errors);
    for (const filePath of collected.files) {
      const relPath = filePath.slice(rootDir.length + 1);
      const content = readFileSync(filePath, 'utf8');

      for (const check of DIRECT_CHECKS) {
        check.pattern.lastIndex = 0;
        const matches = content.match(check.pattern);
        if (matches && matches.length > 0) {
          errors.push(
            `[${CODES.EXPOSURE_LEAK}] ${relPath}: [${check.name}] ${check.message} (found: ${[...new Set(matches)].join(', ')})`
          );
        }
      }

      const gated = runRegistryGatedChecks(content, {
        pluginName: name,
        siblingRegexps,
        mcpToolNames,
        commandNames,
      });
      for (const finding of gated) {
        errors.push(
          `[${CODES.EXPOSURE_LEAK}] ${relPath}: [${finding.name}] ${finding.message} (found: ${finding.matches.join(', ')})`
        );
      }
    }
  }
  return errors;
}

// Regex, not JSON.parse + walk: a raw-text scan is deliberately more
// paranoid than a structural key walk — it also catches a "lifecycle" key
// nested inside a pass-through blob (e.g. a stringified sub-object) that a
// structural walk keyed only to known top-level shapes could miss.
const LIFECYCLE_KEY_RE = /"lifecycle"\s*:/;

/**
 * Scan every generated artifact on every target (Claude, Codex, Cursor) for
 * a literal "lifecycle" key — the catalog-only field
 * (schemas/catalog-plugin.schema.json) must never be emitted anywhere.
 * Runs unconditionally, independent of Cursor enablement, so it still
 * guards Claude/Codex output on a catalog with no Cursor plugins at all.
 *
 * @returns {string[]} errors (empty when clean)
 */
function scanLifecycleLeaks({ rootDir, catalog, sources }) {
  const errors = [];
  const candidates = [
    join(rootDir, '.claude-plugin', 'marketplace.json'),
    join(rootDir, '.agents', 'plugins', 'marketplace.json'),
    join(rootDir, '.cursor-plugin', 'marketplace.json'),
  ];
  for (const name of catalog.pluginOrder) {
    const source = sources[name];
    if (isClaudeEnabled(source)) {
      candidates.push(
        join(rootDir, 'plugins', name, '.claude-plugin', 'plugin.json')
      );
    }
    if (isCodexEnabled(source)) {
      candidates.push(
        join(rootDir, 'plugins', name, '.codex-plugin', 'plugin.json')
      );
      candidates.push(
        join(rootDir, 'plugins', name, 'hooks', 'codex-hooks.json')
      );
    }
    if (isCursorEnabled(source)) {
      candidates.push(
        join(rootDir, 'plugins', name, '.cursor-plugin', 'plugin.json')
      );
    }
  }
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const content = readFileSync(candidate, 'utf8');
    if (LIFECYCLE_KEY_RE.test(content)) {
      errors.push(
        `[${CODES.LIFECYCLE_LEAKED}] ${candidate.slice(rootDir.length + 1)}: contains a "lifecycle" key — catalog-only metadata must never be emitted into a generated artifact`
      );
    }
  }
  return errors;
}

function main() {
  const rootDir = DEFAULT_ROOT;
  const schemasDir = join(rootDir, SCHEMAS_DIR_NAME);

  const catalogResult = loadCatalog(join(rootDir, 'catalog'));
  if (catalogResult.status !== 'ok') {
    console.error(
      `[validate-cursor] ERROR: ${catalogResult.status === 'missing' ? `catalog not found at ${catalogResult.path}` : catalogResult.errors.join('; ')}`
    );
    process.exit(1);
  }
  const catalog = catalogResult.data;

  const sourcesResult = loadPluginSources(
    join(rootDir, 'catalog'),
    catalog.pluginOrder
  );
  if (sourcesResult.status !== 'ok') {
    console.error(
      `[validate-cursor] ERROR: ${sourcesResult.errors.join('; ')}`
    );
    process.exit(1);
  }
  const sources = sourcesResult.sources;

  const ajv = makeAjv();
  const artifactErrors = validateArtifacts({
    rootDir,
    catalog,
    sources,
    ajv,
    schemasDir,
  });
  const exposureErrors = runExposureLint({ rootDir, catalog, sources });
  const lifecycleErrors = scanLifecycleLeaks({ rootDir, catalog, sources });

  const allErrors = [...artifactErrors, ...exposureErrors, ...lifecycleErrors];
  if (allErrors.length > 0) {
    console.error('[validate-cursor] ✗ violations found:');
    for (const err of allErrors) {
      console.error(`  ${err}`);
    }
    process.exit(1);
  }

  const enabledCount = catalog.pluginOrder.filter((n) =>
    isCursorEnabled(sources[n])
  ).length;
  console.log(
    `[validate-cursor] ✓ ${enabledCount} Cursor-enabled plugin(s) pass artifact validation, the exposure lint, and the lifecycle non-emission scan`
  );
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = {
  validateArtifacts,
  runExposureLint,
  scanLifecycleLeaks,
  collectCursorExposedFiles,
  CODES,
};
