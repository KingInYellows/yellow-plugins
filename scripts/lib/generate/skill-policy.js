'use strict';

const {
  lstatSync,
  realpathSync,
  readdirSync,
  openSync,
  readFileSync,
  closeSync,
  constants,
} = require('fs');
const { join } = require('path');

// Deliberately support only the invocation policy needed by this marketplace.
// Appearance assets and tool dependency sidecars need their own packaging gate.
function validateSkillPolicy(raw) {
  const YAML = require('yaml');
  const doc = YAML.parseDocument(raw, { uniqueKeys: true });
  if (doc.errors.length || doc.warnings.length)
    throw new Error('Invalid skill policy YAML');
  const value = doc.toJS({ maxAliasCount: 0 });
  if (
    !value ||
    Array.isArray(value) ||
    Object.keys(value).join(',') !== 'policy' ||
    !value.policy ||
    Array.isArray(value.policy) ||
    Object.keys(value.policy).join(',') !== 'allow_implicit_invocation' ||
    typeof value.policy.allow_implicit_invocation !== 'boolean'
  ) {
    throw new Error(
      'Only policy.allow_implicit_invocation (boolean) is supported'
    );
  }
  return value;
}

function readSkillPolicy(skillDir, { allowEmpty = false } = {}) {
  const agents = join(skillDir, 'agents');
  let stat;
  try {
    stat = lstatSync(agents);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    realpathSync(agents) !== join(realpathSync(skillDir), 'agents')
  ) {
    throw new Error('Symlinked or non-directory agents resource is forbidden');
  }
  const entries = readdirSync(agents, { withFileTypes: true });
  if (allowEmpty && entries.length === 0) return null;
  if (
    entries.length !== 1 ||
    entries[0].name !== 'openai.yaml' ||
    !entries[0].isFile()
  ) {
    throw new Error('Only regular agents/openai.yaml is supported');
  }
  const file = join(agents, 'openai.yaml');
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let raw;
  try {
    raw = readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
  validateSkillPolicy(raw);
  return { path: file, bytes: raw };
}

function validatePublicMcp(servers) {
  if (
    !servers ||
    Array.isArray(servers) ||
    typeof servers !== 'object' ||
    !Object.keys(servers).length
  )
    throw new Error(
      'Codex MCP override must be a non-empty public HTTP server map'
    );
  for (const [name, server] of Object.entries(servers)) {
    if (
      !/^[a-z][a-z0-9_-]*$/.test(name) ||
      !server ||
      Array.isArray(server) ||
      Object.keys(server).some(
        (key) => !['url', 'enabled_tools'].includes(key)
      ) ||
      typeof server.url !== 'string'
    )
      throw new Error(
        'Codex HTTP servers support only a name and url; credentials/headers/env are excluded'
      );
    if (
      server.enabled_tools !== undefined &&
      (!Array.isArray(server.enabled_tools) ||
        !server.enabled_tools.length ||
        new Set(server.enabled_tools).size !== server.enabled_tools.length ||
        !server.enabled_tools.every((tool) =>
          [
            'ask_wiki_question',
            'ask_question',
            'read_wiki_structure',
            'read_wiki_contents',
          ].includes(tool)
        ))
    ) {
      throw new Error(
        'Only selected public DeepWiki read operations may be enabled'
      );
    }
    const url = new URL(server.url);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      [...server.url].some((char) => char.charCodeAt(0) <= 32) ||
      server.url.includes('$')
    )
      throw new Error(
        'Codex public MCP URL must be HTTPS without credentials, query, fragment or substitution'
      );
  }
  return servers;
}

module.exports = { validateSkillPolicy, readSkillPolicy, validatePublicMcp };
