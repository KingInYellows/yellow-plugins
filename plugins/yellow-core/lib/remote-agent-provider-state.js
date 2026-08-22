#!/usr/bin/env node

/**
 * remote-agent-provider-state.js — the single owner of remote-agent provider
 * state (which member of the `remote-agent` capability group is active:
 * Cursor cloud agents via yellow-cursor, or Devin sessions via yellow-devin).
 *
 * Deliberately smaller than its sibling
 * plugins/yellow-core/lib/stack-provider-state.js:
 *   - No `.yellow-stack.yml`-style intent file in v1 — nothing here builds
 *     or executes a provider switch, so there is no repository intent to
 *     record or resolve against. `/linear:delegate` is the only consumer
 *     and it re-classifies on every invocation.
 *   - No `planProviderSwitch` — there is no "make this the enabled
 *     provider" operation for remote agents (unlike `/stack:select`,
 *     nothing in this milestone enables/disables yellow-cursor or
 *     yellow-devin on the caller's behalf).
 *
 * HARD RULES this module encodes:
 *   - Both providers MAY be installed. Exactly one MAY be enabled.
 *   - Cursor is the PREFERRED provider: UNSELECTED and CONFLICT guidance
 *     recommends it, but this module NEVER auto-selects — it only reports
 *     a state and lets the caller (or its own `--provider` escape hatch,
 *     which lives in `/linear:delegate`, not here) decide.
 *   - This module NEVER executes a command, NEVER reads the environment,
 *     and NEVER reads a file other than `--plugins-file`. The tooling
 *     readiness of each provider is a probe RESULT the caller passes in
 *     (for cursor: whether the yellow-cursor CLI resolved on disk; for
 *     devin: whether its credential env vars are set) — this module has no
 *     opinion on how that probe was performed.
 *
 * CLI:
 *   node remote-agent-provider-state.js classify [options]
 *
 *   --plugins-file <path|->            `claude plugin list --json` output
 *                                       ("-" = stdin)
 *   --project-path <path>              repo root, filters foreign
 *                                       project/local rows
 *   --tooling-cursor <yes|no|unknown>  probe result (omit/unknown ⇒ not
 *                                      checked)
 *   --tooling-devin <yes|no|unknown>   probe result (omit/unknown ⇒ not
 *                                      checked)
 *
 * Output is a single JSON object on stdout.
 *
 * Exit codes: 0 for a successful classification — INCLUDING a CONFIG_INVALID
 * classification. That is a deliberate divergence from
 * stack-provider-state.js, which exits 1 when `claude plugin list --json`
 * doesn't parse to an array. Here, a malformed-but-parseable `--plugins-file`
 * (valid JSON, wrong shape) is classified AS CONFIG_INVALID rather than
 * failing the process, because `/linear:delegate` needs a JSON envelope with
 * a `detail` string to show the user and a state to branch on, not a bare
 * exit code it would have to special-case around the classifier call. Only
 * genuinely unparseable input (the file doesn't contain valid JSON at all,
 * so no value exists to classify) still exits 1 — see `main()`.
 */

'use strict';

const { readFileSync } = require('fs');

/**
 * Canonical provider table for the `remote-agent` capability group.
 *
 * Replica of the `capabilityProvider` declarations in
 * catalog/plugins/{yellow-cursor,yellow-devin}.json — an installed plugin
 * has no access to this repo's catalog at runtime, so the table has to
 * ship. scripts/validate-provider-groups.js parses the marker-delimited
 * block below and fails CI when it disagrees with the catalog
 * (ERROR-PROVIDER-006). Do not reformat the block: the validator matches
 * these exact shapes.
 */
const PROVIDER_GROUP = 'remote-agent';
// provider-table:start
const PROVIDERS = Object.freeze([
  Object.freeze({ id: 'cursor', plugin: 'yellow-cursor' }),
  Object.freeze({ id: 'devin', plugin: 'yellow-devin' }),
]);
// provider-table:end

/** Marketplace this repository's provider plugins are published under. */
const DEFAULT_MARKETPLACE = 'yellow-plugins';

/** Provider id that this module recommends when nothing is enabled or both are. */
const PREFERRED_PROVIDER_ID = 'cursor';

/**
 * The six remote-agent provider states. Exported so consumers compare
 * against a constant rather than a string literal a typo can silently break.
 */
const STATES = Object.freeze({
  UNSELECTED: 'UNSELECTED',
  READY_CURSOR: 'READY_CURSOR',
  READY_DEVIN: 'READY_DEVIN',
  CONFLICT: 'CONFLICT',
  PARTIAL_TOOLING: 'PARTIAL_TOOLING',
  CONFIG_INVALID: 'CONFIG_INVALID',
});

/** Provider id -> the READY_* state that id produces. */
const READY_STATE_BY_ID = Object.freeze({
  cursor: STATES.READY_CURSOR,
  devin: STATES.READY_DEVIN,
});

/**
 * Reduce a raw `claude plugin list --json` array to a per-provider view.
 * Mirrors stack-provider-state.js's `summarizeProviders`: matches the
 * canonical `plugin@marketplace` id (not just the bare plugin name, which
 * would accept a same-named plugin published under a different
 * marketplace), folds one row per scope into a single enabled/installed
 * verdict, and optionally drops project/local rows belonging to a
 * different repository.
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
      if (row.id !== `${provider.plugin}@${DEFAULT_MARKETPLACE}`) {
        return false;
      }
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
      scopes: [...new Set(entries.map((entry) => entry.scope))],
      enabledScopes: [...new Set(enabledEntries.map((entry) => entry.scope))],
    };
  }

  return { providers: summary, projectScopeFiltered };
}

/**
 * Classify the current remote-agent provider state.
 *
 * Precedence is first-match-wins, worst-first:
 *   CONFIG_INVALID > CONFLICT > UNSELECTED > PARTIAL_TOOLING > READY_*
 *
 * CONFIG_INVALID is checked FIRST, ahead of even CONFLICT — unlike
 * stack-provider-state.js's CONFIG_INVALID (a broken *intent file*, checked
 * after CONFLICT because the plugin list itself was still trustworthy),
 * this module's CONFIG_INVALID means the `plugins` argument itself is not a
 * usable array, so nothing downstream (including "is it a conflict") can be
 * computed at all.
 *
 * @param {{
 *   plugins: unknown,
 *   tooling?: { cursor?: boolean, devin?: boolean },
 *   projectPath?: string|null,
 * }} input
 */
function classifyRemoteAgentState({
  plugins,
  tooling = {},
  projectPath = null,
} = {}) {
  if (!Array.isArray(plugins)) {
    return {
      group: PROVIDER_GROUP,
      providers: {},
      projectScopeFiltered: false,
      toolingKnown: null,
      state: STATES.CONFIG_INVALID,
      detail:
        '`claude plugin list --json` content passed to the classifier is malformed: expected an array of plugin rows.',
    };
  }

  const { providers, projectScopeFiltered } = summarizeProviders(plugins, {
    projectPath,
  });
  const enabled = PROVIDERS.map((provider) => providers[provider.id]).filter(
    (entry) => entry.enabled
  );

  const result = {
    group: PROVIDER_GROUP,
    providers,
    projectScopeFiltered,
    // `false` means at least one relevant probe was never run. `null` when
    // nothing is enabled — there is no probe relevant to consume yet.
    toolingKnown:
      enabled.length === 0
        ? null
        : enabled.every((entry) => typeof tooling[entry.id] === 'boolean'),
  };

  // 1. CONFLICT — both providers enabled. Two remote-agent providers active
  //    at once is a correctness bug, not redundancy.
  if (enabled.length > 1) {
    return {
      ...result,
      state: STATES.CONFLICT,
      detail: `More than one remote-agent provider is enabled (${enabled
        .map((entry) => `${entry.plugin} @ ${entry.enabledScopes.join('/')}`)
        .join(
          ', '
        )}). Exactly one may be enabled — disable one provider; yellow-cursor is the preferred choice.`,
    };
  }

  // 2. UNSELECTED — nothing enabled.
  if (enabled.length === 0) {
    const installed = PROVIDERS.map(
      (provider) => providers[provider.id]
    ).filter((entry) => entry.installed);
    return {
      ...result,
      state: STATES.UNSELECTED,
      detail:
        installed.length === 0
          ? 'No remote-agent provider is installed. Install and enable yellow-cursor (preferred), or yellow-devin.'
          : `Installed but not enabled: ${installed
              .map((entry) => entry.plugin)
              .join(', ')}. Enable yellow-cursor (preferred), or yellow-devin.`,
    };
  }

  // 3. PARTIAL_TOOLING — the right plugin is enabled but its tooling probe
  //    reported not-ready. Only an explicit `false` counts; an unrun probe
  //    leaves the state READY_* with toolingKnown: false.
  const active = enabled[0];
  if (tooling[active.id] === false) {
    return {
      ...result,
      state: STATES.PARTIAL_TOOLING,
      detail: `${active.plugin} is enabled, but its tooling is not ready (cursor: the CLI could not be resolved; devin: required credential env vars are not set).`,
    };
  }

  // 4. READY_*.
  return {
    ...result,
    state: READY_STATE_BY_ID[active.id],
    detail: `${active.plugin} ("${active.id}") is the single enabled remote-agent provider.`,
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

/**
 * Parse a `--tooling-*` flag value. `unknown` is an EXPLICIT probe outcome
 * (the caller's probe ran but could not determine readiness), not a parse
 * failure — it maps to `undefined` (same as the flag's absence: "not
 * checked"), never to `false`, which would misreport PARTIAL_TOOLING for
 * tooling that was never actually probed.
 */
function parseToolingFlag(value) {
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
  if (mode !== 'classify') {
    console.error('usage: remote-agent-provider-state.js classify [options]');
    return 1;
  }

  const raw = readMaybe(args['plugins-file']);
  if (raw === null) {
    console.error(
      'error: --plugins-file is required (path to `claude plugin list --json` output, or "-" for stdin)'
    );
    return 1;
  }

  // A parse failure here means there is no value at all to classify — this
  // is the one case that still exits 1 rather than returning CONFIG_INVALID
  // (see the module docstring's exit-code note).
  let plugins;
  try {
    plugins = JSON.parse(raw);
  } catch (error) {
    console.error(
      `error: could not parse plugin list as JSON: ${error.message}`
    );
    return 1;
  }

  const projectPath =
    typeof args['project-path'] === 'string' ? args['project-path'] : null;

  const tooling = {};
  const cursor = parseToolingFlag(args['tooling-cursor']);
  const devin = parseToolingFlag(args['tooling-devin']);
  if (cursor !== undefined) tooling.cursor = cursor;
  if (devin !== undefined) tooling.devin = devin;

  const state = classifyRemoteAgentState({ plugins, tooling, projectPath });
  console.log(JSON.stringify(state, null, 2));
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = {
  PROVIDER_GROUP,
  PROVIDERS,
  STATES,
  PREFERRED_PROVIDER_ID,
  summarizeProviders,
  classifyRemoteAgentState,
};
