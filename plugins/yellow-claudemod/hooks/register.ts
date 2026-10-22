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

// Waits on work against the store, rejecting once STORE_TIMEOUT_MS passes so
// a store call that never settles cannot stall a hook; the work runs on.
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

// Drops the oldest session keys past the cap. Not part of the ledger's
// read-modify-write; a failure is retried after the next write.
async function pruneLedgerKeys(
  $: EngineInterface,
  ownKey: string
): Promise<void> {
  try {
    for (const old of ledgerKeysToPrune(await $.store.keys(), ownKey)) {
      await $.store.delete(old);
    }
  } catch {
    // Retried after the next write.
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
  // read-modify-write so no row is lost. The chain itself is never cut short:
  // a store call cannot be cancelled, so a step that moved on early could
  // land its stale row list over a later one. Waiters bound their wait
  // instead, and while the chain is stalled spawns stop waiting on it.
  let writes: Promise<void> = Promise.resolve();
  let isChainStalled = false;
  // The pending prune, if any: see pruneLedgerKeys.
  let pruning: Promise<void> | undefined;
  // The last failed write per ledger key: /clear changes the session id
  // mid-module, and each session reports only its own.
  // Each entry remembers the spawn that recorded it, so a success clears only
  // its own failure, never a newer queued spawn's.
  const writeFailures = new Map<string, WriteFailure & { spawn: number }>();
  let spawnCount = 0;
  const recordFailure = (
    key: string,
    spawn: number,
    ts: string,
    err: unknown
  ): void => {
    if ((writeFailures.get(key)?.spawn ?? -1) > spawn) return;
    writeFailures.set(key, {
      spawn,
      ts,
      reason: err instanceof Error ? err.message : String(err),
    });
  };

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
    const spawn = (spawnCount += 1);
    const key = await bounded($, () => sessionLedgerKey($)).catch(() =>
      ledgerKeyFor('unknown')
    );
    const step = writes.then(async () => {
      try {
        const ledger = readLedger(await $.store.get(key));
        await $.store.set(key, appendRow(ledger, row));
        if ((writeFailures.get(key)?.spawn ?? -1) <= spawn) {
          writeFailures.delete(key);
        }
      } catch (err) {
        recordFailure(key, spawn, ts, err);
      }
      // Pruning runs beside the chain, one at a time: a store call that
      // never answers there must not hold up later rows.
      if (pruning === undefined) {
        pruning = pruneLedgerKeys($, key).finally(() => {
          pruning = undefined;
        });
      }
      if (writes === step) isChainStalled = false;
    });
    writes = step;
    if (isChainStalled) {
      // Queued behind a stalled write; cleared if the row lands later.
      recordFailure(key, spawn, ts, 'an earlier ledger write is still pending');
    } else {
      try {
        await bounded($, () => step);
      } catch (err) {
        isChainStalled = true;
        recordFailure(key, spawn, ts, err);
      }
    }

    return result;
  }).catch(($, e, next) => next(e));

  on('command.run', { command: STATUS_COMMAND }, async ($, e) => {
    const asked = Number.parseInt(e.args.trim(), 10);
    const tail =
      Number.isFinite(asked) && asked > 0 ? Math.min(asked, 100) : 10;
    await bounded($, () => Promise.all([writes, pruning])).catch(
      () => undefined
    );
    const ownKey = await bounded($, () => sessionLedgerKey($)).catch(() =>
      ledgerKeyFor('unknown')
    );
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
        writeFailures.get(ownKey)
      ),
    };
  }).catch(() => ({
    text: 'yellow-claudemod: the status command failed; see claude --debug.',
  }));
};
