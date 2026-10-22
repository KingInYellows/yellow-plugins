import type { EngineInterface, Register } from 'claude-code';

import {
  appendRow,
  downshiftModel,
  formatStatus,
  fullestWindow,
  isLedgerKey,
  ledgerKeyFor,
  ledgerKeysToPrune,
  mergeLedgers,
  pluginOf,
  readLedger,
  type DownshiftConfig,
  type LedgerRow,
  type Window,
  type WriteFailure,
} from './policy.ts';

const STATUS_COMMAND = 'claudemod-status';
const DOWNSHIFT_TARGET = 'sonnet';
// How long one ledger step may wait on the store before it counts as failed.
const STORE_TIMEOUT_MS = 2000;

// Runs work against the store, rejecting once STORE_TIMEOUT_MS passes so a
// store call that never settles cannot stall the spawn hook or the chain.
async function bounded<T>(
  $: EngineInterface,
  work: () => Promise<T>
): Promise<T> {
  const timer = new AbortController();
  try {
    return await Promise.race([
      work(),
      $.clock
        .sleep(STORE_TIMEOUT_MS, { signal: timer.signal })
        .then((): never => {
          throw new Error(`store did not answer in ${STORE_TIMEOUT_MS} ms`);
        }),
    ]);
  } finally {
    timer.abort();
  }
}

// The id changes on /clear without a new session.start, so ask each time.
async function sessionLedgerKey($: EngineInterface): Promise<string> {
  try {
    return ledgerKeyFor(await $.session.id());
  } catch {
    return ledgerKeyFor('unknown');
  }
}

function readConfig(
  options: Readonly<Record<string, unknown>>
): DownshiftConfig {
  const threshold = Number(options.downshift_threshold);
  return {
    enabled: options.downshift_enabled === true,
    thresholdPercent:
      Number.isFinite(threshold) && threshold > 0 && threshold <= 100
        ? threshold
        : 80,
    model: DOWNSHIFT_TARGET,
  };
}

export const register: Register = (on, options) => {
  const config = readConfig(options);
  // The latest rate-limit windows, pushed by session.measure; module state,
  // so a reload starts empty until the next measurement.
  let windows: Window[] = [];
  let hasToasted = false;
  // Spawns in a review fan-out land together; chain the store's
  // read-modify-write so no row is lost. Each step is bounded, so the chain
  // always moves on.
  let writes: Promise<void> = Promise.resolve();
  let writeFailure: WriteFailure | undefined;

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: STATUS_COMMAND,
      description:
        'Show usage windows, the downshift setting and recent subagent spawns',
      argumentHint: '[rows]',
      immediate: true,
    });
    // Optional: session.measure fills the windows in later anyway.
    try {
      windows = [...(await $.session.usage()).rateLimits];
    } catch {
      windows = [];
    }
    return next(e);
  });

  on('session.measure', ($, e, next) => {
    windows = [...e.rateLimits];
    return next(e);
  });

  // Observes every spawn and may downshift an allowlisted Opus agent. Not a
  // guard: a failure before next lets the .catch below run the spawn on its
  // own model; after next, the engine's next(e) replays what that call
  // settled to, so the subagent never runs twice.
  on('agent.spawn', async ($, e, next) => {
    const plugin = pluginOf(e.subagentType, e.provider?.plugin);
    const model = downshiftModel(
      {
        subagentType: e.subagentType,
        plugin,
        requestedModel: e.model,
        fork: e.fork,
        isResume: e.resume !== undefined,
      },
      windows,
      config
    );
    // Snapshot at spawn time: next resolves when the subagent finishes.
    const top = fullestWindow(windows);
    const ts = new Date(await $.clock.now()).toISOString();
    const result = await next(model === undefined ? e : { ...e, model });

    if (model !== undefined && !hasToasted) {
      hasToasted = true;
      try {
        $.ui.toast(
          `yellow-claudemod: ${top?.kind ?? 'usage'} window at ${top?.percentUsed ?? '?'}%, ` +
            `running listed Opus reviewers on ${model}`
        );
      } catch {
        // A lost toast is cosmetic; the ledger row still records the downshift.
      }
    }

    const row: LedgerRow = {
      ts,
      subagentType: e.subagentType,
      plugin,
      requested: e.model ?? null,
      resolved: result.deny === undefined ? result.model : null,
      parentModel: e.parentModel,
      downshifted: model !== undefined && result.deny === undefined,
      windowPercent: top?.percentUsed ?? null,
      workflow: e.workflow !== undefined,
      denied: result.deny !== undefined,
    };
    writes = writes.then(async () => {
      // A timed-out step's work keeps running (store calls cannot be
      // cancelled); once the chain has moved on it must not write a stale
      // row list over a later step's.
      let isAbandoned = false;
      try {
        await bounded($, async () => {
          const key = await sessionLedgerKey($);
          const ledger = readLedger(await $.store.get(key));
          if (isAbandoned) return;
          await $.store.set(key, appendRow(ledger, row));
          for (const old of ledgerKeysToPrune(await $.store.keys(), key)) {
            if (isAbandoned) return;
            await $.store.delete(old);
          }
        });
        writeFailure = undefined;
      } catch (err) {
        isAbandoned = true;
        writeFailure = {
          ts,
          reason: err instanceof Error ? err.message : String(err),
        };
      }
    });
    await writes;

    return result;
  }).catch(($, e, next) => next(e));

  on('command.run', { command: STATUS_COMMAND }, async ($, e) => {
    const asked = Number.parseInt(e.args.trim(), 10);
    const tail =
      Number.isFinite(asked) && asked > 0 ? Math.min(asked, 100) : 10;
    await writes;
    const keys = (await bounded($, () => $.store.keys())).filter(isLedgerKey);
    const ledgers = await bounded($, () =>
      Promise.all(keys.map(async (k) => readLedger(await $.store.get(k))))
    );
    return {
      text: formatStatus(
        windows,
        config,
        mergeLedgers(ledgers),
        tail,
        keys.length,
        writeFailure
      ),
    };
  }).catch(() => ({
    text: 'yellow-claudemod: the status command failed; see claude --debug.',
  }));
};
