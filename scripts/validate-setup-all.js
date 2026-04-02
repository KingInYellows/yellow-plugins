#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MARKETPLACE_PATH = path.join(ROOT, '.claude-plugin', 'marketplace.json');
const SETUP_ALL_PATH = path.join(
  ROOT,
  'plugins',
  'yellow-core',
  'commands',
  'setup',
  'all.md'
);
const PLUGINS_DIR = path.join(ROOT, 'plugins');

const COMMAND_PLUGIN_MAP = {
  'gt-setup': 'gt-workflow',
  'ruvector:setup': 'yellow-ruvector',
  'morph:setup': 'yellow-morph',
  'devin:setup': 'yellow-devin',
  'semgrep:setup': 'yellow-semgrep',
  'research:setup': 'yellow-research',
  'linear:setup': 'yellow-linear',
  'chatprd:setup': 'yellow-chatprd',
  'debt:setup': 'yellow-debt',
  'ci:setup': 'yellow-ci',
  'review:setup': 'yellow-review',
  'browser-test:setup': 'yellow-browser-test',
  'docs:setup': 'yellow-docs',
  'composio:setup': 'yellow-composio',
  'codex:setup': 'yellow-codex',
  'statusline:setup': 'yellow-core',
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function walk(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(fullPath));
      continue;
    }
    results.push(fullPath);
  }
  return results;
}

function parseFrontmatterName(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
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

function parseDashboardPlugins(section) {
  const match = section.match(/for p in\s+([\s\S]*?)\s*;\s*do/);
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
  const mapping = {};
  for (const match of section.matchAll(/^- `([^`]+)` → `([^`]+)`$/gm)) {
    const plugin = match[1];
    const command = match[2];
    mapping[command] = plugin;
  }
  return mapping;
}

function compareMappings(actual, expected) {
  const actualKeys = Object.keys(actual);
  const expectedKeys = Object.keys(expected);
  const missing = expectedKeys.filter((key) => !(key in actual));
  const extra = actualKeys.filter((key) => !(key in expected));
  const mismatched = expectedKeys
    .filter((key) => key in actual && actual[key] !== expected[key])
    .map((key) => `${key}=>${actual[key]} (expected ${expected[key]})`);
  return { missing, extra, mismatched };
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
  try {
    marketplace = readJson(MARKETPLACE_PATH);
    setupAll = readText(SETUP_ALL_PATH);
  } catch (error) {
    console.error(
      `[validate-setup-all] Failed to read required file: ${error.message}`
    );
    console.error('  Ensure this script is run from the repository root.');
    process.exit(1);
  }

  return {
    marketplacePlugins: marketplace.plugins.map((plugin) => plugin.name),
    setupAll,
  };
}

function extractRequiredSections(setupAll) {
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
  };

  if (!sections.dashboardSection) {
    errors.push('missing dashboard plugin loop markers in setup:all');
  }
  if (!sections.classificationSection) {
    errors.push('missing classification markers in setup:all');
  }
  if (!sections.delegatedSection) {
    errors.push('missing delegated command markers in setup:all');
  }
  if (!sections.mappingSection) {
    errors.push('missing plugin-command mapping markers in setup:all');
  }

  if (errors.length > 0) {
    exitWithErrors(errors);
  }

  return sections;
}

function parseSetupAllData(sections) {
  const delegatedCommands = parseDelegatedCommands(sections.delegatedSection);
  return {
    dashboardPlugins: parseDashboardPlugins(sections.dashboardSection),
    classificationPlugins: parseClassificationPlugins(
      sections.classificationSection
    ),
    delegatedCommands,
    delegatedPlugins: delegatedCommands.map(
      (command) => COMMAND_PLUGIN_MAP[command]
    ),
    markdownMapping: parsePluginCommandMap(sections.mappingSection),
  };
}

function loadCommandNames() {
  const commandNames = new Set();
  for (const filePath of walk(PLUGINS_DIR)) {
    if (
      !filePath.endsWith('.md') ||
      !filePath.includes(`${path.sep}commands${path.sep}`)
    ) {
      continue;
    }
    const name = parseFrontmatterName(readText(filePath));
    if (name) {
      commandNames.add(name);
    }
  }
  return commandNames;
}

function validateCoverage(data, marketplacePlugins, errors) {
  const dashboardDiff = compareSets(data.dashboardPlugins, marketplacePlugins);
  if (dashboardDiff.missing.length || dashboardDiff.extra.length) {
    errors.push(
      `dashboard plugin coverage drift: missing=[${dashboardDiff.missing.join(', ')}] extra=[${dashboardDiff.extra.join(', ')}]`
    );
  }

  const classificationDiff = compareSets(
    data.classificationPlugins,
    marketplacePlugins
  );
  if (classificationDiff.missing.length || classificationDiff.extra.length) {
    errors.push(
      `classification coverage drift: missing=[${classificationDiff.missing.join(', ')}] extra=[${classificationDiff.extra.join(', ')}]`
    );
  }

  const delegatedDiff = compareSets(
    data.delegatedPlugins.filter(Boolean),
    marketplacePlugins
  );
  if (delegatedDiff.missing.length || delegatedDiff.extra.length) {
    errors.push(
      `delegated setup coverage drift: missing=[${delegatedDiff.missing.join(', ')}] extra=[${delegatedDiff.extra.join(', ')}]`
    );
  }
}

function validateDelegation(data, commandNames, errors) {
  const unknownCommands = data.delegatedCommands.filter(
    (command) => !(command in COMMAND_PLUGIN_MAP)
  );
  if (unknownCommands.length > 0) {
    errors.push(
      `delegated commands missing plugin mapping: ${unknownCommands.join(', ')}`
    );
  }

  const missingCommandFiles = data.delegatedCommands.filter(
    (command) => !commandNames.has(command)
  );
  if (missingCommandFiles.length > 0) {
    errors.push(
      `delegated commands missing command file: ${missingCommandFiles.join(', ')}`
    );
  }

  const mappingDiff = compareMappings(data.markdownMapping, COMMAND_PLUGIN_MAP);
  if (
    mappingDiff.missing.length ||
    mappingDiff.extra.length ||
    mappingDiff.mismatched.length
  ) {
    errors.push(
      `plugin-command mapping drift: missing=[${mappingDiff.missing.join(', ')}] extra=[${mappingDiff.extra.join(', ')}] mismatched=[${mappingDiff.mismatched.join(', ')}]`
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
      `dashboard order does not match delegated setup order: dashboard=[${data.dashboardPlugins.join(', ')}] delegated=[${data.delegatedPlugins.join(', ')}]`
    );
  }
}

function main() {
  const { marketplacePlugins, setupAll } = loadInputs();
  const sections = extractRequiredSections(setupAll);
  const data = parseSetupAllData(sections);
  const commandNames = loadCommandNames();
  const errors = [];

  validateCoverage(data, marketplacePlugins, errors);
  validateDelegation(data, commandNames, errors);
  validateOrder(data, errors);

  if (errors.length > 0) {
    exitWithErrors(errors);
  }

  console.log(
    `[validate-setup-all] OK: ${marketplacePlugins.length} marketplace plugins covered by dashboard, classification, and delegated setup order`
  );
}

main();
