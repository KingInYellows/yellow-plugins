"use strict";
/**
 * Classifies one finished agy turn (contract-v0 "Result classification").
 * agy's own `status` is not trusted on its own: a print timeout reports
 * SUCCESS with exit 0, and a soft-denial leaves `response` empty. The rows
 * are checked in the contract's order and the first match wins.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NORMAL_FINISHED_REASONS = void 0;
exports.parseResult = parseResult;
exports.classifyTurn = classifyTurn;
exports.needsInput = needsInput;
exports.structuredOutput = structuredOutput;
/**
 * `finished_reason` values verified to mean a normal completion. Empty until
 * the adapter probe pins one (open question 3), so no turn classifies as OK.
 */
exports.NORMAL_FINISHED_REASONS = [];
/** Parses agy's JSON output; undefined when stdout holds no JSON object. */
function parseResult(stdout) {
    const trimmed = stdout.trim();
    if (trimmed === '')
        return undefined;
    const candidates = [trimmed];
    // agy may print notices before the JSON; fall back to the last line that parses.
    const lines = trimmed.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i]?.trim() ?? '';
        if (line.startsWith('{'))
            candidates.push(lines.slice(i).join('\n'));
    }
    for (const text of candidates) {
        try {
            const value = JSON.parse(text);
            if (value !== null &&
                typeof value === 'object' &&
                !Array.isArray(value)) {
                return value;
            }
        }
        catch {
            // try the next candidate
        }
    }
    return undefined;
}
const AUTH_RE = /authentication required/i;
const QUOTA_RE = /\b(quota|rate limit|resource[_ ]exhausted|429)\b/i;
function classifyTurn(outcome, normalReasons = exports.NORMAL_FINISHED_REASONS) {
    const result = parseResult(outcome.stdout);
    const reason = typeof result?.finished_reason === 'string'
        ? result.finished_reason
        : undefined;
    const withResult = result === undefined ? {} : { result };
    if (outcome.killedByDeadline || reason === 'print_timeout') {
        return { kind: 'TIMED_OUT', ...withResult };
    }
    if (outcome.cancelled ||
        outcome.signal === 'SIGTERM' ||
        outcome.signal === 'SIGINT' ||
        reason === 'interrupted') {
        return { kind: 'INTERRUPTED', ...withResult };
    }
    if (result !== undefined &&
        Array.isArray(result.denied_actions) &&
        result.denied_actions.length > 0) {
        return { kind: 'DENIED', result, deniedActions: result.denied_actions };
    }
    if (result !== undefined &&
        result.status === 'SUCCESS' &&
        outcome.exitCode === 0) {
        if (reason !== undefined && normalReasons.includes(reason)) {
            return { kind: 'OK', result };
        }
        return { kind: 'UNVERIFIED', result, finishedReason: reason };
    }
    if (AUTH_RE.test(outcome.stderr)) {
        return { kind: 'AUTH_REQUIRED', ...withResult };
    }
    const detail = [
        outcome.stderr,
        typeof result?.response === 'string' ? result.response : '',
    ]
        .join('\n')
        .trim();
    if (QUOTA_RE.test(detail)) {
        return { kind: 'QUOTA', ...withResult };
    }
    return {
        kind: 'MODEL_ERROR',
        ...withResult,
        detail: detail.slice(0, 500) ||
            `agy exited with ${outcome.exitCode ?? outcome.signal ?? 'unknown'}`,
    };
}
/**
 * The `NEEDS_INPUT: <question>` marker an implement turn's prompt asks for.
 * Only this line marks a run as needing a reply; supervise never guesses.
 */
function needsInput(response) {
    if (response === undefined)
        return undefined;
    const lines = response.trimEnd().split(/\r?\n/);
    const last = lines[lines.length - 1]?.trim() ?? '';
    const match = /^NEEDS_INPUT:\s*(\S.*)$/.exec(last);
    return match?.[1];
}
/**
 * structured_output is trusted only from a turn that passed --json-schema;
 * a resumed turn repeats the previous turn's value.
 */
function structuredOutput(result, passedSchema) {
    return passedSchema ? result.structured_output : undefined;
}
