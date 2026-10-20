/**
 * Integration tests for `scripts/validate-shell-compat.js`.
 *
 * Rule behaviour is exercised through the exported `lintShellText` (fast,
 * no filesystem). File-level behaviour — tier lists, SHC-008 sourcing,
 * allowlist governance, generated-copy exclusion, exit codes — runs the
 * script against a fixture tree via VALIDATE_SHELL_COMPAT_ROOT.
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

/* eslint-disable @typescript-eslint/no-var-requires -- scripts/ is plain CJS */
const {
  lintShellText,
  classifyLines,
  findFdWrappers,
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
    [
      'SHC-001 redirect inside a [[ ]] substitution',
      'f=$(mktemp)\n[[ -n $(cmd > "$f") ]]',
      'SHC-001',
    ],
    [
      'SHC-001 redirect inside a (( )) substitution',
      'f=$(mktemp)\n(( $(cmd > "$f") > 0 ))',
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
    ['SHC-002 path assignment in a brace group', '{ path=x; }', 'SHC-002'],
    ['SHC-003 BASH_SOURCE length', 'n=${#BASH_SOURCE[@]}', 'SHC-003'],
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
    ['single-quoted mktemp literal', 'f=\'$(mktemp)\'\necho hi > "$f"'],
    [
      'single-quoted touch operand',
      'f=$(mktemp -u)\ntouch \'$f\'\necho hi > "$f"',
    ],
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
    ['string comparison in [[ ]]', '[[ $a > $b ]]'],
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

  it.each([
    ['fd mismatch', "bash /dev/fd/3 4<<'__W__'", 'heredoc feeds fd 4'],
    ['bash -c with the fd path', "bash -c /dev/fd/3 3<<'__W__'", 'git-push'],
    ['bash -ec with the fd path', "bash -ec /dev/fd/3 3<<'__W__'", 'git-push'],
    [
      'bash -s before the fd path',
      "bash -s /dev/fd/3 3<<'__W__'",
      'may precede',
    ],
    ['an unquoted operand', "bash /dev/fd/3 $x 3<<'__W__'", 'may precede'],
    ['a sudo prefix', "sudo bash /dev/fd/3 3<<'__W__'", 'no sudo'],
    ['an env prefix', "env X=1 bash /dev/fd/3 3<<'__W__'", 'no sudo'],
    [
      'a command-substitution `)` prefix',
      "$(foo) bash /dev/fd/3 3<<'__W__'",
      'no sudo',
    ],
    ['a multi-digit fd', "bash /dev/fd/10 10<<'__W__'", 'single-digit'],
    ['stdin with options', "bash -s -- x <<'__W__'", 'on stdin'],
    [
      'an unquoted heredoc tag',
      'bash /dev/fd/3 3<<__W__',
      'quote the heredoc tag',
    ],
  ])('rejects %s as a wrapper (SHC-009)', (_name, opener, detail) => {
    const text = [opener, 'true', '__W__'].join('\n');
    const findings = lint(text).filter((f) => f.rule === 'SHC-009');
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain(detail);
  });

  it.each([
    ['after &&', "cd /x && bash /dev/fd/3 3<<'__W__'"],
    ['with --norc', "bash --norc /dev/fd/3 3<<'__W__'"],
    [
      'with every allowed option',
      "bash --norc --noprofile -eu -x -o pipefail -- /dev/fd/3 3<<'__W__'",
    ],
    ['on fd 5', "bash /dev/fd/5 5<<'__W__'"],
    ['with quoted operands', `bash /dev/fd/3 'a b' "$x" "\${y}" 3<<'__W__'`],
    ['after if', "if bash /dev/fd/3 3<<'__W__'"],
    ['in a command substitution', "out=$(bash /dev/fd/3 3<<'__W__'"],
    ['after command', "command bash /dev/fd/3 3<<'__W__'"],
    ['with a placeholder operand', "bash /dev/fd/3 '<todo-path>' 3<<'__W__'"],
    ['in a same-line case arm', `case "$x" in y) bash /dev/fd/3 3<<'__W__'`],
    ['in a line-leading case arm', "  y) bash /dev/fd/3 3<<'__W__'"],
    ['in an alternation case arm', "a|b) bash /dev/fd/3 3<<'__W__'"],
    ['with a double-quoted tag', 'bash /dev/fd/3 3<<"__W__"'],
    ['with a tab-stripping quoted tag', "bash /dev/fd/3 3<<-'__W__'"],
  ])('accepts the fd wrapper %s', (_name, opener) => {
    expect(lint([opener, 'mapfile -t a < f', '__W__'].join('\n'))).toEqual([]);
  });

  it('lints the rest of the wrapper line in the current shell', () => {
    const text = [
      'out=$(mktemp)',
      `bash /dev/fd/3 3<<'__W__' >"$out"`,
      'mapfile -t a < f',
      '__W__',
    ].join('\n');
    expect(lint(text).map((f) => [f.rule, f.line])).toEqual([['SHC-001', 2]]);
  });

  it('treats arithmetic `<<` and `>` as operators, not heredocs or redirects', () => {
    const text = [
      'x=$((1 << n))',
      'mapfile -t a < f',
      '(( n > $limit )) && (( m > $limit ))',
    ].join('\n');
    expect(lint(text).map((f) => [f.rule, f.line])).toEqual([['SHC-003', 2]]);
  });

  it('does not read `[[ a > $f ]]` or `(( n > $f ))` comparisons as redirects', () => {
    const text = 'f=$(mktemp)\n[[ $a > $f ]]\n(( n > $f ))\nx=$(( 1 << n ))';
    expect(lint(text)).toEqual([]);
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

  it('fails with file, line and rule', () => {
    write('plugins/demo/commands/bad.md', md('path=x'));
    const failed = run();
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain('plugins/demo/commands/bad.md:4 [SHC-002]');
  });

  it.skipIf(process.getuid?.() === 0)(
    'fails when a plugin directory cannot be read',
    () => {
      mkdirSync(join(root, 'plugins/demo/locked'));
      chmodSync(join(root, 'plugins/demo/locked'), 0o000);
      try {
        const result = run();
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('ERROR: EACCES');
      } finally {
        chmodSync(join(root, 'plugins/demo/locked'), 0o755);
      }
    }
  );

  it('fails when there is no plugins/ directory', () => {
    rmSync(join(root, 'plugins'), { recursive: true, force: true });
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ERROR: no plugins/ directory');
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
      md(`bash /dev/fd/3 3<<'__W__'\n${src('b3.sh')}\n__W__`)
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

describe('heredoc terminators', () => {
  it('does not close an fd wrapper on `TAG)`', () => {
    const lines = ["bash /dev/fd/3 3<<'TAG'", 'true', 'TAG)'];
    expect(findFdWrappers(lines)).toEqual([{ open: 0, close: -1, tag: 'TAG' }]);
  });

  it('closes an fd wrapper on an exact tag line', () => {
    const lines = ["bash /dev/fd/3 3<<'TAG'", 'true', 'TAG'];
    expect(findFdWrappers(lines)).toEqual([{ open: 0, close: 2, tag: 'TAG' }]);
  });

  it('still closes a command-substitution heredoc on `EOF)`', () => {
    const lines = ["x=$(cat <<'EOF'", 'hello', 'EOF)', 'echo after'];
    const classes = classifyLines(lines);
    expect(classes[2].kind).toBe('data');
    expect(classes[3].kind).toBe('code');
  });

  // Follow-up 14: the shell does not strip trailing blanks from the tag line.
  it('does not close an fd wrapper on a tag line with trailing blanks', () => {
    const lines = ["bash /dev/fd/3 3<<'TAG'", 'true', 'TAG \t', 'TAG'];
    expect(findFdWrappers(lines)).toEqual([{ open: 0, close: 3, tag: 'TAG' }]);
    const findings = lint(lines.slice(0, 3).join('\n'));
    expect(findings.map((f) => [f.rule, f.line])).toEqual([['SHC-009', 3]]);
    expect(findings[0].detail).toContain('trailing blanks');
  });

  it('still closes a data heredoc on a tag line with trailing blanks', () => {
    const lines = ["cat <<'EOF'", 'hello', 'EOF  ', 'mapfile -t a < f'];
    expect(rules(lines.join('\n'))).toEqual(['SHC-003']);
  });
});

// Regressions for plans/shell-compat-followups.md items 11–21.
describe('shell-visible text only', () => {
  it.each([
    // 11: a quoted `<<` is text, not a heredoc that hides later lines.
    ['a quoted heredoc example', `printf '%s\\n' "use cat <<'EOF'"`],
    ['a single-quoted heredoc example', "echo 'cat <<EOF'"],
    // 18: nor is one in a trailing comment.
    ['a heredoc in a trailing comment', "true # example: cat <<'EOF'"],
  ])('keeps linting after %s', (_name, first) => {
    expect(
      lint([first, 'mapfile -t a < f', 'EOF'].join('\n')).map((f) => [
        f.rule,
        f.line,
      ])
    ).toEqual([['SHC-003', 2]]);
  });

  it('still opens a heredoc inside a double-quoted command substitution', () => {
    const lines = [`x="$(cat <<'EOF'`, 'mapfile -t a < f', 'EOF', ')"'];
    expect(classifyLines(lines)[1].kind).toBe('data');
  });

  // 12: literal redirect targets.
  it('flags a second `>` onto the same literal path', () => {
    const findings = lint('cmd > result.json\ncmd2 > "result.json"');
    expect(findings.map((f) => [f.rule, f.line, f.detail])).toEqual([
      ['SHC-001', 2, 'second `>` onto result.json in the same block'],
    ]);
  });

  it.each([
    ['/dev/null', 'cmd > /dev/null\ncmd2 > /dev/null'],
    ['/dev/stderr', 'cmd >/dev/stderr\ncmd2 >/dev/stderr'],
    ['>> appends', 'cmd >> log\ncmd2 >> log'],
    ['>| overwrites', 'cmd >| log\ncmd2 >| log'],
    ['a path built from an expansion', 'cmd > "$d/out"\ncmd2 > "$d/out"'],
    ['a path with $$', 'cmd > out.$$\ncmd2 > out.$$'],
    ['a quoted `>`', 'echo "a > b"\necho "a > b"'],
    ['a placeholder', 'git diff <a>...<b>\ngit diff <a>...<b>'],
  ])('does not flag %s', (_name, text) => {
    expect(lint(text)).toEqual([]);
  });

  it('counts `: > file` as the first write to a literal path', () => {
    expect(
      lint(': > log\ncmd > log').map((f) => [f.rule, f.line, f.detail])
    ).toEqual([
      ['SHC-001', 1, '`: >` truncates log, which may already exist'],
      ['SHC-001', 2, 'second `>` onto log in the same block'],
    ]);
  });

  // 13: a special parameter assigned as a condition.
  it.each([
    'if status=0; then :; fi',
    'while path=x; do :; done',
    'until argv=1; do :; done',
    '! status=1',
  ])('flags `%s` (SHC-002)', (text) => {
    expect(rules(text)).toEqual(['SHC-002']);
  });

  // 15: a mktemp in a comment or quoted example creates nothing.
  it.each([
    ['a comment', 'rm -f "$f" # f=$(mktemp)\necho hi > "$f"'],
    ['a single-quoted example', "printf '%s\\n' 'f=$(mktemp)'\necho hi > \"$f\""],
    ['a double-quoted example', 'echo "use f=\\$(mktemp)"\necho hi > "$f"'],
  ])('does not treat %s as creating the file', (_name, text) => {
    expect(lint(text)).toEqual([]);
  });

  // 17: a quoted `)` does not end a command substitution early.
  it('keeps a redirect after a quoted `)` inside a [[ ]] substitution', () => {
    const text = `f=$(mktemp)\n[[ -n $(printf ')'; printf x > "$f") ]]`;
    expect(lint(text).map((f) => [f.rule, f.line])).toEqual([['SHC-001', 2]]);
  });

  // 19: a quoted `]]` does not end a [[ ]] span early.
  it('does not read a comparison after a quoted `]]` as a redirect', () => {
    expect(lint(`f=$(mktemp); [[ "]]" > "$f" ]]`)).toEqual([]);
  });
});

describe('line continuations (follow-up 21)', () => {
  it('recognises an fd wrapper split with a `\\` continuation', () => {
    const lines = [
      'bash /dev/fd/3 \\',
      "  3<<'__W__'",
      'mapfile -t a < f',
      '__W__',
      'mapfile -t b < f',
    ];
    expect(findFdWrappers(lines)).toEqual([
      { open: 1, close: 3, tag: '__W__' },
    ]);
    expect(lint(lines.join('\n')).map((f) => [f.rule, f.line])).toEqual([
      ['SHC-003', 5],
    ]);
  });

  it('checks a continued wrapper like a one-line one', () => {
    const text = ['sudo bash /dev/fd/3 \\', "3<<'__W__'", 'true', '__W__'];
    const [finding] = lint(text.join('\n'));
    expect(finding.rule).toBe('SHC-009');
    expect(finding.detail).toContain('no sudo');
  });

  it('flags a continued script fed to bash on stdin', () => {
    const text = ['bash \\', "  <<'EOF'", 'true', 'EOF'];
    expect(lint(text.join('\n')).map((f) => [f.rule, f.detail])).toEqual([
      ['SHC-009', 'script fed to bash on stdin'],
    ]);
  });

  it('lints the redirect after a continued wrapper', () => {
    const text = [
      'out=$(mktemp)',
      'bash /dev/fd/3 \\',
      `3<<'__W__' >"$out"`,
      'true',
      '__W__',
    ];
    expect(lint(text.join('\n')).map((f) => [f.rule, f.line])).toEqual([
      ['SHC-001', 3],
    ]);
  });
});

describe('SHC-010 alias-prone commands', () => {
  const flagged = (text: string) =>
    lint(text)
      .filter((f) => f.rule === 'SHC-010')
      .map((f) => f.line);

  it.each([
    ['piped ls', 'ls -t plans/*.md | head'],
    ['piped ls with stderr dropped', 'ls -t plans/*.md 2>/dev/null | head -5'],
    ['captured ps', 'x=$(ps -p 1 -o comm=)'],
    ['captured in a case subject', 'case "$(ls -ld -- "$b")" in d*) ;; esac'],
    ['tested ls', 'if ! ls a/*.md >/dev/null 2>&1; then :; fi'],
    ['ls as an if condition', 'if ls a >/dev/null 2>&1; then :; fi'],
    ['ls as a while condition', 'while ls a >/dev/null 2>&1; do :; done'],
    ['ls as the left side of &&', 'ls a >/dev/null 2>&1 && echo yes'],
    ['backtick capture', 'x=`ls -t plans`'],
    ['argument-free backtick capture', 'x=`ls`'],
    ['argument-free backtick df', 'x=`df`'],
    ['capture inside arithmetic', 'x=$(( $(du -sk dir | cut -f1) / 1024 ))'],
    ['ls with &> then &&', 'ls plans/*.md &>/dev/null && echo found'],
    ['ls with &> to a file', 'ls x &> f'],
    ['last command of an if list', 'if [ -d plans ] && ls plans/*.md >/dev/null 2>&1; then :; fi'],
    ['last command of a while list', 'while [ -d plans ] && ls plans/*.md >/dev/null 2>&1; do :; done'],
    [
      'indented last command of an if list',
      '  if [ -d plans ] && ls plans/*.md >/dev/null 2>&1; then :; fi',
    ],
    [
      'indented last command of a while list',
      '  while [ -d plans ] && ls plans/*.md >/dev/null 2>&1; do :; done',
    ],
    ['process substitution', 'while read -r f; do :; done < <(ls -t plans)'],
    ['du piped to cut', 'du -sh x | cut -f1'],
    ['df redirected to a file', 'df -h > out.txt'],
    ['df with stderr redirected', 'df -h 2> err.txt'],
    ['ls redirected to /dev/null', 'ls a > /dev/null'],
    ['top inside a pipeline segment', 'echo go; top -bn1 | head -3'],
    ['bare display call', 'ls -d .ruvector/'],
    ['bare display with stderr dropped', 'ls -la x 2>/dev/null'],
    ['placeholder in a bare call', 'ls -la .worktrees/<name>/.ruvector'],
    ['env-prefixed command', 'LC_ALL=C ls x | head'],
    ['piped subshell', '( ls x ) | head'],
    ['env-prefixed command after &&', 'true && LC_ALL=C ls x'],
    ['env-prefixed if condition', 'if LC_ALL=C ls x; then :; fi'],
    ['env-prefixed command in a subshell', '( LC_ALL=C ls x )'],
    ['env-prefixed command after indent', '  LC_ALL=C TZ=UTC ls x'],
  ])('flags %s', (_name, text) => {
    expect(flagged(text)).toEqual([1]);
  });

  it('flags a condition-list command indented inside a function', () => {
    expect(
      flagged(
        'fn() {\n  if [ -d plans ] && ls plans/*.md >/dev/null 2>&1; then :; fi\n}'
      )
    ).toEqual([2]);
  });

  it('reads the operands of a [[ ]] test as words', () => {
    expect(flagged('[[ "$cmd" == foo || ls == "$cmd" ]]')).toEqual([]);
    expect(flagged('[[ $cmd =~ ^(ls|ps)$ ]]')).toEqual([]);
    expect(flagged('if [[ $c =~ ^(ls|ps)$ ]]; then :; fi')).toEqual([]);
    expect(flagged('[[ -n $(ls x) ]]')).toEqual([1]);
    expect(flagged('[[ -d x ]] && ls x')).toEqual([1]);
    expect(flagged('[[ "$x" == "]]" ]] && ls x')).toEqual([1]);
    expect(flagged(`[[ "$x" == '$(ls)' ]]`)).toEqual([]);
    expect(flagged("[[ \"$x\" == '`ls`' ]]")).toEqual([]);
    expect(flagged(`x=$(( '$(ls)' ))`)).toEqual([]);
    expect(flagged('[[ "$x" == "$(ls)" ]]')).toEqual([1]);
    expect(flagged('[[ -r <(ls x) ]]')).toEqual([1]);
    expect(flagged("[[ -n $(printf ')'; ls x) ]]")).toEqual([1]);
  });

  it('reads the elements of an array assignment as words', () => {
    expect(flagged('x=(ls)')).toEqual([]);
    expect(flagged('commands=(ls ps)')).toEqual([]);
    expect(flagged('a+=(df) ; echo "${a[@]}"')).toEqual([]);
    expect(flagged('x=($(ls d))')).toEqual([1]);
    expect(flagged('x=( <(ls d) )')).toEqual([1]);
    expect(flagged('x=(a) && ls d')).toEqual([1]);
    expect(flagged('(ls d)')).toEqual([1]);
    expect(flagged('commands=(\n  ls\n  ps\n)')).toEqual([]);
    expect(flagged('a=(x\n  ls) && ls d')).toEqual([2]);
    expect(flagged('a=(\n  $(ls d)\n)')).toEqual([2]);
    expect(flagged('a=(\n  x\n)\nls d')).toEqual([4]);
    expect(flagged('a=(\n  $(\n  ls x\n  )\n  ps\n)')).toEqual([3]);
    expect(flagged('a=(\n  "("\n)\nls d')).toEqual([4]);
    expect(flagged('a=(\n  ")"\n  ls\n)')).toEqual([]);
    expect(flagged('x=$((\n  1 ")"\n))\nls d')).toEqual([4]);
  });

  it('reads the operands of a [[ ]] test spanning lines as words', () => {
    expect(flagged('[[ "$cmd" == foo ||\n  ls == "$cmd" ]]')).toEqual([]);
    expect(flagged('if [[ -n $a &&\n  ps == "$b" ]]; then :; fi')).toEqual([]);
    expect(flagged('[[ -n $a &&\n  -n $(ls x) ]]')).toEqual([2]);
    expect(flagged('[[ -n $a &&\n  -n $b ]] && ls x')).toEqual([2]);
    expect(flagged('[[ -n $a ]]\nls x')).toEqual([2]);
    expect(flagged('[[ -n $(\n  ls x\n) ]]')).toEqual([2]);
  });

  it('reads the operands of arithmetic spanning lines as variables', () => {
    expect(flagged('x=$((\n  top + 1\n))')).toEqual([]);
    expect(flagged('((\n  ps > 0\n))')).toEqual([]);
    expect(flagged('n=$(( a +\n  top ))')).toEqual([]);
    expect(flagged('x=$((\n  $(du -sk d | cut -f1) / 2\n))')).toEqual([2]);
    expect(flagged('x=$((\n  1\n)) && ls x')).toEqual([3]);
    expect(flagged('x=$((\n  $(\n  ls x | wc -l\n  ) / 2\n))')).toEqual([3]);
  });

  it('reads a line after a backslash continuation as mid-command', () => {
    expect(flagged('command find . \\\n  -exec \\\n  ls {} +')).toEqual([]);
    expect(flagged("printf '%s\\n' \\\n  ls")).toEqual([]);
    expect(flagged('true && \\\n  ls x')).toEqual([2]);
    expect(flagged('LC_ALL=C \\\n  ls x')).toEqual([2]);
    expect(flagged('true && A=1 B=2 \\\n  ls x')).toEqual([2]);
    expect(flagged('echo A=1 \\\n  ls')).toEqual([]);
    expect(flagged('env \\\n  LC_ALL=C \\\n  ls x')).toEqual([]);
    expect(flagged('env \\\n  LC_ALL=C &&\\\n  ls x')).toEqual([3]);
  });

  it('reads a spaced alternation as a case arm only inside a case block', () => {
    expect(flagged('(ps | cat)')).toEqual([1]);
    expect(flagged('ls x | head)')).toEqual([1]);
    expect(flagged('case "$c" in\n  ps | df) :;;\nesac\n(ps | cat)')).toEqual([4]);
  });

  it('reads case, esac and [[ as reserved words only in command position', () => {
    expect(flagged("printf '%s\\n' [[\nls x | cat")).toEqual([2]);
    expect(flagged('case "$c" in\n  a) echo esac here ;;\n  foo | ps) :;;\nesac')).toEqual([]);
    expect(flagged('echo case x\n(ps | cat)')).toEqual([2]);
    expect(flagged('if [[ -n $a &&\n  -n $b ]]; then ls x; fi')).toEqual([2]);
  });

  it('flags a pipe split across lines at the line holding the command', () => {
    expect(flagged('echo go\nls -t x \\\n  | head -5')).toEqual([2]);
    expect(flagged('ls -t x |\n  head -5')).toEqual([1]);
  });

  it('flags a multiline capture at the line holding the command', () => {
    expect(flagged('v=$(\n  ls -t x\n)')).toEqual([2]);
  });

  it('keeps a capture or pipe open across a comment line', () => {
    expect(flagged('v=$(\n  # note\n  ls -t x\n)')).toEqual([3]);
    expect(flagged('ls -t x |\n  # note\n  head')).toEqual([1]);
  });

  it('keeps a capture open across a case arm and judges the command after it', () => {
    const text = 'v=$(\n  case "$c" in\n    ps) echo a ;;\n  esac\n  ls -t x\n)';
    expect(flagged(text)).toEqual([5]);
  });

  it('does not read a case-arm pattern inside a capture as a command', () => {
    expect(flagged('v=$(\n  case "$c" in\n    ls|ps) echo a ;;\n  esac\n)')).toEqual([]);
  });

  it('does not let a trailing comment hide later lines of the command', () => {
    expect(flagged('v=$( # newest first\n  ls -t x\n)')).toEqual([2]);
    expect(flagged('v=$(\n  echo a # note\n  ls -t x\n)')).toEqual([3]);
  });

  it('flags other redirect and pipe forms', () => {
    expect(flagged('df -h 1> out.txt')).toEqual([1]);
    expect(flagged('ls a 2>&1 | head')).toEqual([1]);
    expect(flagged('ls a >> out')).toEqual([1]);
    expect(flagged('ls a >| out')).toEqual([1]);
  });

  it('flags a display call in an if or while body', () => {
    expect(flagged('if [ -d x ]; then ls -la x 2>/dev/null; fi')).toEqual([1]);
    expect(flagged('while read -r f; do ls -d x; done')).toEqual([1]);
  });

  // A wrapper is not an assignment, so the command word is not in command
  // position. Todos, not pinned passes.
  it.todo('flags a wrapper-prefixed command: timeout 5 ls x | head');
  it.todo('flags a sudo-prefixed command: sudo df | tail');

  it.each([
    ['command prefix', 'command ls -t x | head'],
    ['backslash prefix', '\\ls x | head'],
    ['find -exec ls', "command find -H plans -name '*.md' ! -name '.*' -exec ls -t {} + | head"],
    [
      'the shipped work.md listing',
      `command find -H plans -maxdepth 1 \\( -type f -o -type l \\) -name '*.md' ! -name '.*' -exec ls -t {} + 2>/dev/null | head -5`,
    ],
    [
      'the shipped plan-status existence check',
      `if [ -z "$(command find -H plans -maxdepth 1 \\( -type f -o -type l \\) -name '*.md' ! -name '.*' 2>/dev/null | head -1)" ]; then`,
    ],
    ['xargs ls', 'printf "%s\\n" a | xargs ls -t'],
    ['ssh remote command', 'ssh host ls -t x | head'],
    ['ls in a string', "printf 'ls -t' | cat"],
    ['ls as an argument', 'echo ls | head'],
    ['a longer command name', 'lsof -i | head'],
    ['a case-arm pattern', 'case "$c" in\n  ps|df) echo disk ;;\nesac'],
    ['a later case-arm alternative', 'case "$c" in\n  ls|ps|du) echo x ;;\nesac'],
    ['a parenthesised case-arm', 'case "$c" in\n  (ps|df) echo x ;;\nesac'],
    ['an arithmetic comparison', 'if (( top > 0 )); then :; fi'],
    ['an arithmetic expansion', 'x=$(( ps > 3 ? 1 : 0 ))'],
    ['a path ending in ls', './bin/ls x | head'],
    ['arithmetic around a plain variable', 'x=$(( n / 1024 ))'],
    ['a variable beside a substitution in arithmetic', 'x=$(( top + $(echo 1) ))'],
    ['a variable beside a substitution in a comparison', 'if (( ps > $(echo 1) )); then :; fi'],
    ['a later case arm on the same line', 'case "$c" in foo) echo a ;; ps) echo disk ;; esac'],
    ['one-line case alternatives', 'case "$c" in ps|df) echo disk ;; esac'],
    ['spaced case alternatives', 'case "$c" in foo | ps) :;; esac'],
    ['a spaced first case alternative', 'case "$c" in\n  ps | df) :;;\nesac'],
    ['a parenthesised later case arm', 'case "$c" in a) :;; (ps|df) echo x ;; esac'],
    ['an assignment argument before ls', 'echo FOO=bar ls'],
    ['an indented capture of command ps', '  v=$(command ps -p 1 -o comm=)'],
  ])('passes %s', (_name, text) => {
    expect(flagged(text)).toEqual([]);
  });

  it('passes the same ls inside a bash fd wrapper and a quoted heredoc', () => {
    const wrapper = ["bash /dev/fd/3 3<<'__W__'", 'ls -t x | head', '__W__'];
    expect(flagged(wrapper.join('\n'))).toEqual([]);
    const remote = ['ssh host <<\'REMOTE\'', 'df -h | tail -1', 'REMOTE'];
    expect(flagged(remote.join('\n'))).toEqual([]);
  });

  it('lints a tier 4 library file with the same rule', () => {
    write(
      'plugins/demo/lib/dual.sh',
      '#!/usr/bin/env bash\ndual_fn() { ls -t d | head -1; }\n'
    );
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('plugins/demo/lib/dual.sh:2 [SHC-010]');
  });

  it('honours aliasGuardedCommands from the context', () => {
    const ctx = { ...EMPTY_CTX, aliasGuarded: ['find'] };
    const hits = (text: string) =>
      lintShellText(text, 'plugins/p/x.md', 1, ctx)
        .filter((f: Finding) => f.rule === 'SHC-010')
        .map((f: Finding) => f.line);
    expect(hits('find . -name x | head')).toEqual([1]);
    expect(hits('ls -t x | head')).toEqual([]);
  });

  it.each([
    ['an empty list', []],
    ['only invalid names', ['', 'l s', '(ls', 'a|b']],
  ])('reports nothing for %s in the context', (_name, aliasGuarded) => {
    const ctx = { ...EMPTY_CTX, aliasGuarded };
    const hits = lintShellText('ls -t x | head', 'plugins/p/x.md', 1, ctx).filter(
      (f: Finding) => f.rule === 'SHC-010'
    );
    expect(hits).toEqual([]);
  });

  it('runs against the tree: fails on a bare piped ls, passes with command', () => {
    write('plugins/demo/commands/bad.md', md('ls -t plans | head -5'));
    const failed = run();
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain('plugins/demo/commands/bad.md:4 [SHC-010]');
    write('plugins/demo/commands/bad.md', md('command ls -t plans | head -5'));
    expect(run().status).toBe(0);
  });

  it('rejects a malformed aliasGuardedCommands as SHC-900', () => {
    for (const bad of [[], 'ls', ['ls', 3], ['l s']]) {
      config({ aliasGuardedCommands: bad });
      const result = run();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('aliasGuardedCommands must be');
    }
  });

  it('uses the configured command list', () => {
    config({ aliasGuardedCommands: ['du'] });
    write('plugins/demo/commands/mix.md', md('ls -t a | head\ndu -sh a | cut -f1'));
    const result = run();
    expect(result.stderr).toContain('mix.md:5 [SHC-010]');
    expect(result.stderr).not.toContain('mix.md:4');
  });
});
