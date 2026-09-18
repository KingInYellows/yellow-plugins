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
// non-flag argument. `bash` scripts get the shebang / decision-output /
// `set -e` content checks; `node` entrypoints get existence + containment
// only. Known gap: any other command form (`sh`, `python3`, `env node`, a
// bare "${CLAUDE_PLUGIN_ROOT}/x.sh") gets no script-path checks at all —
// the caller warns when such a command references the placeholder.
const HOOK_SCRIPT_INTERPRETER_RE = /^(bash|node)\s+/;
// Leading interpreter flags (`node --enable-source-maps`, `bash -x`) before
// the script argument. Always matches (possibly empty). This is a coarse
// approximation used only by plugin-rules.js's placeholder-quoting checks,
// which just need to land on "the first word that isn't obviously a flag" —
// resolveHookScriptPath below has its own option-arity-aware skip because
// it must pick out the exact script argument to resolve.
const HOOK_INTERPRETER_FLAGS_SRC = '(?:-\\S+\\s+)*';
// "interpreter + flags" prefix, for rules that inspect the script argument
// without resolving it (plugin-rules.js's placeholder-quoting checks).
const HOOK_SCRIPT_PREFIX_SRC = `^(?:bash|node)\\s+${HOOK_INTERPRETER_FLAGS_SRC}`;

// Interpreter options that take their value as a separate word
// (`node --require preload.js entry.js`, not `--require=preload.js`).
// Without consuming that operand, the script-argument scan below would
// select it instead of the real entrypoint — e.g. `node --require
// source-map-support/register "${CLAUDE_PLUGIN_ROOT}/hooks/main.js"` would
// validate `source-map-support/register` and never check `main.js`.
// `--opt=value` is already a single word and needs no special handling.
const HOOK_OPTION_TAKES_VALUE = {
  node: new Set([
    '-r',
    '--require',
    '--import',
    '--loader',
    '--experimental-loader',
    '--input-type',
    '--stack-trace-limit',
  ]),
  bash: new Set(['-o', '-O', '+O', '--rcfile', '--init-file']),
};
// Options whose value is inline code, not a script path — a command using
// one of these has no separate script argument to resolve at all.
const HOOK_OPTION_IS_INLINE_SCRIPT = {
  node: new Set(['-e', '--eval', '-p', '--print']),
  bash: new Set(['-c']),
};

// Sentinel resolveHookScriptPath returns when the script argument has an
// unterminated quote (e.g. `bash "${CLAUDE_PLUGIN_ROOT}/hooks/guard.sh`
// with no closing `"`). Distinct from null (not a bash/node command, or a
// containment escape) so the caller can report a specific error instead of
// folding it into "escapes plugin directory" or silently skipping it —
// `sh -c` rejects the command outright, so a guard hook using this form
// never runs.
const UNTERMINATED_HOOK_SCRIPT_QUOTE = Symbol('unterminated-hook-script-quote');

/**
 * Return the interpreter ("bash" | "node") a hook command starts with, or
 * null for any other command form (which gets no script-path checks).
 */
function hookCommandInterpreter(command) {
  const match = command.match(HOOK_SCRIPT_INTERPRETER_RE);
  return match ? match[1] : null;
}

/**
 * First shell word of `s`: adjacent quoted and unquoted segments up to the
 * first unquoted whitespace, with the quotes removed — so
 * `"a b"/c`, `"a b/c"` and `a\ b` all yield one word (backslash escapes
 * are not interpreted; no catalog command uses them). Returns null if a
 * quote opened by `s` is never closed — `sh -c` would reject that command,
 * so the caller must not treat the quote-stripped remainder as a real word.
 */
function firstShellWord(s) {
  return consumeShellWord(s).word;
}

/**
 * Like firstShellWord, but also returns what is left of `s` after the
 * consumed word (raw, quotes and all) so a caller can keep parsing forward.
 * Returns { word: null, rest: '' } if a quote opened here is never closed.
 */
function consumeShellWord(s) {
  let word = '';
  let quote = null;
  let i = 0;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
      else word += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) break;
    word += ch;
  }
  if (quote !== null) return { word: null, rest: '' };
  return { word, rest: s.slice(i) };
}

/**
 * Skip leading interpreter option words in `rest` (the hook command with
 * the interpreter already stripped), consuming the operand of any option
 * known to take a separate value so it is never mistaken for the script
 * argument. A word is treated as an option if it starts with `-` (or `+`
 * for bash's `+O`); anything else ends the scan.
 * Returns:
 *   - { rest, quoteError: false } — rest starts at the script argument
 *     (rest is '' if the command has nothing after its options)
 *   - { rest: null, quoteError: false } — an inline-script option (-c,
 *     -e/--eval, -p/--print) was seen; there is no separate script
 *     argument to resolve
 *   - { rest: null, quoteError: true } — an option or its operand opens a
 *     quote it never closes
 */
function skipHookInterpreterOptions(rest, interpreter) {
  const takesValue = HOOK_OPTION_TAKES_VALUE[interpreter] || new Set();
  const isInlineScript = HOOK_OPTION_IS_INLINE_SCRIPT[interpreter] || new Set();
  let remaining = rest;
  for (;;) {
    remaining = remaining.replace(/^\s+/, '');
    const looksLikeOption =
      remaining.startsWith('-') ||
      (interpreter === 'bash' && remaining.startsWith('+'));
    if (!looksLikeOption) return { rest: remaining, quoteError: false };
    const { word, rest: afterWord } = consumeShellWord(remaining);
    if (word === null) return { rest: null, quoteError: true };
    if (!word) return { rest: remaining, quoteError: false };
    if (isInlineScript.has(word)) return { rest: null, quoteError: false };
    if (!takesValue.has(word)) {
      remaining = afterWord;
      continue;
    }
    // Consume this option's separate-word operand so it is skipped along
    // with the flag itself; `--opt=value` never reaches this branch since
    // it is one word matched (or not) against the exact option name above.
    const operandStart = afterWord.replace(/^\s+/, '');
    const { word: operand, rest: afterOperand } =
      consumeShellWord(operandStart);
    if (operand === null) return { rest: null, quoteError: true };
    remaining = afterOperand;
  }
}

/**
 * Resolve a hook command to a script path within the plugin directory.
 * Returns the resolved path; null if the command is not a
 * "bash [flags] <path>" / "node [flags] <path>" format, an option like
 * `-c`/`-e`/`-p` means there is no separate script argument, the script
 * argument is empty, or the path escapes the plugin directory; or the
 * UNTERMINATED_HOOK_SCRIPT_QUOTE sentinel if an option or the script
 * argument opens a quote it never closes (`sh -c` rejects that command
 * outright, so it must not be conflated with the containment-escape case).
 * The placeholder is substituted textually before parsing; callers reject
 * single-quoted placeholders first, since `sh -c` never expands those and
 * the substituted path would validate a script the shell can never reach.
 */
function resolveHookScriptPath(command, pluginDir) {
  // One source of truth for the interpreter set: strip the prefix
  // HOOK_SCRIPT_INTERPRETER_RE matched, then skip interpreter options
  // (consuming known value-taking options' operands) before taking the
  // script argument as ONE shell word and substituting the placeholder.
  // Substituting into the whole command first would let the checkout path
  // change the verdict (a directory with a space word-splits inside the
  // validator) and would resolve the docs-literal form
  // `bash "${CLAUDE_PLUGIN_ROOT}"/hooks/x.sh` to the plugin root.
  const prefix = command.match(HOOK_SCRIPT_INTERPRETER_RE);
  if (!prefix) return null;
  const interpreter = prefix[1];
  const { rest, quoteError } = skipHookInterpreterOptions(
    command.slice(prefix[0].length),
    interpreter
  );
  if (quoteError) return UNTERMINATED_HOOK_SCRIPT_QUOTE;
  if (rest === null) return null; // inline-script option: no script to resolve
  const word = firstShellWord(rest);
  if (word === null) return UNTERMINATED_HOOK_SCRIPT_QUOTE;
  if (!word) return null;
  const scriptPath = word.replaceAll('${CLAUDE_PLUGIN_ROOT}', pluginDir);
  // `..` is folded lexically by path.resolve, but the kernel resolves each
  // component in order — `docs/../hooks/x.sh` with `docs` a symlink to
  // /elsewhere runs /elsewhere/../hooks/x.sh, a file the symlink checks
  // below never see. Rejecting `..` outright is simpler than emulating
  // that and no catalog command needs it.
  if (word.split(/[\\/]+/).includes('..')) return null;
  const normalized = path.resolve(pluginDir, scriptPath);
  if (!normalized.startsWith(path.resolve(pluginDir) + path.sep)) return null;
  return normalized;
}

/**
 * Walk the directories strictly between `rootDir` and `filePath` (rootDir
 * itself and the final component excluded) and return the first one that
 * is a symlink, or null when none is. Lexical containment
 * (`resolvePluginPath`, generate-manifests' assertWithinRoot) never touches
 * the filesystem, so `plugins/x/hooks/a.sh` passes it even when `hooks/` is
 * a symlink to somewhere outside the plugin; this is the on-disk half of
 * that check. A component that does not exist (ENOENT, or ENOTDIR under a
 * stale plain file) is treated as not a symlink — the caller's existence
 * check owns that error. Any other lstat failure is rethrown.
 */
function findSymlinkedAncestor(filePath, rootDir) {
  const root = path.resolve(rootDir);
  let dir = path.dirname(path.resolve(filePath));
  const chain = [];
  while (dir !== root && dir.startsWith(root + path.sep)) {
    chain.push(dir);
    dir = path.dirname(dir);
  }
  // Check from the root outward so the outermost symlink is the one named.
  for (const ancestor of chain.reverse()) {
    try {
      if (fs.lstatSync(ancestor).isSymbolicLink()) return ancestor;
    } catch (err) {
      // ENOENT: not created yet. ENOTDIR: a higher ancestor is a stale
      // plain file the apply pass removes first — same as
      // sweepCandidateProblem's realpath branch. Nothing below either can
      // be a symlink.
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') throw err;
      return null;
    }
  }
  return null;
}

/**
 * True when `realPath` is `realRoot` or a descendant of it. Both arguments
 * are expected to be `fs.realpathSync` output so a symlinked cache root
 * (macOS `/var` -> `/private/var`) compares equal on both sides.
 */
function isWithinRealRoot(realPath, realRoot) {
  return realPath === realRoot || realPath.startsWith(realRoot + path.sep);
}

/**
 * Existence test that does NOT follow symlinks. `fs.existsSync` reports a
 * dangling symlink as absent, but the directory entry is still there — a
 * dangling `hooks/hooks.json` link is still a forbidden file for RULE 7,
 * and a dangling stale artifact still needs unlinking. ENOENT and ENOTDIR
 * (an ancestor is a plain file, so nothing can exist below it) count as
 * absent; any other failure (ELOOP on a symlink cycle, EACCES) counts as
 * PRESENT — an entry the caller cannot inspect must block, not slip past.
 * One implementation shared by validate-plugin RULE 7 and the generator's
 * stale sweep so the two cannot drift.
 */
function lexistsSync(filePath) {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (err) {
    return err.code !== 'ENOENT' && err.code !== 'ENOTDIR';
  }
}

/**
 * "passes through a symlinked directory (<rel>)" when a directory strictly
 * between `rootDir` and `filePath` is a symlink, "cannot be inspected
 * (…)" when the walk fails, or null. The message fragment is shared by
 * the hook-script and path-field validators.
 */
function symlinkedAncestorProblem(filePath, rootDir) {
  try {
    const ancestor = findSymlinkedAncestor(filePath, rootDir);
    return ancestor === null ? null : `passes through a symlinked directory (${path.relative(rootDir, ancestor)}) which is not permitted`;
  } catch (err) {
    return `cannot be inspected (${err.message})`;
  }
}

/**
 * `fs.realpathSync(pluginRoot)`, or null when the root does not exist
 * (nothing to sweep or write) — any other failure is pushed to `errors`.
 */
function resolvePluginRootReal(pluginRoot, errors) {
  try {
    return fs.realpathSync(pluginRoot);
  } catch (err) {
    if (err.code !== 'ENOENT') errors.push(`cannot resolve real path of ${pluginRoot}: ${err.message}`);
    return null;
  }
}

/**
 * Why a plugin root cannot be operated on, or null. `plugins/<name>`
 * itself being a symlink is the one hole neither findSymlinkedAncestor
 * (which walks strictly below the root) nor both-sides realpath (which
 * resolves through it) can see; the sweep and every generated-file write
 * would follow it out of the repository.
 */
function pluginRootProblem(pluginDir) {
  try {
    // path.resolve drops a trailing separator: `lstat('plugins/x/')`
    // follows the link and reports the target directory.
    if (fs.lstatSync(path.resolve(pluginDir)).isSymbolicLink()) {
      return 'is a symlink — plugin roots must be real directories';
    }
  } catch (err) {
    if (err.code !== 'ENOENT') return `cannot be inspected (${err.message})`;
  }
  return null;
}

/**
 * Why `candidate` (a path under `pluginRoot` that a sweep is about to
 * unlink, or a generated file it is about to write) must NOT be touched,
 * or null when it is safe. Lexical containment is the caller's job; this
 * is the on-disk half: no symlinked directory between the root and the
 * candidate (unlinking or writing through one reaches a file the
 * generator never owned), and the candidate's real path stays inside the
 * root's real path. A candidate that is itself a symlink is acceptable
 * only when its target stays inside the root (unlinkSync removes the
 * link, never its target; atomicWrite renames over it) — one that
 * resolves outside is refused, and a dangling one has no target to
 * protect. `pluginRootReal` is resolvePluginRootReal()'s result;
 * `rootDir` only shortens the path in the message.
 */
function sweepCandidateProblem(candidate, pluginRoot, pluginRootReal, rootDir) {
  let symlinkedAncestor;
  try {
    symlinkedAncestor = findSymlinkedAncestor(candidate, pluginRoot);
  } catch (err) {
    return `cannot inspect (${err.message})`;
  }
  if (symlinkedAncestor !== null) {
    return `${path.relative(rootDir, symlinkedAncestor)} is a symlink — generated artifacts must not live behind a symlinked directory`;
  }
  let candidateReal = null;
  try {
    candidateReal = fs.realpathSync(candidate);
  } catch (err) {
    if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') return `cannot resolve real path (${err.message})`;
    // ENOENT: a dangling symlink (safe to unlink) or a file not written
    // yet; ENOTDIR: an ancestor is a stale plain file the apply pass
    // removes first. Neither has a target to protect.
  }
  if (candidateReal !== null && pluginRootReal !== null && !isWithinRealRoot(candidateReal, pluginRootReal)) {
    return 'it resolves outside the plugin directory through a symlink';
  }
  return null;
}

/**
 * Resolve `inputPath` against `pluginDir` and return it only if it stays
 * within the plugin directory boundary; null otherwise.
 */
function resolvePluginPath(inputPath, pluginDir) {
  // `..` is folded lexically here but resolved component-by-component by
  // the kernel, so `docs/../agents` with `docs` a symlink escapes every
  // later check. No catalog path needs it: reject outright.
  if (inputPath.split(/[\\/]+/).includes('..')) return null;
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
  const ancestor = symlinkedAncestorProblem(resolved, pluginDir);
  if (ancestor !== null) {
    addError(errors, `${fieldName} path ${ancestor}: ${filePath}`);
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
  const ancestor = symlinkedAncestorProblem(resolved, pluginDir);
  if (ancestor !== null) {
    addError(errors, `${fieldName} path ${ancestor}: ${p}`);
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
 * interpreter ("bash" | "node", from hookCommandInterpreter) gates RULE 8
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
  // The lstat above only inspects the final component. The caller's
  // resolveHookScriptPath containment is lexical, so a symlinked directory
  // between the plugin root and the script (`hooks/` -> /elsewhere) still
  // passes it and would let the command run a file outside the plugin.
  // Reject the plugin root itself being a symlink, then symlinked
  // ancestors below it (same policy as the file itself). The realpath
  // comparison after that is defence in depth only: with no symlink
  // anywhere in the chain it cannot fail, but it costs two syscalls and
  // closes the lstat-then-read window should the tree change underneath —
  // both sides resolved, so a symlinked parent ABOVE the plugin (macOS
  // /var -> /private/var cache roots) does not false-positive.
  const rootProblem = pluginRootProblem(pluginDir);
  if (rootProblem !== null) {
    addError(errors, `Plugin directory ${rootProblem}: ${pluginDir}`);
    return;
  }
  const ancestorProblem = symlinkedAncestorProblem(scriptPath, pluginDir);
  if (ancestorProblem !== null) {
    addError(
      errors,
      `Hook script path ${ancestorProblem} for ${eventName}: ${scriptPath}`
    );
    return;
  }
  try {
    if (
      !isWithinRealRoot(fs.realpathSync(scriptPath), fs.realpathSync(pluginDir))
    ) {
      addError(
        errors,
        `Hook script resolves outside the plugin directory for ${eventName}: ${scriptPath}`
      );
      return;
    }
  } catch (realErr) {
    addError(
      errors,
      `Hook script not accessible for ${eventName}: ${scriptPath} (${realErr.message})`
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
  HOOK_SCRIPT_PREFIX_SRC,
  UNTERMINATED_HOOK_SCRIPT_QUOTE,
  hookCommandInterpreter,
  lexistsSync,
  pluginRootProblem,
  resolvePluginRootReal,
  sweepCandidateProblem,
  resolveHookScriptPath,
  resolvePluginPath,
  countMarkdownRecursive,
  validatePathFile,
  validateSinglePath,
  validatePathOrPathsDir,
  collectInlineHooks,
  validateHookScriptPath,
};
