#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PLUGINS_DIR = path.join(ROOT, 'plugins');

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
};

function walk(dir, predicate = () => true) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(fullPath, predicate));
      continue;
    }
    if (predicate(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

function extractFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  return match ? match[1] : null;
}

function parseScalar(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  if (!match) return null;
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}

function parseList(frontmatter, key) {
  // Try inline flow form first: key: [item1, item2]
  const inlineMatch = frontmatter.match(
    new RegExp(`^${key}:\\s*\\[([^\\]]+)\\]`, 'm')
  );
  if (inlineMatch) {
    return inlineMatch[1]
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }

  const lines = frontmatter.split('\n');
  const values = [];
  let inList = false;

  for (const line of lines) {
    if (!inList) {
      if (new RegExp(`^${key}:\\s*$`).test(line)) {
        inList = true;
      }
      continue;
    }

    const item = line.match(/^\s*-\s+(.+?)\s*$/);
    if (item) {
      values.push(item[1].replace(/^['"]|['"]$/g, ''));
      continue;
    }

    if (line.trim() === '') {
      continue;
    }

    if (!line.startsWith(' ')) {
      break;
    }
  }

  return values;
}

function relative(filePath) {
  return path.relative(ROOT, filePath) || '.';
}

function logInfo(message) {
  console.log(`${colors.blue}ℹ INFO:${colors.reset} ${message}`);
}

function logError(message) {
  console.error(`${colors.red}✗ ERROR:${colors.reset} ${message}`);
}

function logSuccess(message) {
  console.log(`${colors.green}✓ PASS:${colors.reset} ${message}`);
}

const pluginNames = new Set(
  fs
    .readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
);

const agentFiles = walk(
  PLUGINS_DIR,
  (filePath) =>
    filePath.includes(`${path.sep}agents${path.sep}`) &&
    filePath.endsWith('.md')
);
const markdownFiles = walk(PLUGINS_DIR, (filePath) => filePath.endsWith('.md'));
const commandFiles = walk(
  PLUGINS_DIR,
  (filePath) =>
    filePath.includes(`${path.sep}commands${path.sep}`) &&
    filePath.endsWith('.md')
);

logInfo(`Validating ${agentFiles.length} agents and ${markdownFiles.length} markdown files...`);

const errors = [];
const pluginAgents = new Set();
const skillReferencePattern = /`([a-z0-9][a-z0-9-]*)`\s+skill\b/gi;
const pluginSubagentPattern =
  /subagent_type\s*(?:=|:)\s*"?([a-z0-9-]+:[a-z0-9-]+(?::[a-z0-9-]+)?)"?/gi;

for (const filePath of agentFiles) {
  const content = fs.readFileSync(filePath, 'utf8');
  const frontmatter = extractFrontmatter(content);

  if (!frontmatter) {
    errors.push(`${relative(filePath)}: missing frontmatter`);
    continue;
  }

  const name = parseScalar(frontmatter, 'name');
  if (!name) {
    errors.push(`${relative(filePath)}: missing agent name`);
  } else {
    const segments = filePath.split(path.sep);
    const pluginName = segments[segments.indexOf('plugins') + 1];
    pluginAgents.add(`${pluginName}:${name}`);
  }

  const hasAllowedTools = /^allowed-tools:/m.test(frontmatter);
  if (hasAllowedTools) {
    errors.push(`${relative(filePath)}: use "tools:" instead of "allowed-tools:"`);
  }

  if (!hasAllowedTools) {
    const tools = parseList(frontmatter, 'tools');
    if (tools.length === 0) {
      errors.push(`${relative(filePath)}: missing or empty "tools:" list`);
    }
  }

  if (!hasAllowedTools) {
    const tools = parseList(frontmatter, 'tools');
    const skills = new Set(parseList(frontmatter, 'skills'));
    const referencedSkills = new Set();
    for (const match of content.matchAll(skillReferencePattern)) {
      referencedSkills.add(match[1].toLowerCase());
    }

    if (referencedSkills.size > 0) {
      const hasSkillTool = tools.includes('Skill');
      for (const skill of referencedSkills) {
        if (!skills.has(skill) && !hasSkillTool) {
          errors.push(
            `${relative(filePath)}: references skill "${skill}" without frontmatter "skills:" preload or Skill tool access`
          );
        }
      }
    }
  }
}

for (const filePath of markdownFiles) {
  const content = fs.readFileSync(filePath, 'utf8');
  for (const match of content.matchAll(pluginSubagentPattern)) {
    const subagentType = match[1];
    const pluginName = subagentType.split(':', 1)[0];
    if (!pluginNames.has(pluginName)) {
      continue;
    }
    if (!pluginAgents.has(subagentType)) {
      errors.push(
        `${relative(filePath)}: subagent_type "${subagentType}" does not match any declared plugin agent`
      );
    }
  }
}

for (const filePath of commandFiles) {
  const content = fs.readFileSync(filePath, 'utf8');
  const frontmatter = extractFrontmatter(content);
  const codeBlocks = content.match(/```[^\n]*\n[\s\S]*?```/g) || [];
  const codeContent = (frontmatter || '') + '\n' + codeBlocks.join('\n');
  if (codeContent.includes('BASH_SOURCE')) {
    errors.push(
      `${relative(filePath)}: markdown command sources plugin files via BASH_SOURCE; use \${CLAUDE_PLUGIN_ROOT} or a real script path`
    );
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    logError(error);
  }
  process.exit(1);
}

logSuccess(
  `Validated ${agentFiles.length} agents and ${markdownFiles.length} markdown files`
);
