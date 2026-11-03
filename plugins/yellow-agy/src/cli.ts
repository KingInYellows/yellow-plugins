/**
 * The yellow-agy CLI (contract-v0 "Output envelope, exit codes"): one JSON
 * object on stdout, exit 0/1/2. Commands under commands/agy/ call it with
 * `node dist/cli.js <operation> …`.
 */

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseArgs } from 'node:util';

import { AgyError } from './errors';
import type { Grant } from './grants';
import {
  branchMatches,
  buildGrant,
  grantExpired,
  grantSummary,
  grants,
  listGrants,
  putGrant,
  revokeGrant,
} from './grants';
import type { HostConfig, WslRun } from './host-config';
import { detectHost, readHostConfig, writeHostConfig } from './host-config';
import { createHostExec } from './host-exec';
import { assertWslPath } from './invocation';
import { Lifecycle } from './lifecycle';
import { runTurn } from './process';
import { quotaGate } from './quota';
import { redact } from './redact';
import type { Journal } from './state';
import {
  dataDir,
  ensureDataDir,
  getTask,
  readJournal,
  updateJournal,
} from './state';
import type { OpenTty } from './tty';
import { confirmOnTty } from './tty';
import { validateBranchName } from './worktree';

const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,200}$/;
const REMOTE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_TEXT_BYTES = 100_000;
/** The command wrappers' Bash timeout is 600 s; a turn must end well inside it. */
const DEFAULT_PRINT_TIMEOUT_S = 480;
const MAX_PRINT_TIMEOUT_S = 480;
const DEADLINE_SLACK_MS = 30_000;

export interface CliDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdout: (text: string) => void;
  readonly openTty?: OpenTty;
  readonly wslRun?: WslRun;
  readonly now?: () => Date;
  /** Tests replace the Lifecycle's side effects. */
  readonly lifecycle?: (
    deps: ConstructorParameters<typeof Lifecycle>[0]
  ) => Lifecycle;
}

function usage(message: string): AgyError {
  return new AgyError('AGY_INVALID_INPUT', message);
}

function str(v: unknown, flag: string): string {
  if (typeof v !== 'string' || v === '') throw usage(`missing ${flag}`);
  return v;
}

function int(v: unknown, flag: string): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !/^\d{1,6}$/.test(v)) {
    throw usage(`${flag} must be a whole number`);
  }
  return Number(v);
}

function requestId(v: unknown): string {
  if (v === undefined) return `req-${randomBytes(8).toString('hex')}`;
  if (typeof v !== 'string' || !REQUEST_ID_RE.test(v)) {
    throw usage('--request-id must match [A-Za-z0-9._:-]{1,200}');
  }
  return v;
}

/** Free text from a file the wrapper wrote; never from argv. */
function readText(file: unknown, flag: string): string {
  const p = str(file, flag);
  let st: fs.Stats;
  try {
    st = fs.lstatSync(p);
  } catch {
    throw usage(`${flag} ${p} does not exist`);
  }
  if (!st.isFile() || st.size === 0 || st.size > MAX_TEXT_BYTES) {
    throw usage(`${flag} must be a regular file of 1-${MAX_TEXT_BYTES} bytes`);
  }
  return fs.readFileSync(p, 'utf8');
}

function printTimeoutSeconds(
  env: Readonly<Record<string, string | undefined>>
): number {
  const raw = env['YELLOW_AGY_PRINT_TIMEOUT_SECONDS'];
  if (raw === undefined || raw === '') return DEFAULT_PRINT_TIMEOUT_S;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 60 || n > MAX_PRINT_TIMEOUT_S) {
    throw usage(
      `YELLOW_AGY_PRINT_TIMEOUT_SECONDS must be 60-${MAX_PRINT_TIMEOUT_S}`
    );
  }
  return n;
}

/** The repo path as agy's filesystem sees it, symlinks resolved. */
function canonicalRepo(
  config: HostConfig,
  repo: string,
  wslRun: WslRun | undefined
): string {
  if (config.host.kind !== 'wsl-bridge') {
    try {
      return fs.realpathSync(path.resolve(repo));
    } catch {
      throw usage(`--repo ${repo} does not exist`);
    }
  }
  assertWslPath(repo, '--repo');
  const run =
    wslRun ??
    ((distro: string | undefined, args: string[]): string => {
      const argv =
        distro === undefined ? ['-e', ...args] : ['-d', distro, '-e', ...args];
      return execFileSync('wsl.exe', argv, {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 60_000,
      })
        .replace(/\r/g, '')
        .trim();
    });
  let real: string;
  try {
    real = run(config.host.distro, ['realpath', '-e', '--', repo]);
  } catch {
    throw usage(`--repo ${repo} does not exist in WSL`);
  }
  assertWslPath(real, '--repo');
  return real;
}

/** The latest-expiring live grant that covers a new task. */
function coveringGrant(
  j: Journal,
  repo: string,
  branch: string,
  now: Date
): Grant | undefined {
  return Object.values(grants(j))
    .filter(
      (g) =>
        g.revokedAt === undefined &&
        !grantExpired(g, now) &&
        g.repo === repo &&
        g.operations.includes('create') &&
        g.totalTasks < g.maxTotalTasks &&
        branchMatches(g.branchPattern, branch)
    )
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
    .pop();
}

function noGrant(repo: string, branch: string): AgyError {
  return new AgyError(
    'AGY_AUTHORITY_DENIED',
    `no live grant covers ${repo} on branch ${branch}`,
    `Run /agy:authorize --repo ${JSON.stringify(repo)} --branch ${JSON.stringify(branch)} for the command the owner runs in a terminal, then retry.`
  );
}

interface Ctx {
  readonly deps: CliDeps;
  readonly dir: string;
  readonly now: () => Date;
}

function lifecycleFor(
  ctx: Ctx,
  config: HostConfig,
  grant: Grant,
  probeCwd: string
): Lifecycle {
  const exec = createHostExec(config.host, ctx.deps.env);
  const printTimeout = printTimeoutSeconds(ctx.deps.env);
  const deps = {
    host: config.host,
    exec,
    dataDir: ctx.dir,
    worktreeRoot: config.worktreeRoot,
    schemaPath: config.schemaPath,
    baseEnv: ctx.deps.env,
    runTurn,
    quotaGate: quotaGate({
      host: config.host,
      cwd: probeCwd,
      baseEnv: ctx.deps.env,
      filterDrivers: () => exec.filterDrivers(probeCwd),
      minQuotaPercent: grant.minQuotaPercent,
      runTurn,
    }),
    allowCommands: grant.allowCommands,
    sandboxVerified: config.sandboxVerified,
    printTimeoutSeconds: printTimeout,
    deadlineMs: printTimeout * 1000 + DEADLINE_SLACK_MS,
    grantId: grant.grantId,
    now: ctx.now,
  };
  return (ctx.deps.lifecycle ?? ((d) => new Lifecycle(d)))(deps);
}

/** The grant a task was created under; it governs every later call. */
function taskGrant(j: Journal, localId: string): Grant {
  const task = getTask(j, localId);
  const grant =
    task.grantId === undefined ? undefined : grants(j)[task.grantId];
  if (grant === undefined) {
    throw new AgyError(
      'AGY_AUTHORITY_DENIED',
      `task ${localId} has no grant on this host`
    );
  }
  return grant;
}

type Flags = Record<string, string | boolean | string[] | undefined>;

async function authorize(ctx: Ctx, flags: Flags): Promise<unknown> {
  const now = ctx.now();
  if (flags['list'] === true) {
    return { grants: listGrants(readJournal(ctx.dir), now) };
  }
  if (flags['revoke'] !== undefined) {
    const id = str(flags['revoke'], '--revoke');
    return updateJournal(ctx.dir, (j) => {
      const next = revokeGrant(j, id, now);
      return {
        journal: next,
        result: { grantId: id, revokedAt: grants(next)[id]?.revokedAt },
      };
    });
  }
  const config = readHostConfig(ctx.dir);
  const commands = flags['allow-command'];
  const minQuota = int(flags['min-quota-percent'], '--min-quota-percent');
  const maxTasks = int(flags['max-tasks'], '--max-tasks');
  const rounds = int(flags['max-corrective-rounds'], '--max-corrective-rounds');
  const ttl = int(flags['ttl-minutes'], '--ttl-minutes');
  const grant = buildGrant(
    {
      repo: canonicalRepo(
        config,
        str(flags['repo'], '--repo'),
        ctx.deps.wslRun
      ),
      branchPattern: str(flags['branch'], '--branch'),
      operations: str(flags['operations'], '--operations'),
      ...(Array.isArray(commands) ? { allowCommands: commands } : {}),
      ...(minQuota === undefined ? {} : { minQuotaPercent: minQuota }),
      ...(maxTasks === undefined ? {} : { maxTotalTasks: maxTasks }),
      ...(rounds === undefined ? {} : { maxCorrectiveRounds: rounds }),
      ...(ttl === undefined ? {} : { ttlMinutes: ttl }),
    },
    now
  );
  // Confirm before taking the lock, so a waiting owner never holds it.
  await confirmOnTty({
    summary: grantSummary(grant),
    ...(ctx.deps.openTty === undefined ? {} : { openTty: ctx.deps.openTty }),
  });
  await updateJournal(ctx.dir, (j) => ({
    journal: putGrant(j, grant),
    result: undefined,
  }));
  return { grant };
}

async function run(ctx: Ctx, op: string, flags: Flags): Promise<unknown> {
  switch (op) {
    case 'setup': {
      const config = detectHost({
        env: ctx.deps.env,
        ...(ctx.deps.wslRun === undefined ? {} : { wslRun: ctx.deps.wslRun }),
      });
      writeHostConfig(ctx.dir, config);
      return { host: config.host, worktreeRoot: config.worktreeRoot };
    }
    case 'authorize':
      return authorize(ctx, flags);
    case 'status':
    case 'list': {
      const j = readJournal(ctx.dir);
      const id = flags['task'];
      const tasks =
        typeof id === 'string'
          ? [getTask(j, id)]
          : Object.values(j.tasks).sort((a, b) =>
              a.createdAt.localeCompare(b.createdAt)
            );
      return {
        tasks: tasks.map(({ plan, ...t }) => ({
          ...t,
          ...(plan === undefined ? {} : { plan }),
        })),
        ...(j.activeRun === undefined ? {} : { activeRun: j.activeRun }),
      };
    }
    case 'delegate': {
      const config = readHostConfig(ctx.dir);
      const repo = canonicalRepo(
        config,
        str(flags['repo'], '--repo'),
        ctx.deps.wslRun
      );
      const branch = validateBranchName(str(flags['branch'], '--branch'));
      const base = validateBranchName(str(flags['base'], '--base'));
      const remote = (flags['remote'] as string | undefined) ?? 'origin';
      if (!REMOTE_RE.test(remote)) throw usage('--remote is not a remote name');
      const prompt = readText(flags['prompt-file'], '--prompt-file');
      const grant = coveringGrant(
        readJournal(ctx.dir),
        repo,
        branch,
        ctx.now()
      );
      if (grant === undefined) throw noGrant(repo, branch);
      return lifecycleFor(ctx, config, grant, repo).delegate({
        requestId: requestId(flags['request-id']),
        branch,
        prompt,
        repo,
        remote,
        baseBranch: base,
      });
    }
    case 'approve':
    case 'reply':
    case 'collect':
    case 'abandon': {
      const config = readHostConfig(ctx.dir);
      const localId = str(flags['task'], '--task');
      const j = readJournal(ctx.dir);
      const task = getTask(j, localId);
      const grant = taskGrant(j, localId);
      const life = lifecycleFor(ctx, config, grant, task.worktree);
      const partial = {
        keepPartial: flags['keep-partial'] === true,
        resetPartial: flags['reset-partial'] === true,
      };
      if (op === 'approve') {
        return life.approve({
          requestId: requestId(flags['request-id']),
          localId,
          ...partial,
        });
      }
      if (op === 'reply') {
        return life.reply({
          requestId: requestId(flags['request-id']),
          localId,
          message: readText(flags['message-file'], '--message-file'),
          correction: flags['correction'] === true,
          ...partial,
        });
      }
      if (op === 'collect') return life.collect(localId);
      await confirmOnTty({
        summary: [
          'yellow-agy: abandon a task',
          `  task:      ${localId}`,
          `  branch:    ${task.branch} (kept)`,
          `  worktree:  ${task.worktree} (collected, then removed)`,
        ].join('\n'),
        ...(ctx.deps.openTty === undefined
          ? {}
          : { openTty: ctx.deps.openTty }),
      });
      return life.abandon({
        requestId: requestId(flags['request-id']),
        localId,
      });
    }
    default:
      throw usage(`unknown operation ${JSON.stringify(op)}`);
  }
}

/** Every string in the envelope redacted, shape kept. */
function redactDeep(value: unknown): unknown {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redactDeep(v)])
    );
  }
  return value;
}

const OPTIONS = {
  repo: { type: 'string' },
  branch: { type: 'string' },
  base: { type: 'string' },
  remote: { type: 'string' },
  task: { type: 'string' },
  'prompt-file': { type: 'string' },
  'message-file': { type: 'string' },
  'request-id': { type: 'string' },
  correction: { type: 'boolean' },
  'keep-partial': { type: 'boolean' },
  'reset-partial': { type: 'boolean' },
  operations: { type: 'string' },
  'allow-command': { type: 'string', multiple: true },
  'min-quota-percent': { type: 'string' },
  'max-tasks': { type: 'string' },
  'max-corrective-rounds': { type: 'string' },
  'ttl-minutes': { type: 'string' },
  list: { type: 'boolean' },
  revoke: { type: 'string' },
} as const;

/** Runs one operation and returns the exit code. */
export async function main(
  argv: readonly string[],
  deps: CliDeps
): Promise<number> {
  const op = argv[0] ?? '';
  const now = deps.now ?? (() => new Date());
  try {
    const { values } = parseArgs({
      args: argv.slice(1),
      options: OPTIONS,
      strict: true,
      allowPositionals: false,
    });
    const dir = dataDir(deps.env);
    ensureDataDir(dir);
    const result = (await run({ deps, dir, now }, op, values)) as Record<
      string,
      unknown
    >;
    const code = result['code'];
    const failed = typeof code === 'string';
    const exit = failed ? new AgyError(code as never, '').exit : 0;
    deps.stdout(
      `${JSON.stringify(redactDeep({ ok: !failed, operation: op, ...result }))}\n`
    );
    return exit;
  } catch (err) {
    const e =
      err instanceof AgyError
        ? err
        : (err as { code?: unknown }).code
              ?.toString()
              .startsWith('ERR_PARSE_ARGS')
          ? usage(String((err as Error).message))
          : new AgyError('AGY_INTERNAL', String(err));
    deps.stdout(
      `${JSON.stringify(
        redactDeep({
          ok: false,
          operation: op,
          error: {
            code: e.code,
            message: e.message,
            recoveryAction: e.recoveryAction,
          },
        })
      )}\n`
    );
    return e.exit;
  }
}

if (require.main === module) {
  void main(process.argv.slice(2), {
    env: process.env,
    stdout: (t) => process.stdout.write(t),
  }).then((code) => {
    process.exitCode = code;
  });
}
