/**
 * Local agent index at <dataDir>/state/agents.json. Atomic same-dir
 * tmp+rename writes, 0600/0700 modes, symlink rejection, and corrupt-file
 * quarantine so a damaged local cache degrades to "reconcile from remote"
 * instead of crashing or silently overwriting something hostile.
 *
 * Keyed by idempotencyKey, not agentId: a delegate reservation is written
 * BEFORE Agent.create() resolves, i.e. before an agentId exists at all.
 * agentId is filled in once the create+send round-trip completes.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { throwAppError } from './errors.js';
import { assertNoSecretShapedValues } from './redact.js';

export interface AgentRecord {
  readonly agentId?: string;
  readonly runId?: string;
  readonly requestId?: string;
  readonly repository: string;
  readonly startingRef?: string;
  readonly targetBranch?: string;
  readonly prUrl?: string;
  readonly model?: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly idempotencyKey: string;
  readonly callingHost?: string;
  readonly linearIssue?: string;
  readonly usage?: unknown;
  /** sha256 of the prompt text — never the prompt itself. Absent on records backfilled purely from remote reconciliation. */
  readonly promptDigest?: string;
}

/** Keyed by idempotencyKey. */
export type AgentIndex = Record<string, AgentRecord>;

export interface ReadIndexResult {
  readonly index: AgentIndex;
  readonly quarantined: boolean;
  readonly quarantinePath?: string;
}

export function digestPrompt(prompt: string): string {
  return crypto.createHash('sha256').update(prompt, 'utf8').digest('hex');
}

async function assertNotSymlink(target: string): Promise<void> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.lstat(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`refusing to follow symlink at ${target}`);
  }
}

async function ensureStateDir(stateDir: string): Promise<void> {
  await assertNotSymlink(stateDir);
  await fs.promises.mkdir(stateDir, { recursive: true, mode: 0o700 });
  await assertNotSymlink(stateDir);
  await fs.promises.chmod(stateDir, 0o700);
}

async function quarantine(filePath: string): Promise<string> {
  const quarantinePath = `${filePath}.corrupt-${Date.now()}`;
  await fs.promises.rename(filePath, quarantinePath);
  return quarantinePath;
}

function isValidIndexShape(value: unknown): value is AgentIndex {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  for (const [key, record] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (record === null || typeof record !== 'object') return false;
    const r = record as Record<string, unknown>;
    if (r['agentId'] !== undefined && typeof r['agentId'] !== 'string')
      return false;
    if (typeof r['repository'] !== 'string') return false;
    if (typeof r['status'] !== 'string') return false;
    if (typeof r['createdAt'] !== 'string') return false;
    if (typeof r['updatedAt'] !== 'string') return false;
    if (typeof r['idempotencyKey'] !== 'string' || r['idempotencyKey'] !== key)
      return false;
  }
  return true;
}

export async function readIndex(
  stateFilePath: string
): Promise<ReadIndexResult> {
  const stateDir = path.dirname(stateFilePath);
  await ensureStateDir(stateDir);
  await assertNotSymlink(stateFilePath);

  let raw: string;
  try {
    raw = await fs.promises.readFile(stateFilePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { index: {}, quarantined: false };
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const quarantinePath = await quarantine(stateFilePath);
    return { index: {}, quarantined: true, quarantinePath };
  }

  if (!isValidIndexShape(parsed)) {
    const quarantinePath = await quarantine(stateFilePath);
    return { index: {}, quarantined: true, quarantinePath };
  }

  return { index: parsed, quarantined: false };
}

export function throwIfQuarantined(result: ReadIndexResult): void {
  if (!result.quarantined) return;
  const detail =
    result.quarantinePath !== undefined
      ? `local state was quarantined to ${result.quarantinePath}`
      : 'local state was quarantined';
  throwAppError('CURSOR_STATE_CORRUPT', detail);
}

export async function writeIndex(
  stateFilePath: string,
  index: AgentIndex
): Promise<void> {
  assertNoSecretShapedValues(index);
  const stateDir = path.dirname(stateFilePath);
  await ensureStateDir(stateDir);
  await assertNotSymlink(stateFilePath);

  const tmpPath = path.join(
    stateDir,
    `.agents.json.tmp-${process.pid}-${crypto.randomUUID()}`
  );
  const data = JSON.stringify(index, null, 2);
  await fs.promises.writeFile(tmpPath, data, { mode: 0o600 });
  await fs.promises.chmod(tmpPath, 0o600);
  await fs.promises.rename(tmpPath, stateFilePath);
  await fs.promises.chmod(stateFilePath, 0o600);
}

function lockFilePath(stateDir: string): string {
  return path.join(stateDir, '.agents.json.lock');
}

export interface LockConfig {
  /** How long an unrefreshed lock is considered abandoned and eligible for takeover. */
  readonly staleMs: number;
  /** Total time to keep retrying acquisition before giving up. */
  readonly timeoutMs: number;
  /** Delay between acquisition attempts while the lock is held (and not yet stale). */
  readonly pollMs: number;
}

const DEFAULT_LOCK_CONFIG: LockConfig = {
  staleMs: 10_000,
  timeoutMs: 15_000,
  pollMs: 50,
};

/**
 * `wx` (O_CREAT|O_EXCL) atomically fails if anything — including a symlink —
 * already occupies the path, so this is safe against symlink races without a
 * separate lstat check. The lock file's content is a random owner token so
 * release() only ever deletes a lock it still owns, never one a stale-lock
 * takeover has since replaced.
 */
async function acquireLock(
  stateDir: string,
  config: LockConfig
): Promise<string> {
  const lockPath = lockFilePath(stateDir);
  const owner = crypto.randomUUID();
  const deadline = Date.now() + config.timeoutMs;

  for (;;) {
    try {
      const handle = await fs.promises.open(lockPath, 'wx');
      try {
        await handle.writeFile(owner);
      } finally {
        await handle.close();
      }
      return owner;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }

    try {
      const stat = await fs.promises.stat(lockPath);
      if (Date.now() - stat.mtimeMs > config.staleMs) {
        await fs.promises.unlink(lockPath).catch((unlinkErr: unknown) => {
          if ((unlinkErr as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw unlinkErr;
          }
        });
        continue; // retry acquisition immediately after a stale-lock takeover
      }
    } catch (statErr) {
      if ((statErr as NodeJS.ErrnoException).code !== 'ENOENT') throw statErr;
      continue; // lock disappeared between our EEXIST and this stat — retry immediately
    }

    if (Date.now() > deadline) {
      throw new Error(`timed out acquiring state lock at ${lockPath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, config.pollMs));
  }
}

async function releaseLock(stateDir: string, owner: string): Promise<void> {
  const lockPath = lockFilePath(stateDir);
  try {
    const content = await fs.promises.readFile(lockPath, 'utf8');
    if (content === owner) {
      await fs.promises.unlink(lockPath);
    }
    // A different owner means a stale-lock takeover already replaced ours —
    // nothing to release, and deleting it would clobber the new owner.
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

/**
 * Serializes a read-modify-write cycle against the state file across
 * processes on the same machine/dataDir. tmp+rename alone only makes a
 * single write atomic — without this, two concurrent read-modify-write
 * cycles can both read the same starting index and the second write
 * silently drops the first writer's update (lost-update race).
 */
export async function withStateLock<T>(
  stateFilePath: string,
  fn: () => Promise<T>,
  config: LockConfig = DEFAULT_LOCK_CONFIG
): Promise<T> {
  const stateDir = path.dirname(stateFilePath);
  await ensureStateDir(stateDir);
  const owner = await acquireLock(stateDir, config);
  try {
    return await fn();
  } finally {
    await releaseLock(stateDir, owner);
  }
}

/**
 * Read-modify-write without acquiring the lock — caller must already hold it
 * via `withStateLock`.
 */
export async function upsertRecordUnderLock(
  stateFilePath: string,
  record: AgentRecord
): Promise<AgentIndex> {
  const readResult = await readIndex(stateFilePath);
  throwIfQuarantined(readResult);
  const next: AgentIndex = {
    ...readResult.index,
    [record.idempotencyKey]: record,
  };
  await writeIndex(stateFilePath, next);
  return next;
}

export async function upsertRecord(
  stateFilePath: string,
  record: AgentRecord
): Promise<AgentIndex> {
  return withStateLock(stateFilePath, async () =>
    upsertRecordUnderLock(stateFilePath, record)
  );
}

export function findByIdempotencyKey(
  index: AgentIndex,
  idempotencyKey: string
): AgentRecord | undefined {
  return index[idempotencyKey];
}

export function findByAgentId(
  index: AgentIndex,
  agentId: string
): AgentRecord | undefined {
  return Object.values(index).find((record) => record.agentId === agentId);
}

export const TERMINAL_RUN_STATUSES = new Set([
  'finished',
  'error',
  'cancelled',
]);
export const TERMINAL_AGENT_STATUSES = new Set([
  'finished',
  'error',
  'cancelled',
  'archived',
]);
/** Local-only bookkeeping statuses that are neither a live SDK status nor terminal. */
export const LOCAL_ONLY_STATUSES = new Set(['pending-launch', 'unknown']);

export function isTerminalStatus(status: string): boolean {
  return TERMINAL_AGENT_STATUSES.has(status);
}

/** Local pending-launch reservations not yet visible in remote agent listings. */
export function countLocalPendingReservationsForRepo(
  index: AgentIndex,
  repoUrl: string
): number {
  return Object.values(index).filter(
    (record) =>
      record.repository === repoUrl && record.status === 'pending-launch'
  ).length;
}
