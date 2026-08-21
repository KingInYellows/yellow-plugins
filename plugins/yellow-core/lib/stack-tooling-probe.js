#!/usr/bin/env node

/**
 * stack-tooling-probe.js — the single owner of stacked-PR provider CLI
 * readiness.
 *
 * Before this module, `commands/stack/status.md` and
 * `skills/stack-provider-router/SKILL.md` each inlined their own copy of
 * "is `gt` on PATH" / "does `gh extension list` mention github/gh-stack"
 * bash. Synchronized copies drift; this module is the one place that logic
 * lives now, and every markdown command/skill that needs a readiness
 * answer calls it and renders the result rather than re-deriving it.
 *
 * HARD RULES this module encodes:
 *   - `github`'s readiness requires BOTH a valid `gh auth status` AND a
 *     verified `github/gh-stack` extension identity. READY_GITHUB (in
 *     stack-provider-state.js) must be impossible when authentication is
 *     invalid — this module is where that constraint is actually checked;
 *     stack-provider-state.js only ever sees the resulting boolean.
 *   - Extension identity is checked by REPO ("github/gh-stack"), never by
 *     bare command name — `gh extension search stack` returns three
 *     third-party lookalikes alongside the official extension (see
 *     docs/research/2026-08-16-github-native-stacks-vs-graphite.md §3.2).
 *     A probe that only checked "does `gh stack` resolve" would accept any
 *     of them.
 *   - "The probe could not run" (network, missing `gh`/`gt`, spawn error)
 *     is always distinguished from "the probe ran and found the tool
 *     absent/misconfigured" — the former is `unknown`, never folded into
 *     `not-ready`, which would tell a user to reinstall tooling whose
 *     state was never actually read.
 *   - This module NEVER installs, authenticates, or mutates anything. It
 *     only runs read-only probes (`--version`, `auth status`,
 *     `extension list`, and — only with `--check-repo` — `stack view
 *     --json`, itself read-only) and reports what it observed.
 *
 * CLI:
 *   node stack-tooling-probe.js probe [--provider graphite|github|both] [--check-repo]
 *
 * Output is a single JSON object on stdout. Exit code is 0 unless the CLI
 * itself was invoked incorrectly (bad --provider value) — an unready or
 * unavailable tool is a normal, successful probe RESULT, not a probe
 * failure, so it never produces a non-zero exit.
 */

'use strict';

const { spawnSync } = require('child_process');

/** The three readiness verdicts every check below resolves to. */
const READINESS = Object.freeze({
  READY: 'ready',
  NOT_READY: 'not-ready',
  // The probe itself could not produce an answer (spawn failure, network,
  // or a command that requires a repository this process is not in).
  UNKNOWN: 'unknown',
});

/** The only extension identity this repository treats as first-party. */
const OFFICIAL_EXTENSION = 'github/gh-stack';

/**
 * Run a CLI probe with a bounded timeout, never throwing. Every caller
 * gets back `{ ok, code, stdout, stderr }`; `ok: false` means the command
 * itself could not be spawned (not found, permission denied, timed out) —
 * distinct from `ok: true, code: <nonzero>`, which means it ran and
 * reported failure through its own exit code.
 *
 * @param {string} cmd
 * @param {string[]} args
 */
function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });
  if (result.error || typeof result.status !== 'number') {
    // `ok: false` alone cannot distinguish "the binary is not installed"
    // from "it exists but could not be run" (EACCES, ETIMEDOUT, EPERM).
    // Callers below MUST branch on `absent` rather than assuming absence,
    // or a permission/timeout failure gets reported to the user as "not
    // found on PATH" and sends them to reinstall something already present.
    const code = result.error && result.error.code ? String(result.error.code) : '';
    return {
      ok: false,
      absent: code === 'ENOENT',
      failureCode: code || null,
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
 * Graphite readiness: presence of `gt` on PATH, via `gt --version`.
 */
function probeGraphite() {
  const version = run('gt', ['--version']);
  if (!version.ok) {
    // Only ENOENT proves absence. A permission or timeout failure means the
    // probe could not establish anything — report UNKNOWN so the classifier
    // does not send the user to reinstall a tool that is already there.
    if (!version.absent) {
      return {
        readiness: READINESS.UNKNOWN,
        detail: `\`gt --version\` could not be run (${version.failureCode || 'spawn failure'}) — readiness could not be confirmed.`,
        checks: { present: null },
      };
    }
    return {
      readiness: READINESS.NOT_READY,
      detail: '`gt` was not found on PATH.',
      checks: { present: false },
    };
  }
  if (version.code !== 0) {
    return {
      readiness: READINESS.UNKNOWN,
      detail: `\`gt --version\` exited ${version.code} — readiness could not be confirmed.`,
      checks: { present: true, versionExitCode: version.code },
    };
  }
  const versionLine = version.stdout.trim().split('\n')[0] || '';
  return {
    readiness: READINESS.READY,
    detail: `gt is available (${versionLine}).`,
    checks: { present: true, version: versionLine },
  };
}

/**
 * Classify `gh extension list` output for the official `github/gh-stack`
 * identity. Splits on whitespace runs rather than assuming a fixed column
 * separator, because `gh extension list`'s column formatting is not a
 * documented, stable contract.
 *
 * @param {string} listOutput
 * @returns {'verified'|'wrong-owner'|'missing'}
 */
function parseExtensionIdentity(listOutput) {
  const lines = listOutput
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  let sawStackNamedExtension = false;
  for (const line of lines) {
    const columns = line.split(/\s+/);
    if (columns.includes(OFFICIAL_EXTENSION)) {
      return 'verified';
    }
    // Any extension whose repo or invocation name ends in "stack" but is
    // NOT the verified github/gh-stack repo is a lookalike (see the
    // name-collision hazard in docs/research/
    // 2026-08-16-github-native-stacks-vs-graphite.md §3.2 —
    // boneskull/gh-stack, VladimirAnaniev/gh-stack, etc.).
    if (columns.some((column) => /(^|\/)(gh-)?stack$/i.test(column))) {
      sawStackNamedExtension = true;
    }
  }
  return sawStackNamedExtension ? 'wrong-owner' : 'missing';
}

/**
 * GitHub-provider readiness: `gh` present, a valid `gh auth status`, AND a
 * verified `github/gh-stack` extension identity. All three must hold for
 * `readiness: 'ready'` — see the module-level "HARD RULES" comment on why
 * auth is load-bearing here rather than left to a later check.
 */
function probeGithub() {
  const version = run('gh', ['--version']);
  if (!version.ok) {
    // Same ENOENT-vs-everything-else distinction as probeGraphite above.
    if (!version.absent) {
      return {
        readiness: READINESS.UNKNOWN,
        detail: `\`gh --version\` could not be run (${version.failureCode || 'spawn failure'}) — readiness could not be confirmed.`,
        checks: { present: null, authValid: null, extensionIdentity: 'unavailable' },
      };
    }
    return {
      readiness: READINESS.NOT_READY,
      detail: '`gh` was not found on PATH.',
      checks: { present: false, authValid: null, extensionIdentity: 'unavailable' },
    };
  }
  const versionLine = version.stdout.trim().split('\n')[0] || '';

  // Plain (non --json) `gh auth status` exits 1 when the checked host has
  // no valid authentication and 0 when it does (`gh help exit-codes`). The
  // --json form always exits 0 regardless of auth validity per its own
  // --help text, which is why this probe deliberately does NOT use it.
  const auth = run('gh', ['auth', 'status']);
  const authProbeRan = auth.ok;
  const authValid = auth.ok && auth.code === 0;

  const extensionList = run('gh', ['extension', 'list']);
  let extensionIdentity;
  let extensionProbeRan = true;
  if (!extensionList.ok || extensionList.code !== 0) {
    extensionIdentity = 'unavailable';
    extensionProbeRan = false;
  } else {
    extensionIdentity = parseExtensionIdentity(extensionList.stdout);
  }

  const ready = authValid && extensionIdentity === 'verified';
  let readiness;
  let detail;
  if (ready) {
    readiness = READINESS.READY;
    detail = `gh is authenticated and ${OFFICIAL_EXTENSION} is installed (${versionLine}).`;
  } else if (!authProbeRan || !extensionProbeRan) {
    readiness = READINESS.UNKNOWN;
    detail = !authProbeRan
      ? '`gh auth status` could not be run — readiness could not be confirmed.'
      : '`gh extension list` could not be run — extension identity was not checked.';
  } else if (!authValid) {
    readiness = READINESS.NOT_READY;
    detail = '`gh auth status` reports no valid authentication.';
  } else if (extensionIdentity === 'missing') {
    readiness = READINESS.NOT_READY;
    detail = `the official ${OFFICIAL_EXTENSION} extension is not installed.`;
  } else {
    // extensionIdentity === 'wrong-owner'
    readiness = READINESS.NOT_READY;
    detail = `a "stack"-named gh extension is installed, but it is not the official ${OFFICIAL_EXTENSION}.`;
  }

  return {
    readiness,
    detail,
    checks: {
      present: true,
      version: versionLine,
      authValid,
      extensionIdentity,
    },
  };
}

/**
 * Repository-level stacked-PR availability, via `gh stack view --json`.
 * Only meaningful once `probeGithub()` reports a verified extension —
 * callers gate this behind that check and behind `--check-repo`, because
 * unlike the presence/auth probes above, this one makes a network call
 * against the current repository.
 */
function probeRepositoryStackAvailability() {
  const view = run('gh', ['stack', 'view', '--json']);
  if (!view.ok) {
    return { available: null, detail: '`gh stack view --json` could not be run.' };
  }
  if (view.code === 0) {
    return { available: true, detail: '`gh stack view --json` succeeded.' };
  }
  if (view.code === 9) {
    // ErrStacksUnavailable, verified against github/gh-stack source at
    // ab00aa4a3f2dddc51aa65849c68b391a1b079311 — see
    // docs/research/2026-08-18-github-stack-provider-operations-revalidation.md §2.
    return {
      available: false,
      detail: 'Stacked PRs are not enabled for this repository (exit 9).',
    };
  }
  if (view.code === 2) {
    // ErrNotInStack: the repository and extension both work; the current
    // branch simply has no active stack. Availability of the FEATURE, not
    // readiness of the current branch, is what this probe answers.
    return {
      available: true,
      detail: 'No active stack on the current branch (exit 2), but stacked PRs are available for this repository.',
    };
  }
  return {
    available: null,
    detail: `\`gh stack view --json\` exited ${view.code} — availability unknown.`,
  };
}

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
  if (args._[0] !== 'probe') {
    console.error(
      'usage: stack-tooling-probe.js probe [--provider graphite|github|both] [--check-repo]'
    );
    return 1;
  }

  const provider = typeof args.provider === 'string' ? args.provider : 'both';
  if (!['graphite', 'github', 'both'].includes(provider)) {
    console.error(`error: --provider must be one of graphite, github, both (got "${provider}")`);
    return 1;
  }

  const result = {};
  if (provider === 'graphite' || provider === 'both') {
    result.graphite = probeGraphite();
  }
  if (provider === 'github' || provider === 'both') {
    result.github = probeGithub();
    if (args['check-repo'] && result.github.checks.extensionIdentity === 'verified') {
      result.github.repository = probeRepositoryStackAvailability();
    }
  }
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = {
  READINESS,
  OFFICIAL_EXTENSION,
  run,
  parseExtensionIdentity,
  probeGraphite,
  probeGithub,
  probeRepositoryStackAvailability,
};
