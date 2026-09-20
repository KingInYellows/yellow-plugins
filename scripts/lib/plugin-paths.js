'use strict';

/**
 * Path-resolution and hook-script helpers for the plugin manifest validator.
 *
 * Extracted from validate-plugin.js (PR-A, findings 007 + 034). These
 * helpers enforce the plugin-directory containment boundary and the
 * filesystem-existence rules; `validatePlugin()` orchestrates them.
 */

const fs = require('fs');
const path = require('path');

const { addError, logSuccess, logWarning } = require('./logging');

// Canonical Claude Code hook events. Module-scope so VALID_HOOK_EVENTS.has()
// is O(1) and the membership test is shared across rules.
const VALID_HOOK_EVENTS = new Set([
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'UserPromptSubmit',
  'Notification',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'SessionStart',
  'SessionEnd',
  'TeammateIdle',
  'TaskCompleted',
  'PreCompact',
]);

// Hook events whose scripts must emit a decision payload (JSON or exit-code
// protocol). SessionStart is included because Claude Code blocks session
// startup if a SessionStart hook exits without {"continue": true}; absence
// of decision output is a soft warning here so authors notice before the
// session-block manifests in production.
const DECISION_PROTOCOL_EVENTS = new Set([
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SessionStart',
]);

// Interpreters whose hook commands name a plugin-local script as their first
// non-option argument. `bash` scripts get the shebang / decision-output /
// `set -e` content checks; `node` entrypoints get existence + containment
// only. Any other command form (`sh`, `python3`, `env node`, a bare
// "${CLAUDE_PLUGIN_ROOT}/x.sh") is an error: RULE 6 only ever runs over this
// repository's own catalog-generated manifests, all of which use one of
// these two.
const HOOK_SCRIPT_INTERPRETER_RE = /^[ \t]*(bash|node)[ \t]+/;

const PLUGIN_ROOT_PLACEHOLDER = '${CLAUDE_PLUGIN_ROOT}';
// What may follow the placeholder in a plugin-local path.
const PLUGIN_PATH_TAIL_RE = /^[A-Za-z0-9._/-]+$/;

// Per-interpreter option tables. Every option a hook command carries must
// appear in exactly one of them — anything else is rejected, so an
// unknown option can never swallow the entrypoint word (`node --foo
// "${…}/main.js"` validating `--foo`'s "operand") or slip a mode the
// validator does not model. No first-party hook passes any option, so the
// allowlist costs nothing.
//   flag         — no value; the script still runs. (bash `-l`/`--login`
//                  is deliberately absent: a login shell sources profile
//                  files — unchecked code — before the checked script.)
//   takesValue   — the value is the NEXT word (`--opt=value` is one word).
//                  Every node entry was verified to accept `node <opt>
//                  <value> entry.js` on Node 22.22.0 (CI) and 24.15.0 on
//                  2026-09-17; add new ones the same way. `--watch-path`
//                  is absent on purpose: it implies watch mode and the
//                  hook never exits.
//   fileOperand  — subset of takesValue whose operand is a FILE node loads
//                  into the hook process before the entrypoint (a missing
//                  `-r`/`--import`/`--env-file` aborts startup; a missing
//                  `--openssl-config` is silently ignored, a malformed one
//                  aborts — checked the same way): placeholder-rooted,
//                  contained, and — like the script — an existing regular
//                  non-symlink file. Their CONTENTS are trusted exactly
//                  like the script's (an env file can set NODE_OPTIONS).
//   pathOperand  — subset of takesValue naming a path node tolerates
//                  missing (a report directory, an optional env file):
//                  placeholder-rooted and contained only.
//   valueShape   — takesValue/attachedOnly operands the interpreter rejects
//                  unless they match (a Set of names, or a RegExp for a
//                  numeric shape: `bash -o garbage`, `node
//                  --stack-trace-limit=abc` abort before the script).
//   noExecValues — per option, the operands that turn execution off
//                  (`bash -o noexec`).
//   attachedOnly — V8 flags that ONLY accept `--opt=value`; node rejects the
//                  bare word ("illegal value for flag … of type int") before
//                  the entrypoint runs.
//   inline       — the value is code, not a script path (`bash -c`,
//                  `node -e`, node's own `-pe` bundle).
//   noExec       — syntax-check / help / version: the script never runs.
// bash also accepts bundled short flags (`-xe`, `-xo pipefail`), looked up
// letter by letter with a value-taking letter allowed only last; node has
// no bundles besides `-pe`.
const BASH_SET_O_NAMES = new Set([
  'allexport',
  'braceexpand',
  'emacs',
  'errexit',
  'errtrace',
  'functrace',
  'hashall',
  'histexpand',
  'history',
  'ignoreeof',
  'interactive-comments',
  'keyword',
  'monitor',
  'noclobber',
  'noexec',
  'noglob',
  'nolog',
  'notify',
  'nounset',
  'onecmd',
  'physical',
  'pipefail',
  'posix',
  'privileged',
  'verbose',
  'vi',
  'xtrace',
]);
const BASH_SHOPT_NAMES = new Set([
  'autocd',
  'assoc_expand_once',
  'cdable_vars',
  'cdspell',
  'checkhash',
  'checkjobs',
  'checkwinsize',
  'cmdhist',
  'compat31',
  'compat32',
  'compat40',
  'compat41',
  'compat42',
  'compat43',
  'compat44',
  'complete_fullquote',
  'direxpand',
  'dirspell',
  'dotglob',
  'execfail',
  'expand_aliases',
  'extdebug',
  'extglob',
  'extquote',
  'failglob',
  'force_fignore',
  'globasciiranges',
  'globskipdots',
  'globstar',
  'gnu_errfmt',
  'histappend',
  'histreedit',
  'histverify',
  'hostcomplete',
  'huponexit',
  'inherit_errexit',
  'interactive_comments',
  'lastpipe',
  'lithist',
  'localvar_inherit',
  'localvar_unset',
  'login_shell',
  'mailwarn',
  'no_empty_cmd_completion',
  'nocaseglob',
  'nocasematch',
  'noexpand_translation',
  'nullglob',
  'patsub_replacement',
  'progcomp',
  'progcomp_alias',
  'promptvars',
  'restricted_shell',
  'shift_verbose',
  'sourcepath',
  'varredir_close',
  'xpg_echo',
]);
const HOOK_OPTIONS = {
  node: {
    flag: new Set([
      '--no-warnings',
      '--no-deprecation',
      '--trace-warnings',
      '--trace-deprecation',
      '--throw-deprecation',
      '--pending-deprecation',
      '--trace-uncaught',
      '--enable-source-maps',
      '--preserve-symlinks',
      '--preserve-symlinks-main',
      '--expose-gc',
      '--frozen-intrinsics',
      '--use-strict',
      '--experimental-vm-modules',
      '--experimental-strip-types',
      '--experimental-transform-types',
    ]),
    takesValue: new Set([
      '-r',
      '--require',
      '--import',
      '--loader',
      '--experimental-loader',
      '--input-type',
      '-C',
      '--conditions',
      '--env-file',
      '--env-file-if-exists',
      '--title',
      '--openssl-config',
      '--icu-data-dir',
      '--report-dir',
      '--report-directory',
      '--test-name-pattern',
      '--disable-warning',
      '--localstorage-file',
      '--diagnostic-dir',
      '--unhandled-rejections',
      '--redirect-warnings',
      '--trace-event-categories',
    ]),
    fileOperand: new Set([
      '-r',
      '--require',
      '--import',
      '--loader',
      '--experimental-loader',
      '--env-file',
      '--openssl-config',
    ]),
    pathOperand: new Set([
      '--env-file-if-exists',
      '--icu-data-dir',
      '--localstorage-file',
      '--redirect-warnings',
      '--report-dir',
      '--report-directory',
      '--diagnostic-dir',
    ]),
    valueShape: {
      '--input-type': new Set([
        'module',
        'commonjs',
        'module-typescript',
        'commonjs-typescript',
      ]),
      '--unhandled-rejections': new Set([
        'strict',
        'warn',
        'none',
        'throw',
        'warn-with-error-code',
      ]),
      '--stack-trace-limit': /^\d+$/,
      '--max-old-space-size': /^\d+$/,
      '--max-semi-space-size': /^\d+$/,
    },
    noExecValues: {},
    attachedOnly: new Set([
      '--stack-trace-limit',
      '--max-old-space-size',
      '--max-semi-space-size',
    ]),
    inline: new Set(['-e', '--eval', '-p', '--print', '-pe']),
    noExec: new Set([
      '-c',
      '--check',
      '-h',
      '--help',
      '-v',
      '--version',
      '--v8-options',
    ]),
  },
  bash: {
    flag: new Set([
      '-e',
      '-u',
      '-x',
      '-v',
      '-E',
      '-T',
      '--noprofile',
      '--norc',
      '--posix',
    ]),
    takesValue: new Set(['-o', '+o', '-O', '+O', '--rcfile', '--init-file']),
    fileOperand: new Set(),
    // Ignored by a non-interactive bash, but still a path.
    pathOperand: new Set(['--rcfile', '--init-file']),
    valueShape: {
      '-o': BASH_SET_O_NAMES,
      '+o': BASH_SET_O_NAMES,
      '-O': BASH_SHOPT_NAMES,
      '+O': BASH_SHOPT_NAMES,
    },
    // `-o noexec` is `-n` and `-o onecmd` is `-t` through another door:
    // the script is read but never run (rc 0, no output — a silent
    // fail-open for a PreToolUse hook). `+o` turns them off and is fine.
    noExecValues: { '-o': new Set(['noexec', 'onecmd']) },
    attachedOnly: new Set(),
    inline: new Set(['-c']),
    noExec: new Set([
      '-n',
      '--help',
      '--version',
      '-D',
      '--dump-strings',
      '--dump-po-strings',
    ]),
  },
};

for (const table of Object.values(HOOK_OPTIONS)) {
  // Every path operand is contained; file operands are additionally
  // checked on disk.
  table.contained = new Set([...table.fileOperand, ...table.pathOperand]);
}

// Characters the shell-word splitter does not model: a newline (a second
// command after the script would run unchecked — `sh -c` reads it as a
// separator wherever it falls, including between words), other control
// characters, and the Unicode whitespace JS `\s` matches but the shell does
// not split on (`\r`, `\v`, `\f`, NBSP, U+2028, BOM…): the validator would
// end the word where the shell keeps going.
const HOOK_COMMAND_UNMODELLED_CHAR_RE =
  // eslint-disable-next-line no-control-regex -- the control range is the point
  /[\u0000-\u0008\u000a-\u001f\u007f\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/;

/**
 * One shell word of `s`: adjacent quoted and unquoted segments up to the
 * first unquoted whitespace, with the quotes removed — so `"a b"/c`,
 * `"a b/c"` and `a\ b` all yield one word (backslash escapes are not
 * interpreted: RULE 6 rejects any backslash in a hook command instead).
 * Also returns what is left of `s` after the consumed word (raw, quotes
 * and all) so a caller can keep parsing forward; `quotes`: one entry per
 * character of `word` recording the quote that enclosed it (`'`, `"`, or
 * null for unquoted) — the per-word quote state the placeholder-quoting
 * check reads instead of re-parsing the command; and `control`: true when
 * an unquoted control operator or redirection was seen (RULE 6 checks one
 * simple command; newlines are rejected before lexing). Only space and
 * tab end a word — the shell's blanks. An empty pair (`""`) contributes no
 * characters, so `""${X}` leaves the placeholder unquoted, exactly as the
 * shell sees it. Returns { word: null } if a quote opened here is never
 * closed.
 */
function consumeShellWord(s) {
  let word = '';
  const quotes = [];
  let control = false;
  let quote = null;
  let i = 0;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        word += ch;
        quotes.push(quote);
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ' ' || ch === '\t') break;
    if (';|&<>()'.includes(ch)) control = true;
    word += ch;
    quotes.push(null);
  }
  if (quote !== null) return { word: null, rest: '', quotes: [], control };
  return { word, rest: s.slice(i), quotes, control };
}

/**
 * Lex every word after the interpreter of a `bash …` / `node …` hook
 * command, keeping each word's quote state. No option semantics: the
 * quoting rule applies to every word — an option operand (`node --require
 * ${X}/pre.js "${X}/main.js"`) word-splits on a spaced plugin path just
 * like the script argument does. Returns null when the command has no
 * recognised interpreter; otherwise { interpreter, words, quoteError,
 * control }, where `words` holds the words lexed before any unterminated
 * quote.
 */
function lexHookCommandWords(command) {
  const prefix = command.match(HOOK_SCRIPT_INTERPRETER_RE);
  if (!prefix) return null;
  const interpreter = prefix[1];
  const words = [];
  let control = false;
  let remaining = command.slice(prefix[0].length);
  for (;;) {
    remaining = remaining.replace(/^[ \t]+/, '');
    if (!remaining) return { interpreter, words, quoteError: false, control };
    const lexed = consumeShellWord(remaining);
    control = control || lexed.control;
    if (lexed.word === null)
      return { interpreter, words, quoteError: true, control };
    words.push({ word: lexed.word, quotes: lexed.quotes });
    remaining = lexed.rest;
  }
}

// Severity order for placeholder quote states: the worst one wins when a
// word (or a command) carries several.
const QUOTE_STATE_RANK = { double: 0, unquoted: 1, single: 2, split: 3 };
function worseQuoteState(a, b) {
  if (a === null) return b;
  if (b === null) return a;
  return QUOTE_STATE_RANK[b] > QUOTE_STATE_RANK[a] ? b : a;
}

/**
 * How `${CLAUDE_PLUGIN_ROOT}` is quoted inside one lexed word: 'double'
 * (correct), 'single' (never expanded), 'unquoted' (word-splits), 'split'
 * (a quote boundary falls INSIDE the placeholder — `"$"{CLAUDE_PLUGIN_ROOT}`
 * is a literal `$` followed by a brace expression, never expanded), or
 * null when the word does not contain the placeholder. Every character of
 * every occurrence is judged, and the worst state wins (split > single >
 * unquoted > double): a word that quotes one occurrence and not another
 * still word-splits.
 */
function placeholderQuoteState({ word, quotes }) {
  let worst = null;
  for (
    let at = word.indexOf(PLUGIN_ROOT_PLACEHOLDER);
    at !== -1;
    at = word.indexOf(PLUGIN_ROOT_PLACEHOLDER, at + 1)
  ) {
    const states = new Set(
      quotes.slice(at, at + PLUGIN_ROOT_PLACEHOLDER.length)
    );
    let state;
    if (states.size !== 1) state = 'split';
    else if (states.has('"')) state = 'double';
    else if (states.has("'")) state = 'single';
    else state = 'unquoted';
    worst = worseQuoteState(worst, state);
  }
  return worst;
}

/**
 * Shell syntax RULE 6 does not model, read from the lexed words: a
 * backslash anywhere (the lexer does not interpret escapes); a newline,
 * control character or non-shell whitespace anywhere (see
 * HOOK_COMMAND_UNMODELLED_CHAR_RE); an unquoted control operator or
 * redirection (everything after the script word would run unchecked);
 * and, outside single quotes, a substitution
 * or a `$`/`~` expansion other than the exact placeholder (`$HOME/x`,
 * `${CLAUDE_PLUGIN_ROOT:-x}`, an unbraced `$CLAUDE_PLUGIN_ROOT` that
 * word-splits) — a double-quoted `$(…)` still runs; and an unquoted glob
 * or brace character (`"${X}/hooks/"a?.sh` runs whatever matches).
 * Returns the offending construct's description, or null.
 */
function unmodelledShellExpansion(stripped, word, quotes) {
  if (stripped.includes('`') || stripped.includes('$('))
    return 'a command substitution — RULE 6 checks one simple command';
  if (stripped.includes('$') || (word.startsWith('~') && quotes[0] !== "'"))
    return (
      'an expansion other than ' +
      PLUGIN_ROOT_PLACEHOLDER +
      ' — the validator cannot resolve it'
    );
  return null;
}

function unmodelledShellWord({ word, quotes }) {
  let expandable = '';
  for (let i = 0; i < word.length; i += 1)
    if (quotes[i] !== "'") expandable += word[i];
  const expansionProblem = unmodelledShellExpansion(
    expandable.replaceAll(PLUGIN_ROOT_PLACEHOLDER, ''),
    word,
    quotes
  );
  if (expansionProblem !== null) return expansionProblem;
  for (let i = 0; i < word.length; i += 1) {
    if (quotes[i] === null && /[*?{}]/.test(word[i]))
      return 'an unquoted glob or brace character — the shell may expand it to a different file';
  }
  return null;
}

function unmodelledShellSyntax(command, { words, control }) {
  if (command.includes('\\'))
    return 'a backslash — RULE 6 cannot lex shell escapes';
  if (HOOK_COMMAND_UNMODELLED_CHAR_RE.test(command))
    return 'a newline, control character or non-shell whitespace — RULE 6 checks one simple command of space-separated words';
  if (control)
    return 'a control operator or redirection — RULE 6 checks one simple command';
  for (const lexedWord of words) {
    const wordProblem = unmodelledShellWord(lexedWord);
    if (wordProblem !== null) return wordProblem;
  }
  return null;
}

/**
 * The option words `w` stands for: bash bundles short flags (`-xe` is
 * `-x -e`; `-xo pipefail` ends in the value-taking `-o`), node does not
 * (its `-pe` is its own table entry). `--opt=value` is split at the first
 * `=`; the name decides the table and the attached value is the operand.
 */
function expandHookOption(interpreter, w) {
  // bash has no `--opt=value` form (`--rcfile=x` is "invalid option").
  const eq = interpreter === 'node' && w.startsWith('--') ? w.indexOf('=') : -1;
  const name = eq === -1 ? w : w.slice(0, eq);
  const attachedValue = eq === -1 ? null : w.slice(eq + 1);
  if (interpreter === 'bash' && /^[-+][A-Za-z]{2,}$/.test(name)) {
    const letters = [...name.slice(1)];
    return letters.map((letter, k) => ({
      name: name[0] + letter,
      attachedValue: null,
      last: k === letters.length - 1,
    }));
  }
  return [{ name, attachedValue, last: true }];
}

/**
 * Why a file-loading option's operand (`node --require <file>`) cannot be
 * loaded — it must exist as a regular, non-symlink file, the same policy
 * validateHookScriptPath applies to the script word — or null.
 */
function fileOperandRealpathProblem(resolved, pluginDir) {
  try {
    const real = fs.realpathSync(resolved);
    const rootReal = fs.realpathSync(pluginDir);
    if (real !== rootReal && !real.startsWith(rootReal + path.sep))
      return 'resolves outside the plugin directory through a symlink';
  } catch (err) {
    return `cannot be inspected (${err.message})`;
  }
  return null;
}

function fileOperandProblem(resolved, pluginDir) {
  let lstat;
  try {
    lstat = fs.lstatSync(resolved);
  } catch (err) {
    return err.code === 'ENOENT' || err.code === 'ENOTDIR'
      ? 'does not exist'
      : `cannot be inspected (${err.message})`;
  }
  if (lstat.isSymbolicLink()) return 'is a symlink, which is not permitted';
  if (!lstat.isFile()) return 'is not a regular file';
  // Lexical containment is not enough when a directory between the
  // plugin root and the file is a symlink (`hooks -> /outside`): compare
  // real paths, both sides resolved so a symlinked plugin parent passes.
  return fileOperandRealpathProblem(resolved, pluginDir);
}

/** Map a `${CLAUDE_PLUGIN_ROOT}` word to an absolute path under `root`. */
function resolvePlaceholderPath(word, root) {
  return path.resolve(root, word.replaceAll(PLUGIN_ROOT_PLACEHOLDER, root));
}

/**
 * True when `word` is a placeholder-rooted plugin path with only plain tail
 * characters and resolves inside `root`.
 */
function hookPathWithinPlugin(word, root) {
  if (!word.startsWith(PLUGIN_ROOT_PLACEHOLDER + '/')) return false;
  // Only plain path characters after the placeholder: node resolves
  // `--import` as an ESM URL, where `%2e%2e` is a dot-segment, `#` a
  // fragment and `?` a query, so a word the validator lstat's is not the
  // file node loads. Every first-party path is already in this set.
  if (!PLUGIN_PATH_TAIL_RE.test(word.slice(PLUGIN_ROOT_PLACEHOLDER.length)))
    return false;
  if (word.split('/').includes('..')) return false;
  // path.resolve folds a trailing `/` or `/.` that bash does not
  // (`hooks/a.sh/` is "Not a directory", rc 126).
  if (/\/\.?$/.test(word)) return false;
  return resolvePlaceholderPath(word, root).startsWith(root + path.sep);
}

function hookOperandEmpty(interpreter, operand) {
  return (
    operand === '' ||
    operand.startsWith('-') ||
    (interpreter === 'bash' && operand.startsWith('+'))
  );
}

function hookOperandShapeProblem(options, name, operand) {
  const shape = options.valueShape[name];
  if (!shape) return null;
  if (shape instanceof Set ? shape.has(operand) : shape.test(operand)) return null;
  return { code: 'bad-operand', detail: `${name} ${operand}` };
}

function hookOperandPathProblem(options, root, withinPlugin, name, operand) {
  if (options.contained.has(name) && !withinPlugin(operand))
    return { code: 'escapes', detail: operand };
  if (!options.fileOperand.has(name)) return null;
  const fileProblem = fileOperandProblem(
    resolvePlaceholderPath(operand, root),
    root
  );
  if (fileProblem === null) return null;
  return {
    code: 'operand-file',
    detail: `${name} operand ${operand} ${fileProblem}`,
  };
}

/**
 * Validate one expanded hook-option name and its operand. Returns a
 * `{ code, detail }` problem descriptor, or null when the option is fine.
 */
function hookOptionKindProblem(options, w, name, attachedValue, last) {
  if (options.inline.has(name)) return { code: 'inline', detail: name };
  if (options.noExec.has(name)) return { code: 'no-exec', detail: name };
  if (options.attachedOnly.has(name) && attachedValue === null)
    return { code: 'attached-only', detail: name };
  if (!options.takesValue.has(name) && !options.attachedOnly.has(name))
    return { code: 'unrecognised-option', detail: w };
  if (!last)
    return { code: 'unrecognised-option', detail: w }; // `-oxe`: only the last letter of a bundle may take a value
  return null;
}

function hookOptionOperandProblem(ctx) {
  const { interpreter, options, root, withinPlugin, w, name, attachedValue, last, operand } =
    ctx;
  const kindProblem = hookOptionKindProblem(
    options,
    w,
    name,
    attachedValue,
    last
  );
  if (kindProblem !== null) return kindProblem;
  if (hookOperandEmpty(interpreter, operand))
    return { code: 'empty-operand', detail: name };
  const shapeProblem = hookOperandShapeProblem(options, name, operand);
  if (shapeProblem !== null) return shapeProblem;
  if (options.noExecValues[name] && options.noExecValues[name].has(operand))
    return { code: 'no-exec', detail: `${name} ${operand}` };
  return hookOperandPathProblem(options, root, withinPlugin, name, operand);
}

/**
 * Walk interpreter options in `words` and return the index of the script word,
 * or a RULE 6 problem descriptor when an option is invalid.
 */
function bashHookOptionOrderProblem(interpreter, w, seenShort) {
  if (interpreter !== 'bash' || !w.startsWith('--') || !seenShort) return null;
  return {
    problem: 'unrecognised-option',
    detail: `${w} after a single-character option — bash reads long options first`,
  };
}

function hookOptionWordsProblem(interpreter, options, root, withinPlugin, w, words, startIndex) {
  let i = startIndex;
  for (const { name, attachedValue, last } of expandHookOption(
    interpreter,
    w
  )) {
    if (options.flag.has(name)) {
      if (attachedValue !== null)
        return { problem: 'unrecognised-option', detail: w };
      continue;
    }
    let operand = attachedValue;
    if (operand === null) {
      i += 1; // consume the separated operand
      if (i >= words.length) return { problem: 'empty-operand', detail: name };
      operand = words[i].word;
    }
    const optionProblem = hookOptionOperandProblem({
      interpreter,
      options,
      root,
      withinPlugin,
      w,
      name,
      attachedValue,
      last,
      operand,
    });
    if (optionProblem !== null)
      return {
        problem: optionProblem.code,
        detail: optionProblem.detail,
        index: i,
      };
  }
  return { index: i };
}

function hookOptionTerminator(w, interpreter) {
  return w === '--' || (interpreter === 'bash' && w === '-');
}

function hookScriptWordAt(words, index, withinPlugin) {
  if (index >= words.length || words[index].word === '')
    return { problem: 'no-script', detail: undefined };
  const script = words[index].word;
  if (!withinPlugin(script))
    return { problem: 'escapes', detail: script };
  return { index };
}

function hookScriptOptionStep(interpreter, words, options, root, withinPlugin, i, seenShort) {
  const w = words[i].word;
  if (hookOptionTerminator(w, interpreter))
    return { stop: true, index: i + 1 };
  if (!(w.startsWith('-') || (interpreter === 'bash' && w.startsWith('+'))))
    return { stop: true, index: i };
  const orderProblem = bashHookOptionOrderProblem(interpreter, w, seenShort);
  if (orderProblem !== null) return orderProblem;
  const optionScan = hookOptionWordsProblem(
    interpreter,
    options,
    root,
    withinPlugin,
    w,
    words,
    i
  );
  if (optionScan.problem)
    return {
      problem: optionScan.problem,
      detail: optionScan.detail,
    };
  return {
    stop: false,
    index: optionScan.index,
    seenShort:
      interpreter === 'bash' && !w.startsWith('--') ? true : seenShort,
  };
}

function hookScriptWordIndex(interpreter, words, options, root) {
  const withinPlugin = (w) => hookPathWithinPlugin(w, root);
  let i = 0;
  let seenShort = false; // bash: a `--long` option after any short one is "invalid option"
  for (; i < words.length; i += 1) {
    const step = hookScriptOptionStep(
      interpreter,
      words,
      options,
      root,
      withinPlugin,
      i,
      seenShort
    );
    if (step.problem) return step;
    if (step.stop) {
      i = step.index;
      break;
    }
    seenShort = step.seenShort;
    i = step.index;
  }
  return hookScriptWordAt(words, i, withinPlugin);
}

/**
 * Resolve a hook command to the plugin-local script it runs. One pass
 * over the words lexHookCommandWords produced, in this order: unterminated
 * quote (`sh -c` rejects the whole command); placeholder quoting (a
 * mis-quoted placeholder would resolve to a path the shell never uses);
 * shell syntax the lexer does not model; the interpreter's options,
 * looked up in HOOK_OPTIONS (an option in no table is itself the error);
 * then the script word, which — like every file-loading option operand —
 * must start with `${CLAUDE_PLUGIN_ROOT}/` (hooks run with the project's
 * cwd, so a relative path names a file in whatever repository is open),
 * contain no `..` (path.resolve folds it before any symlink check can see
 * that the kernel resolves a symlinked `docs/` first) and stay inside the
 * plugin directory.
 *
 * Returns { interpreter, path } on success, or { interpreter, problem,
 * detail } where `problem` is one of the HOOK_COMMAND_PROBLEMS keys
 * (`interpreter` is null for 'not-interpreter'). The caller turns the
 * problem into its RULE 6 message.
 */
function resolveHookScriptPath(command, pluginDir) {
  const lexed = lexHookCommandWords(command);
  if (!lexed) return { interpreter: null, problem: 'not-interpreter' };
  const { interpreter, words } = lexed;
  const problem = (code, detail) => ({ interpreter, problem: code, detail });
  if (lexed.quoteError) return problem('unterminated-quote');
  let quoting = null;
  for (const lexedWord of words)
    quoting = worseQuoteState(quoting, placeholderQuoteState(lexedWord));
  if (quoting !== null && quoting !== 'double')
    return problem(`placeholder-${quoting}`);
  const unmodelled = unmodelledShellSyntax(command, lexed);
  if (unmodelled !== null) return problem('unmodelled', unmodelled);

  const root = path.resolve(pluginDir);
  const scriptIndex = hookScriptWordIndex(
    interpreter,
    words,
    HOOK_OPTIONS[interpreter],
    root
  );
  if (scriptIndex.problem)
    return problem(scriptIndex.problem, scriptIndex.detail);
  const script = words[scriptIndex.index].word;
  return {
    interpreter,
    path: resolvePlaceholderPath(script, root),
  };
}

/**
 * Resolve `inputPath` against `pluginDir` and return it only if it stays
 * within the plugin directory boundary; null otherwise.
 */
function resolvePluginPath(inputPath, pluginDir) {
  const normalized = path.resolve(pluginDir, inputPath);
  const pluginRoot = path.resolve(pluginDir);
  if (
    normalized === pluginRoot ||
    normalized.startsWith(pluginRoot + path.sep)
  ) {
    return normalized;
  }
  return null;
}

/**
 * Count .md files under `dir` recursively (skipping symlinks). Used by
 * validatePathOrPathsDir to accept the standard nested layouts:
 *   skills/<name>/SKILL.md
 *   commands/<category>/<name>.md
 *   agents/<category>/<name>.md
 * Symlinked entries are skipped to match the symlink-rejection policy in
 * resolvePluginPath / validatePathFile (PR #343).
 */
function countMarkdownRecursive(dir) {
  let count = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        count++;
      }
    }
  }
  return count;
}

/**
 * Validate a path field that must point to an existing file (not a directory).
 * Used for fields like lspServers and monitors that reference config files.
 * @param {string} fieldName  - Field name for error messages (e.g. 'lspServers')
 * @param {string} filePath   - Single path string to validate
 * @param {string} pluginDir  - Absolute plugin root directory
 * @param {string[]} errors   - Error array to push into
 */
function validatePathFile(fieldName, filePath, pluginDir, errors) {
  if (typeof filePath !== 'string') {
    addError(errors, `${fieldName} entries must be string paths`);
    return;
  }
  const resolved = resolvePluginPath(filePath, pluginDir);
  if (!resolved) {
    addError(errors, `${fieldName} path escapes plugin directory: ${filePath}`);
    return;
  }
  if (!fs.existsSync(resolved)) {
    addError(errors, `${fieldName} file not found: ${filePath}`);
    return;
  }
  // Use lstatSync (not statSync) so symlinks are detected before they are
  // followed; a symlink inside the plugin directory could otherwise point at
  // an arbitrary filesystem location and bypass the resolvePluginPath
  // boundary check. Reject symlinks outright.
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink()) {
    addError(
      errors,
      `${fieldName} path is a symlink which is not permitted: ${filePath}`
    );
    return;
  }
  if (stat.isDirectory()) {
    addError(
      errors,
      `${fieldName} must point to a file, not a directory: ${filePath}`
    );
    return;
  }
  logSuccess(`${fieldName}: ${filePath}`);
}

/**
 * Validate a single pathOrPaths entry: must resolve inside the plugin
 * directory and point to a directory containing .md files (or, unless
 * `directoryOnly`, a single .md file). Extracted from the
 * validatePathOrPathsDir loop body (finding 034) so the per-path logic is
 * independently testable and the wrapper is a thin normalize-and-delegate.
 */
function validateSinglePath(fieldName, p, pluginDir, errors, directoryOnly) {
  if (typeof p !== 'string') {
    addError(errors, `${fieldName} entries must be string paths`);
    return;
  }
  const resolved = resolvePluginPath(p, pluginDir);
  if (!resolved) {
    addError(errors, `${fieldName} path escapes plugin directory: ${p}`);
    return;
  }
  if (!fs.existsSync(resolved)) {
    addError(errors, `${fieldName} directory not found: ${p}`);
    return;
  }
  // lstatSync (not statSync): detect symlinks before following them. A
  // symlink inside the plugin directory could otherwise point to a
  // directory outside and let readdirSync enumerate arbitrary filesystem
  // paths past the resolvePluginPath boundary. Reject symlinks outright.
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink()) {
    addError(
      errors,
      `${fieldName} path is a symlink which is not permitted: ${p}`
    );
    return;
  }
  if (stat.isFile()) {
    if (directoryOnly) {
      addError(
        errors,
        `${fieldName} must point to a directory, not a file: ${p}`
      );
      return;
    }
    // Schema's relativePath allows pointing directly at a .md file.
    if (!p.endsWith('.md')) {
      addError(errors, `${fieldName} file path must end with .md: ${p}`);
    } else {
      logSuccess(`${fieldName}: ${p}`);
    }
    return;
  }
  if (!stat.isDirectory()) {
    addError(
      errors,
      `${fieldName} must point to a .md file or a directory: ${p}`
    );
    return;
  }
  // Walk the directory recursively to find any .md files. The 'skills'
  // field uses SKILL.md files inside per-skill subdirectories; 'commands'
  // and 'agents' commonly group .md files into category subdirectories
  // (e.g. setup/all.md, research/best-practices-researcher.md). A
  // single-level readdirSync misses both layouts and false-rejects them.
  // countMarkdownRecursive skips symlinks at every depth, complementing
  // the top-level lstatSync guard above.
  const mdCount = countMarkdownRecursive(resolved);
  if (mdCount === 0) {
    addError(
      errors,
      `${fieldName} directory must contain at least one .md file (recursively): ${p}`
    );
  } else {
    logSuccess(
      `${fieldName}: ${p} (${mdCount} file${mdCount === 1 ? '' : 's'})`
    );
  }
}

/**
 * Validate a pathOrPaths field that must point to a directory containing .md files.
 * Normalizes the raw manifest value (string | string[]) to an array and
 * delegates each entry to validateSinglePath.
 * When `directoryOnly` is true, single-file `.md` paths are rejected — used
 * for outputStyles where the field shape semantically requires a directory
 * even though Anthropic's relativePath schema allows single .md files.
 * @param {string}  fieldName     - Field name for error messages (e.g. 'commands')
 * @param {*}       fieldValue    - Raw manifest value (string | string[] | other)
 * @param {string}  pluginDir     - Absolute plugin root directory
 * @param {string[]} errors       - Error array to push into
 * @param {boolean} directoryOnly - When true, .md file paths produce an error
 */
function validatePathOrPathsDir(
  fieldName,
  fieldValue,
  pluginDir,
  errors,
  directoryOnly = false
) {
  const paths = Array.isArray(fieldValue)
    ? fieldValue
    : typeof fieldValue === 'string'
      ? [fieldValue]
      : null;
  if (paths === null) {
    addError(
      errors,
      `${fieldName} must be a string path or array of string paths`
    );
    return;
  }
  for (const p of paths) {
    validateSinglePath(fieldName, p, pluginDir, errors, directoryOnly);
  }
}

/**
 * Collect inline-form hook entries from either the top-level inline-object
 * form or the array form (which may mix path strings and inline objects).
 * Returns a merged event-keyed dict where each event maps to the
 * concatenated entries arrays from all inline-object sources. Path-string
 * entries are ignored (file existence is enforced separately by RULE 5c).
 *
 * @param {*} hooks - manifest.hooks raw value
 * @returns {Object} event-keyed dict (possibly empty)
 */
function collectInlineHooks(hooks) {
  const sources =
    hooks && typeof hooks === 'object' && !Array.isArray(hooks)
      ? [hooks]
      : Array.isArray(hooks)
        ? hooks.filter((v) => v && typeof v === 'object' && !Array.isArray(v))
        : [];
  const merged = {};
  for (const source of sources) {
    for (const [event, entries] of Object.entries(source)) {
      if (!Array.isArray(entries)) continue;
      if (!merged[event]) merged[event] = [];
      merged[event].push(...entries);
    }
  }
  return merged;
}

/**
 * Apply RULE 6 (existence / readability / executable mode) and RULE 8
 * (shebang / decision-output / set -e) to a single hook script path.
 * Centralizes per-script-path checks so RULE 6 and RULE 8 cannot drift.
 * eventName is required for the DECISION_PROTOCOL_EVENTS gate.
 * interpreter ("bash" | "node", from resolveHookScriptPath) gates RULE 8
 * and the executable-mode part of RULE 6: a `node` entrypoint gets only
 * the existence / symlink / regular-file / readability checks (containment
 * was already enforced by the caller's resolveHookScriptPath). Anything
 * other than "node" gets the full bash checks, so an omitted argument
 * fails strict rather than open.
 */
function validateHookScriptPath(
  scriptPath,
  eventName,
  pluginDir,
  errors,
  interpreter
) {
  if (!fs.existsSync(scriptPath)) {
    addError(errors, `Hook script not found for ${eventName}: ${scriptPath}`);
    return;
  }
  // Use lstatSync (not statSync) so symlinks are detected before following.
  // A symlink could point outside the plugin directory and bypass the
  // resolvePluginPath boundary check — reject symlinks outright. Also reject
  // directories: a malformed hook entry like "bash ." resolves to a directory
  // and would throw a confusing EISDIR from readFileSync.
  let lstat;
  try {
    lstat = fs.lstatSync(scriptPath);
  } catch (lstatErr) {
    addError(
      errors,
      `Hook script not accessible for ${eventName}: ${scriptPath} (${lstatErr.message})`
    );
    return;
  }
  if (lstat.isSymbolicLink()) {
    addError(
      errors,
      `Hook script path is a symlink which is not permitted for ${eventName}: ${scriptPath}`
    );
    return;
  }
  if (!lstat.isFile()) {
    addError(
      errors,
      `Hook script must point to a file, not a directory or special file for ${eventName}: ${scriptPath}`
    );
    return;
  }
  try {
    fs.accessSync(scriptPath, fs.constants.R_OK);
  } catch (accessErr) {
    logWarning(
      `Hook script not readable: ${scriptPath} (check file permissions)`
    );
  }
  // A `node <entrypoint>` command runs the file through the interpreter, so
  // it has no executable-bit, shebang, or shell-content contract — the
  // existence, symlink, and regular-file checks above, plus the containment
  // check the caller's resolveHookScriptPath already applied, are the whole
  // rule. The decision-output scan is skipped too: a node entrypoint
  // typically delegates to lib/ (gt-workflow's entrypoint-claude.js calls
  // runHook), so the literal strings the bash heuristic looks for are not
  // in the file the command names.
  if (interpreter === 'node') return;

  if ((lstat.mode & 0o111) === 0) {
    logWarning(
      `Hook script not executable: ${scriptPath} (check file permissions)`
    );
  }

  let content;
  try {
    content = fs.readFileSync(scriptPath, 'utf-8');
  } catch (readErr) {
    logWarning(`Cannot read hook script: ${scriptPath} (${readErr.message})`);
    return;
  }

  const relPath = path.relative(pluginDir, scriptPath);

  if (!content.startsWith('#!/')) {
    logWarning(`${relPath}: missing shebang line (expected #!/bin/bash)`);
  }

  if (DECISION_PROTOCOL_EVENTS.has(eventName)) {
    const hasJsonOutput =
      /"continue"\s*:/.test(content) || /"decision"\s*:/.test(content);
    const hasExitCodeProtocol =
      /exit\s+0/.test(content) && /exit\s+2/.test(content);
    if (!hasJsonOutput && !hasExitCodeProtocol) {
      logWarning(
        `${relPath}: missing decision output for ${eventName} — expected {"continue": true}, {"decision": ...}, or exit 0/2 protocol`
      );
    }
  }

  if (
    /^\s*set\s+(?:[^#\n]*?\s)?(-[a-zA-Z]*e[a-zA-Z]*|-o\s+errexit)(\s|$)/m.test(
      content
    )
  ) {
    logWarning(
      `${relPath}: uses "set -e" which can prevent JSON output on error — ` +
        'use "set -uo pipefail" instead'
    );
  }
}

module.exports = {
  VALID_HOOK_EVENTS,
  DECISION_PROTOCOL_EVENTS,
  resolveHookScriptPath,
  resolvePluginPath,
  countMarkdownRecursive,
  validatePathFile,
  validateSinglePath,
  validatePathOrPathsDir,
  collectInlineHooks,
  validateHookScriptPath,
};
