#!/usr/bin/env node
/**
 * Entry point. Exactly one JSON object on stdout per invocation; all
 * diagnostics go to stderr. Exit codes: 0 on ok:true, 1 on ok:false
 * (engine/business failure), 2 on a consumer CLI usage error.
 *
 * This process never imports yellow-goal TypeScript. It only spawns
 * `goal-gen` (or $GOAL_GEN_BIN) as a child.
 */
import { parseArgs } from 'node:util';

import { GoalEngineError, toGoalError } from './errors.js';
import * as runtime from './runtime.js';
import { createDefaultSpawn } from './spawn.js';

const KNOWN_OPERATIONS = ['setup', 'request'] as const;

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

class UsageError extends Error {}

function requireString(value: string | undefined, flag: string): string {
  if (value === undefined || value.length === 0) {
    throw new UsageError(`missing required flag ${flag}`);
  }
  return value;
}

function buildDeps(): runtime.RuntimeDeps {
  return {
    spawn: createDefaultSpawn(process.env),
    env: process.env,
  };
}

function dispatch(
  operation: string,
  rest: readonly string[],
  deps: runtime.RuntimeDeps
):
  | runtime.SetupResult
  | runtime.RequestCreateResult
  | runtime.RequestValidateResult {
  switch (operation) {
    case 'setup': {
      parseArgs({ args: rest, strict: true, allowPositionals: false });
      return runtime.setup(deps);
    }
    case 'request': {
      const sub = rest[0];
      if (sub === 'create') {
        if (
          rest.some((a) => a === '--executor' || a.startsWith('--executor='))
        ) {
          throw new UsageError(
            'refusing --executor; this plugin is read-only (create/validate only)'
          );
        }
        const { values } = parseArgs({
          args: rest.slice(1),
          options: {
            repo: { type: 'string' },
            goal: { type: 'string' },
            output: { type: 'string' },
          },
          strict: true,
          allowPositionals: false,
        });
        return runtime.requestCreate(deps, {
          repo: requireString(values.repo, '--repo'),
          goal: requireString(values.goal, '--goal'),
          output: requireString(values.output, '--output'),
        });
      }
      if (sub === 'validate') {
        const { positionals } = parseArgs({
          args: rest.slice(1),
          strict: true,
          allowPositionals: true,
        });
        const request = positionals[0];
        if (typeof request !== 'string' || request.length === 0) {
          throw new UsageError('missing request file argument');
        }
        return runtime.requestValidate(deps, { request });
      }
      throw new UsageError(
        `unknown request subcommand "${sub ?? ''}"; expected create or validate`
      );
    }
    default:
      throw new UsageError(
        `unknown subcommand "${operation}"; expected one of: ${KNOWN_OPERATIONS.join(', ')}`
      );
  }
}

function main(): void {
  const [operation, ...rest] = process.argv.slice(2);
  const resolvedOperation = operation ?? 'unknown';

  if (operation === undefined) {
    process.stderr.write(
      `no subcommand given; expected one of: ${KNOWN_OPERATIONS.join(', ')}\n`
    );
    printJson({
      ok: false,
      operation: 'unknown',
      error: new GoalEngineError(
        'GOAL_INVALID_INPUT',
        `no subcommand given; expected one of: ${KNOWN_OPERATIONS.join(', ')}`
      ).toJson(),
    });
    process.exit(2);
  }

  try {
    const result = dispatch(operation, rest, buildDeps());
    printJson({ ok: true, operation: resolvedOperation, ...result });
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`${err.message}\n`);
      printJson({
        ok: false,
        operation: resolvedOperation,
        error: new GoalEngineError('GOAL_INVALID_INPUT', err.message).toJson(),
      });
      process.exit(2);
    }
    const appError = toGoalError(err);
    process.stderr.write(`${appError.code}: ${appError.message}\n`);
    printJson({
      ok: false,
      operation: resolvedOperation,
      error: appError,
    });
    process.exit(1);
  }
}

main();
