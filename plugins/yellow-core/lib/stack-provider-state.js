#!/usr/bin/env node

/**
 * stack-provider-state.js — the single owner of stacked-PR provider state.
 *
 * `/stack:status` and `/stack:select` are markdown; markdown cannot be
 * fixture-tested. Every classification rule and every switch precondition
 * therefore lives here, in a dependency-free CommonJS module, and the
 * commands call it. Prose in the command files describes what this module
 * returns — it never re-derives a state on its own.
 *
 * See plans/stacked-pr-provider-abstraction.md for the model and
 * docs/research/2026-08-16-github-native-stacks-vs-graphite.md for the
 * `claude plugin list --json` shape this parses.
 *
 * HARD RULES this module encodes:
 *   - Both providers MAY be installed. Exactly one MAY be enabled.
 *   - Ambiguity is reported, never resolved by guessing. There is no
 *     fallback from one provider to the other, anywhere.
 *   - Managed-scope conflicts fail closed: this module refuses to emit a
 *     plan whose steps the CLI would reject.
 *   - This module NEVER executes a command and NEVER writes a file. It
 *     returns plans; the caller decides whether to run them.
 *
 * CLI:
 *   node stack-provider-state.js classify [options]
 *   node stack-provider-state.js plan --target <graphite|github> [options]
 *
 *   --plugins-file <path|->     `claude plugin list --json` output ("-" = stdin)
 *   --intent-file <path>        `.yellow-stack.yml` (absent ⇒ no intent)
 *   --project-path <path>       repo root, filters foreign project/local rows
 *   --scope <user|project|local>  target scope for `plan` (default: user)
 *   --tooling-graphite <yes|no>   provider CLI probe result (omit ⇒ unknown)
 *   --tooling-github <yes|no>     provider CLI probe result (omit ⇒ unknown)
 *
 * Output is a single JSON object on stdout. Exit code is 0 for a successful
 * classification/plan (including a REFUSED plan — refusal is an answer, not
 * a crash) and 1 only when the inputs could not be read or parsed.
 */

'use strict';

const { readFileSync } = require('fs');

/**
 * Canonical provider table for the `stacked-pr` capability group.
 *
 * This is a deliberate replica of the `capabilityProvider` declarations in
 * catalog/plugins/*.json: an installed plugin has no access to this repo's
 * catalog at runtime, so the table has to ship. Replication without a lint
 * is drift waiting to happen, so scripts/validate-provider-groups.js parses
 * the marker-delimited block below and fails CI when it disagrees with the
 * catalog (ERROR-PROVIDER-006). Do not reformat the block: the validator
 * matches these exact shapes.
 */
const PROVIDER_GROUP = 'stacked-pr';
// provider-table:start
const PROVIDERS = Object.freeze([
  Object.freeze({ id: 'graphite', plugin: 'gt-workflow' }),
  Object.freeze({ id: 'github', plugin: 'github-workflow' }),
]);
// provider-table:end

/** Marketplace this repository's provider plugins are published under. */
const DEFAULT_MARKETPLACE = 'yellow-plugins';

/** Scopes a user-issued `claude plugin` command can actually write. */
const WRITABLE_SCOPES = Object.freeze(['user', 'project', 'local']);

/**
 * The seven provider states. Exported so consumers compare against a
 * constant rather than a string literal that a typo can silently break.
 */
const STATES = Object.freeze({
  UNSELECTED: 'UNSELECTED',
  READY_GRAPHITE: 'READY_GRAPHITE',
  READY_GITHUB: 'READY_GITHUB',
  CONFLICT: 'CONFLICT',
  CONFIG_MISMATCH: 'CONFIG_MISMATCH',
  MANAGED_CONFLICT: 'MANAGED_CONFLICT',
  PARTIAL_TOOLING: 'PARTIAL_TOOLING',
});

/** Provider id -> the READY_* state that id produces. */
const READY_STATE_BY_ID = Object.freeze({
  graphite: STATES.READY_GRAPHITE,
  github: STATES.READY_GITHUB,
});

/**
 * Parse `.yellow-stack.yml` for the repository's provider intent.
 *
 * Deliberately not a YAML parser: a shipped plugin library must not depend
 * on node_modules, and the file has exactly one field this repo defines. A
 * single anchored `provider:` line is recognised; everything else in the
 * file is ignored, and an unreadable/absent/malformed file means "no
 * intent" — never a default provider.
 *
 * The character class is `[ \t]*`, NOT `\s*`: `\s` matches newlines, so a
 * `\s*`-separated pattern would happily read the value off the NEXT line.
 *
 * @param {string|null|undefined} text - raw file contents, or null if absent.
 * @returns {string|null} the declared provider id, or null.
 */
function parseIntent(text) {
  if (typeof text !== 'string') {
    return null;
  }
  const match = text
    .replace(/\r\n/g, '\n')
    .match(
      /^provider:[ \t]*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s#]*))[ \t]*(?:#.*)?$/m
    );
  if (!match) {
    return null;
  }
  const value = (
    match[1] !== undefined
      ? match[1]
      : match[2] !== undefined
        ? match[2]
        : match[3] || ''
  ).trim();
  return value.length > 0 ? value : null;
}

/**
 * Reduce a raw `claude plugin list --json` array to a per-provider view.
 *
 * Three properties of the real output drive this (all verified against
 * Claude Code 2.1.233, see the research doc):
 *   1. `id` is `name@marketplace`, not a bare plugin name.
 *   2. A plugin appears once PER SCOPE, so "is it enabled" is a fold over
 *      rows, not a lookup.
 *   3. `project`/`local` rows carry a `projectPath` that may belong to a
 *      DIFFERENT repository. Without filtering, another project's provider
 *      choice is read as this project's.
 *
 * @param {Array<object>} plugins - parsed `claude plugin list --json`.
 * @param {{ projectPath?: string|null }} [options]
 */
function summarizeProviders(plugins, { projectPath = null } = {}) {
  const rows = Array.isArray(plugins) ? plugins : [];
  const projectScopeFiltered =
    typeof projectPath === 'string' && projectPath.length > 0;
  const summary = {};

  for (const provider of PROVIDERS) {
    const entries = rows.filter((row) => {
      if (
        row === null ||
        typeof row !== 'object' ||
        typeof row.id !== 'string'
      ) {
        return false;
      }
      const [name] = row.id.split('@');
      if (name !== provider.plugin) {
        return false;
      }
      // user/managed rows are global. project/local rows belong to one
      // repository; drop the ones that belong to a different one. When the
      // caller could not supply a project path we keep them and flag it
      // rather than silently guessing either way.
      if (
        (row.scope === 'project' || row.scope === 'local') &&
        projectScopeFiltered
      ) {
        return row.projectPath === projectPath;
      }
      return true;
    });

    const enabledEntries = entries.filter((entry) => entry.enabled === true);
    summary[provider.id] = {
      id: provider.id,
      plugin: provider.plugin,
      installed: entries.length > 0,
      enabled: enabledEntries.length > 0,
      scopes: entries.map((entry) => entry.scope),
      enabledScopes: enabledEntries.map((entry) => entry.scope),
      managedEnabled: enabledEntries.some((entry) => entry.scope === 'managed'),
      managedPresent: entries.some((entry) => entry.scope === 'managed'),
      // A managed row that is explicitly disabled is a force-disable we
      // cannot override — `--plugin-dir` cannot either, per the docs.
      managedDisabled: entries.some(
        (entry) => entry.scope === 'managed' && entry.enabled === false
      ),
      marketplaces: [
        ...new Set(
          entries
            .map((entry) => entry.id.split('@')[1])
            .filter(
              (marketplace) =>
                typeof marketplace === 'string' && marketplace.length > 0
            )
        ),
      ],
    };
  }

  return { providers: summary, projectScopeFiltered };
}

/**
 * Classify the current provider state.
 *
 * Precedence is first-match-wins, worst-first, so an unfixable condition is
 * never masked by a merely-wrong one:
 *   MANAGED_CONFLICT > CONFLICT > CONFIG_MISMATCH > UNSELECTED >
 *   PARTIAL_TOOLING > READY_*
 *
 * @param {{
 *   plugins: Array<object>,
 *   intent?: string|null,
 *   tooling?: { [providerId: string]: boolean|null|undefined },
 *   projectPath?: string|null,
 * }} input
 */
function classifyProviderState({
  plugins,
  intent = null,
  tooling = {},
  projectPath = null,
} = {}) {
  const { providers, projectScopeFiltered } = summarizeProviders(plugins, {
    projectPath,
  });
  const enabled = PROVIDERS.map((provider) => providers[provider.id]).filter(
    (entry) => entry.enabled
  );
  const known = PROVIDERS.some((provider) => provider.id === intent);
  const result = {
    group: PROVIDER_GROUP,
    intent,
    intentKnown: intent === null ? null : known,
    providers,
    projectScopeFiltered,
    // `false` means at least one relevant probe was never run. Callers must
    // say "not checked" rather than implying a clean tooling result.
    toolingKnown: enabled.every(
      (entry) => typeof tooling[entry.id] === 'boolean'
    ),
  };

  // 1. MANAGED_CONFLICT — a managed-scope entry makes the situation
  //    unfixable by any command we are able to issue. Fail closed.
  const managedEnabled = PROVIDERS.map(
    (provider) => providers[provider.id]
  ).filter((entry) => entry.managedEnabled);
  if (enabled.length > 1 && managedEnabled.length > 0) {
    return {
      ...result,
      state: STATES.MANAGED_CONFLICT,
      detail: `Both providers are enabled and ${managedEnabled
        .map((entry) => entry.plugin)
        .join(
          ' and '
        )} ${managedEnabled.length > 1 ? 'are' : 'is'} enabled at managed scope, which cannot be changed.`,
    };
  }
  if (intent !== null && known) {
    const conflictingManaged = managedEnabled.filter(
      (entry) => entry.id !== intent
    );
    if (conflictingManaged.length > 0) {
      return {
        ...result,
        state: STATES.MANAGED_CONFLICT,
        detail: `Repository intent is "${intent}", but ${conflictingManaged
          .map((entry) => entry.plugin)
          .join(' and ')} is enabled at managed scope and cannot be disabled.`,
      };
    }
    const target = providers[intent];
    if (target.managedDisabled) {
      return {
        ...result,
        state: STATES.MANAGED_CONFLICT,
        detail: `Repository intent is "${intent}", but ${target.plugin} is force-disabled at managed scope and cannot be enabled.`,
      };
    }
  }

  // 2. CONFLICT — both providers enabled. Two stack providers active at
  //    once is a correctness bug, not redundancy.
  if (enabled.length > 1) {
    return {
      ...result,
      state: STATES.CONFLICT,
      detail: `More than one stacked-PR provider is enabled (${enabled
        .map((entry) => `${entry.plugin} @ ${entry.enabledScopes.join('/')}`)
        .join(', ')}). Exactly one may be enabled.`,
    };
  }

  // 3. CONFIG_MISMATCH — .yellow-stack.yml records an intent the runtime
  //    does not match, including "intent set, nothing enabled".
  if (intent !== null) {
    if (!known) {
      return {
        ...result,
        state: STATES.CONFIG_MISMATCH,
        detail: `.yellow-stack.yml declares provider "${intent}", which is not a known ${PROVIDER_GROUP} provider (known: ${PROVIDERS.map(
          (provider) => provider.id
        ).join(', ')}).`,
      };
    }
    if (enabled.length === 0) {
      return {
        ...result,
        state: STATES.CONFIG_MISMATCH,
        detail: `.yellow-stack.yml declares provider "${intent}", but no stacked-PR provider is enabled.`,
      };
    }
    if (enabled[0].id !== intent) {
      return {
        ...result,
        state: STATES.CONFIG_MISMATCH,
        detail: `.yellow-stack.yml declares provider "${intent}", but ${enabled[0].plugin} ("${enabled[0].id}") is the enabled provider.`,
      };
    }
  }

  // 4. UNSELECTED — no intent recorded and nothing enabled.
  if (enabled.length === 0) {
    const installed = PROVIDERS.map(
      (provider) => providers[provider.id]
    ).filter((entry) => entry.installed);
    return {
      ...result,
      state: STATES.UNSELECTED,
      detail:
        installed.length === 0
          ? 'No stacked-PR provider is installed and none is recorded in .yellow-stack.yml.'
          : `Installed but not enabled: ${installed
              .map((entry) => entry.plugin)
              .join(', ')}. No provider is recorded in .yellow-stack.yml.`,
    };
  }

  // 5. PARTIAL_TOOLING — the right plugin is enabled but its CLI is
  //    missing. Only an explicit `false` probe result counts; an unrun
  //    probe leaves the state READY_* with toolingKnown: false.
  const active = enabled[0];
  if (tooling[active.id] === false) {
    return {
      ...result,
      state: STATES.PARTIAL_TOOLING,
      detail: `${active.plugin} is enabled, but its provider CLI is not available on this machine.`,
    };
  }

  // 6/7. READY_*.
  return {
    ...result,
    state: READY_STATE_BY_ID[active.id],
    detail: `${active.plugin} ("${active.id}") is the single enabled stacked-PR provider${
      intent === null ? ' (no .yellow-stack.yml intent recorded)' : ''
    }.`,
  };
}

/**
 * Build the exact, ordered command plan for switching to `target`.
 *
 * Returns `{ status: 'ok', steps }` or `{ status: 'refused', reason,
 * steps: [] }`. A refusal carries NO steps — a partially-applicable plan
 * would invite exactly the half-switched state this design exists to
 * prevent. Nothing here is executed.
 *
 * @param {{
 *   plugins: Array<object>,
 *   target: string,
 *   scope?: string,
 *   projectPath?: string|null,
 *   marketplace?: string,
 * }} input
 */
function planProviderSwitch({
  plugins,
  target,
  scope = 'user',
  projectPath = null,
  marketplace = DEFAULT_MARKETPLACE,
} = {}) {
  const base = {
    group: PROVIDER_GROUP,
    target,
    scope,
    steps: [],
    reloadHint: '/reload-plugins',
  };

  if (!PROVIDERS.some((provider) => provider.id === target)) {
    return {
      ...base,
      status: 'refused',
      reason: 'unknown-provider',
      detail: `"${target}" is not a known ${PROVIDER_GROUP} provider. Known providers: ${PROVIDERS.map(
        (provider) => provider.id
      ).join(', ')}.`,
    };
  }
  if (!WRITABLE_SCOPES.includes(scope)) {
    return {
      ...base,
      status: 'refused',
      reason: 'invalid-scope',
      detail: `"${scope}" is not a writable installation scope. Choose one of: ${WRITABLE_SCOPES.join(', ')}.`,
    };
  }

  const { providers } = summarizeProviders(plugins, { projectPath });
  const targetEntry = providers[target];
  const others = PROVIDERS.filter((provider) => provider.id !== target).map(
    (provider) => providers[provider.id]
  );

  // Fail closed on anything managed BEFORE emitting a single step.
  if (targetEntry.managedDisabled) {
    return {
      ...base,
      status: 'refused',
      reason: 'managed-conflict',
      detail: `${targetEntry.plugin} is force-disabled at managed scope. Managed plugins are administrator-controlled and cannot be enabled locally; ask your administrator to change the managed settings.`,
    };
  }
  const managedBlockers = others.filter((entry) => entry.managedEnabled);
  if (managedBlockers.length > 0) {
    return {
      ...base,
      status: 'refused',
      reason: 'managed-conflict',
      detail: `${managedBlockers
        .map((entry) => entry.plugin)
        .join(
          ' and '
        )} is enabled at managed scope and cannot be disabled, so "${target}" cannot become the only enabled provider. Ask your administrator to change the managed settings.`,
    };
  }

  const steps = [];
  const targetMarketplace = targetEntry.marketplaces[0] || marketplace;
  const targetRef = `${targetEntry.plugin}@${targetMarketplace}`;

  if (!targetEntry.installed) {
    steps.push({
      action: 'install',
      provider: target,
      scope,
      // Installing pulls code onto the machine — the one step that always
      // needs an explicit yes, even when the rest of the plan is approved.
      requiresConfirmation: true,
      description: `Install ${targetEntry.plugin} at ${scope} scope`,
      command: `claude plugin install ${targetRef} --scope ${scope}`,
    });
  }

  steps.push({
    action: 'enable',
    provider: target,
    scope,
    requiresConfirmation: false,
    description: `Enable ${targetEntry.plugin} at ${scope} scope`,
    // --scope is always explicit: `enable`/`disable` default to
    // auto-detect, which would silently pick a scope the user did not ask
    // for when the plugin is present at several.
    command: `claude plugin enable ${targetRef} --scope ${scope}`,
  });

  for (const other of others) {
    for (const otherScope of [...new Set(other.enabledScopes)]) {
      if (otherScope === 'managed') {
        // Unreachable: the managed pre-check above already refused. Kept as
        // a fail-closed backstop so a future edit to the pre-check cannot
        // silently start emitting a command the CLI will reject.
        return {
          ...base,
          status: 'refused',
          reason: 'managed-conflict',
          detail: `${other.plugin} is enabled at managed scope and cannot be disabled.`,
        };
      }
      const otherRef = `${other.plugin}@${other.marketplaces[0] || marketplace}`;
      steps.push({
        action: 'disable',
        provider: other.id,
        scope: otherScope,
        requiresConfirmation: false,
        description: `Disable ${other.plugin} at ${otherScope} scope`,
        command: `claude plugin disable ${otherRef} --scope ${otherScope}`,
      });
    }
  }

  return { ...base, status: 'ok', steps };
}

/**
 * Fold executed-step results back into a single outcome.
 *
 * `results[i]` corresponds to `plan.steps[i]` and needs only `{ ok:
 * boolean }` (extra fields such as exitCode/stderr are passed through in
 * the report). The first failure aborts: every later step is reported as
 * NOT RUN. There is deliberately no recovery branch and no fallback to the
 * other provider — a half-applied switch must surface as a half-applied
 * switch.
 */
function summarizeSwitchOutcome(plan, results) {
  const steps = (plan && plan.steps) || [];
  const observed = Array.isArray(results) ? results : [];
  const completed = [];

  for (let index = 0; index < steps.length; index += 1) {
    const result = observed[index];
    if (result === undefined) {
      return {
        status: 'incomplete',
        completed,
        failedStep: null,
        notRun: steps.slice(index),
        message: `Only ${index} of ${steps.length} step(s) reported a result. Provider state is unknown — re-run /stack:status before doing anything else.`,
      };
    }
    if (result.ok !== true) {
      return {
        status: 'failed',
        completed,
        failedStep: { ...steps[index], result },
        notRun: steps.slice(index + 1),
        message: `Step ${index + 1} of ${steps.length} failed: \`${steps[index].command}\`. Remaining steps were NOT run and no other provider was enabled in its place. Fix the failure and re-run /stack:select.`,
      };
    }
    completed.push({ ...steps[index], result });
  }

  return {
    status: 'applied',
    completed,
    failedStep: null,
    notRun: [],
    message: `All ${steps.length} step(s) applied. Run ${plan.reloadHint} to activate the change in this session.`,
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

function readMaybe(filePath) {
  if (!filePath || filePath === true) {
    return null;
  }
  try {
    return filePath === '-'
      ? readFileSync(0, 'utf8')
      : readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function parseToolingFlag(value) {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'yes' || value === 'true' || value === true) {
    return true;
  }
  if (value === 'no' || value === 'false') {
    return false;
  }
  return undefined;
}

function main(argv) {
  const args = parseArgs(argv);
  const mode = args._[0];
  if (mode !== 'classify' && mode !== 'plan') {
    console.error('usage: stack-provider-state.js <classify|plan> [options]');
    return 1;
  }

  let plugins;
  try {
    const raw = readMaybe(args['plugins-file']);
    if (raw === null) {
      console.error(
        'error: --plugins-file is required (path to `claude plugin list --json` output, or "-" for stdin)'
      );
      return 1;
    }
    plugins = JSON.parse(raw);
  } catch (error) {
    console.error(`error: could not read/parse plugin list: ${error.message}`);
    return 1;
  }
  if (!Array.isArray(plugins)) {
    // Fail loud: `claude plugin list --json` emits a flat array. An object
    // here means the shape changed, and silently treating it as "no
    // providers installed" would report UNSELECTED for a configured repo.
    console.error(
      'error: `claude plugin list --json` did not return an array — refusing to classify'
    );
    return 1;
  }

  let intentText;
  try {
    intentText = readMaybe(args['intent-file']);
  } catch (error) {
    console.error(`error: could not read intent file: ${error.message}`);
    return 1;
  }

  const projectPath =
    typeof args['project-path'] === 'string' ? args['project-path'] : null;

  if (mode === 'classify') {
    const tooling = {};
    const graphite = parseToolingFlag(args['tooling-graphite']);
    const github = parseToolingFlag(args['tooling-github']);
    if (graphite !== undefined) tooling.graphite = graphite;
    if (github !== undefined) tooling.github = github;
    const state = classifyProviderState({
      plugins,
      intent: parseIntent(intentText),
      tooling,
      projectPath,
    });
    console.log(JSON.stringify(state, null, 2));
    return 0;
  }

  const plan = planProviderSwitch({
    plugins,
    target: typeof args.target === 'string' ? args.target : '',
    scope: typeof args.scope === 'string' ? args.scope : 'user',
    projectPath,
  });
  console.log(JSON.stringify(plan, null, 2));
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = {
  PROVIDER_GROUP,
  PROVIDERS,
  STATES,
  WRITABLE_SCOPES,
  parseIntent,
  summarizeProviders,
  classifyProviderState,
  planProviderSwitch,
  summarizeSwitchOutcome,
};
