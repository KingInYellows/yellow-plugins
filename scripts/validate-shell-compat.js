#!/usr/bin/env node

/**
 * validate-shell-compat.js
 *
 * Static bash/zsh compatibility lint for plugin shell code. Claude Code's
 * Bash tool runs every fenced bash block in command, skill and agent
 * markdown under the user's login shell — often zsh, with whatever options
 * and aliases the user's shell snapshot carries (noclobber, extendedglob,
 * rcquotes, ...). `.sh` files with a bash shebang still run under bash.
 * It enforces the four-tier contract in CONTRIBUTING.md "Bash and zsh":
 * inline blocks must run in bash and zsh; bash-only code runs in a
 * `bash /dev/fd/3 3<<'TAG'` wrapper, whose body is exempt from the inline
 * rules; `tier3Libraries` may be sourced only inside that wrapper; and
 * `tier4Libraries` are sourced directly, so their whole file is linted.
 *
 * Rules (each finding prints file, line, rule and a one-line fix):
 *   SHC-001  redirect that zsh noclobber refuses (onto a mktemp/touch file,
 *            or a second `>` onto the same target in one block)
 *   SHC-002  assignment to a zsh special parameter (status, path, argv, ...)
 *   SHC-003  bash-only builtin or expansion outside a bash wrapper
 *   SHC-004  echo with -e or backslash escapes (zsh echo interprets them)
 *   SHC-005  0-based array indexing (zsh arrays start at 1)
 *   SHC-006  `==` inside single-bracket `[ … ]` (zsh treats `=word` as a path)
 *   SHC-007  adjacent single-quoted strings (`'a''b'` changes under rcquotes)
 *   SHC-008  markdown sources a Tier 3 library outside a wrapper, or sources
 *            a plugin library that is in neither tier list
 *   SHC-009  a bash wrapper other than `bash /dev/fd/3 3<<'TAG'`
 *   SHC-101  plugin `.sh` file with no shebang and no library marker
 *   SHC-900  shell-compat-config.json problem (unknown path, missing reason,
 *            stale allowlist cap, ...)
 *
 * Scope: fenced blocks tagged bash/sh/shell in `plugins/**\/*.md`, excluding
 * the generated `plugins/<p>/{codex,cursor}/skills/` copies (fix the source
 * and regenerate), `plugins/<p>/tests/`, and CHANGELOG.md. Quoted heredoc
 * bodies are data, not shell, and are skipped.
 *
 * Allowlist (`allowlist` in the config) caps findings per file and rule:
 *   { "plugins/x/y.md": { "SHC-005": { "max": 1, "reason": "..." } } }
 * Exceeding the cap fails; a cap above the actual count is stale and fails;
 * an empty reason fails. Keyed by file + rule, never by line, so edits
 * elsewhere in the file do not churn it.
 *
 * Usage: node scripts/validate-shell-compat.js [--json]
 *   --json    print findings as JSON (for measurement runs)
 * VALIDATE_SHELL_COMPAT_ROOT overrides the repo root (tests use fixtures).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { extractRawFencedBlocks } = require('./lib/markdown-fences');

const SHELL_LANGS = new Set(['bash', 'sh', 'shell']);
const GENERATED_SKILL_DIRS = new Set(['codex', 'cursor']);
const LIBRARY_MARKER = '# shell-compat: library';

const RULES = {
  'SHC-001': {
    summary: 'redirect refused by zsh noclobber',
    hint: 'use `>|` where overwriting is intended, or let the redirect create the file (no mktemp/touch first)',
  },
  'SHC-002': {
    summary: 'assignment to a zsh special parameter',
    hint: 'rename the variable (status → rc, path → file_path); in zsh `path` is tied to PATH and `status` is read-only',
  },
  'SHC-003': {
    summary: 'bash-only construct outside a bash wrapper',
    hint: "rewrite with a construct both shells accept, or run the block in bash: bash /dev/fd/3 3<<'TAG' … TAG",
  },
  'SHC-004': {
    summary: 'echo with escapes behaves differently in zsh',
    hint: "use `printf '%s\\n'` (zsh's echo interprets backslash escapes; bash's does not)",
  },
  'SHC-005': {
    summary: '0-based array index (zsh arrays start at 1)',
    hint: 'iterate with "${arr[@]}" instead of indexing, or wrap the block in bash',
  },
  'SHC-006': {
    summary: '`==` inside single brackets',
    hint: 'use `[ "$a" = "$b" ]` (zsh expands `==` as an =command path)',
  },
  'SHC-007': {
    summary: "adjacent single-quoted strings ('a''b')",
    hint: "join into one quoted string; zsh's rcquotes option turns '' into a literal quote",
  },
  'SHC-008': {
    summary: 'library sourced into the user shell',
    hint: "source Tier 3 (bash-only) libraries inside a bash /dev/fd/3 3<<'TAG' … TAG wrapper; classify new libraries in scripts/shell-compat-config.json",
  },
  'SHC-009': {
    summary: 'unsupported bash wrapper form',
    hint: "use bash /dev/fd/3 3<<'TAG' … TAG: bash <<'TAG' lets any stdin reader swallow the script, and the git-push hook refuses bash -c \"$(…)\"",
  },
  'SHC-101': {
    summary: 'shell file without a shebang or library marker',
    hint: `add a shebang, or \`${LIBRARY_MARKER}\` in the first five lines for a sourced library`,
  },
  'SHC-900': {
    summary: 'shell-compat-config.json problem',
    hint: 'fix scripts/shell-compat-config.json',
  },
};

// ---------------------------------------------------------------------------
// File discovery

// A directory that cannot be read would silently drop every file under it,
// so only a directory that vanished mid-walk is skipped.
function walk(dir, predicate, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return out;
    throw err;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.git'))
      continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, predicate, out);
    else if (entry.isFile() && predicate(entry.name)) out.push(full);
  }
  return out;
}

function toRelative(root, absPath) {
  return path.relative(root, absPath).split(path.sep).join('/');
}

// plugins/<p>/<dir>/... → true for generated skill copies and test trees.
function isExcludedPluginPath(rel) {
  const parts = rel.split('/');
  if (parts[0] !== 'plugins' || parts.length < 3) return false;
  if (parts[2] === 'tests') return true;
  if (GENERATED_SKILL_DIRS.has(parts[2]) && parts[3] === 'skills') return true;
  return path.basename(rel) === 'CHANGELOG.md';
}

function pluginsDir(root) {
  const dir = path.join(root, 'plugins');
  if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`no plugins/ directory under ${root}`);
  }
  return dir;
}

function listMarkdownFiles(root) {
  return walk(pluginsDir(root), (name) => name.endsWith('.md'))
    .map((abs) => toRelative(root, abs))
    .filter((rel) => !isExcludedPluginPath(rel))
    .sort();
}

function listShellFiles(root) {
  return walk(pluginsDir(root), (name) => name.endsWith('.sh'))
    .map((abs) => toRelative(root, abs))
    .sort();
}

// ---------------------------------------------------------------------------
// Line classification:
//   code     ordinary shell
//   comment  a `#` comment line
//   data     text the shell never expands: a quoted-tag heredoc body
//            (`<<'EOF'`) or the inside of a multi-line single-quoted string
//   expand   text the shell does not run but DOES expand: an unquoted-tag
//            heredoc body or the inside of a multi-line double-quoted string.
//            Only the expansion rules apply (`${reviewer^}` there is still a
//            zsh `bad substitution`).
//   pinned   runs under a bash child (a quoted-tag heredoc fed to bash). A
//            `bash -c '…'` line stays `code` with the script blanked, so the
//            outer command is linted

// `<<TAG`, `<<-TAG`, `<<'TAG'`, `<<"TAG"` — but never the `<<<` here-string.
const HEREDOC_RE = /(?<!<)<<(-?)[ \t]*(["']?)([A-Za-z_][A-Za-z0-9_]*)\2/;
// The command in front of the heredoc is a bash interpreter: `bash`,
// `bash -s -- "$x"`, `command bash`, possibly after `&&`/`;`/`|`.
// A quoted operand may contain `<` (`'<todo-path>'`); an unquoted `<` is a
// redirect, so the heredoc is not the script. A quote still open at the
// heredoc (`bash -c "$(cat <<'TAG'`) is allowed.
const BASH_WRAPPER_PREFIX_RE =
  /(?:^|[\s;&|(])(?:command\s+)?bash(?:\s(?:'[^']*'|"[^"]*"|[^<'"]|["'](?=[^'"]*$))*)?$/;
// The supported wrapper, `bash /dev/fd/3 3<<'TAG'`: bash reads the script
// from fd 3, so stdin stays the caller's, and the git-push hook can inspect
// the body. `bash` must be the command itself (no sudo/ssh/env prefix); only
// harmless options may precede /dev/fd/N and only quoted operands follow it.
// Every other bash-fed heredoc is SHC-009.
const WRAPPER_OPTION = String.raw`(?:--norc|--noprofile|--|-[eux]+|-o\s+(?:pipefail|errexit|nounset|xtrace))`;
const WRAPPER_OPERAND = String.raw`(?:'[^']*'|"\$\{?[A-Za-z_][A-Za-z0-9_]*\}?")`;
const BASH_FD_WRAPPER_RE = new RegExp(
  String.raw`(?:^|(?<=[\s;&|(){!]))(?:command\s+)?bash((?:\s+${WRAPPER_OPTION})*)\s+\/dev\/fd\/(\d+)((?:\s+${WRAPPER_OPERAND})*)\s+(\d+)$`
);
// What may stand before `bash` for it to be the command word. A case-arm
// pattern `y)` / `(a|b)` also counts, but only at line start, after `in` or
// after `;;`/`;&` — a bare `)` (`$(foo)`, `(cd x)`) does not.
const COMMAND_POSITION_RE =
  /(?:^|[;&|({!]|(?:^|\s)(?:then|do|else|elif|if|while|until|time)|(?:^\s*|;[;&]\s*|\bin\s+)\(?[^\s()|;&]+(?:\|[^\s()|;&]+)*\))$/;
// `$((…))` / `((…))` spans: `<<` and `>` inside them are arithmetic shifts
// and comparisons, not heredocs or redirects.
const ARITHMETIC_RE = /\$?\(\((?:[^()]|\([^()]*\))*\)\)/g;
function stripArithmetic(code) {
  return code.replace(ARITHMETIC_RE, '0');
}
const BASH_DASH_C_RE = /(?:^|[\s;&|(])bash\s+(?:-\w+\s+)*-c\s/;

// Checks the text in front of a heredoc that feeds bash. Returns
// { start, problem }: `start` is where the wrapper command begins and
// `problem` is '' for the supported fd form, else the SHC-009 detail.
function parseFdWrapper(prefix) {
  const m = BASH_FD_WRAPPER_RE.exec(prefix);
  if (!m) {
    let problem = 'script fed to bash on stdin';
    if (/\s-[A-Za-z]*c\b/.test(prefix)) {
      problem = 'bash -c "$(…)" is refused by the git-push hook';
    } else if (/\/dev\/fd\//.test(prefix)) {
      problem =
        'only --norc, --noprofile, -e/-u/-x and -o pipefail may precede /dev/fd/N, and only quoted operands may follow it';
    }
    return { start: -1, problem };
  }
  if (!COMMAND_POSITION_RE.test(prefix.slice(0, m.index).trimEnd())) {
    return {
      start: m.index,
      problem: 'bash must be the command itself (no sudo, ssh or env prefix)',
    };
  }
  if (m[2] !== m[4]) {
    return {
      start: m.index,
      problem: `bash reads /dev/fd/${m[2]} but the heredoc feeds fd ${m[4]}`,
    };
  }
  if (!/^[3-9]$/.test(m[2])) {
    return {
      start: m.index,
      problem:
        'use a single-digit fd from 3 to 9 (0-2 are stdio; zsh has no multi-digit fds)',
    };
  }
  return { start: m.index, problem: '' };
}

// Scan one line for shell quoting. `open` is the quote character a string
// left open by an earlier line ('' when none). Returns where that string
// closes on this line (`resume`, -1 when the whole line is still inside it)
// and which quote is still open at the end of the line. Comments end the
// scan; backslash escapes are honored outside single quotes.
function scanQuotes(line, open) {
  let i = 0;
  let resume = 0;
  let state = open;
  const closeFrom = (quote, from) => {
    for (let j = from; j < line.length; j++) {
      if (quote === '"' && line[j] === '\\') {
        j++;
        continue;
      }
      if (line[j] === quote) return j;
    }
    return -1;
  };
  if (state) {
    const close = closeFrom(state, 0);
    if (close === -1) return { resume: -1, open: state };
    resume = close + 1;
    i = resume;
    state = '';
  }
  while (i < line.length) {
    const ch = line[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) break;
    if (ch === "'" || ch === '"') {
      // $'…' strings allow \' escapes.
      const ansi = ch === "'" && line[i - 1] === '$';
      let close = -1;
      if (ansi) {
        for (let j = i + 1; j < line.length; j++) {
          if (line[j] === '\\') {
            j++;
            continue;
          }
          if (line[j] === "'") {
            close = j;
            break;
          }
        }
      } else {
        close = closeFrom(ch, i + 1);
      }
      if (close === -1) return { resume, open: ch };
      i = close + 1;
      continue;
    }
    i++;
  }
  return { resume, open: '' };
}

// A same-length copy of one line of shell in which quoted text is replaced by
// `_` (the quote characters stay) and a comment by spaces, so a rule can find
// operators (`<<`, `>`, `]]`, `)`) that the shell actually sees. Command
// substitutions stay code even inside double quotes, and so do `$var` /
// `${…}` expansions (`f="$(mktemp)"`, `> "$f"` read as before). A quote left
// open runs to the end of the line; escaped characters are masked too.
function maskShell(text) {
  const out = text.split('');
  const n = text.length;
  let i = 0;
  const blank = (j) => {
    if (j < n) out[j] = '_';
  };
  const singleQuoted = (ansi) => {
    i++;
    while (i < n && text[i] !== "'") {
      if (ansi && text[i] === '\\') blank(i++);
      blank(i++);
    }
    i++;
  };
  // Code up to `stop`: ')' ends a `$(…)`, '`' a backtick substitution.
  const code = (stop) => {
    let depth = 0;
    while (i < n) {
      const ch = text[i];
      if (ch === '\\') {
        blank(i + 1);
        i += 2;
      } else if (stop === '`' && ch === '`') {
        i++;
        return;
      } else if (ch === '#' && (i === 0 || /\s/.test(text[i - 1]))) {
        for (let j = i; j < n; j++) out[j] = ' ';
        i = n;
      } else if (ch === "'") {
        singleQuoted(text[i - 1] === '$');
      } else if (ch === '"') {
        doubleQuoted();
      } else if (ch === '`') {
        i++;
        code('`');
      } else if (ch === '$' && text[i + 1] === '(') {
        i += 2;
        code(')');
      } else {
        i++;
        if (stop !== ')') continue;
        if (ch === '(') depth++;
        else if (ch === ')' && depth-- === 0) return;
      }
    }
  };
  const doubleQuoted = () => {
    i++;
    while (i < n && text[i] !== '"') {
      const ch = text[i];
      const next = text[i + 1] || '';
      if (ch === '\\') {
        blank(i++);
        blank(i++);
      } else if (ch === '`') {
        i++;
        code('`');
      } else if (ch === '$' && next === '(') {
        i += 2;
        code(')');
      } else if (ch === '$' && next === '{') {
        const close = text.indexOf('}', i);
        i = close === -1 ? n : close + 1;
      } else if (ch === '$' && /[A-Za-z_]/.test(next)) {
        i++;
        while (i < n && /\w/.test(text[i])) i++;
      } else if (ch === '$' && /[0-9@#?*!$-]/.test(next)) {
        i += 2;
      } else {
        blank(i++);
      }
    }
    i++;
  };
  code('');
  return out.join('');
}

// The first heredoc operator the shell sees on the line — not one inside a
// quoted string or a comment (`printf '%s' "cat <<'EOF'"`,
// `true # cat <<'EOF'`). Matched against the line itself, so a quoted tag
// (`<<'EOF'`) still reads as one.
const HEREDOC_AT_RE = new RegExp(HEREDOC_RE.source, 'y');
function findHeredoc(text) {
  const mask = maskShell(text);
  const ops = /(?<!<)<<(?!<)/g;
  let m;
  while ((m = ops.exec(mask)) !== null) {
    HEREDOC_AT_RE.lastIndex = m.index;
    const match = HEREDOC_AT_RE.exec(text);
    if (match) return match;
  }
  return null;
}

// Blank the script argument of each `bash -c` on the line (to the end of the
// line when its quote stays open), keeping the surrounding command intact.
function blankBashDashC(text) {
  const re = new RegExp(BASH_DASH_C_RE.source, 'g');
  let result = '';
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const start = m.index + m[0].length;
    if (start < last) continue;
    const quote = text[start];
    let end = start;
    if (quote === "'" || quote === '"') {
      end = -1;
      for (let j = start + 1; j < text.length; j++) {
        if (quote === '"' && text[j] === '\\') {
          j++;
          continue;
        }
        if (text[j] === quote) {
          end = j + 1;
          break;
        }
      }
      if (end === -1) end = text.length;
      result += text.slice(last, start) + quote + quote;
    } else {
      while (end < text.length && !/\s/.test(text[end])) end++;
      result += text.slice(last, start) + "''";
    }
    last = end;
    re.lastIndex = end;
  }
  return result + text.slice(last);
}

// Returns one { kind, code } per line. `code` is the part of the line a
// rule should look at: the whole line for ordinary code, or what follows
// the closing quote when the line finishes a multi-line string (an awk or
// python program passed as one quoted argument, say).
function classifyLines(lines, { trackQuotes = true } = {}) {
  const out = new Array(lines.length);
  let heredoc = null; // { tag, stripTabs, kind }
  let open = '';
  let openedAt = -1;
  // Text of earlier physical lines that end in a `\` continuation, so a
  // wrapper split as `bash /dev/fd/3 \` + `3<<'TAG'` is still recognised.
  let continued = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const carried = continued;
    continued = '';
    if (heredoc) {
      const candidate = heredoc.stripTabs ? line.replace(/^\t+/, '') : line;
      const trimmed = candidate.trimEnd();
      // `TAG)` closes only a command-substitution heredoc; an fd wrapper
      // needs a line that is exactly the tag — trailing blanks included,
      // since the shell does not strip them.
      if (
        (heredoc.wrapper ? candidate : trimmed) === heredoc.tag ||
        (!heredoc.wrapper && trimmed === `${heredoc.tag})`)
      ) {
        out[i] = { kind: 'data', code: '', closesWrapper: heredoc.wrapper };
        heredoc = null;
      } else if (heredoc.wrapper && trimmed === heredoc.tag) {
        out[i] = {
          kind: heredoc.kind,
          code: '',
          badWrapper: `trailing blanks after the ${heredoc.tag} tag line: the shell does not read it as the terminator, so the wrapper never closes`,
        };
      } else {
        out[i] = {
          kind: heredoc.kind,
          code: heredoc.kind === 'data' ? '' : line,
        };
      }
      continue;
    }
    let code = line;
    if (trackQuotes) {
      const wasOpen = open;
      const scan = scanQuotes(line, open);
      if (wasOpen && scan.resume === -1) {
        out[i] =
          wasOpen === '"'
            ? { kind: 'expand', code: line }
            : { kind: 'data', code: '' };
        continue;
      }
      if (wasOpen) code = line.slice(scan.resume);
      if (!wasOpen && scan.open) openedAt = i;
      open = scan.open;
    }
    if (/^\s*#/.test(code)) {
      out[i] = { kind: 'comment', code: '' };
      continue;
    }
    const heredocScan = stripArithmetic(code);
    if (maskShell(heredocScan).endsWith('\\')) {
      continued = carried + heredocScan.slice(0, -1);
    }
    const match = findHeredoc(heredocScan);
    if (match) {
      const ownPrefix = heredocScan.slice(0, match.index);
      const prefix = carried + ownPrefix;
      const bashFed = BASH_WRAPPER_PREFIX_RE.test(prefix);
      // An unquoted tag means the CURRENT shell expands the body before the
      // command sees it — even when that command is a bash wrapper.
      let kind = 'expand';
      if (match[2] !== '') kind = bashFed ? 'pinned' : 'data';
      heredoc = { tag: match[3], stripTabs: match[1] === '-', kind };
      if (!bashFed) {
        out[i] = { kind: 'code', code };
        continue;
      }
      const wrapper = parseFdWrapper(prefix);
      if (wrapper.problem) {
        out[i] = { kind: 'pinned', code, badWrapper: wrapper.problem };
      } else if (match[2] === '') {
        // Not a wrapper: the body stays 'expand' and is linted as the
        // calling shell's text.
        out[i] = {
          kind: 'pinned',
          code,
          badWrapper:
            "quote the heredoc tag (3<<'TAG'): an unquoted tag expands the body in the calling shell",
        };
      } else {
        // The rest of the wrapper line (redirects, a pipe) runs in the
        // current shell: lint it with the wrapper itself replaced by `:`.
        const rest = heredocScan.slice(match.index + match[0].length);
        const before = ownPrefix.slice(
          0,
          Math.max(0, wrapper.start - carried.length)
        );
        heredoc.wrapper = true;
        out[i] = {
          kind: 'code',
          code: `${before}:${rest}`,
          opensWrapper: match[3],
        };
      }
      continue;
    }
    if (BASH_DASH_C_RE.test(code)) {
      // Only the quoted script runs in bash; the rest of the line still runs
      // in the caller's shell, so blank the script and keep linting.
      out[i] = { kind: 'code', code: blankBashDashC(code), sourceCode: code };
      continue;
    }
    out[i] = { kind: 'code', code };
  }
  // A quote that never closes means the scan misread the block (an
  // apostrophe in prose, say). Fail open to plain code rather than hide
  // everything after it.
  if (trackQuotes && open && openedAt !== -1)
    return classifyLines(lines, { trackQuotes: false });
  return out;
}

// Replace quoted strings' contents so a rule does not read program text
// handed to awk/jq/python or message text as shell. Keeps the quotes.
function blankSingleQuoted(text) {
  return text.replace(/'[^']*'/g, "''");
}

function blankQuoted(text) {
  return blankSingleQuoted(text).replace(/"(?:\\.|[^"\\])*"/g, '""');
}

// ---------------------------------------------------------------------------
// Rules. Each line rule returns an array of short detail strings.

const ZSH_SPECIAL_PARAMS = [
  'status',
  'path',
  'argv',
  'pipestatus',
  'fpath',
  'cdpath',
  'manpath',
];
const SPECIAL_ALT = ZSH_SPECIAL_PARAMS.join('|');
// Command position: line start, after an operator or `!`, or after a
// keyword that takes a command (`if status=0; then` assigns, too).
const CMD_START = String.raw`(?:^\s*|[;&|({!]\s*|\b(?:if|while|until|then|do|else|elif)\s+)`;
const SPECIAL_ASSIGN_RE = new RegExp(
  `${CMD_START}(${SPECIAL_ALT})(?:\\[[^\\]]*\\])?\\+?=`,
  'g'
);
const DECLARE_RE =
  /(?:^|[\s;&|(])(?:local|declare|typeset|readonly|export)((?:\s+[^\s;&|)]+)*)/g;
const FOR_VAR_RE = new RegExp(`\\b(?:for|select)\\s+(${SPECIAL_ALT})\\b`, 'g');
const READ_RE = /(?:^|[\s;&|(])read((?:\s+[^\s;&|<>)]+)*)/g;

// Options whose next token is the option's argument, not a variable name.
const READ_OPTS_WITH_ARG = new Set([
  'd',
  'p',
  't',
  'u',
  'n',
  'N',
  'a',
  'k',
  'i',
  'e',
]);

function readTokens(argText) {
  const tokens = argText.trim().split(/\s+/).filter(Boolean);
  const options = [];
  const names = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '--') continue;
    if (token.startsWith('-') && token.length > 1) {
      options.push(token.slice(1));
      const last = token[token.length - 1];
      if (READ_OPTS_WITH_ARG.has(last) && last !== 'a') i++;
      continue;
    }
    if (/^[A-Za-z_]\w*$/.test(token)) names.push(token);
  }
  return { options, names };
}

function ruleSpecialParams(code) {
  const hits = [];
  const text = blankQuoted(code);
  for (const re of [SPECIAL_ASSIGN_RE, FOR_VAR_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) hits.push(`${m[1]}`);
  }
  DECLARE_RE.lastIndex = 0;
  let m;
  while ((m = DECLARE_RE.exec(text)) !== null) {
    for (const token of m[1].trim().split(/\s+/)) {
      const name = token.split('=')[0].replace(/\[.*$/, '');
      if (ZSH_SPECIAL_PARAMS.includes(name)) hits.push(`declares ${name}`);
    }
  }
  READ_RE.lastIndex = 0;
  while ((m = READ_RE.exec(text)) !== null) {
    for (const name of readTokens(m[1]).names) {
      if (ZSH_SPECIAL_PARAMS.includes(name)) hits.push(`read into ${name}`);
    }
  }
  return hits;
}

// `${…}` syntax that zsh rejects (`bad substitution`) — shared by the
// statement rules and the expansion-only rules below.
const BASH_ONLY_EXPANSION_SYNTAX = [
  [/\$\{!/, '${!…} indirection/keys'],
  [/\$\{\w+(?:\[[^\]]*\])?(?:,,?|\^\^?)\}/, '${v,,}/${v^^} case modification'],
  [/\$\{\w+(?:\[[^\]]*\])?@[QEPAaUuLK]\}/, '${v@op} transformation'],
];

// Expansion-level constructs. These break wherever the shell expands text,
// including unquoted heredoc bodies and multi-line double-quoted strings.
const BASH_ONLY_EXPANSIONS = [
  ...BASH_ONLY_EXPANSION_SYNTAX,
  [
    /\$\{?#?(?:BASH_REMATCH|BASH_SOURCE|BASH_VERSINFO|PIPESTATUS|FUNCNAME|BASHPID)\b/,
    'bash-only variable',
  ],
];

function ruleBashOnlyExpansion(text) {
  return BASH_ONLY_EXPANSIONS.filter(([re]) => re.test(text)).map(
    ([, label]) => label
  );
}

const BASH_ONLY_PATTERNS = [
  ...BASH_ONLY_EXPANSION_SYNTAX,
  [/(?:^|[\s;&|(])(?:mapfile|readarray)\b/, 'mapfile/readarray'],
  [
    /(?:^|[\s;&|(])(?:local|declare|typeset)\s+(?:-[a-zA-Z]*\s+)*-[a-zA-Z]*n\b/,
    'nameref (-n)',
  ],
  [/\bBASH_REMATCH\b/, 'BASH_REMATCH'],
  [/\bBASH_SOURCE\b/, 'BASH_SOURCE'],
  [/\bBASH_VERSINFO\b/, 'BASH_VERSINFO (empty in zsh)'],
  [/\bPIPESTATUS\b/, 'PIPESTATUS'],
  [/\bFUNCNAME\b/, 'FUNCNAME'],
  [/\bBASHPID\b/, 'BASHPID'],
  [
    /\bEPOCH(?:SECONDS|REALTIME)\b/,
    'EPOCHSECONDS/EPOCHREALTIME (needs zsh/datetime)',
  ],
  [/(?:^|[\s;&|(])shopt\b/, 'shopt'],
  [/(?:^|[\s;&|(])export\s+-f\b/, 'export -f'],
  [/(?:^|[\s;&|(])type\s+-[a-zA-Z]*[tPpaf]/, 'type -t/-P'],
  [/;;&/, 'case ;;& fallthrough'],
  // zsh redirections take a single-digit fd: `exec 200>f` runs a command
  // named 200. `exec {fd}>f` (bash 4.1+, zsh) or fd 3-9 work in both.
  [/(?:^|[\s;&|(])\d{2,}(?:>>?|<)/, 'multi-digit fd redirect'],
  [/(?:^|[\s;&|(])trap\s.*\bRETURN\b/, 'trap … RETURN'],
  [/(?:^|[\s;&|(])wait\s+-n\b/, 'wait -n'],
];

function ruleBashOnly(code) {
  const hits = [];
  const unquoted = blankSingleQuoted(code);
  for (const [re, label] of BASH_ONLY_PATTERNS) {
    if (re.test(unquoted)) hits.push(label);
  }
  READ_RE.lastIndex = 0;
  let m;
  const text = blankQuoted(code);
  while ((m = READ_RE.exec(text)) !== null) {
    const bad = readTokens(m[1]).options.filter((opt) => /[apnei]/.test(opt));
    if (bad.length) hits.push(`read -${bad[0]}`);
  }
  return hits;
}

const ECHO_RE = /(?:^|[\s;&|(])echo((?:\s+[^;&|]*)?)/g;
function ruleEcho(code) {
  const hits = [];
  ECHO_RE.lastIndex = 0;
  let m;
  while ((m = ECHO_RE.exec(code)) !== null) {
    const args = m[1];
    const flags = args
      .trim()
      .split(/\s+/)
      .filter((t) => /^-[a-zA-Z]+$/.test(t));
    if (flags.some((f) => f.includes('e') && !f.includes('E')))
      hits.push('echo -e');
    else if (/\\[abcefnrtv0\\xuU]/.test(args))
      hits.push('echo with backslash escape');
  }
  return hits;
}

const BASH_ARRAYS = new Set([
  'BASH_REMATCH',
  'BASH_VERSINFO',
  'BASH_SOURCE',
  'PIPESTATUS',
  'FUNCNAME',
]);
function literalIndexHits(code) {
  const hits = [];
  // No trailing `}`: `${a[0]:-x}` and `${a[1]#p}` index the same way.
  const literal = /\$\{(\w+)\[(\d+)\]/g;
  let m;
  while ((m = literal.exec(code)) !== null) {
    if (!BASH_ARRAYS.has(m[1])) hits.push(`\${${m[1]}[${m[2]}]}`);
  }
  return hits;
}

function ruleArrayIndex(rawCode, blockCode) {
  const code = blankSingleQuoted(rawCode);
  const hits = literalIndexHits(code);
  let m;
  if (/(?:^|[\s;&|(])\w+\[0\]=/.test(code)) hits.push('assignment to [0]');
  const variable = /\$\{(\w+)\[\$?\{?([A-Za-z_]\w*)\}?\]/g;
  while ((m = variable.exec(code)) !== null) {
    const idx = m[2];
    const zeroInit = new RegExp(
      `(?:\\b${idx}=0\\b|\\(\\(\\s*${idx}\\s*=\\s*0\\b)`
    );
    if (zeroInit.test(blockCode))
      hits.push(`\${${m[1]}[$${idx}]} with ${idx} starting at 0`);
  }
  return hits;
}

const SINGLE_BRACKET_EQ_RE = /(?:^|[^[])\[\s+[^[\]]*?\s==\s[^[\]]*?\s\](?!\])/;
function ruleSingleBracketEq(code) {
  return SINGLE_BRACKET_EQ_RE.test(blankSingleQuoted(code))
    ? ['[ … == … ]']
    : [];
}

// `'it''s'` — but not the `'\''` escaped-quote idiom, whose middle quote
// pair is a backslash-escaped quote followed by a new string.
const RCQUOTES_RE = /(?<![\\'])'[^'\\\n]*''[^'\n]*'/;
function ruleRcQuotes(code) {
  return RCQUOTES_RE.test(code) ? ["'…''…'"] : [];
}

// SHC-001 needs block context: which variables name files that already
// exist when the redirect runs.
// `f=$(mktemp …)`, `f="$(mktemp …)"` (never single-quoted: that is literal text) or `f=\`mktemp …\``; group 2 or 3
// holds the options (a `-u`/`--dry-run` name does not create the file).
const MKTEMP_ASSIGN_RE =
  /\b([A-Za-z_]\w*)="?(?:\$\(\s*mktemp\b([^)]*)\)|`\s*mktemp\b([^`]*)`)/g;
const TOUCH_RE = /(?:^|[\s;&|(])touch\s+(?:-\w+\s+)*"?\$\{?([A-Za-z_]\w*)/g;
// `>`, `2>`, `&>`, `3>` — but not `>>`, `>|`, `>&`, `2>&1`, `<>` — onto a
// bare variable (`$f`, `${f}`), not a path built from one (`$f.err`).
const CLOBBER_REDIRECT_RE =
  /(?<![<>|&\d])(?:\d?|&)>(?![>|&])\s*"?\$(?:\{([A-Za-z_]\w*)(:-[^}]*)?\}|([A-Za-z_]\w*))(?=["\s;&|)<>]|$)/g;

// A literal redirect target (`> result.json`, `2>"out/log"`) for the
// second-write check. A target built from an expansion or a glob is left to
// the variable form above or skipped; /dev/* targets are exempt. The
// operator must start a word, so a `<branch>...` placeholder is not one.
const LITERAL_REDIRECT_RE =
  /(?:^|(?<=[\s;&|(){}]))(?:\d|&)?>(?![>|&])\s*(["']?)([^\s"'`$;&|()<>*?[\]{}\\]+)\1(?=[\s;&|)<>]|$)/g;

// Only code the shell runs: a comment or quoted example
// (`rm -f "$f" # f=$(mktemp)`) does not create a file.
function existingFileVars(codeLines) {
  const vars = new Set();
  for (const line of codeLines.map(maskShell)) {
    let m;
    MKTEMP_ASSIGN_RE.lastIndex = 0;
    while ((m = MKTEMP_ASSIGN_RE.exec(line)) !== null) {
      if (!/(?:^|\s)(?:-u|--dry-run)\b/.test(m[2] || m[3] || ''))
        vars.add(m[1]);
    }
    TOUCH_RE.lastIndex = 0;
    while ((m = TOUCH_RE.exec(line)) !== null) vars.add(m[1]);
  }
  return vars;
}

// `: > file` / `true > file` exists to truncate a file that may already be
// there — exactly what noclobber refuses. /dev/* targets are exempt.
const TRUNCATE_RE =
  /(?:^\s*|[;&|({]\s*|\b(?:then|do|else|if|while|until)\s+)(?::|true)\s*>(?![>|&])\s*["']?([^\s"';&|)]+)/g;

function truncationTargets(code) {
  const targets = [];
  TRUNCATE_RE.lastIndex = 0;
  let m;
  while ((m = TRUNCATE_RE.exec(code)) !== null) {
    if (!m[1].startsWith('/dev/')) targets.push(m[1]);
  }
  return targets;
}

// `$( … )` and backtick substitutions inside a span (nested parens balanced).
// They run as real commands, so their redirects still count. `mask` is the
// span's maskShell text: quoted parens and backticks do not count.
function commandSubstitutions(span, mask) {
  const found = [];
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === '`') {
      const end = mask.indexOf('`', i + 1);
      if (end === -1) break;
      found.push(span.slice(i, end + 1));
      i = end;
    } else if (mask[i] === '$' && mask[i + 1] === '(' && mask[i + 2] !== '(') {
      let depth = 0;
      let j = i + 1;
      for (; j < mask.length; j++) {
        if (mask[j] === '(') depth++;
        else if (mask[j] === ')' && --depth === 0) break;
      }
      found.push(span.slice(i, j + 1));
      i = j;
    }
  }
  return found;
}

// Replace each `re` match in the shell-visible text (quotes masked, so a
// quoted `"]]"` does not end a `[[ … ]]` span) with `placeholder`, keeping
// the span's command substitutions.
function blankSpans(code, re, placeholder) {
  const mask = maskShell(code);
  let result = '';
  let last = 0;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(mask)) !== null) {
    const end = m.index + m[0].length;
    const subs = commandSubstitutions(code.slice(m.index, end), m[0]);
    result +=
      code.slice(last, m.index) +
      (subs.length ? `${placeholder} ; ${subs.join(' ; ')} ;` : placeholder);
    last = end;
  }
  return result + code.slice(last);
}

// `(( n > $max ))` and `[[ $a > $b ]]` compare; they do not redirect. Blank
// the span but keep its command substitutions so their redirects are scanned.
function stripComparisons(code) {
  return blankSpans(
    blankSpans(code, ARITHMETIC_RE, '0'),
    /\[\[(?:[^\]]|\](?!\]))*\]\]/g,
    '[[ ]]'
  );
}

// Redirect targets the line writes with `>`: { name, literal }. `name` is
// the variable (`$f`, `${f:-/dev/null}`) or, when `literal`, the path. A `>`
// inside a quoted string is text, not a redirect.
function* clobberRedirects(rawCode) {
  const code = stripComparisons(rawCode);
  const mask = maskShell(code);
  const isRedirect = (m) => mask[code.indexOf('>', m.index)] === '>';
  CLOBBER_REDIRECT_RE.lastIndex = 0;
  let m;
  while ((m = CLOBBER_REDIRECT_RE.exec(code)) !== null) {
    // `${var:-/dev/null}` still writes to $var whenever it is set — the
    // mktemp file — so noclobber refuses it like a bare `$var`.
    if (isRedirect(m)) yield { name: m[1] || m[3], literal: false };
  }
  LITERAL_REDIRECT_RE.lastIndex = 0;
  while ((m = LITERAL_REDIRECT_RE.exec(code)) !== null) {
    if (isRedirect(m) && !m[2].startsWith('/dev/'))
      yield { name: m[2], literal: true };
  }
}

// ---------------------------------------------------------------------------
// Sourced libraries (SHC-008)

// `source x.sh` / `. x.sh` in command position only, so a message such as
// "cannot source redact.sh" is not read as a source.
const SOURCE_RE =
  /(?:^\s*|[;&|({!]\s*|\b(?:then|do|else|elif|if|while|until)\s+)(?:source|\.)\s+["']?([^"'\s;&|)]+\.sh)\b/g;

// The literal path tail after the last `${VAR}/`, `$VAR/` or `$(…)/`.
function sourceTail(target) {
  const cut = target
    .replace(/^.*(?:\}|\)|\$[A-Za-z_]\w*)\//, '')
    .replace(/^\.\//, '');
  return cut.includes('$') ? '' : cut;
}

function pluginOf(rel) {
  const parts = rel.split('/');
  return parts[0] === 'plugins' && parts.length > 2
    ? `plugins/${parts[1]}/`
    : '';
}

const CROSS_PLUGIN_RE =
  /\$(?:\{CLAUDE_PLUGIN_ROOT(?::-[^}$]*)?\}|CLAUDE_PLUGIN_ROOT)\/\.\.\/([^/]+)\/(.+)$/;

function classifySource(target, rel, ctx) {
  const tail = sourceTail(target);
  if (!tail) return null;
  const plugin = pluginOf(rel);
  if (!plugin) return null;
  // `${CLAUDE_PLUGIN_ROOT}/../<plugin>/<rest>` names a sibling plugin's file
  // exactly; resolve it under plugins/ and refuse any further `..`.
  const sibling = CROSS_PLUGIN_RE.exec(target);
  let candidates;
  if (sibling) {
    const [, name, rest] = sibling;
    if (name === '..' || rest.split('/').includes('..') || rest.includes('$')) {
      return null;
    }
    const exact = `plugins/${name}/${rest.replace(/^\.\//, '')}`;
    candidates = ctx.shellFiles.filter((file) => file === exact);
  } else {
    candidates = ctx.shellFiles.filter(
      (file) =>
        file.startsWith(plugin) &&
        (file === plugin + tail || file.endsWith(`/${tail}`))
    );
  }
  if (candidates.length === 0) return null;
  if (candidates.some((file) => ctx.tier3.has(file))) return 'tier3';
  if (candidates.some((file) => ctx.tier4.has(file))) return 'tier4';
  return { unclassified: candidates[0] };
}

// ---------------------------------------------------------------------------
// Linting

const LINE_RULES = [
  ['SHC-002', ruleSpecialParams],
  ['SHC-003', ruleBashOnly],
  ['SHC-004', ruleEcho],
  ['SHC-005', ruleArrayIndex],
  ['SHC-006', ruleSingleBracketEq],
  ['SHC-007', ruleRcQuotes],
];

// Lint shell text whose first line is `firstLine` in `rel`. Used for fenced
// block bodies and for Tier 4 library files alike.
// `fileVars` names files a mktemp/touch created anywhere in the same
// markdown file: each block is a fresh process, so a later block that
// re-declares `OUT=<the path printed earlier>` and writes `> "$OUT"` hits
// noclobber just the same.
function lintShellText(
  text,
  rel,
  firstLine,
  ctx,
  { checkSources = true, fileVars = new Set() } = {}
) {
  const findings = [];
  const lines = text.split('\n');
  const classes = classifyLines(lines);
  const codeLines = classes.filter((c) => c.kind === 'code').map((c) => c.code);
  const blockCode = codeLines.join('\n');
  const existing = new Set([...fileVars, ...existingFileVars(codeLines)]);
  const written = new Set();
  const add = (rule, i, detail) =>
    findings.push({
      rule,
      file: rel,
      line: firstLine + i,
      detail,
      text: lines[i].trim(),
    });

  for (let i = 0; i < lines.length; i++) {
    const { kind, code: line, badWrapper, sourceCode } = classes[i];
    if (kind === 'comment' || kind === 'data') continue;
    if (badWrapper) add('SHC-009', i, badWrapper);
    if (kind === 'expand') {
      for (const detail of ruleBashOnlyExpansion(line)) {
        add('SHC-003', i, detail);
      }
      for (const detail of literalIndexHits(line)) add('SHC-005', i, detail);
      continue;
    }

    if (checkSources) {
      // A `bash -c` script is scanned too, but tier 3 there is fine: only
      // sources left in the outer (blanked) text are flagged.
      const scanText = sourceCode ?? line;
      SOURCE_RE.lastIndex = 0;
      let m;
      while ((m = SOURCE_RE.exec(scanText)) !== null) {
        const cls = classifySource(m[1], rel, ctx);
        const outer = sourceCode === undefined || line.includes(m[0]);
        if (cls === 'tier3' && kind !== 'pinned' && outer) {
          add(
            'SHC-008',
            i,
            `bash-only library ${sourceTail(m[1])} sourced outside a bash wrapper`
          );
        } else if (cls && cls.unclassified) {
          add(
            'SHC-008',
            i,
            `${cls.unclassified} is not classified as tier 3 or tier 4`
          );
        }
      }
    }
    if (kind === 'pinned') continue;

    const truncated = truncationTargets(line);
    for (const target of truncated) {
      add('SHC-001', i, `\`: >\` truncates ${target}, which may already exist`);
    }
    for (const { name, literal } of clobberRedirects(line)) {
      const key = literal ? `literal:${name}` : name;
      const shown = literal ? name : `$${name}`;
      const truncates = (t) =>
        (literal ? t : t.replace(/^\$\{?|\}$/g, '')) === name;
      if (truncated.some(truncates)) {
        written.add(key);
        continue;
      }
      if (!literal && existing.has(name)) {
        add(
          'SHC-001',
          i,
          `\`>\` onto ${shown}, which already exists (mktemp/touch)`
        );
      } else if (written.has(key)) {
        add('SHC-001', i, `second \`>\` onto ${shown} in the same block`);
      }
      written.add(key);
    }
    for (const [rule, fn] of LINE_RULES) {
      for (const detail of fn(line, blockCode)) add(rule, i, detail);
    }
  }
  return findings;
}

// The supported fd wrappers in a block, as line indexes:
// { open, close, tag }. `close` is -1 when the tag is never closed.
function findFdWrappers(lines) {
  const wrappers = [];
  classifyLines(lines).forEach((c, i) => {
    if (c.opensWrapper)
      wrappers.push({ open: i, close: -1, tag: c.opensWrapper });
    else if (c.closesWrapper) wrappers[wrappers.length - 1].close = i;
  });
  return wrappers;
}

function shellBlocks(content) {
  return extractRawFencedBlocks(content).filter((block) =>
    SHELL_LANGS.has(block.lang)
  );
}

function blocksCode(blocks) {
  return blocks.flatMap((block) =>
    classifyLines(block.body.split('\n'))
      .filter((c) => c.kind === 'code')
      .map((c) => c.code)
  );
}

// UPPERCASE mktemp variables are the cross-file handoff convention (an agent
// creates OUTPUT_FILE; the skill it follows documents `> "$OUTPUT_FILE"`),
// so they count plugin-wide, as the noclobber solution doc prescribes.
// Lowercase names (out, tmp, d) are too generic to share across files.
function pluginHandoffVars(markdownByPlugin) {
  const vars = new Map();
  for (const [plugin, contents] of markdownByPlugin) {
    const names = existingFileVars(blocksCode(contents.flatMap(shellBlocks)));
    vars.set(
      plugin,
      new Set([...names].filter((name) => /^[A-Z][A-Z0-9_]*$/.test(name)))
    );
  }
  return vars;
}

function lintMarkdown(content, rel, ctx) {
  const blocks = shellBlocks(content);
  const pluginVars =
    (ctx.handoffVars && ctx.handoffVars.get(pluginOf(rel))) || new Set();
  const fileVars = new Set([
    ...pluginVars,
    ...existingFileVars(blocksCode(blocks)),
  ]);
  const findings = [];
  for (const block of blocks) {
    findings.push(
      ...lintShellText(block.body, rel, block.bodyStartLine, ctx, { fileVars })
    );
  }
  return findings;
}

function lintShellFile(content, rel) {
  const head = content.split('\n').slice(0, 5);
  if (head[0] && head[0].startsWith('#!')) return [];
  if (head.some((line) => line.trim() === LIBRARY_MARKER)) return [];
  return [
    {
      rule: 'SHC-101',
      file: rel,
      line: 1,
      detail: 'no shebang',
      text: (head[0] || '').trim(),
    },
  ];
}

// ---------------------------------------------------------------------------
// Config and allowlist

function loadConfig(root) {
  const configPath = path.join(root, 'scripts', 'shell-compat-config.json');
  if (!fs.existsSync(configPath)) {
    return { tier3Libraries: [], tier4Libraries: [], allowlist: {} };
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function configProblem(detail) {
  return {
    rule: 'SHC-900',
    file: 'scripts/shell-compat-config.json',
    line: 1,
    detail,
    text: '',
  };
}

function validateConfig(config, root, shellFiles) {
  const problems = [];
  const tier3 = config.tier3Libraries || [];
  const tier4 = config.tier4Libraries || [];
  for (const lib of [...tier3, ...tier4]) {
    if (!shellFiles.includes(lib))
      problems.push(configProblem(`listed library ${lib} does not exist`));
  }
  for (const lib of tier3) {
    if (tier4.includes(lib))
      problems.push(configProblem(`${lib} is listed in both tiers`));
    const full = path.join(root, lib);
    if (fs.existsSync(full)) {
      const first = fs.readFileSync(full, 'utf8').split('\n')[0];
      if (!/^#!.*\bbash\b/.test(first) && first.trim() !== '#!/bin/false') {
        problems.push(
          configProblem(
            `tier 3 library ${lib} must have a bash shebang (or #!/bin/false if source-only)`
          )
        );
      }
    }
  }
  for (const [file, rules] of Object.entries(config.allowlist || {})) {
    for (const [rule, entry] of Object.entries(rules)) {
      if (!RULES[rule] || rule === 'SHC-900') {
        problems.push(configProblem(`allowlist ${file}: unknown rule ${rule}`));
      }
      if (!entry || typeof entry.max !== 'number' || entry.max < 1) {
        problems.push(
          configProblem(
            `allowlist ${file} ${rule}: max must be a positive number`
          )
        );
      }
      if (
        !entry ||
        typeof entry.reason !== 'string' ||
        entry.reason.trim() === ''
      ) {
        problems.push(
          configProblem(`allowlist ${file} ${rule}: reason is required`)
        );
      }
    }
  }
  return problems;
}

// Split findings into violations and allowlisted, and flag stale caps.
function applyAllowlist(findings, allowlist) {
  const counts = new Map();
  for (const f of findings) {
    const key = `${f.file}\u0000${f.rule}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const violations = [];
  const allowed = [];
  for (const f of findings) {
    const entry = allowlist[f.file] && allowlist[f.file][f.rule];
    const count = counts.get(`${f.file}\u0000${f.rule}`);
    if (entry && typeof entry.max === 'number' && count <= entry.max)
      allowed.push(f);
    else violations.push(f);
  }
  const stale = [];
  for (const [file, rules] of Object.entries(allowlist)) {
    for (const [rule, entry] of Object.entries(rules)) {
      if (!entry || typeof entry.max !== 'number') continue;
      const count = counts.get(`${file}\u0000${rule}`) || 0;
      if (count < entry.max) {
        stale.push(
          configProblem(
            `stale allowlist entry ${file} ${rule}: max ${entry.max} but ${count} finding(s) — lower or remove it`
          )
        );
      }
    }
  }
  return { violations, allowed, stale };
}

// ---------------------------------------------------------------------------
// Entry point

function run(root) {
  const config = loadConfig(root);
  const shellFiles = listShellFiles(root);
  const ctx = {
    shellFiles,
    tier3: new Set(config.tier3Libraries || []),
    tier4: new Set(config.tier4Libraries || []),
  };
  const findings = [];
  const markdownFiles = listMarkdownFiles(root);
  const contents = new Map(
    markdownFiles.map((rel) => [
      rel,
      fs.readFileSync(path.join(root, rel), 'utf8'),
    ])
  );
  const byPlugin = new Map();
  for (const [rel, content] of contents) {
    const plugin = pluginOf(rel);
    if (!byPlugin.has(plugin)) byPlugin.set(plugin, []);
    byPlugin.get(plugin).push(content);
  }
  ctx.handoffVars = pluginHandoffVars(byPlugin);
  for (const [rel, content] of contents) {
    findings.push(...lintMarkdown(content, rel, ctx));
  }
  for (const rel of shellFiles) {
    if (isExcludedPluginPath(rel)) continue;
    const content = fs.readFileSync(path.join(root, rel), 'utf8');
    findings.push(...lintShellFile(content, rel));
    if (ctx.tier4.has(rel)) {
      findings.push(
        ...lintShellText(content, rel, 1, ctx, { checkSources: false })
      );
    }
  }
  const { violations, allowed, stale } = applyAllowlist(
    findings,
    config.allowlist || {}
  );
  const configErrors = [...validateConfig(config, root, shellFiles), ...stale];
  return {
    scanned: { markdown: markdownFiles.length, shell: shellFiles.length },
    violations,
    allowed,
    configErrors,
  };
}

function formatFinding(f) {
  const rule = RULES[f.rule];
  const where = f.rule === 'SHC-900' ? f.file : `${f.file}:${f.line}`;
  const lines = [`  ${where} [${f.rule}] ${rule.summary}: ${f.detail}`];
  if (f.text) lines.push(`      > ${f.text.slice(0, 160)}`);
  return lines.join('\n');
}

function main(argv) {
  const json = argv.includes('--json');
  const root = process.env.VALIDATE_SHELL_COMPAT_ROOT
    ? path.resolve(process.env.VALIDATE_SHELL_COMPAT_ROOT)
    : path.join(__dirname, '..');
  const tag = '[validate-shell-compat]';
  let result;
  try {
    result = run(root);
  } catch (err) {
    console.error(`${tag} ERROR: ${err.message}`);
    return 1;
  }
  const problems = [...result.violations, ...result.configErrors];

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return problems.length === 0 ? 0 : 1;
  }

  const summary = `${result.scanned.markdown} markdown and ${result.scanned.shell} shell file(s) scanned, ${result.allowed.length} allowlisted finding(s)`;
  if (problems.length === 0) {
    console.log(`${tag} OK: ${summary}.`);
    return 0;
  }
  const out = console.error;
  out(`${tag} FAILED: ${problems.length} finding(s); ${summary}.\n`);
  const byRule = new Map();
  for (const f of problems) {
    if (!byRule.has(f.rule)) byRule.set(f.rule, []);
    byRule.get(f.rule).push(f);
  }
  for (const [rule, list] of [...byRule.entries()].sort()) {
    out(
      `${rule} — ${RULES[rule].summary} (${list.length}). Fix: ${RULES[rule].hint}`
    );
    for (const f of list) out(formatFinding(f));
    out('');
  }
  out(
    `${tag} Style-level or false-positive hits may be capped in scripts/shell-compat-config.json "allowlist" with a reason (keyed by file and rule).`
  );
  return 1;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = {
  listMarkdownFiles,
  findFdWrappers,
  SHELL_LANGS,
  RULES,
  classifyLines,
  lintShellText,
  lintMarkdown,
  lintShellFile,
  applyAllowlist,
  sourceTail,
  isExcludedPluginPath,
  run,
};
