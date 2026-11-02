/**
 * The local journal (contract-v0 "Reservations, retries and recovery"): one
 * JSON file in an owner-only data dir, changed only under an exclusive lock
 * file and written atomically. It holds the tasks, every request id's
 * outcome, the single active-run claim and the usage log the quota gate reads.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { AgyError } from './errors';

export type TaskState =
  | 'PLAN_PENDING'
  | 'IMPLEMENTED'
  | 'DENIED'
  | 'TIMED_OUT'
  | 'INTERRUPTED'
  | 'FAILED'
  | 'ABANDONED';

export interface PartialSnapshot {
  readonly head: string;
  readonly commit: string;
  readonly indexTree: string;
}

export interface Task {
  readonly localId: string;
  readonly branch: string;
  readonly repo: string;
  readonly worktree: string;
  readonly base: string;
  readonly state: TaskState;
  readonly approved: boolean;
  readonly conversationId?: string;
  readonly plan?: unknown;
  /** Set after TIMED_OUT / INTERRUPTED / a failed implement turn. */
  readonly partial?: PartialSnapshot;
  readonly correctiveRounds: number;
  readonly requiresAttention: boolean;
  readonly lastFinishedReason?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type Operation =
  | 'delegate'
  | 'approve'
  | 'reply'
  | 'collect'
  | 'abandon';

export interface RequestRecord {
  readonly requestId: string;
  readonly op: Operation;
  readonly localId?: string;
  readonly status: 'pending' | 'done';
  readonly outcome?: unknown;
  readonly at: string;
}

export interface Claim {
  readonly requestId: string;
  readonly op: Operation;
  readonly localId: string;
  /** Pid of the CLI process that owns the claim. */
  readonly ownerPid: number;
  /** Pid of the agy child, once spawned. */
  readonly childPid?: number;
  readonly snapshot?: PartialSnapshot;
  readonly startedAt: string;
}

export interface UsageEntry {
  readonly at: string;
  readonly localId: string;
  readonly requestId: string;
  /** Percentage points of quota the turn used, when known. */
  readonly cost?: number;
}

export interface Journal {
  readonly version: 1;
  readonly tasks: Readonly<Record<string, Task>>;
  readonly requests: Readonly<Record<string, RequestRecord>>;
  readonly activeRun?: Claim;
  readonly usage: readonly UsageEntry[];
}

const EMPTY: Journal = { version: 1, tasks: {}, requests: {}, usage: [] };
const JOURNAL = 'journal.json';
const LOCK = 'journal.lock';
const USAGE_KEEP_MS = 24 * 60 * 60 * 1000;

/** The data dir: YELLOW_AGY_DATA_DIR, or the XDG state dir. */
export function dataDir(
  env: Readonly<Record<string, string | undefined>> = process.env
): string {
  const explicit = env['YELLOW_AGY_DATA_DIR'];
  if (explicit !== undefined && explicit !== '') return path.resolve(explicit);
  if (process.platform === 'win32') {
    const base =
      env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'yellow-agy');
  }
  const base =
    env['XDG_STATE_HOME'] ?? path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'yellow-agy');
}

/** Creates `dir` 0700 and refuses one another user owns or can write. */
export function ensureDataDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') return;
  const st = fs.lstatSync(dir);
  const uid = process.getuid?.();
  if (!st.isDirectory() || (uid !== undefined && st.uid !== uid)) {
    throw new AgyError(
      'AGY_INTERNAL',
      `${dir} is not a directory owned by this user`,
      'Point YELLOW_AGY_DATA_DIR at a directory you own.'
    );
  }
  if ((st.mode & 0o077) !== 0) fs.chmodSync(dir, 0o700);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function isPidAlive(pid: number | undefined): boolean {
  return pid !== undefined && Number.isInteger(pid) && pid > 0 && pidAlive(pid);
}

export interface LockOptions {
  readonly timeoutMs?: number;
  /** A lock older than this whose pid can't be read is stale. */
  readonly staleMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Runs `fn` while holding the journal lock. */
export async function withLock<T>(
  dir: string,
  fn: () => Promise<T> | T,
  options: LockOptions = {}
): Promise<T> {
  ensureDataDir(dir);
  const lockPath = path.join(dir, LOCK);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const staleMs = options.staleMs ?? 60_000;
  const started = Date.now();
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx', 0o600);
      fs.writeSync(fd, `${process.pid}\n${new Date().toISOString()}\n`);
      fs.closeSync(fd);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      if (lockIsStale(lockPath, staleMs)) {
        fs.rmSync(lockPath, { force: true });
        continue;
      }
      if (Date.now() - started > timeoutMs) {
        throw new AgyError(
          'AGY_BUSY',
          'another yellow-agy command holds the journal lock'
        );
      }
      await sleep(50);
    }
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(lockPath, { force: true });
  }
}

function lockIsStale(lockPath: string, staleMs: number): boolean {
  let text: string;
  let mtime: number;
  try {
    text = fs.readFileSync(lockPath, 'utf8');
    mtime = fs.statSync(lockPath).mtimeMs;
  } catch {
    return false; // vanished between open and read: just retry
  }
  const pid = Number.parseInt(text.split('\n')[0] ?? '', 10);
  if (Number.isInteger(pid) && pid > 0) return !pidAlive(pid);
  return Date.now() - mtime > staleMs;
}

export function readJournal(dir: string): Journal {
  let text: string;
  try {
    text = fs.readFileSync(path.join(dir, JOURNAL), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY;
    throw err;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new AgyError(
      'AGY_INTERNAL',
      `${path.join(dir, JOURNAL)} is not valid JSON`,
      'Move the damaged journal aside; yellow-agy starts a new one.'
    );
  }
  const j = value as Partial<Journal>;
  if (
    j.version !== 1 ||
    typeof j.tasks !== 'object' ||
    typeof j.requests !== 'object'
  ) {
    throw new AgyError('AGY_INTERNAL', 'the journal has an unknown format');
  }
  return {
    version: 1,
    tasks: j.tasks ?? {},
    requests: j.requests ?? {},
    usage: Array.isArray(j.usage) ? j.usage : [],
    ...(j.activeRun === undefined ? {} : { activeRun: j.activeRun }),
  };
}

/** Atomic write: a 0600 temp file in the same dir, then rename. */
export function writeJournal(dir: string, journal: Journal): void {
  const cutoff = Date.now() - USAGE_KEEP_MS;
  const trimmed: Journal = {
    ...journal,
    usage: journal.usage.filter((u) => Date.parse(u.at) >= cutoff),
  };
  const tmp = path.join(dir, `${JOURNAL}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(trimmed, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.renameSync(tmp, path.join(dir, JOURNAL));
}

/** Read, change and write the journal under the lock. */
export function updateJournal<T>(
  dir: string,
  fn: (
    j: Journal
  ) =>
    | { journal: Journal; result: T }
    | Promise<{ journal: Journal; result: T }>,
  options?: LockOptions
): Promise<T> {
  return withLock(
    dir,
    async () => {
      const { journal, result } = await fn(readJournal(dir));
      writeJournal(dir, journal);
      return result;
    },
    options
  );
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function putTask(j: Journal, task: Task): Journal {
  return { ...j, tasks: { ...j.tasks, [task.localId]: task } };
}

export function putRequest(j: Journal, rec: RequestRecord): Journal {
  return { ...j, requests: { ...j.requests, [rec.requestId]: rec } };
}

export function withoutClaim(j: Journal): Journal {
  const { activeRun: _drop, ...rest } = j;
  void _drop;
  return rest;
}

export function getTask(j: Journal, localId: string): Task {
  const task = j.tasks[localId];
  if (task === undefined) {
    throw new AgyError(
      'AGY_INVALID_INPUT',
      `no task ${JSON.stringify(localId)}`
    );
  }
  return task;
}

/** Usage entries from the last `windowMs`. */
export function recentUsage(
  j: Journal,
  windowMs: number,
  now: number = Date.now()
): UsageEntry[] {
  return j.usage.filter((u) => now - Date.parse(u.at) <= windowMs);
}
