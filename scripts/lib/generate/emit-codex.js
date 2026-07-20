'use strict';

/**
 * Builders for the Codex distribution target (R5, R6, R7, R20).
 *
 * `isCodexEnabled`, `buildCodexMarketplace`, and `buildCodexPluginManifest`
 * are pure — no I/O, no timestamps, no environment-dependent content —
 * mirroring emit-claude.js's shape so the byte-identity/`--check` contract
 * extends uniformly to the Codex target. `buildCodexSkillTree` is NOT pure:
 * unlike a single-object transform, it must enumerate and read N skill
 * files from disk to normalize them, so — like catalog-reader.js — it does
 * controlled, symlink-rejecting reads and returns a discriminated-union
 * result the caller batches into the same `targets.push({path, bytes})`
 * pipeline as every other generated file.
 *
 * Generator hook-authority rule (R20): this module is the ONLY producer of
 * `hooks/codex-hooks.json`. emit-claude.js has no code path that reads any
 * `hooks/hooks.json` reference-only mirror (yellow-ci's documented
 * pattern) — Claude's hook config comes solely from `source.hooks` inline
 * in the generated plugin.json, unchanged by this module's existence.
 */

const { readFileSync, openSync, closeSync, constants, realpathSync, readdirSync, lstatSync } = require('fs');
const { join } = require('path');

const { assertWithinRoot, NAME_RE } = require('./write');

// Duplicated from scripts/validate-agent-authoring.js's extractFrontmatter
// (not imported — that file has no module.exports) for the same reason:
// match Claude Code's own frontmatter parsing, not a hand-rolled
// approximation. Keep in sync if the source regex changes.
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Single source of truth for Codex-target membership — the twin to
 * emit-claude.js's isClaudeEnabled.
 */
function isCodexEnabled(source) {
  return Boolean(source.targets) && Boolean(source.targets.codex) && source.targets.codex.enabled === true;
}

/**
 * Build the `.agents/plugins/marketplace.json` object. Entry order is the
 * catalog's canonical `pluginOrder`, filtered to Codex-enabled plugins.
 * Entries carry no version field (R5, R12) and no timestamps.
 *
 * @param {object} catalog - Parsed catalog/catalog.json.
 * @param {Record<string, object>} sources - name -> catalog plugin source.
 */
function buildCodexMarketplace(catalog, sources) {
  const plugins = [];
  for (const name of catalog.pluginOrder) {
    const source = sources[name];
    if (!isCodexEnabled(source)) {
      continue;
    }
    const codex = source.targets.codex;
    plugins.push({
      name,
      description: codex.description !== undefined ? codex.description : source.description,
      category: catalog.targets.codex.category,
      source: { source: 'local', path: `./plugins/${name}` },
      policy: catalog.targets.codex.policy,
    });
  }
  return {
    name: catalog.name,
    interface: { displayName: catalog.targets.codex.displayName },
    plugins,
  };
}

/**
 * Build one `plugins/<name>/.codex-plugin/plugin.json` object.
 *
 * @param {object} source - Parsed catalog/plugins/<name>.json.
 * @param {{ name: string, version: string }} pkg - The plugin's package.json
 *   (sole authority for name + version, R3).
 * @param {object|null} hookConfig - Result of buildCodexHookConfig(source);
 *   when non-null, the manifest's "hooks" field points at the generated
 *   hooks/codex-hooks.json file (R20).
 */
function buildCodexPluginManifest(source, pkg, hookConfig) {
  const codex = source.targets.codex;
  const manifest = {
    name: pkg.name,
    version: pkg.version,
    interface: {
      displayName: codex.interface.displayName,
      category: codex.interface.category,
    },
    description: codex.description !== undefined ? codex.description : source.description,
  };
  // Only claim a "skills" field when buildCodexSkillTree() will actually
  // copy at least one skill there (R-review: a componentPaths.skills value
  // with an empty/missing skillAllowlist would otherwise point Codex at a
  // skills directory buildCodexSkillTree never writes). Mirrors
  // buildCodexSkillTree's own `(codex && codex.skillAllowlist) || []`
  // allowlist read.
  const skillsPath = codex.componentPaths && codex.componentPaths.skills;
  const hasAllowlistedSkills = Array.isArray(codex.skillAllowlist) && codex.skillAllowlist.length > 0;
  if (skillsPath && hasAllowlistedSkills) {
    manifest.skills = skillsPath;
  }
  if (hookConfig !== null) {
    manifest.hooks = './hooks/codex-hooks.json';
  }
  return manifest;
}

/**
 * Translate a plugin's inline Claude hooks (`source.hooks`) into the
 * generated `hooks/codex-hooks.json` shape. Pure — no I/O.
 *
 * Claude's inline hooks (object keyed by event name, each value an array of
 * { matcher, hooks: [{ type, command, timeout? }] }) are wrapped in a
 * top-level "hooks" key to match the documented Codex hook file shape
 * (confirmed against a live fetch of learn.chatgpt.com/docs/build-plugins,
 * 2026-07-19 — the default hooks/hooks.json file nests its event map under
 * "hooks"). Command strings (e.g. `${CLAUDE_PLUGIN_ROOT}/...`) are copied
 * unmodified — Codex variable-substitution semantics for hook commands are
 * unverified (the spike found hooks currently never execute at all,
 * R20/spike finding d), so there is nothing to test a rewrite against yet.
 *
 * Returns null when the plugin has no hooks — schemas/codex-hooks.schema.json
 * requires the nested "hooks" object to have minProperties: 1, so an empty
 * file would be schema-invalid; the caller must not write a file (or set
 * the manifest's "hooks" pointer) in that case.
 *
 * Also returns null when `targets.codex.includeHooks` is explicitly `false`
 * — a per-plugin opt-out (default unset/true preserves R20's original
 * unconditional-carryover behavior). Exists because R22 requires a
 * skills-only Codex exposure for a plugin (yellow-core) whose Claude side
 * still needs its own hooks; there was previously no way to enable Codex
 * for such a plugin without also exposing them.
 */
function buildCodexHookConfig(source) {
  const codex = source.targets && source.targets.codex;
  if (codex && codex.includeHooks === false) {
    return null;
  }
  const raw = source.hooks;
  if (raw === undefined || raw === null) {
    return null;
  }
  // Claude's schema also permits an array of event-keyed objects
  // (schemas/plugin.schema.json's inlineHooks); normalize to one merged
  // object. No catalog source uses this form today, but the emitter must
  // not silently drop hooks if one starts.
  const entries = Array.isArray(raw) ? raw : [raw];
  const merged = {};
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') {
      continue;
    }
    for (const [event, defs] of Object.entries(entry)) {
      if (!Array.isArray(defs) || defs.length === 0) {
        continue;
      }
      merged[event] = (merged[event] || []).concat(defs);
    }
  }
  return Object.keys(merged).length > 0 ? { hooks: merged } : null;
}

/**
 * Copy the Codex-allowlisted subset of `plugins/<name>/skills/` into
 * `plugins/<name>/<codex.componentPaths.skills>/` (defaulting to
 * `plugins/<name>/codex/skills/` when unset — the same source and default
 * buildCodexPluginManifest uses for the manifest's "skills" field, so the
 * two always agree), normalizing each SKILL.md's frontmatter to `name` +
 * single-line `description` only (Claude-only fields like `user-invokable`
 * stripped). Rejects symlinked skill directories — both skillDir itself
 * (via `lstat`, including an in-plugin symlink like an allowlisted
 * `skills/allowed` pointing at a non-allowlisted `skills/private`) and
 * symlinked ancestors (e.g. a symlinked `skills/` itself, via a realpath
 * comparison against the plugin's own root) — since O_NOFOLLOW on the
 * SKILL.md open only guards that final path component, and path-escaping
 * names (R7, mirrors catalog-reader.js's O_NOFOLLOW pattern).
 *
 * @param {string} rootDir - Repo root.
 * @param {string} name - Plugin name.
 * @param {object} source - Parsed catalog/plugins/<name>.json.
 * @returns {{ status: 'ok', targets: { path: string, bytes: string }[] }
 *          | { status: 'error', errors: string[] }}
 */
function buildCodexSkillTree(rootDir, name, source) {
  // Lazy require: 'yaml' is only needed by this function. Keeping it out of
  // the module's top-level requires means callers that only need
  // isCodexEnabled (e.g. validate-versions.js) don't pull in a third-party
  // dependency — that chain must stay `pnpm install`-free so it can run in
  // CI jobs (fork PR validation) that check out the repo without installing
  // dependencies. Do not hoist this back to the top of the file.
  const YAML = require('yaml');
  const codex = source.targets.codex;
  const allowlist = (codex && codex.skillAllowlist) || [];
  // Same source buildCodexPluginManifest reads for the manifest's "skills"
  // field (R7) — deriving the on-disk output path from it keeps the two in
  // agreement instead of assuming the 'codex/skills' convention.
  const skillsPath = (codex && codex.componentPaths && codex.componentPaths.skills) || './codex/skills';
  // R7 containment: componentPaths.skills is catalog-authored and can carry
  // a path-escaping override (e.g. '../yellow-core/codex/skills'). The
  // generate-manifests.js callers' assertWithinRoot() calls only bound the
  // resulting target paths to the global plugins/ directory, not this
  // specific plugin's — a catalog typo could otherwise silently write into
  // (or, via the stale-artifact sweep, delete from) a sibling plugin's
  // generated Codex artifacts. Bind to this plugin's own directory before
  // any target path is derived from skillsPath.
  const pluginRoot = join(rootDir, 'plugins', name);
  try {
    assertWithinRoot(join(pluginRoot, skillsPath), pluginRoot);
  } catch (_) {
    return {
      status: 'error',
      errors: [`plugins/${name}/targets.codex.componentPaths.skills ("${skillsPath}"): path must stay within the plugin's own directory`],
    };
  }
  // Real (symlink-resolved) plugin root, reused below as the containment
  // boundary for every allowlisted skill — pluginRoot itself is a real,
  // already-committed plugins/<name> directory (its package.json was read
  // to get this far), so no symlink risk here; only descendants under it
  // (skills/, <skillName>/) are catalog/filesystem-authored and need
  // checking.
  const pluginRootReal = realpathSync(pluginRoot);
  const errors = [];
  const targets = [];

  for (const skillName of allowlist) {
    if (!NAME_RE.test(skillName)) {
      errors.push(`plugins/${name}/skills/${skillName}: skill name fails the [a-zA-Z0-9_-] allowlist`);
      continue;
    }
    const skillDir = join(rootDir, 'plugins', name, 'skills', skillName);
    const skillFile = join(skillDir, 'SKILL.md');

    // O_NOFOLLOW on the openSync() below only guards the final path
    // component (SKILL.md itself); a symlinked skillDir — or a symlinked
    // ANCESTOR, e.g. plugins/<name>/skills/ itself being a symlink out of
    // the repo — would still be followed when the OS resolves the
    // intermediate path components, since O_NOFOLLOW and a plain
    // lstat(skillDir) both only ever inspect the final path segment. The
    // lstat check below rejects skillDir itself being a symlink outright,
    // including an IN-PLUGIN symlink (e.g. an allowlisted
    // skills/allowed -> skills/private) — the realpath containment check
    // that follows would otherwise miss that case, since the resolved
    // target still lands inside pluginRootReal. The realpath check stays as
    // a secondary defense for a symlinked ancestor above skillDir (e.g. a
    // symlinked skills/ itself), which lstat(skillDir) alone can't see — but
    // a prefix/containment comparison against pluginRootReal is not enough:
    // an in-plugin ancestor symlink (e.g. plugins/<name>/skills itself
    // pointing at ANOTHER directory still inside the same plugin root, such
    // as plugins/<name>/skills -> plugins/<name>/other) resolves to a path
    // that still starts with pluginRootReal, silently bypassing the
    // allowlist (R-review). The canonical location of an allowlisted skill
    // is always exactly pluginRootReal/skills/<skillName>, so compare
    // against that literal expected path instead of a prefix — this rejects
    // ANY symlink anywhere on skillDir's path (leaf or ancestor, in-plugin
    // or external).
    try {
      if (lstatSync(skillDir).isSymbolicLink()) {
        errors.push(`plugins/${name}/skills/${skillName}: symlinked skill directories (including a symlinked ancestor such as skills/) are not allowed`);
        continue;
      }
      const skillDirReal = realpathSync(skillDir);
      const skillDirExpected = join(pluginRootReal, 'skills', skillName);
      if (skillDirReal !== skillDirExpected) {
        errors.push(`plugins/${name}/skills/${skillName}: symlinked skill directories (including a symlinked ancestor such as skills/) are not allowed`);
        continue;
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        errors.push(`plugins/${name}/skills/${skillName}: ${err.message}`);
        continue;
      }
      // Missing entirely — fall through to the open below, which reports
      // the same "not found" error for consistency.
    }

    // Only SKILL.md is copied below — there is no reference-file copy step
    // yet. A skill with sidecar files (e.g. references/*.md, a top-level
    // schema.yaml) would ship broken if its SKILL.md instructs the model to
    // read them, so reject rather than silently drop them. Copying instead
    // would also require extending generate-manifests.js's stale-artifact
    // sweep (which currently only tracks <skillName>/SKILL.md) to recurse
    // into sidecar paths, which is out of scope here.
    let sidecarEntries;
    try {
      sidecarEntries = readdirSync(skillDir).filter((entry) => entry !== 'SKILL.md');
    } catch (_) {
      sidecarEntries = []; // missing entirely; the SKILL.md open below reports it
    }
    if (sidecarEntries.length > 0) {
      errors.push(`plugins/${name}/skills/${skillName}: has sidecar file(s) not yet supported for Codex (${sidecarEntries.join(', ')}) — only SKILL.md is copied`);
      continue;
    }

    let fd;
    try {
      fd = openSync(skillFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (err) {
      if (err.code === 'ENOENT') {
        errors.push(`plugins/${name}/skills/${skillName}/SKILL.md: not found (declared in codex.skillAllowlist)`);
      } else if (err.code === 'ELOOP') {
        errors.push(`plugins/${name}/skills/${skillName}/SKILL.md: symlinked skill files are not allowed`);
      } else {
        errors.push(`plugins/${name}/skills/${skillName}/SKILL.md: ${err.message}`);
      }
      continue;
    }
    let raw;
    try {
      raw = readFileSync(fd, 'utf8');
    } catch (err) {
      errors.push(`plugins/${name}/skills/${skillName}/SKILL.md: ${err.message}`);
      continue;
    } finally {
      closeSync(fd);
    }

    const match = raw.match(FRONTMATTER_RE);
    if (!match) {
      errors.push(`plugins/${name}/skills/${skillName}/SKILL.md: missing frontmatter block`);
      continue;
    }
    let parsed;
    try {
      parsed = YAML.parse(match[1]);
    } catch (err) {
      errors.push(`plugins/${name}/skills/${skillName}/SKILL.md: malformed frontmatter YAML: ${err.message}`);
      continue;
    }
    if (parsed === null || typeof parsed !== 'object' || typeof parsed.name !== 'string' || typeof parsed.description !== 'string') {
      errors.push(`plugins/${name}/skills/${skillName}/SKILL.md: frontmatter must have string "name" and "description"`);
      continue;
    }
    // The allowlist and the stale-artifact sweep both reason about the
    // directory name (skillName), not the frontmatter's runtime identifier
    // (parsed.name) — the existing skill authoring pass never compares the
    // two. Left unchecked, a catalog typo or rename could expose a
    // differently-named skill under an allowlisted directory, so reject
    // rather than silently emit a name that disagrees with the allowlist.
    if (parsed.name !== skillName) {
      errors.push(`plugins/${name}/skills/${skillName}/SKILL.md: frontmatter "name" ("${parsed.name}") must match the allowlisted directory name ("${skillName}")`);
      continue;
    }
    // `body` retains its own leading blank line (the regex match ends right
    // after the closing "---\n"), so no extra "\n" is inserted here.
    const body = raw.slice(match[0].length);
    // lineWidth: 0 + blockQuote: false keep the frontmatter's `description`
    // on one line — YAML.stringify's default 80-col fold (and its
    // newline-triggered block-scalar fallback) would otherwise silently
    // violate the single-line `description:` requirement the Claude Code
    // frontmatter parser expects (see FRONTMATTER_RE's comment above).
    const normalizedFrontmatter = YAML.stringify(
      { name: parsed.name, description: parsed.description },
      null,
      { lineWidth: 0, blockQuote: false }
    ).trimEnd();
    const normalized = `---\n${normalizedFrontmatter}\n---\n${body}`;

    const targetPath = join(rootDir, 'plugins', name, skillsPath, skillName, 'SKILL.md');
    targets.push({ path: targetPath, bytes: normalized });
  }

  if (errors.length > 0) {
    return { status: 'error', errors };
  }
  return { status: 'ok', targets };
}

module.exports = {
  isCodexEnabled,
  buildCodexMarketplace,
  buildCodexPluginManifest,
  buildCodexHookConfig,
  buildCodexSkillTree,
};
