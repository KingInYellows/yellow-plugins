/**
 * Classifies one finished agy turn (contract-v0 "Result classification").
 * agy's own `status` is not trusted on its own: a print timeout reports
 * SUCCESS with exit 0, and a soft-denial leaves `response` empty. The rows
 * are checked in the contract's order and the first match wins.
 */

/**
 * The 2026-11 probe showed agy 1.4.12 omits `finished_reason` on a normal
 * finish, so only an absent key is OK. Any present value that isn't a known
 * timeout or interrupt, including a non-string, stays UNVERIFIED.
 */

export interface TurnOutcome {
  /** Process exit code, or null when killed by a signal. */
  readonly exitCode: number | null;
  readonly signal: string | null;
  /** True when our own deadline killed the process. */
  readonly killedByDeadline: boolean;
  /** True when the owner cancelled the run. */
  readonly cancelled: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export interface AgyResult {
  readonly status?: string;
  readonly finished_reason?: string;
  readonly conversation_id?: string;
  readonly response?: string;
  readonly denied_actions?: readonly unknown[];
  readonly structured_output?: unknown;
  readonly usage?: unknown;
}

export type TurnClass =
  | { readonly kind: 'TIMED_OUT'; readonly result?: AgyResult }
  | { readonly kind: 'INTERRUPTED'; readonly result?: AgyResult }
  | {
      readonly kind: 'DENIED';
      readonly result: AgyResult;
      readonly deniedActions: readonly unknown[];
    }
  | { readonly kind: 'OK'; readonly result: AgyResult }
  | {
      readonly kind: 'UNVERIFIED';
      readonly result: AgyResult;
      readonly finishedReason: string | undefined;
    }
  | { readonly kind: 'AUTH_REQUIRED'; readonly result?: AgyResult }
  | { readonly kind: 'QUOTA'; readonly result?: AgyResult }
  | {
      readonly kind: 'MODEL_ERROR';
      readonly result?: AgyResult;
      readonly detail: string;
    };

/** Parses agy's JSON output; undefined when stdout holds no JSON object. */
export function parseResult(stdout: string): AgyResult | undefined {
  const trimmed = stdout.trim();
  if (trimmed === '') return undefined;
  const candidates = [trimmed];
  // agy may print notices before the JSON; fall back to the last line that parses.
  const lines = trimmed.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim() ?? '';
    if (line.startsWith('{')) candidates.push(lines.slice(i).join('\n'));
  }
  for (const text of candidates) {
    try {
      const value: unknown = JSON.parse(text);
      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        return value as AgyResult;
      }
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

const AUTH_RE = /authentication required/i;
const QUOTA_RE = /\b(quota|rate limit|resource[_ ]exhausted|429)\b/i;

export function classifyTurn(outcome: TurnOutcome): TurnClass {
  const result = parseResult(outcome.stdout);
  const reason =
    typeof result?.finished_reason === 'string'
      ? result.finished_reason
      : undefined;
  const withResult = result === undefined ? {} : { result };

  if (outcome.killedByDeadline || reason === 'print_timeout') {
    return { kind: 'TIMED_OUT', ...withResult };
  }
  if (
    outcome.cancelled ||
    outcome.signal === 'SIGTERM' ||
    outcome.signal === 'SIGINT' ||
    reason === 'interrupted'
  ) {
    return { kind: 'INTERRUPTED', ...withResult };
  }
  if (
    result !== undefined &&
    Array.isArray(result.denied_actions) &&
    result.denied_actions.length > 0
  ) {
    return { kind: 'DENIED', result, deniedActions: result.denied_actions };
  }
  if (
    result !== undefined &&
    'denied_actions' in result &&
    !Array.isArray(result.denied_actions)
  ) {
    // A malformed envelope never counts as "nothing was denied".
    return {
      kind: 'MODEL_ERROR',
      result,
      detail: 'agy returned a non-array denied_actions',
    };
  }
  if (
    result !== undefined &&
    result.status === 'SUCCESS' &&
    outcome.exitCode === 0
  ) {
    if (!('finished_reason' in result)) return { kind: 'OK', result };
    return {
      kind: 'UNVERIFIED',
      result,
      finishedReason: reason ?? JSON.stringify(result.finished_reason),
    };
  }
  if (AUTH_RE.test(outcome.stderr)) {
    return { kind: 'AUTH_REQUIRED', ...withResult };
  }
  // Quota is read from agy's stderr only: the model's response can mention
  // "quota" or "429" while describing the repo it is working on.
  if (QUOTA_RE.test(outcome.stderr)) {
    return { kind: 'QUOTA', ...withResult };
  }
  const detail = [
    outcome.stderr,
    typeof result?.response === 'string' ? result.response : '',
  ]
    .join('\n')
    .trim();
  return {
    kind: 'MODEL_ERROR',
    ...withResult,
    detail:
      detail.slice(0, 500) ||
      `agy exited with ${outcome.exitCode ?? outcome.signal ?? 'unknown'}`,
  };
}

/**
 * The `NEEDS_INPUT: <question>` marker an implement turn's prompt asks for.
 * Only this line marks a run as needing a reply; supervise never guesses.
 */
export function needsInput(response: string | undefined): string | undefined {
  if (response === undefined) return undefined;
  const lines = response.trimEnd().split(/\r?\n/);
  const last = lines[lines.length - 1]?.trim() ?? '';
  const match = /^NEEDS_INPUT:\s*(\S.*)$/.exec(last);
  return match?.[1];
}

/**
 * structured_output is trusted only from a turn that passed --json-schema;
 * a resumed turn repeats the previous turn's value.
 */
export function structuredOutput(
  result: AgyResult,
  passedSchema: boolean
): unknown {
  return passedSchema ? result.structured_output : undefined;
}
