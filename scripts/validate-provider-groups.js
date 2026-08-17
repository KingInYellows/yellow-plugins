#!/usr/bin/env node

/**
 * validate-provider-groups.js — gates the catalog-only `capabilityProvider`
 * field that marks a plugin as one interchangeable implementation of a
 * capability group (currently only `stacked-pr`: gt-workflow/graphite and
 * github-workflow/github). See plans/stacked-pr-provider-abstraction.md.
 *
 * Checks (each failure carries an ERROR-PROVIDER-* code; see
 * packages/domain/src/validation/errorCatalog.ts):
 *   - provider IDs are unique within a group (-001)
 *   - every plugin carrying `capabilityProvider` is a real, Claude-enabled
 *     marketplace plugin — present in catalog.json pluginOrder AND in the
 *     generated .claude-plugin/marketplace.json (-002)
 *   - no provider metadata reaches a generated artifact: not the per-plugin
 *     Claude manifest, not the Codex manifest, not any marketplace entry
 *     (-003)
 *   - every group has at least two distinct members (-004)
 *   - the setup:all provider-group section matches the catalog exactly, and
 *     declares each group mutually exclusive (-005)
 *   - the shipped router's replica of the provider table
 *     (plugins/yellow-core/lib/stack-provider-state.js) matches the catalog
 *     (-006)
 *
 * SCOPE BOUNDARY — read this before assuming the gate covers more than it
 * does. Everything here is STATIC: declaration shape, uniqueness,
 * referential integrity, non-emission, and documentation agreement. The
 * RUNTIME rule the architecture actually turns on — "both providers may be
 * installed, but exactly one may be enabled" — is not expressible in a
 * catalog file and is NOT checked here. It is owned by
 * plugins/yellow-core/lib/stack-provider-state.js (the CONFLICT and
 * MANAGED_CONFLICT states) and pinned by its fixture tests in
 * tests/integration/stack-provider-state.test.ts. A green run of this
 * script says nothing about runtime provider state.
 *
 * Env overrides (for integration-test fixtures):
 *   VALIDATE_PROVIDER_GROUPS_ROOT — project root to validate
 *
 * Exit codes: 0 = all checks pass; 1 = any check failed or an input file
 * could not be read.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.VALIDATE_PROVIDER_GROUPS_ROOT || path.join(__dirname, '..'));

// Error codes assembled via concatenation, NOT literals: the catalog in
// packages/domain/src/validation/errorCatalog.ts is the single source of
// truth, but that package is ESM and this script is CJS, so the codes are
// re-assembled here. scripts/lint-error-codes.js (CODE_PATTERN
// /ERROR-[A-Z]+-\d+/g) fails CI on literal catalog codes in scripts/ —
// split-string assembly is the documented bridge. Any change to the catalog
// entries requires a paired edit here.
const PROVIDER = 'ERROR-' + 'PROVIDER';
const PROVIDER_DUPLICATE_ID = PROVIDER + '-001';
const PROVIDER_UNKNOWN_PLUGIN = PROVIDER + '-002';
const PROVIDER_METADATA_LEAKED = PROVIDER + '-003';
const PROVIDER_GROUP_UNDERPOPULATED = PROVIDER + '-004';
const PROVIDER_SETUP_SECTION_DRIFT = PROVIDER + '-005';
const PROVIDER_ROUTER_TABLE_DRIFT = PROVIDER + '-006';

const SETUP_ALL_RELATIVE = path.join(
  'plugins',
  'yellow-core',
  'commands',
  'setup',
  'all.md'
);

// The shipped router's replica of the catalog's provider table. An installed
// plugin cannot read this repo's catalog/ at runtime, so the table has to be
// duplicated into the plugin — and a replica without a lint is drift waiting
// to happen (the RULE 13/16 precedent in validate-agent-authoring.js).
const ROUTER_TABLE_RELATIVE = path.join(
  'plugins',
  'yellow-core',
  'lib',
  'stack-provider-state.js'
);
const ROUTER_TABLE_START = '// provider-table:start';
const ROUTER_TABLE_END = '// provider-table:end';
const ROUTER_GROUP_RE = /^const PROVIDER_GROUP = '([a-z0-9-]+)';$/m;
const ROUTER_ENTRY_RE = /\{ id: '([a-z0-9-]+)', plugin: '([a-z0-9-]+)' \}/g;

// A group with a single member is not a choice: setup:all would claim
// "exactly one of these may be enabled" about a set of one, and /stack:select
// would offer a switch with no destination. Two is the floor.
const MIN_GROUP_MEMBERS = 2;

// `- `<group>` (mutually exclusive: exactly one enabled)` — the phrase is
// part of the pattern deliberately: a group heading that drops the mutual-
// exclusion clause stops matching and is reported as drift rather than
// silently documenting a group as if both members could run.
const GROUP_HEADING_RE = /^- `([a-z0-9-]+)` \(mutually exclusive: exactly one enabled\)$/gm;
const GROUP_MEMBER_RE = /^ {2}- `([a-z0-9-]+)` → `([a-z0-9-]+)`$/gm;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readText(filePath) {
  // Normalize CRLF once so every $-anchored line regex downstream stays
  // correct if a file picks up Windows line endings (documented WSL2 hazard
  // — see CLAUDE.md "Cross-platform file portability").
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function fail(message) {
  console.error(`[validate-provider-groups] ${message}`);
  process.exit(1);
}

function exitWithErrors(errors) {
  console.error('[validate-provider-groups] Provider-group validation failed:');
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}

/**
 * Load the catalog sources and index every declared provider by group.
 *
 * Returns { groups, declaringPlugins } where `groups` is a Map of
 * group -> Array<{ plugin, id }> in pluginOrder order.
 */
function loadCatalogProviders() {
  const catalogPath = path.join(ROOT, 'catalog', 'catalog.json');
  let catalog;
  try {
    catalog = readJson(catalogPath);
  } catch (error) {
    fail(`Failed to read ${catalogPath}: ${error.message}`);
  }
  if (!Array.isArray(catalog.pluginOrder)) {
    fail(`${catalogPath} has no \`pluginOrder\` array`);
  }

  // Map, not a plain object: group names come from parsed JSON and a plain
  // object literal keyed with "__proto__" would hit the inherited accessor
  // instead of creating an own property (the Object.create(null) precedent
  // in validate-setup-all.js / generate-manifests.js).
  const groups = new Map();
  const declaringPlugins = [];

  for (const name of catalog.pluginOrder) {
    const sourcePath = path.join(ROOT, 'catalog', 'plugins', `${name}.json`);
    let source;
    try {
      source = readJson(sourcePath);
    } catch (error) {
      fail(`Failed to read ${sourcePath}: ${error.message}`);
    }
    const provider = source.capabilityProvider;
    if (provider === undefined) {
      continue;
    }
    // Shape is already enforced by schemas/catalog-plugin.schema.json (AJV,
    // the `generated` CI arm) and by validateCapabilityProvider() in
    // scripts/generate-manifests.js. Re-checking the two fields we
    // dereference keeps this script standalone-runnable against a fixture
    // tree that skipped those gates, instead of throwing a TypeError.
    if (
      provider === null ||
      typeof provider !== 'object' ||
      Array.isArray(provider) ||
      typeof provider.group !== 'string' ||
      typeof provider.id !== 'string' ||
      provider.group.trim().length === 0 ||
      provider.id.trim().length === 0
    ) {
      fail(
        `catalog/plugins/${name}.json: "capabilityProvider" must be an object with non-empty string "group" and "id"`
      );
    }
    declaringPlugins.push(name);
    if (!groups.has(provider.group)) {
      groups.set(provider.group, []);
    }
    groups.get(provider.group).push({ plugin: name, id: provider.id });
  }

  return { groups, declaringPlugins, pluginOrder: catalog.pluginOrder };
}

function validateUniqueIds(groups, errors) {
  for (const [group, members] of groups) {
    const seenIds = new Map();
    for (const member of members) {
      if (seenIds.has(member.id)) {
        errors.push(
          `${PROVIDER_DUPLICATE_ID}: group "${group}" declares provider id "${member.id}" twice (${seenIds.get(member.id)} and ${member.plugin})`
        );
        continue;
      }
      seenIds.set(member.id, member.plugin);
    }
    // A plugin declaring two entries in the same group is impossible today
    // (capabilityProvider is a single object), but the reverse — the same
    // plugin name appearing twice via a duplicated pluginOrder entry — is
    // caught here rather than producing a group that looks over-populated.
    const seenPlugins = new Set();
    for (const member of members) {
      if (seenPlugins.has(member.plugin)) {
        errors.push(
          `${PROVIDER_DUPLICATE_ID}: group "${group}" lists plugin "${member.plugin}" more than once`
        );
      }
      seenPlugins.add(member.plugin);
    }
  }
}

function validateGroupSize(groups, errors) {
  for (const [group, members] of groups) {
    const distinct = new Set(members.map((member) => member.plugin));
    if (distinct.size < MIN_GROUP_MEMBERS) {
      errors.push(
        `${PROVIDER_GROUP_UNDERPOPULATED}: group "${group}" has ${distinct.size} member(s); a capability group needs at least ${MIN_GROUP_MEMBERS} alternatives to be a choice (members: ${[...distinct].join(', ') || 'none'})`
      );
    }
  }
}

function validateReferencedPlugins(groups, marketplaceNames, errors) {
  for (const [group, members] of groups) {
    for (const member of members) {
      if (!marketplaceNames.has(member.plugin)) {
        errors.push(
          `${PROVIDER_UNKNOWN_PLUGIN}: group "${group}" provider "${member.id}" names plugin "${member.plugin}", which is not a Claude-enabled marketplace plugin (absent from .claude-plugin/marketplace.json)`
        );
      }
      const pluginDir = path.join(ROOT, 'plugins', member.plugin);
      if (!fs.existsSync(pluginDir)) {
        errors.push(
          `${PROVIDER_UNKNOWN_PLUGIN}: group "${group}" provider "${member.id}" names plugin "${member.plugin}", which has no plugins/${member.plugin}/ directory`
        );
      }
    }
  }
}

/**
 * Non-emission gate. `capabilityProvider` is catalog-only by construction —
 * both emit-claude.js and emit-codex.js build their output from explicit key
 * lists rather than spreading the source object — but "by construction" is
 * exactly the kind of property a later `{...source}` refactor silently
 * breaks. Scan the generated artifacts for the key and for each declared
 * group/id pair so the guarantee is checked, not assumed.
 */
function validateNonEmission(groups, declaringPlugins, errors) {
  const targets = [];
  const marketplacePath = path.join(ROOT, '.claude-plugin', 'marketplace.json');
  if (fs.existsSync(marketplacePath)) {
    targets.push(marketplacePath);
  }
  const codexMarketplacePath = path.join(ROOT, '.agents', 'plugins', 'marketplace.json');
  if (fs.existsSync(codexMarketplacePath)) {
    targets.push(codexMarketplacePath);
  }
  for (const name of declaringPlugins) {
    for (const manifest of [
      path.join(ROOT, 'plugins', name, '.claude-plugin', 'plugin.json'),
      path.join(ROOT, 'plugins', name, '.codex-plugin', 'plugin.json'),
    ]) {
      if (fs.existsSync(manifest)) {
        targets.push(manifest);
      }
    }
  }

  // Key-name scan alone would miss a leak that renamed the key while
  // carrying the values through (e.g. "provider": {"group":...}); value
  // scan alone would miss an emitted-but-empty key. Check both.
  const values = new Set();
  for (const [group, members] of groups) {
    values.add(group);
    for (const member of members) {
      values.add(member.id);
    }
  }

  for (const target of targets) {
    let parsed;
    let raw;
    try {
      raw = readText(target);
      parsed = JSON.parse(raw);
    } catch (error) {
      fail(`Failed to read generated artifact ${path.relative(ROOT, target)}: ${error.message}`);
    }
    const rel = path.relative(ROOT, target);
    if (findKeyDeep(parsed, 'capabilityProvider')) {
      errors.push(
        `${PROVIDER_METADATA_LEAKED}: generated artifact ${rel} contains a "capabilityProvider" key — provider metadata is catalog-only and must never be emitted`
      );
    }
    // Value scan is scoped to a `"group"`/`"id"` sibling pair so a plugin
    // that legitimately mentions "graphite" in a description or keyword
    // (gt-workflow does, several times) is not a false positive.
    const leaked = findProviderShaped(parsed, values);
    if (leaked.length > 0) {
      errors.push(
        `${PROVIDER_METADATA_LEAKED}: generated artifact ${rel} contains provider-shaped metadata (${leaked.join(', ')}) — provider metadata is catalog-only and must never be emitted`
      );
    }
  }
}

function findKeyDeep(value, key) {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => findKeyDeep(entry, key));
  }
  if (Object.prototype.hasOwnProperty.call(value, key)) {
    return true;
  }
  return Object.values(value).some((entry) => findKeyDeep(entry, key));
}

function findProviderShaped(value, knownValues, found = []) {
  if (value === null || typeof value !== 'object') {
    return found;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      findProviderShaped(entry, knownValues, found);
    }
    return found;
  }
  if (
    typeof value.group === 'string' &&
    typeof value.id === 'string' &&
    knownValues.has(value.group) &&
    knownValues.has(value.id)
  ) {
    found.push(`{group: "${value.group}", id: "${value.id}"}`);
  }
  for (const entry of Object.values(value)) {
    findProviderShaped(entry, knownValues, found);
  }
  return found;
}

/**
 * The setup:all provider-group section is the user-facing statement of the
 * mutual-exclusion rule ("both may be installed, exactly one enabled"), and
 * it is what keeps /setup:all from asking a user to configure two providers.
 * Cross-check it against the catalog by name in BOTH directions.
 */
function validateSetupAllSection(groups, errors) {
  const setupAllPath = path.join(ROOT, SETUP_ALL_RELATIVE);
  let setupAll;
  try {
    setupAll = readText(setupAllPath);
  } catch (error) {
    fail(`Failed to read ${SETUP_ALL_RELATIVE}: ${error.message}`);
  }

  const start = '<!-- setup-all-provider-groups:start -->';
  const end = '<!-- setup-all-provider-groups:end -->';
  const startIndex = setupAll.indexOf(start);
  const endIndex = startIndex === -1 ? -1 : setupAll.indexOf(end, startIndex + start.length);
  if (startIndex === -1 || endIndex === -1) {
    errors.push(
      `${PROVIDER_SETUP_SECTION_DRIFT}: missing provider-group markers (${start} / ${end}) in ${SETUP_ALL_RELATIVE}`
    );
    return;
  }
  const section = setupAll.slice(startIndex + start.length, endIndex);

  // Documented groups, parsed in document order. Members belong to the most
  // recent heading; an indented member line before any heading is drift.
  const documented = new Map();
  const headings = [...section.matchAll(GROUP_HEADING_RE)].map((match) => ({
    group: match[1],
    index: match.index,
  }));
  for (const heading of headings) {
    if (documented.has(heading.group)) {
      errors.push(
        `${PROVIDER_SETUP_SECTION_DRIFT}: group "${heading.group}" is documented twice in ${SETUP_ALL_RELATIVE}`
      );
      continue;
    }
    documented.set(heading.group, []);
  }
  for (const match of section.matchAll(GROUP_MEMBER_RE)) {
    const owning = [...headings].filter((heading) => heading.index < match.index).pop();
    if (!owning) {
      errors.push(
        `${PROVIDER_SETUP_SECTION_DRIFT}: member line \`${match[1]}\` → \`${match[2]}\` appears before any group heading in ${SETUP_ALL_RELATIVE}`
      );
      continue;
    }
    const bucket = documented.get(owning.group);
    if (bucket) {
      bucket.push({ plugin: match[1], id: match[2] });
    }
  }

  const catalogGroupNames = [...groups.keys()].sort();
  const documentedGroupNames = [...documented.keys()].sort();
  if (catalogGroupNames.join('|') !== documentedGroupNames.join('|')) {
    errors.push(
      `${PROVIDER_SETUP_SECTION_DRIFT}: provider groups documented in ${SETUP_ALL_RELATIVE} do not match the catalog: documented=[${documentedGroupNames.join(', ')}] catalog=[${catalogGroupNames.join(', ')}]`
    );
  }

  for (const [group, members] of groups) {
    const documentedMembers = documented.get(group);
    if (!documentedMembers) {
      continue; // already reported by the group-set comparison above
    }
    const expected = members
      .map((member) => `${member.plugin}=${member.id}`)
      .sort()
      .join(', ');
    const actual = documentedMembers
      .map((member) => `${member.plugin}=${member.id}`)
      .sort()
      .join(', ');
    if (expected !== actual) {
      errors.push(
        `${PROVIDER_SETUP_SECTION_DRIFT}: group "${group}" members drift in ${SETUP_ALL_RELATIVE}: documented=[${actual}] catalog=[${expected}]`
      );
    }
  }
}

/**
 * Cross-check the shipped router's provider table against the catalog.
 *
 * Without this, `plugins/yellow-core/lib/stack-provider-state.js` could keep
 * routing to a provider the catalog no longer declares (or miss one it does)
 * and every static gate in the repo would stay green — the runtime would
 * simply never see the new provider.
 */
function validateRouterTable(groups, errors) {
  const routerPath = path.join(ROOT, ROUTER_TABLE_RELATIVE);
  let router;
  try {
    router = readText(routerPath);
  } catch (error) {
    fail(`Failed to read ${ROUTER_TABLE_RELATIVE}: ${error.message}`);
  }

  const groupMatch = router.match(ROUTER_GROUP_RE);
  if (!groupMatch) {
    errors.push(
      `${PROVIDER_ROUTER_TABLE_DRIFT}: ${ROUTER_TABLE_RELATIVE} has no parseable \`const PROVIDER_GROUP = '<group>';\` declaration`
    );
    return;
  }
  const routerGroup = groupMatch[1];

  const start = router.indexOf(ROUTER_TABLE_START);
  const end = start === -1 ? -1 : router.indexOf(ROUTER_TABLE_END, start + ROUTER_TABLE_START.length);
  if (start === -1 || end === -1) {
    errors.push(
      `${PROVIDER_ROUTER_TABLE_DRIFT}: ${ROUTER_TABLE_RELATIVE} is missing the ${ROUTER_TABLE_START} / ${ROUTER_TABLE_END} markers the catalog cross-check parses`
    );
    return;
  }
  const block = router.slice(start + ROUTER_TABLE_START.length, end);
  const routerMembers = [...block.matchAll(ROUTER_ENTRY_RE)].map((match) => ({
    id: match[1],
    plugin: match[2],
  }));

  const catalogMembers = groups.get(routerGroup);
  if (!catalogMembers) {
    errors.push(
      `${PROVIDER_ROUTER_TABLE_DRIFT}: ${ROUTER_TABLE_RELATIVE} routes group "${routerGroup}", which no catalog plugin declares (catalog groups: ${[...groups.keys()].join(', ') || 'none'})`
    );
    return;
  }

  const expected = catalogMembers
    .map((member) => `${member.plugin}=${member.id}`)
    .sort()
    .join(', ');
  const actual = routerMembers
    .map((member) => `${member.plugin}=${member.id}`)
    .sort()
    .join(', ');
  if (expected !== actual) {
    errors.push(
      `${PROVIDER_ROUTER_TABLE_DRIFT}: ${ROUTER_TABLE_RELATIVE} provider table drifts from the catalog's "${routerGroup}" group: router=[${actual}] catalog=[${expected}]`
    );
  }
}

function main() {
  const { groups, declaringPlugins } = loadCatalogProviders();

  const marketplacePath = path.join(ROOT, '.claude-plugin', 'marketplace.json');
  let marketplaceNames = new Set();
  try {
    const marketplace = readJson(marketplacePath);
    if (!Array.isArray(marketplace.plugins)) {
      fail(`${marketplacePath} has no \`plugins\` array`);
    }
    marketplaceNames = new Set(marketplace.plugins.map((plugin) => plugin.name));
  } catch (error) {
    fail(`Failed to read ${marketplacePath}: ${error.message}`);
  }

  const errors = [];
  validateUniqueIds(groups, errors);
  validateGroupSize(groups, errors);
  validateReferencedPlugins(groups, marketplaceNames, errors);
  validateNonEmission(groups, declaringPlugins, errors);
  validateSetupAllSection(groups, errors);
  validateRouterTable(groups, errors);

  if (errors.length > 0) {
    exitWithErrors(errors);
  }

  if (groups.size === 0) {
    console.log('[validate-provider-groups] OK: no capability groups declared');
    return;
  }
  const summary = [...groups]
    .map(([group, members]) => `${group} (${members.map((member) => member.id).join(', ')})`)
    .join('; ');
  console.log(
    `[validate-provider-groups] OK: ${groups.size} capability group(s) verified — ${summary}`
  );
}

main();
