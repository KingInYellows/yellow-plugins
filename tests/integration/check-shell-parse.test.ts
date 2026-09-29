/**
 * Integration tests for `scripts/check-shell-parse.js`, the differential
 * `bash -n` / `zsh -n` check. The parse cases need a real zsh and skip when
 * it is not installed; the missing-zsh behaviour is tested with a bogus
 * SHELL_PARSE_ZSH so it runs everywhere.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const CHECKER = resolve(
  __dirname,
  '..',
  '..',
  'scripts',
  'check-shell-parse.js'
);
const HAS_ZSH = spawnSync('zsh', ['-c', 'exit 0']).status === 0;

let root: string;

function write(rel: string, content: string): void {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function run(env: Record<string, string> = {}, ...args: string[]) {
  const result = spawnSync('node', [CHECKER, ...args], {
    env: { ...process.env, CI: '', VALIDATE_SHELL_COMPAT_ROOT: root, ...env },
    encoding: 'utf8',
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'shell-parse-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!HAS_ZSH)('with zsh installed', () => {
  it('passes blocks both shells parse', () => {
    write(
      'plugins/demo/commands/ok.md',
      '```bash\nfor x in a b; do printf "%s\\n" "$x"; done\n```\n'
    );
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('1 shell block(s) parsed');
  });

  it('ignores template blocks that fail in both shells', () => {
    write(
      'plugins/demo/commands/tpl.md',
      '```bash\ngt checkout <branch>\n```\n'
    );
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('1 fail both shells');
  });

  it('fails a block that parses in bash but not in zsh, with file and line', () => {
    write(
      'plugins/demo/skills/lock/SKILL.md',
      [
        '# Lock',
        '',
        '```bash',
        '( flock -x 200; true ) 200>"$LOCK_FILE"',
        '```',
        '',
      ].join('\n')
    );
    const failed = run();
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain('plugins/demo/skills/lock/SKILL.md:3');
    const report = run({}, '--report');
    expect(report.status).toBe(0);
    expect(report.stdout).toContain('plugins/demo/skills/lock/SKILL.md:3');
  });

  it('only checks bash/sh/shell fences and skips generated skill copies', () => {
    write('plugins/demo/commands/py.md', '```python\n( x ) 200>"$y"\n```\n');
    write(
      'plugins/demo/codex/skills/s/SKILL.md',
      '```bash\n( x ) 200>"$y"\n```\n'
    );
    expect(run().status).toBe(0);
  });
});

describe('without zsh', () => {
  it('skips with a warning locally', () => {
    const result = run({ SHELL_PARSE_ZSH: '/nonexistent/zsh' });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('SKIP: zsh not found');
  });

  it('fails in CI so the check cannot silently do nothing', () => {
    const result = run({ SHELL_PARSE_ZSH: '/nonexistent/zsh', CI: 'true' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('zsh not found');
  });
});
