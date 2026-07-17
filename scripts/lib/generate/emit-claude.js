'use strict';

/**
 * Pure builders for the Claude distribution target (R4, R8).
 *
 * No I/O, no timestamps, no environment-dependent content — the output is a
 * deterministic function of (catalog sources, package.json versions), which
 * is what makes the byte-identity contract and `--check` mode possible.
 *
 * Key order is the canonical order observed across all committed manifests:
 *   $schema, name, version, description, author, homepage, repository,
 *   license, keywords, [outputStyles], [userConfig], [mcpServers], [hooks],
 *   [dependencies]
 * Optional fields are omitted (not emitted as null/empty) when absent from
 * the catalog source.
 */

// Optional component fields in canonical emission order.
const OPTIONAL_MANIFEST_KEYS = [
  'outputStyles',
  'userConfig',
  'mcpServers',
  'hooks',
  'dependencies',
];

/**
 * Single source of truth for Claude-target membership — used by both the
 * per-plugin manifest loop in generate-manifests.js and buildMarketplace
 * below so the two lists can never diverge.
 */
function isClaudeEnabled(source) {
  return Boolean(source.targets) && source.targets.claude === true;
}

/**
 * Build one `plugins/<name>/.claude-plugin/plugin.json` object.
 *
 * @param {object} source - Parsed catalog/plugins/<name>.json.
 * @param {{ name: string, version: string }} pkg - The plugin's package.json
 *   (sole authority for name + version, R3).
 */
function buildPluginManifest(source, pkg) {
  const manifest = {
    $schema: source.$schema,
    name: pkg.name,
    version: pkg.version,
    description: source.description,
    author: source.author,
    homepage: source.homepage,
    repository: source.repository,
    license: source.license,
    keywords: source.keywords,
  };
  for (const key of OPTIONAL_MANIFEST_KEYS) {
    if (key in source) {
      manifest[key] = source[key];
    }
  }
  return manifest;
}

/**
 * Build the `.claude-plugin/marketplace.json` object. Entry order is the
 * catalog's canonical `pluginOrder`, filtered to Claude-enabled plugins.
 *
 * @param {object} catalog - Parsed catalog/catalog.json.
 * @param {Record<string, object>} sources - name → catalog plugin source.
 * @param {Record<string, { name: string, version: string }>} pkgs - name →
 *   plugin package.json.
 */
function buildMarketplace(catalog, sources, pkgs) {
  const plugins = [];
  for (const name of catalog.pluginOrder) {
    const source = sources[name];
    if (!isClaudeEnabled(source)) {
      continue;
    }
    plugins.push({
      name,
      description:
        source.marketplace.description !== undefined
          ? source.marketplace.description
          : source.description,
      version: pkgs[name].version,
      author: { name: source.author.name },
      source: source.marketplace.source,
      category: source.marketplace.category,
    });
  }
  return {
    $schema: catalog.targets.claude.marketplaceSchema,
    name: catalog.name,
    description: catalog.description,
    owner: catalog.owner,
    metadata: catalog.metadata,
    plugins,
  };
}

module.exports = { buildPluginManifest, buildMarketplace, isClaudeEnabled };
