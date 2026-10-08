#!/usr/bin/env node
/**
 * Entry point. Exactly one JSON object on stdout per invocation (one line,
 * redacted); diagnostics go to stderr only. Exit codes: 0 on ok:true, 1 on
 * a well-formed operational failure, 2 on a CLI usage error (unknown
 * subcommand, missing flag, unparseable argv), which still prints a valid
 * `{ ok: false, operation, error }` envelope (R7).
 *
 * PR2 ships the read-only surface only. `delegate`, `reply`, and `approve`
 * are usage errors until PR3; `cancel`, `pause`, `resume`, and `cost` are
 * recognized and answer JULES_UNSUPPORTED_CAPABILITY (R11).
 */

import { parseArgs } from 'node:util';

import { GRANT_CEILINGS } from './authority.js';
import {
  authorizeCreate,
  authorizeList,
  authorizeRevoke,
  authorizeTakeOver,
} from './authorize.js';
import { resolveDataDir } from './config.js';
import {
  DEFAULT_COLLECT_DEADLINE_MS,
  DEFAULT_MUTATION_DEADLINE_MS,
  DEFAULT_READ_DEADLINE_MS,
} from './deadline.js';
import { MutationErrorException, throwAppError, toAppError } from './errors.js';
import {
  installFetchGuard,
  READ_TIMEOUT_MS,
  VENDOR_ORIGIN,
} from './fetch-guard.js';
import { abandon, approve, delegate, reply } from './mutations.js';
import { redact, redactDeep } from './redact.js';
import * as runtime from './runtime.js';
import type { RuntimeDeps } from './runtime.js';
import { JulesSdkAdapter, type SdkModule } from './sdk-adapter.js';
import { resolveSdk } from './sdk-resolver.js';
import { clearPause, superviseOnce } from './supervise.js';
import { getTestTransport } from './test-seam.js';
import { validatePositiveInt } from './validate.js';

const KNOWN_OPERATIONS = [
  'setup',
  'list',
  'status',
  'collect',
  'delegate',
  'reply',
  'approve',
  'authorize',
  'abandon',
  'supervise',
] as const;
const UNSUPPORTED_OPERATIONS = ['cancel', 'pause', 'resume', 'cost'] as const;
const LATER_OPERATIONS = ['integrate'] as const;
// Deadline plus one in-flight read (up to the 60 s client timeout) plus the
// post-walk staging and journal writes must fit inside the wrappers' 300 s
// Bash timeout, or the run is killed mid-write.
const MAX_DEADLINE_MS = 200_000;

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(redactDeep(value))}\n`);
}

class UsageError extends Error {}

function isParseArgsError(err: unknown): boolean {
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS_');
}

function requireString(value: unknown, flag: string): string {
  if (typeof value !== 'string')
    throw new UsageError(`missing required flag ${flag}`);
  return value;
}

function deadlineFlag(value: unknown, fallback: number): number {
  return typeof value === 'string'
    ? validatePositiveInt(value, '--deadline-ms', 1, MAX_DEADLINE_MS)
    : fallback;
}

function buildDeps(): RuntimeDeps {
  const dataDir = resolveDataDir();
  return {
    dataDir,
    clock: runtime.REAL_CLOCK,
    env: process.env,
    adapterFactory: async () => {
      const apiKey = process.env['JULES_API_KEY'];
      if (apiKey === undefined || apiKey === '') {
        return throwAppError('JULES_AUTH_FAILED', 'JULES_API_KEY is not set');
      }
      const resolved = await resolveSdk(dataDir);
      const transport = getTestTransport();
      // Installed before the adapter exists, so no SDK request can bypass it.
      const guard = installFetchGuard({
        allowedOrigins: transport?.allowedOrigins ?? [VENDOR_ORIGIN],
        readTimeoutMs: READ_TIMEOUT_MS,
      });
      return JulesSdkAdapter.connect({
        sdk: resolved.module as SdkModule,
        dataDir,
        apiKey,
        postCount: guard.postCount,
        ...(transport !== undefined ? { baseUrl: transport.baseUrl } : {}),
      });
    },
  };
}

type OperationResult =
  | runtime.SetupResult
  | runtime.ListResult
  | runtime.StatusResult
  | runtime.CollectResult
  | Awaited<ReturnType<typeof authorizeCreate>>
  | ReturnType<typeof authorizeList>
  | Awaited<ReturnType<typeof authorizeRevoke>>
  | Awaited<ReturnType<typeof authorizeTakeOver>>
  | Awaited<ReturnType<typeof delegate>>
  | Awaited<ReturnType<typeof reply>>
  | Awaited<ReturnType<typeof approve>>
  | Awaited<ReturnType<typeof abandon>>
  | Awaited<ReturnType<typeof superviseOnce>>
  | Awaited<ReturnType<typeof clearPause>>;

async function dispatch(
  operation: string,
  rest: readonly string[],
  deps: RuntimeDeps
): Promise<OperationResult> {
  const deadline = { 'deadline-ms': { type: 'string' as const } };
  switch (operation) {
    case 'setup': {
      const { values } = parseArgs({
        args: [...rest],
        options: {
          'install-sdk': { type: 'boolean', default: false },
          ...deadline,
        },
        strict: true,
        allowPositionals: false,
      });
      return runtime.setup(deps, {
        installSdk: values['install-sdk'] === true,
        deadlineMs: deadlineFlag(
          values['deadline-ms'],
          DEFAULT_READ_DEADLINE_MS
        ),
      });
    }

    case 'list': {
      const { values } = parseArgs({
        args: [...rest],
        options: {
          limit: { type: 'string' },
          'page-token': { type: 'string' },
          ...deadline,
        },
        strict: true,
        allowPositionals: false,
      });
      return runtime.list(deps, {
        ...(typeof values.limit === 'string'
          ? {
              limit: validatePositiveInt(
                values.limit,
                '--limit',
                1,
                runtime.LIST_MAX_LIMIT
              ),
            }
          : {}),
        ...(typeof values['page-token'] === 'string'
          ? { pageToken: values['page-token'] }
          : {}),
        deadlineMs: deadlineFlag(
          values['deadline-ms'],
          DEFAULT_READ_DEADLINE_MS
        ),
      });
    }

    case 'status': {
      const { values } = parseArgs({
        args: [...rest],
        options: {
          session: { type: 'string' },
          reconcile: { type: 'boolean', default: false },
          ...deadline,
        },
        strict: true,
        allowPositionals: false,
      });
      if (values.session === undefined && values.reconcile !== true) {
        throw new UsageError(
          'missing required flag --session (or pass --reconcile)'
        );
      }
      return runtime.status(deps, {
        ...(typeof values.session === 'string'
          ? { session: values.session }
          : {}),
        reconcile: values.reconcile === true,
        deadlineMs: deadlineFlag(
          values['deadline-ms'],
          DEFAULT_READ_DEADLINE_MS
        ),
      });
    }

    case 'collect': {
      const { values } = parseArgs({
        args: [...rest],
        options: { session: { type: 'string' }, ...deadline },
        strict: true,
        allowPositionals: false,
      });
      return runtime.collect(deps, {
        session: requireString(values.session, '--session'),
        deadlineMs: deadlineFlag(
          values['deadline-ms'],
          DEFAULT_COLLECT_DEADLINE_MS
        ),
      });
    }

    case 'delegate': {
      const { values } = parseArgs({
        args: [...rest],
        options: {
          repo: { type: 'string' },
          branch: { type: 'string' },
          prompt: { type: 'string' },
          title: { type: 'string' },
          'task-ref': { type: 'string' },
          'request-id': { type: 'string' },
          'grant-id': { type: 'string' },
          'dry-run': { type: 'boolean', default: false },
          correction: { type: 'boolean', default: false },
          ...deadline,
        },
        strict: true,
        allowPositionals: false,
      });
      return delegate(deps, {
        repo: requireString(values.repo, '--repo'),
        branch: requireString(values.branch, '--branch'),
        prompt: requireString(values.prompt, '--prompt'),
        ...(typeof values.title === 'string' ? { title: values.title } : {}),
        ...(typeof values['task-ref'] === 'string'
          ? { taskRef: values['task-ref'] }
          : {}),
        ...(typeof values['request-id'] === 'string'
          ? { requestId: values['request-id'] }
          : {}),
        ...(typeof values['grant-id'] === 'string'
          ? { grantId: values['grant-id'] }
          : {}),
        dryRun: values['dry-run'] === true,
        correction: values.correction === true,
        deadlineMs: deadlineFlag(
          values['deadline-ms'],
          DEFAULT_MUTATION_DEADLINE_MS
        ),
      });
    }

    case 'reply': {
      const { values } = parseArgs({
        args: [...rest],
        options: {
          session: { type: 'string' },
          message: { type: 'string' },
          'request-id': { type: 'string' },
          'grant-id': { type: 'string' },
          'dry-run': { type: 'boolean', default: false },
          correction: { type: 'boolean', default: false },
          ...deadline,
        },
        strict: true,
        allowPositionals: false,
      });
      return reply(deps, {
        session: requireString(values.session, '--session'),
        message: requireString(values.message, '--message'),
        ...(typeof values['request-id'] === 'string'
          ? { requestId: values['request-id'] }
          : {}),
        ...(typeof values['grant-id'] === 'string'
          ? { grantId: values['grant-id'] }
          : {}),
        dryRun: values['dry-run'] === true,
        correction: values.correction === true,
        deadlineMs: deadlineFlag(
          values['deadline-ms'],
          DEFAULT_MUTATION_DEADLINE_MS
        ),
      });
    }

    case 'approve': {
      const { values } = parseArgs({
        args: [...rest],
        options: {
          session: { type: 'string' },
          'plan-id': { type: 'string' },
          'request-id': { type: 'string' },
          'grant-id': { type: 'string' },
          'dry-run': { type: 'boolean', default: false },
          ...deadline,
        },
        strict: true,
        allowPositionals: false,
      });
      return approve(deps, {
        session: requireString(values.session, '--session'),
        planId: requireString(values['plan-id'], '--plan-id'),
        ...(typeof values['request-id'] === 'string'
          ? { requestId: values['request-id'] }
          : {}),
        ...(typeof values['grant-id'] === 'string'
          ? { grantId: values['grant-id'] }
          : {}),
        dryRun: values['dry-run'] === true,
        deadlineMs: deadlineFlag(
          values['deadline-ms'],
          DEFAULT_MUTATION_DEADLINE_MS
        ),
      });
    }

    case 'abandon': {
      const { values } = parseArgs({
        args: [...rest],
        options: { 'request-id': { type: 'string' }, ...deadline },
        strict: true,
        allowPositionals: false,
      });
      return abandon(deps, {
        requestId: requireString(values['request-id'], '--request-id'),
      });
    }

    case 'supervise': {
      const { values } = parseArgs({
        args: [...rest],
        options: {
          session: { type: 'string' },
          'grant-id': { type: 'string' },
          'clear-pause': { type: 'boolean', default: false },
          ...deadline,
        },
        strict: true,
        allowPositionals: false,
      });
      if (values['clear-pause'] === true) {
        if (typeof values['grant-id'] === 'string') {
          throw new UsageError(
            '--clear-pause takes only --session; it is confirmed on the terminal, not by a grant'
          );
        }
        return clearPause(deps, {
          session: requireString(values.session, '--session'),
        });
      }
      return superviseOnce(deps, {
        session: requireString(values.session, '--session'),
        grantId: requireString(values['grant-id'], '--grant-id'),
        deadlineMs: deadlineFlag(
          values['deadline-ms'],
          DEFAULT_MUTATION_DEADLINE_MS
        ),
      });
    }

    case 'authorize': {
      const { values } = parseArgs({
        args: [...rest],
        options: {
          repo: { type: 'string' },
          branch: { type: 'string' },
          source: { type: 'string' },
          'task-ref': { type: 'string', multiple: true },
          operations: { type: 'string' },
          'max-active-sessions': { type: 'string' },
          'max-total-tasks': { type: 'string' },
          'max-corrective-rounds': { type: 'string' },
          'ttl-minutes': { type: 'string' },
          owner: { type: 'string' },
          'take-over': { type: 'boolean', default: false },
          list: { type: 'boolean', default: false },
          revoke: { type: 'string' },
          ...deadline,
        },
        strict: true,
        allowPositionals: false,
      });
      const modes = [
        values.list === true,
        typeof values.revoke === 'string',
        values['take-over'] === true,
      ].filter(Boolean).length;
      const creationFlags = [
        values.repo,
        values.branch,
        values.source,
        values['task-ref'],
        values.operations,
        values['max-active-sessions'],
        values['max-total-tasks'],
        values['max-corrective-rounds'],
        values['ttl-minutes'],
        values.owner,
      ].some((v) => v !== undefined);
      if (modes > 1 || (modes === 1 && creationFlags)) {
        throw new UsageError(
          'authorize takes exactly one of: grant-creation flags, --list, --revoke <grant-id>, or --take-over'
        );
      }
      if (values.list === true) return authorizeList(deps);
      if (typeof values.revoke === 'string') {
        return authorizeRevoke(deps, values.revoke);
      }
      if (values['take-over'] === true) return authorizeTakeOver(deps);
      const intFlag = (
        raw: unknown,
        flag: string,
        min: number,
        max: number
      ): number | undefined =>
        typeof raw === 'string'
          ? validatePositiveInt(raw, flag, min, max)
          : undefined;
      const maxActiveSessions = intFlag(
        values['max-active-sessions'],
        '--max-active-sessions',
        1,
        GRANT_CEILINGS.maxActiveSessions
      );
      const maxTotalTasks = intFlag(
        values['max-total-tasks'],
        '--max-total-tasks',
        1,
        GRANT_CEILINGS.maxTotalTasks
      );
      const maxCorrectiveRounds = intFlag(
        values['max-corrective-rounds'],
        '--max-corrective-rounds',
        0,
        GRANT_CEILINGS.maxCorrectiveRounds
      );
      const ttlMinutes = intFlag(
        values['ttl-minutes'],
        '--ttl-minutes',
        1,
        GRANT_CEILINGS.ttlMinutes
      );
      return authorizeCreate(deps, {
        repo: requireString(values.repo, '--repo'),
        branch: requireString(values.branch, '--branch'),
        ...(typeof values.source === 'string' ? { source: values.source } : {}),
        taskRefs: values['task-ref'] ?? [],
        operations: requireString(values.operations, '--operations'),
        owner: requireString(values.owner, '--owner'),
        ...(maxActiveSessions !== undefined ? { maxActiveSessions } : {}),
        ...(maxTotalTasks !== undefined ? { maxTotalTasks } : {}),
        ...(maxCorrectiveRounds !== undefined ? { maxCorrectiveRounds } : {}),
        ...(ttlMinutes !== undefined ? { ttlMinutes } : {}),
        deadlineMs: deadlineFlag(
          values['deadline-ms'],
          DEFAULT_READ_DEADLINE_MS
        ),
      });
    }

    default:
      if ((UNSUPPORTED_OPERATIONS as readonly string[]).includes(operation)) {
        return runtime.unsupportedCapability(
          operation as runtime.UnsupportedCapability
        );
      }
      if ((LATER_OPERATIONS as readonly string[]).includes(operation)) {
        throw new UsageError(
          `"${operation}" is not available in this release; the read-only surface is: ${KNOWN_OPERATIONS.join(', ')}`
        );
      }
      throw new UsageError(
        `unknown subcommand "${operation}"; expected one of: ${KNOWN_OPERATIONS.join(', ')}`
      );
  }
}

function usageEnvelope(operation: string, message: string): void {
  process.stderr.write(`${redact(message)}\n`);
  printJson({
    ok: false,
    operation,
    error: {
      code: 'JULES_INVALID_INPUT',
      message,
      retryable: false,
      recoveryAction: 'Fix the reported CLI invocation and retry.',
    },
  });
}

function operationName(operation: string | undefined): string {
  if (operation === undefined) return 'unknown';
  const known = [
    ...KNOWN_OPERATIONS,
    ...UNSUPPORTED_OPERATIONS,
  ] as readonly string[];
  return known.includes(operation) ? operation : 'unknown';
}

async function main(): Promise<void> {
  const [operation, ...rest] = process.argv.slice(2);
  const name = operationName(operation);

  if (operation === undefined) {
    usageEnvelope(
      'unknown',
      `no subcommand given; expected one of: ${KNOWN_OPERATIONS.join(', ')}`
    );
    process.exitCode = 2;
    return;
  }

  try {
    const result = await dispatch(operation, rest, buildDeps());
    printJson({ ok: true, ...result });
    process.exitCode = 0;
  } catch (err) {
    if (err instanceof UsageError || isParseArgsError(err)) {
      usageEnvelope(name, err instanceof Error ? err.message : String(err));
      process.exitCode = 2;
      return;
    }
    const appError = toAppError(err, 'read');
    // The message can carry vendor text; it travels only inside the JSON
    // envelope, which the wrappers fence. stderr gets the code alone.
    process.stderr.write(`${appError.code}\n`);
    // A mutating failure echoes the ids a reservation can be reconciled by.
    const context = err instanceof MutationErrorException ? err : undefined;
    printJson({
      ok: false,
      operation: name,
      ...(context?.localRequestId !== undefined
        ? { localRequestId: context.localRequestId }
        : {}),
      ...(context?.localId !== undefined ? { localId: context.localId } : {}),
      ...(context?.details !== undefined ? { details: context.details } : {}),
      error: appError,
    });
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `unexpected error: ${redact(err instanceof Error ? err.name : 'unknown')}\n`
  );
  process.exitCode = 1;
});
