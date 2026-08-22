#!/usr/bin/env node
/**
 * Entry point. Exactly one JSON object on stdout per invocation; all
 * diagnostics go to stderr. Exit codes: 0 on ok:true, 1 on ok:false
 * (a well-formed business-rule/SDK failure), 2 on a CLI usage error
 * (unknown subcommand, missing required flag, unparseable argv).
 */

import * as crypto from 'node:crypto';
import * as os from 'node:os';
import { parseArgs } from 'node:util';

import { resolveDataDir, resolveStateFilePath } from './config.js';
import { toAppError } from './errors.js';
import { redactDeep } from './redact.js';
import * as runtime from './runtime.js';
import type { RuntimeDeps } from './runtime.js';
import { CursorSdkAdapter } from './sdk-adapter.js';

const KNOWN_OPERATIONS = [
  'setup',
  'delegate',
  'list',
  'status',
  'follow-up',
  'cancel',
  'artifacts',
  'usage',
  'archive',
  'unarchive',
] as const;

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(redactDeep(value))}\n`);
}

class UsageError extends Error {}

function requireString(value: string | undefined, flag: string): string {
  if (value === undefined) {
    throw new UsageError(`missing required flag ${flag}`);
  }
  return value;
}

function buildDeps(): RuntimeDeps {
  const dataDir = resolveDataDir();
  return {
    adapter: new CursorSdkAdapter(dataDir),
    dataDir,
    stateFilePath: resolveStateFilePath(dataDir),
    clock: runtime.REAL_CLOCK,
    env: process.env,
  };
}

/** Set by the delegate/follow-up cases before their runtime call, so a thrown error can still echo the resolved key. */
let pendingIdempotencyKey: string | undefined;

type OperationResult =
  | runtime.SetupResult
  | runtime.DelegateResult
  | runtime.FollowUpResult
  | runtime.ListResult
  | runtime.StatusResult
  | runtime.CancelResult
  | runtime.ArchiveResult
  | runtime.ArtifactsResult
  | runtime.UsageResult;

async function dispatch(
  operation: string,
  rest: readonly string[],
  deps: RuntimeDeps
): Promise<OperationResult> {
  switch (operation) {
    case 'setup': {
      const { values } = parseArgs({
        args: rest,
        options: { 'install-sdk': { type: 'boolean', default: false } },
        strict: true,
        allowPositionals: false,
      });
      return await runtime.setup(deps, {
        installSdk: Boolean(values['install-sdk']),
      });
    }

    case 'delegate': {
      const { values } = parseArgs({
        args: rest,
        options: {
          repo: { type: 'string' },
          ref: { type: 'string' },
          model: { type: 'string' },
          prompt: { type: 'string' },
          yes: { type: 'boolean', default: false },
          'dry-run': { type: 'boolean', default: false },
          'idempotency-key': { type: 'string' },
          'max-active': { type: 'string', default: '3' },
          'no-auto-create-pr': { type: 'boolean', default: false },
          'linear-issue': { type: 'string' },
          'calling-host': { type: 'string' },
        },
        strict: true,
        allowPositionals: false,
      });
      const repo = requireString(values.repo as string | undefined, '--repo');
      const prompt = requireString(
        values.prompt as string | undefined,
        '--prompt'
      );
      const idempotencyKey =
        (values['idempotency-key'] as string | undefined) ??
        crypto.randomUUID();
      pendingIdempotencyKey = idempotencyKey;

      const maxActiveRaw = values['max-active'] as string;
      // Number.parseInt('3abc', 10) === 3 — parses a leading numeric prefix
      // and silently ignores trailing garbage. Require the whole flag value
      // to be digits before parsing so "3abc" is rejected, not truncated.
      if (!/^\d+$/.test(maxActiveRaw)) {
        throw new UsageError(
          `--max-active must be a positive integer, got "${maxActiveRaw}"`
        );
      }
      const maxActive = Number.parseInt(maxActiveRaw, 10);

      return await runtime.delegate(deps, {
        repoUrl: repo,
        prompt,
        idempotencyKey,
        maxActive,
        yes: Boolean(values.yes),
        dryRun: Boolean(values['dry-run']),
        autoCreatePr: !values['no-auto-create-pr'],
        ...(values.ref !== undefined
          ? { startingRef: values.ref as string }
          : {}),
        ...(values.model !== undefined
          ? { model: values.model as string }
          : {}),
        ...(values['linear-issue'] !== undefined
          ? { linearIssue: values['linear-issue'] as string }
          : {}),
        ...(values['calling-host'] !== undefined
          ? { callingHost: values['calling-host'] as string }
          : { callingHost: os.hostname() }),
      });
    }

    case 'follow-up': {
      const { values } = parseArgs({
        args: rest,
        options: {
          'agent-id': { type: 'string' },
          prompt: { type: 'string' },
          yes: { type: 'boolean', default: false },
          'idempotency-key': { type: 'string' },
        },
        strict: true,
        allowPositionals: false,
      });
      const agentId = requireString(
        values['agent-id'] as string | undefined,
        '--agent-id'
      );
      const prompt = requireString(
        values.prompt as string | undefined,
        '--prompt'
      );
      const idempotencyKey =
        (values['idempotency-key'] as string | undefined) ??
        crypto.randomUUID();
      pendingIdempotencyKey = idempotencyKey;

      return await runtime.followUp(deps, {
        agentId,
        prompt,
        idempotencyKey,
        yes: Boolean(values.yes),
      });
    }

    case 'list': {
      const { values } = parseArgs({
        args: rest,
        options: {
          cursor: { type: 'string' },
          archived: { type: 'boolean' },
        },
        strict: true,
        allowPositionals: false,
      });
      return await runtime.list(deps, {
        archived: values.archived === true,
        ...(values.cursor !== undefined
          ? { cursor: values.cursor as string }
          : {}),
      });
    }

    case 'status': {
      const { values } = parseArgs({
        args: rest,
        options: {
          'agent-id': { type: 'string' },
          'run-id': { type: 'string' },
          reconcile: { type: 'boolean', default: false },
        },
        strict: true,
        allowPositionals: false,
      });
      const agentId = requireString(
        values['agent-id'] as string | undefined,
        '--agent-id'
      );
      return await runtime.status(deps, {
        agentId,
        reconcile: Boolean(values.reconcile),
        ...(values['run-id'] !== undefined
          ? { runId: values['run-id'] as string }
          : {}),
      });
    }

    case 'cancel': {
      const { values } = parseArgs({
        args: rest,
        options: {
          'run-id': { type: 'string' },
          'agent-id': { type: 'string' },
          yes: { type: 'boolean', default: false },
        },
        strict: true,
        allowPositionals: false,
      });
      const runId = requireString(
        values['run-id'] as string | undefined,
        '--run-id'
      );
      const agentId = requireString(
        values['agent-id'] as string | undefined,
        '--agent-id'
      );
      return await runtime.cancel(deps, {
        runId,
        agentId,
        yes: Boolean(values.yes),
      });
    }

    case 'archive': {
      const { values } = parseArgs({
        args: rest,
        options: {
          'agent-id': { type: 'string' },
          yes: { type: 'boolean', default: false },
          force: { type: 'boolean', default: false },
        },
        strict: true,
        allowPositionals: false,
      });
      const agentId = requireString(
        values['agent-id'] as string | undefined,
        '--agent-id'
      );
      return await runtime.archive(deps, {
        agentId,
        yes: Boolean(values.yes),
        force: Boolean(values.force),
      });
    }

    case 'unarchive': {
      const { values } = parseArgs({
        args: rest,
        options: {
          'agent-id': { type: 'string' },
          yes: { type: 'boolean', default: false },
        },
        strict: true,
        allowPositionals: false,
      });
      const agentId = requireString(
        values['agent-id'] as string | undefined,
        '--agent-id'
      );
      return await runtime.unarchive(deps, {
        agentId,
        yes: Boolean(values.yes),
      });
    }

    case 'artifacts': {
      const { values } = parseArgs({
        args: rest,
        options: {
          'agent-id': { type: 'string' },
          download: { type: 'string' },
          out: { type: 'string' },
        },
        strict: true,
        allowPositionals: false,
      });
      const agentId = requireString(
        values['agent-id'] as string | undefined,
        '--agent-id'
      );
      return await runtime.artifacts(deps, {
        agentId,
        ...(values.download !== undefined
          ? { download: values.download as string }
          : {}),
        ...(values.out !== undefined ? { out: values.out as string } : {}),
      });
    }

    case 'usage': {
      const { values } = parseArgs({
        args: rest,
        options: { 'agent-id': { type: 'string' } },
        strict: true,
        allowPositionals: false,
      });
      const agentId = requireString(
        values['agent-id'] as string | undefined,
        '--agent-id'
      );
      return await runtime.usage(deps, { agentId });
    }

    default:
      throw new UsageError(
        `unknown subcommand "${operation}"; expected one of: ${KNOWN_OPERATIONS.join(', ')}`
      );
  }
}

async function main(): Promise<void> {
  const [operation, ...rest] = process.argv.slice(2);
  const resolvedOperation = operation ?? 'unknown';

  if (operation === undefined) {
    process.stderr.write(
      `no subcommand given; expected one of: ${KNOWN_OPERATIONS.join(', ')}\n`
    );
    printJson({
      ok: false,
      operation: 'unknown',
      error: {
        code: 'CURSOR_INVALID_INPUT',
        message: `no subcommand given; expected one of: ${KNOWN_OPERATIONS.join(', ')}`,
        retryable: false,
        recoveryAction: 'Pass a subcommand and retry.',
      },
    });
    process.exit(2);
  }

  try {
    const deps = buildDeps();
    const result = await dispatch(operation, rest, deps);
    printJson({ ok: true, ...result });
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`${err.message}\n`);
      printJson({
        ok: false,
        operation: resolvedOperation,
        error: {
          code: 'CURSOR_INVALID_INPUT',
          message: err.message,
          retryable: false,
          recoveryAction: 'Fix the reported CLI invocation and retry.',
        },
      });
      process.exit(2);
    }

    const appError = toAppError(err);
    process.stderr.write(`${appError.code}: ${redactDeep(appError.message)}\n`);
    printJson({
      ok: false,
      operation: resolvedOperation,
      ...(pendingIdempotencyKey !== undefined
        ? { idempotencyKey: pendingIdempotencyKey }
        : {}),
      error: appError,
    });
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`unexpected error: ${String(err)}\n`);
  process.exit(1);
});
