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
import type { Grant } from './grants';
import { isGrant } from './grants';

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
  /** The grant the task was created under. */
  readonly grantId?: string;
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
  /**
   * Created and revoked only by authorize; reservations charge and refund
   * their counts. See grants.ts.
   */
  readonly grants?: Readonly<Record<string, Grant>>;
}

const EMPTY: Journal = { version: 1, tasks: {}, requests: {}, usage: [] };
const JOURNAL = 'journal.json';
const LOCK = 'journal.lock';
const USAGE_KEEP_MS = 24 * 60 * 60 * 1000;

/** The data dir: YELLOW_AGY_DATA_DIR, or the XDG state dir. */
export function dataDir(
  env: Readonly<Record<string, string | undefined>> = process.env
): string {
  // An empty value counts as unset, as the XDG spec says.
  const set = (name: string): string | undefined => {
    const v = env[name];
    return v === undefined || v === '' ? undefined : v;
  };
  const explicit = set('YELLOW_AGY_DATA_DIR');
  if (explicit !== undefined) return path.resolve(explicit);
  if (process.platform === 'win32') {
    const base =
      set('LOCALAPPDATA') ?? path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'yellow-agy');
  }
  const base =
    set('XDG_STATE_HOME') ?? path.join(os.homedir(), '.local', 'state');
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
  const token = `${process.pid}\n${new Date().toISOString()}\n${Math.random().toString(36).slice(2)}\n`;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx', 0o600);
      fs.writeSync(fd, token);
      fs.closeSync(fd);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      if (removeStaleLock(lockPath, staleMs)) continue;
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
    // Remove only our own lock: a peer may have taken over a lock it judged
    // stale. Best effort, so a failed delete never replaces fn's result or
    // error; a lock left behind names this pid and goes stale once it exits.
    try {
      if (readText(lockPath) === token) fs.rmSync(lockPath, { force: true });
    } catch {
      // ignored, see above
    }
  }
}

function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

const TAKEOVER_STALE_MS = 5_000;

/**
 * Removes the lock at `lockPath` if it is stale, and says whether it did.
 * Removal happens only while holding `<lock>.takeover` (created with `wx`),
 * and only if the lock still holds the exact text judged stale, so two
 * waiters can't both remove it and one of them can't remove a fresh lock a
 * third process just took.
 */
function removeStaleLock(lockPath: string, staleMs: number): boolean {
  const seen = readText(lockPath);
  if (seen === undefined) {
    // Gone: retry the create. Present but unreadable: wait for the timeout.
    try {
      fs.lstatSync(lockPath);
      return false;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return true;
      throw err;
    }
  }
  if (!lockIsStale(lockPath, seen, staleMs)) return false;
  const takeover = `${lockPath}.takeover`;
  let fd: number;
  try {
    fd = fs.openSync(takeover, 'wx', 0o600);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    // The takeover window is a few syscalls; one left by a crash expires.
    try {
      if (Date.now() - fs.statSync(takeover).mtimeMs > TAKEOVER_STALE_MS) {
        fs.rmSync(takeover, { force: true });
      }
    } catch {
      // gone already
    }
    return false;
  }
  fs.closeSync(fd);
  try {
    if (readText(lockPath) !== seen) return false;
    fs.rmSync(lockPath, { force: true });
    return true;
  } finally {
    fs.rmSync(takeover, { force: true });
  }
}

function lockIsStale(lockPath: string, text: string, staleMs: number): boolean {
  let mtime: number;
  try {
    mtime = fs.statSync(lockPath).mtimeMs;
  } catch {
    return false; // vanished between read and stat: just retry
  }
  const pid = Number.parseInt(text.split('\n')[0] ?? '', 10);
  if (Number.isInteger(pid) && pid > 0) return !pidAlive(pid);
  return Date.now() - mtime > staleMs;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function badJournal(part: string): AgyError {
  return new AgyError(
    'AGY_INTERNAL',
    `the journal has an unknown format (${part})`,
    'Move the damaged journal aside; yellow-agy starts a new one.'
  );
}

export function readJournal(dir: string): Journal {
  // The same owner-only check as the locked paths, so status and collect
  // never read a directory another user can write.
  ensureDataDir(dir);
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
  if (!isRecord(value)) throw badJournal('not an object');
  const j = value as Partial<Journal> & Record<string, unknown>;
  if (j.version !== 1) throw badJournal('unknown version');
  if (!isRecord(j.tasks) || !Object.values(j.tasks).every(isRecord)) {
    throw badJournal('tasks');
  }
  if (!isRecord(j.requests) || !Object.values(j.requests).every(isRecord)) {
    throw badJournal('requests');
  }
  if (j.usage !== undefined && !Array.isArray(j.usage)) {
    throw badJournal('usage');
  }
  if (
    j.grants !== undefined &&
    !(
      isRecord(j.grants) &&
      Object.entries(j.grants).every(([k, g]) => isGrant(k, g))
    )
  ) {
    throw badJournal('grants');
  }
  const claim: unknown = j.activeRun;
  if (
    claim !== undefined &&
    !(
      isRecord(claim) &&
      typeof claim['requestId'] === 'string' &&
      typeof claim['localId'] === 'string' &&
      typeof claim['op'] === 'string' &&
      Number.isInteger(claim['ownerPid']) &&
      (claim['childPid'] === undefined || Number.isInteger(claim['childPid']))
    )
  ) {
    throw badJournal('activeRun');
  }
  return {
    version: 1,
    tasks: j.tasks,
    requests: j.requests,
    usage: (j.usage ?? []).filter(isRecord) as unknown as UsageEntry[],
    ...(j.activeRun === undefined ? {} : { activeRun: j.activeRun }),
    ...(j.grants === undefined ? {} : { grants: j.grants }),
  };
}

/** Atomic, durable write: a 0600 temp file fsynced, renamed, dir fsynced. */
export function writeJournal(dir: string, journal: Journal): void {
  const cutoff = Date.now() - USAGE_KEEP_MS;
  const trimmed: Journal = {
    ...journal,
    usage: journal.usage.filter((u) => Date.parse(u.at) >= cutoff),
  };
  const tmp = path.join(dir, `${JOURNAL}.${process.pid}.tmp`);
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify(trimmed, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, path.join(dir, JOURNAL));
  // Make the rename itself durable; Windows can't open a directory.
  if (process.platform !== 'win32') {
    const dfd = fs.openSync(dir, 'r');
    try {
      fs.fsyncSync(dfd);
    } finally {
      fs.closeSync(dfd);
    }
  }
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

/** `rec[key]` only when it is an own property (`toString` is not a task). */
export function own<T>(
  rec: Readonly<Record<string, T>>,
  key: string
): T | undefined {
  return Object.prototype.hasOwnProperty.call(rec, key) ? rec[key] : undefined;
}

/** The journal without request `requestId`. */
export function dropRequest(j: Journal, requestId: string): Journal {
  const { [requestId]: _gone, ...requests } = j.requests;
  void _gone;
  return { ...j, requests };
}

export function getTask(j: Journal, localId: string): Task {
  const task = own(j.tasks, localId);
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
  // A future-dated entry (clock skew) is not recent usage.
  return j.usage.filter((u) => {
    const age = now - Date.parse(u.at);
    return age >= 0 && age <= windowMs;
  });
}
