/**
 * R38 single-controller authority. A small file OUTSIDE `<dataDir>` records
 * which data directory (by canonical path) and which epoch may write on this
 * host. Every grant carries an `epochRef` to it, and every write re-reads and
 * matches it, so a copied or restored data directory — different path, or an
 * epoch that was since advanced — fails loud instead of writing in parallel.
 *
 * Nothing here reads `process.env`: callers inject the controller directory and
 * id. Errors are never swallowed; a missing, unreadable, corrupt, or unsafe
 * authority file is `JULES_CONTROLLER_MISMATCH` (fail closed).
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { canonicalPath, ensureOwnerOnlyDir } from './config.js';
import { throwAppError } from './errors.js';
import type { ControllerAuthority, EpochRef, GrantsFile } from './types.js';
import { validateControllerId } from './validate.js';

export interface ControllerContext {
  /** Already resolved and created 0700 by `resolveControllerDir`. */
  readonly controllerDir: string;
  /** Validated; defaults to the host name at the call site. */
  readonly controllerId: string;
  readonly now?: () => Date;
}

function nowIso(ctx: ControllerContext): string {
  return (ctx.now ?? (() => new Date()))().toISOString();
}

export function controllerFilePath(
  controllerDir: string,
  controllerId: string
): string {
  validateControllerId(controllerId);
  return path.join(controllerDir, `${controllerId}.json`);
}

function mismatch(message: string): never {
  return throwAppError('JULES_CONTROLLER_MISMATCH', message);
}

function currentUid(): number | undefined {
  return typeof process.getuid === 'function' ? process.getuid() : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The authority file must be a regular, owner-owned file with no group or
 * world bits: it is the copy-detection anchor, so a file anyone else could
 * have written is not trusted.
 */
function assertAuthorityFileSafe(file: string): void {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    mismatch(`${file} is not a regular file`);
  }
  const uid = currentUid();
  if (uid !== undefined && stat.uid !== uid) {
    mismatch(`${file} is not owned by the current user`);
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    mismatch(
      `${file} must be mode 0600 (found ${(stat.mode & 0o777).toString(8)})`
    );
  }
}

function parseAuthority(
  raw: string,
  file: string,
  controllerId: string
): ControllerAuthority {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return mismatch(`${file} does not parse as JSON`);
  }
  if (!isPlainObject(parsed))
    return mismatch(`${file} has an unexpected shape`);
  const { epoch, dataDir, updatedAt } = parsed;
  if (
    parsed['controllerId'] !== controllerId ||
    typeof epoch !== 'number' ||
    !Number.isInteger(epoch) ||
    epoch < 1 ||
    typeof dataDir !== 'string' ||
    !path.isAbsolute(dataDir) ||
    typeof updatedAt !== 'string'
  ) {
    return mismatch(`${file} has an unexpected shape`);
  }
  return { controllerId, epoch, dataDir, updatedAt };
}

/**
 * Reads and shape-validates `<controllerDir>/<controllerId>.json`.
 * `undefined` means the file does not exist; every other problem throws.
 */
export function readControllerAuthority(
  controllerDir: string,
  controllerId: string
): ControllerAuthority | undefined {
  const file = controllerFilePath(controllerDir, controllerId);
  try {
    assertAuthorityFileSafe(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
  return parseAuthority(fs.readFileSync(file, 'utf8'), file, controllerId);
}

function writeAuthority(
  ctx: ControllerContext,
  authority: ControllerAuthority
): void {
  const file = controllerFilePath(ctx.controllerDir, ctx.controllerId);
  ensureOwnerOnlyDir(ctx.controllerDir);
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(authority, null, 2)}\n`, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * First `authorize` on this host: no controller file and no grants exist yet.
 * Writes epoch 1 bound to the canonical data directory. Refuses to overwrite.
 */
export function initControllerAuthority(
  ctx: ControllerContext,
  dataDir: string
): ControllerAuthority {
  if (
    readControllerAuthority(ctx.controllerDir, ctx.controllerId) !== undefined
  ) {
    return mismatch(
      `a controller authority for ${ctx.controllerId} already exists; use authorize --take-over to move it`
    );
  }
  const authority: ControllerAuthority = {
    controllerId: ctx.controllerId,
    epoch: 1,
    dataDir: canonicalPath(dataDir),
    updatedAt: nowIso(ctx),
  };
  writeAuthority(ctx, authority);
  return authority;
}

/**
 * Called on every write path inside the critical section. Fails with
 * `JULES_CONTROLLER_MISMATCH` when the file is missing, the epoch differs from
 * the grant's reference, or the canonical data-directory path differs.
 */
export function assertControllerAuthority(
  controllerDir: string,
  dataDir: string,
  epochRef: EpochRef
): ControllerAuthority {
  const authority = readControllerAuthority(
    controllerDir,
    epochRef.controllerId
  );
  if (authority === undefined) {
    return mismatch(
      `no controller authority for ${epochRef.controllerId} on this host`
    );
  }
  if (authority.epoch !== epochRef.epoch) {
    return mismatch(
      `controller epoch ${authority.epoch} does not match the grant's epoch ${epochRef.epoch}`
    );
  }
  if (authority.dataDir !== canonicalPath(dataDir)) {
    return mismatch(
      'this data directory is not the one the controller authority authorizes'
    );
  }
  return authority;
}

export interface TakeOverResult {
  readonly authority: ControllerAuthority;
  readonly grants: GrantsFile;
}

/**
 * Handoff (R38): writes epoch+1 for this host and data-directory path, then
 * rewrites every grant's `controllerId` and `epochRef` to it. The new epoch is
 * above both any existing authority file and every epoch the copied grants
 * still reference. The controller file is written first: a crash before the
 * grants are rewritten leaves grants pointing at an old epoch, so writes fail
 * closed until `--take-over` is run again. Runs only inside a TTY-confirmed
 * `authorize --take-over`, under the journal lock.
 */
export function takeOverController(
  ctx: ControllerContext,
  dataDir: string,
  grants: GrantsFile
): TakeOverResult {
  const existing = readControllerAuthority(ctx.controllerDir, ctx.controllerId);
  let highest = existing?.epoch ?? 0;
  for (const grant of Object.values(grants.grants)) {
    highest = Math.max(highest, grant.epochRef.epoch);
  }
  const authority: ControllerAuthority = {
    controllerId: ctx.controllerId,
    epoch: highest + 1,
    dataDir: canonicalPath(dataDir),
    updatedAt: nowIso(ctx),
  };
  writeAuthority(ctx, authority);
  const rewritten = Object.create(null) as GrantsFile['grants'];
  for (const [id, grant] of Object.entries(grants.grants)) {
    rewritten[id] = {
      ...grant,
      controllerId: authority.controllerId,
      epochRef: {
        controllerId: authority.controllerId,
        epoch: authority.epoch,
      },
    };
  }
  return { authority, grants: { version: 1, grants: rewritten } };
}
