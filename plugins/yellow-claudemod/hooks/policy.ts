// Pure decision logic for yellow-claudemod, kept apart from register.ts so
// tests can exercise it without an engine.

/**
 * Opus-tier agents the downshift may move to a cheaper model, keyed by
 * plugin, then by the agent's own name (the last `:` segment of its
 * subagentType, so `yellow-core:review:performance-oracle` and
 * `yellow-core:performance-oracle` both match). security-sentinel is left out
 * on purpose: docs/research/model-routing-policy.md has not approved a
 * cheaper model for security review.
 */
export const DOWNSHIFT_AGENTS: Readonly<Record<string, readonly string[]>> = {
  'yellow-core': ['architecture-strategist', 'performance-oracle'],
  'yellow-review': [
    'adversarial-reviewer',
    'agent-cli-readiness-reviewer',
    'agent-native-reviewer',
    'thermonuclear-reviewer',
  ],
  'yellow-debt': ['audit-synthesizer'],
  'yellow-research': ['research-conductor'],
};

export type Window = { kind: string; percentUsed: number; resetsAt?: string };

export type SpawnFacts = {
  subagentType: string;
  plugin: string;
  requestedModel?: string;
  fork: boolean;
  isResume: boolean;
};

export type DownshiftConfig = {
  enabled: boolean;
  thresholdPercent: number;
  model: string;
};

export function agentName(subagentType: string): string {
  const parts = subagentType.split(':');
  return parts[parts.length - 1] ?? subagentType;
}

/**
 * The plugin that provides an agent: the engine's provider when it names a
 * plugin, else the subagentType's first `:` segment (`yellow-core:review:x`).
 */
export function pluginOf(subagentType: string, provider?: string): string {
  if (provider !== undefined && provider !== 'engine') return provider;
  const head = subagentType.split(':')[0] ?? '';
  return subagentType.includes(':') ? head : (provider ?? 'engine');
}

export function isDownshiftCandidate(
  plugin: string,
  subagentType: string
): boolean {
  return (DOWNSHIFT_AGENTS[plugin] ?? []).includes(agentName(subagentType));
}

/** The fullest rate-limit window, or undefined before the first reading. */
export function fullestWindow(windows: readonly Window[]): Window | undefined {
  let top: Window | undefined;
  for (const w of windows) {
    if (top === undefined || w.percentUsed > top.percentUsed) top = w;
  }
  return top;
}

/**
 * The model to run a spawn on instead of its own, or undefined to leave it.
 * Never overrides a caller's explicit model, a fork (which always inherits)
 * or a resume (whose model is fixed).
 */
export function downshiftModel(
  spawn: SpawnFacts,
  windows: readonly Window[],
  config: DownshiftConfig
): string | undefined {
  if (!config.enabled) return undefined;
  if (spawn.fork || spawn.isResume || spawn.requestedModel !== undefined)
    return undefined;
  if (!isDownshiftCandidate(spawn.plugin, spawn.subagentType)) return undefined;
  const top = fullestWindow(windows);
  if (top === undefined || top.percentUsed < config.thresholdPercent)
    return undefined;
  return config.model;
}

export type LedgerRow = {
  ts: string;
  subagentType: string;
  plugin: string;
  requested: string | null;
  resolved: string | null;
  parentModel: string;
  downshifted: boolean;
  windowPercent: number | null;
  workflow: boolean;
  denied: boolean;
};

export const LEDGER_MAX = 500;

export function appendRow(
  ledger: readonly LedgerRow[],
  row: LedgerRow
): LedgerRow[] {
  return [...ledger, row].slice(-LEDGER_MAX);
}

export function isLedgerRow(value: unknown): value is LedgerRow {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.ts === 'string' && typeof row.subagentType === 'string';
}

export function readLedger(value: unknown): LedgerRow[] {
  return Array.isArray(value) ? value.filter(isLedgerRow) : [];
}

/** Plain-text summary for the status command. */
export function formatStatus(
  windows: readonly Window[],
  config: DownshiftConfig,
  ledger: readonly LedgerRow[],
  tail: number
): string {
  const lines: string[] = [];
  lines.push(
    windows.length === 0
      ? 'Usage windows: no reading yet (none until the first response, and none off a subscription).'
      : `Usage windows: ${windows
          .map(
            (w) =>
              `${w.kind} ${w.percentUsed}%${w.resetsAt ? ` (resets ${w.resetsAt})` : ''}`
          )
          .join(', ')}`
  );
  lines.push(
    config.enabled
      ? `Downshift: on, to ${config.model} at ${config.thresholdPercent}% of the fullest window.`
      : 'Downshift: off (set downshift_enabled in the plugin config to turn it on).'
  );
  const byModel = new Map<string, number>();
  let downshifted = 0;
  for (const row of ledger) {
    const key = row.resolved ?? (row.denied ? 'denied' : 'unknown');
    byModel.set(key, (byModel.get(key) ?? 0) + 1);
    if (row.downshifted) downshifted += 1;
  }
  lines.push(
    `Ledger: ${ledger.length} spawn(s) recorded${
      ledger.length
        ? ` (${[...byModel]
            .map(([m, n]) => `${m} ${n}`)
            .join(', ')}; ${downshifted} downshifted)`
        : ''
    }.`
  );
  for (const row of ledger.slice(-tail)) {
    const asked = row.requested ? ` asked ${row.requested},` : '';
    const ran = row.denied ? 'denied' : `ran ${row.resolved ?? 'unknown'}`;
    const flag = row.downshifted ? ' [downshifted]' : '';
    lines.push(`  ${row.ts} ${row.subagentType}:${asked} ${ran}${flag}`);
  }
  return lines.join('\n');
}
