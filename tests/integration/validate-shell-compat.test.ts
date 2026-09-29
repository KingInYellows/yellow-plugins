/**
 * Integration tests for `scripts/validate-shell-compat.js`.
 *
 * Rule behaviour is exercised through the exported `lintShellText` (fast,
 * no filesystem). File-level behaviour — tier lists, SHC-008 sourcing,
 * allowlist governance, generated-copy exclusion, exit codes — runs the
 * script against a fixture tree via VALIDATE_SHELL_COMPAT_ROOT.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/* eslint-disable @typescript-eslint/no-var-requires -- scripts/ is plain CJS */
const {
  lintShellText,
  classifyLines,
} = require('../../scripts/validate-shell-compat.js');
/* eslint-enable @typescript-eslint/no-var-requires */

const VALIDATOR = resolve(
  __dirname,
  '..',
  '..',
  'scripts',
  'validate-shell-compat.js'
);
const EMPTY_CTX = { shellFiles: [], tier3: new Set(), tier4: new Set() };

type Finding = { rule: string; line: number; detail: string };

function lint(text: string): Finding[] {
  return lintShellText(text, 'plugins/p/x.md', 1, EMPTY_CTX);
}

function rules(text: string): string[] {
  return lint(text).map((f) => f.rule);
}

describe('inline rules', () => {
  it.each([
    [
      'SHC-001 redirect onto a mktemp file',
      'f=$(mktemp)\necho hi > "$f"',
      'SHC-001',
    ],
    [
      'SHC-001 stderr redirect onto a mktemp file',
      'e=$(mktemp)\ncmd 2>"$e"',
      'SHC-001',
    ],
    ['SHC-001 truncate a touched file', 'touch "$L"\n: > "$L"', 'SHC-001'],
    [
      'SHC-001 second > onto the same target',
      'cmd > "$out"\ncmd2 > "$out"',
      'SHC-001',
    ],
    ['SHC-002 path assignment', 'path="docs/x.md"', 'SHC-002'],
    ['SHC-002 local status', 'f() { local status="$1"; }', 'SHC-002'],
    ['SHC-002 for loop over path', 'for path in a b; do :; done', 'SHC-002'],
    ['SHC-002 read into status', 'read -r status rest <<< "$x"', 'SHC-002'],
    ['SHC-003 mapfile', 'mapfile -t arr < <(ls)', 'SHC-003'],
    ['SHC-003 key expansion', 'for k in "${!map[@]}"; do :; done', 'SHC-003'],
    ['SHC-003 read -a', 'IFS=. read -r -a parts <<< "$v"', 'SHC-003'],
    ['SHC-003 BASH_REMATCH', 'echo "${BASH_REMATCH[1]}"', 'SHC-003'],
    ['SHC-003 BASH_VERSINFO', 'v=${BASH_VERSINFO[0]:-0}', 'SHC-003'],
    ['SHC-003 case modification', 'lower=${name,,}', 'SHC-003'],
    ['SHC-003 nameref', 'f() { local -n ref=$1; }', 'SHC-003'],
    ['SHC-003 multi-digit fd', 'exec 200>"$lock_file"', 'SHC-003'],
    ['SHC-003 RETURN trap', 'trap \'rm -f "$t"\' RETURN', 'SHC-003'],
    ['SHC-004 echo -e', 'echo -e "a\\tb"', 'SHC-004'],
    ['SHC-004 echo with escape', "echo 'line1\\nline2'", 'SHC-004'],
    ['SHC-005 literal index', 'first=${arr[0]}', 'SHC-005'],
    ['SHC-005 index with a modifier', 'i=0\nx="${a[i]:-0}"', 'SHC-005'],
    ['SHC-001 quoted mktemp', 'f="$(mktemp)"\ncmd 2>"$f"', 'SHC-001'],
    ['SHC-001 backtick mktemp', 'f=`mktemp`\ncmd >"$f"', 'SHC-001'],
    ['SHC-004 echo with \\x escape', "echo 'caf\\xc3'", 'SHC-004'],
    [
      'SHC-005 variable index from 0',
      'i=0\nwhile :; do x=${arr[$i]}; done',
      'SHC-005',
    ],
    ['SHC-006 single-bracket ==', 'if [ "$a" == "b" ]; then :; fi', 'SHC-006'],
    ['SHC-007 rcquotes', "printf '%s\\n' 'it''s'", 'SHC-007'],
    [
      'SHC-001 redirect onto a mktemp file with a /dev/null fallback',
      'e=$(mktemp)\ncmd 2>"${e:-/dev/null}"',
      'SHC-001',
    ],
  ])('%s', (_name, text, rule) => {
    expect(rules(text)).toContain(rule);
  });

  it('flags each of two adjacent redirects onto bare variables', () => {
    const findings = lint('f=$(mktemp)\ng=$(mktemp)\ncmd >$f>$g');
    expect(findings.map((f) => [f.rule, f.detail])).toEqual([
      ['SHC-001', expect.stringContaining('$f')],
      ['SHC-001', expect.stringContaining('$g')],
    ]);
  });

  it.each([
    ['>| on a mktemp file', 'f=$(mktemp)\necho hi >| "$f"'],
    ['>> on a mktemp file', 'f=$(mktemp)\necho hi >> "$f"'],
    ['mktemp -u path', 'f=$(mktemp -u)\necho hi > "$f"'],
    ['>| with a /dev/null fallback', 'e=$(mktemp)\ncmd 2>|"${e:-/dev/null}"'],
    ['a path built from the variable', 'f=$(mktemp)\ncmd 2>"$f.err"'],
    ['single-digit fd on a subshell', '( flock -x 9; true ) 9>>"$lock"'],
    ['arithmetic comparison', 'x=$(( 10 > 3 ))'],
    ['truncating /dev/null', ': > /dev/null'],
    ['2>&1', 'f=$(mktemp)\ncmd >"$g" 2>&1'],
    ['file_path is not path', 'file_path=x; my_status=1'],
    ['declare -A alone', 'declare -A seen'],
    ['read -r and -d', "IFS= read -r -d '' line"],
    ['printf with escapes', "printf 'a\\tb\\n'"],
    ['array iteration', 'for x in "${arr[@]}"; do :; done'],
    ['double-bracket ==', '[[ "$a" == b* ]]'],
    ['escaped quote idiom', "printf 'it'\\''s\\n'"],
    ['bash-only text inside an awk program', "awk '{ print ${!x} }' f"],
  ])('does not flag %s', (_name, text) => {
    expect(lint(text)).toEqual([]);
  });

  it('skips comments, heredoc data and bash wrapper bodies', () => {
    const text = [
      '# mapfile -t x < f   (a comment)',
      "cat <<'EOF'",
      'path=/not/shell/here',
      'EOF',
      "bash /dev/fd/3 3<<'__W__'",
      'mapfile -t lines < f',
      'for k in "${!m[@]}"; do :; done',
      '__W__',
    ].join('\n');
    expect(lint(text)).toEqual([]);
  });

  it('flags bash-only code after the wrapper closes', () => {
    const text = [
      "bash /dev/fd/3 3<<'__W__'",
      'mapfile -t a < f',
      '__W__',
      'mapfile -t b < f',
    ].join('\n');
    expect(lint(text).map((f) => [f.rule, f.line])).toEqual([['SHC-003', 4]]);
  });

  it('keeps linting the outer shell after `bash -c`', () => {
    expect(rules("bash -c 'true'; mapfile -t x < f")).toEqual(['SHC-003']);
    expect(rules("if bash -c 'true'; then path=x; fi")).toEqual(['SHC-002']);
    expect(rules("bash -c 'mapfile -t x < f'")).toEqual([]);
    expect(rules('bash -c "mapfile -t x < f"')).toEqual([]);
  });

  it('flags a wrapper that feeds the script to bash on stdin (SHC-009)', () => {
    const text = ["bash <<'EOF'", 'mapfile -t a < f', 'EOF'].join('\n');
    expect(lint(text).map((f) => [f.rule, f.line, f.detail])).toEqual([
      ['SHC-009', 1, 'script fed to bash on stdin'],
    ]);
  });

  it('flags the bash -c "$(cat <<TAG …)" wrapper the git-push hook refuses (SHC-009)', () => {
    const text = [
      `bash -c "$(cat <<'__W__'`,
      'mapfile -t a < f',
      '__W__',
      ')"',
    ].join('\n');
    const [finding] = lint(text);
    expect(finding.rule).toBe('SHC-009');
    expect(finding.detail).toContain('git-push hook');
  });

  it('treats arithmetic `<<` and `>` as operators, not heredocs or redirects', () => {
    const text = [
      'x=$((1 << n))',
      'mapfile -t a < f',
      '(( n > $limit )) && (( m > $limit ))',
    ].join('\n');
    expect(lint(text).map((f) => [f.rule, f.line])).toEqual([['SHC-003', 2]]);
  });

  it('skips the inside of a multi-line quoted program but lints the closing line', () => {
    const text = [
      'f=$(mktemp)',
      'python3 -c "',
      'for path in sys.argv:',
      '    print(path)',
      '" "$in" > "$f"',
    ].join('\n');
    expect(lint(text).map((f) => [f.rule, f.line])).toEqual([['SHC-001', 5]]);
  });

  it('checks expansions inside multi-line double-quoted strings and unquoted heredocs', () => {
    const text = [
      'REPORT="',
      '## ${reviewer^} Output',
      '"',
      'cat <<EOF',
      'first ${arr[0]}',
      'EOF',
      "cat <<'EOF'",
      '${name^} stays literal here',
      'EOF',
    ].join('\n');
    expect(lint(text).map((f) => [f.rule, f.line])).toEqual([
      ['SHC-003', 2],
      ['SHC-005', 5],
    ]);
  });

  it('does not run statement rules on expanded-only text', () => {
    const text = ['cat <<EOF', 'path=/x mapfile echo -e', 'EOF'].join('\n');
    expect(lint(text)).toEqual([]);
  });

  it('falls back to plain lines when a quote never closes', () => {
    const lines = ["echo it's", 'mapfile -t a < f'];
    expect(classifyLines(lines).map((c: { kind: string }) => c.kind)).toEqual([
      'code',
      'code',
    ]);
    expect(rules(lines.join('\n'))).toContain('SHC-003');
  });

  it('reports 1-based line numbers offset by the block start', () => {
    const [finding] = lintShellText(
      'true\npath=x',
      'plugins/p/x.md',
      40,
      EMPTY_CTX
    );
    expect(finding.line).toBe(41);
  });
});

// --- fixture-tree tests ----------------------------------------------------

let root: string;

function write(rel: string, content: string): void {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function config(extra: Record<string, unknown> = {}): void {
  write(
    'scripts/shell-compat-config.json',
    JSON.stringify({
      tier3Libraries: ['plugins/demo/lib/bashonly.sh'],
      tier4Libraries: ['plugins/demo/lib/dual.sh'],
      allowlist: {},
      ...extra,
    })
  );
}

function run(...args: string[]): {
  status: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync('node', [VALIDATOR, ...args], {
    env: { ...process.env, VALIDATE_SHELL_COMPAT_ROOT: root },
    encoding: 'utf8',
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function md(body: string): string {
  return ['# Demo', '', '```bash', body, '```', ''].join('\n');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'shell-compat-'));
  write(
    'plugins/demo/lib/bashonly.sh',
    '#!/usr/bin/env bash\nmapfile -t x < f\n'
  );
  write(
    'plugins/demo/lib/dual.sh',
    '#!/usr/bin/env bash\ndual_fn() { printf "%s\\n" ok; }\n'
  );
  config();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('fixture runs', () => {
  it('passes a clean tree', () => {
    write('plugins/demo/commands/ok.md', md('printf "%s\\n" hi'));
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[validate-shell-compat] OK');
  });

  it('fails with file, line and rule, and --report exits 0 with the same findings', () => {
    write('plugins/demo/commands/bad.md', md('path=x'));
    const failed = run();
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain('plugins/demo/commands/bad.md:4 [SHC-002]');
    const report = run('--report');
    expect(report.status).toBe(0);
    expect(report.stdout).toContain('plugins/demo/commands/bad.md:4 [SHC-002]');
  });

  it('flags a tier 3 library sourced outside a wrapper, not inside one', () => {
    write(
      'plugins/demo/commands/src.md',
      md('. "${CLAUDE_PLUGIN_ROOT}/lib/bashonly.sh"')
    );
    write(
      'plugins/demo/commands/wrapped.md',
      md(
        `bash /dev/fd/3 3<<'__W__'\n. "\${CLAUDE_PLUGIN_ROOT}/lib/bashonly.sh"\n__W__`
      )
    );
    const result = run();
    expect(result.stderr).toContain('commands/src.md:4 [SHC-008]');
    expect(result.stderr).not.toContain('wrapped.md');
  });

  it('allows a tier 4 library to be sourced directly but lints the library itself', () => {
    write(
      'plugins/demo/commands/dual.md',
      md('source "${CLAUDE_PLUGIN_ROOT}/lib/dual.sh" && dual_fn')
    );
    expect(run().status).toBe(0);
    write(
      'plugins/demo/lib/dual.sh',
      '#!/usr/bin/env bash\nf() { local status=1; }\n'
    );
    const result = run();
    expect(result.stderr).toContain('plugins/demo/lib/dual.sh:2 [SHC-002]');
  });

  it('flags a sourced plugin library that is in neither tier', () => {
    write('plugins/demo/lib/new.sh', '#!/usr/bin/env bash\n');
    write(
      'plugins/demo/commands/new.md',
      md('. "${CLAUDE_PLUGIN_ROOT}/lib/new.sh"')
    );
    expect(run().stderr).toContain('plugins/demo/lib/new.sh is not classified');
  });

  it('resolves cross-plugin sourced libraries against their own tier', () => {
    write('plugins/other/lib/b3.sh', '#!/usr/bin/env bash\n');
    write('plugins/other/lib/b4.sh', '#!/usr/bin/env bash\n');
    write('plugins/other/lib/new.sh', '#!/usr/bin/env bash\n');
    config({
      tier3Libraries: [
        'plugins/demo/lib/bashonly.sh',
        'plugins/other/lib/b3.sh',
      ],
      tier4Libraries: ['plugins/demo/lib/dual.sh', 'plugins/other/lib/b4.sh'],
    });
    const src = (lib: string) =>
      `. "\${CLAUDE_PLUGIN_ROOT}/../other/lib/${lib}"`;
    write('plugins/demo/commands/t3.md', md(src('b3.sh')));
    write(
      'plugins/demo/commands/t3w.md',
      md(`bash -c "$(cat <<'__W__'\n${src('b3.sh')}\n__W__\n)"`)
    );
    write('plugins/demo/commands/t4.md', md(src('b4.sh')));
    write('plugins/demo/commands/un.md', md(src('new.sh')));
    const dsrc = (lib: string) =>
      `. "\${CLAUDE_PLUGIN_ROOT:-}/../other/lib/${lib}"`;
    write('plugins/demo/commands/d3.md', md(dsrc('b3.sh')));
    write('plugins/demo/commands/d4.md', md(dsrc('b4.sh')));
    const result = run();
    expect(result.stderr).toContain('commands/t3.md:4 [SHC-008]');
    expect(result.stderr).toContain('commands/d3.md:4 [SHC-008]');
    expect(result.stderr).not.toContain('d4.md');
    expect(result.stderr).not.toContain('t3w.md');
    expect(result.stderr).not.toContain('t4.md');
    expect(result.stderr).toContain('commands/un.md:4 [SHC-008]');
    expect(result.stderr).toContain(
      'plugins/other/lib/new.sh is not classified'
    );
  });

  it('shares UPPERCASE mktemp handoff variables across files of a plugin', () => {
    write('plugins/demo/agents/make.md', md('OUTPUT_FILE=$(mktemp)'));
    write('plugins/demo/skills/use/SKILL.md', md('cmd > "$OUTPUT_FILE"'));
    write('plugins/other/skills/use/SKILL.md', md('cmd > "$OUTPUT_FILE"'));
    const result = run();
    expect(result.stderr).toContain(
      'plugins/demo/skills/use/SKILL.md:4 [SHC-001]'
    );
    expect(result.stderr).not.toContain('plugins/other/');
  });

  it('skips generated codex/cursor skill copies, tests/ and CHANGELOG.md', () => {
    for (const rel of [
      'plugins/demo/codex/skills/s/SKILL.md',
      'plugins/demo/cursor/skills/s/SKILL.md',
      'plugins/demo/tests/fixtures/x.md',
      'plugins/demo/CHANGELOG.md',
    ]) {
      write(rel, md('path=x'));
    }
    expect(run().status).toBe(0);
  });

  it('flags a plugin .sh file with no shebang unless it carries the library marker', () => {
    write('plugins/demo/scripts/bare.sh', 'echo hi\n');
    write(
      'plugins/demo/scripts/marked.sh',
      '# shell-compat: library\necho hi\n'
    );
    const result = run();
    expect(result.stderr).toContain('plugins/demo/scripts/bare.sh:1 [SHC-101]');
    expect(result.stderr).not.toContain('marked.sh');
  });

  describe('allowlist', () => {
    beforeEach(() => {
      write('plugins/demo/commands/a.md', md('first=${arr[0]}'));
    });

    it('accepts findings within the cap', () => {
      config({
        allowlist: {
          'plugins/demo/commands/a.md': {
            'SHC-005': { max: 1, reason: 'demo' },
          },
        },
      });
      const result = run();
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('1 allowlisted finding(s)');
    });

    it('fails findings above the cap', () => {
      write(
        'plugins/demo/commands/a.md',
        md('first=${arr[0]}\nsecond=${arr[1]}')
      );
      config({
        allowlist: {
          'plugins/demo/commands/a.md': {
            'SHC-005': { max: 1, reason: 'demo' },
          },
        },
      });
      expect(run().status).toBe(1);
    });

    it('fails a stale cap and an empty reason', () => {
      config({
        allowlist: {
          'plugins/demo/commands/a.md': { 'SHC-005': { max: 3, reason: '' } },
        },
      });
      const result = run();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('reason is required');
      expect(result.stderr).toContain(
        'stale allowlist entry plugins/demo/commands/a.md SHC-005'
      );
    });
  });

  it('reports a tier list entry that does not exist', () => {
    config({ tier3Libraries: ['plugins/demo/lib/missing.sh'] });
    expect(run().stderr).toContain(
      'listed library plugins/demo/lib/missing.sh does not exist'
    );
  });
});
