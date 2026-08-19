'use strict';

/**
 * stack-operation-registry.js — the fixed provider-operation contract owned
 * by yellow-core (GOAL.md Phase 2 / plans/stacked-pr-provider-abstraction.md
 * deferred-work item 1).
 *
 * Maps each of the nine neutral `/stack:*` operations, plus the lower-level
 * primitives `flow:work` needs for stack-aware execution, to exactly one
 * Graphite implementation and one GitHub implementation — or an explicit
 * `null` ("not supported for this provider"). There is no third option and
 * no fallback field: a caller that gets `null` back stops and reports it,
 * it never tries the other provider.
 *
 * Dependency-free by design (no `fs`/`path`/`child_process`) so it can be
 * required from markdown-invoked Node one-liners with zero setup cost.
 * `tests/integration/stack-operation-registry.test.ts` is what verifies
 * every `command` entry resolves to a real file on disk — that check needs
 * `fs`/`path` and deliberately lives in the test, not here.
 */

function cmd(plugin, ref) {
  return Object.freeze({ type: 'command', plugin, ref });
}
function cli(bin, args) {
  return Object.freeze({ type: 'cli', bin, args: Object.freeze(args) });
}
function adapter(op, flags) {
  return Object.freeze({ type: 'adapter', op, flags: Object.freeze(flags || []) });
}
function shared(detail) {
  return Object.freeze({ type: 'shared', detail });
}

/** Provider ids this registry knows — mirrors PROVIDERS in stack-provider-state.js. */
const PROVIDER_IDS = Object.freeze(['graphite', 'github']);

/**
 * The nine neutral operations, each exposed as a `/stack:<name>` command in
 * yellow-core. `status` deliberately maps Graphite to the SAME `gt-setup`
 * command as `setup` — Graphite has no separate stack-status surface
 * distinct from its readiness report, and `github-stack-status` (already
 * shipped) genuinely is a distinct readiness command, so collapsing them
 * for Graphite only is an honest reflection of what exists, not a
 * placeholder.
 */
const OPERATIONS = Object.freeze({
  setup: Object.freeze({
    graphite: cmd('gt-workflow', 'gt-setup'),
    github: cmd('github-workflow', 'github-stack:setup'),
  }),
  status: Object.freeze({
    graphite: cmd('gt-workflow', 'gt-setup'),
    github: cmd('github-workflow', 'github-stack:status'),
  }),
  plan: Object.freeze({
    graphite: cmd('gt-workflow', 'gt-stack-plan'),
    github: cmd('github-workflow', 'github-stack:plan'),
  }),
  submit: Object.freeze({
    graphite: cmd('gt-workflow', 'smart-submit'),
    github: cmd('github-workflow', 'github-stack:submit'),
  }),
  amend: Object.freeze({
    graphite: cmd('gt-workflow', 'gt-amend'),
    github: cmd('github-workflow', 'github-stack:amend'),
  }),
  sync: Object.freeze({
    graphite: cmd('gt-workflow', 'gt-sync'),
    github: cmd('github-workflow', 'github-stack:sync'),
  }),
  nav: Object.freeze({
    graphite: cmd('gt-workflow', 'gt-nav'),
    github: cmd('github-workflow', 'github-stack:nav'),
  }),
  cleanup: Object.freeze({
    graphite: cmd('gt-workflow', 'gt-cleanup'),
    github: cmd('github-workflow', 'github-stack:cleanup'),
  }),
  // `gt merge` is a real, direct, noninteractive-capable CLI command
  // (`gt merge -c`/`--dry-run`, verified locally against gt 1.7.20) — NOT
  // the "no safe direct CLI stack-merge exists" case GOAL.md's Phase 5
  // anticipated as a possibility. A thin /gt-merge wrapper is therefore
  // more truthful than a structured handoff placeholder would be.
  merge: Object.freeze({
    graphite: cmd('gt-workflow', 'gt-merge'),
    github: cmd('github-workflow', 'github-stack:merge'),
  }),
});

/**
 * Lower-level primitives `flow:work` needs for stack-aware execution.
 * Graphite entries name the exact `gt` subcommand; GitHub entries name the
 * runtime adapter operation in `plugins/github-workflow/lib/github-stack-runtime.js`.
 * `resolveTrunk` is `shared` because both providers read the same
 * `<!-- stack-trunk: -->` plan metadata — there is no provider-specific
 * implementation to diverge on.
 */
const PRIMITIVES = Object.freeze({
  resolveTrunk: Object.freeze({
    graphite: shared('Read the <!-- stack-trunk: --> plan metadata.'),
    github: shared('Read the <!-- stack-trunk: --> plan metadata.'),
  }),
  inspectStack: Object.freeze({
    graphite: cli('gt', ['log', 'short', '--no-interactive']),
    github: adapter('view'),
  }),
  initFirstLayer: Object.freeze({
    graphite: cli('gt', ['create']),
    github: adapter('init'),
  }),
  addLayer: Object.freeze({
    graphite: cli('gt', ['create']),
    github: adapter('add'),
  }),
  checkoutLayer: Object.freeze({
    graphite: cli('gt', ['checkout']),
    github: adapter('checkout'),
  }),
  // No gh-stack-specific "commit"/"amend" primitive exists in the verified
  // command surface (docs/research/2026-08-18-github-stack-provider-
  // operations-revalidation.md §3) — `gt modify -m` is gt-specific (it
  // also updates Graphite's own stack tracking), but the GitHub side is
  // plain `git commit` (`--amend` for the layer that owns the change);
  // gh-stack itself only tracks branch/PR relationships, not commit
  // content. `shared` here means "no stacked-PR-specific tool", not "the
  // exact same command as graphite".
  commitOrAmend: Object.freeze({
    graphite: cli('gt', ['modify', '-m']),
    github: shared('git commit -m <message> (--amend for the layer that owns the change); no gh-stack-specific commit primitive exists.'),
  }),
  submitStack: Object.freeze({
    graphite: cli('gt', ['submit', '--no-interactive']),
    github: adapter('submit', ['--auto']),
  }),
  rebaseUpstack: Object.freeze({
    graphite: cli('gt', ['restack']),
    github: adapter('rebase', ['--upstack']),
  }),
  continueConflict: Object.freeze({
    graphite: cli('gt', ['continue']),
    github: adapter('rebase', ['--continue']),
  }),
  abortConflict: Object.freeze({
    graphite: cli('gt', ['abort']),
    github: adapter('rebase', ['--abort']),
  }),
});

function assertKnownProvider(providerId) {
  if (!PROVIDER_IDS.includes(providerId)) {
    throw new Error(`stack-operation-registry: unknown provider "${providerId}"`);
  }
}

/** True when an entry represents a real, supported implementation. */
function isSupported(entry) {
  return entry !== null && entry !== undefined;
}

function listOperations() {
  return Object.keys(OPERATIONS);
}
function listPrimitives() {
  return Object.keys(PRIMITIVES);
}

/**
 * @param {string} name - one of `listOperations()`.
 * @param {'graphite'|'github'} providerId
 * @returns {object|null} the entry, or null if unsupported for that provider.
 */
function getOperation(name, providerId) {
  const entry = OPERATIONS[name];
  if (!entry) {
    throw new Error(`stack-operation-registry: unknown operation "${name}"`);
  }
  assertKnownProvider(providerId);
  return entry[providerId] || null;
}

/**
 * @param {string} name - one of `listPrimitives()`.
 * @param {'graphite'|'github'} providerId
 * @returns {object|null} the entry, or null if unsupported for that provider.
 */
function getPrimitive(name, providerId) {
  const entry = PRIMITIVES[name];
  if (!entry) {
    throw new Error(`stack-operation-registry: unknown primitive "${name}"`);
  }
  assertKnownProvider(providerId);
  return entry[providerId] || null;
}

module.exports = {
  PROVIDER_IDS,
  OPERATIONS,
  PRIMITIVES,
  isSupported,
  listOperations,
  listPrimitives,
  getOperation,
  getPrimitive,
};
