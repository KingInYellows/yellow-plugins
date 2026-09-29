/**
 * Integration tests for `scripts/check-shell-parse.js`, the differential
 * `bash -n` / `zsh -n` check. The parse cases need a real zsh and skip when
 * it is not installed; the missing-zsh behaviour is tested with a bogus
 * SHELL_PARSE_ZSH so it runs everywhere.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
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

function run(env: Record<string, string> = {}) {
  const result = spawnSync('node', [CHECKER], {
    env: {
      ...process.env,
      CI: '',
      SHELL_COMPAT_REQUIRE_ZSH: '',
      VALIDATE_SHELL_COMPAT_ROOT: root,
      ...env,
    },
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
    expect(result.stdout).toContain('1 shell block(s) and 0 wrapper');
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
  });

  it('only checks bash/sh/shell fences and skips generated skill copies', () => {
    write('plugins/demo/commands/ok.md', '```bash\ntrue\n```\n');
    write('plugins/demo/commands/py.md', '```python\n( x ) 200>"$y"\n```\n');
    write(
      'plugins/demo/codex/skills/s/SKILL.md',
      '```bash\n( x ) 200>"$y"\n```\n'
    );
    expect(run().status).toBe(0);
  });
});

// A stand-in zsh: answers the availability probe, then runs `parse` for
// every `-n` call. Lets the fail-closed paths run without a real zsh.
function fakeZsh(parse: string): string {
  const bin = join(root, 'fake-zsh');
  writeFileSync(bin, `#!/bin/sh\n[ "$1" = -c ] && exit 0\n${parse}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

describe('fails closed', () => {
  const block = '```bash\ntrue\n```\n';

  it('errors when the parse driver is killed', () => {
    write('plugins/demo/commands/a.md', block);
    // $PPID is the driver's command-substitution subshell; its parent is
    // the driver itself.
    const zsh = fakeZsh('kill -9 $(ps -o ppid= -p "$PPID")');
    const result = run({ SHELL_PARSE_ZSH: zsh });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ERROR:');
    expect(result.stderr).toContain('killed by SIGKILL');
  });

  it('errors when the parse driver hangs past its timeout', () => {
    write('plugins/demo/commands/a.md', block);
    const zsh = fakeZsh('sleep 30');
    const result = run({ SHELL_PARSE_ZSH: zsh, SHELL_PARSE_TIMEOUT_MS: '500' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ERROR:');
  });

  it('reports only the first line of a multi-line parse error', () => {
    write('plugins/demo/commands/a.md', block);
    const zsh = fakeZsh(
      'printf "%s\\n" "$3:1: first problem" "second line" >&2; exit 1'
    );
    const result = run({ SHELL_PARSE_ZSH: zsh });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'plugins/demo/commands/a.md:1 — line 1: first problem'
    );
    expect(result.stderr).not.toContain('second line');
  });

  it('errors when no shell blocks are found', () => {
    write('plugins/demo/commands/a.md', '```python\npass\n```\n');
    const result = run({ SHELL_PARSE_ZSH: fakeZsh('exit 0') });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ERROR: no shell blocks found');
  });

  it('errors when there is no plugins/ directory', () => {
    const result = run({ SHELL_PARSE_ZSH: fakeZsh('exit 0') });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ERROR: no plugins/ directory');
  });

  it('fails a wrapper body that bash cannot parse', () => {
    write(
      'plugins/demo/commands/w.md',
      "# W\n\n```bash\nbash /dev/fd/3 3<<'__W__'\nif then\n__W__\n```\n"
    );
    const result = run({ SHELL_PARSE_ZSH: fakeZsh('exit 0') });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'plugins/demo/commands/w.md:5 — bash wrapper body: line 1:'
    );
  });

  it('fails a wrapper whose tag is never closed', () => {
    write(
      'plugins/demo/commands/w.md',
      "```bash\nbash /dev/fd/3 3<<'__W__'\ntrue\n```\n"
    );
    const result = run({ SHELL_PARSE_ZSH: fakeZsh('exit 0') });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('wrapper tag __W__ is never closed');
  });
});

describe('without zsh', () => {
  it('skips with a warning locally', () => {
    const result = run({ SHELL_PARSE_ZSH: '/nonexistent/zsh' });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('SKIP: zsh not found');
  });

  it.each([
    ['CI=true', { CI: 'true' }],
    ['CI=1', { CI: '1' }],
    ['SHELL_COMPAT_REQUIRE_ZSH=1', { SHELL_COMPAT_REQUIRE_ZSH: '1' }],
  ])('fails under %s so the check cannot silently do nothing', (_n, env) => {
    const result = run({ SHELL_PARSE_ZSH: '/nonexistent/zsh', ...env });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('zsh not found');
  });

  it.each(['false', '0'])('still skips under CI=%s', (ci) => {
    const result = run({ SHELL_PARSE_ZSH: '/nonexistent/zsh', CI: ci });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('SKIP: zsh not found');
  });
});
