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
 *   --tooling-graphite <yes|no|unknown>  probe result (omit/unknown ⇒ not checked)
 *   --tooling-github <yes|no|unknown>    probe result (omit/unknown ⇒ not checked)
 *   --tooling-probe-file <path|->  raw `stack-tooling-probe.js probe` JSON
 *                                  output; an alternative to the two flags
 *                                  above that lets a caller pipe the probe's
 *                                  output straight through with no bash-side
 *                                  JSON parsing. When both are given, the
 *                                  explicit --tooling-* flags win per key.
 *
 * Output is a single JSON object on stdout. Exit code is 0 for a successful
 * classification/plan (including a REFUSED plan — refusal is an answer, not
 * a crash) and 1 only when the inputs could not be read or parsed.
 */

'use strict';

const { readFileSync, lstatSync } = require('fs');

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

/** Every scope value the model knows about, writable or not. */
const KNOWN_SCOPES = Object.freeze([...WRITABLE_SCOPES, 'managed']);

/**
 * Normalize a scope value from `claude plugin list --json` for DISPLAY.
 *
 * The scope string is untrusted CLI output. `planProviderSwitch` refuses
 * to build a command around a value outside `KNOWN_SCOPES` (see the
 * `scopesRaw`/`enabledScopesRaw` fields it consumes instead); this
 * function is for read-only reporting paths (`/stack:status`), which must
 * never echo an unrecognized scope string verbatim into a report.
 *
 * @param {unknown} scope
 * @returns {string}
 */
function sanitizeScope(scope) {
  return KNOWN_SCOPES.includes(scope) ? scope : 'unknown';
}

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
  CONFIG_INVALID: 'CONFIG_INVALID',
  MANAGED_CONFLICT: 'MANAGED_CONFLICT',
  PARTIAL_TOOLING: 'PARTIAL_TOOLING',
});

/**
 * Fixed reason codes for an intent that could not be resolved to a valid
 * provider id. Every branch of `resolveIntent`/`parseIntentText` returns one
 * of these — never a free-text string — so `CONFIG_INVALID` consumers can
 * switch on `reason` instead of pattern-matching prose.
 */
const INTENT_INVALID_REASONS = Object.freeze({
  MISSING_KEY: 'missing-provider-key',
  EMPTY_VALUE: 'empty-value',
  UNKNOWN_PROVIDER: 'unknown-provider',
  DUPLICATE_KEYS: 'duplicate-keys',
  MALFORMED_SYNTAX: 'malformed-syntax',
  UNREADABLE: 'unreadable',
  NON_REGULAR_FILE: 'non-regular-file',
  SYMLINK: 'symlink',
});

/** Provider id -> the READY_* state that id produces. */
const READY_STATE_BY_ID = Object.freeze({
  graphite: STATES.READY_GRAPHITE,
  github: STATES.READY_GITHUB,
});

/**
 * Parse the value portion of one `provider:` line (everything after the
 * key), returning either the extracted value or a MALFORMED_SYNTAX
 * verdict. Split out of `parseIntentText` because a single combined regex
 * alternation (quoted-or-bare) lets an UNTERMINATED quote silently fall
 * through to the bare alternative — `"github` (missing closing quote) would
 * otherwise be accepted as the literal bare value `"github`, misreported as
 * UNKNOWN_PROVIDER instead of MALFORMED_SYNTAX. Once the value starts with
 * a quote character, ONLY a properly closed quote is valid; there is no
 * fallback to the bare grammar.
 *
 * The whitespace class is `[ \t]`, NOT `\s` — `\s` matches newlines, so a
 * `\s*`-separated pattern would happily read the value off the NEXT line.
 *
 * @param {string} afterKey - text following `provider:` on its line.
 * @returns {{ ok: true, value: string } | { ok: false }}
 */
function parseIntentValue(afterKey) {
  const rest = afterKey.replace(/^[ \t]*/, '');
  if (rest.startsWith('"') || rest.startsWith("'")) {
    const quoteChar = rest[0];
    const closeIndex = rest.indexOf(quoteChar, 1);
    if (closeIndex === -1) {
      return { ok: false };
    }
    const trailing = rest.slice(closeIndex + 1);
    if (!/^[ \t]*(#.*)?$/.test(trailing)) {
      return { ok: false };
    }
    return { ok: true, value: rest.slice(1, closeIndex) };
  }
  const bareMatch = /^([^\s#]*)[ \t]*(#.*)?$/.exec(rest);
  if (!bareMatch) {
    return { ok: false };
  }
  return { ok: true, value: bareMatch[1] };
}

/**
 * Parse already-read `.yellow-stack.yml` text into a structured intent
 * result. Pure function, no I/O — `resolveIntent` below handles the
 * filesystem-level cases (absent/symlink/non-regular/unreadable) before
 * text ever reaches this function, so an empty string here means "the file
 * exists, is a regular file, and is empty" (an INVALID case), never
 * "absent" — those are deliberately not collapsible into one meaning
 * anymore. See `plans/stacked-pr-provider-abstraction.md` deferred-work
 * item 8, which this function resolves.
 *
 * @param {string} text - raw file contents (already confirmed readable).
 * @returns {{ kind: 'valid', provider: string } |
 *           { kind: 'invalid', reason: string, rawValue?: string }}
 */
function parseIntentText(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  // Every line that BEGINS with the key, well-formed value or not — this is
  // deliberately looser than INTENT_VALUE_LINE_RE so a malformed line still
  // counts toward "how many provider: keys does this file declare",
  // matching duplicate-key detection to what a real YAML parser would key
  // on (the key, not whether the value happens to parse).
  const keyLines = normalized.match(/^provider:.*$/gm) || [];

  if (keyLines.length === 0) {
    return { kind: 'invalid', reason: INTENT_INVALID_REASONS.MISSING_KEY };
  }
  if (keyLines.length > 1) {
    // A file with duplicate keys is malformed and its intent is ambiguous:
    // another YAML consumer may take the last value or reject the file
    // outright, so silently guessing from one match could route operations
    // to one provider while the rest of the toolchain believes another.
    return { kind: 'invalid', reason: INTENT_INVALID_REASONS.DUPLICATE_KEYS };
  }

  const parsedValue = parseIntentValue(keyLines[0].slice('provider:'.length));
  if (!parsedValue.ok) {
    return { kind: 'invalid', reason: INTENT_INVALID_REASONS.MALFORMED_SYNTAX };
  }
  const value = parsedValue.value.trim();
  if (value.length === 0) {
    return { kind: 'invalid', reason: INTENT_INVALID_REASONS.EMPTY_VALUE };
  }
  if (!PROVIDERS.some((provider) => provider.id === value)) {
    return {
      kind: 'invalid',
      reason: INTENT_INVALID_REASONS.UNKNOWN_PROVIDER,
      rawValue: value,
    };
  }
  return { kind: 'valid', provider: value };
}

/**
 * Read `.yellow-stack.yml` off disk WITHOUT following a symlink, and
 * without assuming the path is a regular file. Returns one of:
 *   - `{ kind: 'absent' }` — no file at this path (ENOENT).
 *   - `{ kind: 'text', text }` — successfully read as a regular file.
 *   - `{ kind: 'invalid', reason }` — exists but is a symlink, a
 *     non-regular file (FIFO, device, directory, ...), or could not be
 *     read for any other reason (permissions, race).
 *
 * `lstatSync` (not `statSync`) is deliberate: a symlinked
 * `.yellow-stack.yml` could point outside the repository (e.g. `/etc/…` or
 * an absolute path planted by a malicious contributor), and following it
 * would read arbitrary filesystem content as "repository intent". Refusing
 * to follow the link, rather than reading through it, is the security
 * control — see the equivalent guard in `commands/stack/select.md`'s write
 * path.
 *
 * @param {string|null|undefined} filePath
 */
function readIntentFile(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    return { kind: 'absent' };
  }
  if (filePath === '-') {
    // Stdin has no filesystem identity to lstat; only used by tests/CLI
    // callers that pipe text directly, never by the shipped commands.
    try {
      return { kind: 'text', text: readFileSync(0, 'utf8') };
    } catch {
      return { kind: 'invalid', reason: INTENT_INVALID_REASONS.UNREADABLE };
    }
  }

  let stat;
  try {
    stat = lstatSync(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { kind: 'absent' };
    }
    return { kind: 'invalid', reason: INTENT_INVALID_REASONS.UNREADABLE };
  }
  if (stat.isSymbolicLink()) {
    return { kind: 'invalid', reason: INTENT_INVALID_REASONS.SYMLINK };
  }
  if (!stat.isFile()) {
    return { kind: 'invalid', reason: INTENT_INVALID_REASONS.NON_REGULAR_FILE };
  }
  try {
    return { kind: 'text', text: readFileSync(filePath, 'utf8') };
  } catch {
    return { kind: 'invalid', reason: INTENT_INVALID_REASONS.UNREADABLE };
  }
}

/**
 * Single entry point every caller uses to resolve `.yellow-stack.yml`
 * intent — the ONLY function outside this module that reads the intent
 * file. Combines `readIntentFile` (filesystem-level) with `parseIntentText`
 * (grammar-level) into one of exactly three shapes:
 *   - `{ kind: 'absent', provider: null, invalid: null }` — no intent
 *     recorded. A normal, non-error state (`UNSELECTED` territory).
 *   - `{ kind: 'valid', provider: <id>, invalid: null }` — a well-formed,
 *     known provider id.
 *   - `{ kind: 'invalid', provider: null, invalid: { reason, rawValue? } }`
 *     — the file exists but could not be resolved to a provider id. Never
 *     collapsed into `absent` — see deferred-work item 8.
 *
 * @param {string|null|undefined} filePath - path to `.yellow-stack.yml`, or
 *   `"-"` for stdin, or a falsy value meaning "no path given".
 */
function resolveIntent(filePath) {
  const fileResult = readIntentFile(filePath);
  if (fileResult.kind === 'absent') {
    return { kind: 'absent', provider: null, invalid: null };
  }
  if (fileResult.kind === 'invalid') {
    return {
      kind: 'invalid',
      provider: null,
      invalid: { reason: fileResult.reason },
    };
  }
  const parsed = parseIntentText(fileResult.text);
  if (parsed.kind === 'valid') {
    return { kind: 'valid', provider: parsed.provider, invalid: null };
  }
  return {
    kind: 'invalid',
    provider: null,
    invalid:
      parsed.rawValue === undefined
        ? { reason: parsed.reason }
        : { reason: parsed.reason, rawValue: parsed.rawValue },
  };
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
      // Match the canonical `plugin@yellow-plugins` ID, not just the
      // plugin name. Splitting off the marketplace and comparing name
      // alone would accept a same-named plugin published under a
      // DIFFERENT marketplace (e.g. `gt-workflow@another-marketplace`)
      // as the official provider, letting an unrelated install drive
      // classification and command generation.
      if (row.id !== `${provider.plugin}@${DEFAULT_MARKETPLACE}`) {
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
    const scopesRaw = entries.map((entry) => entry.scope);
    const enabledScopesRaw = enabledEntries.map((entry) => entry.scope);
    summary[provider.id] = {
      id: provider.id,
      plugin: provider.plugin,
      installed: entries.length > 0,
      enabled: enabledEntries.length > 0,
      // Sanitized for display: an unrecognized scope string is never
      // echoed verbatim (see sanitizeScope). Callers that must build a
      // command around the real value — `planProviderSwitch` — use
      // `scopesRaw`/`enabledScopesRaw` below instead.
      scopes: scopesRaw.map(sanitizeScope),
      enabledScopes: enabledScopesRaw.map(sanitizeScope),
      scopesRaw,
      enabledScopesRaw,
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
 *   MANAGED_CONFLICT > CONFLICT > CONFIG_INVALID > CONFIG_MISMATCH >
 *   UNSELECTED > PARTIAL_TOOLING > READY_*
 *
 * CONFIG_INVALID outranks CONFIG_MISMATCH deliberately: CONFIG_MISMATCH
 * means "we know what you asked for and the runtime disagrees"; CONFIG_INVALID
 * means "we could not even determine what you asked for" — a strictly worse
 * starting point that must never be papered over by falling through to
 * UNSELECTED (which would imply "no opinion recorded", not "an opinion was
 * recorded but is broken").
 *
 * @param {{
 *   plugins: Array<object>,
 *   intent?: string|null,
 *   intentInvalid?: { reason: string, rawValue?: string }|null,
 *   tooling?: { [providerId: string]: boolean|null|undefined },
 *   projectPath?: string|null,
 * }} input
 */
function classifyProviderState({
  plugins,
  intent = null,
  intentInvalid = null,
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

  // The classifier's output is printed (by `/stack:status` and the
  // stack-provider-router skill) — it must never carry the raw,
  // unsanitized `scopesRaw`/`enabledScopesRaw` CLI strings that exist
  // solely for `planProviderSwitch`'s refusal check. Build fresh objects
  // rather than mutating the ones `summarizeProviders` returned: this
  // function's `providers` binding (used below for state logic) and
  // `planProviderSwitch`'s own independent `summarizeProviders` call both
  // still need the raw fields intact.
  const displayProviders = {};
  for (const [id, entry] of Object.entries(providers)) {
    const safeEntry = { ...entry };
    delete safeEntry.scopesRaw;
    delete safeEntry.enabledScopesRaw;
    displayProviders[id] = safeEntry;
  }

  const result = {
    group: PROVIDER_GROUP,
    intent,
    intentKnown: intent === null ? null : known,
    // Always present (null when the intent file was absent or valid) so
    // every consumer can branch on its presence without an `in` check.
    intentInvalid,
    providers: displayProviders,
    projectScopeFiltered,
    // `false` means at least one relevant probe was never run. Callers must
    // say "not checked" rather than implying a clean tooling result.
    // `null` when nothing is enabled — `Array.every` is vacuously `true` on
    // an empty array, which would otherwise misreport "checked" when no
    // probe was relevant to consume in the first place.
    toolingKnown:
      enabled.length === 0
        ? null
        : enabled.every((entry) => typeof tooling[entry.id] === 'boolean'),
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

  // A managed row force-disabling a provider that is STILL enabled at a
  // lower scope is a MANAGED_CONFLICT independent of `.yellow-stack.yml`
  // intent — the administrator's setting overrides any lower-scope row
  // whether or not a repository has recorded an opinion. `managedDisabled`
  // ALONE is not a conflict: a provider force-disabled and not enabled
  // anywhere else is simply not enabled, the ordinary, correct state. The
  // conflict is specifically the combination of both.
  const overriddenByManaged = PROVIDERS.map(
    (provider) => providers[provider.id]
  ).filter((entry) => entry.managedDisabled && entry.enabled);
  if (overriddenByManaged.length > 0) {
    const target = overriddenByManaged[0];
    return {
      ...result,
      state: STATES.MANAGED_CONFLICT,
      detail: `${target.plugin} is force-disabled at managed scope, which cannot be changed, but it is still enabled at ${target.enabledScopes.join('/')} scope. The managed setting overrides lower-scope configuration.`,
    };
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

  // 3. CONFIG_INVALID — .yellow-stack.yml exists but could not be resolved
  //    to a valid provider id (missing key, empty value, unknown provider,
  //    duplicate keys, malformed syntax, or an unreadable/non-regular/
  //    symlink file). This must never collapse into UNSELECTED: the file
  //    IS recorded intent, it is just broken, and /stack:select must
  //    refuse to silently overwrite it (see commands/stack/select.md
  //    Step 7).
  if (intentInvalid !== null) {
    const rawValueSuffix =
      typeof intentInvalid.rawValue === 'string'
        ? ` ("${intentInvalid.rawValue}")`
        : '';
    return {
      ...result,
      state: STATES.CONFIG_INVALID,
      detail: `.yellow-stack.yml could not be resolved to a valid provider intent: ${intentInvalid.reason}${rawValueSuffix}. Fix or remove the file — /stack:select will not overwrite it automatically.`,
    };
  }

  // 4. CONFIG_MISMATCH — .yellow-stack.yml records an intent the runtime
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

  // 5. UNSELECTED — no intent recorded and nothing enabled.
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

  // 6. PARTIAL_TOOLING — the right plugin is enabled but its CLI is
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

  // 7/8. READY_*.
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

  // Disable every other provider BEFORE installing or enabling the target.
  // `claude plugin install` leaves the installed plugin enabled, so
  // installing first (when the target is absent) would open a window where
  // both providers are enabled at once, violating the single-provider
  // invariant (stack-provider-guard skill, invariant 1) even if only until
  // the next step runs.
  for (const other of others) {
    // Raw, unsanitized scopes: refusing on a malformed value here is the
    // security control, so it must see the actual CLI output, not the
    // "unknown" placeholder `enabledScopes` substitutes for display.
    for (const otherScope of [...new Set(other.enabledScopesRaw)]) {
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
      if (!WRITABLE_SCOPES.includes(otherScope)) {
        // `enabledScopes` is derived from `claude plugin list --json`,
        // untrusted CLI output. A malformed or unexpected scope value must
        // never reach the interpolated `command` string below — allowlist
        // and refuse rather than escape.
        return {
          ...base,
          status: 'refused',
          reason: 'invalid-scope',
          detail: `${other.plugin} reports an unrecognized scope "${otherScope}". Refusing to build a plan around it.`,
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

  if (!targetEntry.scopesRaw.includes(scope)) {
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
  // `unknown` is an EXPLICIT probe outcome, not a parse failure: the
  // callers' `gh extension list` probe emits it when the command itself
  // failed, so the extension's state was never read. It maps to
  // `undefined` — the same "not checked" the flag's absence means — and
  // must never map to `false`, which would classify as PARTIAL_TOOLING and
  // tell the user to reinstall tooling that was never actually probed.
  // Listed explicitly so a future tightening of this parser cannot
  // silently turn that fail-open back on.
  if (value === 'unknown') {
    return undefined;
  }
  return undefined;
}

/**
 * Translate `stack-tooling-probe.js probe` JSON output into this module's
 * tooling-flag shape (`{ graphite?: boolean, github?: boolean }`).
 * `readiness: 'ready'` -> true, `'not-ready'` -> false, `'unknown'` (or a
 * provider key that is absent because `--provider` narrowed the probe) ->
 * omitted entirely, matching `parseToolingFlag`'s "unknown means not
 * checked" contract.
 *
 * @param {unknown} probeJson - parsed `stack-tooling-probe.js probe` output.
 */
function toolingFromProbeResult(probeJson) {
  const tooling = {};
  if (probeJson && typeof probeJson === 'object') {
    for (const id of ['graphite', 'github']) {
      const entry = probeJson[id];
      const readiness = entry && typeof entry === 'object' ? entry.readiness : undefined;
      if (readiness === 'ready') tooling[id] = true;
      else if (readiness === 'not-ready') tooling[id] = false;
      // 'unknown', missing entry, or malformed shape: leave unset.
    }
  }
  return tooling;
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

  // resolveIntent never throws — every filesystem failure it can hit
  // (ENOENT, symlink, non-regular, permission) is captured in its return
  // shape rather than propagated, so classification always produces a
  // state rather than crashing on a hostile or broken intent file.
  const resolvedIntent = resolveIntent(args['intent-file']);

  const projectPath =
    typeof args['project-path'] === 'string' ? args['project-path'] : null;

  if (mode === 'classify') {
    let tooling = {};
    const probeFile = args['tooling-probe-file'];
    if (typeof probeFile === 'string') {
      let probeRaw;
      try {
        probeRaw = readMaybe(probeFile);
      } catch (error) {
        console.error(`error: could not read tooling probe file: ${error.message}`);
        return 1;
      }
      if (probeRaw !== null) {
        try {
          tooling = toolingFromProbeResult(JSON.parse(probeRaw));
        } catch (error) {
          console.error(`error: could not parse tooling probe file as JSON: ${error.message}`);
          return 1;
        }
      }
    }
    // Explicit --tooling-graphite/--tooling-github always win over the
    // probe file per key, so a caller can override one provider's result
    // (tests, or a caller that only re-probed one side) without having to
    // regenerate the whole probe JSON.
    const graphite = parseToolingFlag(args['tooling-graphite']);
    const github = parseToolingFlag(args['tooling-github']);
    if (graphite !== undefined) tooling.graphite = graphite;
    if (github !== undefined) tooling.github = github;
    const state = classifyProviderState({
      plugins,
      intent: resolvedIntent.provider,
      intentInvalid: resolvedIntent.invalid,
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
  INTENT_INVALID_REASONS,
  WRITABLE_SCOPES,
  parseIntentText,
  readIntentFile,
  resolveIntent,
  toolingFromProbeResult,
  summarizeProviders,
  classifyProviderState,
  planProviderSwitch,
  summarizeSwitchOutcome,
};
