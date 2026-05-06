/**
 * Integration test for `scripts/validate-plugin.js`.
 *
 * Mirrors the fixture pattern used in
 * `validate-agent-authoring-review-rule.test.ts`: each test creates a temp
 * plugin directory under `os.tmpdir()`, writes a `.claude-plugin/plugin.json`
 * (and any supporting hook scripts / outputStyles files), then runs the
 * validator as a child process with the temp plugin dir as a positional
 * argument.
 *
 * The validator exits with:
 *   0 — all valid
 *   1 — validation failed
 *   2 — plugin not found
 *
 * Tests cover both the regression-net baseline (existing behavior that must
 * stay green through the refactor) and the new behaviors added in PR-A:
 *   - Array-form `hooks` element validation (previously bypassed RULE 6/7/8)
 *   - SessionStart in DECISION_PROTOCOL_EVENTS Set
 *   - String-form `hooks` path-existence + containment via resolvePluginPath
 *   - `outputStyles` directory-only enforcement
 */

import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const VALIDATOR = resolve(
  __dirname,
  '..',
  '..',
  'scripts',
  'validate-plugin.js'
);

interface ValidatorRun {
  status: number;
  stdout: string;
  stderr: string;
}

function runValidator(pluginDir: string): ValidatorRun {
  // spawnSync captures stdout and stderr regardless of exit code; execFileSync
  // discards stderr on exit 0 which masks warning-path tests.
  const result = spawnSync('node', [VALIDATOR, pluginDir], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function writePluginManifest(
  pluginDir: string,
  manifest: Record<string, unknown>
): void {
  const manifestDir = join(pluginDir, '.claude-plugin');
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(
    join(manifestDir, 'plugin.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );
}

function writeHookScript(
  pluginDir: string,
  relativePath: string,
  content: string
): void {
  const fullPath = join(pluginDir, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');
  chmodSync(fullPath, 0o755);
}

function writeOutputStyleDir(
  pluginDir: string,
  relativeDir: string,
  files: string[]
): void {
  const fullDir = join(pluginDir, relativeDir);
  mkdirSync(fullDir, { recursive: true });
  for (const f of files) {
    writeFileSync(join(fullDir, f), '# style\n', 'utf8');
  }
}

const VALID_BASE_MANIFEST = {
  name: 'test-plugin',
  description:
    'A test fixture plugin used by validate-plugin integration tests.',
  author: 'KingInYellows',
  version: '1.0.0',
};

const SHEBANG_HOOK = `#!/usr/bin/env bash
set -uo pipefail
# Test fixture hook script. Outputs a continue decision.
printf '{"continue": true}\\n'
exit 0
`;

const SET_E_HOOK = `#!/usr/bin/env bash
set -euo pipefail
# Anti-pattern: set -e prevents JSON output on error.
printf '{"continue": true}\\n'
exit 0
`;

describe('validate-plugin baseline (regression net)', () => {
  let tmpRoot: string;
  let pluginDir: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-validate-plugin-'));
    // Plugin name must match directory basename per RULE 2.
    pluginDir = join(tmpRoot, 'test-plugin');
    mkdirSync(pluginDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('passes a minimal valid manifest', () => {
    writePluginManifest(pluginDir, VALID_BASE_MANIFEST);
    const { status, stdout } = runValidator(pluginDir);
    expect(status).toBe(0);
    expect(stdout).toMatch(/Plugin "test-plugin" is valid/);
  });

  it('fails when name is missing', () => {
    const { name: _name, ...rest } = VALID_BASE_MANIFEST;
    writePluginManifest(pluginDir, rest);
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/Missing required field: "name"/);
  });

  it('fails when description is missing', () => {
    const { description: _description, ...rest } = VALID_BASE_MANIFEST;
    writePluginManifest(pluginDir, rest);
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/Missing required field: "description"/);
  });

  it('fails when author is missing', () => {
    const { author: _author, ...rest } = VALID_BASE_MANIFEST;
    writePluginManifest(pluginDir, rest);
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/Missing required field: "author"/);
  });

  it('fails when name does not match directory basename', () => {
    writePluginManifest(pluginDir, {
      ...VALID_BASE_MANIFEST,
      name: 'wrong-name',
    });
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/does not match directory name/);
  });

  it('fails on invalid version format', () => {
    writePluginManifest(pluginDir, {
      ...VALID_BASE_MANIFEST,
      version: 'not-a-version',
    });
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/Invalid version format/);
    expect(stderr).toMatch(/MAJOR\.MINOR\.PATCH/);
  });

  it('warns on hooks-string anti-pattern (./hooks/hooks.json)', () => {
    // Create the file so the path-existence check (PR-A) passes; the
    // anti-pattern warning is what this test asserts.
    mkdirSync(join(pluginDir, 'hooks'), { recursive: true });
    writeFileSync(
      join(pluginDir, 'hooks', 'hooks.json'),
      JSON.stringify({ hooks: {} }),
      'utf8'
    );
    writePluginManifest(pluginDir, {
      ...VALID_BASE_MANIFEST,
      hooks: './hooks/hooks.json',
    });
    const { status, stderr } = runValidator(pluginDir);
    // Warning, not error — plugin is still valid
    expect(status).toBe(0);
    expect(stderr).toMatch(/hooks\/hooks\.json/);
    expect(stderr).toMatch(/duplicate hooks/);
  });

  it('passes hooks inline-object form with valid script paths', () => {
    writeHookScript(pluginDir, 'hooks/scripts/example.sh', SHEBANG_HOOK);
    writePluginManifest(pluginDir, {
      ...VALID_BASE_MANIFEST,
      hooks: {
        UserPromptSubmit: [
          {
            matcher: '*',
            hooks: [
              {
                type: 'command',
                command: 'bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/example.sh',
                timeout: 5000,
              },
            ],
          },
        ],
      },
    });
    const { status } = runValidator(pluginDir);
    expect(status).toBe(0);
  });

  it('errors when inline-object hooks reference a missing script', () => {
    writePluginManifest(pluginDir, {
      ...VALID_BASE_MANIFEST,
      hooks: {
        UserPromptSubmit: [
          {
            matcher: '*',
            hooks: [
              {
                type: 'command',
                command: 'bash ${CLAUDE_PLUGIN_ROOT}/hooks/missing.sh',
                timeout: 5000,
              },
            ],
          },
        ],
      },
    });
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/Hook script not found/);
  });

  it('warns on set -e in PreToolUse hook script', () => {
    writeHookScript(pluginDir, 'hooks/scripts/seteh.sh', SET_E_HOOK);
    writePluginManifest(pluginDir, {
      ...VALID_BASE_MANIFEST,
      hooks: {
        PreToolUse: [
          {
            matcher: '*',
            hooks: [
              {
                type: 'command',
                command: 'bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/seteh.sh',
                timeout: 5000,
              },
            ],
          },
        ],
      },
    });
    const { status, stderr } = runValidator(pluginDir);
    // Warning only — plugin still valid
    expect(status).toBe(0);
    expect(stderr).toMatch(/set -e/);
  });

  it('passes valid outputStyles directory with .md files', () => {
    writeOutputStyleDir(pluginDir, 'output-styles', [
      'default.md',
      'compact.md',
    ]);
    writePluginManifest(pluginDir, {
      ...VALID_BASE_MANIFEST,
      outputStyles: './output-styles',
    });
    const { status, stdout } = runValidator(pluginDir);
    expect(status).toBe(0);
    expect(stdout).toMatch(/outputStyles:.*2 files/);
  });

  it('errors when outputStyles directory is missing', () => {
    writePluginManifest(pluginDir, {
      ...VALID_BASE_MANIFEST,
      outputStyles: './missing-styles',
    });
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/outputStyles directory not found/);
  });

  it('errors when outputStyles path escapes plugin directory', () => {
    writePluginManifest(pluginDir, {
      ...VALID_BASE_MANIFEST,
      outputStyles: '../escape-styles',
    });
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/escapes plugin directory/);
  });
});

describe('validate-plugin PR-A new behaviors', () => {
  let tmpRoot: string;
  let pluginDir: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-validate-plugin-new-'));
    pluginDir = join(tmpRoot, 'test-plugin');
    mkdirSync(pluginDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('errors when array-form hooks reference a missing script (PR-A: RULE 5c path-existence on array-string entries)', () => {
    writePluginManifest(pluginDir, {
      ...VALID_BASE_MANIFEST,
      hooks: ['./hooks/scripts/missing-array-script.sh'],
    });
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/missing-array-script\.sh/);
  });

  it('passes array-form hooks with valid script paths', () => {
    writeHookScript(pluginDir, 'hooks/scripts/array-ok.sh', SHEBANG_HOOK);
    writePluginManifest(pluginDir, {
      ...VALID_BASE_MANIFEST,
      hooks: ['./hooks/scripts/array-ok.sh'],
    });
    const { status } = runValidator(pluginDir);
    expect(status).toBe(0);
  });

  it('errors when array-form hooks contain a path that escapes plugin directory', () => {
    writePluginManifest(pluginDir, {
      ...VALID_BASE_MANIFEST,
      hooks: ['../outside-plugin.sh'],
    });
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/escapes plugin directory|outside-plugin/);
  });

  it('errors when array-form hooks contain an object item with a bash command referencing a missing script (PR-A: recursion into event-keyed array items)', () => {
    // Previously the validator skipped object items in the array form entirely
    // (the array-form bypass). collectInlineHooks now merges event-keyed objects
    // found in array entries into the same inline-hooks dict that RULES 6/8 iterate,
    // so a bash command referencing a missing script inside an array-form object
    // item must produce a validation error — not silently pass.
    writePluginManifest(pluginDir, {
      ...VALID_BASE_MANIFEST,
      hooks: [
        {
          PreToolUse: [
            {
              matcher: '*',
              hooks: [
                {
                  type: 'command',
                  command: 'bash ./hooks/scripts/nonexistent-array-object.sh',
                },
              ],
            },
          ],
        },
      ],
    });
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(
      /nonexistent-array-object\.sh|Hook script not found/
    );
  });

  it('errors when string-form hooks reference a non-existent file (PR-A: resolvePluginPath check)', () => {
    writePluginManifest(pluginDir, {
      ...VALID_BASE_MANIFEST,
      hooks: './hooks/missing-string-form.json',
    });
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/missing-string-form\.json|hooks file not found/);
  });

  it('errors when string-form hooks path escapes plugin directory', () => {
    writePluginManifest(pluginDir, {
      ...VALID_BASE_MANIFEST,
      hooks: '../outside-hooks.json',
    });
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/escapes plugin directory|outside-hooks/);
  });

  it('warns on SessionStart hook missing decision output (PR-A: DECISION_PROTOCOL_EVENTS extension)', () => {
    const PLAIN_HOOK = `#!/usr/bin/env bash
set -uo pipefail
# No JSON output — should trip the SessionStart decision-output warning.
printf 'plain text\\n'
`;
    writeHookScript(pluginDir, 'hooks/scripts/session-plain.sh', PLAIN_HOOK);
    writePluginManifest(pluginDir, {
      ...VALID_BASE_MANIFEST,
      hooks: {
        SessionStart: [
          {
            matcher: '*',
            hooks: [
              {
                type: 'command',
                command:
                  'bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/session-plain.sh',
                timeout: 5000,
              },
            ],
          },
        ],
      },
    });
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBe(0); // warning only
    expect(stderr).toMatch(/SessionStart/);
    expect(stderr).toMatch(/decision output|missing decision/);
  });

  it('errors when outputStyles points to a .md file directly (PR-A: directory-only enforcement)', () => {
    // RULE 5b enforces directory-only — a .md file path is an error.
    writeFileSync(join(pluginDir, 'just-a-file.md'), '# style\n', 'utf8');
    writePluginManifest(pluginDir, {
      ...VALID_BASE_MANIFEST,
      outputStyles: './just-a-file.md',
    });
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/must point to a directory|directory/);
  });

  it('errors when outputStyles directory contains no .md files', () => {
    mkdirSync(join(pluginDir, 'empty-styles'), { recursive: true });
    writePluginManifest(pluginDir, {
      ...VALID_BASE_MANIFEST,
      outputStyles: './empty-styles',
    });
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/at least one \.md file/);
  });

  it('errors when hooks/hooks.json has events at the top level (RULE 7: shape check, missing "hooks" wrapper)', () => {
    // Claude Code 2.1.131+ auto-discovers hooks/hooks.json and validates the
    // top-level shape against { hooks: { ... } }. A file with events at the
    // root (no wrapper) causes "Hook load failed: expected record, received
    // undefined at path ['hooks']" and the plugin fails to load. The
    // validator must catch this before the file ships.
    mkdirSync(join(pluginDir, 'hooks'), { recursive: true });
    writeFileSync(
      join(pluginDir, 'hooks', 'hooks.json'),
      JSON.stringify(
        {
          PostToolUse: [
            {
              matcher: '*',
              hooks: [{ type: 'command', command: 'echo broken' }],
            },
          ],
        },
        null,
        2
      ),
      'utf8'
    );
    writePluginManifest(pluginDir, {
      ...VALID_BASE_MANIFEST,
      hooks: {
        PostToolUse: [
          {
            matcher: '*',
            hooks: [{ type: 'command', command: 'echo broken' }],
          },
        ],
      },
    });
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(
      /hooks\/hooks\.json: top-level "hooks" key is required/
    );
  });

  it('errors when hooks/hooks.json is unparseable JSON (RULE 7: parse failure is now hard error)', () => {
    // Previously a logWarning at validate-plugin.js:790; promoted to addError
    // since Claude Code's auto-discovery rejects unparseable files at install
    // time the same way it rejects malformed shape.
    mkdirSync(join(pluginDir, 'hooks'), { recursive: true });
    writeFileSync(
      join(pluginDir, 'hooks', 'hooks.json'),
      '{not valid json',
      'utf8'
    );
    writePluginManifest(pluginDir, {
      ...VALID_BASE_MANIFEST,
      hooks: {
        PostToolUse: [
          {
            matcher: '*',
            hooks: [{ type: 'command', command: 'echo unparseable' }],
          },
        ],
      },
    });
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/hooks\/hooks\.json: cannot parse/);
  });

  it('runs hooks/hooks.json shape check even when plugin.json has no inline hooks', () => {
    // The shape gate must fire whenever the file is present on disk —
    // dropping the `hasInlineHooks` guard ensures Claude Code's auto-discovery
    // contract is enforced even for plugins that only ship hooks/hooks.json.
    // A well-formed file with no inline manifest block must pass.
    mkdirSync(join(pluginDir, 'hooks'), { recursive: true });
    writeFileSync(
      join(pluginDir, 'hooks', 'hooks.json'),
      JSON.stringify(
        {
          hooks: {
            PostToolUse: [
              {
                matcher: '*',
                hooks: [{ type: 'command', command: 'echo ok' }],
              },
            ],
          },
        },
        null,
        2
      ),
      'utf8'
    );
    writePluginManifest(pluginDir, VALID_BASE_MANIFEST); // no inline hooks
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBe(0);
    expect(stderr).not.toMatch(/hooks\/hooks\.json/);
  });
});
