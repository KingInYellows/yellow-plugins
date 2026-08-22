#!/usr/bin/env node
/**
 * generate-manifests.js
 *
 * Regenerates the Claude and Codex distribution artifacts from the neutral
 * catalog sources (R4, R5, R6, R7, R8, R9, R20):
 *
 *   catalog/catalog.json + catalog/plugins/<name>.json + plugins/<name>/package.json
 *     -> plugins/<name>/.claude-plugin/plugin.json   (per Claude-enabled plugin)
 *     -> .claude-plugin/marketplace.json
 *     -> plugins/<name>/.codex-plugin/plugin.json    (per Codex-enabled plugin)
 *     -> plugins/<name>/hooks/codex-hooks.json        (when the plugin has hooks)
 *     -> plugins/<name>/codex/skills/<s>/SKILL.md     (allowlisted skills only)
 *     -> .agents/plugins/marketplace.json             (always — empty-state when
 *                                                       no plugin is Codex-enabled)
 *
 * Modes:
 *   (default)   Apply: atomically rewrite every target whose bytes differ,
 *               and delete any stale Codex artifact (manifest, hooks file,
 *               or skill) that no longer has a corresponding target.
 *   --check     Compute every target's serialized bytes vs the committed
 *               file; exit nonzero while ANY difference remains. Performs
 *               zero writes.
 *   --dry-run   Print the same diff report as --check but always exit 0
 *               (unless the catalog itself is invalid).
 *
 * Exported for in-process tests: `generateManifests({ mode, rootDir })`.
 */

'use strict';

const {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
} = require('fs');
const { dirname, join, relative, resolve, sep } = require('path');

const {
  loadCatalog,
  loadPluginSources,
} = require('./lib/generate/catalog-reader');
const {
  buildPluginManifest,
  buildMarketplace,
  isClaudeEnabled,
} = require('./lib/generate/emit-claude');
const {
  isCodexEnabled,
  buildCodexMarketplace,
  buildCodexPluginManifest,
  buildCodexHookConfig,
  buildCodexSkillTree,
} = require('./lib/generate/emit-codex');
const {
  isCursorEnabled,
  buildCursorMarketplace,
  buildCursorPluginManifest,
  buildCursorSkillTree,
} = require('./lib/generate/emit-cursor');
const {
  assertWithinRoot,
  atomicWrite,
  serializeJson,
} = require('./lib/generate/write');

const DEFAULT_ROOT = resolve(__dirname, '..');
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

// Fields every catalog plugin source must carry for the builders to emit a
// complete manifest + marketplace entry. Checked up front so apply mode can
// never write a manifest with silently-dropped keys.
const REQUIRED_SOURCE_KEYS = [
  '$schema',
  'description',
  'author',
  'homepage',
  'repository',
  'license',
  'keywords',
  'marketplace',
  'targets',
];

// Required fields the emitters splice verbatim into the generated manifest
// or marketplace as a JSON string. A null/number/array value here would emit
// a schema-invalid manifest while apply mode still reported status: 'ok', so
// the value shape — not just key presence — is checked. (All of these are
// also in REQUIRED_SOURCE_KEYS, so presence is enforced by the loop above.)
const REQUIRED_STRING_KEYS = [
  '$schema',
  'description',
  'homepage',
  'repository',
  'license',
];

function validateSource(name, source, errors, pluginOrder) {
  for (const key of REQUIRED_SOURCE_KEYS) {
    if (!(key in source)) {
      errors.push(
        `catalog/plugins/${name}.json: missing required key "${key}"`
      );
    }
  }
  // Value-shape checks for every field the builders dereference — enumerated
  // exhaustively (not just the fields a single reviewer named) so a later
  // "description": null or "keywords": "x" can't reach a generated manifest.
  for (const key of REQUIRED_STRING_KEYS) {
    if (key in source && typeof source[key] !== 'string') {
      errors.push(`catalog/plugins/${name}.json: "${key}" must be a string`);
    }
  }
  if (
    'keywords' in source &&
    (!Array.isArray(source.keywords) ||
      !source.keywords.every((k) => typeof k === 'string'))
  ) {
    errors.push(
      `catalog/plugins/${name}.json: "keywords" must be an array of strings`
    );
  }
  if (
    'marketplace' in source &&
    source.marketplace !== null &&
    typeof source.marketplace === 'object'
  ) {
    const mp = source.marketplace;
    if (!('category' in mp)) {
      errors.push(
        `catalog/plugins/${name}.json: missing required key "marketplace.category"`
      );
    } else if (typeof mp.category !== 'string') {
      errors.push(
        `catalog/plugins/${name}.json: "marketplace.category" must be a string`
      );
    }
    // marketplace.source is oneOf [string path, { source: 'url', url }] per
    // schemas/official-marketplace.schema.json — accept both; reject only a
    // scalar/array/null that could never serialize to a valid entry.
    if (!('source' in mp)) {
      errors.push(
        `catalog/plugins/${name}.json: missing required key "marketplace.source"`
      );
    } else if (typeof mp.source === 'string') {
      if (mp.source.length === 0) {
        errors.push(
          `catalog/plugins/${name}.json: "marketplace.source" string path must be non-empty`
        );
      }
    } else if (
      mp.source !== null &&
      typeof mp.source === 'object' &&
      !Array.isArray(mp.source)
    ) {
      // Object form must match the schema's oneOf branch exactly:
      // { source: "url", url: <string> } (official-marketplace.schema.json).
      if (mp.source.source !== 'url' || typeof mp.source.url !== 'string') {
        errors.push(
          `catalog/plugins/${name}.json: object "marketplace.source" must be { source: "url", url: <string> }`
        );
      }
    } else {
      errors.push(
        `catalog/plugins/${name}.json: "marketplace.source" must be a string path or a { source: "url", url } object`
      );
    }
    // marketplace.description is optional (falls back to source.description),
    // but when present the emitter uses it verbatim, so it must be a string.
    if ('description' in mp && typeof mp.description !== 'string') {
      errors.push(
        `catalog/plugins/${name}.json: "marketplace.description" must be a string`
      );
    }
  } else if ('marketplace' in source) {
    errors.push(
      `catalog/plugins/${name}.json: "marketplace" must be an object`
    );
  }
  // A string-shaped author would silently emit "author": {} into the
  // marketplace, and a non-boolean target flag would silently drop the
  // plugin from generation — both must fail loud here.
  if (
    'author' in source &&
    (typeof source.author !== 'object' ||
      source.author === null ||
      typeof source.author.name !== 'string')
  ) {
    errors.push(
      `catalog/plugins/${name}.json: "author" must be an object with a string "name"`
    );
  }
  validateCapabilityProvider(name, source, errors);
  if (
    'targets' in source &&
    source.targets !== null &&
    typeof source.targets === 'object'
  ) {
    if (typeof source.targets.claude !== 'boolean') {
      errors.push(
        `catalog/plugins/${name}.json: "targets.claude" must be a boolean`
      );
    }
    validateCodexTarget(name, source.targets.codex, errors);
    // Unlike targets.codex, targets.cursor is OPTIONAL on a catalog source
    // (catalog-plugin.schema.json does not list it in targets.required) —
    // only validate its shape when the plugin author actually populated it.
    // Absence is the fail-closed "disabled" state isCursorEnabled already
    // handles; nothing to validate.
    if ('cursor' in source.targets) {
      validateCursorTarget(name, source.targets.cursor, errors);
    }
  } else if ('targets' in source) {
    errors.push(`catalog/plugins/${name}.json: "targets" must be an object`);
  }
  if ('lifecycle' in source) {
    validateLifecycle(name, source.lifecycle, errors, pluginOrder);
  }
}

// `capabilityProvider` is catalog-only metadata: neither emit-claude.js nor
// emit-codex.js reads it, so nothing downstream re-checks its shape the way
// schemas/plugin.schema.json re-checks the pass-through component fields on
// the generated manifest. Without a check here a malformed value
// ("capabilityProvider": "graphite", or a missing `id`) would change zero
// generated bytes, pass `--check`, and only surface later as a silently
// unresolvable provider reference. Validated unconditionally — the field is
// optional, but a present-and-malformed one is always an error.
function validateCapabilityProvider(name, source, errors) {
  if (!('capabilityProvider' in source)) {
    return;
  }
  const provider = source.capabilityProvider;
  if (
    provider === null ||
    typeof provider !== 'object' ||
    Array.isArray(provider)
  ) {
    errors.push(
      `catalog/plugins/${name}.json: "capabilityProvider" must be an object`
    );
    return;
  }
  for (const key of ['group', 'id']) {
    if (!(key in provider)) {
      errors.push(
        `catalog/plugins/${name}.json: missing required key "capabilityProvider.${key}"`
      );
    } else if (
      typeof provider[key] !== 'string' ||
      provider[key].trim().length === 0
    ) {
      errors.push(
        `catalog/plugins/${name}.json: "capabilityProvider.${key}" must be a non-empty string`
      );
    }
  }
}

// `targets.codex` is an object (not a bare boolean like `targets.claude`)
// because Codex enablement carries per-plugin overrides the emitter
// dereferences: interface labels, a description override, and the skill
// allowlist that gates what buildCodexSkillTree copies. All overrides are
// optional and only populated once a later shell actually enables the
// plugin — but their shape is validated unconditionally so a malformed
// override can never reach a generated manifest silently.
function validateCodexTarget(name, codex, errors) {
  if (codex === null || typeof codex !== 'object' || Array.isArray(codex)) {
    errors.push(
      `catalog/plugins/${name}.json: "targets.codex" must be an object`
    );
    return;
  }
  if (typeof codex.enabled !== 'boolean') {
    errors.push(
      `catalog/plugins/${name}.json: "targets.codex.enabled" must be a boolean`
    );
  }
  // buildCodexPluginManifest() dereferences codex.interface.displayName and
  // .category unconditionally once enabled, so a malformed opt-in (enabled
  // without interface) must fail validation rather than crash generation.
  if (codex.enabled === true && !('interface' in codex)) {
    errors.push(
      `catalog/plugins/${name}.json: "targets.codex.interface" is required when "targets.codex.enabled" is true`
    );
  } else if ('interface' in codex) {
    const iface = codex.interface;
    if (iface === null || typeof iface !== 'object' || Array.isArray(iface)) {
      errors.push(
        `catalog/plugins/${name}.json: "targets.codex.interface" must be an object`
      );
    } else {
      if (typeof iface.displayName !== 'string') {
        errors.push(
          `catalog/plugins/${name}.json: "targets.codex.interface.displayName" must be a string`
        );
      }
      if (typeof iface.category !== 'string') {
        errors.push(
          `catalog/plugins/${name}.json: "targets.codex.interface.category" must be a string`
        );
      }
    }
  }
  if ('description' in codex && typeof codex.description !== 'string') {
    errors.push(
      `catalog/plugins/${name}.json: "targets.codex.description" must be a string`
    );
  }
  // buildCodexHookConfig() only skips hook carryover on a strict
  // `codex.includeHooks === false` check — a non-boolean value (e.g. a
  // string "false") silently falls through to the default carryover
  // behavior instead of the intended opt-out, so it must fail validation.
  if ('includeHooks' in codex && typeof codex.includeHooks !== 'boolean') {
    errors.push(
      `catalog/plugins/${name}.json: "targets.codex.includeHooks" must be a boolean`
    );
  }
  if (
    'skillAllowlist' in codex &&
    (!Array.isArray(codex.skillAllowlist) ||
      !codex.skillAllowlist.every((s) => typeof s === 'string'))
  ) {
    errors.push(
      `catalog/plugins/${name}.json: "targets.codex.skillAllowlist" must be an array of strings`
    );
  }
  if ('componentPaths' in codex) {
    const cp = codex.componentPaths;
    if (cp === null || typeof cp !== 'object' || Array.isArray(cp)) {
      errors.push(
        `catalog/plugins/${name}.json: "targets.codex.componentPaths" must be an object`
      );
    } else if (
      'skills' in cp &&
      (typeof cp.skills !== 'string' || cp.skills.trim().length === 0)
    ) {
      errors.push(
        `catalog/plugins/${name}.json: "targets.codex.componentPaths.skills" must be a non-empty string`
      );
    }
  }
  // buildCodexSkillTree() copies every allowlisted skill, but
  // buildCodexPluginManifest() only emits the manifest's "skills" field when
  // componentPaths.skills is set AND the allowlist is non-empty — without
  // the path, the copied skills would be unreachable from the installed
  // plugin. Require the path whenever the allowlist is non-empty.
  const hasSkillAllowlist =
    Array.isArray(codex.skillAllowlist) && codex.skillAllowlist.length > 0;
  const hasSkillsPath =
    codex.componentPaths &&
    typeof codex.componentPaths === 'object' &&
    typeof codex.componentPaths.skills === 'string' &&
    codex.componentPaths.skills.trim().length > 0;
  if (hasSkillAllowlist && !hasSkillsPath) {
    errors.push(
      `catalog/plugins/${name}.json: "targets.codex.componentPaths.skills" is required when "targets.codex.skillAllowlist" is non-empty`
    );
  }
}

// `targets.cursor` mirrors `targets.codex`'s validated shape exactly (see
// validateCodexTarget above for the field-by-field rationale) with one
// structural difference: this function is only ever called when the plugin
// source actually populated `targets.cursor` (catalog-plugin.schema.json
// does not require the key, unlike targets.codex) — absence is validated
// nowhere because isCursorEnabled's Boolean(...) guard already treats it as
// disabled.
function validateCursorTarget(name, cursor, errors) {
  if (cursor === null || typeof cursor !== 'object' || Array.isArray(cursor)) {
    errors.push(
      `catalog/plugins/${name}.json: "targets.cursor" must be an object`
    );
    return;
  }
  if (typeof cursor.enabled !== 'boolean') {
    errors.push(
      `catalog/plugins/${name}.json: "targets.cursor.enabled" must be a boolean`
    );
  }
  // buildCursorPluginManifest() dereferences cursor.interface.displayName
  // and .category unconditionally once enabled, so a malformed opt-in
  // (enabled without interface) must fail validation rather than crash
  // generation.
  if (cursor.enabled === true && !('interface' in cursor)) {
    errors.push(
      `catalog/plugins/${name}.json: "targets.cursor.interface" is required when "targets.cursor.enabled" is true`
    );
  } else if ('interface' in cursor) {
    const iface = cursor.interface;
    if (iface === null || typeof iface !== 'object' || Array.isArray(iface)) {
      errors.push(
        `catalog/plugins/${name}.json: "targets.cursor.interface" must be an object`
      );
    } else {
      if (typeof iface.displayName !== 'string') {
        errors.push(
          `catalog/plugins/${name}.json: "targets.cursor.interface.displayName" must be a string`
        );
      }
      if (typeof iface.category !== 'string') {
        errors.push(
          `catalog/plugins/${name}.json: "targets.cursor.interface.category" must be a string`
        );
      }
    }
  }
  if ('description' in cursor && typeof cursor.description !== 'string') {
    errors.push(
      `catalog/plugins/${name}.json: "targets.cursor.description" must be a string`
    );
  }
  if (
    'skillAllowlist' in cursor &&
    (!Array.isArray(cursor.skillAllowlist) ||
      !cursor.skillAllowlist.every((s) => typeof s === 'string'))
  ) {
    errors.push(
      `catalog/plugins/${name}.json: "targets.cursor.skillAllowlist" must be an array of strings`
    );
  }
  if ('componentPaths' in cursor) {
    const cp = cursor.componentPaths;
    if (cp === null || typeof cp !== 'object' || Array.isArray(cp)) {
      errors.push(
        `catalog/plugins/${name}.json: "targets.cursor.componentPaths" must be an object`
      );
    } else if (
      'skills' in cp &&
      (typeof cp.skills !== 'string' || cp.skills.trim().length === 0)
    ) {
      errors.push(
        `catalog/plugins/${name}.json: "targets.cursor.componentPaths.skills" must be a non-empty string`
      );
    }
  }
  const hasSkillAllowlist =
    Array.isArray(cursor.skillAllowlist) && cursor.skillAllowlist.length > 0;
  const hasSkillsPath =
    cursor.componentPaths &&
    typeof cursor.componentPaths === 'object' &&
    typeof cursor.componentPaths.skills === 'string' &&
    cursor.componentPaths.skills.trim().length > 0;
  if (hasSkillAllowlist && !hasSkillsPath) {
    errors.push(
      `catalog/plugins/${name}.json: "targets.cursor.componentPaths.skills" is required when "targets.cursor.skillAllowlist" is non-empty`
    );
  }
}

const LIFECYCLE_STATUSES = ['active', 'experimental', 'legacy', 'deprecated'];
const LIFECYCLE_INSTALL_POLICIES = ['auto', 'manual'];
const LIFECYCLE_SUPPORT_LEVELS = ['full', 'security-only'];
const LIFECYCLE_KNOWN_KEYS = new Set([
  'status',
  'installPolicy',
  'support',
  'replacement',
]);

// `lifecycle` is catalog-only metadata (never emitted into any generated
// artifact — scripts/validate-cursor.js's non-emission scan is the runtime
// gate for that); this only validates the closed vocabulary and the
// `replacement` cross-reference, since the emitters themselves never
// dereference this field. Unlike every other hand-rolled validator in this
// file (which only checks presence/shape of known keys and never rejects
// extras — additionalProperties:false is otherwise left to an AJV schema
// pass this catalog-level schema doesn't currently have in the pipeline),
// this one explicitly rejects unknown keys to match
// catalog-plugin.schema.json's additionalProperties:false on "lifecycle".
function validateLifecycle(name, lifecycle, errors, pluginOrder) {
  if (
    lifecycle === null ||
    typeof lifecycle !== 'object' ||
    Array.isArray(lifecycle)
  ) {
    errors.push(`catalog/plugins/${name}.json: "lifecycle" must be an object`);
    return;
  }
  for (const key of Object.keys(lifecycle)) {
    if (!LIFECYCLE_KNOWN_KEYS.has(key)) {
      errors.push(
        `catalog/plugins/${name}.json: "lifecycle.${key}" is not a recognized field`
      );
    }
  }
  if (!('status' in lifecycle)) {
    errors.push(
      `catalog/plugins/${name}.json: missing required key "lifecycle.status"`
    );
  } else if (!LIFECYCLE_STATUSES.includes(lifecycle.status)) {
    errors.push(
      `catalog/plugins/${name}.json: "lifecycle.status" must be one of ${LIFECYCLE_STATUSES.join(', ')}`
    );
  }
  if (
    'installPolicy' in lifecycle &&
    !LIFECYCLE_INSTALL_POLICIES.includes(lifecycle.installPolicy)
  ) {
    errors.push(
      `catalog/plugins/${name}.json: "lifecycle.installPolicy" must be one of ${LIFECYCLE_INSTALL_POLICIES.join(', ')}`
    );
  }
  if (
    'support' in lifecycle &&
    !LIFECYCLE_SUPPORT_LEVELS.includes(lifecycle.support)
  ) {
    errors.push(
      `catalog/plugins/${name}.json: "lifecycle.support" must be one of ${LIFECYCLE_SUPPORT_LEVELS.join(', ')}`
    );
  }
  if ('replacement' in lifecycle) {
    if (
      typeof lifecycle.replacement !== 'string' ||
      lifecycle.replacement.length === 0
    ) {
      errors.push(
        `catalog/plugins/${name}.json: "lifecycle.replacement" must be a non-empty string`
      );
    } else if (
      Array.isArray(pluginOrder) &&
      !pluginOrder.includes(lifecycle.replacement)
    ) {
      errors.push(
        `catalog/plugins/${name}.json: "lifecycle.replacement" ("${lifecycle.replacement}") must name a plugin in catalog.json's pluginOrder`
      );
    }
  }
}

// Root `catalog.targets.cursor` config — OPTIONAL, unlike `catalog.targets.
// codex` (which catalog-reader.js already validates as required
// unconditionally; that file is outside this module's ownership). Validated
// here instead, once per generateManifests() run, right after the catalog
// loads successfully. Absence is a legitimate no-op state buildCursorMarketplace
// already handles by returning null — nothing to validate in that case.
function validateCursorRootConfig(catalog, errors) {
  if (!catalog.targets || !('cursor' in catalog.targets)) {
    return;
  }
  const cursor = catalog.targets.cursor;
  if (cursor === null || typeof cursor !== 'object' || Array.isArray(cursor)) {
    errors.push('catalog.json: "targets.cursor" must be an object');
    return;
  }
  if (typeof cursor.name !== 'string' || cursor.name.length === 0) {
    errors.push(
      'catalog.json: "targets.cursor.name" must be a non-empty string'
    );
  }
  if (
    'description' in cursor &&
    (typeof cursor.description !== 'string' || cursor.description.length === 0)
  ) {
    errors.push(
      'catalog.json: "targets.cursor.description" must be a non-empty string'
    );
  }
  if ('owner' in cursor) {
    const owner = cursor.owner;
    if (owner === null || typeof owner !== 'object' || Array.isArray(owner)) {
      errors.push('catalog.json: "targets.cursor.owner" must be an object');
    } else if (typeof owner.name !== 'string' || owner.name.length === 0) {
      errors.push(
        'catalog.json: "targets.cursor.owner.name" must be a non-empty string'
      );
    }
  }
}

/**
 * Compute (and in apply mode, write) every generated target.
 *
 * @param {{ mode?: 'apply'|'check'|'dry-run', rootDir?: string }} [options]
 * @returns {{
 *   status: 'ok'|'error',
 *   errors: string[],
 *   diffs: { path: string, state: 'differs'|'missing'|'stale' }[],
 *   written: string[],
 *   checked: number,
 *   results: { [pluginName: string]: 'ok'|'error' },
 * }}
 */
function generateManifests({ mode = 'apply', rootDir = DEFAULT_ROOT } = {}) {
  const errors = [];
  // `results` is per-plugin reporting only. Attributed error classes:
  // loadPluginSources per-plugin failures (via its `badNames`), source
  // validation, package.json read/shape, target assembly (path containment
  // + skill-tree content validation), and the stale-artifact sweep. NOT
  // attributed (kept global): catalog-wide errors (catalog.json shape,
  // pluginOrder, duplicates) and write/delete-phase failures. An 'ok' entry
  // therefore means "no attributed error before the run ended" — an abort
  // at any gate leaves later-stage checks unrun for every plugin, so 'ok'
  // is not proof a plugin's later stages were verified. Both abort gates
  // below keep their all-or-nothing semantics regardless of it.
  // `Object.create(null)`, not `{}`: pluginOrder entries are only
  // NAME_RE-constrained ([a-zA-Z0-9_-]+), which accepts "__proto__". Keying
  // a plain object literal with that name hits the inherited accessor
  // instead of creating an own property, silently dropping the plugin from
  // every `Object.entries(result.results)` consumer (main()'s error
  // reporting included).
  const result = {
    status: 'ok',
    errors,
    diffs: [],
    written: [],
    checked: 0,
    results: Object.create(null),
  };

  const catalogResult = loadCatalog(join(rootDir, 'catalog'));
  if (catalogResult.status === 'missing') {
    errors.push(`catalog not found at ${catalogResult.path}`);
    result.status = 'error';
    return result;
  }
  if (catalogResult.status === 'invalid') {
    errors.push(...catalogResult.errors);
    result.status = 'error';
    return result;
  }
  const catalog = catalogResult.data;

  // Root Cursor config is optional (unlike targets.codex, which
  // catalog-reader.js already validates unconditionally) — validated here,
  // once, since catalog-reader.js is outside this module's ownership.
  validateCursorRootConfig(catalog, errors);
  if (errors.length > 0) {
    result.status = 'error';
    return result;
  }

  // Populated for every plugin in pluginOrder so callers can inspect
  // per-plugin state from a failed run — but only for the attributed error
  // classes listed above: a run that fails in the write phase reports
  // status 'error' while entries here remain 'ok'.
  for (const name of catalog.pluginOrder) {
    result.results[name] = 'ok';
  }

  const sourcesResult = loadPluginSources(
    join(rootDir, 'catalog'),
    catalog.pluginOrder
  );
  if (sourcesResult.status === 'invalid') {
    errors.push(...sourcesResult.errors);
    // Attribute the plugins the loader itself implicates (missing /
    // unreadable / misshapen source files) so a broken plugin is never
    // affirmatively reported 'ok' by the very run that named it broken.
    // badNames only ever contains pluginOrder entries — the same array
    // that pre-populated `results` above.
    for (const name of sourcesResult.badNames) {
      result.results[name] = 'error';
    }
    result.status = 'error';
    return result;
  }
  const sources = sourcesResult.sources;

  // Versions come from plugins/<name>/package.json only (R3). Matched by
  // explicit name key: pkg.name must equal the catalog source name.
  const pkgs = {};
  for (const name of catalog.pluginOrder) {
    const errorsBeforeValidate = errors.length;
    validateSource(name, sources[name], errors, catalog.pluginOrder);
    if (errors.length > errorsBeforeValidate) {
      result.results[name] = 'error';
    }
    const pkgPath = join(rootDir, 'plugins', name, 'package.json');
    try {
      assertWithinRoot(pkgPath, join(rootDir, 'plugins'));
    } catch (err) {
      errors.push(err.message);
      result.results[name] = 'error';
      continue;
    }
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    } catch (err) {
      errors.push(`cannot read plugins/${name}/package.json: ${err.message}`);
      result.results[name] = 'error';
      continue;
    }
    // Valid JSON with a null/array/scalar root parses fine but would throw a
    // TypeError on pkg.name below, escaping the documented { status: 'error' }
    // contract with an uncaught stack trace (mirrors catalog-reader's guard).
    if (pkg === null || typeof pkg !== 'object' || Array.isArray(pkg)) {
      errors.push(
        `plugins/${name}/package.json: top-level value must be an object`
      );
      result.results[name] = 'error';
      continue;
    }
    if (pkg.name !== name) {
      errors.push(
        `plugins/${name}/package.json "name" is "${pkg.name}", expected "${name}"`
      );
      result.results[name] = 'error';
      continue;
    }
    if (typeof pkg.version !== 'string' || !SEMVER_RE.test(pkg.version)) {
      errors.push(
        `plugins/${name}/package.json has invalid or missing version: "${pkg.version}"`
      );
      result.results[name] = 'error';
      continue;
    }
    pkgs[name] = pkg;
  }
  if (errors.length > 0) {
    result.status = 'error';
    return result;
  }

  // Assemble every target's serialized bytes before touching the filesystem.
  const targets = [];
  for (const name of catalog.pluginOrder) {
    const source = sources[name];
    if (!isClaudeEnabled(source)) {
      continue;
    }
    // This containment check (and the codex-manifest / hooks / skill-tree /
    // stale-sweep siblings below) is defense-in-depth: `name` is already
    // NAME_RE-constrained by loadCatalog and skill-tree targets are
    // containment-checked inside buildCodexSkillTree, so no valid catalog
    // input can currently reach these catch blocks. They exist so a future
    // loosening of an upstream guard degrades to an attributed error
    // instead of an uncaught throw past the {status, errors} contract.
    const targetPath = join(
      rootDir,
      'plugins',
      name,
      '.claude-plugin',
      'plugin.json'
    );
    try {
      assertWithinRoot(targetPath, join(rootDir, 'plugins'));
    } catch (err) {
      errors.push(err.message);
      result.results[name] = 'error';
      continue;
    }
    targets.push({
      path: targetPath,
      bytes: serializeJson(buildPluginManifest(source, pkgs[name])),
    });
  }
  targets.push({
    path: join(rootDir, '.claude-plugin', 'marketplace.json'),
    bytes: serializeJson(buildMarketplace(catalog, sources, pkgs)),
  });

  // Codex targets (R5, R6, R7, R20). Unlike the Claude loop above, this
  // also runs when no plugin is Codex-enabled: buildCodexMarketplace still
  // emits the committed empty-state artifact (plugins: []).
  for (const name of catalog.pluginOrder) {
    const source = sources[name];
    if (!isCodexEnabled(source)) {
      continue;
    }
    const hookConfig = buildCodexHookConfig(source);
    const manifestTargetPath = join(
      rootDir,
      'plugins',
      name,
      '.codex-plugin',
      'plugin.json'
    );
    try {
      assertWithinRoot(manifestTargetPath, join(rootDir, 'plugins'));
    } catch (err) {
      errors.push(err.message);
      result.results[name] = 'error';
      continue;
    }
    targets.push({
      path: manifestTargetPath,
      bytes: serializeJson(
        buildCodexPluginManifest(source, pkgs[name], hookConfig)
      ),
    });
    if (hookConfig !== null) {
      const hooksTargetPath = join(
        rootDir,
        'plugins',
        name,
        'hooks',
        'codex-hooks.json'
      );
      try {
        assertWithinRoot(hooksTargetPath, join(rootDir, 'plugins'));
      } catch (err) {
        errors.push(err.message);
        result.results[name] = 'error';
        continue;
      }
      targets.push({
        path: hooksTargetPath,
        bytes: serializeJson(hookConfig),
      });
    }
    const skillTreeResult = buildCodexSkillTree(rootDir, name, source);
    if (skillTreeResult.status === 'error') {
      errors.push(...skillTreeResult.errors);
      result.results[name] = 'error';
      continue;
    }
    for (const target of skillTreeResult.targets) {
      try {
        assertWithinRoot(target.path, join(rootDir, 'plugins'));
      } catch (err) {
        errors.push(err.message);
        result.results[name] = 'error';
        continue;
      }
      targets.push(target);
    }
  }
  targets.push({
    path: join(rootDir, '.agents', 'plugins', 'marketplace.json'),
    bytes: serializeJson(buildCodexMarketplace(catalog, sources)),
  });

  // Cursor targets. Unlike the Codex loop above, buildCursorMarketplace
  // returns null (not an empty-array object) when either the root
  // catalog.targets.cursor config is absent or zero plugins are
  // Cursor-enabled — in both cases NO root .cursor-plugin/marketplace.json
  // target is pushed here at all; the stale-artifact sweep below removes
  // any leftover file from a prior generation.
  for (const name of catalog.pluginOrder) {
    const source = sources[name];
    if (!isCursorEnabled(source)) {
      continue;
    }
    const manifestTargetPath = join(
      rootDir,
      'plugins',
      name,
      '.cursor-plugin',
      'plugin.json'
    );
    try {
      assertWithinRoot(manifestTargetPath, join(rootDir, 'plugins'));
    } catch (err) {
      errors.push(err.message);
      result.results[name] = 'error';
      continue;
    }
    targets.push({
      path: manifestTargetPath,
      bytes: serializeJson(buildCursorPluginManifest(source, pkgs[name])),
    });
    const skillTreeResult = buildCursorSkillTree(rootDir, name, source);
    if (skillTreeResult.status === 'error') {
      errors.push(...skillTreeResult.errors);
      result.results[name] = 'error';
      continue;
    }
    for (const target of skillTreeResult.targets) {
      try {
        assertWithinRoot(target.path, join(rootDir, 'plugins'));
      } catch (err) {
        errors.push(err.message);
        result.results[name] = 'error';
        continue;
      }
      targets.push(target);
    }
  }
  const cursorMarketplaceObj = buildCursorMarketplace(catalog, sources);
  const cursorMarketplacePath = join(
    rootDir,
    '.cursor-plugin',
    'marketplace.json'
  );
  if (cursorMarketplaceObj !== null) {
    targets.push({
      path: cursorMarketplacePath,
      bytes: serializeJson(cursorMarketplaceObj),
    });
  } else if (existsSync(cursorMarketplacePath)) {
    // No-op emission state (root config absent, or zero plugins enabled) but
    // a prior generation left a file behind — stale-sweep it. This candidate
    // lives OUTSIDE plugins/ (unlike every other stale candidate below), so
    // it is containment-checked against rootDir directly rather than
    // rootDir/plugins.
    try {
      assertWithinRoot(cursorMarketplacePath, rootDir);
      targets.push({ path: cursorMarketplacePath, bytes: null });
    } catch (err) {
      errors.push(err.message);
    }
  }

  // Stale Codex artifact sweep: unlike the loop above, which only ever adds
  // targets, this catches files a prior generation wrote that no longer
  // correspond to a current target — Codex disabled for a plugin, a skill
  // dropped from codex.skillAllowlist, or hooks removed — so `--check`
  // doesn't stay clean while a disabled plugin's artifacts still linger.
  // Scoped to the locations this generator exclusively owns per plugin.
  const expectedPaths = new Set(targets.map((t) => t.path));
  for (const name of catalog.pluginOrder) {
    const sweepErrorsBefore = errors.length;
    const codex = sources[name].targets.codex;
    const skillsPath =
      (codex.componentPaths && codex.componentPaths.skills) || './codex/skills';
    const pluginRoot = join(rootDir, 'plugins', name);
    const skillsDir = join(pluginRoot, skillsPath);
    const staleCandidates = [
      join(pluginRoot, '.codex-plugin', 'plugin.json'),
      join(pluginRoot, 'hooks', 'codex-hooks.json'),
    ];
    // This loop runs unconditionally (no isCodexEnabled guard, so it also
    // covers Codex-disabled plugins), so componentPaths.skills can carry a
    // path-escaping override (e.g. "../yellow-core/skills") that was never
    // checked by buildCodexSkillTree's own containment fix, which only runs
    // for enabled plugins. Binding to the global plugins/ root (as the
    // candidate checks below still do) would let such an override enumerate
    // — and later delete as "stale" — a sibling plugin's source skill files.
    // Mirror buildCodexSkillTree's plugin-scoped check: bind to this
    // plugin's own directory before any readdirSync/unlinkSync on
    // skillsDir, and treat a violation like a validateCodexTarget error
    // (push to errors, skip the sweep) rather than crashing.
    let skillsDirWithinPlugin = true;
    try {
      assertWithinRoot(skillsDir, pluginRoot);
    } catch (_) {
      skillsDirWithinPlugin = false;
      errors.push(
        `catalog/plugins/${name}.json: "targets.codex.componentPaths.skills" ("${skillsPath}") must stay within the plugin's own directory`
      );
    }
    // The readdirSync/unlinkSync sweep below treats every entry under
    // skillsDir not present in expectedPaths as stale and deletes it in
    // apply mode. componentPaths.skills staying within the plugin (the
    // check above) is not enough: if it resolves to — or overlaps — this
    // plugin's own Claude-side source "skills/" directory (e.g. authored as
    // "skills" instead of "codex/skills"), every real
    // plugins/<name>/skills/<skill>/SKILL.md would be enumerated as a stale
    // generated artifact and deleted, even when the plugin is Codex-disabled
    // (this loop runs unconditionally). Reject the overlap before any
    // readdirSync/unlinkSync on skillsDir.
    if (skillsDirWithinPlugin) {
      const sourceSkillsDir = join(pluginRoot, 'skills');
      if (
        skillsDir === sourceSkillsDir ||
        skillsDir.startsWith(sourceSkillsDir + sep) ||
        sourceSkillsDir.startsWith(skillsDir + sep)
      ) {
        skillsDirWithinPlugin = false;
        errors.push(
          `catalog/plugins/${name}.json: "targets.codex.componentPaths.skills" ("${skillsPath}") must not overlap the plugin's own source "skills/" directory`
        );
      }
    }
    // assertWithinRoot() above is purely lexical (string-prefix comparison
    // on path.resolve() output) — it never touches the filesystem, so a
    // skillsPath that resolves cleanly on paper (no ".." segments) can
    // still escape the plugin directory if skillsDir itself, or an
    // ancestor of it, is actually a symlink on disk pointing elsewhere.
    // Mirror buildCodexSkillTree's realpathSync-based containment check
    // (R7) before the readdirSync/unlinkSync below can enumerate or delete
    // anything outside this plugin's own real directory.
    if (skillsDirWithinPlugin) {
      try {
        const pluginRootReal = realpathSync(pluginRoot);
        const skillsDirReal = realpathSync(skillsDir);
        if (
          skillsDirReal !== pluginRootReal &&
          !skillsDirReal.startsWith(pluginRootReal + sep)
        ) {
          skillsDirWithinPlugin = false;
          errors.push(
            `catalog/plugins/${name}.json: "targets.codex.componentPaths.skills" ("${skillsPath}") resolves outside the plugin's own directory through a symlink`
          );
        } else {
          // The lexical overlap check above (skillsDir === sourceSkillsDir,
          // or one a string-prefix of the other) only ever compares the
          // unresolved strings, so it passes when skillsDir is reached
          // THROUGH a symlink whose real target equals — or is nested
          // inside/around — the plugin's real source "skills/" directory
          // (e.g. componentPaths.skills's own "codex/skills" segment being
          // a symlink to "skills"). Mirror the same three-way overlap test
          // on the resolved real paths; a missing source "skills/" dir
          // (ENOENT) means nothing to overlap with.
          let sourceSkillsDirReal = null;
          try {
            sourceSkillsDirReal = realpathSync(join(pluginRoot, 'skills'));
          } catch (err) {
            if (err.code !== 'ENOENT') {
              skillsDirWithinPlugin = false;
              errors.push(
                `cannot resolve real path of ${join(pluginRoot, 'skills')}: ${err.message}`
              );
            }
          }
          if (
            sourceSkillsDirReal !== null &&
            (skillsDirReal === sourceSkillsDirReal ||
              skillsDirReal.startsWith(sourceSkillsDirReal + sep) ||
              sourceSkillsDirReal.startsWith(skillsDirReal + sep))
          ) {
            skillsDirWithinPlugin = false;
            errors.push(
              `catalog/plugins/${name}.json: "targets.codex.componentPaths.skills" ("${skillsPath}") resolves through a symlink to overlap the plugin's own source "skills/" directory`
            );
          }
        }
      } catch (err) {
        if (err.code !== 'ENOENT') {
          skillsDirWithinPlugin = false;
          errors.push(
            `cannot resolve real path of ${skillsDir}: ${err.message}`
          );
        }
        // ENOENT: skillsDir doesn't exist on disk — nothing to sweep, so
        // fall through with skillsDirWithinPlugin still true; the
        // readdirSync below hits the same ENOENT and is silently skipped.
      }
    }
    if (skillsDirWithinPlugin) {
      try {
        const skillsDirReal = realpathSync(skillsDir);
        // Reject symlinked skillsDir itself (even when the target is inside
        // the plugin) before the sweep: a symlink to references/ or another
        // non-generated directory would cause the sweep to delete real files
        // outside the generator-owned tree. Compare resolved vs. unresolved
        // paths to detect when skillsDir itself or an ancestor is a symlink.
        const skillsDirResolved = resolve(skillsDir);
        if (skillsDirReal !== skillsDirResolved) {
          skillsDirWithinPlugin = false;
          errors.push(
            `catalog/plugins/${name}.json: "targets.codex.componentPaths.skills" ("${skillsPath}") is or contains a symlink — symlinked skills directories are not allowed in generated output`
          );
        }
        for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            staleCandidates.push(join(skillsDir, entry.name, 'SKILL.md'));
            // Reference sidecars: emit-codex.js writes flat *.md copies
            // under <skill>/references/. The SKILL.md push above never
            // descends, so a reference removed or renamed at the source
            // would linger forever — enumerate the generated references
            // files as stale candidates too (expectedPaths keeps the
            // still-current ones alive).
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
                // The generator never writes symlinks; deleting through one
                // could reach outside the generator-owned tree. Error, not
                // sweep.
                errors.push(
                  `catalog/plugins/${name}.json: "targets.codex.componentPaths.skills" ("${skillsPath}") skill entry "${entry.name}" has a symlinked references directory — not allowed in generated output`
                );
              } else if (refDirStat.isDirectory()) {
                try {
                  for (const refEntry of readdirSync(refDir, {
                    withFileTypes: true,
                  })) {
                    if (refEntry.isFile()) {
                      staleCandidates.push(join(refDir, refEntry.name));
                    } else {
                      // Only regular files are ever generated here; a
                      // nested directory or symlink is foreign content.
                      errors.push(
                        `unexpected non-file entry in generated ${refDir}: ${refEntry.name}`
                      );
                    }
                  }
                } catch (err) {
                  errors.push(`cannot read ${refDir}: ${err.message}`);
                }
              } else {
                // A plain file named "references" is never generated; sweep
                // it like any other stale artifact in the owned tree.
                staleCandidates.push(refDir);
              }
            }
            continue;
          }
          if (!entry.isSymbolicLink()) {
            continue;
          }
          // Symlinked stale skill dirs are invisible to isDirectory(). Only
          // sweep one when it resolves inside skillsDir — an escape must
          // error, not delete.
          const entryPath = join(skillsDir, entry.name);
          let entryReal;
          try {
            entryReal = realpathSync(entryPath);
          } catch (err) {
            if (err.code !== 'ENOENT') {
              errors.push(
                `cannot resolve real path of ${entryPath}: ${err.message}`
              );
            }
            continue; // broken symlink: no target to sweep
          }
          if (
            entryReal !== skillsDirReal &&
            !entryReal.startsWith(skillsDirReal + sep)
          ) {
            errors.push(
              `catalog/plugins/${name}.json: "targets.codex.componentPaths.skills" ("${skillsPath}") skill entry "${entry.name}" is a symlink that resolves outside the skills directory`
            );
            continue;
          }
          if (statSync(entryPath).isDirectory()) {
            // Push the alias itself (the symlink entry path), never the
            // resolved real path: an entry that symlinks to a still-
            // expected skill dir must NOT be recognized as that legitimate
            // directory — only a genuine (non-symlink) directory matching
            // an expected path may survive the sweep. Pushing the alias
            // also means the removal below (unlinkSync never follows the
            // final path component) deletes the symlink itself, not the
            // real target's SKILL.md reached through it.
            staleCandidates.push(entryPath);
          }
        }
      } catch (err) {
        if (err.code !== 'ENOENT') {
          errors.push(`cannot read ${skillsDir}: ${err.message}`);
        }
      }
    }
    for (const candidate of staleCandidates) {
      if (expectedPaths.has(candidate) || !existsSync(candidate)) {
        continue;
      }
      try {
        assertWithinRoot(candidate, join(rootDir, 'plugins'));
      } catch (err) {
        errors.push(err.message);
        continue;
      }
      targets.push({ path: candidate, bytes: null });
    }
    if (errors.length > sweepErrorsBefore) {
      result.results[name] = 'error';
    }
  }

  // Stale Cursor artifact sweep — same rationale and containment discipline
  // as the Codex sweep above (Cursor disabled for a plugin, or a skill
  // dropped from cursor.skillAllowlist), with two adjustments: (a)
  // `targets.cursor` is OPTIONAL on a catalog source (unlike targets.codex,
  // which is always present), so this loop reads
  // `(source.targets && source.targets.cursor) || {}` rather than
  // dereferencing unconditionally; (b) there is no hooks file to sweep
  // (Cursor plugins carry no generated hooks/cursor-hooks.json equivalent).
  for (const name of catalog.pluginOrder) {
    const sweepErrorsBefore = errors.length;
    const cursor =
      (sources[name].targets && sources[name].targets.cursor) || {};
    const skillsPath =
      (cursor.componentPaths && cursor.componentPaths.skills) ||
      './cursor/skills';
    const pluginRoot = join(rootDir, 'plugins', name);
    const skillsDir = join(pluginRoot, skillsPath);
    const staleCandidates = [join(pluginRoot, '.cursor-plugin', 'plugin.json')];
    let skillsDirWithinPlugin = true;
    try {
      assertWithinRoot(skillsDir, pluginRoot);
    } catch (_) {
      skillsDirWithinPlugin = false;
      errors.push(
        `catalog/plugins/${name}.json: "targets.cursor.componentPaths.skills" ("${skillsPath}") must stay within the plugin's own directory`
      );
    }
    if (skillsDirWithinPlugin) {
      const sourceSkillsDir = join(pluginRoot, 'skills');
      if (
        skillsDir === sourceSkillsDir ||
        skillsDir.startsWith(sourceSkillsDir + sep) ||
        sourceSkillsDir.startsWith(skillsDir + sep)
      ) {
        skillsDirWithinPlugin = false;
        errors.push(
          `catalog/plugins/${name}.json: "targets.cursor.componentPaths.skills" ("${skillsPath}") must not overlap the plugin's own source "skills/" directory`
        );
      }
    }
    if (skillsDirWithinPlugin) {
      try {
        const pluginRootReal = realpathSync(pluginRoot);
        const skillsDirReal = realpathSync(skillsDir);
        if (
          skillsDirReal !== pluginRootReal &&
          !skillsDirReal.startsWith(pluginRootReal + sep)
        ) {
          skillsDirWithinPlugin = false;
          errors.push(
            `catalog/plugins/${name}.json: "targets.cursor.componentPaths.skills" ("${skillsPath}") resolves outside the plugin's own directory through a symlink`
          );
        } else {
          let sourceSkillsDirReal = null;
          try {
            sourceSkillsDirReal = realpathSync(join(pluginRoot, 'skills'));
          } catch (err) {
            if (err.code !== 'ENOENT') {
              skillsDirWithinPlugin = false;
              errors.push(
                `cannot resolve real path of ${join(pluginRoot, 'skills')}: ${err.message}`
              );
            }
          }
          if (
            sourceSkillsDirReal !== null &&
            (skillsDirReal === sourceSkillsDirReal ||
              skillsDirReal.startsWith(sourceSkillsDirReal + sep) ||
              sourceSkillsDirReal.startsWith(skillsDirReal + sep))
          ) {
            skillsDirWithinPlugin = false;
            errors.push(
              `catalog/plugins/${name}.json: "targets.cursor.componentPaths.skills" ("${skillsPath}") resolves through a symlink to overlap the plugin's own source "skills/" directory`
            );
          }
        }
      } catch (err) {
        if (err.code !== 'ENOENT') {
          skillsDirWithinPlugin = false;
          errors.push(
            `cannot resolve real path of ${skillsDir}: ${err.message}`
          );
        }
      }
    }
    if (skillsDirWithinPlugin) {
      try {
        const skillsDirReal = realpathSync(skillsDir);
        const skillsDirResolved = resolve(skillsDir);
        if (skillsDirReal !== skillsDirResolved) {
          skillsDirWithinPlugin = false;
          errors.push(
            `catalog/plugins/${name}.json: "targets.cursor.componentPaths.skills" ("${skillsPath}") is or contains a symlink — symlinked skills directories are not allowed in generated output`
          );
        }
        for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            staleCandidates.push(join(skillsDir, entry.name, 'SKILL.md'));
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
                  `catalog/plugins/${name}.json: "targets.cursor.componentPaths.skills" ("${skillsPath}") skill entry "${entry.name}" has a symlinked references directory — not allowed in generated output`
                );
              } else if (refDirStat.isDirectory()) {
                try {
                  for (const refEntry of readdirSync(refDir, {
                    withFileTypes: true,
                  })) {
                    if (refEntry.isFile()) {
                      staleCandidates.push(join(refDir, refEntry.name));
                    } else {
                      errors.push(
                        `unexpected non-file entry in generated ${refDir}: ${refEntry.name}`
                      );
                    }
                  }
                } catch (err) {
                  errors.push(`cannot read ${refDir}: ${err.message}`);
                }
              } else {
                staleCandidates.push(refDir);
              }
            }
            continue;
          }
          if (!entry.isSymbolicLink()) {
            continue;
          }
          const entryPath = join(skillsDir, entry.name);
          let entryReal;
          try {
            entryReal = realpathSync(entryPath);
          } catch (err) {
            if (err.code !== 'ENOENT') {
              errors.push(
                `cannot resolve real path of ${entryPath}: ${err.message}`
              );
            }
            continue;
          }
          if (
            entryReal !== skillsDirReal &&
            !entryReal.startsWith(skillsDirReal + sep)
          ) {
            errors.push(
              `catalog/plugins/${name}.json: "targets.cursor.componentPaths.skills" ("${skillsPath}") skill entry "${entry.name}" is a symlink that resolves outside the skills directory`
            );
            continue;
          }
          if (statSync(entryPath).isDirectory()) {
            staleCandidates.push(entryPath);
          }
        }
      } catch (err) {
        if (err.code !== 'ENOENT') {
          errors.push(`cannot read ${skillsDir}: ${err.message}`);
        }
      }
    }
    for (const candidate of staleCandidates) {
      if (expectedPaths.has(candidate) || !existsSync(candidate)) {
        continue;
      }
      try {
        assertWithinRoot(candidate, join(rootDir, 'plugins'));
      } catch (err) {
        errors.push(err.message);
        continue;
      }
      targets.push({ path: candidate, bytes: null });
    }
    if (errors.length > sweepErrorsBefore) {
      result.results[name] = 'error';
    }
  }

  if (errors.length > 0) {
    result.status = 'error';
    return result;
  }

  result.checked = targets.length;
  // Two passes, stale deletions first: a stale plain file can occupy a
  // path a content write needs as a directory (e.g. a stale file named
  // "references" where the generated references/ directory must be
  // recreated) — sweeping before writing lets apply mode recover in one
  // run instead of erroring on the occupied path.
  for (const target of targets) {
    if (target.bytes !== null) {
      continue;
    }
    // Stale artifact (from the sweep above): exists on disk with no
    // corresponding target. Report as drift; apply mode deletes it.
    // Existence-only check — readFileSync would throw EISDIR for a stale
    // symlink alias whose entry itself is swept (it may resolve to a
    // directory), and its content is irrelevant here regardless.
    if (!existsSync(target.path)) {
      continue; // already gone
    }
    const rel = relative(rootDir, target.path);
    result.diffs.push({ path: rel, state: 'stale' });
    if (mode === 'apply') {
      try {
        unlinkSync(target.path);
        result.written.push(rel);
      } catch (err) {
        errors.push(`cannot delete ${target.path}: ${err.message}`);
      }
    }
  }
  for (const target of targets) {
    if (target.bytes === null) {
      continue;
    }
    let current = null;
    try {
      current = readFileSync(target.path, 'utf8');
    } catch (err) {
      // ENOTDIR: an ancestor component is a plain file (a stale artifact the
      // pass above deletes in apply mode) — the target cannot exist there,
      // so treat it as missing rather than a hard read error.
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') {
        errors.push(`cannot read ${target.path}: ${err.message}`);
        continue;
      }
    }
    if (current === target.bytes) {
      continue;
    }
    const rel = relative(rootDir, target.path);
    result.diffs.push({
      path: rel,
      state: current === null ? 'missing' : 'differs',
    });
    if (mode === 'apply') {
      try {
        mkdirSync(dirname(target.path), { recursive: true });
        atomicWrite(target.path, target.bytes);
        result.written.push(rel);
      } catch (err) {
        errors.push(`cannot write ${target.path}: ${err.message}`);
      }
    }
  }
  if (errors.length > 0) {
    result.status = 'error';
  }
  return result;
}

function main() {
  const args = process.argv.slice(2);
  const known = new Set(['--check', '--dry-run']);
  const unknown = args.filter((a) => !known.has(a));
  if (unknown.length > 0) {
    console.error(
      `[generate-manifests] ERROR: Unknown argument(s): ${unknown.join(' ')}`
    );
    console.error(
      '[generate-manifests] Usage: node scripts/generate-manifests.js [--check | --dry-run]'
    );
    process.exit(1);
  }
  if (args.includes('--check') && args.includes('--dry-run')) {
    console.error(
      '[generate-manifests] ERROR: --check and --dry-run are mutually exclusive'
    );
    process.exit(1);
  }
  const mode = args.includes('--check')
    ? 'check'
    : args.includes('--dry-run')
      ? 'dry-run'
      : 'apply';

  // Test hook (validator-harness precedent): point the CLI at a fixture tree.
  // Resolved to an absolute path (keeps join()/relative() below well-defined
  // for relative overrides) and required to already exist as a directory —
  // a fail-fast guard against typos/misconfiguration, not an allowlist (an
  // allowlist would reject the mkdtemp fixture roots the integration suites
  // depend on).
  let rootDir = DEFAULT_ROOT;
  if (process.env.GENERATE_MANIFESTS_ROOT) {
    rootDir = resolve(process.env.GENERATE_MANIFESTS_ROOT);
    if (!existsSync(rootDir) || !statSync(rootDir).isDirectory()) {
      console.error(
        `[generate-manifests] ERROR: GENERATE_MANIFESTS_ROOT is not an existing directory: ${process.env.GENERATE_MANIFESTS_ROOT}`
      );
      process.exit(1);
    }
  }
  const result = generateManifests({ mode, rootDir });

  if (result.status === 'error') {
    // One loud line per errored plugin ahead of the detailed error list, with
    // a CI annotation pointing at the plugin's catalog source (same
    // IS_CI/::error shape as validate-plans.js and validate-solutions.js).
    const IS_CI = process.env.GITHUB_ACTIONS === 'true';
    for (const [name, state] of Object.entries(result.results)) {
      if (state !== 'error') {
        continue;
      }
      const count = result.errors.filter(
        (e) =>
          e.includes(`plugins/${name}/`) || e.includes(`plugins/${name}.json`)
      ).length;
      // The substring count is informational only and the predicate can
      // miss: it hardcodes '/' while join() uses path.sep (win32), and a
      // path-escaping componentPaths override can bleed another plugin's
      // name into a message. Cheap insurance — never render a misleading
      // "0 error(s)" for a plugin that IS marked 'error'.
      const detail =
        count > 0 ? `${count} error(s)` : 'error(s) present — see error list';
      console.error(`[generate-manifests] ERROR: plugin ${name}: ${detail}`);
      if (IS_CI) {
        console.log(
          `::error file=catalog/plugins/${name}.json::plugin ${name}: ${detail} — see job log for details`
        );
      }
    }
    for (const error of result.errors) {
      console.error(`[generate-manifests] ERROR: ${error}`);
    }
    if (result.written.length > 0) {
      console.error(
        `[generate-manifests] NOTE: ${result.written.length} target(s) were rewritten before the error: ${result.written.join(', ')}`
      );
    }
    process.exit(1);
  }

  for (const diff of result.diffs) {
    console.log(`[generate-manifests] DRIFT: ${diff.path} (${diff.state})`);
  }

  if (mode === 'apply') {
    console.log(
      `[generate-manifests] Complete: ${result.checked} targets checked, ${result.written.length} rewritten`
    );
    return;
  }

  if (result.diffs.length > 0) {
    console.log(
      `[generate-manifests] ${result.diffs.length} of ${result.checked} generated files ` +
        `differ from catalog/ sources. Run \`pnpm generate:manifests\` to regenerate.`
    );
    // --check fails while ANY diff remains; --dry-run always reports cleanly.
    process.exit(mode === 'check' ? 1 : 0);
  }
  console.log(
    `[generate-manifests] All ${result.checked} generated files match catalog/ sources`
  );
}

if (require.main === module) {
  main();
}

module.exports = { generateManifests };
