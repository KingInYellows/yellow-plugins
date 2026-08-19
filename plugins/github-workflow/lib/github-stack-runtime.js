#!/usr/bin/env node

/**
 * github-stack-runtime.js — the single dependency-free runtime that every
 * github-workflow skill uses for deterministic `gh`, `gh stack`, and
 * required `git` execution (GOAL.md Phase 3). GOAL.md is archived at
 * plans/complete/2026-08-19-github-stack-end-to-end-authoring-brief.md —
 * "GOAL.md" citations throughout this file refer to that document.
 *
 * HARD RULES this module encodes:
 *   - Every external command runs via `spawnSync(bin, argv, { shell: false })`
 *     with an ARGUMENT ARRAY. No shell string is ever assembled from a
 *     branch name, path, remote, PR number, commit subject, or any other
 *     repository-controlled value — that is what makes command injection
 *     through those values structurally impossible here, not merely
 *     unlikely.
 *   - Every value that reaches an argv slot is validated FIRST:
 *     branch names via `git check-ref-format --branch`, PR/stack numbers
 *     as positive integers, remote names against `git remote`, paths as
 *     repository-relative, and flags/merge-methods against a fixed enum.
 *     A validation failure returns an INVALID_ARGS result; it never
 *     "escapes" the value and proceeds.
 *   - `gh stack view --json` is the only read path used — never bare
 *     `view`. `submit` always passes `--auto`; `--open` is added only
 *     when the caller explicitly requests it. `checkout`/`init`/`add`
 *     always receive an explicit target/branch argument — this runtime
 *     never lets the underlying CLI fall through to its interactive
 *     picker. `modify` and `switch` are NEVER invoked — both are
 *     TUI-only per the Phase 0 source read; there is no non-interactive
 *     path this runtime could use even if it wanted to. `gh pr merge` is
 *     never invoked for a stack — `merge()` below is the only merge path.
 *   - Destructive operations (`unstack`, `sync --prune`, `merge`) require
 *     the caller to pass `confirm: true` explicitly; without it they
 *     return a REQUIRES_CONFIRMATION result and run nothing.
 *   - Every result reports `mayHaveMutated` truthfully — `true` for any
 *     operation beyond `view`, even on failure, because a failed `submit`
 *     or `sync` may still have partially pushed or partially updated PRs
 *     (GOAL.md: "push and submit may be partially applied").
 *   - Output is bounded before it reaches model context: stdout/stderr
 *     are truncated to MAX_OUTPUT_CHARS with a truncation marker and an
 *     honest `truncated`/`totalChars` pair, never silently.
 *
 * CLI:
 *   node github-stack-runtime.js <op> [--flag value ...] [--confirm] [--json-args <path|->]
 *
 * Operations: view, init, add, checkout, rebase, sync, submit, merge, unstack.
 * Output is a single JSON result object on stdout. Exit code is always 0
 * for a completed probe/operation attempt (the result's own `status` field
 * carries the outcome) and 1 only when the CLI was invoked incorrectly
 * (unknown op, missing required flag) — mirroring stack-provider-state.js's
 * contract.
 */

'use strict';

const { spawnSync } = require('child_process');

const MAX_OUTPUT_CHARS = 8000;

/** Exit-code -> status mapping, verified against github/gh-stack source at
 * ab00aa4a3f2dddc51aa65849c68b391a1b079311 (cmd/utils.go) — see
 * docs/research/2026-08-18-github-stack-provider-operations-revalidation.md §2.
 * Exit 2 (ErrNotInStack) is included even though the task brief's own
 * exit-code list omitted it — that omission is recorded as a delta in the
 * research doc, not silently dropped here.
 *
 * LIVE-SMOKE FINDING (2026-08-19, docs/research/2026-08-18-github-stack-
 * provider-operations-revalidation.md §9): the same underlying problem —
 * merging a draft PR — surfaced as exit 2 (NOT_IN_STACK) when `merge` was
 * invoked with no target (current-branch context: "nothing to merge:
 * pull request #1 is a draft") and exit 5 (INVALID_ARGS) when invoked
 * with an explicit `--target` ("pull request #1 is a draft; mark it ready
 * for review before merging"). The exit-code taxonomy is coarser than a
 * 1:1 status mapping implies — do not treat NOT_IN_STACK's recoveryAction
 * as authoritative on its own; every caller of this module already
 * surfaces `stderr` verbatim alongside `recoveryAction`, which is where
 * the real reason lives.
 */
const EXIT_STATUS = Object.freeze({
  0: 'SUCCESS',
  1: 'ERROR', // ErrSilent — message already printed by gh-stack itself
  2: 'NOT_IN_STACK',
  3: 'CONFLICT',
  4: 'API_FAILURE',
  5: 'INVALID_ARGS',
  6: 'AMBIGUOUS_STACK',
  7: 'REBASE_ACTIVE',
  8: 'LOCK_FAILED',
  9: 'STACKS_UNAVAILABLE',
  10: 'MODIFY_RECOVERY',
});

const MERGE_METHODS = Object.freeze(['merge', 'squash', 'rebase']);

// ---------------------------------------------------------------------------
// Execution primitive
// ---------------------------------------------------------------------------

/**
 * Run one external command via an argument array — never a shell string.
 * @param {string} bin
 * @param {string[]} args
 */
function run(bin, args) {
  const result = spawnSync(bin, args, {
    encoding: 'utf8',
    timeout: 120000,
    shell: false,
    windowsHide: true,
  });
  if (result.error || typeof result.status !== 'number') {
    return {
      ok: false,
      code: null,
      stdout: '',
      stderr: result.error ? String(result.error.message || result.error) : '',
    };
  }
  return {
    ok: true,
    code: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

/** Truncate a string to MAX_OUTPUT_CHARS, reporting truncation honestly. */
function bound(text) {
  const totalChars = text.length;
  if (totalChars <= MAX_OUTPUT_CHARS) {
    return { text, truncated: false, totalChars };
  }
  return {
    text: `${text.slice(0, MAX_OUTPUT_CHARS)}\n… [truncated ${totalChars - MAX_OUTPUT_CHARS} of ${totalChars} chars]`,
    truncated: true,
    totalChars,
  };
}

// ---------------------------------------------------------------------------
// Validation — every value that can reach an argv slot is checked here
// ---------------------------------------------------------------------------

/** @returns {{ ok: true, value: string } | { ok: false, reason: string }} */
function validateBranchName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    return { ok: false, reason: 'branch name must be a non-empty string' };
  }
  const check = run('git', ['check-ref-format', '--branch', name]);
  if (!check.ok || check.code !== 0) {
    return { ok: false, reason: `"${name}" is not a valid branch name (git check-ref-format refused it)` };
  }
  return { ok: true, value: name };
}

/** @returns {{ ok: true, value: number } | { ok: false, reason: string }} */
function validatePositiveInt(value, label) {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    return { ok: false, reason: `${label} must be a positive integer, got "${value}"` };
  }
  return { ok: true, value: num };
}

/**
 * Repository-relative path: rejects absolute paths, `..` traversal
 * segments, and null bytes. Does not resolve or touch the filesystem —
 * callers that need existence checks do that separately.
 */
function validateRepoRelativePath(pathValue) {
  if (typeof pathValue !== 'string' || pathValue.length === 0) {
    return { ok: false, reason: 'path must be a non-empty string' };
  }
  if (pathValue.includes('\0')) {
    return { ok: false, reason: 'path contains a null byte' };
  }
  if (pathValue.startsWith('/') || /^[A-Za-z]:[\\/]/.test(pathValue)) {
    return { ok: false, reason: `"${pathValue}" is an absolute path, not repository-relative` };
  }
  const segments = pathValue.split(/[\\/]/);
  if (segments.some((segment) => segment === '..')) {
    return { ok: false, reason: `"${pathValue}" contains a ".." traversal segment` };
  }
  return { ok: true, value: pathValue };
}

/** @returns {{ ok: true, value: string } | { ok: false, reason: string }} */
function validateRemoteName(remote) {
  if (typeof remote !== 'string' || remote.length === 0) {
    return { ok: false, reason: 'remote name must be a non-empty string' };
  }
  const remotes = run('git', ['remote']);
  if (!remotes.ok || remotes.code !== 0) {
    return { ok: false, reason: 'could not list git remotes to validate against' };
  }
  const known = remotes.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!known.includes(remote)) {
    return { ok: false, reason: `"${remote}" is not a configured remote (known: ${known.join(', ') || 'none'})` };
  }
  return { ok: true, value: remote };
}

/**
 * Resolve which `--remote` argument (if any) to pass. Never defaults to a
 * value the caller did not provide when more than one remote exists and
 * `remote.pushDefault` is not itself a verified, valid remote — GOAL.md:
 * "Explicit remote when multiple remotes exist unless remote.pushDefault
 * is verified."
 * @param {string|undefined} explicitRemote
 * @returns {{ ok: true, remote: string|null } | { ok: false, reason: string }}
 */
function resolveRemote(explicitRemote) {
  if (typeof explicitRemote === 'string' && explicitRemote.length > 0) {
    const validated = validateRemoteName(explicitRemote);
    return validated.ok ? { ok: true, remote: validated.value } : { ok: false, reason: validated.reason };
  }
  const remotes = run('git', ['remote']);
  if (!remotes.ok || remotes.code !== 0) {
    return { ok: false, reason: 'could not list git remotes' };
  }
  const known = remotes.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  if (known.length <= 1) {
    // Zero or one remote: gh-stack's own default resolution is unambiguous.
    return { ok: true, remote: null };
  }
  const pushDefault = run('git', ['config', 'remote.pushDefault']);
  const candidate = pushDefault.ok && pushDefault.code === 0 ? pushDefault.stdout.trim() : '';
  if (candidate.length > 0 && known.includes(candidate)) {
    return { ok: true, remote: candidate };
  }
  return {
    ok: false,
    reason: `multiple remotes exist (${known.join(', ')}) and no explicit remote was given and no valid remote.pushDefault is set`,
  };
}

function validateEnum(value, allowed, label) {
  if (!allowed.includes(value)) {
    return { ok: false, reason: `${label} must be one of ${allowed.join(', ')}, got "${value}"` };
  }
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// Result shaping
// ---------------------------------------------------------------------------

const RECOVERY_ACTIONS = Object.freeze({
  NOT_IN_STACK: 'The current branch is not part of a tracked stack. Run `gh stack init` or `gh stack checkout <target>` first.',
  CONFLICT: 'Resolve the conflicting files, `git add` them, then re-run with the same operation to continue, or pass an abort request to unwind the rebase.',
  API_FAILURE: 'A GitHub API call failed. Check `gh auth status` and network connectivity, then retry.',
  INVALID_ARGS: 'The command was invoked with invalid arguments — see detail for which value was rejected.',
  AMBIGUOUS_STACK: 'Multiple stacks or remotes matched; pass an explicit target (stack number, PR number, PR URL, or branch name).',
  REBASE_ACTIVE: 'A rebase is already in progress. Resolve or abort it (see the conflict-recovery instructions) before retrying.',
  LOCK_FAILED: 'Could not acquire the stack file lock — another gh-stack process may be running. Wait and retry.',
  STACKS_UNAVAILABLE: 'Stacked PRs are not enabled for this repository. This is a repository-level GitHub setting, not fixable by retrying.',
  MODIFY_RECOVERY: 'A previous `gh stack modify` session was interrupted. This runtime never invokes `modify` — resolve the interrupted session with `gh stack modify --continue` or `--abort` directly, outside this runtime.',
  ERROR: 'The command failed; see stderr for the printed error.',
  SYNC_ABORTED: 'Sync detected a divergence it cannot resolve non-interactively and made no changes. Re-run in an interactive terminal, or import the remote stack explicitly.',
  REQUIRES_CONFIRMATION: 'This is a destructive operation. Re-invoke with confirm: true after showing the caller exactly what will change.',
});

/**
 * @param {{
 *   op: string,
 *   bin: string,
 *   args: string[],
 *   execResult: { ok: boolean, code: number|null, stdout: string, stderr: string },
 *   mayHaveMutated: boolean,
 *   syncAbortCheck?: boolean,
 * }} input
 */
function shapeResult({ op, bin, args, execResult, mayHaveMutated, syncAbortCheck = false }) {
  const stdout = bound(execResult.stdout);
  const stderr = bound(execResult.stderr);
  let status;
  if (!execResult.ok) {
    status = 'SPAWN_FAILURE';
  } else if (syncAbortCheck && execResult.code === 0 && /Sync aborted/.test(execResult.stdout)) {
    // Exit 0 with "Sync aborted" in stdout is UNRESOLVED, not success — the
    // CLI's own exit code cannot distinguish "sync completed" from "sync
    // silently declined to act" (source-verified, see cmd/utils.go
    // resolveStackDivergence). Checked BEFORE the exit-code map so a
    // literal 0 never reports SUCCESS in this specific case.
    status = 'SYNC_ABORTED';
  } else {
    status = EXIT_STATUS[execResult.code] || 'UNKNOWN_ERROR';
  }
  return {
    operation: op,
    command: { bin, args },
    exitCode: execResult.ok ? execResult.code : null,
    status,
    safeSummary: `${bin} ${args.join(' ')} -> ${status}`,
    stdout: stdout.text,
    stdoutTruncated: stdout.truncated,
    stdoutTotalChars: stdout.totalChars,
    stderr: stderr.text,
    stderrTruncated: stderr.truncated,
    stderrTotalChars: stderr.totalChars,
    recoveryAction: RECOVERY_ACTIONS[status] || null,
    mayHaveMutated,
  };
}

function refusalResult(op, reason) {
  return {
    operation: op,
    command: null,
    exitCode: null,
    status: 'INVALID_ARGS',
    safeSummary: `${op} refused before execution: ${reason}`,
    stdout: '',
    stdoutTruncated: false,
    stdoutTotalChars: 0,
    stderr: '',
    stderrTruncated: false,
    stderrTotalChars: 0,
    recoveryAction: RECOVERY_ACTIONS.INVALID_ARGS,
    mayHaveMutated: false,
    refusalReason: reason,
  };
}

function confirmationRequiredResult(op, detail) {
  return {
    operation: op,
    command: null,
    exitCode: null,
    status: 'REQUIRES_CONFIRMATION',
    safeSummary: `${op} requires explicit confirmation: ${detail}`,
    stdout: '',
    stdoutTruncated: false,
    stdoutTotalChars: 0,
    stderr: '',
    stderrTruncated: false,
    stderrTotalChars: 0,
    recoveryAction: RECOVERY_ACTIONS.REQUIRES_CONFIRMATION,
    mayHaveMutated: false,
  };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/** Read-only. Always `--json`, never bare `view`. */
function view() {
  const execResult = run('gh', ['stack', 'view', '--json']);
  return shapeResult({ op: 'view', bin: 'gh', args: ['stack', 'view', '--json'], execResult, mayHaveMutated: false });
}

/** `gh stack init -b <base> <branch>` — base and branch are both explicit, never omitted. */
function init({ base, branch }) {
  const baseCheck = validateBranchName(base);
  if (!baseCheck.ok) return refusalResult('init', `base: ${baseCheck.reason}`);
  const branchCheck = validateBranchName(branch);
  if (!branchCheck.ok) return refusalResult('init', `branch: ${branchCheck.reason}`);
  const args = ['stack', 'init', '-b', baseCheck.value, branchCheck.value];
  const execResult = run('gh', args);
  return shapeResult({ op: 'init', bin: 'gh', args, execResult, mayHaveMutated: true });
}

/** `gh stack add -m <message> <branch>` — branch is always explicit. */
function add({ branch, message, remote }) {
  const branchCheck = validateBranchName(branch);
  if (!branchCheck.ok) return refusalResult('add', branchCheck.reason);
  if (typeof message !== 'string' || message.trim().length === 0) {
    return refusalResult('add', 'a non-empty commit message is required');
  }
  const remoteResult = resolveRemote(remote);
  if (!remoteResult.ok) return refusalResult('add', remoteResult.reason);
  const args = ['stack', 'add', '-m', message, branchCheck.value];
  if (remoteResult.remote) args.push('--remote', remoteResult.remote);
  const execResult = run('gh', args);
  return shapeResult({ op: 'add', bin: 'gh', args, execResult, mayHaveMutated: true });
}

/** `gh stack checkout <target>` — target is always explicit (stack #, PR #, PR URL, or branch name). */
function checkout({ target }) {
  if (typeof target !== 'string' || target.length === 0) {
    return refusalResult('checkout', 'target must be a non-empty string (stack number, PR number, PR URL, or branch name)');
  }
  // A bare positive integer or a github.com PR URL is accepted as-is (they
  // cannot be interpreted as a flag); anything else must pass branch-name
  // validation so an arbitrary string never reaches argv unchecked.
  const looksLikeNumber = /^[1-9][0-9]*$/.test(target);
  const looksLikeUrl = /^https:\/\/github\.com\//.test(target);
  if (!looksLikeNumber && !looksLikeUrl) {
    const branchCheck = validateBranchName(target);
    if (!branchCheck.ok) return refusalResult('checkout', branchCheck.reason);
  }
  const args = ['stack', 'checkout', target];
  const execResult = run('gh', args);
  return shapeResult({ op: 'checkout', bin: 'gh', args, execResult, mayHaveMutated: true });
}

/**
 * `gh stack rebase` — exactly one of upstack/downstack/continue/abort.
 * `modify` is NEVER used (TUI-only); this is the only rebase-family entry
 * point this runtime exposes.
 */
function rebase({ mode, remote }) {
  const modeCheck = validateEnum(mode, ['upstack', 'downstack', 'continue', 'abort'], 'mode');
  if (!modeCheck.ok) return refusalResult('rebase', modeCheck.reason);
  const args = ['stack', 'rebase'];
  if (mode === 'continue' || mode === 'abort') {
    args.push(`--${mode}`);
  } else {
    args.push(`--${mode}`);
    const remoteResult = resolveRemote(remote);
    if (!remoteResult.ok) return refusalResult('rebase', remoteResult.reason);
    if (remoteResult.remote) args.push('--remote', remoteResult.remote);
  }
  const execResult = run('gh', args);
  return shapeResult({ op: 'rebase', bin: 'gh', args, execResult, mayHaveMutated: true });
}

/**
 * `gh stack sync [--remote <r>] [--prune]`. `--prune` requires
 * `confirm: true` — it removes local branches. The exit-0-"Sync aborted"
 * case is checked in `shapeResult` (`syncAbortCheck: true`).
 */
function sync({ remote, prune, confirm }) {
  if (prune && confirm !== true) {
    return confirmationRequiredResult('sync', 'sync --prune removes local branches for merged PRs');
  }
  const remoteResult = resolveRemote(remote);
  if (!remoteResult.ok) return refusalResult('sync', remoteResult.reason);
  const args = ['stack', 'sync'];
  if (remoteResult.remote) args.push('--remote', remoteResult.remote);
  if (prune) args.push('--prune');
  const execResult = run('gh', args);
  return shapeResult({ op: 'sync', bin: 'gh', args, execResult, mayHaveMutated: true, syncAbortCheck: true });
}

/**
 * `gh stack submit --auto [--open] [--remote <r>]`. `--auto` is always
 * present (noninteractive PR titles); `--open` only when explicitly
 * requested — GOAL.md: "draft by default unless explicitly requested".
 */
function submit({ open, remote }) {
  const remoteResult = resolveRemote(remote);
  if (!remoteResult.ok) return refusalResult('submit', remoteResult.reason);
  const args = ['stack', 'submit', '--auto'];
  if (open === true) args.push('--open');
  if (remoteResult.remote) args.push('--remote', remoteResult.remote);
  const execResult = run('gh', args);
  return shapeResult({ op: 'submit', bin: 'gh', args, execResult, mayHaveMutated: true });
}

/**
 * `gh stack merge <target> --yes [--merge-method <m>]`. Requires an
 * explicit target AND `confirm: true` — this lands code. Never `gh pr
 * merge` for a stack.
 */
function merge({ target, mergeMethod, confirm }) {
  if (typeof target !== 'string' || target.length === 0) {
    return refusalResult('merge', 'target must be an explicit PR number, PR URL, or stack number');
  }
  // `gh stack merge` only accepts `[<stack-number> | <pr-number>]` (its
  // own usage line) — no bare branch name, unlike `checkout`. Enforce the
  // same argv-shape discipline every other validated field in this module
  // gets (see the HARD RULE at the top of this file): a flag-shaped
  // target (e.g. `--squash`) must never reach argv unvalidated, since
  // cobra parses flags in any position and would silently redirect the
  // merge to the current branch's PR context instead of refusing.
  const looksLikeNumber = /^[1-9][0-9]*$/.test(target);
  const looksLikeUrl = /^https:\/\/github\.com\//.test(target);
  if (!looksLikeNumber && !looksLikeUrl) {
    return refusalResult('merge', `target "${target}" is neither a positive integer (PR/stack number) nor a github.com URL`);
  }
  if (confirm !== true) {
    return confirmationRequiredResult('merge', `merge target "${target}" lands code and cannot be undone by this runtime`);
  }
  const args = ['stack', 'merge', target, '--yes'];
  if (mergeMethod !== undefined) {
    const methodCheck = validateEnum(mergeMethod, MERGE_METHODS, 'mergeMethod');
    if (!methodCheck.ok) return refusalResult('merge', methodCheck.reason);
    args.push('--merge-method', methodCheck.value);
  }
  const execResult = run('gh', args);
  return shapeResult({ op: 'merge', bin: 'gh', args, execResult, mayHaveMutated: true });
}

/**
 * `gh stack unstack [--local]`. Verified against `cmd/unstack.go` at the
 * pinned SHA: the DEFAULT (no `--local`) call removes local stack
 * tracking AND remote-unstacks every PR in the stack via the GitHub API —
 * `--local` is the SAFE-RESTRICTING flag that skips the remote call and
 * only removes local tracking. Neither variant deletes local git branches
 * (upstream's `--local` help text is literally "Only delete the stack
 * locally," meaning the STACK — its tracking metadata — not the branches).
 * Always destructive (the remote unstack cannot be undone by this
 * runtime); always requires confirm: true regardless of `local`.
 */
function unstack({ local, confirm }) {
  if (confirm !== true) {
    return confirmationRequiredResult(
      'unstack',
      local
        ? 'unstack --local removes local stack tracking only (no remote call, no branch deletion) and cannot be undone by this runtime'
        : 'unstack removes local stack tracking AND remote-unstacks every PR in the stack via the GitHub API (no branch deletion) and cannot be undone by this runtime'
    );
  }
  const args = ['stack', 'unstack'];
  if (local) args.push('--local');
  const execResult = run('gh', args);
  return shapeResult({ op: 'unstack', bin: 'gh', args, execResult, mayHaveMutated: true });
}

const OPERATIONS = Object.freeze({ view, init, add, checkout, rebase, sync, submit, merge, unstack });

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        args[key] = true;
        continue;
      }
      args[key] = value;
      index += 1;
      continue;
    }
    args._.push(token);
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  const op = args._[0];
  if (typeof op !== 'string' || !OPERATIONS[op]) {
    console.error(`usage: github-stack-runtime.js <${Object.keys(OPERATIONS).join('|')}> [--flag value ...] [--confirm]`);
    return 1;
  }
  const params = {
    base: typeof args.base === 'string' ? args.base : undefined,
    branch: typeof args.branch === 'string' ? args.branch : undefined,
    message: typeof args.message === 'string' ? args.message : undefined,
    target: typeof args.target === 'string' ? args.target : undefined,
    remote: typeof args.remote === 'string' ? args.remote : undefined,
    mode: typeof args.mode === 'string' ? args.mode : undefined,
    mergeMethod: typeof args['merge-method'] === 'string' ? args['merge-method'] : undefined,
    open: args.open === true,
    prune: args.prune === true,
    local: args.local === true,
    confirm: args.confirm === true,
  };
  const result = OPERATIONS[op](params);
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = {
  EXIT_STATUS,
  MERGE_METHODS,
  validateBranchName,
  validatePositiveInt,
  validateRepoRelativePath,
  validateRemoteName,
  resolveRemote,
  validateEnum,
  OPERATIONS,
  view,
  init,
  add,
  checkout,
  rebase,
  sync,
  submit,
  merge,
  unstack,
};
