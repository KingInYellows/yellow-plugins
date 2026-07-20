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

const { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, unlinkSync } = require('fs');
const { dirname, join, relative, resolve, sep } = require('path');

const { loadCatalog, loadPluginSources } = require('./lib/generate/catalog-reader');
const { buildPluginManifest, buildMarketplace, isClaudeEnabled } = require('./lib/generate/emit-claude');
const {
  isCodexEnabled,
  buildCodexMarketplace,
  buildCodexPluginManifest,
  buildCodexHookConfig,
  buildCodexSkillTree,
} = require('./lib/generate/emit-codex');
const { assertWithinRoot, atomicWrite, serializeJson } = require('./lib/generate/write');

const DEFAULT_ROOT = resolve(__dirname, '..');
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

// Fields every catalog plugin source must carry for the builders to emit a
// complete manifest + marketplace entry. Checked up front so apply mode can
// never write a manifest with silently-dropped keys.
const REQUIRED_SOURCE_KEYS = [
  '$schema', 'description', 'author', 'homepage', 'repository', 'license',
  'keywords', 'marketplace', 'targets',
];

// Required fields the emitters splice verbatim into the generated manifest
// or marketplace as a JSON string. A null/number/array value here would emit
// a schema-invalid manifest while apply mode still reported status: 'ok', so
// the value shape — not just key presence — is checked. (All of these are
// also in REQUIRED_SOURCE_KEYS, so presence is enforced by the loop above.)
const REQUIRED_STRING_KEYS = [
  '$schema', 'description', 'homepage', 'repository', 'license',
];

function validateSource(name, source, errors) {
  for (const key of REQUIRED_SOURCE_KEYS) {
    if (!(key in source)) {
      errors.push(`catalog/plugins/${name}.json: missing required key "${key}"`);
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
    errors.push(`catalog/plugins/${name}.json: "keywords" must be an array of strings`);
  }
  if ('marketplace' in source && source.marketplace !== null && typeof source.marketplace === 'object') {
    const mp = source.marketplace;
    if (!('category' in mp)) {
      errors.push(`catalog/plugins/${name}.json: missing required key "marketplace.category"`);
    } else if (typeof mp.category !== 'string') {
      errors.push(`catalog/plugins/${name}.json: "marketplace.category" must be a string`);
    }
    // marketplace.source is oneOf [string path, { source: 'url', url }] per
    // schemas/official-marketplace.schema.json — accept both; reject only a
    // scalar/array/null that could never serialize to a valid entry.
    if (!('source' in mp)) {
      errors.push(`catalog/plugins/${name}.json: missing required key "marketplace.source"`);
    } else if (typeof mp.source === 'string') {
      if (mp.source.length === 0) {
        errors.push(`catalog/plugins/${name}.json: "marketplace.source" string path must be non-empty`);
      }
    } else if (mp.source !== null && typeof mp.source === 'object' && !Array.isArray(mp.source)) {
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
      errors.push(`catalog/plugins/${name}.json: "marketplace.description" must be a string`);
    }
  } else if ('marketplace' in source) {
    errors.push(`catalog/plugins/${name}.json: "marketplace" must be an object`);
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
  if ('targets' in source && source.targets !== null && typeof source.targets === 'object') {
    if (typeof source.targets.claude !== 'boolean') {
      errors.push(`catalog/plugins/${name}.json: "targets.claude" must be a boolean`);
    }
    validateCodexTarget(name, source.targets.codex, errors);
  } else if ('targets' in source) {
    errors.push(`catalog/plugins/${name}.json: "targets" must be an object`);
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
    errors.push(`catalog/plugins/${name}.json: "targets.codex" must be an object`);
    return;
  }
  if (typeof codex.enabled !== 'boolean') {
    errors.push(`catalog/plugins/${name}.json: "targets.codex.enabled" must be a boolean`);
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
      errors.push(`catalog/plugins/${name}.json: "targets.codex.interface" must be an object`);
    } else {
      if (typeof iface.displayName !== 'string') {
        errors.push(`catalog/plugins/${name}.json: "targets.codex.interface.displayName" must be a string`);
      }
      if (typeof iface.category !== 'string') {
        errors.push(`catalog/plugins/${name}.json: "targets.codex.interface.category" must be a string`);
      }
    }
  }
  if ('description' in codex && typeof codex.description !== 'string') {
    errors.push(`catalog/plugins/${name}.json: "targets.codex.description" must be a string`);
  }
  // buildCodexHookConfig() only skips hook carryover on a strict
  // `codex.includeHooks === false` check — a non-boolean value (e.g. a
  // string "false") silently falls through to the default carryover
  // behavior instead of the intended opt-out, so it must fail validation.
  if ('includeHooks' in codex && typeof codex.includeHooks !== 'boolean') {
    errors.push(`catalog/plugins/${name}.json: "targets.codex.includeHooks" must be a boolean`);
  }
  if (
    'skillAllowlist' in codex &&
    (!Array.isArray(codex.skillAllowlist) ||
      !codex.skillAllowlist.every((s) => typeof s === 'string'))
  ) {
    errors.push(`catalog/plugins/${name}.json: "targets.codex.skillAllowlist" must be an array of strings`);
  }
  if ('componentPaths' in codex) {
    const cp = codex.componentPaths;
    if (cp === null || typeof cp !== 'object' || Array.isArray(cp)) {
      errors.push(`catalog/plugins/${name}.json: "targets.codex.componentPaths" must be an object`);
    } else if ('skills' in cp && (typeof cp.skills !== 'string' || cp.skills.trim().length === 0)) {
      errors.push(`catalog/plugins/${name}.json: "targets.codex.componentPaths.skills" must be a non-empty string`);
    }
  }
  // buildCodexSkillTree() copies every allowlisted skill, but
  // buildCodexPluginManifest() only emits the manifest's "skills" field when
  // componentPaths.skills is set AND the allowlist is non-empty — without
  // the path, the copied skills would be unreachable from the installed
  // plugin. Require the path whenever the allowlist is non-empty.
  const hasSkillAllowlist = Array.isArray(codex.skillAllowlist) && codex.skillAllowlist.length > 0;
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
 * }}
 */
function generateManifests({ mode = 'apply', rootDir = DEFAULT_ROOT } = {}) {
  const errors = [];
  const result = { status: 'ok', errors, diffs: [], written: [], checked: 0 };

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

  const sourcesResult = loadPluginSources(join(rootDir, 'catalog'), catalog.pluginOrder);
  if (sourcesResult.status === 'invalid') {
    errors.push(...sourcesResult.errors);
    result.status = 'error';
    return result;
  }
  const sources = sourcesResult.sources;

  // Versions come from plugins/<name>/package.json only (R3). Matched by
  // explicit name key: pkg.name must equal the catalog source name.
  const pkgs = {};
  for (const name of catalog.pluginOrder) {
    validateSource(name, sources[name], errors);
    const pkgPath = join(rootDir, 'plugins', name, 'package.json');
    try {
      assertWithinRoot(pkgPath, join(rootDir, 'plugins'));
    } catch (err) {
      errors.push(err.message);
      continue;
    }
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    } catch (err) {
      errors.push(`cannot read plugins/${name}/package.json: ${err.message}`);
      continue;
    }
    // Valid JSON with a null/array/scalar root parses fine but would throw a
    // TypeError on pkg.name below, escaping the documented { status: 'error' }
    // contract with an uncaught stack trace (mirrors catalog-reader's guard).
    if (pkg === null || typeof pkg !== 'object' || Array.isArray(pkg)) {
      errors.push(`plugins/${name}/package.json: top-level value must be an object`);
      continue;
    }
    if (pkg.name !== name) {
      errors.push(
        `plugins/${name}/package.json "name" is "${pkg.name}", expected "${name}"`
      );
      continue;
    }
    if (typeof pkg.version !== 'string' || !SEMVER_RE.test(pkg.version)) {
      errors.push(
        `plugins/${name}/package.json has invalid or missing version: "${pkg.version}"`
      );
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
    const targetPath = join(rootDir, 'plugins', name, '.claude-plugin', 'plugin.json');
    assertWithinRoot(targetPath, join(rootDir, 'plugins'));
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
    const manifestTargetPath = join(rootDir, 'plugins', name, '.codex-plugin', 'plugin.json');
    assertWithinRoot(manifestTargetPath, join(rootDir, 'plugins'));
    targets.push({
      path: manifestTargetPath,
      bytes: serializeJson(buildCodexPluginManifest(source, pkgs[name], hookConfig)),
    });
    if (hookConfig !== null) {
      const hooksTargetPath = join(rootDir, 'plugins', name, 'hooks', 'codex-hooks.json');
      assertWithinRoot(hooksTargetPath, join(rootDir, 'plugins'));
      targets.push({
        path: hooksTargetPath,
        bytes: serializeJson(hookConfig),
      });
    }
    const skillTreeResult = buildCodexSkillTree(rootDir, name, source);
    if (skillTreeResult.status === 'error') {
      errors.push(...skillTreeResult.errors);
      continue;
    }
    for (const target of skillTreeResult.targets) {
      assertWithinRoot(target.path, join(rootDir, 'plugins'));
      targets.push(target);
    }
  }
  targets.push({
    path: join(rootDir, '.agents', 'plugins', 'marketplace.json'),
    bytes: serializeJson(buildCodexMarketplace(catalog, sources)),
  });

  // Stale Codex artifact sweep: unlike the loop above, which only ever adds
  // targets, this catches files a prior generation wrote that no longer
  // correspond to a current target — Codex disabled for a plugin, a skill
  // dropped from codex.skillAllowlist, or hooks removed — so `--check`
  // doesn't stay clean while a disabled plugin's artifacts still linger.
  // Scoped to the locations this generator exclusively owns per plugin.
  const expectedPaths = new Set(targets.map((t) => t.path));
  for (const name of catalog.pluginOrder) {
    const codex = sources[name].targets.codex;
    const skillsPath = (codex.componentPaths && codex.componentPaths.skills) || './codex/skills';
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
        if (skillsDirReal !== pluginRootReal && !skillsDirReal.startsWith(pluginRootReal + sep)) {
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
              errors.push(`cannot resolve real path of ${join(pluginRoot, 'skills')}: ${err.message}`);
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
          errors.push(`cannot resolve real path of ${skillsDir}: ${err.message}`);
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
              errors.push(`cannot resolve real path of ${entryPath}: ${err.message}`);
            }
            continue; // broken symlink: no target to sweep
          }
          if (entryReal !== skillsDirReal && !entryReal.startsWith(skillsDirReal + sep)) {
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
      assertWithinRoot(candidate, join(rootDir, 'plugins'));
      targets.push({ path: candidate, bytes: null });
    }
  }
  if (errors.length > 0) {
    result.status = 'error';
    return result;
  }

  result.checked = targets.length;
  for (const target of targets) {
    if (target.bytes === null) {
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
      continue;
    }
    let current = null;
    try {
      current = readFileSync(target.path, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') {
        errors.push(`cannot read ${target.path}: ${err.message}`);
        continue;
      }
    }
    if (current === target.bytes) {
      continue;
    }
    const rel = relative(rootDir, target.path);
    result.diffs.push({ path: rel, state: current === null ? 'missing' : 'differs' });
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
    console.error(`[generate-manifests] Unknown argument(s): ${unknown.join(' ')}`);
    console.error('[generate-manifests] Usage: node scripts/generate-manifests.js [--check | --dry-run]');
    process.exit(1);
  }
  if (args.includes('--check') && args.includes('--dry-run')) {
    console.error('[generate-manifests] --check and --dry-run are mutually exclusive');
    process.exit(1);
  }
  const mode = args.includes('--check') ? 'check' : args.includes('--dry-run') ? 'dry-run' : 'apply';

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
    for (const error of result.errors) {
      console.error(`[generate-manifests] ERROR: ${error}`);
    }
    if (result.written.length > 0) {
      console.error(
        `[generate-manifests] Note: ${result.written.length} target(s) were rewritten before the error: ${result.written.join(', ')}`
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
  console.log(`[generate-manifests] All ${result.checked} generated files match catalog/ sources`);
}

if (require.main === module) {
  main();
}

module.exports = { generateManifests };
