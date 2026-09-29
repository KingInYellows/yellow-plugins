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

import { resolveDataDir } from './config.js';
import {
  DEFAULT_COLLECT_DEADLINE_MS,
  DEFAULT_READ_DEADLINE_MS,
} from './deadline.js';
import { throwAppError, toAppError } from './errors.js';
import {
  installFetchGuard,
  READ_TIMEOUT_MS,
  VENDOR_ORIGIN,
} from './fetch-guard.js';
import { redact, redactDeep } from './redact.js';
import * as runtime from './runtime.js';
import type { RuntimeDeps } from './runtime.js';
import { JulesSdkAdapter, type SdkModule } from './sdk-adapter.js';
import { resolveSdk } from './sdk-resolver.js';
import { getTestTransport } from './test-seam.js';
import { validatePositiveInt } from './validate.js';

const KNOWN_OPERATIONS = ['setup', 'list', 'status', 'collect'] as const;
const UNSUPPORTED_OPERATIONS = ['cancel', 'pause', 'resume', 'cost'] as const;
const LATER_OPERATIONS = [
  'delegate',
  'reply',
  'approve',
  'authorize',
  'supervise',
  'integrate',
] as const;
// Deadline plus one in-flight read (up to the 60 s client timeout) must fit
// inside the wrappers' 300 s Bash timeout, or the run is killed mid-write.
const MAX_DEADLINE_MS = 240_000;

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
      installFetchGuard({
        allowedOrigins: transport?.allowedOrigins ?? [VENDOR_ORIGIN],
        readTimeoutMs: READ_TIMEOUT_MS,
      });
      return JulesSdkAdapter.connect({
        sdk: resolved.module as SdkModule,
        dataDir,
        apiKey,
        ...(transport !== undefined ? { baseUrl: transport.baseUrl } : {}),
      });
    },
  };
}

type OperationResult =
  | runtime.SetupResult
  | runtime.ListResult
  | runtime.StatusResult
  | runtime.CollectResult;

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
    printJson({ ok: false, operation: name, error: appError });
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `unexpected error: ${redact(err instanceof Error ? err.name : 'unknown')}\n`
  );
  process.exitCode = 1;
});
