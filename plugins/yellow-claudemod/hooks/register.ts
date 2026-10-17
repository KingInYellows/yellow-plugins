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
    const usage = await $.session.usage();
    windows = [...usage.rateLimits];
    return next(e);
  });

  on('session.measure', ($, e, next) => {
    windows = [...e.rateLimits];
    return next(e);
  });

  // Observes every spawn and may downshift an allowlisted Opus agent. Not a
  // guard: on a failure the .catch below lets the spawn go ahead on its own
  // model (or replays what next already settled to), which is the safe side.
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
    const result = await next(model === undefined ? e : { ...e, model });
    const top = fullestWindow(windows);

    if (model !== undefined && !hasToasted) {
      hasToasted = true;
      $.ui.toast(
        `yellow-claudemod: ${top?.kind ?? 'usage'} window at ${top?.percentUsed ?? '?'}%, ` +
          `running listed Opus reviewers on ${model}`
      );
    }

    const row: LedgerRow = {
      ts: new Date(await $.clock.now()).toISOString(),
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
