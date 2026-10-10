/**
 * Credential presence and host-neutral data-dir resolution, plus the
 * owner-only checks every state-reading or SDK-resolving invocation runs.
 * Never reads auth from argv, and never returns or prints the credential
 * value itself — only whether it is present.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { throwAppError } from './errors.js';

export type CredentialSource = 'env' | 'none';

export function hasEnvApiKey(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env['JULES_API_KEY'];
  return typeof value === 'string' && value.length > 0;
}

export interface DataDirEnv {
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly homedir: () => string;
}

const DEFAULT_DATA_DIR_ENV: DataDirEnv = {
  env: process.env,
  platform: process.platform,
  homedir: os.homedir,
};

/**
 * `node:path`'s default export is bound to the OS actually running the
 * process, not to a logical `platform` argument — so a win32 stub run on a
 * Linux CI box would silently produce POSIX-separated paths without this.
 * Selecting `path.win32` explicitly makes the platform argument authoritative
 * regardless of the host OS, which is what makes this testable at all.
 */
function pathFor(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix;
}

// replica:resolveDataDir:start
export function resolveDataDir(overrides: Partial<DataDirEnv> = {}): string {
  const { env, platform, homedir } = { ...DEFAULT_DATA_DIR_ENV, ...overrides };
  const p = pathFor(platform);

  const explicit = env['YELLOW_JULES_DATA_DIR'];
  if (explicit && explicit.length > 0) {
    return explicit;
  }

  const xdgDataHome = env['XDG_DATA_HOME'];
  if (xdgDataHome && xdgDataHome.length > 0) {
    return p.join(xdgDataHome, 'yellow-jules');
  }

  if (platform === 'darwin') {
    return p.join(homedir(), 'Library', 'Application Support', 'yellow-jules');
  }

  if (platform === 'win32') {
    const appData = env['APPDATA'];
    if (appData && appData.length > 0) {
      return p.join(appData, 'yellow-jules');
    }
    return p.join(homedir(), 'AppData', 'Roaming', 'yellow-jules');
  }

  return p.join(homedir(), '.local', 'share', 'yellow-jules');
}
// replica:resolveDataDir:end

export function resolveRuntimeDir(dataDir: string): string {
  return path.join(dataDir, 'runtime');
}

export function resolveStateDir(dataDir: string): string {
  return path.join(dataDir, 'state');
}

export function resolveJournalPath(dataDir: string): string {
  return path.join(resolveStateDir(dataDir), 'journal.json');
}

export function resolveLockPath(dataDir: string): string {
  return path.join(resolveStateDir(dataDir), '.lock');
}

/** `state/grants.json`: written only by the TTY-confirmed `authorize` path and the counters it guards. */
export function resolveGrantsPath(dataDir: string): string {
  return path.join(resolveStateDir(dataDir), 'grants.json');
}

export function resolveArtifactsDir(dataDir: string): string {
  return path.join(dataDir, 'artifacts');
}

export function resolveSdkScratchDir(dataDir: string): string {
  return path.join(dataDir, 'sdk-scratch');
}

/** The installed plugin root (`dist/..` at runtime, `src/..` under tests). */
export function resolvePluginRoot(): string {
  return path.resolve(__dirname, '..');
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return (
    rel === '' ||
    (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
  );
}

/** Resolve symlinks on the longest existing prefix so containment checks compare real paths. */
function realpathOfExistingPrefix(target: string): string {
  const absolute = path.resolve(target);
  const pending: string[] = [];
  let current = absolute;
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...pending.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return absolute;
      pending.push(path.basename(current));
      current = parent;
    }
  }
}

/** Nearest ancestor of `start` holding a `.git` entry (a directory, or a worktree's `.git` file). */
export function findGitWorkTree(start: string): string | undefined {
  let current = realpathOfExistingPrefix(start);
  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** Canonical absolute path: symlinks resolved on the longest existing prefix. */
export function canonicalPath(target: string): string {
  return realpathOfExistingPrefix(target);
}

export interface DataDirLocationContext {
  readonly pluginRoot: string;
  readonly cwd: string;
}

/**
 * R15/R35: provider state never lives under a source clone or the plugin
 * install cache, including when `YELLOW_JULES_DATA_DIR` points there.
 */
export function assertDataDirLocation(
  dataDir: string,
  context: DataDirLocationContext
): void {
  if (!path.isAbsolute(dataDir)) {
    throwAppError(
      'JULES_DATA_DIR',
      'the data directory must be an absolute path'
    );
  }
  const real = realpathOfExistingPrefix(dataDir);
  if (isInside(realpathOfExistingPrefix(context.pluginRoot), real)) {
    throwAppError(
      'JULES_DATA_DIR',
      'the data directory must not be inside the plugin install directory'
    );
  }
  const workTree = findGitWorkTree(context.cwd);
  if (workTree !== undefined && isInside(workTree, real)) {
    throwAppError(
      'JULES_DATA_DIR',
      'the data directory must not be inside the git work tree containing the current directory'
    );
  }
  // The data dir's own ancestry: a different checkout than cwd's, or cwd
  // outside any checkout, must not let state land in a source clone.
  const dataWorkTree = findGitWorkTree(real);
  if (dataWorkTree !== undefined) {
    throwAppError(
      'JULES_DATA_DIR',
      'the data directory must not be inside any git work tree'
    );
  }
}

function currentUid(): number | undefined {
  return typeof process.getuid === 'function' ? process.getuid() : undefined;
}

/**
 * Refuses a symlink, a non-directory, a directory owned by another user, or
 * one writable by group or others — `runtime/node_modules/` under the data
 * dir is executable code loaded into this process, so a directory anyone
 * else could have written is never trusted. A directory that is merely
 * readable by others is tightened to 0700 (we own it, nothing was planted).
 */
export function assertOwnerOnlyDir(dirPath: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(dirPath);
  } catch (err) {
    throwAppError(
      'JULES_DATA_DIR',
      `cannot inspect ${dirPath}: ${(err as NodeJS.ErrnoException).code ?? 'error'}`
    );
  }
  if (stat.isSymbolicLink()) {
    throwAppError('JULES_DATA_DIR', `refusing symlinked directory ${dirPath}`);
  }
  if (!stat.isDirectory()) {
    throwAppError('JULES_DATA_DIR', `${dirPath} is not a directory`);
  }
  const uid = currentUid();
  if (uid !== undefined && stat.uid !== uid) {
    throwAppError(
      'JULES_DATA_DIR',
      `${dirPath} is not owned by the current user`
    );
  }
  if (process.platform === 'win32') return;
  if ((stat.mode & 0o022) !== 0) {
    throwAppError(
      'JULES_DATA_DIR',
      `${dirPath} is writable by group or others (mode ${(stat.mode & 0o777).toString(8)})`
    );
  }
  if ((stat.mode & 0o077) !== 0) {
    fs.chmodSync(dirPath, 0o700);
  }
}

/** Same checks for a regular file (journal, lock, pin.json): owned, not a symlink, 0600. */
export function assertOwnerOnlyFile(filePath: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throwAppError(
      'JULES_DATA_DIR',
      `cannot inspect ${filePath}: ${(err as NodeJS.ErrnoException).code ?? 'error'}`
    );
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throwAppError('JULES_DATA_DIR', `${filePath} is not a regular file`);
  }
  const uid = currentUid();
  if (uid !== undefined && stat.uid !== uid) {
    throwAppError(
      'JULES_DATA_DIR',
      `${filePath} is not owned by the current user`
    );
  }
  if (process.platform === 'win32') return;
  if ((stat.mode & 0o022) !== 0) {
    throwAppError(
      'JULES_DATA_DIR',
      `${filePath} is writable by group or others (mode ${(stat.mode & 0o777).toString(8)})`
    );
  }
  if ((stat.mode & 0o077) !== 0) {
    fs.chmodSync(filePath, 0o600);
  }
}

/** Create `dirPath` 0700 when absent (parents with default mode), then assert it is owner-only. */
export function ensureOwnerOnlyDir(dirPath: string): void {
  try {
    fs.lstatSync(dirPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    fs.mkdirSync(path.dirname(dirPath), { recursive: true });
    try {
      fs.mkdirSync(dirPath, { mode: 0o700 });
    } catch (mkdirErr) {
      if ((mkdirErr as NodeJS.ErrnoException).code !== 'EEXIST') throw mkdirErr;
    }
  }
  assertOwnerOnlyDir(dirPath);
}

/**
 * Every invocation that reads state or resolves the SDK calls this first:
 * location rules, then owner-only checks on the data dir and each of its
 * existing sensitive subdirectories (contract "Local state").
 */
export function prepareDataDir(
  dataDir: string,
  context: DataDirLocationContext
): void {
  assertDataDirLocation(dataDir, context);
  ensureOwnerOnlyDir(dataDir);
  ensureOwnerOnlyDir(resolveStateDir(dataDir));
  for (const sub of [
    resolveSdkScratchDir(dataDir),
    resolveRuntimeDir(dataDir),
  ]) {
    if (fs.existsSync(sub) || isSymlink(sub)) assertOwnerOnlyDir(sub);
  }
}

function isSymlink(target: string): boolean {
  try {
    return fs.lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * R38: the controller authority file lives outside `<dataDir>`, so a copied
 * or restored data directory cannot carry it along. Precedence:
 * `YELLOW_JULES_CONTROLLER_DIR` > `$XDG_STATE_HOME/yellow-jules-controller` >
 * `~/.local/state/yellow-jules-controller`. Created 0700.
 *
 * The directory and `dataDir` must not contain each other by canonical path:
 * otherwise copying the data directory (or its parent) would also copy the
 * file that is meant to detect the copy.
 */
export function resolveControllerDir(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir
): string {
  const explicit = env['YELLOW_JULES_CONTROLLER_DIR'];
  const xdgStateHome = env['XDG_STATE_HOME'];
  let dir: string;
  if (explicit && explicit.length > 0) {
    dir = explicit;
  } else if (xdgStateHome && xdgStateHome.length > 0) {
    dir = path.join(xdgStateHome, 'yellow-jules-controller');
  } else {
    dir = path.join(homedir(), '.local', 'state', 'yellow-jules-controller');
  }
  if (!path.isAbsolute(dir)) {
    return throwAppError(
      'JULES_DATA_DIR',
      'the controller directory must be an absolute path'
    );
  }
  const realController = realpathOfExistingPrefix(dir);
  const realData = realpathOfExistingPrefix(dataDir);
  if (
    isInside(realData, realController) ||
    isInside(realController, realData)
  ) {
    return throwAppError(
      'JULES_DATA_DIR',
      'the controller directory and the data directory must not contain each other'
    );
  }
  ensureOwnerOnlyDir(dir);
  return dir;
}

/**
 * Atomic whole-file write for owner-only state (grants, the controller file):
 * a sibling temp file created `wx` at 0600, fsynced, then renamed over the
 * target. The temp file is removed if any step fails, so a failed write leaves
 * neither a stray file nor a half-written target.
 */
export function writeFileAtomicOwnerOnly(file: string, data: string): void {
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, data, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  fs.chmodSync(file, 0o600);
}
