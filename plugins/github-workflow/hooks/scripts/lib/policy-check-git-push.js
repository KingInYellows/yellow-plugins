'use strict';

/**
 * Host-agnostic policy for github-workflow's PreToolUse `git push` hook.
 *
 * Unlike gt-workflow's sibling, which blocks every raw `git push` because a
 * push outside `gt submit` leaves Graphite's branch metadata stale, this
 * policy allows a plain push. gh-stack keeps its stack state locally and
 * `sync`/`submit` pick a pushed branch up, so only pushes that can rewrite
 * or remove a branch a stacked PR builds on are denied:
 *
 * - force: `-f`, `--force`, `--force-with-lease`, `--force-if-includes`,
 *   a `+refspec`
 * - `--mirror`
 * - deletes: `-d`, `--delete`, `--prune`, a `:branch` refspec
 *
 * A push whose words the detector cannot read in full (nested shell,
 * alias, plumbing, `-c` override, xargs, a `$`/substitution word that could
 * expand to a flag or refspec) is denied with its own message. A plain push
 * of a branch listed in the local gh-stack catalog is allowed with a
 * reminder to run `/github-stack:sync` afterwards.
 *
 * Envelope edge cases are unchanged (see run-hook.js): oversized stdin
 * fails closed before this runs; malformed JSON or a null envelope fails
 * open; an ABSENT `tool_input.command` fails open; a PRESENT non-string one
 * fails closed. Detection is ./git-push-detector.js, a byte-identical copy
 * of gt-workflow's (kept independent so github-workflow never requires
 * gt-workflow's files).
 *
 * Pure: the only I/O is the injected `readStackInfo`.
 */

const { analyzeGitPushCommand } = require('./git-push-detector.js');

const DESTRUCTIVE_MESSAGE = [
  '⛔  This `git push` can rewrite or delete a remote branch (force, `+refspec`, `--mirror`, `--delete`, `--prune` or `:branch`).',
  '   That can break a pull request stacked on the branch. Plain `git push` is allowed.',
  '   To update a stack after a rebase, use `/github-stack:sync` or `/github-stack:submit`.',
  '   For anything else, ask the user to run the push themselves.',
].join('\n');

const OPAQUE_MESSAGE = [
  '⛔  The hook cannot check this `git push` for force or delete: it runs through a nested shell, an alias,',
  '   push plumbing, a `-c` override, xargs, or a `$` value decided at runtime.',
  '   Run a plain `git push [-u] <remote> <branch>` with literal names, or use `/github-stack:submit`.',
].join('\n');

const UNVERIFIABLE_MESSAGE = [
  '⛔  Hook could not verify this Bash command. Blocking as a precaution.',
  '   If you intended to push, run a plain `git push` on its own or use `/github-stack:submit`.',
].join('\n');

const MALFORMED_MESSAGE =
  '⛔  Hook input has a non-string tool_input.command. Cannot verify command safety.';

// `git push` options that take the next word as their value.
const VALUE_OPTIONS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
// Long options that force, mirror or delete. git accepts any unambiguous
// prefix (`--forc`, `--mir`), so a prefix of one of these counts too.
const DESTRUCTIVE_LONG = ['force', 'force-with-lease', 'force-if-includes', 'mirror', 'delete', 'prune'];
// Short options that force or delete; `o` takes a value.
const DESTRUCTIVE_SHORT = new Set(['f', 'd']);

/**
 * @param {string[]} args Words after `push`.
 * @returns {{kind: 'plain'|'destructive'|'opaque', refspecs: string[]}}
 */
function classifyPushArgs(args) {
  const positionals = [];
  let kind = 'plain';
  let i = 0;
  let endOfOptions = false;
  while (i < args.length) {
    const word = args[i];
    i += 1;
    // `$` or a substitution can expand to a flag or a `+`/`:` refspec.
    if (word.includes('\u0000') || word.includes('$') || word.includes('`')) return { kind: 'opaque', refspecs: [] };
    if (endOfOptions || word === '-' || !word.startsWith('-')) {
      positionals.push(word);
      continue;
    }
    if (word === '--') {
      endOfOptions = true;
      continue;
    }
    if (word.startsWith('--')) {
      const name = word.slice(2).split('=')[0];
      if (name.startsWith('no-')) continue;
      if (name !== '' && DESTRUCTIVE_LONG.some((opt) => opt.startsWith(name))) kind = 'destructive';
      if (VALUE_OPTIONS.has('--' + name) && !word.includes('=')) i += 1;
      continue;
    }
    // Short cluster: `-uf`, `-ofoo`, `-o foo`.
    for (let k = 1; k < word.length; k += 1) {
      const ch = word[k];
      if (DESTRUCTIVE_SHORT.has(ch)) kind = 'destructive';
      if (ch === 'o') {
        if (k === word.length - 1) i += 1;
        break;
      }
    }
  }
  // positionals[0] is the repository; the rest are refspecs.
  const refspecs = positionals.slice(1);
  for (const spec of positionals) {
    if (spec.startsWith('+') || (spec.startsWith(':') && spec.length > 1)) kind = 'destructive';
  }
  return { kind, refspecs };
}

/** Local branch names a refspec list pushes (`src[:dst]`, `refs/heads/x`). */
function pushedBranches(refspecs, currentBranch) {
  if (refspecs.length === 0) return currentBranch ? [currentBranch] : [];
  const out = [];
  for (const spec of refspecs) {
    let src = spec.split(':')[0].replace(/^refs\/heads\//, '');
    if (src === 'HEAD' || src === '@') src = currentBranch || '';
    if (src !== '') out.push(src);
  }
  return out;
}

/**
 * @param {{toolInput?: {command?: unknown}, cwd?: unknown}} camelCaseEnvelope
 * @param {{readStackInfo?: (cwd: string) => ({stacked: Set<string>, currentBranch: string|null} | null)}} [io]
 * @returns {{decision: 'allow'|'deny'|'note', message: string|null}}
 */
function checkGitPush(camelCaseEnvelope, io = {}) {
  // Real PreToolUse envelopes nest the Bash command under `tool_input`
  // (-> toolInput after snake->camel). See docs/solutions/code-quality/
  // posttooluse-hook-input-schema-field-paths.md.
  const command = camelCaseEnvelope.toolInput?.command;

  if (command === undefined) {
    return { decision: 'allow', message: null };
  }
  if (typeof command !== 'string') {
    return { decision: 'deny', message: MALFORMED_MESSAGE };
  }

  const { verdict, pushes } = analyzeGitPushCommand(command);
  if (verdict === 'allow') return { decision: 'allow', message: null };
  if (verdict === 'unverifiable') return { decision: 'deny', message: UNVERIFIABLE_MESSAGE };

  const classified = pushes.map((p) => (p.opaque ? { kind: 'opaque', refspecs: [] } : classifyPushArgs(p.args)));
  if (classified.length === 0 || classified.some((c) => c.kind === 'opaque')) {
    return { decision: 'deny', message: OPAQUE_MESSAGE };
  }
  if (classified.some((c) => c.kind === 'destructive')) {
    return { decision: 'deny', message: DESTRUCTIVE_MESSAGE };
  }

  const cwd = typeof camelCaseEnvelope.cwd === 'string' && camelCaseEnvelope.cwd !== '' ? camelCaseEnvelope.cwd : null;
  const info = cwd && typeof io.readStackInfo === 'function' ? io.readStackInfo(cwd) : null;
  if (info) {
    const stacked = new Set();
    for (const c of classified) {
      for (const branch of pushedBranches(c.refspecs, info.currentBranch)) {
        if (info.stacked.has(branch)) stacked.add(branch);
      }
    }
    if (stacked.size > 0) {
      return {
        decision: 'note',
        message:
          `${[...stacked].join(', ')} is part of a gh-stack stack. After this push, run ` +
          '`/github-stack:sync` so the pull requests above it are restacked and stay linked.',
      };
    }
  }
  return { decision: 'allow', message: null };
}

module.exports = { checkGitPush, classifyPushArgs };
