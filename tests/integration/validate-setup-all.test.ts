/**
 * Integration tests for `scripts/validate-setup-all.js`.
 *
 * Mirrors the fixture-tmpdir pattern of
 * `tests/integration/validate-solutions.test.ts`: each test builds a
 * synthetic marketplace + setup:all command + references file + plugins tree
 * under `os.tmpdir()` and points the script at it via the
 * `VALIDATE_SETUP_ALL_*` env overrides.
 *
 * The drift cases mirror real incidents: the orphaned ToolSearch probe left
 * by the yellow-chatprd removal (PR #580) and the yellow-council row missing
 * from the illustrative dashboard example (PR #328).
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const SCRIPT = resolve(
  __dirname,
  '..',
  '..',
  'scripts',
  'validate-setup-all.js'
);

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

interface FixturePaths {
  root: string;
  marketplacePath: string;
  commandPath: string;
  referencesPath: string;
  pluginsDir: string;
}

const DEFAULT_SETUP_ALL = `# Setup All fixture

# setup-all-dashboard-plugin-loop:start
for p in alpha beta; do
  echo "$p"
done
# setup-all-dashboard-plugin-loop:end

<!-- setup-all-toolsearch-probes:start -->
Run two ToolSearch probes to capture current-session MCP visibility:

- \`alpha_tool\`
- \`beta_tool\`

Record whether these exact tools are present in the results:

- \`mcp__plugin_alpha_serverone__alpha_tool\`
- \`mcp__plugin_beta_servertwo__beta_tool\`
<!-- setup-all-toolsearch-probes:end -->

<!-- setup-all-classification:start -->
**alpha:**

- READY: yes

**beta:**

- READY: yes
<!-- setup-all-classification:end -->

<!-- setup-all-dashboard-example:start -->
\`\`\`text
  Plugin               Status          Detail
  -------------------  -----------     ------
  alpha                READY           fine
  beta                 NEEDS SETUP     thing missing
\`\`\`
<!-- setup-all-dashboard-example:end -->

<!-- setup-all-delegated-commands:start -->
1. \`alpha:setup\`
2. \`beta-setup\`
<!-- setup-all-delegated-commands:end -->

<!-- setup-all-plugin-command-map:start -->
- \`alpha\` → \`alpha:setup\`
- \`beta\` → \`beta-setup\`
<!-- setup-all-plugin-command-map:end -->
`;

const DEFAULT_REFERENCES = `# Reference fixture

\`\`\`bash
# setup-all-credential-status-plugins:start
for plugin in alpha; do
  echo "$plugin"
done
# setup-all-credential-status-plugins:end
\`\`\`
`;

function buildFixture(root: string): FixturePaths {
  const pluginsDir = join(root, 'plugins');
  const marketplacePath = join(root, 'marketplace.json');
  const commandPath = join(root, 'all.md');
  const referencesPath = join(root, 'references.md');

  writeFileSync(
    marketplacePath,
    JSON.stringify({ plugins: [{ name: 'alpha' }, { name: 'beta' }] }),
    'utf8'
  );
  writeFileSync(commandPath, DEFAULT_SETUP_ALL, 'utf8');
  writeFileSync(referencesPath, DEFAULT_REFERENCES, 'utf8');

  mkdirSync(join(pluginsDir, 'alpha', '.claude-plugin'), { recursive: true });
  writeFileSync(
    join(pluginsDir, 'alpha', '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'alpha' }),
    'utf8'
  );
  mkdirSync(join(pluginsDir, 'alpha', 'commands', 'alpha'), {
    recursive: true,
  });
  writeFileSync(
    join(pluginsDir, 'alpha', 'commands', 'alpha', 'setup.md'),
    '---\nname: alpha:setup\ndescription: fixture\n---\n\nBody.\n',
    'utf8'
  );
  mkdirSync(join(pluginsDir, 'alpha', 'hooks'), { recursive: true });
  writeFileSync(
    join(pluginsDir, 'alpha', 'hooks', 'write-credential-status.sh'),
    '#!/bin/sh\necho credential-status\n',
    'utf8'
  );

  mkdirSync(join(pluginsDir, 'beta', 'commands'), { recursive: true });
  writeFileSync(
    join(pluginsDir, 'beta', 'commands', 'beta-setup.md'),
    '---\nname: beta-setup\ndescription: fixture\n---\n\nBody.\n',
    'utf8'
  );

  return { root, marketplacePath, commandPath, referencesPath, pluginsDir };
}

function runValidator(fixture: FixturePaths): RunResult {
  const result = spawnSync('node', [SCRIPT], {
    env: {
      ...process.env,
      VALIDATE_SETUP_ALL_MARKETPLACE_PATH: fixture.marketplacePath,
      VALIDATE_SETUP_ALL_COMMAND_PATH: fixture.commandPath,
      VALIDATE_SETUP_ALL_REFERENCES_PATH: fixture.referencesPath,
      VALIDATE_SETUP_ALL_PLUGINS_DIR: fixture.pluginsDir,
    },
    encoding: 'utf8',
  });
  if (result.error) {
    // Spawn-level infra failure (e.g. ENOENT) — fail fast with the real
    // cause instead of a confusing empty-stderr assertion failure.
    throw result.error;
  }
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

// Codes assembled the same way the script does, so this file also contains
// no literal catalog codes.
const SETUP = 'ERROR-' + 'SETUP';

// String.prototype.replace silently no-ops on a missing target; a fixture
// mutation that stops matching after a template edit must fail loudly.
function mutate(source: string, find: string, replaceWith: string): string {
  if (!source.includes(find)) {
    throw new Error(`fixture mutation target not found: ${find}`);
  }
  return source.replace(find, replaceWith);
}

describe('validate-setup-all', () => {
  let root: string;
  let fixture: FixturePaths;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'yellow-vsa-'));
    fixture = buildFixture(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('passes on a consistent fixture', () => {
    const result = runValidator(fixture);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('OK: 2 marketplace plugins');
  });

  it('fails with -001 when a marker section is missing', () => {
    writeFileSync(
      fixture.commandPath,
      mutate(
        mutate(DEFAULT_SETUP_ALL, '<!-- setup-all-toolsearch-probes:start -->', ''),
        '<!-- setup-all-toolsearch-probes:end -->',
        ''
      ),
      'utf8'
    );
    const result = runValidator(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${SETUP}-001`);
    expect(result.stderr).toContain('ToolSearch probe markers');
  });

  it('fails with -002 when a plugin is missing from the dashboard loop', () => {
    writeFileSync(
      fixture.commandPath,
      mutate(DEFAULT_SETUP_ALL, 'for p in alpha beta; do', 'for p in alpha; do'),
      'utf8'
    );
    const result = runValidator(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${SETUP}-002`);
    expect(result.stderr).toContain('missing=[beta]');
  });

  it('fails with -003 when the map points a command at the wrong plugin', () => {
    writeFileSync(
      fixture.commandPath,
      mutate(DEFAULT_SETUP_ALL, '- `beta` → `beta-setup`', '- `alpha` → `beta-setup`'),
      'utf8'
    );
    const result = runValidator(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${SETUP}-003`);
    expect(result.stderr).toContain('beta-setup maps to alpha');
  });

  it('fails with -003 when a delegated command has no command file', () => {
    writeFileSync(
      fixture.commandPath,
      mutate(
        mutate(DEFAULT_SETUP_ALL, '2. `beta-setup`', '2. `beta-setup`\n3. `gamma:setup`'),
        '- `beta` → `beta-setup`',
        '- `beta` → `beta-setup`\n- `gamma` → `gamma:setup`'
      ),
      'utf8'
    );
    const result = runValidator(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${SETUP}-003`);
    expect(result.stderr).toContain('missing command file: gamma:setup');
  });

  it('fails with -004 when dashboard and delegated order diverge', () => {
    writeFileSync(
      fixture.commandPath,
      mutate(
        DEFAULT_SETUP_ALL,
        '1. `alpha:setup`\n2. `beta-setup`',
        '1. `beta-setup`\n2. `alpha:setup`'
      ),
      'utf8'
    );
    const result = runValidator(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${SETUP}-004`);
  });

  it('fails with -005 on an orphaned probe query bullet (chatprd-removal class)', () => {
    writeFileSync(
      fixture.commandPath,
      mutate(DEFAULT_SETUP_ALL, '- `alpha_tool`', '- `orphaned_tool`\n- `alpha_tool`'),
      'utf8'
    );
    const result = runValidator(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${SETUP}-005`);
    expect(result.stderr).toContain('stated=2 queries=3 recorded=2');
  });

  it('fails with -005 when a recorded tool references an unknown plugin', () => {
    writeFileSync(
      fixture.commandPath,
      mutate(
        DEFAULT_SETUP_ALL,
        '- `mcp__plugin_beta_servertwo__beta_tool`',
        '- `mcp__plugin_gamma_servertwo__beta_tool`'
      ),
      'utf8'
    );
    const result = runValidator(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${SETUP}-005`);
    expect(result.stderr).toContain('mcp__plugin_gamma_servertwo__beta_tool');
  });

  it('fails with -006 when the credential-status list drifts from hooks', () => {
    writeFileSync(
      fixture.referencesPath,
      mutate(DEFAULT_REFERENCES, 'for plugin in alpha; do', 'for plugin in alpha beta; do'),
      'utf8'
    );
    const result = runValidator(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${SETUP}-006`);
    expect(result.stderr).toContain('extra=[beta]');
  });

  it('fails with -007 when the dashboard example omits a plugin (council-row class)', () => {
    writeFileSync(
      fixture.commandPath,
      mutate(DEFAULT_SETUP_ALL, '  beta                 NEEDS SETUP     thing missing\n', ''),
      'utf8'
    );
    const result = runValidator(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${SETUP}-007`);
    expect(result.stderr).toContain('missing=[beta]');
  });

  it('fails cleanly when the references file does not exist', () => {
    rmSync(fixture.referencesPath);
    const result = runValidator(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Failed to read required file');
  });

  it('fails with -002 when a classification heading is missing', () => {
    writeFileSync(
      fixture.commandPath,
      mutate(DEFAULT_SETUP_ALL, '**beta:**\n\n- READY: yes\n', ''),
      'utf8'
    );
    const result = runValidator(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${SETUP}-002`);
    expect(result.stderr).toContain('classification coverage drift: missing=[beta]');
  });

  it('fails with -002 when a plugin is missing from the delegated set', () => {
    writeFileSync(
      fixture.commandPath,
      mutate(
        mutate(DEFAULT_SETUP_ALL, '1. `alpha:setup`\n2. `beta-setup`', '1. `alpha:setup`'),
        '- `alpha` → `alpha:setup`\n- `beta` → `beta-setup`',
        '- `alpha` → `alpha:setup`'
      ),
      'utf8'
    );
    const result = runValidator(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('delegated setup coverage drift: missing=[beta]');
  });

  it('fails with -003 when a delegated command has no map entry', () => {
    writeFileSync(
      fixture.commandPath,
      mutate(DEFAULT_SETUP_ALL, '2. `beta-setup`', '2. `beta-setup`\n3. `gamma:setup`'),
      'utf8'
    );
    const result = runValidator(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${SETUP}-003`);
    expect(result.stderr).toContain('missing from the plugin-command map: gamma:setup');
  });

  it('fails with -003 when a map entry has no delegated command', () => {
    writeFileSync(
      fixture.commandPath,
      mutate(
        DEFAULT_SETUP_ALL,
        '- `beta` → `beta-setup`',
        '- `beta` → `beta-setup`\n- `gamma` → `gamma:setup`'
      ),
      'utf8'
    );
    const result = runValidator(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'plugin-command map entries missing from the delegated command list: gamma:setup'
    );
  });

  it('fails with -005 when the stated probe count is unparsable', () => {
    writeFileSync(
      fixture.commandPath,
      mutate(
        DEFAULT_SETUP_ALL,
        'Run two ToolSearch probes',
        'Run the following ToolSearch probes'
      ),
      'utf8'
    );
    const result = runValidator(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('could not parse the stated probe count');
  });

  it('fails with -005 when classification references an unprobed tool', () => {
    writeFileSync(
      fixture.commandPath,
      mutate(
        DEFAULT_SETUP_ALL,
        '**alpha:**\n\n- READY: yes',
        '**alpha:**\n\n- READY: `mcp__plugin_alpha_serverone__other_tool` is visible'
      ),
      'utf8'
    );
    const result = runValidator(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'classification references a tool name missing from the Step 1.5 recorded probe list'
    );
  });

  it('fails with -006 when a credential-status hook is missing from the list', () => {
    writeFileSync(
      fixture.referencesPath,
      mutate(DEFAULT_REFERENCES, 'for plugin in alpha; do', 'for plugin in ; do'),
      'utf8'
    );
    const result = runValidator(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${SETUP}-006`);
    expect(result.stderr).toContain('missing=[alpha]');
  });

  it('fails with -007 on a stale example row for a removed plugin', () => {
    writeFileSync(
      fixture.commandPath,
      mutate(
        DEFAULT_SETUP_ALL,
        '  beta                 NEEDS SETUP     thing missing',
        '  beta                 NEEDS SETUP     thing missing\n  gamma                READY           stale row'
      ),
      'utf8'
    );
    const result = runValidator(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${SETUP}-007`);
    expect(result.stderr).toContain('extra=[gamma]');
  });

  it('reports multiple drift classes in a single run', () => {
    writeFileSync(
      fixture.commandPath,
      mutate(
        mutate(DEFAULT_SETUP_ALL, 'for p in alpha beta; do', 'for p in alpha; do'),
        '- `alpha_tool`',
        '- `orphaned_tool`\n- `alpha_tool`'
      ),
      'utf8'
    );
    const result = runValidator(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${SETUP}-002`);
    expect(result.stderr).toContain(`${SETUP}-005`);
  });

  it('passes when the command file uses CRLF line endings', () => {
    writeFileSync(fixture.commandPath, DEFAULT_SETUP_ALL.replace(/\n/g, '\r\n'), 'utf8');
    const result = runValidator(fixture);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('parses CRLF frontmatter in command files', () => {
    writeFileSync(
      join(fixture.pluginsDir, 'beta', 'commands', 'beta-setup.md'),
      '---\nname: beta-setup\ndescription: fixture\n---\n\nBody.\n'.replace(/\n/g, '\r\n'),
      'utf8'
    );
    const result = runValidator(fixture);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('ignores command files under node_modules', () => {
    const decoyDir = join(fixture.pluginsDir, 'beta', 'node_modules', 'commands');
    mkdirSync(decoyDir, { recursive: true });
    writeFileSync(
      join(decoyDir, 'decoy.md'),
      '---\nname: alpha:setup\ndescription: decoy\n---\n\nBody.\n',
      'utf8'
    );
    const result = runValidator(fixture);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('fails cleanly when marketplace.json has no plugins array', () => {
    writeFileSync(fixture.marketplacePath, '{}', 'utf8');
    const result = runValidator(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no `plugins` array');
  });

  it('fails with -005 when a query bullet is renamed without changing the count', () => {
    writeFileSync(
      fixture.commandPath,
      mutate(DEFAULT_SETUP_ALL, '- `alpha_tool`', '- `stale_tool`'),
      'utf8'
    );
    const result = runValidator(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'query bullet does not exactly match any recorded tool name suffix (tool or server__tool): stale_tool'
    );
  });

  it('fails with -005 when a duplicated query stands in for a missing one', () => {
    writeFileSync(
      fixture.commandPath,
      mutate(DEFAULT_SETUP_ALL, '- `beta_tool`', '- `alpha_tool`'),
      'utf8'
    );
    const result = runValidator(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('duplicate query bullets in the Step 1.5 probe list: alpha_tool');
    expect(result.stderr).toContain(
      'recorded tool has no corresponding query bullet: mcp__plugin_beta_servertwo__beta_tool'
    );
  });

  it('fails with -005 when a duplicated recorded line masks a missing tool', () => {
    writeFileSync(
      fixture.commandPath,
      mutate(
        mutate(
          DEFAULT_SETUP_ALL,
          '- `mcp__plugin_beta_servertwo__beta_tool`',
          '- `mcp__plugin_alpha_serverone__alpha_tool`'
        ),
        '- `beta_tool`',
        '- `serverone__alpha_tool`'
      ),
      'utf8'
    );
    const result = runValidator(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'duplicate recorded tool names in the Step 1.5 probe list: mcp__plugin_alpha_serverone__alpha_tool'
    );
  });

  it('fails with -005 when a query bullet is a truncated substring of a recorded tool', () => {
    writeFileSync(
      fixture.commandPath,
      mutate(DEFAULT_SETUP_ALL, '- `alpha_tool`', '- `tool`'),
      'utf8'
    );
    const result = runValidator(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'query bullet does not exactly match any recorded tool name suffix (tool or server__tool): tool'
    );
  });

  it('fails with -007 on a duplicated example row', () => {
    writeFileSync(
      fixture.commandPath,
      mutate(
        DEFAULT_SETUP_ALL,
        '  beta                 NEEDS SETUP     thing missing',
        '  beta                 NEEDS SETUP     thing missing\n  beta                 READY           duplicate row'
      ),
      'utf8'
    );
    const result = runValidator(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('duplicate rows in the illustrative dashboard example: beta');
  });

  it('fails with -003 when a delegated entry is not a setup command', () => {
    writeFileSync(
      join(fixture.pluginsDir, 'beta', 'commands', 'beta-status.md'),
      '---\nname: beta-status\ndescription: fixture\n---\n\nBody.\n',
      'utf8'
    );
    writeFileSync(
      fixture.commandPath,
      mutate(
        mutate(DEFAULT_SETUP_ALL, '2. `beta-setup`', '2. `beta-status`'),
        '- `beta` → `beta-setup`',
        '- `beta` → `beta-status`'
      ),
      'utf8'
    );
    const result = runValidator(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'delegated entries must be setup commands (name ending in "setup"): beta-status'
    );
  });

  it('fails with -003 when two plugins declare the same command name', () => {
    writeFileSync(
      join(fixture.pluginsDir, 'beta', 'commands', 'dup.md'),
      '---\nname: alpha:setup\ndescription: duplicate\n---\n\nBody.\n',
      'utf8'
    );
    const result = runValidator(fixture);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('duplicate command names across plugins: alpha:setup');
  });
});
