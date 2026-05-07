/**
 * Integration test for CHANGELOG.md skip in `scripts/validate-agent-authoring.js`.
 *
 * Verifies that:
 *   1. A CHANGELOG.md containing a `subagent_type:` reference to a deleted
 *      agent is NOT flagged (CHANGELOGs document history including
 *      deletions; their references are not live dispatches).
 *   2. A non-CHANGELOG markdown file (e.g., a command file) referencing the
 *      same deleted agent IS still flagged.
 *
 * Regression context: prior to this fix, the validator's `markdownFiles`
 * walk included every `.md` file under `plugins/`, including CHANGELOG.md.
 * That produced a hard ERROR on legitimate CHANGELOG entries that documented
 * deprecated agents — blocking `pnpm release:check` indefinitely.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const VALIDATOR = resolve(__dirname, '..', '..', 'scripts', 'validate-agent-authoring.js');

interface ValidatorRun {
  status: number;
  stdout: string;
  stderr: string;
}

function runValidator(pluginsDir: string): ValidatorRun {
  try {
    const stdout = execFileSync('node', [VALIDATOR], {
      env: { ...process.env, VALIDATE_PLUGINS_DIR: pluginsDir },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status: number; stdout?: string; stderr?: string };
    return {
      status: e.status,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
    };
  }
}

function writeFile(
  pluginsDir: string,
  pluginRelative: string,
  body: string
): void {
  const fullPath = join(pluginsDir, pluginRelative);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, body, 'utf8');
}

const REAL_AGENT = `---
name: real-agent
description: "Test fixture. Use when verifying CHANGELOG skip rule."
model: inherit
tools:
  - Read
  - Grep
  - Glob
---

Real agent body.
`;

const CHANGELOG_WITH_DELETED_REF = `# Changelog

## [1.0.0] - 2026-01-01

- Removed deprecated agent. Callers using
  \`subagent_type: "yellow-test:review:deleted-agent"\` must migrate.
`;

const COMMAND_WITH_DELETED_REF = `---
name: broken-command
description: "Test fixture referencing a deleted agent."
---

\`\`\`text
Task: deleted-agent
subagent_type: "yellow-test:review:deleted-agent"
\`\`\`
`;

describe('validate-agent-authoring CHANGELOG.md skip', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-validate-changelog-'));
    // Every fixture needs at least one declared agent so subagent_type
    // references can be cross-checked against pluginAgents.
    writeFile(tmpRoot, 'yellow-test/agents/review/real-agent.md', REAL_AGENT);
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('does NOT flag a deleted-agent reference inside CHANGELOG.md', () => {
    writeFile(
      tmpRoot,
      'yellow-test/CHANGELOG.md',
      CHANGELOG_WITH_DELETED_REF
    );

    const { status, stderr } = runValidator(tmpRoot);

    expect(status).toBe(0);
    expect(stderr).not.toMatch(/CHANGELOG\.md/);
    expect(stderr).not.toMatch(/deleted-agent/);
  });

  it('STILL flags a deleted-agent reference inside a non-CHANGELOG file', () => {
    writeFile(
      tmpRoot,
      'yellow-test/commands/broken/broken-command.md',
      COMMAND_WITH_DELETED_REF
    );

    const { status, stderr } = runValidator(tmpRoot);

    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/broken-command\.md/);
    expect(stderr).toMatch(/deleted-agent/);
  });

  it('does NOT flag CHANGELOG.md even when both files are present', () => {
    // Only the non-CHANGELOG file should trigger the error; CHANGELOG.md
    // must remain silent regardless of what it contains.
    writeFile(
      tmpRoot,
      'yellow-test/CHANGELOG.md',
      CHANGELOG_WITH_DELETED_REF
    );
    writeFile(
      tmpRoot,
      'yellow-test/commands/broken/broken-command.md',
      COMMAND_WITH_DELETED_REF
    );

    const { status, stderr } = runValidator(tmpRoot);

    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/broken-command\.md/);
    expect(stderr).not.toMatch(/CHANGELOG\.md/);
  });
});
