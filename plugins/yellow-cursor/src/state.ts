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

export async function upsertRecord(
  stateFilePath: string,
  record: AgentRecord
): Promise<AgentIndex> {
  const { index } = await readIndex(stateFilePath);
  const next: AgentIndex = { ...index, [record.idempotencyKey]: record };
  await writeIndex(stateFilePath, next);
  return next;
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
