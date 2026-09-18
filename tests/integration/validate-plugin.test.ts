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
  symlinkSync,
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

function runValidator(pluginDir: string, cwd?: string): ValidatorRun {
  // spawnSync captures stdout and stderr regardless of exit code; execFileSync
  // discards stderr on exit 0 which masks warning-path tests. With `cwd`
  // and no pluginDir the validator auto-discovers plugins/ under cwd.
  const result = spawnSync('node', pluginDir ? [VALIDATOR, pluginDir] : [VALIDATOR], {
    cwd,
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
                command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/example.sh"',
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
                command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/missing.sh"',
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
                command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/seteh.sh"',
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
                  'bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/session-plain.sh"',
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

  it('errors when hooks/hooks.json is present alongside inline plugin.json hooks (RULE 7: presence check)', () => {
    // Claude Code auto-discovers hooks/hooks.json AND loads the inline block,
    // with no dedup between the two sources — every hook fires twice. A
    // byte-identical "reference-only" mirror is still a double registration.
    const hooks = {
      SessionStart: [
        {
          matcher: '*',
          hooks: [{ type: 'command', command: 'echo ok', timeout: 3 }],
        },
      ],
    };
    mkdirSync(join(pluginDir, 'hooks'), { recursive: true });
    writeFileSync(
      join(pluginDir, 'hooks', 'hooks.json'),
      JSON.stringify({ hooks }, null, 2),
      'utf8'
    );
    writePluginManifest(pluginDir, { ...VALID_BASE_MANIFEST, hooks });
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/hooks\/hooks\.json: not allowed/);
    expect(stderr).toMatch(/catalog\/plugins\/<name>\.json#hooks/);
  });

  it('errors when hooks/hooks.json is present without inline plugin.json hooks (RULE 7: hooks-only is not a carve-out)', () => {
    // Upstream documents hooks-only plugins as valid, but in this catalog-
    // generated marketplace the file is an un-cataloged hook source:
    // emit-codex.js never mirrors it and RULES 6/8 never inspect its
    // scripts. generate-manifests --check also reports it as forbidden (see
    // generate-manifests-codex.test.ts), but this validator rejects it
    // outright regardless. Presence alone errors.
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
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/hooks\/hooks\.json: not allowed/);
  });

  it('reports the same presence error for an unparseable hooks/hooks.json (RULE 7: contents are not inspected)', () => {
    // Presence is fatal, so the validator no longer parses the file — a
    // malformed one produces the one presence error, not a parse error.
    mkdirSync(join(pluginDir, 'hooks'), { recursive: true });
    writeFileSync(
      join(pluginDir, 'hooks', 'hooks.json'),
      '{not valid json',
      'utf8'
    );
    writePluginManifest(pluginDir, VALID_BASE_MANIFEST);
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/hooks\/hooks\.json: not allowed/);
    expect(stderr).not.toMatch(/cannot parse/);
  });
});


describe('validate-plugin RULE 6: node hook commands and ${CLAUDE_PLUGIN_ROOT} quoting', () => {
  let tmpRoot: string;
  let pluginDir: string;

  const NODE_HOOK = `'use strict';
process.stdout.write('{"continue": true}\\n');
`;

  function hookManifest(command: string): Record<string, unknown> {
    return {
      ...VALID_BASE_MANIFEST,
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command, timeout: 5 }] },
        ],
      },
    };
  }

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-validate-node-'));
    pluginDir = join(tmpRoot, 'test-plugin');
    mkdirSync(pluginDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('passes a quoted node entrypoint that exists, without bash-only content warnings', () => {
    // A `node <entrypoint>` command has no shebang / set -e / executable-bit
    // contract — only existence and containment apply.
    mkdirSync(join(pluginDir, 'hooks', 'scripts'), { recursive: true });
    writeFileSync(join(pluginDir, 'hooks', 'scripts', 'entry.js'), NODE_HOOK, 'utf8');
    writePluginManifest(
      pluginDir,
      hookManifest('node "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/entry.js" --hook check-git-push')
    );
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBe(0);
    expect(stderr).not.toMatch(/unquoted/);
    expect(stderr).not.toMatch(/missing shebang/);
    expect(stderr).not.toMatch(/not executable/);
  });

  it('errors when a quoted node entrypoint does not exist (RULE 6 covers node commands)', () => {
    writePluginManifest(
      pluginDir,
      hookManifest('node "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/missing.js" --hook check-git-push')
    );
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/Hook script not found for PreToolUse/);
  });

  it('errors when a node command escapes the plugin directory', () => {
    writePluginManifest(
      pluginDir,
      hookManifest('node "${CLAUDE_PLUGIN_ROOT}/../outside.js"')
    );
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/Hook script path escapes plugin directory/);
  });

  it('errors on an unquoted ${CLAUDE_PLUGIN_ROOT} placeholder, for bash and node alike', () => {
    // Claude Code runs shell-form commands through `sh -c`; unquoted, the
    // placeholder word-splits on a plugin-cache path with a space and the
    // hook fails open. An error (not a warning) so the fixed form cannot
    // regress under a green CI.
    writeHookScript(pluginDir, 'hooks/scripts/guard.sh', SHEBANG_HOOK);
    mkdirSync(join(pluginDir, 'hooks', 'scripts'), { recursive: true });
    writeFileSync(join(pluginDir, 'hooks', 'scripts', 'entry.js'), NODE_HOOK, 'utf8');
    for (const command of [
      'bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/guard.sh',
      'node ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/entry.js --hook check-git-push',
    ]) {
      writePluginManifest(pluginDir, hookManifest(command));
      const { status, stderr } = runValidator(pluginDir);
      expect(status).toBeGreaterThan(0);
      expect(stderr).toMatch(
        /PreToolUse hook command has unquoted \$\{CLAUDE_PLUGIN_ROOT\}/
      );
      // Quoting is reported alone — the resolver is not run on a
      // mis-quoted command, so no second "escapes" error appears.
      expect(stderr).not.toMatch(/escapes plugin directory/);
    }
  });

  it('errors on a single-quoted ${CLAUDE_PLUGIN_ROOT} placeholder (never expands), not as word-splitting', () => {
    writeHookScript(pluginDir, 'hooks/scripts/guard.sh', SHEBANG_HOOK);
    writePluginManifest(
      pluginDir,
      hookManifest("bash '${CLAUDE_PLUGIN_ROOT}/hooks/scripts/guard.sh'")
    );
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/single-quotes \$\{CLAUDE_PLUGIN_ROOT\}/);
    expect(stderr).not.toMatch(/unquoted \$\{CLAUDE_PLUGIN_ROOT\}/);
    // The script exists, but the validator must not report it as found.
    expect(stderr).not.toMatch(/Hook script not found/);
  });

  it('accepts the docs-literal form that quotes only the placeholder, and interpreter flags before the script', () => {
    writeHookScript(pluginDir, 'hooks/scripts/guard.sh', SHEBANG_HOOK);
    mkdirSync(join(pluginDir, 'hooks', 'scripts'), { recursive: true });
    writeFileSync(join(pluginDir, 'hooks', 'scripts', 'entry.js'), NODE_HOOK, 'utf8');
    for (const command of [
      'bash "${CLAUDE_PLUGIN_ROOT}"/hooks/scripts/guard.sh',
      'node --enable-source-maps "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/entry.js" --hook check-git-push',
    ]) {
      writePluginManifest(pluginDir, hookManifest(command));
      const { status, stderr } = runValidator(pluginDir);
      expect(status).toBe(0);
      expect(stderr).not.toMatch(/unquoted \$\{CLAUDE_PLUGIN_ROOT\}/);
      expect(stderr).not.toMatch(/escapes plugin directory/);
      expect(stderr).not.toMatch(/Hook script not found for PreToolUse: .*--enable-source-maps/);
    }

    // Excluded from the accepted list above: the resolver substitutes the
    // placeholder inside the quoted word, so a prefix like `prefix-` before
    // it yields a path (`prefix-<pluginDir>/…`) that never exists — and at
    // runtime `sh -c` expands it to the same nonexistent path. This form is
    // genuinely invalid, not merely unsupported by quoting detection.
    writePluginManifest(
      pluginDir,
      hookManifest('bash "prefix-${CLAUDE_PLUGIN_ROOT}"/hooks/scripts/guard.sh')
    );
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/Hook script not found for PreToolUse/);
  });

  it('does not treat a command whose first token merely starts with "node" or "bash" as an interpreter', () => {
    // HOOK_SCRIPT_INTERPRETER_RE anchors on `bash `/`node ` + whitespace.
    // `nodejs …` is an unrecognized interpreter: no existence/containment
    // check, but a warning because the placeholder is referenced.
    writePluginManifest(
      pluginDir,
      hookManifest('nodejs "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/missing.js"')
    );
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBe(0);
    expect(stderr).not.toMatch(/Hook script not found/);
    expect(stderr).not.toMatch(/escapes plugin directory/);
    expect(stderr).toMatch(/unrecognized interpreter/);
  });

  it('passes a quoted command when the plugin lives under a path containing a space', () => {
    // Claude Code runs shell-form commands through `sh -c`; the quoted
    // placeholder is what keeps a plugin-cache path with a space intact.
    const spacedRoot = mkdtempSync(join(tmpdir(), 'yellow validate space-'));
    try {
      const spacedPluginDir = join(spacedRoot, 'test-plugin');
      mkdirSync(spacedPluginDir, { recursive: true });
      writeHookScript(spacedPluginDir, 'hooks/scripts/guard.sh', SHEBANG_HOOK);
      writePluginManifest(
        spacedPluginDir,
        hookManifest('bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/guard.sh"')
      );
      const { status, stderr } = runValidator(spacedPluginDir);
      expect(status).toBe(0);
      expect(stderr).not.toMatch(/unquoted/);
      expect(stderr).not.toMatch(/escapes plugin directory/);
    } finally {
      rmSync(spacedRoot, { recursive: true, force: true });
    }
  });

  it('reports only the quoting error for an unquoted command under a path containing a space', () => {
    // The script argument is tokenised before the placeholder is
    // substituted, so the checkout path cannot change the verdict: the
    // unquoted form is the one error regardless of whether the plugin
    // directory contains a space.
    const spacedRoot = mkdtempSync(join(tmpdir(), 'yellow validate space-'));
    try {
      const spacedPluginDir = join(spacedRoot, 'test-plugin');
      mkdirSync(spacedPluginDir, { recursive: true });
      writeHookScript(spacedPluginDir, 'hooks/scripts/guard.sh', SHEBANG_HOOK);
      writePluginManifest(
        spacedPluginDir,
        hookManifest('bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/guard.sh')
      );
      const { status, stderr } = runValidator(spacedPluginDir);
      expect(status).toBeGreaterThan(0);
      expect(stderr).toMatch(/unquoted \$\{CLAUDE_PLUGIN_ROOT\}/);
      expect(stderr).not.toMatch(/Hook script path escapes plugin directory/);
    } finally {
      rmSync(spacedRoot, { recursive: true, force: true });
    }
  });

  it('rejects a hook command whose script path has an unterminated quote', () => {
    // `bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/guard.sh` never closes its
    // opening `"`. `sh -c` rejects that command outright as an unterminated
    // quoted string, so even though a file exists at the quote-stripped
    // path, RULE 6 must fail rather than report the script as found.
    writeHookScript(pluginDir, 'hooks/scripts/guard.sh', SHEBANG_HOOK);
    writePluginManifest(
      pluginDir,
      hookManifest('bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/guard.sh')
    );
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/unterminated quote/);
    expect(stderr).not.toMatch(/Hook script not found/);
    expect(stderr).not.toMatch(/escapes plugin directory/);
  });

  it('resolves the real entrypoint past a value-taking interpreter option in separated form', () => {
    // `--require`/`-r` takes its value as a separate word, not just
    // `--require=value`. Without consuming that operand, the resolver
    // would select `preload.js` as "the script" and never check
    // `entry.js` — the actual command Claude Code runs.
    mkdirSync(join(pluginDir, 'hooks', 'scripts'), { recursive: true });
    writeFileSync(join(pluginDir, 'hooks', 'scripts', 'preload.js'), NODE_HOOK, 'utf8');
    writeFileSync(join(pluginDir, 'hooks', 'scripts', 'entry.js'), NODE_HOOK, 'utf8');
    writePluginManifest(
      pluginDir,
      hookManifest(
        'node --require "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/preload.js" "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/entry.js"'
      )
    );
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBe(0);
    expect(stderr).not.toMatch(/Hook script not found/);
    expect(stderr).not.toMatch(/escapes plugin directory/);

    // The failure case: entry.js is missing, preload.js exists. If the
    // resolver mistook preload.js for the script, this would pass; it
    // must instead report entry.js as the missing hook script.
    rmSync(join(pluginDir, 'hooks', 'scripts', 'entry.js'));
    const { status: missingStatus, stderr: missingStderr } =
      runValidator(pluginDir);
    expect(missingStatus).toBeGreaterThan(0);
    expect(missingStderr).toMatch(/Hook script not found for PreToolUse:.*entry\.js/);
  });

  it('rejects a value-taking option operand that hides a containment escape behind it (-r short form)', () => {
    // Same operand-skipping requirement as --require, exercised via the
    // short flag `-r` and with the escaping path as the actual script
    // argument (not the option's operand).
    mkdirSync(join(pluginDir, 'hooks', 'scripts'), { recursive: true });
    writeFileSync(join(pluginDir, 'hooks', 'scripts', 'preload.js'), NODE_HOOK, 'utf8');
    writePluginManifest(
      pluginDir,
      hookManifest(
        'node -r "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/preload.js" "${CLAUDE_PLUGIN_ROOT}/../outside.js"'
      )
    );
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/Hook script path escapes plugin directory/);
  });
});

describe('validate-plugin symlink hardening: hook script ancestors, both-sides realpath, dangling hooks/hooks.json', () => {
  let tmpRoot: string;
  let pluginDir: string;

  const hookManifest = (command: string) => ({
    ...VALID_BASE_MANIFEST,
    hooks: {
      UserPromptSubmit: [
        { matcher: '*', hooks: [{ type: 'command', command, timeout: 5000 }] },
      ],
    },
  });

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-validate-plugin-symlink-'));
    pluginDir = join(tmpRoot, 'test-plugin');
    mkdirSync(pluginDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('errors when hooks/ is a symlink to a directory outside the plugin (symlinked ancestor)', () => {
    // The script itself is a real file and resolveHookScriptPath's lexical
    // containment passes; only the on-disk ancestor walk catches it.
    const outside = join(tmpRoot, 'outside-hooks');
    mkdirSync(join(outside, 'scripts'), { recursive: true });
    writeFileSync(join(outside, 'scripts', 'guard.sh'), SHEBANG_HOOK, 'utf8');
    chmodSync(join(outside, 'scripts', 'guard.sh'), 0o755);
    symlinkSync(outside, join(pluginDir, 'hooks'), 'dir');
    writePluginManifest(
      pluginDir,
      hookManifest('bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/guard.sh"')
    );
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/passes through a symlinked directory \(hooks\)/);
  });

  it('errors when hooks/ is a symlink even to a directory INSIDE the plugin (reject-symlinks-outright policy)', () => {
    mkdirSync(join(pluginDir, 'real-hooks', 'scripts'), { recursive: true });
    writeFileSync(join(pluginDir, 'real-hooks', 'scripts', 'guard.sh'), SHEBANG_HOOK, 'utf8');
    chmodSync(join(pluginDir, 'real-hooks', 'scripts', 'guard.sh'), 0o755);
    symlinkSync(join(pluginDir, 'real-hooks'), join(pluginDir, 'hooks'), 'dir');
    writePluginManifest(
      pluginDir,
      hookManifest('bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/guard.sh"')
    );
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/passes through a symlinked directory \(hooks\)/);
  });

  it('passes when the plugin directory itself is reached through a symlinked parent (both-sides realpath)', () => {
    // macOS-style /var -> /private/var cache roots: the plugin dir arrives
    // via a symlinked ancestor ABOVE it. That must not false-positive —
    // both sides are realpath-resolved before containment.
    writeHookScript(pluginDir, 'hooks/scripts/guard.sh', SHEBANG_HOOK);
    writePluginManifest(
      pluginDir,
      hookManifest('bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/guard.sh"')
    );
    const linkRoot = join(tmpRoot, 'link-root');
    symlinkSync(tmpRoot, linkRoot, 'dir');
    const { status, stderr } = runValidator(join(linkRoot, 'test-plugin'));
    expect(stderr).not.toMatch(/symlink/);
    expect(status).toBe(0);
  });

  it('still errors when the hook script file itself is a symlink (existing final-component check)', () => {
    writeHookScript(pluginDir, 'hooks/scripts/real.sh', SHEBANG_HOOK);
    symlinkSync(
      join(pluginDir, 'hooks', 'scripts', 'real.sh'),
      join(pluginDir, 'hooks', 'scripts', 'guard.sh'),
      'file'
    );
    writePluginManifest(
      pluginDir,
      hookManifest('bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/guard.sh"')
    );
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/Hook script path is a symlink/);
  });

  it('rejects a `..` component in the script path even when it normalises inside the plugin (review P2)', () => {
    // path.resolve folds `docs/../hooks/guard.sh` to `hooks/guard.sh`, so
    // every lexical and realpath check sees a clean in-plugin file — but the
    // kernel resolves `docs` (a symlink to /elsewhere) FIRST and runs
    // /elsewhere/../hooks/guard.sh. `..` is rejected outright instead.
    const outside = join(tmpRoot, 'elsewhere');
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(pluginDir, 'docs'), 'dir');
    writeHookScript(pluginDir, 'hooks/scripts/guard.sh', SHEBANG_HOOK);
    writePluginManifest(
      pluginDir,
      hookManifest('bash "${CLAUDE_PLUGIN_ROOT}/docs/../hooks/scripts/guard.sh"')
    );
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/Hook script path escapes plugin directory/);
  });

  it('errors when the plugin root itself is a symlink (review P2: neither the ancestor walk nor realpath sees it)', () => {
    const realPlugin = join(tmpRoot, 'real-plugin');
    mkdirSync(realPlugin, { recursive: true });
    writeHookScript(realPlugin, 'hooks/scripts/guard.sh', SHEBANG_HOOK);
    // The manifest name must match the LINK's basename (RULE 2).
    writePluginManifest(realPlugin, {
      ...hookManifest('bash "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/guard.sh"'),
      name: 'linked-plugin',
    });
    const link = join(tmpRoot, 'linked-plugin');
    symlinkSync(realPlugin, link, 'dir');
    const { status, stderr } = runValidator(link);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/Plugin directory is a symlink/);
  });

  it('errors when the plugin root is a symlink even with no hooks at all (root check runs first)', () => {
    const realPlugin = join(tmpRoot, 'real-plain');
    mkdirSync(realPlugin, { recursive: true });
    writePluginManifest(realPlugin, { ...VALID_BASE_MANIFEST, name: 'plain-linked' });
    const link = join(tmpRoot, 'plain-linked');
    symlinkSync(realPlugin, link, 'dir');
    const { status, stderr } = runValidator(link);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/Plugin directory is a symlink/);
  });

  it('auto-discovery (no argument) visits a symlinked plugins/<name> entry and refuses a symlinked plugins/ directory', () => {
    // discoverPlugins() runs from cwd: build a mini project root.
    const project = join(tmpRoot, 'project');
    const realPlugin = join(project, 'plugins', 'real-one');
    mkdirSync(realPlugin, { recursive: true });
    writePluginManifest(realPlugin, { ...VALID_BASE_MANIFEST, name: 'real-one' });
    const elsewhere = join(tmpRoot, 'elsewhere-plugin');
    mkdirSync(elsewhere, { recursive: true });
    writePluginManifest(elsewhere, { ...VALID_BASE_MANIFEST, name: 'linked-one' });
    symlinkSync(elsewhere, join(project, 'plugins', 'linked-one'), 'dir');

    let result = runValidator('', project);
    expect(result.status).toBeGreaterThan(0);
    expect(result.stderr).toMatch(/Plugin directory is a symlink/);
    expect(result.stdout + result.stderr).toMatch(/real-one/);

    // plugins/ itself a symlink: refused before any entry is read.
    const project2 = join(tmpRoot, 'project2');
    mkdirSync(project2, { recursive: true });
    symlinkSync(join(project, 'plugins'), join(project2, 'plugins'), 'dir');
    result = runValidator('', project2);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/plugins\/ is a symlink/);

    // A dangling plugins/ symlink is refused too, not "no plugins/".
    const project3 = join(tmpRoot, 'project3');
    mkdirSync(project3, { recursive: true });
    symlinkSync(join(tmpRoot, 'nonexistent'), join(project3, 'plugins'), 'dir');
    result = runValidator('', project3);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/plugins\/ is a symlink/);
  });

  it('errors when the symlinked plugin root is given with a trailing slash (lstat would follow it)', () => {
    const realPlugin = join(tmpRoot, 'real-slash');
    mkdirSync(realPlugin, { recursive: true });
    writePluginManifest(realPlugin, { ...VALID_BASE_MANIFEST, name: 'slash-linked' });
    const link = join(tmpRoot, 'slash-linked');
    symlinkSync(realPlugin, link, 'dir');
    const { status, stderr } = runValidator(link + '/');
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/Plugin directory is a symlink/);
  });

  it('rejects `..` and symlinked ancestors in path fields (agents/commands/skills), not only in hook scripts', () => {
    // agents: ./shared/agents where shared -> a directory outside the plugin
    const outside = join(tmpRoot, 'outside');
    mkdirSync(join(outside, 'agents'), { recursive: true });
    writeFileSync(join(outside, 'agents', 'a.md'), '# a\n', 'utf8');
    symlinkSync(outside, join(pluginDir, 'shared'), 'dir');
    writePluginManifest(pluginDir, { ...VALID_BASE_MANIFEST, agents: './shared/agents' });
    let result = runValidator(pluginDir);
    expect(result.status).toBeGreaterThan(0);
    expect(result.stderr).toMatch(/agents path passes through a symlinked directory \(shared\)/);

    // commands: ./docs/../commands folds to ./commands lexically
    mkdirSync(join(pluginDir, 'commands'), { recursive: true });
    writeFileSync(join(pluginDir, 'commands', 'c.md'), '# c\n', 'utf8');
    writePluginManifest(pluginDir, { ...VALID_BASE_MANIFEST, commands: './docs/../commands' });
    result = runValidator(pluginDir);
    expect(result.status).toBeGreaterThan(0);
    expect(result.stderr).toMatch(/commands path escapes plugin directory/);
  });

  it('errors on a dangling hooks/hooks.json symlink (RULE 7 uses lstat, not existsSync)', () => {
    // existsSync follows the link and says "absent"; the directory entry is
    // still there for Claude Code to auto-load, and springs back to life the
    // moment its target reappears.
    mkdirSync(join(pluginDir, 'hooks'), { recursive: true });
    symlinkSync(
      join(tmpRoot, 'does-not-exist.json'),
      join(pluginDir, 'hooks', 'hooks.json'),
      'file'
    );
    writePluginManifest(pluginDir, VALID_BASE_MANIFEST);
    const { status, stderr } = runValidator(pluginDir);
    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/hooks\/hooks\.json: not allowed/);
  });

  it('treats hooks/hooks.json as absent when `hooks` is a plain file (ENOTDIR — one policy with the generator)', () => {
    writeFileSync(join(pluginDir, 'hooks'), 'not a directory\n', 'utf8');
    writePluginManifest(pluginDir, VALID_BASE_MANIFEST);
    const { status, stderr } = runValidator(pluginDir);
    expect(stderr).not.toMatch(/hooks\/hooks\.json/);
    expect(status).toBe(0);
  });
});
