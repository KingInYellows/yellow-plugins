#!/usr/bin/env node

/**
 * validate-setup-all.js — gates plugins/yellow-core/commands/setup/all.md
 * (and its Steps 1.6/1.7 reference file) against the marketplace.
 *
 * Checks (each failure carries an ERROR-SETUP-* code; see
 * packages/domain/src/validation/errorCatalog.ts):
 *   - all seven marker-delimited sections exist (-001)
 *   - dashboard loop / classification / delegated plugins == marketplace (-002)
 *   - delegated commands and the plugin-command map are mutually consistent,
 *     and every mapped command resolves to a real command file owned by the
 *     plugin the markdown map claims (-003)
 *   - dashboard order == delegated setup order (-004)
 *   - Step 1.5 probe list internally consistent (counts match, every query
 *     corresponds to a recorded tool name), plugins known, and every
 *     mcp__plugin_* name referenced in the classification section is among
 *     the recorded probes (-005)
 *   - Step 1.6 credential-status plugin list == hooks that emit it (-006)
 *   - illustrative dashboard example lists exactly the marketplace plugin
 *     set — no missing, extra, or duplicate rows (-007)
 *
 * Env overrides (for integration-test fixtures):
 *   VALIDATE_SETUP_ALL_MARKETPLACE_PATH, VALIDATE_SETUP_ALL_COMMAND_PATH,
 *   VALIDATE_SETUP_ALL_REFERENCES_PATH, VALIDATE_SETUP_ALL_PLUGINS_DIR
 *
 * Exit codes: 0 = all checks pass; 1 = any check failed or an input file
 * could not be read.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// Each input path is overridable so integration tests can point the validator
// at fixture trees (mirrors VALIDATE_PLUGINS_DIR in validate-agent-authoring.js;
// unlike validate-solutions.js's SOLUTIONS_DIR, no path-confinement guard is
// applied — these are read-only inputs set by the test harness).
const MARKETPLACE_PATH =
  process.env.VALIDATE_SETUP_ALL_MARKETPLACE_PATH ||
  path.join(ROOT, '.claude-plugin', 'marketplace.json');
const SETUP_ALL_PATH =
  process.env.VALIDATE_SETUP_ALL_COMMAND_PATH ||
  path.join(ROOT, 'plugins', 'yellow-core', 'commands', 'setup', 'all.md');
const PLUGINS_DIR = path.resolve(
  process.env.VALIDATE_SETUP_ALL_PLUGINS_DIR || path.join(ROOT, 'plugins')
);
const REFERENCES_PATH =
  process.env.VALIDATE_SETUP_ALL_REFERENCES_PATH ||
  path.join(
    ROOT,
    'plugins',
    'yellow-core',
    'references',
    'setup-all',
    'credential-status-and-version-drift.md'
  );

// Error codes assembled via concatenation, NOT literals:
// packages/domain/src/validation/errorCatalog.ts (SETUP_* entries) is the
// single source of truth, but that package is ESM and this script is CJS, so
// the codes are re-assembled here. scripts/lint-error-codes.js
// (CODE_PATTERN /ERROR-[A-Z]+-\d+/g) fails CI on literal catalog codes in
// scripts/ — split-string assembly is the documented bridge. Any change to
// the catalog entries requires a paired edit here.
const SETUP = 'ERROR-' + 'SETUP';
const SETUP_MISSING_MARKERS = SETUP + '-001';
const SETUP_COVERAGE_DRIFT = SETUP + '-002';
const SETUP_DELEGATION_DRIFT = SETUP + '-003';
const SETUP_ORDER_DRIFT = SETUP + '-004';
const SETUP_PROBE_LIST_DRIFT = SETUP + '-005';
const SETUP_CREDENTIAL_LIST_DRIFT = SETUP + '-006';
const SETUP_EXAMPLE_DRIFT = SETUP + '-007';

// Null-prototype so `raw in WORD_NUMBERS` can never resolve an inherited
// Object.prototype key parsed out of the markdown.
const WORD_NUMBERS = Object.assign(Object.create(null), {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
});

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

const SKIP_DIRS = new Set(['node_modules', '.git']);

function walk(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        walk(fullPath, results);
      }
      continue;
    }
    results.push(fullPath);
  }
  return results;
}

function parseFrontmatterName(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return null;
  const fm = match[1];
  const nameMatch = fm.match(/^name:\s*(.+)$/m);
  return nameMatch ? nameMatch[1].trim().replace(/^['"]|['"]$/g, '') : null;
}

function extractMarkedSection(markdown, startMarker, endMarker) {
  const start = markdown.indexOf(startMarker);
  if (start === -1) return null;
  const end = markdown.indexOf(endMarker, start + startMarker.length);
  if (end === -1) return null;
  return markdown.slice(start + startMarker.length, end);
}

function parseForLoopItems(section) {
  const match = section.match(/for \w+ in\s+([\s\S]*?)\s*;\s*do/);
  if (!match) return [];
  return match[1].split(/\s+/).filter(Boolean);
}

function parseClassificationPlugins(section) {
  const headings = [];
  for (const match of section.matchAll(/^\*\*([a-z0-9-]+):\*\*$/gm)) {
    headings.push(match[1]);
  }
  return headings;
}

function parseDelegatedCommands(section) {
  const commands = [];
  for (const match of section.matchAll(/^\d+\.\s+`([^`]+)`$/gm)) {
    commands.push(match[1]);
  }
  return commands;
}

function compareSets(actual, expected) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter((value) => !actualSet.has(value));
  const extra = actual.filter((value) => !expectedSet.has(value));
  return { missing, extra };
}

function parsePluginCommandMap(section) {
  // Null-prototype: keys come from parsed markdown, so `command in mapping`
  // must never hit an inherited Object.prototype member.
  const mapping = Object.create(null);
  for (const match of section.matchAll(/^- `([^`]+)` → `([^`]+)`$/gm)) {
    const plugin = match[1];
    const command = match[2];
    mapping[command] = plugin;
  }
  return mapping;
}

function exitWithErrors(errors) {
  console.error('[validate-setup-all] Setup coverage validation failed:');
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}

function loadInputs() {
  let marketplace;
  let setupAll;
  let references;
  try {
    marketplace = readJson(MARKETPLACE_PATH);
    // Normalize CRLF once so every $-anchored line regex downstream stays
    // correct if a file picks up Windows line endings (documented WSL2
    // hazard — see CLAUDE.md "Cross-platform file portability").
    setupAll = readText(SETUP_ALL_PATH).replace(/\r\n/g, '\n');
    references = readText(REFERENCES_PATH).replace(/\r\n/g, '\n');
  } catch (error) {
    console.error(
      `[validate-setup-all] Failed to read required file: ${error.message}`
    );
    console.error('  Ensure this script is run from the repository root.');
    process.exit(1);
  }

  if (!Array.isArray(marketplace.plugins)) {
    console.error(
      `[validate-setup-all] marketplace.json has no \`plugins\` array — check ${MARKETPLACE_PATH}`
    );
    process.exit(1);
  }

  return {
    marketplacePlugins: marketplace.plugins.map((plugin) => plugin.name),
    setupAll,
    references,
  };
}

function extractRequiredSections(setupAll, references) {
  const errors = [];
  const sections = {
    dashboardSection: extractMarkedSection(
      setupAll,
      '# setup-all-dashboard-plugin-loop:start',
      '# setup-all-dashboard-plugin-loop:end'
    ),
    classificationSection: extractMarkedSection(
      setupAll,
      '<!-- setup-all-classification:start -->',
      '<!-- setup-all-classification:end -->'
    ),
    delegatedSection: extractMarkedSection(
      setupAll,
      '<!-- setup-all-delegated-commands:start -->',
      '<!-- setup-all-delegated-commands:end -->'
    ),
    mappingSection: extractMarkedSection(
      setupAll,
      '<!-- setup-all-plugin-command-map:start -->',
      '<!-- setup-all-plugin-command-map:end -->'
    ),
    probesSection: extractMarkedSection(
      setupAll,
      '<!-- setup-all-toolsearch-probes:start -->',
      '<!-- setup-all-toolsearch-probes:end -->'
    ),
    exampleSection: extractMarkedSection(
      setupAll,
      '<!-- setup-all-dashboard-example:start -->',
      '<!-- setup-all-dashboard-example:end -->'
    ),
    credentialSection: extractMarkedSection(
      references,
      '# setup-all-credential-status-plugins:start',
      '# setup-all-credential-status-plugins:end'
    ),
  };

  if (!sections.dashboardSection) {
    errors.push(
      `${SETUP_MISSING_MARKERS}: missing dashboard plugin loop markers in setup:all`
    );
  }
  if (!sections.classificationSection) {
    errors.push(
      `${SETUP_MISSING_MARKERS}: missing classification markers in setup:all`
    );
  }
  if (!sections.delegatedSection) {
    errors.push(
      `${SETUP_MISSING_MARKERS}: missing delegated command markers in setup:all`
    );
  }
  if (!sections.mappingSection) {
    errors.push(
      `${SETUP_MISSING_MARKERS}: missing plugin-command mapping markers in setup:all`
    );
  }
  if (!sections.probesSection) {
    errors.push(
      `${SETUP_MISSING_MARKERS}: missing ToolSearch probe markers in setup:all`
    );
  }
  if (!sections.exampleSection) {
    errors.push(
      `${SETUP_MISSING_MARKERS}: missing dashboard example markers in setup:all`
    );
  }
  if (!sections.credentialSection) {
    errors.push(
      `${SETUP_MISSING_MARKERS}: missing credential-status plugin list markers in the Steps 1.6/1.7 reference file`
    );
  }

  if (errors.length > 0) {
    exitWithErrors(errors);
  }

  return sections;
}

function parseSetupAllData(sections) {
  const markdownMapping = parsePluginCommandMap(sections.mappingSection);
  const delegatedCommands = parseDelegatedCommands(sections.delegatedSection);
  return {
    dashboardPlugins: parseForLoopItems(sections.dashboardSection),
    classificationPlugins: parseClassificationPlugins(
      sections.classificationSection
    ),
    delegatedCommands,
    delegatedPlugins: delegatedCommands.map(
      (command) => markdownMapping[command]
    ),
    markdownMapping,
    credentialPlugins: parseForLoopItems(sections.credentialSection),
  };
}

// Maps each command `name:` frontmatter value to the plugin directory that
// actually owns the command file — the ground truth the markdown map is
// checked against (previously the script cross-checked the markdown against
// a hand-duplicated copy of the same map, which could not catch a mapping
// that was wrong in both places). The directory name IS the plugin name:
// validate-plugin.js's ruleNameMatchesDir hard-fails CI on any divergence,
// so no plugin.json read is needed here.
function loadCommandPlugins() {
  const commandPlugins = new Map();
  const duplicateCommands = [];
  let files;
  try {
    files = walk(PLUGINS_DIR);
  } catch (error) {
    console.error(
      `[validate-setup-all] Failed to read plugins directory: ${error.message}`
    );
    process.exit(1);
  }
  for (const filePath of files) {
    if (
      !filePath.endsWith('.md') ||
      !filePath.includes(`${path.sep}commands${path.sep}`)
    ) {
      continue;
    }
    const name = parseFrontmatterName(readText(filePath));
    if (!name) {
      continue;
    }
    const pluginDir = path.relative(PLUGINS_DIR, filePath).split(path.sep)[0];
    const existing = commandPlugins.get(name);
    if (existing !== undefined && existing !== pluginDir) {
      // Silent last-writer-wins would make the wrongOwner check depend on
      // filesystem enumeration order; surface the collision instead.
      duplicateCommands.push(`${name} (in ${existing} and ${pluginDir})`);
      continue;
    }
    commandPlugins.set(name, pluginDir);
  }
  return { commandPlugins, duplicateCommands };
}

// Plugins whose hooks emit credential-status.json — the ground truth for the
// Step 1.6 plugin list in the reference file. Heuristic: any hooks/*.sh file
// whose source text mentions "credential-status"/"credential_status" (a
// write_credential_status call or a sourced yellow-core/lib helper). This is
// a substring match, not a semantic check — a hook that merely references
// the term in a comment would also match.
function scanCredentialStatusHooks() {
  const plugins = [];
  let entries;
  try {
    entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });
  } catch (error) {
    console.error(
      `[validate-setup-all] Failed to read plugins directory: ${error.message}`
    );
    process.exit(1);
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const hooksDir = path.join(PLUGINS_DIR, entry.name, 'hooks');
    if (!fs.existsSync(hooksDir)) {
      continue;
    }
    const emits = walk(hooksDir).some(
      (hookPath) =>
        hookPath.endsWith('.sh') &&
        /credential[-_]status/.test(readText(hookPath))
    );
    if (emits) {
      plugins.push(entry.name);
    }
  }
  return plugins;
}

function validateCoverage(data, marketplacePlugins, errors) {
  const dashboardDiff = compareSets(data.dashboardPlugins, marketplacePlugins);
  if (dashboardDiff.missing.length || dashboardDiff.extra.length) {
    errors.push(
      `${SETUP_COVERAGE_DRIFT}: dashboard plugin coverage drift: missing=[${dashboardDiff.missing.join(', ')}] extra=[${dashboardDiff.extra.join(', ')}]`
    );
  }

  const classificationDiff = compareSets(
    data.classificationPlugins,
    marketplacePlugins
  );
  if (classificationDiff.missing.length || classificationDiff.extra.length) {
    errors.push(
      `${SETUP_COVERAGE_DRIFT}: classification coverage drift: missing=[${classificationDiff.missing.join(', ')}] extra=[${classificationDiff.extra.join(', ')}]`
    );
  }

  const delegatedDiff = compareSets(
    data.delegatedPlugins.filter(Boolean),
    marketplacePlugins
  );
  if (delegatedDiff.missing.length || delegatedDiff.extra.length) {
    errors.push(
      `${SETUP_COVERAGE_DRIFT}: delegated setup coverage drift: missing=[${delegatedDiff.missing.join(', ')}] extra=[${delegatedDiff.extra.join(', ')}]`
    );
  }
}

function validateDelegation(data, commandPlugins, errors) {
  // Ownership alone would accept remapping a plugin to any of its commands
  // (e.g. `yellow-ci` → `ci:status`); every delegated entry must follow the
  // setup-command naming convention the old hardcoded map implicitly pinned.
  const nonSetupCommands = data.delegatedCommands.filter(
    (command) => !/(^|[:-])setup$/.test(command)
  );
  if (nonSetupCommands.length > 0) {
    errors.push(
      `${SETUP_DELEGATION_DRIFT}: delegated entries must be setup commands (name ending in "setup"): ${nonSetupCommands.join(', ')}`
    );
  }

  const unknownCommands = data.delegatedCommands.filter(
    (command) => !(command in data.markdownMapping)
  );
  if (unknownCommands.length > 0) {
    errors.push(
      `${SETUP_DELEGATION_DRIFT}: delegated commands missing from the plugin-command map: ${unknownCommands.join(', ')}`
    );
  }

  const delegatedSet = new Set(data.delegatedCommands);
  const unlistedMappings = Object.keys(data.markdownMapping).filter(
    (command) => !delegatedSet.has(command)
  );
  if (unlistedMappings.length > 0) {
    errors.push(
      `${SETUP_DELEGATION_DRIFT}: plugin-command map entries missing from the delegated command list: ${unlistedMappings.join(', ')}`
    );
  }

  const missingCommandFiles = data.delegatedCommands.filter(
    (command) => !commandPlugins.has(command)
  );
  if (missingCommandFiles.length > 0) {
    errors.push(
      `${SETUP_DELEGATION_DRIFT}: delegated commands missing command file: ${missingCommandFiles.join(', ')}`
    );
  }

  const wrongOwner = Object.entries(data.markdownMapping)
    .filter(
      ([command, plugin]) =>
        commandPlugins.has(command) && commandPlugins.get(command) !== plugin
    )
    .map(
      ([command, plugin]) =>
        `${command} maps to ${plugin} but its command file lives in ${commandPlugins.get(command)}`
    );
  if (wrongOwner.length > 0) {
    errors.push(
      `${SETUP_DELEGATION_DRIFT}: plugin-command map does not match command file locations: ${wrongOwner.join('; ')}`
    );
  }
}

function validateOrder(data, errors) {
  if (
    data.dashboardPlugins.length > 0 &&
    data.delegatedPlugins.length > 0 &&
    data.dashboardPlugins.join('|') !==
      data.delegatedPlugins.filter(Boolean).join('|')
  ) {
    errors.push(
      `${SETUP_ORDER_DRIFT}: dashboard order does not match delegated setup order: dashboard=[${data.dashboardPlugins.join(', ')}] delegated=[${data.delegatedPlugins.join(', ')}]`
    );
  }
}

// Step 1.5's query list, recorded fully-qualified tool names, and stated
// probe count must move together (three-point atomic-update rule — see
// docs/solutions/code-quality/setup-classification-probe-coupling.md).
function validateProbeList(sections, marketplacePlugins, errors) {
  const section = sections.probesSection;
  const bullets = [...section.matchAll(/^- `([^`]+)`$/gm)].map(
    (match) => match[1]
  );
  const recorded = bullets.filter((value) => value.startsWith('mcp__plugin_'));
  const queries = bullets.filter((value) => !value.startsWith('mcp__plugin_'));

  const statedMatch = section.match(/Run (\w+) ToolSearch probes/);
  let stated = null;
  if (statedMatch) {
    const raw = statedMatch[1].toLowerCase();
    stated =
      raw in WORD_NUMBERS ? WORD_NUMBERS[raw] : Number.parseInt(raw, 10);
  }
  if (stated === null || Number.isNaN(stated)) {
    errors.push(
      `${SETUP_PROBE_LIST_DRIFT}: could not parse the stated probe count ("Run N ToolSearch probes") in the Step 1.5 section`
    );
  } else if (queries.length !== stated || recorded.length !== stated) {
    errors.push(
      `${SETUP_PROBE_LIST_DRIFT}: Step 1.5 probe list out of sync: stated=${stated} queries=${queries.length} recorded=${recorded.length} (query bullets, recorded tool names, and the stated count must move together)`
    );
  }

  const marketplaceSet = new Set(marketplacePlugins);
  for (const name of recorded) {
    const match = name.match(/^mcp__plugin_([a-z0-9-]+)_[a-z0-9-]+__.+$/);
    if (!match || !marketplaceSet.has(match[1])) {
      errors.push(
        `${SETUP_PROBE_LIST_DRIFT}: recorded tool name references a plugin not in the marketplace: ${name}`
      );
    }
  }

  // Count equality alone misses a renamed/stale query bullet that keeps the
  // total unchanged — every query must EXACTLY match a recorded tool's
  // suffix (the bare tool name, or `server__tool`), so a truncated or
  // broadened query (e.g. `ceramic_search` → `search`) cannot slip past a
  // substring check.
  const suffixCandidates = new Set();
  for (const name of recorded) {
    const parsed = name.match(/^mcp__plugin_[a-z0-9-]+_([a-z0-9-]+)__(.+)$/);
    if (parsed) {
      suffixCandidates.add(parsed[2]);
      suffixCandidates.add(`${parsed[1]}__${parsed[2]}`);
    }
  }
  for (const query of queries) {
    if (!suffixCandidates.has(query)) {
      errors.push(
        `${SETUP_PROBE_LIST_DRIFT}: query bullet does not exactly match any recorded tool name suffix (tool or server__tool): ${query}`
      );
    }
  }

  // ...and the reverse direction: every recorded tool needs a query
  // addressing its own suffix, and query bullets must be unique — otherwise
  // a duplicated query can stand in for a missing one at equal counts.
  const duplicateQueries = [
    ...new Set(queries.filter((query, index) => queries.indexOf(query) !== index)),
  ];
  if (duplicateQueries.length) {
    errors.push(
      `${SETUP_PROBE_LIST_DRIFT}: duplicate query bullets in the Step 1.5 probe list: ${duplicateQueries.join(', ')}`
    );
  }
  // Recorded entries must be unique too — a duplicated recorded line can
  // otherwise cover two alias-variant queries of one tool while the
  // intended second recorded tool is missing at equal counts.
  const duplicateRecorded = [
    ...new Set(recorded.filter((name, index) => recorded.indexOf(name) !== index)),
  ];
  if (duplicateRecorded.length) {
    errors.push(
      `${SETUP_PROBE_LIST_DRIFT}: duplicate recorded tool names in the Step 1.5 probe list: ${duplicateRecorded.join(', ')}`
    );
  }
  const querySet = new Set(queries);
  for (const name of recorded) {
    const parsed = name.match(/^mcp__plugin_[a-z0-9-]+_([a-z0-9-]+)__(.+)$/);
    if (
      parsed &&
      !querySet.has(parsed[2]) &&
      !querySet.has(`${parsed[1]}__${parsed[2]}`)
    ) {
      errors.push(
        `${SETUP_PROBE_LIST_DRIFT}: recorded tool has no corresponding query bullet: ${name}`
      );
    }
  }

  // Classification criteria that reference a fully-qualified tool name must
  // have that tool in the recorded probe list, or the classification
  // silently evaluates against a probe result that was never captured (the
  // coupling documented in
  // docs/solutions/code-quality/setup-classification-probe-coupling.md).
  const recordedSet = new Set(recorded);
  const classificationRefs = new Set(
    [
      ...sections.classificationSection.matchAll(/`(mcp__plugin_[^`]+)`/g),
    ].map((match) => match[1])
  );
  for (const name of classificationRefs) {
    if (!recordedSet.has(name)) {
      errors.push(
        `${SETUP_PROBE_LIST_DRIFT}: classification references a tool name missing from the Step 1.5 recorded probe list: ${name}`
      );
    }
  }
}

function validateCredentialList(data, expectedPlugins, errors) {
  const diff = compareSets(data.credentialPlugins, expectedPlugins);
  if (diff.missing.length || diff.extra.length) {
    errors.push(
      `${SETUP_CREDENTIAL_LIST_DRIFT}: Step 1.6 credential-status plugin list drift vs hooks that emit credential-status: missing=[${diff.missing.join(', ')}] extra=[${diff.extra.join(', ')}]`
    );
  }
}

function validateDashboardExample(sections, marketplacePlugins, errors) {
  const rows = [
    ...sections.exampleSection.matchAll(
      /^ {2}([a-z][a-z0-9-]*)\s{2,}(READY|PARTIAL|NEEDS SETUP|RECOMMENDED|NOT INSTALLED)/gm
    ),
  ].map((match) => match[1]);
  const diff = compareSets(rows, marketplacePlugins);
  if (diff.missing.length || diff.extra.length) {
    errors.push(
      `${SETUP_EXAMPLE_DRIFT}: illustrative dashboard example drift: missing=[${diff.missing.join(', ')}] extra=[${diff.extra.join(', ')}]`
    );
  }

  // compareSets collapses duplicates, so a plugin listed twice would
  // otherwise pass the exact-set check.
  const duplicateRows = [
    ...new Set(rows.filter((name, index) => rows.indexOf(name) !== index)),
  ];
  if (duplicateRows.length) {
    errors.push(
      `${SETUP_EXAMPLE_DRIFT}: duplicate rows in the illustrative dashboard example: ${duplicateRows.join(', ')}`
    );
  }
}

function main() {
  const { marketplacePlugins, setupAll, references } = loadInputs();
  const sections = extractRequiredSections(setupAll, references);
  const data = parseSetupAllData(sections);
  const { commandPlugins, duplicateCommands } = loadCommandPlugins();
  const credentialStatusPlugins = scanCredentialStatusHooks();
  const errors = [];

  if (duplicateCommands.length) {
    errors.push(
      `${SETUP_DELEGATION_DRIFT}: duplicate command names across plugins: ${duplicateCommands.join('; ')}`
    );
  }
  validateCoverage(data, marketplacePlugins, errors);
  validateDelegation(data, commandPlugins, errors);
  validateOrder(data, errors);
  validateProbeList(sections, marketplacePlugins, errors);
  validateCredentialList(data, credentialStatusPlugins, errors);
  validateDashboardExample(sections, marketplacePlugins, errors);

  if (errors.length > 0) {
    exitWithErrors(errors);
  }

  console.log(
    `[validate-setup-all] OK: ${marketplacePlugins.length} marketplace plugins covered by dashboard, classification, delegated setup order, probe list, credential-status list, and dashboard example`
  );
}

main();
