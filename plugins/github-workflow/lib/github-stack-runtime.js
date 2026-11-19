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
 *   - `gh stack view --json` is the only stack read path used — never
 *     bare `view`. `submit` always passes `--auto`; `--open` is added only
 *     when the caller explicitly requests it. `checkout`/`init`/`add`
 *     always receive an explicit target/branch argument — this runtime
 *     never lets the underlying CLI fall through to its interactive
 *     picker. `init` with several branches adopts existing branches, and
 *     refuses an order in which a branch does not contain the one below
 *     it, because gh-stack accepts that order and the next rebase would
 *     then rewrite the branches to match it. `modify` and `switch` are NEVER invoked — both are
 *     TUI-only per the Phase 0 source read; there is no non-interactive
 *     path this runtime could use even if it wanted to. `gh pr merge` is
 *     never invoked — `merge()` below is the only merge path for a stack.
 *     `mergeSingle()` is the separate path for an ordinary pull request:
 *     it reads the pull request with `gh api`, refuses one in a stack, and
 *     lands it with the REST merge call.
 *   - Destructive operations (`unstack`, `sync --prune`, `merge`,
 *     `merge-single`, and
 *     `--accept-base-change` on `sync`/`rebase`) require the caller to pass
 *     `confirm: true` explicitly; without it they return a
 *     REQUIRES_CONFIRMATION result and run nothing.
 *   - Every result reports `mayHaveMutated` truthfully — `true` for any
 *     operation beyond `view`, even on failure, because a failed `submit`
 *     or `sync` may still have partially pushed or partially updated PRs
 *     (GOAL.md: "push and submit may be partially applied").
 *   - Output is REDACTED and THEN bounded before it reaches model context:
 *     stdout/stderr pass through `redact()` (credential-bearing URLs,
 *     GitHub tokens, Bearer headers, JWTs, URL credential params) and are
 *     only afterwards truncated to MAX_OUTPUT_CHARS with a truncation
 *     marker and an honest `truncated`/`totalChars` pair, never silently.
 *     Redaction precedes truncation deliberately — a size cap limits
 *     volume, not disclosure, and a secret must not survive by sitting
 *     past the truncation boundary.
 *
 * CLI:
 *   node github-stack-runtime.js <op> [--flag value ...] [--confirm] [--json-args <path|->]
 *
 * Operations: view, init, add, checkout, rebase, sync, push, submit, merge,
 * merge-single, unstack. Argument shapes are verified against gh-stack v0.3.0 (the
 * `TESTED_GH_STACK_VERSION` yellow-core's stack-tooling-probe.js reports).
 * Output is a single JSON result object on stdout. Exit code is always 0
 * for a completed probe/operation attempt (the result's own `status` field
 * carries the outcome) and 1 only when the CLI was invoked incorrectly
 * (unknown op, missing required flag) — mirroring stack-provider-state.js's
 * contract.
 */

'use strict';

const { spawnSync } = require('child_process');
const { createHash } = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_OUTPUT_CHARS = 8000;
const DEFAULT_TIMEOUT_MS = 120000;
let spawnTimeoutMs = DEFAULT_TIMEOUT_MS;

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
const SHA_RE = /^[0-9a-f]{40}$/;
/**
 * `mergeable_state` values under which `merge-single` will merge. `unstable`
 * is mergeable with a failing check that is not required. Everything else
 * (`blocked`, `behind`, `dirty`, `draft`, `unknown`) is refused: the REST
 * merge call lets a repository admin through branch protection, so the
 * adapter must not rely on GitHub refusing the call.
 */
const MERGEABLE_STATES = Object.freeze(['clean', 'has_hooks', 'unstable']);

// ---------------------------------------------------------------------------
// Execution primitive
// ---------------------------------------------------------------------------

/**
 * Run one external command via an argument array — never a shell string.
 * @param {string} bin
 * @param {string[]} args
 */
/**
 * The child's environment. gh-stack 0.3.0 reads `GH_STACK_NO_ATOMIC` as the
 * default of `--no-atomic` on push, sync and submit, so an inherited value
 * would turn off the all-or-nothing push this runtime promises. It is
 * dropped here rather than overridden per command.
 */
function childEnv(extra) {
  const env = { ...process.env, ...extra };
  delete env.GH_STACK_NO_ATOMIC;
  return env;
}

function run(bin, args, extraEnv) {
  const result = spawnSync(bin, args, {
    encoding: 'utf8',
    env: childEnv(extraEnv),
    timeout: spawnTimeoutMs,
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

/**
 * Credential redaction for subprocess output, applied BEFORE truncation so a
 * secret can never survive by sitting past the truncation boundary.
 *
 * A dependency-free JS subset of yellow-core's canonical `cs_redact_secrets`
 * (lib/compound-staging.sh), narrowed to what `gh`/`git` can realistically
 * emit: git echoes remote URLs verbatim in error messages, and a remote
 * configured as `https://user:ghp_xxx@github.com/...` therefore leaks a live
 * token into stderr on any push/fetch failure. `gh` can likewise surface
 * Authorization headers in verbose/error paths. This runtime cannot source
 * the shell helper (it is dependency-free CJS by contract), so the patterns
 * are replicated here; keep them in sync with the shell version's
 * corresponding rules when either changes.
 *
 * Bounded-output limits are NOT a substitute for this: truncation caps
 * volume, not disclosure.
 */
const REDACTIONS = Object.freeze([
  // Credential-bearing URLs — the highest-likelihood vector for git/gh output.
  [/(https?):\/\/[^:\s/]+:[^@\s]+@/g, '$1://[REDACTED:basic-auth]@'],
  [/ghp_[A-Za-z0-9_]{36,255}/g, '[REDACTED:github-token]'],
  [/ghs_[A-Za-z0-9_]{36,255}/g, '[REDACTED:github-token]'],
  [/gho_[A-Za-z0-9_]{36,255}/g, '[REDACTED:github-token]'],
  [/github_pat_[A-Za-z0-9_]{22,255}/g, '[REDACTED:github-pat]'],
  [/Bearer\s+[A-Za-z0-9._-]{20,}/g, 'Bearer [REDACTED]'],
  [/eyJ[A-Za-z0-9_-]{10,500}\.eyJ[A-Za-z0-9_-]{10,500}\.[A-Za-z0-9_-]{10,500}/g, '[REDACTED:jwt]'],
  // Query-string credentials (e.g. a clone URL carrying ?token=...).
  [/([?&])(token|api_key|secret|key|password)=[^&\s]*/gi, '$1$2=[REDACTED:url-param]'],
]);

/** Apply every redaction rule. Pure; safe on empty input. */
function redact(text) {
  let out = text;
  for (const [pattern, replacement] of REDACTIONS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Redact credentials, then truncate to MAX_OUTPUT_CHARS, reporting
 * truncation honestly. Redaction runs FIRST so `totalChars` and the
 * truncation boundary are both computed over already-safe text.
 */
function bound(rawText) {
  const text = redact(rawText);
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

/** Hosts that are github.com itself (go-gh treats ssh.github.com as github.com). */
const GITHUB_HOSTS = Object.freeze(['github.com', 'www.github.com', 'ssh.github.com']);

/**
 * Host and `owner/repo` (lower-cased) of a remote URL, or null. Takes scheme
 * URLs with any user or port (`https://x@github.com/o/r`,
 * `ssh://git@github.com:22/o/r.git`) and scp-style `[user@]host:o/r`.
 */
function splitRemoteUrl(url) {
  let host;
  let path;
  let ssh;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(url)) {
    try {
      const parsed = new URL(url);
      host = parsed.hostname;
      path = parsed.pathname;
      ssh = /^(?:ssh|git\+ssh|ssh\+git):$/i.test(parsed.protocol);
    } catch {
      return null;
    }
  } else {
    const scp = /^(?:[^@/:]+@)?([^/:]+):(.+)$/.exec(url);
    if (!scp) return null;
    host = scp[1];
    path = scp[2];
    ssh = true;
  }
  const match = /^\/?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(path);
  if (!host || !match) return null;
  return { host: host.toLowerCase(), repository: `${match[1]}/${match[2]}`.toLowerCase(), ssh };
}

/** `owner/repo` (lower-cased) of a github.com URL, or null. */
function githubRepoOfUrl(url) {
  const split = splitRemoteUrl(url);
  return split && GITHUB_HOSTS.includes(split.host) ? split.repository : null;
}

/**
 * The real host behind an SSH host alias (`Host work` / `HostName github.com`
 * in ~/.ssh/config), read with `ssh -G` as go-gh's translator does. Falls
 * back to the alias itself.
 */
function sshHostName(alias) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(alias)) return alias;
  const resolved = run('ssh', ['-G', alias]);
  if (!resolved.ok || resolved.code !== 0) return alias;
  const line = /^hostname\s+(\S+)\s*$/im.exec(resolved.stdout);
  return line ? line[1].toLowerCase() : alias;
}

/**
 * The repository a remote URL names: `owner/repo` on github.com, or
 * `host/owner/repo` on any other host (which gh may know as an enterprise
 * host). SSH host aliases are resolved first.
 */
function remoteRepository(url) {
  const split = splitRemoteUrl(url);
  if (!split) return null;
  // go-gh translates every SSH remote, github.com included (`Host github.com`
  // can point elsewhere).
  const host = split.ssh ? sshHostName(split.host) : split.host;
  return GITHUB_HOSTS.includes(host) ? split.repository : `${host}/${split.repository}`;
}

/** gh's configuration directory, found the way go-gh `config.ConfigDir()` finds it. */
function ghConfigDir() {
  if (process.env.GH_CONFIG_DIR) return process.env.GH_CONFIG_DIR;
  if (process.env.XDG_CONFIG_HOME) return path.join(process.env.XDG_CONFIG_HOME, 'gh');
  if (process.platform === 'win32' && process.env.AppData) return path.join(process.env.AppData, 'GitHub CLI');
  return path.join(os.homedir(), '.config', 'gh');
}

/**
 * The host gh gives a hostless `OWNER/REPO`, worked out like go-gh
 * `auth.DefaultHost()`: `GH_HOST` when set, else the only host in gh's
 * `hosts.yml` when it lists exactly one, else github.com. Only the top-level
 * keys of `hosts.yml` are read; a line this cannot read fails closed.
 * @returns {{ ok: true, host: string } | { ok: false, reason: string }}
 */
function ghDefaultHost() {
  const fromEnv = (process.env.GH_HOST || '').trim();
  if (fromEnv) return { ok: true, host: fromEnv.toLowerCase() };
  const file = path.join(ghConfigDir(), 'hosts.yml');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return { ok: true, host: 'github.com' };
    return { ok: false, reason: `gh's hosts file ${file} could not be read, so the host of a hostless GH_REPO is unknown` };
  }
  const hosts = [];
  for (const line of text.split(/\r?\n/)) {
    // Comments, blank lines and indented lines (a host's own settings).
    if (/^\s*(?:#.*)?$/.test(line) || /^\s/.test(line)) continue;
    const key = /^(?:"([^"]+)"|'([^']+)'|([^\s"'#:][^:]*?))\s*:\s*(?:#.*)?$/.exec(line);
    if (!key) {
      return { ok: false, reason: `gh's hosts file ${file} has a line this runtime cannot read, so the host of a hostless GH_REPO is unknown` };
    }
    hosts.push((key[1] || key[2] || key[3]).trim().toLowerCase());
  }
  return { ok: true, host: hosts.length === 1 ? hosts[0] : 'github.com' };
}

/** go-gh's remote ranking: upstream, then github, then origin, then the rest. */
function remoteRank(name) {
  return { upstream: 3, github: 2, origin: 1 }[name.toLowerCase()] || 0;
}

/**
 * The repository `gh stack` acts on, worked out the way gh-stack 0.3.0 does
 * it (go-gh `repository.Current()`): `GH_REPO` when set; otherwise the
 * github.com remotes ranked upstream, github, origin, then the rest, where a
 * remote marked by `gh repo set-default` (`remote.<name>.gh-resolved`) wins.
 *
 * Fails closed whenever that could name more than one repository: two
 * top-ranked remotes for different repositories (go-gh's sort is not
 * stable), or a set-default mark that disagrees with the ranking (older
 * go-gh releases ignore the mark). Remotes on other hosts still take part
 * in the ranking, since gh may know that host; when one wins, it refuses,
 * because only github.com is understood.
 * @returns {{ ok: true, repository: string, source: string } | { ok: false, reason: string }}
 */
function stackRepository() {
  const override = (process.env.GH_REPO || '').trim();
  if (override) {
    // go-gh reads a URL like a remote (a `.git` suffix is dropped) and
    // `[HOST/]OWNER/REPO` literally, so `o/r.git` names repository `r.git`.
    let repository = null;
    if (override.includes('://')) {
      repository = githubRepoOfUrl(override);
    } else {
      const match = /^(?:([^/\s]+)\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(override);
      // A hostless override uses gh's default host, as gh does.
      let host = '';
      if (match && match[1]) {
        host = match[1];
      } else if (match) {
        const fallback = ghDefaultHost();
        if (!fallback.ok) return { ok: false, reason: fallback.reason };
        host = fallback.host;
      }
      if (match && host.toLowerCase() === 'github.com') {
        repository = `${match[2]}/${match[3]}`.toLowerCase();
      }
    }
    if (repository === null) {
      return { ok: false, reason: `GH_REPO is "${override}", which is not a github.com repository this runtime can read` };
    }
    return { ok: true, repository, source: 'GH_REPO' };
  }
  // `git remote -v` prints each remote's effective fetch URL, with any
  // `url.<base>.insteadOf` rewrite applied, as go-gh reads it.
  const listed = run('git', ['remote', '-v']);
  if (!listed.ok || listed.code !== 0) {
    return { ok: false, reason: 'no git remote of this clone could be read' };
  }
  // go-gh reads a remote's identity from its fetch URL and falls back to
  // its push URL when the fetch URL names no repository (a local mirror).
  const urls = new Map();
  for (const line of listed.stdout.split('\n')) {
    // A partial clone adds a filter after the kind: `(fetch) [blob:none]`.
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)(?:\s+\[[^\]]*\])?\s*$/.exec(line.trim());
    if (!match) continue;
    if (!urls.has(match[1])) urls.set(match[1], {});
    const entry = urls.get(match[1]);
    // First fetch URL, last push URL: go-gh overwrites the push URL per row.
    if (match[3] === 'push' || entry.fetch === undefined) entry[match[3]] = match[2];
  }
  const remotes = new Map();
  for (const [name, entry] of urls) {
    const fetched = entry.fetch === undefined ? null : remoteRepository(entry.fetch);
    const repository = fetched !== null || entry.push === undefined ? fetched : remoteRepository(entry.push);
    remotes.set(name, { name, repository, resolved: null });
  }
  // Exit 1 means no remote is marked; anything else is unreadable.
  const marks = run('git', ['config', '--get-regexp', '^remote\\..*\\.gh-resolved$']);
  if (!marks.ok || (marks.code !== 0 && marks.code !== 1)) {
    return { ok: false, reason: 'the gh repo set-default marks of this clone could not be read' };
  }
  for (const line of marks.code === 0 ? marks.stdout.split('\n') : []) {
    const match = /^remote\.(.+)\.gh-resolved\s+(\S+)/.exec(line.trim());
    if (match && remotes.has(match[1])) remotes.get(match[1]).resolved = match[2];
  }
  const candidates = [...remotes.values()].filter((remote) => remote.repository !== null);
  if (candidates.length === 0) {
    return { ok: false, reason: 'no git remote of this clone names a repository' };
  }
  const top = Math.max(...candidates.map((remote) => remoteRank(remote.name)));
  const ranked = new Set(candidates.filter((remote) => remoteRank(remote.name) === top).map((remote) => remote.repository));
  const marked = new Set();
  for (const remote of candidates) {
    if (remote.resolved === null) continue;
    if (remote.resolved === 'base') {
      marked.add(remote.repository);
    } else {
      const named = /^(?:github\.com\/)?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/i.exec(remote.resolved);
      marked.add(named ? named[1].toLowerCase() : `unreadable:${remote.resolved}`);
    }
  }
  const choices = new Set([...ranked, ...marked]);
  if (choices.size !== 1) {
    return {
      ok: false,
      reason: `the remotes of this clone could point gh stack at more than one repository (${[...choices].join(', ')}); set GH_REPO to the one you mean`,
    };
  }
  const [repository] = [...choices];
  if (repository.split('/').length !== 2) {
    // gh may know that host (an enterprise server, or GH_HOST); this runtime
    // only understands github.com, so it never guesses past it.
    return {
      ok: false,
      reason: `gh stack would act on ${repository}, which is not on github.com; set GH_REPO to the github.com repository you mean`,
    };
  }
  return { ok: true, repository, source: marked.size > 0 ? 'gh repo set-default' : 'git remotes' };
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
  SPAWN_FAILURE:
    'The subprocess did not finish (timed out or failed to start). The operation may have partially applied — inspect repository state before retrying.',
  ERROR: 'The command failed; see stderr for the printed error.',
  SYNC_ABORTED: 'Sync detected a divergence it cannot resolve non-interactively and made no changes. Re-run in an interactive terminal, or import the remote stack explicitly.',
  INCOMPLETE:
    'gh-stack exited 0 but reported that a step failed (see stderr). Branches may have been pushed without their pull requests being created, updated or linked. Check each pull request on GitHub before retrying; do not report the stack as submitted or synchronized.',
  BASE_CHANGE_UNCONFIRMED:
    'GitHub retargeted this stack to a new base and the old base did not merge, so the stack was not rebased. Rebasing onto the new base drops the old base\'s commits from the stack. Show the user that, then re-run with acceptBaseChange and confirm: true.',
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
  let status;
  if (!execResult.ok) {
    status = 'SPAWN_FAILURE';
  } else if (/rerun with --accept-base-change/.test(`${execResult.stdout}\n${execResult.stderr}`)) {
    // gh-stack 0.3.0 leaves the stack un-rebased when GitHub retargeted its
    // base and the old base never merged. Whatever the exit code, the stack
    // is not synchronized, so this must never report SUCCESS.
    status = 'BASE_CHANGE_UNCONFIRMED';
  } else if (
    syncAbortCheck &&
    execResult.code === 0 &&
    /Sync aborted/.test(`${execResult.stdout}\n${execResult.stderr}`)
  ) {
    // Exit 0 with "Sync aborted" is UNRESOLVED, not success — the
    // CLI's own exit code cannot distinguish "sync completed" from "sync
    // silently declined to act" (source-verified, see cmd/utils.go
    // resolveStackDivergence). Checked BEFORE the exit-code map so a
    // literal 0 never reports SUCCESS in this specific case. Both streams
    // are searched: gh-stack 0.3.0 writes its progress to stderr.
    status = 'SYNC_ABORTED';
  } else if (execResult.code === 0 && /^\s*⚠ failed to /m.test(execResult.stderr)) {
    // gh-stack 0.3.0 exits 0 when a GitHub call inside submit/sync/push
    // fails (seen live: every pull request lookup returned 403, the branches
    // were pushed, no pull request was opened, exit 0). A warning that a
    // step failed means the operation is not known to be complete.
    status = 'INCOMPLETE';
  } else {
    status = EXIT_STATUS[execResult.code] || 'UNKNOWN_ERROR';
  }
  return buildResult({ op, bin, args, execResult, status, recoveryAction: RECOVERY_ACTIONS[status] || null, mayHaveMutated });
}

/**
 * Shape a `gh api` call (merge-single). gh-stack's exit codes and progress
 * text say nothing about it, so the caller decides `status` from what the
 * API answered, and may give a recovery text that fits that call better
 * than the generic one for the status.
 * @param {{
 *   op: string,
 *   args: string[],
 *   execResult: { ok: boolean, code: number|null, stdout: string, stderr: string },
 *   mayHaveMutated: boolean,
 *   status: string,
 *   recoveryAction?: string,
 * }} input
 */
function shapeApiResult({ op, args, execResult, mayHaveMutated, status, recoveryAction }) {
  const finalStatus = execResult.ok ? status : 'SPAWN_FAILURE';
  return buildResult({
    op,
    bin: 'gh',
    args,
    execResult,
    status: finalStatus,
    recoveryAction: (execResult.ok && recoveryAction) || RECOVERY_ACTIONS[finalStatus] || null,
    mayHaveMutated,
  });
}

/** The result object every executed command returns, output redacted and bounded. */
function buildResult({ op, bin, args, execResult, status, recoveryAction, mayHaveMutated }) {
  const stdout = bound(execResult.stdout);
  const stderr = bound(execResult.stderr);
  // Arguments are redacted too, not just subprocess output. A validated
  // argument can still CARRY credential material — a commit message that
  // quotes a token (`add --message "...ghp_..."`), or a remote/URL value —
  // and `command.args` + `safeSummary` are serialized into model context
  // verbatim by every caller. Redacting only stdout/stderr would leave the
  // documented guarantee half-true.
  const safeArgs = args.map(redact);
  return {
    operation: op,
    command: { bin, args: safeArgs },
    exitCode: execResult.ok ? execResult.code : null,
    status,
    safeSummary: `${bin} ${safeArgs.join(' ')} -> ${status}`,
    stdout: stdout.text,
    stdoutTruncated: stdout.truncated,
    stdoutTotalChars: stdout.totalChars,
    stderr: stderr.text,
    stderrTruncated: stderr.truncated,
    stderrTotalChars: stderr.totalChars,
    recoveryAction,
    mayHaveMutated,
  };
}

function refusalResult(op, rawReason) {
  // Refusal reasons interpolate the rejected value verbatim, so they carry
  // the same credential-leak risk as command.args (see shapeResult).
  const reason = redact(rawReason);
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

function confirmationRequiredResult(op, rawDetail) {
  // Same reasoning as refusalResult: the detail string quotes caller values.
  const detail = redact(rawDetail);
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

/**
 * Read-only. Always `--json`, never bare `view`. With `repository`, the
 * child runs with `GH_REPO=github.com/<repository>`, so a merge preview
 * reads the stack from the repository the confirmed merge is pinned to.
 */
function view({ repository } = {}) {
  if (repository !== undefined && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    return refusalResult('view', `repository must be OWNER/REPO, got "${repository}"`);
  }
  const args = ['stack', 'view', '--json'];
  const execResult =
    repository === undefined ? run('gh', args) : run('gh', args, { GH_REPO: `github.com/${repository.toLowerCase()}` });
  return shapeResult({ op: 'view', bin: 'gh', args, execResult, mayHaveMutated: false });
}

/**
 * Whether `refs/heads/<name>` exists locally: true, false (git's own
 * "not found" exit 1), or null when the lookup itself failed.
 */
function localBranchExists(name) {
  const result = run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]);
  if (!result.ok) return null;
  if (result.code === 0) return true;
  return result.code === 1 ? false : null;
}

/**
 * `gh stack init -b <base> <branch> [<branch> ...]` — base and branches are
 * explicit, never omitted. One branch starts a stack. Several branches,
 * bottom to top, adopt existing branches into one (this is how a stack built
 * with another tool is taken over without recreating its branches or PRs).
 *
 * gh-stack 0.3.0 accepts existing branches in any order and only marks the
 * result as needing a rebase. That rebase would rewrite the branches to fit
 * the order given, so a wrong order is refused here: each existing branch
 * must contain the existing branch below it.
 */
function init({ base, branch, branches }) {
  const baseCheck = validateBranchName(base);
  if (!baseCheck.ok) return refusalResult('init', `base: ${baseCheck.reason}`);
  const requested = Array.isArray(branches) && branches.length > 0 ? branches : [branch];
  const names = [];
  for (const candidate of requested) {
    const branchCheck = validateBranchName(candidate);
    if (!branchCheck.ok) return refusalResult('init', `branch: ${branchCheck.reason}`);
    if (names.includes(branchCheck.value)) {
      return refusalResult('init', `branch "${branchCheck.value}" is listed twice`);
    }
    if (branchCheck.value === baseCheck.value) {
      return refusalResult('init', `branch "${branchCheck.value}" is the base branch`);
    }
    names.push(branchCheck.value);
  }
  if (names.length > 1) {
    let below = null;
    for (const name of names) {
      // gh-stack creates a branch that does not exist yet; only existing
      // branches carry an order that can be wrong.
      const exists = localBranchExists(name);
      if (exists === null) {
        return refusalResult('init', `could not check whether branch "${name}" exists`);
      }
      if (!exists) continue;
      if (below !== null) {
        const ancestry = run('git', ['merge-base', '--is-ancestor', `refs/heads/${below}`, `refs/heads/${name}`]);
        if (!ancestry.ok || (ancestry.code !== 0 && ancestry.code !== 1)) {
          return refusalResult('init', `could not check that "${name}" contains "${below}"`);
        }
        if (ancestry.code === 1) {
          return refusalResult(
            'init',
            `"${name}" does not contain "${below}", so these branches are not a stack in this order (list them bottom to top, or rebase them first)`
          );
        }
      }
      below = name;
    }
  }
  const args = ['stack', 'init', '-b', baseCheck.value, ...names];
  const execResult = run('gh', args);
  return shapeResult({ op: 'init', bin: 'gh', args, execResult, mayHaveMutated: true });
}

/**
 * `gh stack add -m <message> <branch>` — branch is always explicit. `add` is
 * a local operation and takes no `--remote` (gh-stack 0.3.0 rejects the flag
 * as unknown), so no remote is resolved here.
 */
function add({ branch, message }) {
  const branchCheck = validateBranchName(branch);
  if (!branchCheck.ok) return refusalResult('add', branchCheck.reason);
  if (typeof message !== 'string' || message.trim().length === 0) {
    return refusalResult('add', 'a non-empty commit message is required');
  }
  const args = ['stack', 'add', '-m', message, branchCheck.value];
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

const ACCEPT_BASE_CHANGE_DETAIL =
  '--accept-base-change rebases the stack onto a base GitHub retargeted it to and drops the old base\'s unmerged commits from the stack';

/**
 * `gh stack rebase` — exactly one of upstack/downstack/continue/abort.
 * `modify` is NEVER used (TUI-only); this is the only rebase-family entry
 * point this runtime exposes.
 */
function rebase({ mode, remote, acceptBaseChange, confirm }) {
  const modeCheck = validateEnum(mode, ['upstack', 'downstack', 'continue', 'abort'], 'mode');
  if (!modeCheck.ok) return refusalResult('rebase', modeCheck.reason);
  const starts = mode === 'upstack' || mode === 'downstack';
  if (acceptBaseChange && !starts) {
    return refusalResult('rebase', 'acceptBaseChange applies only when a rebase starts (upstack or downstack)');
  }
  if (acceptBaseChange && confirm !== true) {
    return confirmationRequiredResult('rebase', ACCEPT_BASE_CHANGE_DETAIL);
  }
  const args = ['stack', 'rebase', `--${mode}`];
  if (starts) {
    const remoteResult = resolveRemote(remote);
    if (!remoteResult.ok) return refusalResult('rebase', remoteResult.reason);
    if (remoteResult.remote) args.push('--remote', remoteResult.remote);
    if (acceptBaseChange) args.push('--accept-base-change');
  }
  const execResult = run('gh', args);
  return shapeResult({ op: 'rebase', bin: 'gh', args, execResult, mayHaveMutated: true });
}

/**
 * `gh stack sync [--remote <r>] [--prune]`. `--prune` requires
 * `confirm: true` — it removes local branches. The exit-0-"Sync aborted"
 * case is checked in `shapeResult` (`syncAbortCheck: true`).
 */
function sync({ remote, prune, acceptBaseChange, confirm }) {
  if (prune && confirm !== true) {
    return confirmationRequiredResult('sync', 'sync --prune removes local branches for merged PRs');
  }
  if (acceptBaseChange && confirm !== true) {
    return confirmationRequiredResult('sync', ACCEPT_BASE_CHANGE_DETAIL);
  }
  const remoteResult = resolveRemote(remote);
  if (!remoteResult.ok) return refusalResult('sync', remoteResult.reason);
  const args = ['stack', 'sync'];
  if (remoteResult.remote) args.push('--remote', remoteResult.remote);
  if (prune) args.push('--prune');
  if (acceptBaseChange) args.push('--accept-base-change');
  const execResult = run('gh', args);
  return shapeResult({ op: 'sync', bin: 'gh', args, execResult, mayHaveMutated: true, syncAbortCheck: true });
}

/**
 * `gh stack push [--remote <r>]` — pushes every active branch of the stack in
 * one atomic `--force-with-lease` push. Creates and updates no pull request;
 * this is the step after a local `rebase` (upstream: "To push up your
 * changes, run `gh stack push`"). `--no-atomic` is never passed: a partial
 * push leaves pull requests pointing at a half-rebased stack.
 */
function push({ remote }) {
  const remoteResult = resolveRemote(remote);
  if (!remoteResult.ok) return refusalResult('push', remoteResult.reason);
  const args = ['stack', 'push'];
  if (remoteResult.remote) args.push('--remote', remoteResult.remote);
  const execResult = run('gh', args);
  return shapeResult({ op: 'push', bin: 'gh', args, execResult, mayHaveMutated: true });
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
 * A `gh api` read. `notFound` tells a 404 (gh prints `HTTP 404` on stderr)
 * from every other failure.
 * @param {string[]} args
 * @returns {{ ok: true, json: unknown, args: string[], execResult: object } | { ok: false, notFound: boolean, unreadable: boolean, args: string[], execResult: object }}
 */
function apiRead(args) {
  const execResult = run('gh', args);
  if (execResult.ok && execResult.code === 0) {
    try {
      return { ok: true, json: JSON.parse(execResult.stdout), args, execResult };
    } catch {
      return { ok: false, notFound: false, unreadable: true, args, execResult };
    }
  }
  const notFound = execResult.ok && /\bHTTP 404\b/.test(execResult.stderr);
  return { ok: false, notFound, unreadable: false, args, execResult };
}

/**
 * A stack as the Stacks REST API returns it (the shape gh-stack 0.3.0
 * decodes into `RemoteStack`), or null when it is not that shape.
 * @returns {{ number: number, baseRef: string, pullRequests: Array<{ number: number, state: string, draft: boolean, merged: boolean, headRef: string, headSha: string }> } | null}
 */
function readRemoteStack(json) {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return null;
  if (!Number.isInteger(json.number) || !json.base || typeof json.base.ref !== 'string' || !Array.isArray(json.pull_requests)) {
    return null;
  }
  const pullRequests = [];
  for (const pr of json.pull_requests) {
    if (
      pr === null ||
      typeof pr !== 'object' ||
      !Number.isInteger(pr.number) ||
      typeof pr.state !== 'string' ||
      typeof pr.draft !== 'boolean' ||
      !(pr.merged_at === null || pr.merged_at === undefined || typeof pr.merged_at === 'string') ||
      !pr.head ||
      typeof pr.head.ref !== 'string' ||
      typeof pr.head.sha !== 'string'
    ) {
      return null;
    }
    pullRequests.push({
      number: pr.number,
      state: pr.state,
      draft: pr.draft,
      merged: typeof pr.merged_at === 'string' && pr.merged_at !== '',
      headRef: pr.head.ref,
      headSha: pr.head.sha,
    });
  }
  return { number: json.number, baseRef: json.base.ref, pullRequests };
}

/**
 * What `gh stack merge <number> --yes` lands, worked out from the remote
 * stack the way gh-stack 0.3.0 does it (`mergeCandidates`, `numbersUpTo`):
 * merged pull requests at the bottom are skipped, the first draft or closed
 * one blocks everything above it, and the set runs from the bottom up to the
 * target (or the whole open run for a stack number).
 * @returns {{ set: object[] } | { reason: string }}
 */
function landingSetOf(stack, targetKind, number) {
  const candidates = [];
  let blocker = null;
  for (const pr of stack.pullRequests) {
    if (pr.merged) continue;
    if (pr.draft || pr.state === 'closed') {
      blocker = pr;
      break;
    }
    candidates.push(pr);
  }
  const blocked = (pr) => `#${pr.number} is ${pr.draft ? 'a draft' : 'closed'}`;
  if (targetKind === 'stack') {
    if (blocker) return { reason: `stack #${stack.number} cannot be merged whole: pull request ${blocked(blocker)}` };
    if (candidates.length === 0) return { reason: `stack #${stack.number} has no open pull request to merge` };
    return { set: candidates };
  }
  const index = candidates.findIndex((pr) => pr.number === number);
  if (index >= 0) return { set: candidates.slice(0, index + 1) };
  const pr = stack.pullRequests.find((entry) => entry.number === number);
  if (!pr) return { reason: `pull request #${number} is not part of stack #${stack.number}` };
  if (pr.merged) return { reason: `pull request #${number} is already merged` };
  if (pr.draft || pr.state === 'closed') return { reason: `pull request ${blocked(pr)}` };
  return { reason: `pull request #${number} cannot be merged yet: pull request ${blocked(blocker)} below it` };
}

/**
 * Read from GitHub what `gh stack merge <number>` would land in
 * `repository`, the way gh-stack reads it: `number` is tried as a stack
 * number first, then as a pull request number. Never reads the local stack
 * file, so a branch that exists only on GitHub is in the set.
 * @returns {{ landing: { targetKind: string, stackNumber: number, baseRef: string, set: object[] } } | { result: object }}
 */
function readLandingSet(op, repository, number) {
  const unreadable = (read) =>
    shapeApiResult({
      op,
      args: read.args,
      execResult: read.execResult,
      mayHaveMutated: false,
      status: read.unreadable ? 'ERROR' : 'API_FAILURE',
      recoveryAction: read.unreadable
        ? "GitHub's answer for the stack could not be read; nothing was merged."
        : 'Reading the stack from GitHub failed; nothing was merged. Check `gh auth status` and network access, then preview again.',
    });
  const byStack = apiRead(['api', '--hostname', 'github.com', `repos/${repository}/stacks/${number}`]);
  let targetKind = 'stack';
  let json;
  let source = byStack;
  if (byStack.ok) {
    json = byStack.json;
  } else if (!byStack.notFound) {
    return { result: unreadable(byStack) };
  } else {
    targetKind = 'pull-request';
    const byPr = apiRead(['api', '--hostname', 'github.com', `repos/${repository}/stacks?pull_request=${number}`]);
    if (!byPr.ok) {
      if (!byPr.notFound) return { result: unreadable(byPr) };
      return {
        result: {
          ...refusalResult(op, `stacked pull requests are not available in ${repository}; nothing was merged`),
          status: 'STACKS_UNAVAILABLE',
          recoveryAction: RECOVERY_ACTIONS.STACKS_UNAVAILABLE,
        },
      };
    }
    if (!Array.isArray(byPr.json)) return { result: unreadable({ ...byPr, unreadable: true }) };
    if (byPr.json.length === 0) {
      return {
        result: {
          ...refusalResult(op, `#${number} in ${repository} is neither a stack number nor a pull request in a stack; nothing was merged`),
          status: 'NOT_IN_STACK',
          recoveryAction: 'An ordinary pull request lands through the merge-single operation, not through merge.',
        },
      };
    }
    json = byPr.json[0];
    source = byPr;
  }
  const stack = readRemoteStack(json);
  if (stack === null) return { result: unreadable({ ...source, unreadable: true }) };
  const landing = landingSetOf(stack, targetKind, Number(number));
  if (landing.reason) return { result: refusalResult(op, `${landing.reason} in ${repository}; nothing was merged`) };
  return { landing: { targetKind, stackNumber: stack.number, baseRef: stack.baseRef, set: landing.set } };
}

/**
 * A fingerprint of what a `merge` preview showed: the repository, the
 * target, the stack, its base, every pull request that lands with its head
 * commit, and the merge method.
 * @returns {string} 64 hexadecimal characters
 */
function mergePreviewTokenOf(repository, number, landing, mergeMethod) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        repository,
        number,
        landing.targetKind,
        landing.stackNumber,
        landing.baseRef,
        landing.set.map((pr) => [pr.number, pr.headRef, pr.headSha]),
        mergeMethod || '',
      ])
    )
    .digest('hex');
}

/** A github.com pull-request URL, capturing its number. */
const PR_URL_RE = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)\/?$/;

/**
 * `gh stack merge <number> --yes [--merge-method <m>]`. Requires an
 * explicit target AND `confirm: true` — this lands code. Never `gh pr
 * merge` for a stack.
 *
 * The merge is atomic and covers every unmerged pull request BELOW the
 * target as well as the target itself. gh-stack picks that set from the
 * stack on GitHub, not from the local stack file, so the preview reads the
 * same remote stack (`readLandingSet`) and reports it as `landingSet`; a
 * branch that exists only on GitHub is in it. gh-stack 0.3.0 accepts only a
 * stack number or a pull request number here (a URL exits 5), so a
 * pull-request URL is reduced to its number before it reaches argv.
 *
 * A number means nothing without its repository, so `stackRepository()`
 * works out where gh-stack would merge it. The preview names that
 * repository and returns a `previewToken`. A confirmed merge needs both
 * back: the repository must still be the one gh-stack resolves, and the
 * set, its head commits, the base and the method must still match the
 * token when the stack is read again just before merging.
 */
function merge({ target, mergeMethod, repository, previewToken, confirm }) {
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
  const urlMatch = PR_URL_RE.exec(target);
  const number = urlMatch ? urlMatch[3] : target;
  if (!/^[1-9][0-9]*$/.test(number)) {
    return refusalResult(
      'merge',
      `target "${target}" is neither a positive integer (PR/stack number) nor a github.com pull request URL`
    );
  }
  if (repository !== undefined && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    return refusalResult('merge', `repository must be OWNER/REPO, got "${repository}"`);
  }
  if (mergeMethod !== undefined) {
    const methodCheck = validateEnum(mergeMethod, MERGE_METHODS, 'mergeMethod');
    if (!methodCheck.ok) return refusalResult('merge', methodCheck.reason);
  }
  if (previewToken !== undefined && !/^[0-9a-f]{64}$/.test(previewToken)) {
    return refusalResult('merge', 'previewToken must be the 64 hexadecimal characters a preview reported');
  }
  // A number lands in whichever repository gh-stack resolves, so that
  // repository is worked out first, named in the confirmation, and must
  // match a URL's repository and the one the caller confirmed.
  const resolved = stackRepository();
  if (!resolved.ok) {
    return refusalResult('merge', `could not tell which repository gh stack would merge in: ${resolved.reason}`);
  }
  const where = resolved.repository;
  if (urlMatch) {
    const wanted = `${urlMatch[1]}/${urlMatch[2]}`.toLowerCase();
    if (wanted !== where) {
      return refusalResult(
        'merge',
        `target "${target}" is a pull request in ${wanted}, but gh stack would merge #${number} in ${where} (from ${resolved.source}); its number would land a different pull request`
      );
    }
  }
  if (repository !== undefined && repository.toLowerCase() !== where) {
    return refusalResult(
      'merge',
      `the merge was confirmed for ${repository.toLowerCase()}, but gh stack would merge in ${where} (from ${resolved.source}) now; nothing was merged`
    );
  }
  if (confirm === true && (repository === undefined || previewToken === undefined)) {
    return refusalResult(
      'merge',
      'confirm needs repository and previewToken: run once without confirm, show what it reports, then pass both back'
    );
  }
  const read = readLandingSet('merge', where, number);
  if (read.result) return { ...read.result, repository: where };
  const { landing } = read;
  const currentToken = mergePreviewTokenOf(where, number, landing, mergeMethod);
  const numbers = landing.set.map((pr) => `#${pr.number}`).join(', ');
  if (confirm !== true) {
    const what =
      landing.targetKind === 'stack'
        ? `stack #${landing.stackNumber}, every open pull request in it`
        : 'that pull request and every unmerged pull request below it in the stack';
    return {
      ...confirmationRequiredResult(
        'merge',
        `merge target "${number}" in ${where} (from ${resolved.source}) lands ${what} (${numbers}, bottom first, into ${landing.baseRef}), and cannot be undone by this runtime; re-run with repository ${where}, previewToken ${currentToken} and confirm`
      ),
      repository: where,
      targetKind: landing.targetKind,
      stackNumber: landing.stackNumber,
      baseRef: redact(landing.baseRef),
      landingSet: landing.set.map((pr) => ({ number: pr.number, headRef: redact(pr.headRef), headSha: redact(pr.headSha) })),
      previewToken: currentToken,
    };
  }
  if (previewToken !== currentToken) {
    return {
      ...refusalResult(
        'merge',
        `the confirmation does not match the stack on GitHub now (${numbers} into ${landing.baseRef} in ${where}): a pull request, head commit, base or the method changed since the preview. Nothing was merged. Preview again and ask again`
      ),
      repository: where,
    };
  }
  const args = ['stack', 'merge', number, '--yes'];
  if (mergeMethod !== undefined) args.push('--merge-method', mergeMethod);
  // Pin the child to the repository that was checked and confirmed, so a
  // remote changed in between cannot move the merge somewhere else.
  const execResult = run('gh', args, { GH_REPO: `github.com/${where}` });
  return { ...shapeResult({ op: 'merge', bin: 'gh', args, execResult, mayHaveMutated: true }), repository: where };
}

/**
 * Read pull request `target` from GitHub for `merge-single` and decide
 * whether it is an ordinary one that may be landed on its own.
 *
 * A pull request is refused as stacked when its own answer carries a
 * `stack` object OR the Stacks API lists a stack for it, so the bottom
 * layer of a stack cannot pass if one of the two leaves it out. A pull
 * request based on a branch other than the default branch passes only when
 * the caller names that branch as `base` (a release or hotfix branch) and
 * no open pull request has that branch as its head (which would make this
 * pull request a layer of a chain).
 * @param {string} op
 * @param {string} target a validated pull request number
 * @param {string|undefined} namedBase a non-default base branch the caller named
 * @returns {{ result: object } | { pullRequest: { number: number, repository: string, baseRef: string, headRef: string, headRepository: string, headSha: string } }}
 *   `result` is the finished refusal or lookup failure.
 */
function readOrdinaryPullRequest(op, target, namedBase) {
  const lookupArgs = ['api', `repos/{owner}/{repo}/pulls/${target}`];
  const lookup = run('gh', lookupArgs);
  if (!lookup.ok || lookup.code !== 0) {
    return {
      result: shapeApiResult({ op, args: lookupArgs, execResult: lookup, mayHaveMutated: false, status: 'API_FAILURE' }),
    };
  }
  let pr;
  try {
    pr = JSON.parse(lookup.stdout);
  } catch {
    pr = null;
  }
  const text = (value) => (typeof value === 'string' ? value : '');
  const head = (pr && pr.head) || {};
  const base = (pr && pr.base) || {};
  const repo = base.repo || {};
  const found = {
    number: Number(target),
    repository: text(repo.full_name),
    baseRef: text(base.ref),
    headRef: text(head.ref),
    // Where the head branch lives: the same repository, a fork, or '' when
    // the fork was deleted. A head branch name says nothing about ownership
    // unless it lives in this repository.
    headRepository: text((head.repo || {}).full_name),
    headSha: text(head.sha),
  };
  const defaultBranch = text(repo.default_branch);
  const readable =
    pr !== null &&
    typeof pr === 'object' &&
    String(pr.number) === target &&
    SHA_RE.test(found.headSha) &&
    typeof pr.draft === 'boolean' &&
    [found.repository, found.baseRef, found.headRef, defaultBranch].every(Boolean);
  const where = `pull request #${target} in ${found.repository}`;
  let reason = null;
  if (!readable) {
    reason = `GitHub's answer for pull request #${target} could not be read; nothing was merged`;
  } else if (pr.state !== 'open') {
    reason = `${where} is ${pr.merged ? 'already merged' : 'not open'}`;
  } else if (pr.draft) {
    reason = `${where} is a draft; mark it ready for review first`;
  } else if (pr.stack !== undefined && pr.stack !== null) {
    const stackNumber =
      typeof pr.stack === 'object' && Number.isInteger(pr.stack.number) ? ` (stack #${pr.stack.number})` : '';
    reason = `${where} belongs to a stack${stackNumber}; land it with the merge operation, which merges it together with the pull requests below it`;
  } else if (namedBase !== undefined && namedBase !== found.baseRef) {
    reason = `${where} targets "${found.baseRef}", not the base "${namedBase}" that was named`;
  } else if (found.baseRef !== defaultBranch && namedBase === undefined) {
    // A pull request based on another branch may be a layer of a stack that
    // GitHub does not report, or may target a release or hotfix branch.
    // Only the caller can tell, so it has to name that branch.
    reason = `${where} targets "${found.baseRef}", not the default branch "${defaultBranch}". If "${found.baseRef}" is a release or hotfix branch, name it as the base to land the pull request there; if it is another pull request's branch, this pull request is a layer of a stack and does not land on its own`;
  } else if (!MERGEABLE_STATES.includes(pr.mergeable_state)) {
    const state = text(pr.mergeable_state) || 'missing';
    reason =
      state === 'unknown' || state === 'missing'
        ? `GitHub has not worked out yet whether ${where} can be merged (state "${state}"); run again in a moment`
        : `GitHub reports ${where} as "${state}", not ready to merge: a required check, review, update or the merge queue is outstanding. This operation does not override that`;
  }
  if (reason) return { result: refusalResult(op, reason) };

  const failed = (read) =>
    shapeApiResult({
      op,
      args: read.args,
      execResult: read.execResult,
      mayHaveMutated: false,
      status: read.unreadable ? 'ERROR' : 'API_FAILURE',
      recoveryAction: `A check on ${where} could not be read from GitHub; nothing was merged. Preview again once GitHub answers.`,
    });
  // Second stack signal: the Stacks API. A 404 means the repository has no
  // stacked pull requests at all.
  const stacks = apiRead(['api', `repos/{owner}/{repo}/stacks?pull_request=${target}`]);
  if (!stacks.ok && !stacks.notFound) return { result: failed(stacks) };
  if (stacks.ok) {
    if (!Array.isArray(stacks.json)) return { result: failed({ ...stacks, unreadable: true }) };
    if (stacks.json.length > 0) {
      const first = stacks.json[0];
      const stackNumber = first && Number.isInteger(first.number) ? ` (stack #${first.number})` : '';
      return {
        result: refusalResult(
          op,
          `${where} belongs to a stack${stackNumber}; land it with the merge operation, which merges it together with the pull requests below it`
        ),
      };
    }
  }
  if (found.baseRef !== defaultBranch) {
    // A named base that is another open pull request's head is a chain no
    // provider registered: landing this one would merge it into that layer.
    const owner = found.repository.split('/')[0];
    const below = apiRead([
      'api',
      `repos/{owner}/{repo}/pulls?state=open&per_page=100&head=${encodeURIComponent(`${owner}:${found.baseRef}`)}`,
    ]);
    if (!below.ok) return { result: failed(below) };
    if (!Array.isArray(below.json)) return { result: failed({ ...below, unreadable: true }) };
    const layer = below.json.find((pr) => pr && Number.isInteger(pr.number));
    if (layer) {
      return {
        result: refusalResult(
          op,
          `${where} targets "${found.baseRef}", the branch of open pull request #${layer.number}, so it is a layer of a chain of pull requests; land the chain from the bottom instead`
        ),
      };
    }
  }
  return { pullRequest: found };
}

/**
 * Open pull requests based on the head branch of `pullRequest`: a chain of
 * pull requests that no provider registered as a stack. Only a head branch
 * in the repository itself can be another pull request's base.
 * @returns {{ dependents: Array<{ number: number, headRef: string }> } | { result: object }}
 */
function readDependents(op, pullRequest, headInRepository) {
  if (!headInRepository) return { dependents: [] };
  const read = apiRead([
    'api',
    `repos/{owner}/{repo}/pulls?state=open&per_page=100&base=${encodeURIComponent(pullRequest.headRef)}`,
  ]);
  if (!read.ok || !Array.isArray(read.json)) {
    return {
      result: shapeApiResult({
        op,
        args: read.args,
        execResult: read.execResult,
        mayHaveMutated: false,
        status: read.ok ? 'ERROR' : 'API_FAILURE',
        recoveryAction: 'The open pull requests based on this branch could not be read from GitHub; nothing was merged. Preview again once GitHub answers.',
      }),
    };
  }
  return {
    dependents: read.json
      .filter((pr) => pr && Number.isInteger(pr.number))
      .map((pr) => ({ number: pr.number, headRef: redact(pr.head && typeof pr.head.ref === 'string' ? pr.head.ref : '') })),
  };
}

/**
 * A fingerprint of what a `merge-single` preview showed: the repository,
 * pull request, base branch, head commit and merge method. The caller
 * passes it back to confirm, so no branch or repository name (which the
 * pull request's author chooses) ever has to be copied into a command line.
 * @param {{ number: number, repository: string, baseRef: string, headSha: string }} pullRequest
 * @param {string} mergeMethod
 * @returns {string} 64 hexadecimal characters
 */
function previewTokenOf(pullRequest, mergeMethod) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        pullRequest.repository,
        pullRequest.number,
        pullRequest.baseRef,
        pullRequest.headSha,
        mergeMethod,
      ])
    )
    .digest('hex');
}

/**
 * Land ONE ordinary pull request: one that GitHub does not report as part of
 * a stack. `gh stack merge` refuses such a pull request, and `merge` above
 * must never land a stacked one the plain way, so this is a separate
 * operation with its own gates:
 *
 * - `target` is a pull request number only, and `mergeMethod` is required;
 * - the pull request is read from GitHub first and refused when it is not
 *   open, is a draft, carries a `stack` object or is listed by the Stacks
 *   API, is based on a branch other than the default branch that the
 *   caller did not name as `base` (or that is another open pull request's
 *   head), or is not reported as mergeable;
 * - the preview also lists open pull requests based on its head branch
 *   (`dependents`): a chain no provider registered, which this does not
 *   land or retarget;
 * - without `confirm: true` nothing is merged and the result reports the
 *   head commit and base branch that were read, with a `previewToken`
 *   that fingerprints them;
 * - with `confirm: true` the caller must pass that token back. It is
 *   refused when the repository, base, head or method no longer match, and
 *   GitHub checks the head again (`sha` on the merge call), so what lands
 *   is what was shown.
 *
 * Every call is `gh api` with the `{owner}/{repo}` placeholders, so the
 * checks and the merge always address the same repository, whichever way
 * `gh` resolves it. The REST merge call would let a repository admin
 * through branch protection, so a pull request GitHub does not report as
 * mergeable (`mergeable_state`) is refused before the call. No auto-merge,
 * no branch deletion.
 */
function mergeSingle({ target, mergeMethod, base, previewToken, confirm }) {
  const op = 'merge-single';
  if (typeof target !== 'string' || !/^[1-9][0-9]*$/.test(target)) {
    return refusalResult(op, `target must be a pull request number, got "${target === undefined ? '' : target}"`);
  }
  if (mergeMethod === undefined) {
    return refusalResult(op, `mergeMethod is required: one of ${MERGE_METHODS.join(', ')}`);
  }
  const methodCheck = validateEnum(mergeMethod, MERGE_METHODS, 'mergeMethod');
  if (!methodCheck.ok) return refusalResult(op, methodCheck.reason);
  if (previewToken !== undefined && !/^[0-9a-f]{64}$/.test(previewToken)) {
    return refusalResult(op, 'previewToken must be the 64 hexadecimal characters a preview reported');
  }
  if (base !== undefined) {
    const baseCheck = validateBranchName(base);
    if (!baseCheck.ok) return refusalResult(op, baseCheck.reason);
  }
  if (confirm === true && previewToken === undefined) {
    return refusalResult(
      op,
      'confirm needs previewToken: run once without confirm, show what it reports, then pass its previewToken back'
    );
  }

  const read = readOrdinaryPullRequest(op, target, base);
  if (read.result) return read.result;
  const { pullRequest } = read;
  const headInRepository =
    pullRequest.headRepository !== '' && pullRequest.headRepository.toLowerCase() === pullRequest.repository.toLowerCase();
  const shown = `pull request #${target} of ${pullRequest.repository} into ${pullRequest.baseRef} at head ${pullRequest.headSha}`;
  const currentToken = previewTokenOf(pullRequest, methodCheck.value);
  if (confirm !== true) {
    const chain = readDependents(op, pullRequest, headInRepository);
    if (chain.result) return chain.result;
    const warning =
      chain.dependents.length > 0
        ? ` Open pull requests ${chain.dependents.map((pr) => `#${pr.number}`).join(', ')} are based on its branch: a chain no provider registered as a stack, which this merge does not land or retarget.`
        : '';
    return {
      ...confirmationRequiredResult(
        op,
        `merge-single lands ${shown} with method ${methodCheck.value}, and cannot be undone by this runtime; re-run with previewToken ${currentToken} and confirm.${warning}`
      ),
      pullRequest: {
        ...pullRequest,
        repository: redact(pullRequest.repository),
        baseRef: redact(pullRequest.baseRef),
        headRef: redact(pullRequest.headRef),
        headRepository: redact(pullRequest.headRepository),
        headInRepository,
      },
      dependents: chain.dependents,
      previewToken: currentToken,
    };
  }
  if (previewToken !== currentToken) {
    return refusalResult(
      op,
      `the confirmation does not match what GitHub shows now (${shown}, method ${methodCheck.value}): the head, base or method changed since the preview. Nothing was merged. Preview again and ask again`
    );
  }
  const args = [
    'api',
    '-X',
    'PUT',
    `repos/{owner}/{repo}/pulls/${target}/merge`,
    '-f',
    `merge_method=${methodCheck.value}`,
    '-f',
    `sha=${pullRequest.headSha}`,
  ];
  const execResult = run('gh', args);
  let merged = false;
  if (execResult.ok && execResult.code === 0) {
    try {
      merged = JSON.parse(execResult.stdout).merged === true;
    } catch {
      merged = false;
    }
  }
  let status = 'API_FAILURE';
  if (execResult.code === 0) status = merged ? 'SUCCESS' : 'ERROR';
  return shapeApiResult({
    op,
    args,
    execResult,
    mayHaveMutated: true,
    status,
    // The generic API_FAILURE text says to retry. A refused merge is not
    // transient: the pull request has to change first.
    recoveryAction:
      status === 'SUCCESS'
        ? undefined
        : 'GitHub did not merge the pull request; its reason is in stdout (for example a required check, or a head that moved). Check on GitHub whether it merged before doing anything else, and do not retry unchanged.',
  });
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

const OPERATIONS = Object.freeze({
  view,
  init,
  add,
  checkout,
  rebase,
  sync,
  push,
  submit,
  merge,
  'merge-single': mergeSingle,
  unstack,
});

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
      if (key === 'branch') {
        // `--branch` may repeat: `init` adopts several branches, bottom to top.
        args.branches = [...(args.branches || []), value];
      }
      args[key] = value;
      index += 1;
      continue;
    }
    args._.push(token);
  }
  return args;
}

/**
 * Parse a `--timeout-ms` value: the whole string must be a positive safe
 * integer, so `1foo` or `1e3` is rejected instead of silently becoming 1 ms.
 * @param {unknown} raw
 * @returns {number|null}
 */
function parseTimeoutMs(raw) {
  if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args['timeout-ms'] !== undefined) {
    const parsed = parseTimeoutMs(args['timeout-ms']);
    if (parsed === null) {
      console.error('--timeout-ms must be a positive integer number of milliseconds');
      return 1;
    }
    spawnTimeoutMs = parsed;
  }
  const op = args._[0];
  if (typeof op !== 'string' || !OPERATIONS[op]) {
    console.error(
      `usage: github-stack-runtime.js <${Object.keys(OPERATIONS).join('|')}> [--flag value ...] [--confirm] [--timeout-ms <ms>]`
    );
    return 1;
  }
  const params = {
    base: typeof args.base === 'string' ? args.base : undefined,
    branch: typeof args.branch === 'string' ? args.branch : undefined,
    branches: Array.isArray(args.branches) ? args.branches : undefined,
    message: typeof args.message === 'string' ? args.message : undefined,
    target: typeof args.target === 'string' ? args.target : undefined,
    remote: typeof args.remote === 'string' ? args.remote : undefined,
    mode: typeof args.mode === 'string' ? args.mode : undefined,
    mergeMethod: typeof args['merge-method'] === 'string' ? args['merge-method'] : undefined,
    previewToken: typeof args['preview-token'] === 'string' ? args['preview-token'] : undefined,
    repository: typeof args.repository === 'string' ? args.repository : undefined,
    open: args.open === true,
    prune: args.prune === true,
    local: args.local === true,
    acceptBaseChange: args['accept-base-change'] === true,
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
  redact,
  validateBranchName,
  validatePositiveInt,
  validateRepoRelativePath,
  validateRemoteName,
  resolveRemote,
  stackRepository,
  validateEnum,
  OPERATIONS,
  view,
  init,
  add,
  checkout,
  rebase,
  sync,
  push,
  submit,
  merge,
  mergeSingle,
  previewTokenOf,
  mergePreviewTokenOf,
  unstack,
};
