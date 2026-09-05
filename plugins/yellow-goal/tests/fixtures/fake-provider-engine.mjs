#!/usr/bin/env node
// Portable fake Provider Protocol v1 engine for yellow-goal tests only. Runs
// two ways, both handled below, and never proxies to a real engine:
//  1. Directly executable — GOAL_GEN_BIN points straight at this file, so
//     argv is [thisFile, verb, ...flags].
//  2. As a Node `--import` preload with GOAL_GEN_BIN=<node>, so argv is
//     [verb, ...flags] with no entry file. Node resolves that bare verb as
//     an absolute entry-script candidate (e.g. "<cwd>/version") before this
//     preload runs, so the verb is recovered via basename(), same as
//     fake-engine.mjs's FAKE_GOAL_CLI_PATH sibling technique.
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { basename } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const KNOWN_VERBS = ['version', 'capabilities', 'run'];
const verbCandidate = basename(process.argv[1] ?? '');
const isPreloadMode = KNOWN_VERBS.includes(verbCandidate);
const args = isPreloadMode
  ? [verbCandidate, ...process.argv.slice(2)]
  : process.argv.slice(2);

const PROTOCOL_VERSION = 'yellow-goal/provider-protocol/v1';
const CAPABILITIES_SCHEMA_VERSION = 'yellow-goal/provider-capabilities/v1';
const REQUEST_SCHEMA_VERSION = 'yellow-goal/request/v1';
const RUN_EVENT_SCHEMA_VERSION = 'yellow-goal/run-event/v1';
const REQUIRED_OPERATIONS = [
  'capabilities',
  'request.create',
  'request.validate',
  'run',
  'version',
];
const REQUIRED_CAPABILITIES = [
  'run.cancel.os-signal',
  'run.executor.stub',
  'run.gate.noninteractive',
  'run.stdout.jsonl',
  'run.timeout',
];
const STUB_SCENARIOS = [
  'success',
  'failed',
  'budget-exhausted',
  'await-cancel',
];

function captureInvocation() {
  const capturePath = process.env.FAKE_PROVIDER_CAPTURE;
  if (!capturePath) return;
  const line = `${JSON.stringify({ argv: args, env: { ...process.env } })}\n`;
  appendFileSync(capturePath, line);
}

/** Writes to a piped stdout/stderr are asynchronous on POSIX; awaiting the
 *  write callback (not just the synchronous `.write()` return) is required
 *  before a following `process.exit()`, or the write can be truncated. */
function writeAndWait(stream, text) {
  return new Promise((resolve, reject) => {
    stream.write(text, (err) => (err ? reject(err) : resolve()));
  });
}

async function emit(value) {
  await writeAndWait(process.stdout, `${JSON.stringify(value)}\n`);
}

async function writeStderr(error) {
  await writeAndWait(process.stderr, `${JSON.stringify({ error })}\n`);
}

function argOf(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function installIgnoreSigterm() {
  if (process.env.FAKE_PROVIDER_IGNORE_SIGTERM === '1') {
    process.on('SIGTERM', () => {});
  }
}

/** Waits `ms`, resolving early with 'signal' on a cooperative SIGTERM
 *  (unless FAKE_PROVIDER_IGNORE_SIGTERM=1, in which case only the no-op
 *  handler installed by installIgnoreSigterm() sees it, and this waits out
 *  the full delay). Mirrors how a well-behaved protocol child is expected
 *  to exit gracefully in response to cancellation. */
async function raceSignalOrTimeout(ms) {
  // FAKE_PROVIDER_DEFAULT_SIGNAL=1 installs no SIGTERM listener at all, so
  // the OS default disposition terminates the child by signal (the real
  // engine behaves this way outside an admitted run).
  const ignoreSigterm =
    process.env.FAKE_PROVIDER_IGNORE_SIGTERM === '1' ||
    process.env.FAKE_PROVIDER_DEFAULT_SIGNAL === '1';
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve('timeout');
    }, ms);
    const onSigterm = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve('signal');
    };
    if (!ignoreSigterm) process.once('SIGTERM', onSigterm);
  });
}

/** Optional artificial delay before a probe answers, used to give
 *  cancellation/deadline tests a window to act. `envKey` lets each verb
 *  target its own delay independently (falling back to the shared
 *  FAKE_PROVIDER_DELAY_MS); a cooperative SIGTERM during the delay exits
 *  gracefully and discards the pending response. */
async function maybeCancellableDelay(envKey) {
  const ms = Number(
    process.env[envKey] || process.env.FAKE_PROVIDER_DELAY_MS || '0'
  );
  if (ms <= 0) return;
  const outcome = await raceSignalOrTimeout(ms);
  if (outcome === 'signal') process.exit(1);
}

/** Optional artificial delay after `run.start` (before the terminal
 *  summary), used the same way for mid-run cancellation tests. */
async function maybeCancellableRunDelay() {
  const ms = Number(process.env.FAKE_PROVIDER_RUN_DELAY_MS || '0');
  if (ms <= 0) return 'timeout';
  return raceSignalOrTimeout(ms);
}

function maybeSelfSignal() {
  const signal = process.env.FAKE_PROVIDER_EXIT_SIGNAL;
  if (signal) process.kill(process.pid, signal);
}

// ---------------------------------------------------------------------------
// version
// ---------------------------------------------------------------------------

async function handleVersion() {
  captureInvocation();
  installIgnoreSigterm();
  maybeSelfSignal();
  await maybeCancellableDelay('FAKE_PROVIDER_VERSION_DELAY_MS');
  const version = process.env.FAKE_PROVIDER_VERSION || '0.2.0';
  const mode = process.env.FAKE_PROVIDER_VERSION_MODE || 'ok';
  if (mode === 'empty') process.exit(1);
  if (mode === 'usage-error') {
    await writeStderr({ code: 'USAGE_ERROR', message: 'unknown version flag' });
    process.exit(2);
    return;
  }
  if (mode === 'engine-error') {
    await writeStderr({ code: 'INTERNAL', message: 'version boom' });
    process.exit(1);
    return;
  }
  if (mode === 'malformed') {
    await writeAndWait(process.stdout, 'not-json\n');
    process.exit(0);
    return;
  }
  if (mode === 'valid-then-exit-1') {
    await emit({ engineVersion: version });
    process.exit(1);
    return;
  }
  if (mode === 'valid-with-stderr') {
    await emit({ engineVersion: version });
    await writeAndWait(process.stderr, 'warning: noise\n');
    process.exit(0);
    return;
  }
  await emit({ engineVersion: version });
  process.exit(0);
}

// ---------------------------------------------------------------------------
// capabilities
// ---------------------------------------------------------------------------

function baseCapabilities(version) {
  return {
    schemaVersion: CAPABILITIES_SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    engineVersion: version,
    requestSchemaVersion: REQUEST_SCHEMA_VERSION,
    runEventSchemaVersion: RUN_EVENT_SCHEMA_VERSION,
    operations: [...REQUIRED_OPERATIONS],
    capabilities: [...REQUIRED_CAPABILITIES],
    stubScenarios: [...STUB_SCENARIOS],
    limits: {
      maxEventBytes: 1_048_576,
      maxQueuedBytes: 4_194_304,
      writerFinalizationTimeoutMs: 5000,
    },
  };
}

function applyCapabilitiesDefect(caps, field) {
  const out = JSON.parse(JSON.stringify(caps));
  switch (field) {
    case 'schemaVersion':
      out.schemaVersion = 'bogus';
      break;
    case 'protocolVersion':
      out.protocolVersion = 'bogus';
      break;
    case 'engineVersion':
      out.engineVersion = 'other-version';
      break;
    case 'requestSchemaVersion':
      out.requestSchemaVersion = 'bogus';
      break;
    case 'runEventSchemaVersion':
      out.runEventSchemaVersion = 'bogus';
      break;
    case 'operations-missing':
      out.operations = out.operations.filter((o) => o !== 'run');
      break;
    case 'capabilities-missing':
      out.capabilities = out.capabilities.filter((c) => c !== 'run.timeout');
      break;
    case 'scenarios-missing':
      out.stubScenarios = out.stubScenarios.filter((s) => s !== 'await-cancel');
      break;
    case 'limits-maxEventBytes':
      out.limits.maxEventBytes = 1_048_577;
      break;
    case 'limits-maxQueuedBytes':
      out.limits.maxQueuedBytes = 4_194_305;
      break;
    case 'limits-writerFinalizationTimeoutMs':
      out.limits.writerFinalizationTimeoutMs = 60_001;
      break;
    case 'duplicate-operations':
      out.operations = [...out.operations, out.operations[0]];
      break;
    case 'empty-entry':
      out.capabilities = [...out.capabilities, ''];
      break;
    case 'unknown-additive':
      out.unknownField = 'ignored';
      out.capabilities = [...out.capabilities, 'run.extra.unknown'];
      break;
    default:
      break;
  }
  return out;
}

async function handleCapabilities() {
  captureInvocation();
  installIgnoreSigterm();
  maybeSelfSignal();
  await maybeCancellableDelay('FAKE_PROVIDER_CAPABILITIES_DELAY_MS');
  const version = process.env.FAKE_PROVIDER_VERSION || '0.2.0';
  const mode = process.env.FAKE_PROVIDER_CAPABILITIES_MODE || 'ok';
  if (mode === 'empty') process.exit(1);
  if (mode === 'usage-error') {
    await writeStderr({
      code: 'USAGE_ERROR',
      message: 'unknown capabilities flag',
    });
    process.exit(2);
    return;
  }
  if (mode === 'engine-error') {
    await writeStderr({ code: 'INTERNAL', message: 'capabilities boom' });
    process.exit(1);
    return;
  }
  if (mode === 'malformed') {
    await writeAndWait(process.stdout, 'not-json\n');
    process.exit(0);
    return;
  }
  let caps = baseCapabilities(version);
  if (mode.startsWith('defect:')) {
    caps = applyCapabilitiesDefect(caps, mode.slice('defect:'.length));
  }
  await emit(caps);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

function nowIso() {
  return new Date().toISOString();
}

function makeEventFactory(runId) {
  let seq = 0;
  return (type, payload, overrides = {}) => ({
    schemaVersion: RUN_EVENT_SCHEMA_VERSION,
    runId: overrides.runId ?? runId,
    sequence: overrides.sequence ?? seq++,
    timestamp: nowIso(),
    type,
    ...(payload !== undefined ? { payload } : {}),
  });
}

function summaryPayload(status, extra = {}) {
  return {
    status,
    goalText: extra.goalText ?? 'fake goal',
    costUsd: 0,
    replans: 0,
    reextractions: 0,
    actions: [],
    reason: extra.reason ?? status,
    ...(extra.terminationReason
      ? { terminationReason: extra.terminationReason }
      : {}),
  };
}

function serializeRecords(
  records,
  { crlf = false, blankLineBeforeLast = false, unterminated = false } = {}
) {
  const eol = crlf ? '\r\n' : '\n';
  const lines = records.map((r) => JSON.stringify(r));
  if (blankLineBeforeLast && lines.length > 0)
    lines.splice(lines.length - 1, 0, '');
  let text = `${lines.join(eol)}${eol}`;
  if (unterminated) text = text.slice(0, -eol.length);
  return text;
}

async function writeOut(text) {
  const chunkBytes = Number(process.env.FAKE_PROVIDER_CHUNK_BYTES || '0');
  const chunkDelayMs = Number(process.env.FAKE_PROVIDER_CHUNK_DELAY_MS || '0');
  const buf = Buffer.from(text, 'utf8');
  if (chunkBytes <= 0) {
    await writeAndWait(process.stdout, buf);
    return;
  }
  for (let offset = 0; offset < buf.length; offset += chunkBytes) {
    await writeAndWait(
      process.stdout,
      buf.subarray(offset, offset + chunkBytes)
    );
    if (chunkDelayMs > 0) await delay(chunkDelayMs);
  }
}

async function handleRun() {
  captureInvocation();
  installIgnoreSigterm();
  maybeSelfSignal();
  await maybeCancellableDelay('FAKE_PROVIDER_RUN_START_DELAY_MS');

  // FAKE_PROVIDER_REPORT_SCENARIO models a peer that ignores the requested
  // scenario and reports a different one in run.start and its terminal.
  const scenario =
    process.env.FAKE_PROVIDER_REPORT_SCENARIO ||
    argOf('--stub-scenario') ||
    'success';
  const timeoutRaw = argOf('--timeout-ms');
  const timeoutMs = timeoutRaw !== undefined ? Number(timeoutRaw) : undefined;
  const runId = process.env.FAKE_PROVIDER_RUN_ID || randomUUID();
  const mode = process.env.FAKE_PROVIDER_RUN_MODE || 'ok';
  const event = makeEventFactory(runId);

  if (mode === 'no-output') {
    const stderrJson = process.env.FAKE_PROVIDER_PREFLIGHT_STDERR;
    if (stderrJson) {
      await writeAndWait(
        process.stderr,
        stderrJson.endsWith('\n') ? stderrJson : `${stderrJson}\n`
      );
    }
    process.exit(Number(process.env.FAKE_PROVIDER_EXIT_CODE || '1'));
    return;
  }

  const startEvent = () =>
    event('run.start', {
      protocolVersion: PROTOCOL_VERSION,
      executor: 'stub',
      stubScenario: scenario,
      simulation: true,
      targetRepositoryHonored: false,
    });

  if (mode === 'ok' && scenario === 'await-cancel') {
    await writeOut(serializeRecords([startEvent(), event('stub.waiting', {})]));
    const effectiveTimeout = Number.isSafeInteger(timeoutMs) ? timeoutMs : 5000;
    const result = await raceSignalOrTimeout(effectiveTimeout);
    const terminationReason = result === 'signal' ? 'signal' : 'timeout';
    const code =
      terminationReason === 'signal' ? 'RUN_CANCELLED' : 'RUN_TIMEOUT';
    const message = `stub ${terminationReason} cancellation`;
    await writeOut(
      serializeRecords([
        event(
          'run.summary',
          summaryPayload('cancelled', { reason: message, terminationReason })
        ),
      ])
    );
    await writeAndWait(
      process.stderr,
      `${JSON.stringify({ error: { code, message } })}\n`
    );
    process.exit(1);
    return;
  }

  if (mode === 'malformed-json') {
    await writeOut(serializeRecords([startEvent()]));
    await writeOut('not-json\n');
    process.exit(1);
    return;
  }

  // Models a cancellation that lands mid-stream, before run.summary is ever
  // emitted: the stream stays incomplete, which the consumer must treat as
  // transport (not a protocol violation) when a local cause was recorded.
  if (mode === 'interrupted-before-summary') {
    await writeOut(serializeRecords([startEvent()]));
    const delayMs = Number(process.env.FAKE_PROVIDER_RUN_DELAY_MS || '5000');
    const outcome = await raceSignalOrTimeout(delayMs);
    if (outcome === 'signal') {
      process.exit(1);
      return;
    }
    await writeOut(
      serializeRecords([event('run.summary', summaryPayload('succeeded'))])
    );
    process.exit(0);
    return;
  }

  let records;
  let stderrText = '';
  let exitCode = 0;
  let serializeOpts = {};

  switch (mode) {
    case 'ok': {
      if (scenario === 'failed') {
        records = [
          startEvent(),
          event(
            'run.summary',
            summaryPayload('failed', { reason: 'deterministic stub failure' })
          ),
        ];
        stderrText = `${JSON.stringify({ error: { code: 'RUN_FAILED', message: 'deterministic stub failure' } })}\n`;
        exitCode = 1;
      } else if (scenario === 'budget-exhausted') {
        records = [
          startEvent(),
          event(
            'run.summary',
            summaryPayload('budget-exhausted', { reason: 'budget exhausted' })
          ),
        ];
        stderrText = `${JSON.stringify({ error: { code: 'RUN_BUDGET_EXHAUSTED', message: 'budget exhausted' } })}\n`;
        exitCode = 1;
      } else {
        records = [
          startEvent(),
          event('run.summary', summaryPayload('succeeded')),
        ];
      }
      break;
    }
    case 'gate-required': {
      const kind = process.env.FAKE_PROVIDER_GATE_KIND || 'dod';
      records = [
        startEvent(),
        event('gate.required', { kind }),
        event(
          'run.summary',
          summaryPayload('cancelled', {
            reason: 'gate required',
            terminationReason: 'gate-required',
          })
        ),
      ];
      stderrText = `${JSON.stringify({ error: { code: 'RUN_GATE_REQUIRED', message: 'gate required' } })}\n`;
      exitCode = 1;
      break;
    }
    case 'wrong-schema-version': {
      const start = startEvent();
      start.schemaVersion = 'bogus/v0';
      records = [start, event('run.summary', summaryPayload('succeeded'))];
      break;
    }
    case 'missing-start': {
      records = [event('run.summary', summaryPayload('succeeded'))];
      break;
    }
    case 'duplicate-start': {
      records = [
        startEvent(),
        startEvent(),
        event('run.summary', summaryPayload('succeeded')),
      ];
      break;
    }
    case 'event-after-summary': {
      records = [
        startEvent(),
        event('run.summary', summaryPayload('succeeded')),
        event('stub.trailing', {}),
      ];
      break;
    }
    case 'duplicate-summary': {
      records = [
        startEvent(),
        event('run.summary', summaryPayload('succeeded')),
        event('run.summary', summaryPayload('succeeded')),
      ];
      break;
    }
    case 'sequence-gap': {
      records = [
        startEvent(),
        event('run.summary', summaryPayload('succeeded'), { sequence: 5 }),
      ];
      break;
    }
    case 'sequence-duplicate': {
      const start = startEvent();
      records = [
        start,
        event('run.summary', summaryPayload('succeeded'), {
          sequence: start.sequence,
        }),
      ];
      break;
    }
    case 'runid-change': {
      records = [
        startEvent(),
        event('run.summary', summaryPayload('succeeded'), {
          runId: randomUUID(),
        }),
      ];
      break;
    }
    case 'unterminated': {
      records = [
        startEvent(),
        event('run.summary', summaryPayload('succeeded')),
      ];
      serializeOpts = { unterminated: true };
      break;
    }
    case 'blank-line': {
      records = [
        startEvent(),
        event('run.summary', summaryPayload('succeeded')),
      ];
      serializeOpts = { blankLineBeforeLast: true };
      break;
    }
    case 'crlf': {
      records = [
        startEvent(),
        event('run.summary', summaryPayload('succeeded')),
      ];
      serializeOpts = { crlf: true };
      break;
    }
    case 'oversized-record': {
      const padBytes = Number(process.env.FAKE_PROVIDER_PAD_BYTES || '2000000');
      records = [
        startEvent(),
        event(
          'run.summary',
          summaryPayload('succeeded', { goalText: 'x'.repeat(padBytes) })
        ),
      ];
      break;
    }
    case 'stderr-mismatch': {
      records = [
        startEvent(),
        event(
          'run.summary',
          summaryPayload('failed', { reason: 'stub failure' })
        ),
      ];
      stderrText = `${JSON.stringify({ error: { code: 'RUN_BUDGET_EXHAUSTED', message: 'stub failure' } })}\n`;
      exitCode = 1;
      break;
    }
    case 'stderr-multiline': {
      records = [
        startEvent(),
        event(
          'run.summary',
          summaryPayload('failed', { reason: 'stub failure' })
        ),
      ];
      const line = JSON.stringify({
        error: { code: 'RUN_FAILED', message: 'stub failure' },
      });
      stderrText = `${line}\n${line}\n`;
      exitCode = 1;
      break;
    }
    case 'stderr-empty-on-failure': {
      records = [
        startEvent(),
        event(
          'run.summary',
          summaryPayload('failed', { reason: 'stub failure' })
        ),
      ];
      exitCode = 1;
      break;
    }
    case 'exit-code-mismatch': {
      records = [
        startEvent(),
        event('run.summary', summaryPayload('succeeded')),
      ];
      exitCode = 1;
      break;
    }
    case 'premature-exit': {
      records = [startEvent()];
      exitCode = 1;
      break;
    }
    default:
      records = [
        startEvent(),
        event('run.summary', summaryPayload('succeeded')),
      ];
  }

  if (records.length > 0)
    await writeOut(serializeRecords(records, serializeOpts));
  if (stderrText) await writeAndWait(process.stderr, stderrText);
  // The terminal record (if any) is already fully written above; a
  // cooperative SIGTERM arriving during this optional hold does not change
  // the outcome that was already committed to stdout/stderr, so exit with
  // the same planned code either way. This models "terminal streamed, then
  // a delayed close, then a race with cancellation" tests.
  await maybeCancellableRunDelay();
  process.exit(exitCode);
}

// ---------------------------------------------------------------------------

switch (args[0]) {
  case 'version':
    handleVersion();
    break;
  case 'capabilities':
    handleCapabilities();
    break;
  case 'run':
    handleRun();
    break;
  default:
    await writeStderr({
      code: 'USAGE_ERROR',
      message: `unknown fake provider verb ${args[0] ?? ''}`,
    });
    process.exit(2);
}
