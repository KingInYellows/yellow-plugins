import type { Register } from 'claude-code';

import {
  appendRow,
  downshiftModel,
  formatStatus,
  fullestWindow,
  pluginOf,
  readLedger,
  type DownshiftConfig,
  type LedgerRow,
  type Window,
} from './policy.ts';

const LEDGER_KEY = 'ledger';
const STATUS_COMMAND = 'claudemod-status';
const DOWNSHIFT_TARGET = 'sonnet';

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
  // read-modify-write so no row is lost.
  let writes: Promise<void> = Promise.resolve();

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
  // own model. Nothing after next may throw, or that .catch would call next
  // a second time and launch the subagent twice.
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
    writes = writes
      .then(async () => {
        const ledger = readLedger(await $.store.get(LEDGER_KEY));
        await $.store.set(LEDGER_KEY, appendRow(ledger, row));
      })
      .catch(() => undefined);
    await writes;

    return result;
  }).catch(($, e, next) => next(e));

  on('command.run', { command: STATUS_COMMAND }, async ($, e) => {
    const asked = Number.parseInt(e.args.trim(), 10);
    const tail =
      Number.isFinite(asked) && asked > 0 ? Math.min(asked, 100) : 10;
    await writes;
    const ledger = readLedger(await $.store.get(LEDGER_KEY));
    return { text: formatStatus(windows, config, ledger, tail) };
  }).catch(() => ({
    text: 'yellow-claudemod: the status command failed; see claude --debug.',
  }));
};
