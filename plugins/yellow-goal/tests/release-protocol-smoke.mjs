// Explicit released-artifact Provider Protocol v1 smoke through the consumer
// CLI. Not discovered by the fake-only unit suite. Drives only the fixed
// `run-stub` operation against the installed public engine: every scenario,
// the noninteractive DoD gate, the engine timeout and a consumer-forwarded
// SIGTERM. A failing `claude`/`codex` trap sits first on PATH and the scratch
// target's sentinel, HEAD, tree and status are snapshotted before and after.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PINNED_ENGINE_VERSION } from '../dist/pin.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'dist', 'cli.js');
const bin = process.env.GOAL_GEN_BIN;
assert.ok(
  bin && path.isAbsolute(bin),
  'GOAL_GEN_BIN must be the absolute installed release executable'
);
const scratch = mkdtempSync(path.join(tmpdir(), 'goal-release-protocol-'));
const trapDir = path.join(scratch, 'provider-trap-bin');
const trapMarker = path.join(scratch, 'provider-invoked');
mkdirSync(trapDir);
for (const name of ['claude', 'codex']) {
  const trap = path.join(trapDir, name);
  writeFileSync(
    trap,
    `#!/bin/sh\nprintf attempted > '${trapMarker}'\nexit 97\n`
  );
  chmodSync(trap, 0o755);
}
const env = {
  PATH: `${trapDir}${path.delimiter}${process.env.PATH ?? ''}`,
  HOME: path.join(scratch, 'home'),
  TMPDIR: path.join(scratch, 'tmp'),
  GOAL_GEN_BIN: bin,
  NODE_OPTIONS: '',
};
mkdirSync(env.HOME);
mkdirSync(env.TMPDIR);
let checks = 0;

function invoke(executable, args, extra = {}) {
  const result = spawnSync(executable, args, {
    env: { ...env, ...extra },
    encoding: 'utf8',
    timeout: 60_000,
    killSignal: 'SIGKILL',
    shell: false,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  checks++;
  return result;
}
function json(text) {
  assert.equal(text.trim().split(/\r?\n/).length, 1, text);
  return JSON.parse(text);
}
function git(target, args) {
  const result = invoke('git', ['-C', target, ...args]);
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}
function snapshot(target, sentinel) {
  return {
    head: git(target, ['rev-parse', 'HEAD']).trim(),
    tree: git(target, ['write-tree']).trim(),
    status: git(target, ['status', '--porcelain=v1']),
    sentinel: readFileSync(sentinel, 'utf8'),
  };
}
function runStub(args) {
  const result = invoke(process.execPath, [cli, 'run-stub', ...args]);
  return { result, body: json(result.stdout) };
}
function expectFailure(args, code, extra = {}) {
  const { result, body } = runStub(args);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(body.ok, false);
  assert.equal(body.operation, 'run-stub');
  assert.equal(body.error.code, code, JSON.stringify(body.error));
  for (const [key, value] of Object.entries(extra)) {
    assert.equal(body.error[key], value, `${key} on ${code}`);
  }
  assert.match(result.stderr, new RegExp(`^${code}:`));
  return body;
}

try {
  const target = path.join(scratch, 'target');
  mkdirSync(target);
  const sentinel = path.join(target, 'protocol-smoke-sentinel.txt');
  writeFileSync(sentinel, 'public target remains unchanged\n');
  assert.equal(invoke('git', ['-C', target, 'init', '-q']).status, 0);
  git(target, ['add', 'protocol-smoke-sentinel.txt']);
  git(target, [
    '-c',
    'user.name=smoke',
    '-c',
    'user.email=smoke@invalid',
    'commit',
    '-q',
    '-m',
    'fixture',
  ]);
  const before = snapshot(target, sentinel);

  // Canonical request via the read-only bridge, then the same stub-only
  // consent fields the engine's own installed smoke applies.
  const request = path.join(scratch, 'request.json');
  const created = invoke(process.execPath, [
    cli,
    'request',
    'create',
    '--repo',
    target,
    '--goal',
    'protocol smoke',
    '--output',
    request,
  ]);
  assert.equal(created.status, 0, created.stderr);
  const packet = JSON.parse(readFileSync(request, 'utf8'));
  packet.mode = 'approved-implementation';
  packet.constraints = {
    ...(packet.constraints ?? {}),
    readOnlyTarget: false,
    allowTargetEdits: true,
  };
  packet.orchestration = {
    ...(packet.orchestration ?? {}),
    permissionProfile: 'implement',
    execution: { autoConfirmDod: true },
  };
  writeFileSync(request, `${JSON.stringify(packet)}\n`);
  const validated = invoke(process.execPath, [
    cli,
    'request',
    'validate',
    request,
  ]);
  assert.equal(validated.status, 0, validated.stderr);

  // success
  {
    const { result, body } = runStub([
      request,
      '--scenario',
      'success',
      '--yes',
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(body.ok, true);
    assert.equal(body.operation, 'run-stub');
    assert.equal(body.engineVersion, PINNED_ENGINE_VERSION);
    assert.equal(body.protocolVersion, 'yellow-goal/provider-protocol/v1');
    assert.ok(typeof body.runId === 'string' && body.runId.length > 0);
    assert.ok(Number.isSafeInteger(body.eventCount) && body.eventCount > 1);
    assert.equal(body.summary.status, 'succeeded');
    assert.equal(body.summary.costUsd, 0);
    assert.ok(!('events' in body));
  }
  // deterministic failures
  expectFailure([request, '--scenario', 'failed', '--yes'], 'GOAL_RUN_FAILED', {
    terminalStatus: 'failed',
  });
  expectFailure(
    [request, '--scenario', 'budget-exhausted', '--yes'],
    'GOAL_RUN_BUDGET_EXHAUSTED',
    { terminalStatus: 'budget-exhausted' }
  );
  // noninteractive DoD gate: no --yes and autoConfirmDod false
  const gated = path.join(scratch, 'gated.json');
  writeFileSync(
    gated,
    `${JSON.stringify({
      ...packet,
      orchestration: {
        ...packet.orchestration,
        execution: { autoConfirmDod: false },
      },
    })}\n`
  );
  expectFailure([gated, '--scenario', 'success'], 'GOAL_RUN_GATE_REQUIRED', {
    terminalStatus: 'cancelled',
    terminationReason: 'gate-required',
    gateKind: 'dod',
  });
  // engine timeout
  expectFailure(
    [request, '--scenario', 'await-cancel', '--timeout-ms', '5', '--yes'],
    'GOAL_RUN_ENGINE_TIMEOUT',
    { terminalStatus: 'cancelled', terminationReason: 'timeout' }
  );
  // consumer-forwarded SIGTERM through the CLI
  {
    const child = spawn(
      process.execPath,
      [
        cli,
        'run-stub',
        request,
        '--scenario',
        'await-cancel',
        '--timeout-ms',
        '30000',
        '--yes',
      ],
      { env, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    setTimeout(() => child.kill('SIGTERM'), 3000);
    const exit = await new Promise((resolve, reject) => {
      // Bounded like every invoke(): a stalled consumer or engine must fail
      // the gate, never hang it.
      const watchdog = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('forwarded-SIGTERM smoke did not close within 60s'));
      }, 60_000);
      child.once('close', (code, signal) => {
        clearTimeout(watchdog);
        resolve({ code, signal });
      });
    });
    checks++;
    assert.equal(
      exit.signal,
      null,
      'consumer must exit normally after forwarding'
    );
    assert.equal(exit.code, 1, stderr);
    const body = json(stdout);
    assert.equal(body.ok, false);
    assert.equal(
      body.error.code,
      'GOAL_RUN_CANCELLED',
      JSON.stringify(body.error)
    );
    assert.equal(body.error.localCause, 'caller-cancelled');
    assert.ok(
      typeof body.error.runId === 'string' && body.error.runId.length > 0
    );
  }
  // fixed authority: no executor/protocol selectors
  for (const args of [
    [request, '--executor', 'claude-code'],
    [request, '--protocol', 'v1'],
    [request, '--scenario', 'nope'],
    [request, '--scenario', 'await-cancel'],
    [],
  ]) {
    const usage = invoke(process.execPath, [cli, 'run-stub', ...args]);
    assert.equal(usage.status, 2, usage.stderr);
    assert.equal(json(usage.stdout).error.code, 'GOAL_INVALID_INPUT');
  }

  assert.deepEqual(snapshot(target, sentinel), before, 'target changed');
  assert.throws(() => readFileSync(trapMarker), 'a real provider was invoked');
  process.stdout.write(
    `release protocol smoke passed: ${checks} invocations; stub-only run-stub through the public asset, no provider invocation, target unchanged\n`
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
