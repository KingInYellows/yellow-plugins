/**
 * End-to-end `runStub` lifecycle coverage: version -> capabilities -> run,
 * against the portable fake provider engine (never a real engine). The
 * fixture is executed directly (GOAL_GEN_BIN points at its file, same as a
 * real installed `goal-gen`) so its async waits (delays, await-cancel,
 * mid-stream holds) never race Node's own entry-module resolution the way
 * the `--import`-with-no-entry-file preload mode would for anything beyond
 * a synchronous handler. FAKE_PROVIDER_* knobs still travel through the
 * test-only `childEnvOverride` seam; production code never sets it.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GoalEngineError } from '../src/errors.js';
import { PINNED_ENGINE_VERSION } from '../src/pin.js';
import {
  runStub,
  type ProtocolRuntimeDeps,
  type RunStubInput,
} from '../src/runtime.js';

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const fixturePath = path.join(
  packageRoot,
  'tests',
  'fixtures',
  'fake-provider-engine.mjs'
);

let scratchBase: string;
let captureFile: string;

beforeEach(() => {
  scratchBase = fs.mkdtempSync(
    path.join(os.tmpdir(), 'yellow-goal-runtime-protocol-')
  );
  captureFile = path.join(scratchBase, 'capture.jsonl');
});

afterEach(() => {
  fs.rmSync(scratchBase, { recursive: true, force: true });
});

function makeDeps(extraEnv: Record<string, string> = {}): ProtocolRuntimeDeps {
  return {
    env: {
      ...process.env,
      GOAL_GEN_BIN: fixturePath,
      GOAL_GEN_SCRATCH: path.join(scratchBase, 'op'),
    },
    childEnvOverride: {
      FAKE_PROVIDER_CAPTURE: captureFile,
      ...extraEnv,
    },
  };
}

interface CapturedInvocation {
  readonly argv: readonly string[];
  readonly env: Record<string, string>;
}

function readCapture(): CapturedInvocation[] {
  if (!fs.existsSync(captureFile)) return [];
  return fs
    .readFileSync(captureFile, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as CapturedInvocation);
}

function verbsInvoked(): string[] {
  return readCapture().map((entry) => entry.argv[0] as string);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls the capture file until `verb` was invoked, then waits a small
 *  buffer for that child's own async SIGTERM-listener registration (writes
 *  the argv capture synchronously before any signal handling is wired up),
 *  so a signal sent right after this resolves is guaranteed cooperative
 *  rather than racing the child's own startup. */
async function waitUntilInvoked(verb: string, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (verbsInvoked().includes(verb)) {
      await sleep(150);
      return;
    }
    await sleep(5);
  }
  throw new Error(`timed out waiting for "${verb}" to be invoked`);
}

function baseInput(overrides: Partial<RunStubInput> = {}): RunStubInput {
  return { request: 'req.json', scenario: 'success', yes: true, ...overrides };
}

async function expectGoalError(
  promise: Promise<unknown>,
  code: string
): Promise<GoalEngineError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(GoalEngineError);
    expect((err as GoalEngineError).code).toBe(code);
    return err as GoalEngineError;
  }
  throw new Error(`expected promise to reject with ${code}`);
}

describe('runStub — happy paths', () => {
  it('runs the success scenario end to end', async () => {
    const result = await runStub(makeDeps(), baseInput());
    expect(result.engineVersion).toBe(PINNED_ENGINE_VERSION);
    expect(result.protocolVersion).toBe('yellow-goal/provider-protocol/v1');
    expect(typeof result.runId).toBe('string');
    expect(result.eventCount).toBe(2);
    expect(result.summary).toMatchObject({ status: 'succeeded' });
    expect(verbsInvoked()).toEqual(['version', 'capabilities', 'run']);
  });

  it('accepts additive unknown capabilities fields/entries', async () => {
    const result = await runStub(
      makeDeps({ FAKE_PROVIDER_CAPABILITIES_MODE: 'defect:unknown-additive' }),
      baseInput()
    );
    expect(result.summary.status).toBe('succeeded');
  });

  it.each([
    ['failed', 'GOAL_RUN_FAILED'],
    ['budget-exhausted', 'GOAL_RUN_BUDGET_EXHAUSTED'],
  ] as const)('maps the %s scenario to %s', async (scenario, code) => {
    const err = await expectGoalError(
      runStub(makeDeps(), baseInput({ scenario })),
      code
    );
    expect(err.terminalStatus).toBe(scenario);
    expect(err.runId).toBeDefined();
  });

  it('maps a gate-required terminal to GOAL_RUN_GATE_REQUIRED with the gate kind', async () => {
    const err = await expectGoalError(
      runStub(
        makeDeps({
          FAKE_PROVIDER_RUN_MODE: 'gate-required',
          FAKE_PROVIDER_GATE_KIND: 'reconfirm',
        }),
        baseInput()
      ),
      'GOAL_RUN_GATE_REQUIRED'
    );
    expect(err.gateKind).toBe('reconfirm');
  });

  it('drives the await-cancel scenario to RUN_TIMEOUT when no signal arrives', async () => {
    const err = await expectGoalError(
      runStub(
        makeDeps(),
        baseInput({ scenario: 'await-cancel', timeoutMs: 50 })
      ),
      'GOAL_RUN_ENGINE_TIMEOUT'
    );
    expect(err.terminationReason).toBe('timeout');
  });

  it('captures the exact fixed argv per scenario, including leading-dash and space paths', async () => {
    await runStub(
      makeDeps(),
      baseInput({
        request: '-weird --path with spaces',
        scenario: 'success',
        timeoutMs: 1234,
        yes: true,
      })
    );
    const runInvocation = readCapture().find(
      (entry) => entry.argv[0] === 'run'
    );
    expect(runInvocation?.argv).toEqual([
      'run',
      '--executor',
      'stub',
      '--protocol',
      'v1',
      '--stub-scenario',
      'success',
      '--timeout-ms',
      '1234',
      '--yes',
      '--',
      '-weird --path with spaces',
    ]);
  });

  it('sanitizes the child environment (stdin is ignored by the transport)', async () => {
    await runStub(makeDeps({}), baseInput());
    const invocations = readCapture();
    expect(invocations.length).toBeGreaterThan(0);
    for (const invocation of invocations) {
      for (const credentialKey of [
        'ANTHROPIC_API_KEY',
        'CLAUDE_CODE_OAUTH_TOKEN',
        'OPENAI_API_KEY',
        'CODEX_API_KEY',
        'GH_TOKEN',
        'GITHUB_TOKEN',
        'NPM_TOKEN',
        'NODE_AUTH_TOKEN',
      ]) {
        expect(invocation.env[credentialKey]).toBeUndefined();
      }
      expect(invocation.env['HOME']).toContain(
        path.join(scratchBase, 'op', 'home')
      );
    }
  });
});

describe('runStub — handshake rejection', () => {
  it('rejects a version mismatch without ever spawning capabilities/run', async () => {
    await expectGoalError(
      runStub(makeDeps({ FAKE_PROVIDER_VERSION: '9.9.9' }), baseInput()),
      'GOAL_ENGINE_VERSION_MISMATCH'
    );
    expect(verbsInvoked()).toEqual(['version']);
  });

  it('rejects malformed version JSON as GOAL_PROTOCOL_INVALID', async () => {
    await expectGoalError(
      runStub(
        makeDeps({ FAKE_PROVIDER_VERSION_MODE: 'malformed' }),
        baseInput()
      ),
      'GOAL_PROTOCOL_INVALID'
    );
    expect(verbsInvoked()).toEqual(['version']);
  });

  it('maps a version usage-error preflight to GOAL_ENGINE_USAGE_ERROR', async () => {
    await expectGoalError(
      runStub(
        makeDeps({ FAKE_PROVIDER_VERSION_MODE: 'usage-error' }),
        baseInput()
      ),
      'GOAL_ENGINE_USAGE_ERROR'
    );
  });

  it('maps a version engine-error preflight to GOAL_ENGINE_FAILED', async () => {
    await expectGoalError(
      runStub(
        makeDeps({ FAKE_PROVIDER_VERSION_MODE: 'engine-error' }),
        baseInput()
      ),
      'GOAL_ENGINE_FAILED'
    );
  });

  it.each([
    'schemaVersion',
    'protocolVersion',
    'requestSchemaVersion',
    'runEventSchemaVersion',
    'operations-missing',
    'capabilities-missing',
    'scenarios-missing',
    'limits-maxEventBytes',
    'limits-maxQueuedBytes',
    'limits-writerFinalizationTimeoutMs',
  ])(
    'rejects a %s capabilities defect as GOAL_PROTOCOL_INCOMPATIBLE with no run spawn',
    async (field) => {
      await expectGoalError(
        runStub(
          makeDeps({ FAKE_PROVIDER_CAPABILITIES_MODE: `defect:${field}` }),
          baseInput()
        ),
        'GOAL_PROTOCOL_INCOMPATIBLE'
      );
      expect(verbsInvoked()).toEqual(['version', 'capabilities']);
    }
  );

  it.each(['duplicate-operations', 'empty-entry'])(
    'rejects a %s capabilities defect as GOAL_PROTOCOL_INVALID with no run spawn',
    async (field) => {
      await expectGoalError(
        runStub(
          makeDeps({ FAKE_PROVIDER_CAPABILITIES_MODE: `defect:${field}` }),
          baseInput()
        ),
        'GOAL_PROTOCOL_INVALID'
      );
      expect(verbsInvoked()).toEqual(['version', 'capabilities']);
    }
  );

  it('rejects an engineVersion identity disagreement between capabilities and version', async () => {
    await expectGoalError(
      runStub(
        makeDeps({ FAKE_PROVIDER_CAPABILITIES_MODE: 'defect:engineVersion' }),
        baseInput()
      ),
      'GOAL_PROTOCOL_INCOMPATIBLE'
    );
    expect(verbsInvoked()).toEqual(['version', 'capabilities']);
  });
});

describe('runStub — framing and terminal agreement', () => {
  const invalidModes = [
    'wrong-schema-version',
    'missing-start',
    'duplicate-start',
    'event-after-summary',
    'duplicate-summary',
    'sequence-gap',
    'sequence-duplicate',
    'runid-change',
    'unterminated',
    'blank-line',
    'stderr-mismatch',
    'stderr-multiline',
    'stderr-empty-on-failure',
    'exit-code-mismatch',
    'premature-exit',
    'oversized-record',
  ] as const;

  it.each(invalidModes)(
    'rejects the %s run stream as a protocol failure',
    async (mode) => {
      const extraEnv: Record<string, string> = { FAKE_PROVIDER_RUN_MODE: mode };
      if (mode === 'oversized-record')
        extraEnv.FAKE_PROVIDER_PAD_BYTES = '2000000';
      try {
        await runStub(makeDeps(extraEnv), baseInput());
        throw new Error(`expected ${mode} to reject`);
      } catch (err) {
        expect(err).toBeInstanceOf(GoalEngineError);
        expect((err as GoalEngineError).code).toMatch(
          /^GOAL_PROTOCOL_(INVALID|TRANSPORT)$/
        );
      }
    }
  );

  it('accepts CRLF-terminated records as valid framing', async () => {
    const result = await runStub(
      makeDeps({ FAKE_PROVIDER_RUN_MODE: 'crlf' }),
      baseInput()
    );
    expect(result.summary.status).toBe('succeeded');
  });

  it('rejects a malformed JSON record mid-stream as GOAL_PROTOCOL_INVALID', async () => {
    await expectGoalError(
      runStub(
        makeDeps({ FAKE_PROVIDER_RUN_MODE: 'malformed-json' }),
        baseInput()
      ),
      'GOAL_PROTOCOL_INVALID'
    );
  });

  it('splits the stream across small chunks and still validates it', async () => {
    const result = await runStub(
      makeDeps({ FAKE_PROVIDER_CHUNK_BYTES: '1' }),
      baseInput()
    );
    expect(result.summary.status).toBe('succeeded');
  });

  it('treats an empty run stdout with a structured preflight error as the existing engine-failure path', async () => {
    await expectGoalError(
      runStub(
        makeDeps({
          FAKE_PROVIDER_RUN_MODE: 'no-output',
          FAKE_PROVIDER_EXIT_CODE: '1',
          FAKE_PROVIDER_PREFLIGHT_STDERR: JSON.stringify({
            error: { code: 'VALIDATION_FAILED', message: 'bad request' },
          }),
        }),
        baseInput()
      ),
      'GOAL_ENGINE_FAILED'
    );
  });
});

describe('runStub — cancellation and deadlines', () => {
  it('rejects an already-aborted signal without spawning anything', async () => {
    const controller = new AbortController();
    controller.abort();
    await expectGoalError(
      runStub(makeDeps(), baseInput({ signal: controller.signal })),
      'GOAL_RUN_CANCELLED'
    );
    expect(verbsInvoked()).toEqual([]);
  });

  it('rejects an already-elapsed deadline without spawning anything', async () => {
    await expectGoalError(
      runStub(makeDeps(), baseInput({ deadlineMs: -1000 })),
      'GOAL_RUN_DEADLINE_EXCEEDED'
    );
    expect(verbsInvoked()).toEqual([]);
  });

  it('cancels during the version probe and spawns nothing further', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const err = await expectGoalError(
      runStub(
        makeDeps({ FAKE_PROVIDER_VERSION_DELAY_MS: '2000' }),
        baseInput({ signal: controller.signal })
      ),
      'GOAL_RUN_CANCELLED'
    );
    expect(err.localCause).toBe('caller-cancelled');
    expect(verbsInvoked()).toEqual(['version']);
  });

  it('cancels during the capabilities probe and never spawns run', async () => {
    const controller = new AbortController();
    const promise = runStub(
      makeDeps({ FAKE_PROVIDER_CAPABILITIES_DELAY_MS: '5000' }),
      baseInput({ signal: controller.signal })
    );
    await waitUntilInvoked('capabilities');
    controller.abort();
    const err = await expectGoalError(promise, 'GOAL_RUN_CANCELLED');
    expect(err.localCause).toBe('caller-cancelled');
    expect(verbsInvoked()).toEqual(['version', 'capabilities']);
  });

  it('cancels between phases without ever spawning run', async () => {
    // Aborting immediately lands either before phase 1 or in the gap
    // between phases 1 and 2 (both fast with no configured delay); either
    // way `run` must never be spawned.
    const controller = new AbortController();
    const promise = runStub(
      makeDeps(),
      baseInput({ signal: controller.signal })
    );
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(GoalEngineError);
    expect(verbsInvoked()).not.toContain('run');
  });

  it('reports a deadline exceeded during the run phase as the local cause', async () => {
    const err = await expectGoalError(
      runStub(
        makeDeps(),
        baseInput({
          scenario: 'await-cancel',
          timeoutMs: 60_000,
          deadlineMs: 3000,
        })
      ),
      'GOAL_RUN_DEADLINE_EXCEEDED'
    );
    expect(err.localCause).toBe('deadline');
  });

  it('cancels the await-cancel run via a forwarded caller signal', async () => {
    const controller = new AbortController();
    const promise = runStub(
      makeDeps(),
      baseInput({
        scenario: 'await-cancel',
        timeoutMs: 60_000,
        signal: controller.signal,
      })
    );
    await waitUntilInvoked('run');
    controller.abort();
    const err = await expectGoalError(promise, 'GOAL_RUN_CANCELLED');
    expect(err.localCause).toBe('caller-cancelled');
  });

  it('treats an incomplete stream interrupted by cancellation as transport, not invalid', async () => {
    const controller = new AbortController();
    const promise = runStub(
      makeDeps({
        FAKE_PROVIDER_RUN_MODE: 'interrupted-before-summary',
        FAKE_PROVIDER_RUN_DELAY_MS: '5000',
      }),
      baseInput({ signal: controller.signal })
    );
    await waitUntilInvoked('run');
    controller.abort();
    await expectGoalError(promise, 'GOAL_PROTOCOL_TRANSPORT');
  });

  it('lets a local cause win over an already-valid success observed before close', async () => {
    const controller = new AbortController();
    const promise = runStub(
      makeDeps({ FAKE_PROVIDER_RUN_DELAY_MS: '5000' }),
      baseInput({ signal: controller.signal })
    );
    await waitUntilInvoked('run');
    controller.abort();
    const err = await expectGoalError(promise, 'GOAL_RUN_CANCELLED');
    expect(err.localCause).toBe('caller-cancelled');
  });

  it('maps an ignored SIGTERM escalated to SIGKILL as GOAL_PROTOCOL_TRANSPORT', async () => {
    const controller = new AbortController();
    const promise = runStub(
      makeDeps({
        FAKE_PROVIDER_RUN_MODE: 'interrupted-before-summary',
        FAKE_PROVIDER_RUN_DELAY_MS: '20000',
        FAKE_PROVIDER_IGNORE_SIGTERM: '1',
      }),
      baseInput({ signal: controller.signal })
    );
    await waitUntilInvoked('run');
    controller.abort();
    await expectGoalError(promise, 'GOAL_PROTOCOL_TRANSPORT');
  }, 10_000);
});

describe('runStub — argument validation before any spawn', () => {
  it('rejects an unknown scenario before spawning', async () => {
    await expectGoalError(
      runStub(
        makeDeps(),
        baseInput({
          scenario:
            'not-a-real-scenario' as unknown as RunStubInput['scenario'],
        })
      ),
      'GOAL_INVALID_INPUT'
    );
    expect(verbsInvoked()).toEqual([]);
  });

  it('rejects await-cancel without --timeout-ms before spawning', async () => {
    await expectGoalError(
      runStub(makeDeps(), baseInput({ scenario: 'await-cancel' })),
      'GOAL_INVALID_INPUT'
    );
    expect(verbsInvoked()).toEqual([]);
  });

  it.each([0, -1, 1.5, 3_600_001, Number.MAX_SAFE_INTEGER])(
    'rejects an out-of-range timeout-ms value %s before spawning',
    async (timeoutMs) => {
      await expectGoalError(
        runStub(makeDeps(), baseInput({ timeoutMs })),
        'GOAL_INVALID_INPUT'
      );
      expect(verbsInvoked()).toEqual([]);
    }
  );
});

describe('runStub probe outcome hardening (review dispositions)', () => {
  it.each(['valid-then-exit-1', 'valid-with-stderr'])(
    'rejects a version probe whose stdout contradicts its exit/stderr (%s) and never runs',
    async (mode) => {
      await expectGoalError(
        runStub(makeDeps({ FAKE_PROVIDER_VERSION_MODE: mode }), baseInput()),
        'GOAL_PROTOCOL_INVALID'
      );
      expect(verbsInvoked()).toEqual(['version']);
    }
  );

  it('maps an expected SIGTERM close of a default-disposition probe to the local cause', async () => {
    const controller = new AbortController();
    const promise = runStub(
      makeDeps({
        FAKE_PROVIDER_DEFAULT_SIGNAL: '1',
        FAKE_PROVIDER_VERSION_DELAY_MS: '20000',
      }),
      baseInput({ signal: controller.signal })
    );
    await waitUntilInvoked('version');
    controller.abort();
    const err = await expectGoalError(promise, 'GOAL_RUN_CANCELLED');
    expect(err.localCause).toBe('caller-cancelled');
    expect(verbsInvoked()).toEqual(['version']);
  });

  it('maps a deadline that kills a default-disposition capabilities probe to GOAL_RUN_DEADLINE_EXCEEDED', async () => {
    const err = await expectGoalError(
      runStub(
        makeDeps({
          FAKE_PROVIDER_DEFAULT_SIGNAL: '1',
          FAKE_PROVIDER_CAPABILITIES_DELAY_MS: '20000',
        }),
        baseInput({ deadlineMs: 1500 })
      ),
      'GOAL_RUN_DEADLINE_EXCEEDED'
    );
    expect(err.localCause).toBe('deadline');
    expect(verbsInvoked()).toEqual(['version', 'capabilities']);
  });

  it('classifies RUN_STDOUT_TRANSPORT_FAILED with no events as transport', async () => {
    const err = await expectGoalError(
      runStub(
        makeDeps({
          FAKE_PROVIDER_RUN_MODE: 'no-output',
          FAKE_PROVIDER_EXIT_CODE: '1',
          FAKE_PROVIDER_PREFLIGHT_STDERR: JSON.stringify({
            error: { code: 'RUN_STDOUT_TRANSPORT_FAILED', message: 'drain' },
          }),
        }),
        baseInput()
      ),
      'GOAL_PROTOCOL_TRANSPORT'
    );
    expect(err.retryable).toBe(true);
  });
});

describe('runStub scenario binding and pre-admission cancellation', () => {
  it('rejects a peer that reports a different scenario than requested', async () => {
    const err = await expectGoalError(
      runStub(
        makeDeps({ FAKE_PROVIDER_REPORT_SCENARIO: 'success' }),
        baseInput({ scenario: 'failed' })
      ),
      'GOAL_PROTOCOL_INVALID'
    );
    expect(err.message).toContain('instead of failed');
  });

  it('maps a SIGTERM that lands before run.start on a default-disposition engine to the local cause', async () => {
    const controller = new AbortController();
    const promise = runStub(
      makeDeps({
        FAKE_PROVIDER_DEFAULT_SIGNAL: '1',
        FAKE_PROVIDER_RUN_START_DELAY_MS: '20000',
      }),
      baseInput({ signal: controller.signal })
    );
    await waitUntilInvoked('run');
    controller.abort();
    const err = await expectGoalError(promise, 'GOAL_RUN_CANCELLED');
    expect(err.localCause).toBe('caller-cancelled');
    expect(err.runId).toBeUndefined();
  });
});
