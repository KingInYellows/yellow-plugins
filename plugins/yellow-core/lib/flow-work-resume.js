#!/usr/bin/env node

/**
 * flow-work-resume.js — evidence that `/flow:work` already did a piece of
 * work, so a fresh session that resumes an interrupted run neither redoes it
 * nor skips work that never happened.
 *
 * Two read-only modes, each printing one JSON object on stdout:
 *
 *   committed-steps --plan <path> [--base <ref>]
 *     Single-branch runs. Phase 2 commits a step before it ticks the step's
 *     plan checkbox, so a session lost in between leaves a committed step
 *     unticked. Each step commit carries a `Flow-Work-Step: <plan>#<N>`
 *     trailer; this mode lists the step numbers whose trailer names this
 *     plan on commits in <merge-base(HEAD, base)>..HEAD. Only the trailer
 *     block counts, and only for this plan path, so an unrelated commit with
 *     a similar subject (or the same words in its body) is never evidence.
 *     -> {"status":"OK","plan":"plans/x.md","base":"origin/main","steps":[1]}
 *
 *   stack-item --branch <name> --base <expected-base> [--repo <owner/name>]
 *     Stack runs. Phase 1b submits an item and then writes `## Stack
 *     Progress`; a session lost in between leaves a submitted item
 *     unticked. This mode looks for the item's pull request with `gh` and
 *     checks it against the intended repository, head branch, stack base and
 *     local branch tip. It never runs `gt`: the same check serves Graphite
 *     and GitHub-native stacks, and works before or without Graphite.
 *     -> {"status":"SUBMITTED"|"NOT_SUBMITTED"|"MISMATCH"|"UNAVAILABLE", ...}
 *
 * HARD RULES:
 *   - Never mutates anything: no git writes, no plan edits, no gh writes.
 *     The command applies the repair after reading the result.
 *   - Runs every tool with an argument vector (no shell), so a branch or
 *     plan name is never re-parsed.
 *   - "Could not read the evidence" (UNAVAILABLE / ERROR) is never folded
 *     into "no evidence" (NOT_SUBMITTED / empty steps). Only a definite
 *     answer lets the caller tick a box or leave one empty.
 *   - Anything ambiguous (several PRs, a base or head that does not match)
 *     is MISMATCH, and the caller leaves the plan and branches as they are.
 *
 * Exit status is 0 whenever a JSON result was printed, 2 on a usage error.
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const TRAILER_KEY = 'Flow-Work-Step';

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
    ...opts,
  });
  return {
    ok: !result.error && result.status === 0,
    missing: Boolean(result.error && result.error.code === 'ENOENT'),
    status: result.status,
    stdout: result.stdout || '',
    stderr: (result.stderr || '').trim(),
  };
}

function git(args, cwd) {
  return run('git', args, { cwd });
}

// Same rule as /flow:work Phase 1b step 1: a valid ref name with no shell
// metacharacters, quotes or whitespace.
function validBranchName(name, cwd) {
  if (typeof name !== 'string' || name.length === 0) return false;
  if (/[$`;&|()<>'"\s\\]/.test(name)) return false;
  return git(['check-ref-format', '--branch', name], cwd).ok;
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) return { error: `unexpected argument: ${arg}` };
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      return { error: `missing value for --${key}` };
    }
    opts[key] = value;
    i += 1;
  }
  return { opts };
}

function repoRoot(cwd) {
  const top = git(['rev-parse', '--show-toplevel'], cwd);
  return top.ok ? top.stdout.trim() : null;
}

// Repository-relative, forward-slash plan path, so the trailer written on one
// machine matches the path read on another.
function normalizePlanPath(plan, root, cwd) {
  const abs = path.resolve(cwd, plan);
  const rel = path.relative(root, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

function defaultBase(cwd) {
  const head = git(
    ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD'],
    cwd
  );
  if (head.ok && head.stdout.trim()) return head.stdout.trim();
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
    if (git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd).ok) {
      return ref;
    }
  }
  return null;
}

/**
 * Parse trailer values ("<plan>#<N>") and keep the step numbers for `plan`.
 * Exported for tests.
 */
function stepsFromTrailerValues(values, plan) {
  const steps = new Set();
  for (const raw of values) {
    const value = raw.trim();
    const hash = value.lastIndexOf('#');
    if (hash <= 0) continue;
    if (value.slice(0, hash) !== plan) continue;
    const num = value.slice(hash + 1);
    if (!/^[1-9][0-9]{0,5}$/.test(num)) continue;
    steps.add(Number(num));
  }
  return [...steps].sort((a, b) => a - b);
}

function committedSteps(opts, cwd) {
  if (!opts.plan)
    return { status: 'ERROR', detail: 'committed-steps needs --plan' };
  const root = repoRoot(cwd);
  if (!root) return { status: 'ERROR', detail: 'not inside a git repository' };
  const plan = normalizePlanPath(opts.plan, root, cwd);
  if (!plan) {
    return {
      status: 'ERROR',
      detail: `plan path is outside the repository: ${opts.plan}`,
    };
  }
  const base = opts.base || defaultBase(cwd);
  if (!base) {
    return {
      status: 'ERROR',
      plan,
      detail:
        'no trunk ref found (tried origin/HEAD, origin/main, origin/master, main, master); pass --base',
    };
  }
  if (!git(['rev-parse', '--verify', '--quiet', `${base}^{commit}`], cwd).ok) {
    return {
      status: 'ERROR',
      plan,
      base,
      detail: `base ref not found: ${base}`,
    };
  }
  if (!git(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], cwd).ok) {
    return { status: 'OK', plan, base, steps: [] };
  }
  const mb = git(['merge-base', 'HEAD', base], cwd);
  if (!mb.ok) {
    return {
      status: 'ERROR',
      plan,
      base,
      detail: `no merge base between HEAD and ${base}`,
    };
  }
  const log = git(
    [
      'log',
      '-z',
      `--format=%(trailers:key=${TRAILER_KEY},valueonly,separator=%x1f)`,
      `${mb.stdout.trim()}..HEAD`,
    ],
    cwd
  );
  if (!log.ok) {
    return {
      status: 'ERROR',
      plan,
      base,
      detail: `git log failed: ${log.stderr}`,
    };
  }
  const values = log.stdout
    .split('\0')
    .flatMap((entry) => entry.split('\x1f'))
    .filter((v) => v.trim().length > 0);
  return {
    status: 'OK',
    plan,
    base,
    steps: stepsFromTrailerValues(values, plan),
  };
}

/**
 * Decide an item's state from `gh pr list` rows. Pure; exported for tests.
 * `localHead` is the local branch tip SHA, or null when there is no local
 * branch.
 */
function classifyStackItem({ branch, base, rows, localHead }) {
  const own = rows.filter(
    (r) => r && r.isCrossRepository !== true && r.headRefName === branch
  );
  // A closed, unmerged PR is not a submission of the current branch.
  const live = own.filter((r) => r.state === 'OPEN' || r.state === 'MERGED');
  if (live.length === 0) {
    return {
      status: 'NOT_SUBMITTED',
      detail: `no open or merged pull request has head ${branch}`,
    };
  }
  if (live.length > 1) {
    return {
      status: 'MISMATCH',
      prs: live.map((r) => ({ number: r.number, url: r.url, state: r.state })),
      detail: `${live.length} pull requests have head ${branch}; check which one belongs to this plan`,
    };
  }
  const pr = live[0];
  const summary = {
    number: pr.number,
    url: pr.url,
    state: pr.state,
    base: pr.baseRefName,
    headOid: pr.headRefOid,
  };
  if (pr.baseRefName !== base) {
    return {
      status: 'MISMATCH',
      pr: summary,
      detail: `PR #${pr.number} targets ${pr.baseRefName}, but the plan stacks ${branch} on ${base}`,
    };
  }
  if (!localHead) {
    return {
      status: 'MISMATCH',
      pr: summary,
      detail: `PR #${pr.number} exists but there is no local branch ${branch}; fetch it before resuming`,
    };
  }
  if (pr.state === 'OPEN' && pr.headRefOid && pr.headRefOid !== localHead) {
    return {
      status: 'MISMATCH',
      pr: summary,
      localHead,
      detail: `local ${branch} is at ${localHead.slice(0, 12)} but PR #${pr.number} is at ${String(pr.headRefOid).slice(0, 12)}; push or reset the branch before resuming`,
    };
  }
  return { status: 'SUBMITTED', pr: summary, localHead };
}

function stackItem(opts, cwd) {
  const { branch, base } = opts;
  if (!branch || !base) {
    return {
      status: 'UNAVAILABLE',
      detail: 'stack-item needs --branch and --base',
    };
  }
  if (!repoRoot(cwd))
    return { status: 'UNAVAILABLE', detail: 'not inside a git repository' };
  for (const [label, name] of [
    ['branch', branch],
    ['base', base],
  ]) {
    if (!validBranchName(name, cwd)) {
      return {
        status: 'UNAVAILABLE',
        detail: `invalid ${label} name: ${JSON.stringify(name)}`,
      };
    }
  }
  if (opts.repo && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(opts.repo)) {
    return {
      status: 'UNAVAILABLE',
      detail: `invalid --repo: ${JSON.stringify(opts.repo)}`,
    };
  }

  const local = git(
    ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}^{commit}`],
    cwd
  );
  const localHead = local.ok ? local.stdout.trim() : null;

  let repo = opts.repo;
  if (!repo) {
    const view = run(
      'gh',
      ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
      {
        cwd,
      }
    );
    if (view.missing) {
      return {
        status: 'UNAVAILABLE',
        detail:
          'gh is not installed; install the GitHub CLI or check the pull request by hand',
      };
    }
    if (!view.ok || !view.stdout.trim()) {
      return {
        status: 'UNAVAILABLE',
        detail: `gh could not resolve the repository (${view.stderr || 'no output'}); pass --repo or run gh auth login`,
      };
    }
    repo = view.stdout.trim();
  }

  const list = run(
    'gh',
    [
      'pr',
      'list',
      '--repo',
      repo,
      '--head',
      branch,
      '--state',
      'all',
      '--limit',
      '20',
      '--json',
      'number,url,state,headRefName,baseRefName,headRefOid,isCrossRepository',
    ],
    { cwd }
  );
  if (list.missing) {
    return {
      status: 'UNAVAILABLE',
      repo,
      detail:
        'gh is not installed; install the GitHub CLI or check the pull request by hand',
    };
  }
  if (!list.ok) {
    return {
      status: 'UNAVAILABLE',
      repo,
      detail: `gh pr list failed (${list.stderr || `exit ${list.status}`}); run gh auth login and resume again`,
    };
  }
  let rows;
  try {
    rows = JSON.parse(list.stdout);
  } catch {
    rows = null;
  }
  if (!Array.isArray(rows)) {
    return {
      status: 'UNAVAILABLE',
      repo,
      detail: 'gh pr list returned unreadable JSON',
    };
  }
  return {
    repo,
    branch,
    base,
    ...classifyStackItem({ branch, base, rows, localHead }),
  };
}

function main(argv) {
  const [mode, ...rest] = argv;
  const parsed = parseArgs(rest);
  if (parsed.error || (mode !== 'committed-steps' && mode !== 'stack-item')) {
    process.stderr.write(
      `${parsed.error ? `${parsed.error}\n` : ''}usage: flow-work-resume.js committed-steps --plan <path> [--base <ref>]\n` +
        '       flow-work-resume.js stack-item --branch <name> --base <expected-base> [--repo <owner/name>]\n'
    );
    return 2;
  }
  const cwd = process.cwd();
  const result =
    mode === 'committed-steps'
      ? committedSteps(parsed.opts, cwd)
      : stackItem(parsed.opts, cwd);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return 0;
}

module.exports = {
  TRAILER_KEY,
  stepsFromTrailerValues,
  classifyStackItem,
  committedSteps,
  stackItem,
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
