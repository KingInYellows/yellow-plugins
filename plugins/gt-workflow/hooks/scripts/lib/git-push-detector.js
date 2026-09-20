'use strict';

/**
 * Tokenising `git push` detector shared (by copy) between gt-workflow and
 * github-workflow's PreToolUse backstop hooks.
 *
 * Replaces the substring regex documented as evadable in
 * docs/solutions/security-issues/substring-regex-command-denylist-evasion.md:
 * the command is split into shell words and simple-command segments, and a
 * segment is denied when its argv[0] resolves to `git` and the first
 * non-option token after git's global options is `push` (or `send-pack`,
 * the plumbing behind it). Quoted literals (`echo "git push"`) therefore no
 * longer trip the guard, while `/usr/bin/git push`, `git -C "$(pwd)" push`,
 * `git 2>&1 push`, `g"i"t pu\sh`, `{ git push; }`, `bash -c "git push"`,
 * `echo 'git push' | bash`, `bash <(echo git push)` and `$(git push)` all do.
 *
 * Hand-rolled on purpose: plugin hooks run with zero installs, so no
 * `shell-quote`. The lexer follows POSIX sh / bash lexing closely enough
 * for a backstop — quotes (including `$'…'`/`$"…"`), backslashes,
 * comments, `$(…)`/backtick substitution (the outer command stays one
 * segment with a placeholder; the body becomes its own), `<(…)`/`>(…)`
 * process substitution (attached to the consuming command as a stdin
 * source), redirections (dropped from argv; `2>&1` is not a control
 * operator), heredocs and here-strings (bound to the declaring segment),
 * pipes (a pipe into `{ … }`/`( … )`/`if …` feeds every command in the
 * group), and the `;` `&&` `||` `|` `&` `(` `)` `{` `}` newline
 * separators. Unquoted brace and pathname expansion (`{git,push}`,
 * `gi[t]`, `*`) mark a word as decided at runtime. Leading reserved words
 * (`if`, `!`, `while`, `do`, `{`…), `K=V` assignments and transparent
 * wrappers (`sudo`, `env`, `timeout`, `xargs`, …) are peeled before
 * argv[0] is compared; values git itself executes (`-c core.pager=…`,
 * `PAGER=…`, `-c alias.x=…`, `git config alias.x …`, `rebase --exec`,
 * `submodule foreach`, `bisect run`) are re-scanned; `git subtree push`
 * and the remote helpers are a push.
 * `bash|sh|… -c <string>`, `eval`, `su -c`, `sudo -s`, `env -S`, and a
 * shell fed a heredoc, here-string, process substitution or a pipe from
 * `echo`/`printf`/`cat <<EOF` are re-scanned recursively, capped at depth
 * 3 (a wrapper that runs `$SHELL` when given no command — `sudo -s <<EOF`,
 * `su -` — counts as that shell); a re-scanned script inherits the outer
 * command's stdin through every level, and a source attached to a whole
 * group (`{ sh; } <<EOF`) reaches every command inside it. The
 * `$(…)`/backtick bodies of an unquoted-delimiter heredoc are commands in
 * their own right whatever reads the body.
 *
 * Still a backstop: `${IFS}` and variable indirection (`$GIT push`, a
 * runtime-built `eval` string), shell aliases and `hash -p` bindings,
 * `export`ed command variables and `GIT_CONFIG_PARAMETERS`/
 * `GIT_CONFIG_KEY_n`, stdin re-plumbed by a bare `exec <<< …`, nested
 * backticks (`\``), script files and copies of the binary written earlier
 * in the same command (`echo 'git push' > s; bash s`, `ln -s /usr/bin/git
 * g`), interpreter one-liners (`python3 -c "os.system('git push')"`) and
 * `find -exec` are out of scope and stay documented as such. Anything the
 * backstop cannot read — a runtime-computed program name or subcommand, a
 * shell fed by an opaque pipe (`curl … | sh`, `cat file | bash`, `{ …; …;
 * } | sh`), a non-sh shell's `-c` string, nesting deeper than three
 * shells, more than sixteen wrapper layers — is denied outright. Any
 * parser exception fails closed (returns true).
 *
 * This file MUST stay byte-identical to its sibling in the other stack
 * provider plugin (tests/integration/git-push-detector-parity.test.ts
 * enforces it) — plugins never require each other's files at runtime.
 *
 * Pure — no I/O, no console.*, no timestamps.
 */

// Recursion cap for `bash -c "bash -c '…'"` nesting. Past the cap we deny:
// a command that needs four shells to say what it does is not one the
// backstop can vouch for.
const MAX_SHELL_DEPTH = 3;
// Same idea for `sudo env nice timeout … git push` chains: bounds the
// wrapper-peeling work per segment as well as the reading.
const MAX_WRAPPER_PEELS = 16;

// Set for the duration of one top-level classify/commandInvokesGitPush call
// so verified `git push` detections are distinct from fail-closed denials.
let analysisCtx = null;

/** @returns {true} */
function denyVerified() {
  if (analysisCtx) analysisCtx.verifiedPush = true;
  return true;
}

/** @returns {true} */
function denyUnverifiable() {
  if (analysisCtx) analysisCtx.unverifiable = true;
  return true;
}

// Stands in for text decided at runtime inside a word — a `$(…)`/backtick
// substitution, a brace/pathname expansion, an xargs replacement token.
// NUL cannot appear in a Bash tool command.
const SUBST = '\u0000';

// git global options that take their value as the NEXT word. `-C dir`,
// `-c k=v`; the `--opt=value` and `-Cdir` attached forms are one word and
// consume nothing extra. `--exec-path` is attached-only (`--exec-path` bare
// prints the path), so it is deliberately not here.
const GIT_OPTION_TAKES_VALUE = new Set([
  '-C',
  '-c',
  '--config-env',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--attr-source',
  '--super-prefix',
  '--list-cmds',
]);

// Subcommands that push: `push` itself and the plumbing it calls. Also
// matched as dashed binaries (`git-push`, `git-send-pack`) from git's
// exec-path, which perform the identical push.
// The remote helpers push when fed the helper protocol on stdin (`printf
// 'push a:b\n\n' | git remote-https origin URL`); they have no interactive use.
const PUSH_SUBCOMMANDS = new Set(['push', 'send-pack', 'http-push', 'remote-https', 'remote-http', 'remote-ftp', 'remote-ftps', 'remote-ext', 'remote-fd']);

// Environment variables whose value git (or the shell) runs as a command:
// `PAGER='git push' git log` pushes. Assignment prefixes and `env K=V`
// with one of these names are re-scanned.
const COMMAND_ENV_VARS = new Set(['PAGER', 'GIT_PAGER', 'EDITOR', 'VISUAL', 'GIT_EDITOR', 'GIT_SEQUENCE_EDITOR', 'GIT_EXTERNAL_DIFF', 'GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_ASKPASS', 'SSH_ASKPASS', 'GIT_PROXY_COMMAND', 'GIT_DIFF_PATH_COMMAND']);

// Transparent wrappers: argv[0]s that run their remaining argv as the real
// command. `takesValue`: options that consume the following word;
// `positionals`: leading non-option operands to skip before the wrapped
// command (`timeout 5 git push`, `flock lockfile git push`);
// `shellString`: options whose operand is a shell command string to
// re-scan (`su -c 'git push'`, `env -S 'git push'`) — they may follow the
// positionals (`su root -c …`); `shellRest`: options after which the
// remaining argv is joined and re-scanned as one shell string (`sudo -s
// 'git push'`); `shellIfBare`: with no command left the wrapper runs
// `$SHELL`, which reads its script from stdin (`sudo -s <<EOF`, `su -`);
// `positionalOnlyWithoutOptions`: the positional is consumed only when no
// option preceded it (`runcon CONTEXT` vs `runcon -t TYPE`); `positionalRe`:
// the positional is consumed only when it matches (`setarch ARCH`).
const NOOP = { takesValue: new Set(), positionals: 0 };
const WRAPPERS = {
  command: NOOP,
  builtin: NOOP,
  nohup: NOOP,
  setsid: NOOP,
  // `-r` is `--map-root-user` (no value); `--root`/`--wd` take a directory.
  unshare: { takesValue: new Set(['-S', '--setuid', '-G', '--setgid', '-w', '--wd', '--root', '--map-user', '--map-group']), positionals: 0, shellIfBare: true },
  caffeinate: NOOP,
  linux32: { takesValue: new Set(), positionals: 0, shellIfBare: true },
  linux64: { takesValue: new Set(), positionals: 0, shellIfBare: true },
  prlimit: NOOP,
  setpriv: { takesValue: new Set(['--reuid', '--regid', '--groups', '--inh-caps', '--ambient-caps', '--bounding-set', '--pdeathsig', '--securebits', '--selinux-label', '--apparmor-profile', '--landlock-access', '--landlock-rule', '--seccomp-filter']), positionals: 0 },
  // `runcon CONTEXT cmd` or `runcon -u USER -r ROLE -t TYPE -l RANGE cmd`: the
  // positional is only consumed when no option was given (tracked below).
  runcon: { takesValue: new Set(['-u', '--user', '-r', '--role', '-t', '--type', '-l', '--range']), positionals: 1, positionalOnlyWithoutOptions: true },
  busybox: NOOP, // argv[1] is the applet name; the loop re-reads it as argv[0]
  exec: { takesValue: new Set(['-a']), positionals: 0 },
  env: {
    takesValue: new Set(['-u', '--unset', '-C', '--chdir']),
    positionals: 0,
    shellString: new Set(['-S', '--split-string']),
  },
  time: { takesValue: new Set(['-f', '--format', '-o', '--output']), positionals: 0 },
  sudo: {
    takesValue: new Set(['-u', '--user', '-g', '--group', '-C', '--close-from', '-D', '--chdir', '-h', '--host', '-p', '--prompt', '-r', '--role', '-t', '--type', '-T', '--command-timeout', '-U', '--other-user', '-R', '--chroot', '-a', '--login-class', '-c', '--class']),
    positionals: 0,
    shellRest: new Set(['-s', '--shell', '-i', '--login']),
    shellIfBare: true,
  },
  doas: { takesValue: new Set(['-u', '-C']), positionals: 0, shellRest: new Set(['-s']), shellIfBare: true },
  pkexec: { takesValue: new Set(['--user']), positionals: 0 },
  su: { takesValue: new Set(['-g', '--group', '-G', '--supp-group', '-s', '--shell']), positionals: 1, shellString: new Set(['-c', '--command', '--session-command']), shellIfBare: true },
  runuser: { takesValue: new Set(['-u', '--user', '-g', '--group', '-G', '--supp-group', '-s', '--shell']), positionals: 1, shellString: new Set(['-c', '--command', '--session-command']), shellIfBare: true },
  sg: { takesValue: new Set(), positionals: 1, shellString: new Set(['-c']), shellIfBare: true },
  script: { takesValue: new Set(['-E', '--echo', '-o', '--output-limit', '-T', '--log-timing', '-I', '--log-in', '-O', '--log-out', '-B', '--log-io', '-m', '--logging-format']), positionals: 1, shellString: new Set(['-c', '--command']), shellIfBare: true },
  xargs: {
    // `-i`, `-e`, `-l`, `--replace` take an OPTIONAL attached value, never
    // the next word.
    takesValue: new Set(['-a', '--arg-file', '-d', '--delimiter', '-E', '--eof', '-I', '-L', '--max-lines', '-n', '--max-args', '-P', '--max-procs', '-s', '--max-chars', '--process-slot-var']),
    positionals: 0,
  },
  timeout: { takesValue: new Set(['-k', '--kill-after', '-s', '--signal']), positionals: 1 },
  nice: { takesValue: new Set(['-n', '--adjustment']), positionals: 0 },
  ionice: { takesValue: new Set(['-c', '--class', '-n', '--classdata', '-p', '--pid', '-P', '--pgid', '-u', '--uid']), positionals: 0 },
  stdbuf: { takesValue: new Set(['-i', '--input', '-o', '--output', '-e', '--error']), positionals: 0 },
  flock: { takesValue: new Set(['-w', '--wait', '--timeout', '-E', '--conflict-exit-code']), positionals: 1, shellString: new Set(['-c', '--command']) },
  chrt: { takesValue: new Set(['-p', '--pid']), positionals: 1 },
  taskset: { takesValue: new Set(['-p', '--pid']), positionals: 1 },
  // `setarch ARCH cmd` / `setarch -R cmd` (no arch): the positional is only
  // consumed when it names an architecture.
  setarch: { takesValue: new Set(), positionals: 1, shellIfBare: true, positionalRe: /^(linux(32|64)|i[3-6]86|x86_64|x32|arm|arm64|aarch64|ppc|ppc64|ppc64le|s390|s390x|sparc|sparc64|mips|mips64|riscv64|alpha|ia64|parisc|sh|sh64|m68k|hppa|loongarch64|um)$/ },
  chroot: { takesValue: new Set(['--userspec', '--groups']), positionals: 1, shellIfBare: true },
  nsenter: { takesValue: new Set(['-t', '--target', '-S', '--setuid', '-G', '--setgid', '-w', '--wd', '-r', '--root']), positionals: 0, shellIfBare: true },
  strace: { takesValue: new Set(['-o', '-p', '-e', '-s', '-E', '-P', '-u', '-I', '-a', '-O', '-S', '-X']), positionals: 0 },
  ltrace: { takesValue: new Set(['-o', '-p', '-e', '-s', '-u', '-a', '-A', '-n', '-l', '-x', '-L']), positionals: 0 },
  'systemd-run': { takesValue: new Set(['-p', '--property', '--unit', '--description', '--slice', '-E', '--setenv', '--uid', '--gid', '--nice', '--working-directory', '--on-active', '--on-boot', '--on-calendar', '--timer-property', '-M', '--machine', '-H', '--host']), positionals: 0 },
  // The dynamic loader run directly: `/lib64/ld-linux-x86-64.so.2 /usr/bin/git push`.
  'ld.so': { takesValue: new Set(['--library-path', '--preload', '--audit', '--argv0', '--glibc-hwcaps-prepend', '--glibc-hwcaps-mask']), positionals: 0 },
};
// `ld.so`, `ld-linux-x86-64.so.2`, `ld-musl-x86_64.so.1`, `ld64.so.1`,
// `ld-2.31.so`: the first dot-separated part is `ld…` and some later part
// is `so`. (Split rather than a regex: an alternation of `[\w.-]*` and
// `(\.\d+)*` backtracked quadratically on `ld-linux.1.1.1…x`.)
const LD_SO_STEM_RE = /^ld[\w-]*$/;
function isDynamicLoader(base) {
  if (!base.startsWith('ld')) return false;
  const parts = base.split('.');
  return LD_SO_STEM_RE.test(parts[0]) && parts.includes('so', 1);
}
for (const w of Object.values(WRAPPERS)) {
  if (w.shellString) w.shellStringList = [...w.shellString];
}

// Shells whose `-c <string>` operand (or stdin heredoc/here-string/pipe)
// is itself a shell command we can re-scan. Versioned binary names
// (`bash-5.2`, `bash5`) normalise to the base name.
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'mksh', 'ash', 'yash', 'oksh', 'loksh', 'lksh', 'pdksh', 'osh', 'rbash', 'rzsh', 'rksh', 'posh', 'hush', 'static-sh']);
const SHELL_NAME_RE = /^(bash|sh|zsh|dash|ksh|mksh|ash|yash|oksh|loksh|lksh|pdksh|osh|rbash|rzsh|rksh|posh|hush|static-sh)(?:[-.]?\d[\w.-]*)?$/;
// Shells whose syntax the lexer does not model: a `-c` string there is
// unreadable and denied outright; without one they are treated like a
// sh-compatible shell for stdin purposes (`git push` reads the same).
const OPAQUE_SHELLS = new Set(['fish', 'csh', 'tcsh', 'pwsh', 'powershell', 'nu', 'nushell', 'xonsh', 'elvish', 'rc', 'es', 'ion', 'murex']);
// Shell options whose value is the next word (`bash -o pipefail -c …`).
const SHELL_OPTION_TAKES_VALUE = new Set(['-o', '+o', '-O', '+O', '--rcfile', '--init-file']);
// `source`/`.` read a script file — the only inspectable case is stdin
// (`. /dev/stdin <<< …`), handled like a shell without `-c`.
const SOURCE_BUILTINS = new Set(['source', '.']);
// Commands whose stdout is exactly their (literal) arguments: a shell fed
// by one of these through a pipe is re-scanned on those arguments.
const LITERAL_PRODUCERS = new Set(['echo', 'printf', 'cat']);

// Reserved words that may precede a simple command in command position.
// (`{`/`}` never reach argv — endWord treats them as separators — and
// `;;`/`;&` are split by the `;` separator, so neither is listed.)
const LEADING_RESERVED = new Set(['!', 'if', 'then', 'elif', 'else', 'while', 'until', 'do', 'done', 'fi', 'esac', 'coproc', '[[', ']]']);
// Reserved words that open / close a compound whose every command shares
// the compound's stdin (`echo x | if true; then bash; fi`).
const GROUP_OPENERS = new Set(['if', 'while', 'until', 'for', 'case', 'select']);
const GROUP_CLOSERS = new Set(['fi', 'done', 'esac']);

// `NAME=`, `NAME+=`, `NAME[idx]=` command-prefix assignments.
const ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=/;
const ASSIGNMENT_NAME_RE = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[[^\]]*\])?\+?=([\s\S]*)$/;
const FD_RE = /^[0-9]+$|^\{[A-Za-z_][A-Za-z0-9_]*\}$/;

// Stands in as the producer of a pipe whose text the detector does not
// reassemble (`{ …; …; } | sh`): never a literal producer, so a shell or
// xargs reading it is denied.
const OPAQUE_PRODUCER = Object.freeze({ argv: [SUBST], heredocs: [], procsubs: [], pipedFrom: null, inOutputProcsub: false, feeds: -1 });

// git subcommands that run a caller-supplied command. `shellOptions`: the
// operand (next word, `--opt=value`, or `-xvalue`) is a shell string;
// `shellVerb`: everything after this operand word is joined into one shell
// string (`git submodule foreach 'git push'`); `argvVerb`: the words after
// it are an argv (`git bisect run git push`); `gitArgs`: the operands are
// git arguments run in each repository (`git for-each-repo --config=x
// push`).
const GIT_EXEC_SUBCOMMANDS = {
  rebase: { shellOptions: ['--exec', '-x'] },
  difftool: { shellOptions: ['--extcmd', '-x'] },
  'filter-branch': { shellOptions: ['--env-filter', '--tree-filter', '--index-filter', '--parent-filter', '--msg-filter', '--commit-filter', '--tag-name-filter'] },
  submodule: { shellVerb: 'foreach' },
  bisect: { argvVerb: 'run' },
  'for-each-repo': { gitArgs: true },
  // `git subtree push --prefix=… remote branch` is a real push.
  subtree: { pushVerb: true },
  // `git config alias.p push && git p`, `git config core.pager 'git push'`:
  // a write whose value git later executes — the persisted form of `-c`.
  config: { configWrite: true },
};
// `git config` options that take the next word, and the verbs of its
// subcommand form (`git config set key value`).
// Config keys whose value git runs through `sh -c` (see git-config(1)).
const COMMAND_CONFIG_KEY_RE = /^(core\.(pager|editor|sshcommand|fsmonitor|askpass|hookspath)|sequence\.editor|diff\.(external|[^.]+\.command|[^.]+\.textconv)|merge\.[^.]+\.driver|filter\.[^.]+\.(clean|smudge|process)|credential(\.[^.]+)?\.helper|gpg(\.[^.]+)?\.program|ssh\.variant|uploadpack\.packobjectshook|remote\.[^.]+\.(proxy|vcs)|browser\.[^.]+\.cmd|difftool\.[^.]+\.cmd|mergetool\.[^.]+\.cmd|pager\.[^.]+)$/i;
const GIT_CONFIG_TAKES_VALUE = new Set(['-f', '--file', '--blob', '--type', '--default', '--comment', '--url']);
const GIT_CONFIG_WRITE_VERBS = new Set(['set', 'add', 'replace-all']);
const GIT_CONFIG_READ_OPTIONS = new Set(['--get', '--get-all', '--get-regexp', '--get-urlmatch', '--unset', '--unset-all', '-l', '--list', '-e', '--edit', '--rename-section', '--remove-section']);
const GIT_CONFIG_READ_VERBS = new Set(['get', 'get-all', 'get-regexp', 'get-urlmatch', 'unset', 'unset-all', 'list', 'edit', 'rename-section', 'remove-section']);

const ANSI_SIMPLE = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', e: '\x1b', E: '\x1b', '\\': '\\', "'": "'", '"': '"', '?': '?' };

/**
 * Basename of an argv[0] on both `/` and `\`, lowercased, `.exe` stripped:
 * `/usr/bin/git` -> `git`, `C:\Git\bin\Git.EXE` -> `git`, `bash-5.2` ->
 * `bash`, `ld-linux-x86-64.so.2` -> `ld.so`.
 */
function programName(word) {
  let base = word.slice(Math.max(word.lastIndexOf('/'), word.lastIndexOf('\\')) + 1).toLowerCase();
  if (/\.(exe|cmd|bat|com)$/.test(base)) base = base.slice(0, -4);
  const shell = SHELL_NAME_RE.exec(base);
  if (shell) return shell[1];
  if (isDynamicLoader(base)) return 'ld.so';
  return base;
}

/** Decode one `$'…'` escape at src[i] (the char after the backslash). */
function ansiEscape(src, i) {
  const c = src[i];
  if (ANSI_SIMPLE[c] !== undefined) return { text: ANSI_SIMPLE[c], len: 1 };
  if (c === 'x') {
    const m = /^[0-9A-Fa-f]{1,2}/.exec(src.slice(i + 1, i + 3));
    if (m) return { text: String.fromCharCode(parseInt(m[0], 16)), len: 1 + m[0].length };
  }
  if (c >= '0' && c <= '7') {
    const m = /^[0-7]{1,3}/.exec(src.slice(i, i + 3));
    return { text: String.fromCharCode(parseInt(m[0], 8) & 0xff), len: m[0].length };
  }
  return { text: '\\' + c, len: 1 };
}

/**
 * The `$(…)` and backtick bodies of an expanding heredoc (unquoted
 * delimiter): the shell runs them whatever command reads the body, so each
 * is a top-level command in its own right. Quotes and nesting inside a
 * `$(…)` are respected; `\$` and `\`` are escapes.
 */
function expansionCommands(text) {
  const out = [];
  const len = text.length;
  let i = 0;
  while (i < len) {
    const ch = text[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '`') {
      let j = i + 1;
      while (j < len && text[j] !== '`') j += text[j] === '\\' ? 2 : 1;
      out.push(text.slice(i + 1, j));
      i = j + 1;
      continue;
    }
    if (ch === '$' && text[i + 1] === '(') {
      let depth = 1;
      let quote = null;
      let j = i + 2;
      while (j < len && depth > 0) {
        const c = text[j];
        if (quote) {
          if (c === quote) quote = null;
          else if (c === '\\' && quote === '"') j += 1;
        } else if (c === '\\') j += 1;
        else if (c === "'" || c === '"') quote = c;
        else if (c === '(') depth += 1;
        else if (c === ')') depth -= 1;
        j += 1;
      }
      out.push(text.slice(i + 2, depth === 0 ? j - 1 : j));
      i = j;
      continue;
    }
    i += 1;
  }
  return out;
}

/**
 * Lex `command` into simple-command segments:
 *   { argv, heredocs, procsubs, pipedFrom, inOutputProcsub, feeds }
 * with quotes and backslashes already removed from argv and redirections
 * (operator + operand) dropped. Segment boundaries are `;` `&` `|` newline
 * `(` `)` `{` `}`; a `$(…)`/backtick body becomes its own segment while
 * the outer command continues with a SUBST placeholder in its place; a
 * `<(…)`/`>(…)` body's segments are attached to the outer segment's
 * `procsubs` (a stdin source, like a heredoc) and flagged
 * `inOutputProcsub` for `>(…)`. A word containing an unquoted brace or
 * pathname expansion gets a SUBST appended: its value is decided at
 * runtime. Heredoc and here-string bodies are attached to the segment
 * that declared them. `pipedFrom` links a segment to the one whose stdout
 * it reads; a pipe into a `{`/`(`/`if`… group feeds every segment of the
 * group. `feeds` marks a closer-only segment carrying a group's trailing
 * stdin sources (`{ sh; } <<EOF`); a post-pass shares those sources with
 * every command in the group that has none of its own and records the
 * source on `stdinFrom` so memoised scans are per source, not per reader.
 */
function lexSegments(command, nesting = 0) {
  const segments = [];
  let argv = [];
  let heredocs = [];
  let procsubs = [];
  let word = '';
  let inWord = false;
  let wordExpands = false; // unquoted `*`, `?`, `[…]`, `{a,b}` seen in this word
  let bracketOpen = false;
  let braceOpen = false;
  let braceSeparator = false;
  let lastCh = '';
  let quote = null; // null | "'" | '"' | '$'  ('$' = inside $'…')
  let skipNextWord = false; // redirection operand
  let nextWordIsHereString = false;
  // Pipe bookkeeping: the producer is captured AT the `|`, together with
  // the group depth it was made at, so a pipe into `{ …; …; }` feeds every
  // command until the group closes.
  let pipeFrom = null;
  let pipeDepth = 0;
  let groupDepth = 0;
  // Set by `}` / `)` so a following `|` knows its producer is a whole
  // group (`{ echo a; echo b; } | sh`) rather than the group's last
  // command — text the detector does not reassemble, so the pipe is
  // marked opaque and a shell reading it is denied.
  let groupJustClosed = false;
  // Index of the first segment of each open group, so a stdin source
  // attached to the group as a whole (`{ sh; } <<EOF`, `(sh) < <(…)`,
  // `if …; fi <<< …`) can be handed to every command inside it.
  let groupStarts = [];
  let lastGroupStart = -1;
  let outputProcsubDepth = 0;
  // Saved outer state for each open `$(` / backtick / `<(` / `>(`.
  const substitutionStack = [];
  // Heredoc delimiters declared on the current line, consumed at newline,
  // each bound to the heredocs array of the segment that declared it.
  const pendingHeredocs = [];

  const resetWordFlags = () => {
    wordExpands = false;
    bracketOpen = false;
    braceOpen = false;
    braceSeparator = false;
  };
  const clearPipeIfOutside = () => {
    if (pipeFrom !== null && groupDepth <= pipeDepth) pipeFrom = null;
  };
  const closeGroup = () => {
    if (groupDepth > 0) groupDepth -= 1;
    lastGroupStart = groupStarts.length > 0 ? groupStarts.pop() : -1;
    clearPipeIfOutside();
  };
  const openGroup = () => {
    groupDepth += 1;
    groupStarts.push(segments.length);
  };
  const endSegmentAfterWord = () => {
    skipNextWord = false;
    nextWordIsHereString = false;
    if (argv.length > 0 || heredocs.length > 0 || procsubs.length > 0 || pendingHeredocs.length > 0) {
      // A segment that is only a group closer plus stdin sources (`}
      // <<EOF`, `) <<< x`, `fi < <(…)`) feeds the group it closes.
      const feeds = groupJustClosed && argv.every((w) => GROUP_CLOSERS.has(w)) ? lastGroupStart : -1;
      const segment = { argv, heredocs, procsubs, pipedFrom: pipeFrom, inOutputProcsub: outputProcsubDepth > 0, feeds };
      segments.push(segment);
      const frame = substitutionStack[substitutionStack.length - 1];
      if (frame) frame.body.push(segment);
      argv = [];
      heredocs = [];
      procsubs = [];
      // A pipe feeds one simple command — unless that command opened a
      // group, in which case every segment until the group closes shares
      // the stdin.
      clearPipeIfOutside();
    }
  };
  const endWord = () => {
    if (!inWord) return;
    let w = word;
    const expands = wordExpands;
    word = '';
    inWord = false;
    resetWordFlags();
    if (skipNextWord) {
      skipNextWord = false;
      return;
    }
    if (nextWordIsHereString) {
      nextWordIsHereString = false;
      heredocs.push(w);
      return;
    }
    if (w === '{' || w === '}') {
      // Group braces are reserved words only as standalone words; they
      // delimit commands like `;` does.
      endSegmentAfterWord();
      if (w === '{') openGroup();
      if (w === '}') {
        closeGroup();
        groupJustClosed = true;
      }
      return;
    }
    groupJustClosed = false;
    if (argv.length === 0 && GROUP_OPENERS.has(w)) openGroup();
    if (argv.length === 0 && GROUP_CLOSERS.has(w)) {
      closeGroup();
      groupJustClosed = true;
    }
    if (expands) w += SUBST;
    argv.push(w);
  };
  const endSegment = () => {
    endWord();
    endSegmentAfterWord();
  };
  // A fd (`2`, `{fd}`) immediately before a redirection operator is part
  // of the operator, not a word.
  const dropFdOrEndWord = () => {
    if (inWord && FD_RE.test(word)) {
      word = '';
      inWord = false;
      resetWordFlags();
    } else {
      endWord();
    }
  };
  const separator = () => {
    // `;`, `&&`, `||`, newline at the pipe's own depth end the pipe's reach
    // — and a group's: `{ sh; }; <<< x` feeds nothing.
    endSegment();
    clearPipeIfOutside();
    groupJustClosed = false;
  };
  const openSubstitution = (kind, outerQuote) => {
    // Freeze the outer simple command; the substitution body lexes as its
    // own segment(s), then the outer resumes.
    substitutionStack.push({ kind, quote: outerQuote, argv, heredocs, procsubs, word, inWord, wordExpands, bracketOpen, braceOpen, braceSeparator, skipNextWord, nextWordIsHereString, pipeFrom, pipeDepth, groupDepth, groupJustClosed, groupStarts, lastGroupStart, lastCh, body: [] });
    argv = [];
    heredocs = [];
    procsubs = [];
    word = '';
    inWord = false;
    resetWordFlags();
    skipNextWord = false;
    nextWordIsHereString = false;
    pipeFrom = null;
    pipeDepth = 0;
    groupDepth = 0;
    groupJustClosed = false;
    groupStarts = [];
    lastGroupStart = -1;
    lastCh = '';
    quote = null;
    if (kind === 'outproc') outputProcsubDepth += 1;
  };
  const closeSubstitution = () => {
    endSegment();
    const outer = substitutionStack.pop();
    if (outer.kind === 'outproc') outputProcsubDepth -= 1;
    argv = outer.argv;
    heredocs = outer.heredocs;
    procsubs = outer.procsubs;
    word = outer.word;
    inWord = outer.inWord;
    wordExpands = outer.wordExpands;
    bracketOpen = outer.bracketOpen;
    braceOpen = outer.braceOpen;
    braceSeparator = outer.braceSeparator;
    skipNextWord = outer.skipNextWord;
    nextWordIsHereString = outer.nextWordIsHereString;
    pipeFrom = outer.pipeFrom;
    pipeDepth = outer.pipeDepth;
    groupDepth = outer.groupDepth;
    groupJustClosed = outer.groupJustClosed;
    groupStarts = outer.groupStarts;
    lastGroupStart = outer.lastGroupStart;
    lastCh = outer.lastCh;
    quote = outer.quote;
    if (outer.kind === 'paren' || outer.kind === 'backtick') {
      // Command substitution: the outer word continues with a placeholder.
      word += SUBST;
      inWord = true;
    } else {
      // Process substitution: the body's own top-level segments are a
      // stdin source of the outer command; the operator itself contributes
      // no word. All inner segments stay in `segments` (they are commands
      // too), but only the direct body is attached — a nested `<(…)` is
      // already attached to the command inside the body that reads it.
      procsubs.push(...outer.body);
      skipNextWord = false;
      nextWordIsHereString = false;
    }
  };
  const appendUnquoted = (ch) => {
    // Track unquoted expansion characters so the finished word can be
    // marked runtime-decided: `*`/`?` always, `[…]` as a pair (so `[ -f x ]`
    // stays literal), `{a,b}`/`{a..b}` as a pair with a separator.
    if (ch === '*' || ch === '?') wordExpands = true;
    else if (ch === '[') bracketOpen = true;
    else if (ch === ']' && bracketOpen && word !== '[' && word !== '[[') wordExpands = true;
    else if (ch === '{') {
      braceOpen = true;
      braceSeparator = false;
    } else if (braceOpen && (ch === ',' || (ch === '.' && lastCh === '.'))) braceSeparator = true;
    else if (ch === '}' && braceOpen && braceSeparator) wordExpands = true;
    lastCh = ch;
    word += ch;
    inWord = true;
  };

  const src = command;
  const len = src.length;
  let i = 0;

  while (i < len) {
    const ch = src[i];

    if (quote === "'") {
      if (ch === "'") quote = null;
      else word += ch;
      i += 1;
      continue;
    }

    if (quote === '$') {
      if (ch === "'") {
        quote = null;
        i += 1;
        continue;
      }
      if (ch === '\\' && i + 1 < len) {
        const { text, len: n } = ansiEscape(src, i + 1);
        word += text;
        i += 1 + n;
        continue;
      }
      word += ch;
      i += 1;
      continue;
    }

    if (quote === '"') {
      if (ch === '"') {
        quote = null;
        i += 1;
        continue;
      }
      if (ch === '\\' && i + 1 < len) {
        const next = src[i + 1];
        if (next === '\n') {
          i += 2; // line continuation
          continue;
        }
        if (next === '"' || next === '\\' || next === '$' || next === '`') {
          word += next;
          i += 2;
          continue;
        }
        word += ch;
        i += 1;
        continue;
      }
      if (ch === '$' && src[i + 1] === '(') {
        openSubstitution('paren', '"');
        i += 2;
        continue;
      }
      if (ch === '`') {
        openSubstitution('backtick', '"');
        i += 1;
        continue;
      }
      word += ch;
      i += 1;
      continue;
    }

    // Unquoted.
    if (ch === '\\') {
      if (i + 1 < len) {
        if (src[i + 1] !== '\n') {
          word += src[i + 1];
          inWord = true;
        }
        i += 2;
      } else {
        word += ch;
        inWord = true;
        i += 1;
      }
      continue;
    }
    if (ch === '$' && (src[i + 1] === "'" || src[i + 1] === '"')) {
      // ANSI-C `$'…'` / locale `$"…"` quoting: the `$` is not a character.
      quote = src[i + 1] === "'" ? '$' : '"';
      inWord = true;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      inWord = true; // `""` is an empty word, not nothing
      i += 1;
      continue;
    }
    if (ch === '#' && !inWord) {
      while (i < len && src[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '\n') {
      i += 1;
      if (pendingHeredocs.length > 0) {
        // Consume heredoc bodies in declaration order; each ends at a line
        // equal to its delimiter (leading tabs stripped for `<<-`), and is
        // appended to the declaring segment's heredocs array.
        for (const { delimiter, stripTabs, expands, target } of pendingHeredocs.splice(0)) {
          const bodyLines = [];
          let closed = false;
          while (i < len) {
            let nl = src.indexOf('\n', i);
            if (nl === -1) nl = len;
            const rawLine = src.slice(i, nl);
            i = nl + 1;
            const line = stripTabs ? rawLine.replace(/^\t+/, '') : rawLine;
            if (line === delimiter) {
              closed = true;
              break;
            }
            bodyLines.push(line);
          }
          const body = bodyLines.join('\n');
          target.push(body);
          // `cat <<EOF … $(git push) … EOF`: the shell runs the
          // substitution whatever consumes the body, so each one is lexed
          // as its own top-level command.
          if (expands) {
            for (const inner of expansionCommands(body)) {
              const frame = substitutionStack[substitutionStack.length - 1];
              // Past the cap: one runtime-decided segment (fails closed). A
              // fresh object, not OPAQUE_PRODUCER — `feeds` is assigned below
              // and that constant is frozen.
              const innerSegments = nesting >= MAX_SHELL_DEPTH ? [{ argv: [SUBST], heredocs: [], procsubs: [], pipedFrom: null, inOutputProcsub: false, feeds: -1 }] : lexSegments(inner, nesting + 1);
              for (const segment of innerSegments) {
                segment.feeds = -1; // the inner lex ran its own post-pass; its indices are not ours
                segments.push(segment);
                if (frame) frame.body.push(segment);
              }
            }
          }
          if (!closed) break;
        }
        if (i > len) i = len;
      }
      separator();
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      endWord();
      i += 1;
      continue;
    }
    if (ch === '<' && src[i + 1] === '<' && src[i + 2] === '<') {
      // Here-string: the next word is stdin for the command, same role as
      // a heredoc body.
      dropFdOrEndWord();
      nextWordIsHereString = true;
      i += 3;
      continue;
    }
    if (ch === '<' && src[i + 1] === '<') {
      // Heredoc operator: `<<WORD`, `<<-WORD`, `<< "WORD"`. A quoted or
      // backslashed delimiter suppresses expansion of the body; an
      // unquoted one leaves `$(…)`/backticks in the body live.
      dropFdOrEndWord();
      i += 2;
      let stripTabs = false;
      if (src[i] === '-') {
        stripTabs = true;
        i += 1;
      }
      while (i < len && (src[i] === ' ' || src[i] === '\t')) i += 1;
      let delimiter = '';
      let dq = null;
      let expands = true;
      while (i < len) {
        const c = src[i];
        if (dq) {
          if (c === dq) dq = null;
          else delimiter += c;
          i += 1;
          continue;
        }
        if (c === "'" || c === '"') {
          dq = c;
          expands = false;
          i += 1;
          continue;
        }
        if (c === '\\' && i + 1 < len) {
          delimiter += src[i + 1];
          expands = false;
          i += 2;
          continue;
        }
        if (c === ' ' || c === '\t' || c === '\n' || c === ';' || c === '|' || c === '&' || c === '<' || c === '>' || c === '(' || c === ')') break;
        delimiter += c;
        i += 1;
      }
      // Bound to THIS segment's array so the body lands here even if the
      // segment is closed (by `|`, `&&`, `2>&1`…) before the newline.
      pendingHeredocs.push({ delimiter, stripTabs, expands, target: heredocs });
      continue;
    }
    if ((ch === '<' || ch === '>') && src[i + 1] === '(' && !inWord) {
      // Process substitution `<(…)` / `>(…)`: a stdin source for the
      // command (or, for `>(…)`, a command that reads its output).
      openSubstitution(ch === '<' ? 'inproc' : 'outproc', null);
      i += 2;
      continue;
    }
    if (ch === '<' || ch === '>' || (ch === '&' && (src[i + 1] === '>' || src[i + 1] === '<'))) {
      // Redirection: `>`, `>>`, `>|`, `<`, `<>`, `>&`, `<&`, `&>`, `&>>`,
      // optionally preceded by a fd (`2>`, `{fd}>`) that is part of the
      // operator, not a word. Drop the operator and its operand.
      dropFdOrEndWord();
      i += 1;
      if (ch === '&') i += 1; // consumed the `>`/`<` after `&`
      while (i < len && (src[i] === '>' || src[i] === '<' || src[i] === '&' || src[i] === '|')) i += 1;
      while (i < len && (src[i] === ' ' || src[i] === '\t')) i += 1;
      // `cmd < <(…)`: the operand is a process substitution, lexed as a
      // stdin source by the branch above on the next iteration — nothing
      // to skip. A bare `(` is a subshell boundary.
      if (src[i] === '(' || (src[i] === '<' && src[i + 1] === '(')) continue;
      skipNextWord = true;
      continue;
    }
    if (ch === '$' && src[i + 1] === '(') {
      openSubstitution('paren', null);
      i += 2;
      continue;
    }
    if (ch === '`') {
      const top = substitutionStack[substitutionStack.length - 1];
      if (top && top.kind === 'backtick') {
        closeSubstitution();
      } else {
        openSubstitution('backtick', null);
      }
      i += 1;
      continue;
    }
    if (ch === ')') {
      // A `(` opened inside this frame closes first: `$( (sh) <<< x )`.
      const top = substitutionStack[substitutionStack.length - 1];
      if (groupDepth === 0 && top && top.kind !== 'backtick') {
        closeSubstitution();
      } else {
        endSegment();
        closeGroup();
        groupJustClosed = true;
      }
      i += 1;
      continue;
    }
    if (ch === '|') {
      endSegment();
      if (src[i + 1] === '|') {
        clearPipeIfOutside();
        i += 2; // `||`: not a pipe
      } else {
        if (src[i + 1] === '&') i += 1; // `|&`
        pipeFrom = groupJustClosed ? OPAQUE_PRODUCER : segments[segments.length - 1] || null;
        pipeDepth = groupDepth;
        i += 1;
      }
      groupJustClosed = false;
      continue;
    }
    if (ch === '(') {
      endSegment();
      openGroup();
      i += 1;
      continue;
    }
    if (ch === ';' || ch === '&') {
      separator();
      i += 1;
      continue;
    }

    appendUnquoted(ch);
    i += 1;
  }

  endSegment();
  // Hand a group's trailing stdin sources to every command inside it that
  // has none of its own (`{ sh; } <<EOF` runs the heredoc through sh).
  // Inner groups come first in `segments`, so their own trailing sources
  // win over an outer group's.
  // `fedThrough`: for a range start, the index of the last trailing
  // segment that fed it, so an enclosing group skips an already-fed inner
  // range in one step (nested `{ { { sh; } <<A; } <<B; } <<C` stays linear).
  const fedThrough = new Map();
  for (let k = 0; k < segments.length; k += 1) {
    const trailing = segments[k];
    if (trailing.feeds < 0 || !hasOwnStdin(trailing)) continue;
    for (let j = trailing.feeds; j < k; j += 1) {
      const skipTo = fedThrough.get(j);
      if (skipTo !== undefined) {
        j = skipTo;
        continue;
      }
      const fed = segments[j];
      if (hasOwnStdin(fed)) continue;
      // Share, never copy: `fed` has no sources of its own, so the group's
      // arrays are its stdin verbatim; `stdinFrom` lets the stdin memo key
      // on the trailing segment so N readers cost one scan.
      fed.heredocs = trailing.heredocs;
      fed.procsubs = trailing.procsubs;
      fed.inOutputProcsub = trailing.inOutputProcsub;
      fed.stdinFrom = trailing;
    }
    fedThrough.set(trailing.feeds, k);
  }
  return segments;
}

/**
 * Text a literal producer (`echo`, `printf`, `cat <<EOF`) writes to
 * stdout, or null when it cannot be known statically (`cat file`,
 * `echo -e`, a printf format with `%`, a runtime-decided argument).
 */
const producedTextCache = new WeakMap();
function producedText(segment, hops = 0) {
  if (!segment || hops > 8) return null;
  if (producedTextCache.has(segment)) return producedTextCache.get(segment);
  const text = computeProducedText(segment, hops);
  producedTextCache.set(segment, text);
  return text;
}
function computeProducedText(segment, hops) {
  const name = programName(segment.argv[0] || '');
  if (!LITERAL_PRODUCERS.has(name)) return null;
  const args = segment.argv.slice(1).filter((a) => !a.startsWith('-') || a === '-');
  if (args.some((a) => a.includes(SUBST))) return null; // runtime-built text
  if (name === 'cat') {
    // `cat <<EOF | bash` is literal; `cat | bash` passes its own stdin
    // through; `cat script.sh | bash` is opaque.
    if (args.some((a) => a !== '-')) return null;
    if (segment.heredocs.length > 0) return segment.heredocs.join('\n');
    return segment.pipedFrom ? producedText(segment.pipedFrom, hops + 1) : null;
  }
  if (name === 'echo') {
    // `-e` (or an xpg_echo shell) interprets backslash escapes; only a
    // backslash-free text is known statically.
    const options = segment.argv.slice(1).filter((a) => a.startsWith('-') && a !== '-');
    if (options.some((o) => /^-[a-zA-Z]*[eE]/.test(o)) || args.some((a) => a.includes('\\'))) return null;
    return [args.join(' '), ...segment.heredocs].join('\n');
  }
  // printf: only `\n`/`\t` escapes and a `%`-free format are modelled.
  const [format = '', ...rest] = args;
  if (format.includes('%') || /\\(?![nt])/.test(format) || rest.some((a) => a.includes('\\') || a.includes('%'))) return null;
  return [[format.replace(/\\n/g, '\n').replace(/\\t/g, '\t'), ...rest].join(' '), ...segment.heredocs].join('\n');
}

/**
 * Scan a value that git or the shell will run as a command: `PAGER=…`,
 * `GIT_SSH_COMMAND=…` assignment prefixes (and `env` operands).
 */
function commandValueInvokesGitPush(assignment, depth) {
  const m = ASSIGNMENT_NAME_RE.exec(assignment);
  if (!m) return false;
  const [, name, value] = m;
  return COMMAND_ENV_VARS.has(name) && value !== '' && commandInvokesGitPushAtDepth(value, depth + 1, null);
}

/** Scan a `-c key=value` git config override that git may execute. */
function gitConfigInvokesGitPush(kv, depth) {
  const eq = kv.indexOf('=');
  if (eq === -1) return false;
  const key = kv.slice(0, eq).toLowerCase();
  const value = kv.slice(eq + 1);
  if (key.startsWith('alias.')) {
    // `-c alias.p=push p` / `-c alias.p='!git push' p`
    if (PUSH_SUBCOMMANDS.has(value.trim().split(/\s+/)[0])) return denyVerified();
    return value.startsWith('!') && commandInvokesGitPushAtDepth(value.slice(1), depth + 1, null);
  }
  // core.pager, core.fsmonitor, diff.external, core.sshCommand, … are
  // handed to `sh -c`: re-scan the value as a shell string. A leading `!`
  // (credential.helper, and the forms git strips before `sh -c`) is not
  // part of the command. Other keys (`user.name='git push'`) are data.
  if (!COMMAND_CONFIG_KEY_RE.test(key)) return false;
  return commandInvokesGitPushAtDepth(value.replace(/^\s*!/, ''), depth + 1, null);
}

/**
 * Whether `git <sub> <rest…>` runs a caller-supplied command that pushes
 * (`rebase --exec 'git push'`, `submodule foreach 'git push'`, `bisect run
 * git push`, `difftool -x …`, `filter-branch --commit-filter …`,
 * `for-each-repo --config=… push`) or is a push under another name
 * (`subtree push`).
 */
function gitSubcommandInvokesGitPush(sub, rest, depth, stdinCtx) {
  const spec = Object.hasOwn(GIT_EXEC_SUBCOMMANDS, sub) ? GIT_EXEC_SUBCOMMANDS[sub] : null;
  if (!spec) return false;
  if (spec.pushVerb || spec.gitArgs) {
    if (rest.some((w) => PUSH_SUBCOMMANDS.has(w))) return denyVerified();
    if (rest.some((w) => w.includes(SUBST))) return denyUnverifiable();
    return false;
  }
  if (spec.configWrite) {
    // Operands after the options: `[verb] key value [value-pattern]`.
    const operands = [];
    for (let j = 0; j < rest.length; j += 1) {
      const w = rest[j];
      if (w === '--') {
        operands.push(...rest.slice(j + 1));
        break;
      }
      if (w.startsWith('-')) {
        if (GIT_CONFIG_TAKES_VALUE.has(w)) j += 1;
        continue;
      }
      operands.push(w);
    }
    if (GIT_CONFIG_READ_VERBS.has(operands[0])) return false;
    if (rest.some((w) => GIT_CONFIG_READ_OPTIONS.has(w))) return false; // `--get alias.p pattern`, `--unset …`
    if (GIT_CONFIG_WRITE_VERBS.has(operands[0])) operands.shift();
    const [key, value] = operands;
    if (key === undefined || value === undefined) return false; // a read
    if (key.includes(SUBST)) return denyUnverifiable();
    // A runtime-built value is only decisive for a key git executes.
    if (value.includes(SUBST)) {
      return (key.toLowerCase().startsWith('alias.') || COMMAND_CONFIG_KEY_RE.test(key)) ? denyUnverifiable() : false;
    }
    return gitConfigInvokesGitPush(`${key}=${value}`, depth);
  }
  if (spec.shellOptions) {
    for (let j = 0; j < rest.length; j += 1) {
      const w = rest[j];
      let script = null;
      for (const opt of spec.shellOptions) {
        if (w === opt) script = rest[j + 1];
        else if (w.startsWith(opt) && w.length > opt.length && (opt.startsWith('--') ? w[opt.length] === '=' : true)) script = w.slice(opt.length).replace(/^=/, '');
        if (script !== null) break;
      }
      if (script === undefined) return false; // option at the end: git errors
      if (script === null) continue;
      if (script.includes(SUBST)) return denyUnverifiable();
      if (commandInvokesGitPushAtDepth(script, depth + 1, stdinCtx)) return true;
    }
    return false;
  }
  const verb = spec.shellVerb || spec.argvVerb;
  let k = 0;
  while (k < rest.length && rest[k] !== verb) k += 1;
  if (k >= rest.length) return false;
  let words = rest.slice(k + 1);
  if (spec.shellVerb) {
    // `git submodule foreach [--recursive] [-q] <command…>`: git joins the
    // words and hands them to `sh -c`.
    words = words.filter((w) => !['--recursive', '-q', '--quiet', '--'].includes(w));
    if (words.some((w) => w.includes(SUBST))) return denyUnverifiable();
    return words.length > 0 && commandInvokesGitPushAtDepth(words.join(' '), depth + 1, stdinCtx);
  }
  // `git bisect run <argv…>`: an argv, judged like any simple command.
  // Anything but a clean "no" (a shell reading stdin, xargs) is a deny.
  if (words.length === 0) return false;
  const synthetic = { argv: words, heredocs: [], procsubs: [], pipedFrom: null, inOutputProcsub: false, feeds: -1 };
  if (depth + 1 > MAX_SHELL_DEPTH) return denyUnverifiable();
  return segmentVerdict(synthetic, depth + 1, stdinCtx) !== false;
}

/**
 * Verdict for one lexed simple command, after peeling leading reserved
 * words, assignments and transparent wrappers:
 *   true  — runs `git push` (or cannot be read: fail closed)
 *   false — does not
 *   null  — a shell (or `source`) whose script comes from stdin; the
 *           caller scans the segment's stdin sources (heredocs,
 *           here-strings, process substitutions, the pipe) or, for a
 *           re-scanned `-c` string, the outer command's.
 *   'stdin-args' — the decisive words arrive on stdin via xargs
 *           (`… | xargs git`, `… | xargs sh -c`); the caller inspects the
 *           pipe's text for a push token.
 * A string re-scanned from this command (`-c`, `eval`, `sudo -s`, `su -c`,
 * `env -S`) inherits this command's stdin sources, or failing those the
 * `outerStdin` this command itself inherited.
 */
function segmentVerdict(segment, depth, outerStdin) {
  const argv = segment.argv;
  // The stdin any string re-scanned from this command inherits: this
  // command's own sources, else the ones the enclosing `-c`/eval string
  // inherited (`echo 'git push' | bash -c 'bash -c sh'`).
  const stdinCtx = hasOwnStdin(segment) ? segment : outerStdin;
  let i = 0;
  while (i < argv.length && LEADING_RESERVED.has(argv[i])) i += 1;
  // `FOO=bar git push` — and `PAGER='git push' git log`.
  while (i < argv.length && ASSIGNMENT_RE.test(argv[i])) {
    if (commandValueInvokesGitPush(argv[i], depth)) return true;
    i += 1;
  }

  // Peel wrappers: `sudo -u me env X=1 timeout 5 git push`.
  let viaXargs = false;
  let xargsToken = null;
  let peels = 0;
  // Set once a wrapper that runs `$SHELL` when given no command has
  // consumed the rest of argv (`sudo -s <<EOF`, `su -`, `unshare -r`): the
  // shell reads its script from stdin, so the verdict is null, not false.
  let bareShell = false;
  for (;;) {
    if (i >= argv.length) return viaXargs ? 'stdin-args' : bareShell ? null : false;
    if (argv[i].includes(SUBST)) return denyUnverifiable(); // program name decided at runtime
    const name = programName(argv[i]);
    const wrapper = Object.hasOwn(WRAPPERS, name) ? WRAPPERS[name] : null;
    if (!wrapper) break;
    if ((peels += 1) > MAX_WRAPPER_PEELS) return denyUnverifiable();
    if (name === 'xargs') viaXargs = true;
    bareShell = Boolean(wrapper.shellIfBare);
    i += 1;
    // One arity-aware pass over the wrapper's own option region: shell-
    // string options (which may follow the wrapper's positionals: `su root
    // -c …`, `flock file -c …`) are re-scanned; value-taking options skip
    // their operand; `--` ends the region.
    let restIsShell = false;
    let positionalsSeen = 0;
    let optionsSeen = false;
    while (i < argv.length) {
      const opt = argv[i];
      const isOption = opt.startsWith('-') && (opt !== '-' || name === 'env' || name === 'su' || name === 'runuser');
      if (!isOption) {
        const envAssignment = name === 'env' && ASSIGNMENT_RE.test(opt);
        const positional =
          positionalsSeen < wrapper.positionals &&
          !(wrapper.positionalOnlyWithoutOptions && optionsSeen) &&
          (!wrapper.positionalRe || wrapper.positionalRe.test(opt));
        if (envAssignment) {
          if (commandValueInvokesGitPush(opt, depth)) return true;
        } else if (positional) {
          positionalsSeen += 1;
        } else {
          break;
        }
        i += 1;
        continue;
      }
      i += 1;
      optionsSeen = true;
      if (opt === '--') break;
      if (wrapper.shellRest && wrapper.shellRest.has(opt)) {
        restIsShell = true;
        continue;
      }
      if (wrapper.shellString) {
        const cluster = !opt.startsWith('--') && opt.length > 2 && !opt.includes('=') && wrapper.shellString.has('-' + opt[opt.length - 1]);
        if (wrapper.shellString.has(opt) || cluster) {
          if (i >= argv.length) return viaXargs ? 'stdin-args' : false;
          if (argv[i].includes(SUBST)) return denyUnverifiable();
          return commandInvokesGitPushAtDepth(argv[i], depth + 1, stdinCtx);
        }
        const attached = wrapper.shellStringList.find((o) => opt.startsWith(o) && opt.length > o.length && (o.startsWith('--') ? opt[o.length] === '=' : true));
        if (attached) return commandInvokesGitPushAtDepth(opt.slice(attached.length).replace(/^=/, ''), depth + 1, stdinCtx);
      }
      const singleDash = !opt.startsWith('--') && !opt.includes('=');
      if (name === 'xargs') {
        // Replacement token: `-I str`, `-Istr`, `-rI str`, `-0I{}`,
        // `--replace[=str]`, `-i[str]` — the letter may sit anywhere in a
        // cluster (the letters before it are boolean flags); any later word
        // containing the token is runtime text.
        const at = singleDash ? opt.search(/[Ii]/) : -1;
        if (at > 0) {
          const rest = opt.slice(at + 1);
          if (opt[at] === 'i') xargsToken = rest === '' ? '{}' : rest;
          else if (rest !== '') xargsToken = rest;
          else {
            xargsToken = argv[i] === undefined ? '{}' : argv[i];
            i += 1;
          }
          continue;
        }
        if (opt === '--replace') xargsToken = '{}';
        else if (opt.startsWith('--replace=')) xargsToken = opt.slice('--replace='.length);
      }
      // `-u root` and its cluster form `-Eu root`: the LAST letter of a
      // cluster may take the next word.
      if (wrapper.takesValue.has(opt) || (singleDash && opt.length > 2 && wrapper.takesValue.has('-' + opt[opt.length - 1]))) i += 1;
    }
    if (restIsShell) {
      // `sudo -s 'git push'` / `sudo -i git push`: the remaining argv is
      // handed to the target user's shell as one command string; with
      // nothing after it the shell reads stdin.
      if (i >= argv.length) return viaXargs ? 'stdin-args' : null;
      if (argv.slice(i).some((a) => a.includes(SUBST))) return denyUnverifiable();
      return commandInvokesGitPushAtDepth(argv.slice(i).join(' '), depth + 1, stdinCtx);
    }
    if (xargsToken !== null && xargsToken !== '') {
      for (let j = i; j < argv.length; j += 1) {
        if (argv[j].includes(xargsToken) && !argv[j].includes(SUBST)) argv[j] += SUBST;
      }
    }
  }

  // Invariant from the loop's break: i < argv.length and argv[i] holds no
  // SUBST.
  const program = programName(argv[i]);

  if (program.startsWith('git-') && PUSH_SUBCOMMANDS.has(program.slice(4))) return denyVerified();

  if (program === 'git') {
    i += 1;
    while (i < argv.length) {
      const tok = argv[i];
      i += 1;
      if (tok === '--') break; // end of options: the next word is the subcommand
      if (tok.includes(SUBST)) return denyUnverifiable(); // `git $(x) push`: subcommand decided at runtime
      if (!tok.startsWith('-')) {
        if (PUSH_SUBCOMMANDS.has(tok)) return denyVerified();
        return gitSubcommandInvokesGitPush(tok, argv.slice(i), depth, stdinCtx);
      }
      if (GIT_OPTION_TAKES_VALUE.has(tok)) {
        // `-c core.pager='git push'`: git runs the value.
        if (tok === '-c' && i < argv.length && gitConfigInvokesGitPush(argv[i], depth)) return true;
        i += 1;
      } else if (tok.startsWith('-c') && tok.length > 2 && gitConfigInvokesGitPush(tok.slice(2), depth)) {
        return true;
      }
    }
    if (i < argv.length) {
      if (argv[i].includes(SUBST)) return denyUnverifiable();
      if (PUSH_SUBCOMMANDS.has(argv[i])) return denyVerified();
      return gitSubcommandInvokesGitPush(argv[i], argv.slice(i + 1), depth, stdinCtx);
    }
    return viaXargs ? 'stdin-args' : false; // `xargs git -C x`: subcommand still comes from stdin
  }

  if (program === 'eval') {
    let j = i + 1;
    if (argv[j] === '--') j += 1; // eval skips a leading `--`
    return commandInvokesGitPushAtDepth(argv.slice(j).join(' '), depth + 1, stdinCtx);
  }

  if (SOURCE_BUILTINS.has(program)) return null;

  if (SHELLS.has(program) || OPAQUE_SHELLS.has(program)) {
    const opaque = OPAQUE_SHELLS.has(program);
    // Find `-c`: as `-c` or inside a single-dash cluster (`-lc`, `-ec`);
    // the command string is the first NON-option word after it (`bash -c
    // -e 'git push'`, `sh -c -- 'git push'`).
    i += 1;
    let sawC = false;
    while (i < argv.length) {
      const tok = argv[i];
      if (tok === '--') {
        i += 1;
        break;
      }
      if (!tok.startsWith('-') && !tok.startsWith('+')) break;
      i += 1;
      if (SHELL_OPTION_TAKES_VALUE.has(tok)) {
        i += 1;
        continue;
      }
      if (tok.startsWith('-') && !tok.startsWith('--') && tok.includes('c')) sawC = true;
      if (opaque && (tok === '-Command' || tok === '--command' || tok === '-e' || tok === '--execute')) sawC = true;
    }
    if (sawC) {
      if (opaque) return denyUnverifiable(); // a fish/csh/pwsh string: unreadable
      if (i >= argv.length) return viaXargs ? 'stdin-args' : false; // `… | xargs sh -c`
      if (argv[i].includes(SUBST)) return denyUnverifiable(); // replacement token / substitution
      return commandInvokesGitPushAtDepth(argv[i], depth + 1, stdinCtx);
    }
    return null; // no -c: caller checks stdin sources
  }

  return false;
}

// Per-top-level-call memo of stdin text verdicts, keyed by the text itself
// (the same string object every reader of one producer sees), so a pipe
// into `{ sh; sh; sh; … }` or a heredoc inherited by many `-c` strings is
// scanned once, not once per reader.
let stdinMemo = null;
function memoised(map, key, compute) {
  if (map.has(key)) return map.get(key);
  const value = compute();
  map.set(key, value);
  return value;
}
/** `text` read as a shell script at `depth`. */
function stdinScriptInvokesGitPush(text, depth) {
  // A script read from stdin always ends in a newline (heredoc lines carry
  // one; a here-string gets one appended), so a trailing backslash is a
  // line continuation the shell erases — `bash <<< 'git push\\'` pushes.
  return memoised(memoised(stdinMemo.script, depth, () => new Map()), text, () => commandInvokesGitPushAtDepth(text + '\n', depth, null));
}
/** `text` split into words by xargs: opaque when it carries quoting. */
function stdinWordsInvokeGitPush(text) {
  return memoised(stdinMemo.words, text, () => /['"\\]/.test(text) || text.split(/\s+/).some((t) => PUSH_SUBCOMMANDS.has(t)));
}

/**
 * The literal text a segment's stdin sources deliver, or null when there
 * is none or any of them is opaque.
 */
function stdinText(segment) {
  return memoised(stdinMemo.text, segment.stdinFrom || segment, () => computeStdinText(segment));
}
function computeStdinText(segment) {
  if (!hasOwnStdin(segment) || segment.inOutputProcsub) return null;
  const parts = [...segment.heredocs];
  for (const source of [...segment.procsubs, ...(segment.pipedFrom ? [segment.pipedFrom] : [])]) {
    const text = producedText(source);
    if (text === null) return null;
    parts.push(text);
  }
  return parts.join('\n');
}

/** True when a segment's stdin sources contain a push, or cannot be read. */
function stdinInvokesGitPush(segment, depth) {
  const key = segment.stdinFrom || segment;
  return memoised(memoised(stdinMemo.stdin, key, () => new Map()), depth, () => computeStdinInvokesGitPush(segment, depth));
}
function computeStdinInvokesGitPush(segment, depth) {
  if (segment.inOutputProcsub) return denyUnverifiable(); // `tee >(sh)`: reads what the outer wrote
  for (const body of segment.heredocs) {
    if (stdinScriptInvokesGitPush(body, depth + 1)) return true;
  }
  for (const inner of segment.procsubs) {
    const text = producedText(inner);
    if (text === null) return denyUnverifiable();
    if (stdinScriptInvokesGitPush(text, depth + 1)) return true;
  }
  if (segment.pipedFrom) {
    const text = producedText(segment.pipedFrom);
    if (text === null) return denyUnverifiable(); // `curl … | sh`, `cat file | bash`: opaque script
    if (stdinScriptInvokesGitPush(text, depth + 1)) return true;
  }
  return false;
}

function hasOwnStdin(segment) {
  return segment.inOutputProcsub || segment.heredocs.length > 0 || segment.procsubs.length > 0 || segment.pipedFrom !== null;
}

/**
 * @param {string} command
 * @param {number} depth
 * @param {object|null} outerStdin — the segment whose `-c`/`eval` string
 *   this is, so `echo 'git push' | sh -c sh` reaches the inner bare `sh`.
 */
function commandInvokesGitPushAtDepth(command, depth, outerStdin) {
  if (depth > MAX_SHELL_DEPTH) return denyUnverifiable();
  const segments = lexSegments(command);
  for (const segment of segments) {
    const verdict = segmentVerdict(segment, depth, outerStdin);
    if (verdict === true) return true;
    if (verdict === 'stdin-args') {
      // The decisive words arrive on stdin via xargs: readable only from
      // literal sources (a heredoc, a here-string, a producer behind a pipe
      // or `<(…)`), otherwise deny. xargs strips quotes and backslashes
      // from its input, so text containing any is opaque.
      const text = stdinText(segment);
      if (text === null) return denyUnverifiable();
      if (stdinWordsInvokeGitPush(text)) return denyVerified();
      continue;
    }
    if (verdict === null) {
      // A shell reading its script from stdin.
      if (hasOwnStdin(segment)) {
        if (stdinInvokesGitPush(segment, depth)) return true;
      } else if (outerStdin && hasOwnStdin(outerStdin) && stdinInvokesGitPush(outerStdin, depth)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * @param {string} command Raw Bash tool command string.
 * @returns {boolean} true when some simple command in it runs `git push`
 *   (directly, through a path/wrapper/global options, or via a nested
 *   `sh -c`/heredoc/pipe script). Also true on any internal parser error —
 *   the backstop fails closed rather than vouching for input it could not
 *   lex.
 */
/**
 * @param {string} command Raw Bash tool command string.
 * @returns {'allow' | 'verified-push' | 'unverifiable'}
 */
function classifyGitPushCommand(command) {
  const ctx = { verifiedPush: false, unverifiable: false };
  stdinMemo = { script: new Map(), words: new Map(), stdin: new Map(), text: new Map() };
  analysisCtx = ctx;
  try {
    const denied = commandInvokesGitPushAtDepth(String(command), 0, null);
    if (!denied) return 'allow';
    return ctx.verifiedPush ? 'verified-push' : 'unverifiable';
  } catch {
    return 'unverifiable';
  } finally {
    analysisCtx = null;
    stdinMemo = null;
  }
}

function commandInvokesGitPush(command) {
  return classifyGitPushCommand(command) !== 'allow';
}

module.exports = { commandInvokesGitPush, classifyGitPushCommand, MAX_SHELL_DEPTH, MAX_WRAPPER_PEELS };
