'use strict';

/**
 * Builders for the Cursor distribution target.
 *
 * `isCursorEnabled`, `buildCursorMarketplace`, and `buildCursorPluginManifest`
 * are pure — no I/O, no timestamps, no environment-dependent content —
 * mirroring emit-codex.js's shape. `buildCursorSkillTree` is NOT pure: like
 * buildCodexSkillTree, it enumerates and reads N skill files from disk to
 * normalize them, doing controlled, symlink-rejecting reads and returning a
 * discriminated-union result the caller batches into the same
 * `targets.push({path, bytes})` pipeline as every other generated file.
 *
 * Cursor diverges from Codex in one structural way worth stating up front:
 * the root Cursor marketplace has NO always-on empty-state artifact. Both
 * the root catalog config (catalog.targets.cursor) and the per-plugin
 * enablement (targets.cursor.enabled) are OPTIONAL — unlike Codex's
 * unconditionally-required root config — so `buildCursorMarketplace` returns
 * `null` (not an empty-array object) whenever the root config is absent OR
 * zero plugins are Cursor-enabled. The caller (generate-manifests.js) must
 * treat a `null` return as "emit nothing, and stale-sweep any leftover
 * .cursor-plugin/marketplace.json" rather than pushing a target.
 *
 * The generated .cursor-plugin/plugin.json shape is FLAT — displayName and
 * category sit at the manifest's top level, not nested under an "interface"
 * object the way Codex's generated manifest nests them (see
 * schemas/cursor-plugin.schema.json's $comment: this repo's own
 * codex-plugin.schema.json invents that nesting; the verified upstream
 * Cursor schema has no such wrapper). The catalog's authoring-side
 * `targets.cursor.interface.{displayName,category}` grouping is a catalog
 * convention only, shared with targets.codex for authoring consistency —
 * buildCursorPluginManifest flattens it on the way out.
 */

const {
  readFileSync,
  openSync,
  closeSync,
  constants,
  realpathSync,
  readdirSync,
  lstatSync,
} = require('fs');
const { join } = require('path');

const { assertWithinRoot, NAME_RE } = require('./write');

// Duplicated from emit-codex.js's own FRONTMATTER_RE (itself duplicated from
// scripts/validate-agent-authoring.js's extractFrontmatter, which has no
// module.exports) for the same reason: match Claude Code's own frontmatter
// parsing, not a hand-rolled approximation. Keep in sync if the source
// regex changes.
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

// Reference sidecar files copied alongside SKILL.md must be flat *.md with
// conservative names — nested directories and every other filename shape
// keep the fail-closed hard error in buildCursorSkillTree. Mirrors
// emit-codex.js's REF_FILE_RE exactly.
const REF_FILE_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_-]*\.md$/;

/**
 * Single source of truth for Cursor-target membership — the twin to
 * emit-codex.js's isCodexEnabled. Unlike isCodexEnabled, `source.targets`
 * and `source.targets.cursor` are both OPTIONAL on a catalog plugin source
 * (targets.cursor is not in catalog-plugin.schema.json's targets.required
 * list), so absence must resolve to disabled rather than throw — the
 * Boolean(...) guards make that explicit rather than relying on
 * `undefined.enabled` never being reached.
 */
function isCursorEnabled(source) {
  return (
    Boolean(source.targets) &&
    Boolean(source.targets.cursor) &&
    source.targets.cursor.enabled === true
  );
}

/**
 * Build the `.cursor-plugin/marketplace.json` object, or `null` when no
 * artifact should be emitted at all.
 *
 * Returns `null` (not an empty-array marketplace object) when EITHER:
 *   - `catalog.targets.cursor` is absent (no root Cursor config authored
 *     yet), or
 *   - the root config is present but zero plugins are Cursor-enabled.
 * Both are legitimate no-op states for this target — the caller must treat
 * a `null` return as "do not push a target; sweep any stale
 * .cursor-plugin/marketplace.json left on disk from a prior generation."
 * This is the one place Cursor's emission contract diverges from Codex's
 * (buildCodexMarketplace always returns an object, even `{plugins: []}`).
 *
 * @param {object} catalog - Parsed catalog/catalog.json.
 * @param {Record<string, object>} sources - name -> catalog plugin source.
 * @param {Record<string, {name: string, version: string}>} pkgs - unused
 *   directly (marketplace entries carry no version), kept in the signature
 *   for parity with buildCodexMarketplace's call shape and in case a future
 *   entry field needs it.
 */
function buildCursorMarketplace(catalog, sources) {
  const cursorRoot = catalog.targets && catalog.targets.cursor;
  if (!cursorRoot) {
    return null;
  }
  const plugins = [];
  for (const name of catalog.pluginOrder) {
    const source = sources[name];
    if (!isCursorEnabled(source)) {
      continue;
    }
    const cursor = source.targets.cursor;
    plugins.push({
      name,
      source: `plugins/${name}`,
      description:
        cursor.description !== undefined
          ? cursor.description
          : source.description,
    });
  }
  if (plugins.length === 0) {
    return null;
  }
  const marketplace = { name: cursorRoot.name };
  if (cursorRoot.owner !== undefined) {
    marketplace.owner = cursorRoot.owner;
  }
  if (cursorRoot.description !== undefined) {
    marketplace.metadata = { description: cursorRoot.description };
  }
  marketplace.plugins = plugins;
  return marketplace;
}

/**
 * Build one `plugins/<name>/.cursor-plugin/plugin.json` object. Flat shape
 * per the verified upstream schema (schemas/cursor-plugin.schema.json) —
 * displayName/category sit at the top level, not nested under "interface"
 * the way buildCodexPluginManifest nests them.
 *
 * @param {object} source - Parsed catalog/plugins/<name>.json.
 * @param {{ name: string, version: string }} pkg - The plugin's package.json
 *   (sole name/version authority).
 */
function buildCursorPluginManifest(source, pkg) {
  const cursor = source.targets.cursor;
  const manifest = {
    name: pkg.name,
    displayName: cursor.interface.displayName,
    version: pkg.version,
    description:
      cursor.description !== undefined
        ? cursor.description
        : source.description,
    // Upstream author shape is {name, email?} only — no "url" field, unlike
    // this repo's own catalog-plugin.schema.json author object
    // (additionalProperties: false on cursor-plugin.schema.json's author
    // rejects an unknown key). source.author.url is deliberately never
    // copied here.
    author: { name: source.author.name },
    homepage: source.homepage,
    repository: source.repository,
    license: source.license,
    keywords: source.keywords,
    category: cursor.interface.category,
  };
  if (source.author.email !== undefined) {
    manifest.author.email = source.author.email;
  }
  // Only claim a "skills" field when buildCursorSkillTree() will actually
  // copy at least one skill there — mirrors buildCodexPluginManifest's same
  // guard so the manifest never points at a skills directory the generator
  // never wrote.
  // Same './cursor/skills' default buildCursorSkillTree() copies to when
  // componentPaths.skills is omitted — otherwise the tree would be written
  // but the manifest would not point at it.
  const skillsPath =
    (cursor.componentPaths && cursor.componentPaths.skills) || './cursor/skills';
  const hasAllowlistedSkills =
    Array.isArray(cursor.skillAllowlist) && cursor.skillAllowlist.length > 0;
  if (skillsPath && hasAllowlistedSkills) {
    manifest.skills = skillsPath;
  }
  return manifest;
}

/**
 * Shared symlink-containment check for a copied-input directory (skill dir
 * and its references/ dir). Duplicated from emit-codex.js's
 * checkDirSymlinkContainment (not imported — emit-codex.js has no
 * module-level export for it, and this file must not import from
 * emit-codex.js per the two targets' independent-module convention).
 *
 * @param {string} dir - directory to check (unresolved path).
 * @param {string} expectedRealPath - the literal canonical location the
 *   directory must resolve to.
 * @returns {{status: 'ok'}|{status: 'symlink'}|{status: 'notDir'}|{status: 'error', error: Error}}
 */
function checkDirSymlinkContainment(dir, expectedRealPath) {
  try {
    const stat = lstatSync(dir);
    if (stat.isSymbolicLink()) {
      return { status: 'symlink' };
    }
    if (!stat.isDirectory()) {
      return { status: 'notDir' };
    }
    if (realpathSync(dir) !== expectedRealPath) {
      return { status: 'symlink' };
    }
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', error: err };
  }
}

/**
 * Copy the Cursor-allowlisted subset of `plugins/<name>/skills/` into
 * `plugins/<name>/<cursor.componentPaths.skills>/` (defaulting to
 * `plugins/<name>/cursor/skills/` when unset — the same source
 * buildCursorPluginManifest uses for the manifest's "skills" field, so the
 * two always agree). Mirrors buildCodexSkillTree's symlink/containment/
 * frontmatter-normalization discipline exactly (same rationale: R7-style
 * containment against path-escaping componentPaths.skills overrides,
 * O_NOFOLLOW reads, references/*.md sidecar support). Duplicated rather
 * than shared with emit-codex.js — this file's module boundary intentionally
 * matches emit-codex.js's own precedent of self-contained duplication
 * (FRONTMATTER_RE, REF_FILE_RE) over cross-target imports.
 *
 * @param {string} rootDir - Repo root.
 * @param {string} name - Plugin name.
 * @param {object} source - Parsed catalog/plugins/<name>.json.
 * @returns {{ status: 'ok', targets: { path: string, bytes: string }[] }
 *          | { status: 'error', errors: string[] }}
 */
function buildCursorSkillTree(rootDir, name, source) {
  // Lazy require: same rationale as emit-codex.js's own lazy 'yaml' require
  // — keep the `pnpm install`-free CJS chain (isCursorEnabled et al.) free
  // of a third-party dependency for callers that never touch skill trees.
  const YAML = require('yaml');
  const cursor = source.targets.cursor;
  const allowlist = (cursor && cursor.skillAllowlist) || [];
  const skillsPath =
    (cursor && cursor.componentPaths && cursor.componentPaths.skills) ||
    './cursor/skills';
  const pluginRoot = join(rootDir, 'plugins', name);
  try {
    assertWithinRoot(join(pluginRoot, skillsPath), pluginRoot);
  } catch (_) {
    return {
      status: 'error',
      errors: [
        `plugins/${name}/targets.cursor.componentPaths.skills ("${skillsPath}"): path must stay within the plugin's own directory`,
      ],
    };
  }
  const pluginRootReal = realpathSync(pluginRoot);
  const errors = [];
  const targets = [];

  for (const skillName of allowlist) {
    if (!NAME_RE.test(skillName)) {
      errors.push(
        `plugins/${name}/skills/${skillName}: skill name fails the [a-zA-Z0-9_-] allowlist`
      );
      continue;
    }
    const skillDir = join(rootDir, 'plugins', name, 'skills', skillName);
    const skillFile = join(skillDir, 'SKILL.md');

    const skillDirCheck = checkDirSymlinkContainment(
      skillDir,
      join(pluginRootReal, 'skills', skillName)
    );
    if (skillDirCheck.status === 'symlink') {
      errors.push(
        `plugins/${name}/skills/${skillName}: symlinked skill directories (including a symlinked ancestor such as skills/) are not allowed`
      );
      continue;
    }
    if (
      skillDirCheck.status === 'error' &&
      skillDirCheck.error.code !== 'ENOENT'
    ) {
      errors.push(
        `plugins/${name}/skills/${skillName}: ${skillDirCheck.error.message}`
      );
      continue;
    }

    let sidecarEntries;
    try {
      sidecarEntries = readdirSync(skillDir).filter(
        (entry) => entry !== 'SKILL.md'
      );
    } catch (_) {
      sidecarEntries = []; // missing entirely; the SKILL.md open below reports it
    }
    const unsupportedSidecars = sidecarEntries.filter(
      (entry) => entry !== 'references'
    );
    if (unsupportedSidecars.length > 0) {
      errors.push(
        `plugins/${name}/skills/${skillName}: has sidecar file(s) not yet supported for Cursor (${unsupportedSidecars.join(', ')}) — only SKILL.md and references/*.md are copied`
      );
      continue;
    }

    const referenceTargets = [];
    if (sidecarEntries.includes('references')) {
      const refDir = join(skillDir, 'references');
      const refDirCheck = checkDirSymlinkContainment(
        refDir,
        join(pluginRootReal, 'skills', skillName, 'references')
      );
      if (refDirCheck.status === 'symlink') {
        errors.push(
          `plugins/${name}/skills/${skillName}/references: symlinked references directories (including a symlinked ancestor) are not allowed`
        );
        continue;
      }
      if (refDirCheck.status === 'notDir') {
        errors.push(
          `plugins/${name}/skills/${skillName}/references: exists but is not a directory — only a flat references/ directory of *.md files is supported for Cursor`
        );
        continue;
      }
      if (refDirCheck.status === 'error') {
        errors.push(
          `plugins/${name}/skills/${skillName}/references: ${refDirCheck.error.message}`
        );
        continue;
      }

      let refEntries;
      try {
        refEntries = readdirSync(refDir, { withFileTypes: true });
      } catch (err) {
        errors.push(
          `plugins/${name}/skills/${skillName}/references: ${err.message}`
        );
        continue;
      }
      let refEntryBad = false;
      refEntries.sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0
      );
      for (const entry of refEntries) {
        if (!entry.isFile() || !REF_FILE_RE.test(entry.name)) {
          errors.push(
            `plugins/${name}/skills/${skillName}/references/${entry.name}: only flat, regular [a-zA-Z0-9_-]+.md reference files are supported for Cursor`
          );
          refEntryBad = true;
          continue;
        }
        const refFile = join(refDir, entry.name);
        let refFd;
        try {
          refFd = openSync(refFile, constants.O_RDONLY | constants.O_NOFOLLOW);
        } catch (err) {
          if (err.code === 'ELOOP') {
            errors.push(
              `plugins/${name}/skills/${skillName}/references/${entry.name}: symlinked reference files are not allowed`
            );
          } else {
            errors.push(
              `plugins/${name}/skills/${skillName}/references/${entry.name}: ${err.message}`
            );
          }
          refEntryBad = true;
          continue;
        }
        let refRaw;
        try {
          refRaw = readFileSync(refFd, 'utf8');
        } catch (err) {
          errors.push(
            `plugins/${name}/skills/${skillName}/references/${entry.name}: ${err.message}`
          );
          refEntryBad = true;
          continue;
        } finally {
          closeSync(refFd);
        }
        referenceTargets.push({
          path: join(
            rootDir,
            'plugins',
            name,
            skillsPath,
            skillName,
            'references',
            entry.name
          ),
          bytes: refRaw,
        });
      }
      if (refEntryBad) {
        continue;
      }
    }

    let fd;
    try {
      fd = openSync(skillFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (err) {
      if (err.code === 'ENOENT') {
        errors.push(
          `plugins/${name}/skills/${skillName}/SKILL.md: not found (declared in cursor.skillAllowlist)`
        );
      } else if (err.code === 'ELOOP') {
        errors.push(
          `plugins/${name}/skills/${skillName}/SKILL.md: symlinked skill files are not allowed`
        );
      } else {
        errors.push(
          `plugins/${name}/skills/${skillName}/SKILL.md: ${err.message}`
        );
      }
      continue;
    }
    let raw;
    try {
      raw = readFileSync(fd, 'utf8');
    } catch (err) {
      errors.push(
        `plugins/${name}/skills/${skillName}/SKILL.md: ${err.message}`
      );
      continue;
    } finally {
      closeSync(fd);
    }

    const match = raw.match(FRONTMATTER_RE);
    if (!match) {
      errors.push(
        `plugins/${name}/skills/${skillName}/SKILL.md: missing frontmatter block`
      );
      continue;
    }
    let parsed;
    try {
      parsed = YAML.parse(match[1]);
    } catch (err) {
      errors.push(
        `plugins/${name}/skills/${skillName}/SKILL.md: malformed frontmatter YAML: ${err.message}`
      );
      continue;
    }
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      typeof parsed.name !== 'string' ||
      typeof parsed.description !== 'string'
    ) {
      errors.push(
        `plugins/${name}/skills/${skillName}/SKILL.md: frontmatter must have string "name" and "description"`
      );
      continue;
    }
    if (parsed.name !== skillName) {
      errors.push(
        `plugins/${name}/skills/${skillName}/SKILL.md: frontmatter "name" ("${parsed.name}") must match the allowlisted directory name ("${skillName}")`
      );
      continue;
    }
    const body = raw.slice(match[0].length);
    const normalizedFrontmatter = YAML.stringify(
      { name: parsed.name, description: parsed.description },
      null,
      { lineWidth: 0, blockQuote: false }
    ).trimEnd();
    const normalized = `---\n${normalizedFrontmatter}\n---\n${body}`;

    const targetPath = join(
      rootDir,
      'plugins',
      name,
      skillsPath,
      skillName,
      'SKILL.md'
    );
    targets.push({ path: targetPath, bytes: normalized });
    targets.push(...referenceTargets);
  }

  if (errors.length > 0) {
    return { status: 'error', errors };
  }
  return { status: 'ok', targets };
}

module.exports = {
  isCursorEnabled,
  buildCursorMarketplace,
  buildCursorPluginManifest,
  buildCursorSkillTree,
  REF_FILE_RE,
};
