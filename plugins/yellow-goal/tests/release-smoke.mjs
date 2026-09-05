// Explicit release-artifact smoke; not discovered by the fake-only unit suite.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { PINNED_ENGINE_VERSION } from '../dist/pin.js';
import {
  CONSUMER_LIMITS,
  parseSingleJsonObject,
  validateCapabilities,
  validateVersionProbe,
} from '../dist/provider-protocol.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'dist', 'cli.js');
const bin = process.env.GOAL_GEN_BIN;
assert.ok(
  bin && path.isAbsolute(bin),
  'GOAL_GEN_BIN must be the absolute installed release executable'
);
const scratch = mkdtempSync(path.join(tmpdir(), 'goal-release-smoke-'));
const env = { ...process.env, GOAL_GEN_BIN: bin, NODE_OPTIONS: '' };
let checks = 0;
function invoke(executable, args, extraEnv = {}, { raw = false } = {}) {
  const result = spawnSync(executable, args, {
    env: { ...env, ...extraEnv },
    // Protocol probes keep raw bytes so the validators' fatal UTF-8 check is
    // exercised on the actual artifact output, not on a lossy decode.
    ...(raw ? {} : { encoding: 'utf8' }),
    timeout: 10_000,
    killSignal: 'SIGKILL',
    shell: false,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  checks++;
  return result;
}
function json(text) {
  assert.equal(text.trim().split(/\r?\n/).length, 1);
  return JSON.parse(text);
}
try {
  // The target contains a sentinel only; version/create/validate may not touch it.
  const target = path.join(scratch, 'target');
  mkdirSync(target);
  const sentinel = path.join(target, 'target-marker');
  writeFileSync(sentinel, 'untouched\n');
  assert.equal(invoke('git', ['-C', target, 'init', '-q']).status, 0);
  const before = invoke('git', ['-C', target, 'status', '--porcelain']).stdout;
  const request = path.join(scratch, 'request.json');
  const version = invoke(bin, ['version', '--json'], {}, { raw: true });
  assert.equal(version.status, 0);
  assert.equal(version.stderr.length, 0);
  assert.equal(
    validateVersionProbe(
      parseSingleJsonObject(
        version.stdout,
        'version stdout',
        CONSUMER_LIMITS.bootstrapMaxStdoutBytes
      ),
      PINNED_ENGINE_VERSION
    ),
    PINNED_ENGINE_VERSION
  );
  // Provider Protocol v1 discovery handshake against the public artifact:
  // static, offline, and validated by the consumer's own observable-data
  // guards (never a copied engine schema).
  const capabilities = invoke(
    bin,
    ['capabilities', '--json'],
    {},
    { raw: true }
  );
  assert.equal(capabilities.status, 0);
  assert.equal(capabilities.stderr.length, 0);
  const validated = validateCapabilities(
    parseSingleJsonObject(
      capabilities.stdout,
      'capabilities stdout',
      CONSUMER_LIMITS.bootstrapMaxStdoutBytes
    ),
    PINNED_ENGINE_VERSION
  );
  assert.equal(validated.engineVersion, PINNED_ENGINE_VERSION);
  assert.equal(validated.protocolVersion, 'yellow-goal/provider-protocol/v1');
  const capabilitiesUsage = invoke(bin, ['capabilities', 'extra']);
  assert.equal(capabilitiesUsage.status, 2);
  assert.equal(capabilitiesUsage.stdout, '');
  assert.equal(json(capabilitiesUsage.stderr).error.code, 'USAGE_ERROR');
  for (const args of [
    ['setup'],
    [
      'request',
      'create',
      '--repo',
      target,
      '--goal',
      'zero-spend compatibility',
      '--output',
      request,
    ],
    ['request', 'validate', request],
  ]) {
    const result = invoke(process.execPath, [cli, ...args]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(json(result.stdout).ok, true);
  }
  const invalid = path.join(scratch, 'invalid.json');
  writeFileSync(invalid, '{}\n');
  const validation = invoke(bin, ['request', 'validate', invalid, '--json']);
  assert.equal(validation.status, 1);
  assert.equal(validation.stderr, '');
  const invalidResult = json(validation.stdout);
  assert.equal(invalidResult.valid, false);
  assert.equal(invalidResult.path, invalid);
  assert.ok(
    Array.isArray(invalidResult.errors) && invalidResult.errors.length > 0
  );
  assert.ok(
    invalidResult.errors.every(
      (error) =>
        typeof error.path === 'string' && typeof error.message === 'string'
    )
  );
  const bridgedInvalid = invoke(process.execPath, [
    cli,
    'request',
    'validate',
    invalid,
  ]);
  assert.equal(bridgedInvalid.status, 1);
  assert.equal(json(bridgedInvalid.stdout).error.code, 'GOAL_ENGINE_FAILED');
  assert.match(bridgedInvalid.stderr, /^GOAL_ENGINE_FAILED:/);
  for (const args of [
    ['request', 'validate', request, 'extra.json'],
    ['request', 'create', '--bogus'],
  ]) {
    const usage = invoke(bin, args);
    assert.equal(usage.status, 2);
    assert.equal(usage.stdout, '');
    assert.equal(json(usage.stderr).error.code, 'USAGE_ERROR');
  }
  const mismatch = invoke(process.execPath, [cli, 'setup'], {
    GOAL_GEN_BIN: process.execPath,
    NODE_OPTIONS: `--import=${pathToFileURL(path.join(root, 'tests', 'fixtures', 'fake-engine.mjs')).href}`,
    FAKE_GOAL_CLI_PATH: cli,
    FAKE_GOAL_GEN_MODE: 'mismatch',
    FAKE_GOAL_GEN_VERSION: '9.9.9',
  });
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stderr, /^GOAL_ENGINE_VERSION_MISMATCH:/);
  assert.equal(
    json(mismatch.stdout).error.code,
    'GOAL_ENGINE_VERSION_MISMATCH'
  );
  assert.equal(readFileSync(sentinel, 'utf8'), 'untouched\n');
  assert.equal(
    invoke('git', ['-C', target, 'status', '--porcelain']).stdout,
    before
  );
  process.stdout.write(
    `release process smoke passed: ${checks} invocations; version/capabilities/create/validate only, no run or provider operations\n`
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
