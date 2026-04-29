/**
 * Integration test for the W1.5 read-only-reviewer rule in
 * `scripts/validate-agent-authoring.js`.
 *
 * Verifies that:
 *   1. A synthetic violator (a `agents/review/<file>.md` listing `Bash` in
 *      its `tools:` block, at a path NOT in REVIEW_AGENT_ALLOWLIST) is
 *      detected and the validator exits with a non-zero code.
 *   2. A file at the allowlisted path
 *      (`yellow-codex/agents/review/codex-reviewer.md`) with the same
 *      violation passes — the documented exception is honored.
 *   3. A clean review agent (`tools: [Read, Grep, Glob]`) passes.
 *
 * The test parameterizes the validator via `VALIDATE_PLUGINS_DIR` so it
 * never touches the real `plugins/` tree. Each case writes a small fixture
 * to a temp directory under `os.tmpdir()` and runs the validator as a child
 * process.
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

function writeAgent(
  pluginsDir: string,
  pluginRelative: string,
  body: string
): void {
  const fullPath = join(pluginsDir, pluginRelative);
  const dir = dirname(fullPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, body, 'utf8');
}

const REVIEW_AGENT_BASH_VIOLATOR = `---
name: synth-violator
description: "Test fixture. Use when verifying W1.5 rule fires."
model: inherit
tools:
  - Read
  - Grep
  - Glob
  - Bash
---

Body for synth-violator. The 'tools:' list above includes Bash, which is
forbidden for review/ agents that are not on the allowlist.
`;

const REVIEW_AGENT_CLEAN = `---
name: clean-reviewer
description: "Test fixture. Use when verifying clean review agents pass W1.5."
model: inherit
tools:
  - Read
  - Grep
  - Glob
---

Clean reviewer body.
`;

describe('validate-agent-authoring W1.5 read-only reviewer rule', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'yellow-validate-w15-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('flags a non-allowlisted review agent that lists Bash in tools', () => {
    writeAgent(
      tmpRoot,
      'yellow-test/agents/review/synth-violator.md',
      REVIEW_AGENT_BASH_VIOLATOR
    );

    const { status, stderr } = runValidator(tmpRoot);

    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/synth-violator\.md/);
    expect(stderr).toMatch(/review\/ agent must not include Bash/);
    expect(stderr).toMatch(/W1\.5 rule/);
  });

  it('honors REVIEW_AGENT_ALLOWLIST for codex-reviewer.md (documented exception)', () => {
    writeAgent(
      tmpRoot,
      'yellow-codex/agents/review/codex-reviewer.md',
      REVIEW_AGENT_BASH_VIOLATOR.replace(
        'synth-violator',
        'codex-reviewer'
      )
    );

    const { status, stderr } = runValidator(tmpRoot);

    expect(status).toBe(0);
    expect(stderr).not.toMatch(/codex-reviewer\.md.*review\/ agent/);
  });

  it('passes a clean review agent with [Read, Grep, Glob] only', () => {
    writeAgent(
      tmpRoot,
      'yellow-test/agents/review/clean-reviewer.md',
      REVIEW_AGENT_CLEAN
    );

    const { status, stderr } = runValidator(tmpRoot);

    expect(status).toBe(0);
    expect(stderr).not.toMatch(/clean-reviewer\.md.*review\/ agent/);
  });

  it('flags Write and Edit (not just Bash) in review agent tools', () => {
    const writeViolator = REVIEW_AGENT_BASH_VIOLATOR
      .replace('synth-violator', 'write-violator')
      .replace('  - Bash', '  - Write\n  - Edit');
    writeAgent(
      tmpRoot,
      'yellow-test/agents/review/write-violator.md',
      writeViolator
    );

    const { status, stderr } = runValidator(tmpRoot);

    expect(status).toBeGreaterThan(0);
    expect(stderr).toMatch(/write-violator\.md/);
    expect(stderr).toMatch(/Write, Edit/);
  });

  it('does NOT flag non-review agents (e.g., agents/workflow/)', () => {
    // pr-comment-resolver legitimately needs Bash and Edit; it lives under
    // agents/workflow/ not agents/review/ and Rule X does not apply.
    writeAgent(
      tmpRoot,
      'yellow-test/agents/workflow/some-worker.md',
      REVIEW_AGENT_BASH_VIOLATOR.replace('synth-violator', 'some-worker')
    );

    const { status, stderr } = runValidator(tmpRoot);

    expect(status).toBe(0);
    expect(stderr).not.toMatch(/some-worker\.md.*review\/ agent/);
  });
});
