/**
 * Locates, verifies, and loads the ESM-only `@google/jules-sdk` from this
 * CJS build (contract "Module-strategy verdict", R4, R6).
 *
 * Two install locations, checked in order:
 * - workspace: `<pluginRoot>/node_modules/@google/jules-sdk` (a monorepo
 *   checkout; the workspace lockfile owns integrity there);
 * - data dir: `<dataDir>/runtime/node_modules/@google/jules-sdk`, installed
 *   only by `setup --install-sdk` with `npm ci --ignore-scripts` from the
 *   lockfile shipped in `<pluginRoot>/runtime/`, and re-verified on every
 *   load against `runtime/pin.json` (entry sha256 plus the installed tree).
 *
 * Both paths are read directly rather than through `createRequire`, whose
 * node_modules walk would also accept an unverified install in any ancestor
 * directory. Loading is `await import(pathToFileURL(entry).href)`:
 * `require.resolve` throws ERR_PACKAGE_PATH_NOT_EXPORTED on this package and
 * a bare specifier fails from the plugin cache.
 */

import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  assertOwnerOnlyDir,
  assertOwnerOnlyFile,
  ensureOwnerOnlyDir,
  resolvePluginRoot,
  resolveRuntimeDir,
} from './config.js';
import { throwAppError } from './errors.js';

export const SDK_PACKAGE = '@google/jules-sdk';
export const PINNED_SDK_VERSION = '0.2.0';
export const INSTALL_TIMEOUT_MS = 300_000;

export type SdkResolution = 'workspace' | 'data-dir' | 'missing';

export interface PinnedPackage {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
}

export interface PinFile {
  readonly sdkVersion: string;
  readonly sdkIntegrity: string;
  readonly sdkEntrySha256: string;
  readonly tree: readonly PinnedPackage[];
}

export interface SdkProbe {
  readonly resolution: SdkResolution;
  readonly sdkVersion?: string;
  readonly sdkIntegrity?: string;
  readonly sdkEntrySha256?: string;
  /** Absolute path of the verified ESM entry file; absent when missing. */
  readonly entryPath?: string;
}

export interface ResolvedSdk extends SdkProbe {
  readonly resolution: 'workspace' | 'data-dir';
  readonly entryPath: string;
  /** The SDK module namespace; only sdk-adapter.ts interprets it. */
  readonly module: unknown;
}

export interface ResolverOptions {
  readonly pluginRoot?: string;
  /** Probe only the data-dir install (setup reports what it just installed). */
  readonly dataDirOnly?: boolean;
}

function sha256File(filePath: string): string {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

function integrityFailure(message: string): never {
  return throwAppError('JULES_SDK_INTEGRITY', message);
}

function packageDir(nodeModules: string, name: string): string {
  return path.join(nodeModules, ...name.split('/'));
}

/** Reads `exports["."].import` and returns the entry file, refusing anything outside the package. */
function entryFileOf(pkgDir: string): { version: string; entry: string } {
  let manifest: unknown;
  try {
    manifest = readJson(path.join(pkgDir, 'package.json'));
  } catch {
    return integrityFailure(`${SDK_PACKAGE} package.json is unreadable`);
  }
  const m = manifest as {
    version?: unknown;
    exports?: { '.'?: { import?: unknown } };
  };
  if (m.version !== PINNED_SDK_VERSION) {
    return integrityFailure(
      `${SDK_PACKAGE} is version ${String(m.version)}, expected the pinned ${PINNED_SDK_VERSION}`
    );
  }
  const importPath = m.exports?.['.']?.import;
  if (typeof importPath !== 'string') {
    return integrityFailure(`${SDK_PACKAGE} has no exports["."].import entry`);
  }
  const entry = path.resolve(pkgDir, importPath);
  const rel = path.relative(pkgDir, entry);
  if (
    rel === '..' ||
    rel.startsWith(`..${path.sep}`) ||
    path.isAbsolute(rel) ||
    !fs.existsSync(entry)
  ) {
    return integrityFailure(
      `${SDK_PACKAGE} entry ${importPath} is missing or escapes the package`
    );
  }
  return { version: m.version, entry };
}

/** Installed top-level packages under node_modules (scoped ones as `@scope/name`), dot-entries skipped. */
function listInstalledPackages(nodeModules: string): string[] {
  const names: string[] = [];
  for (const entry of fs.readdirSync(nodeModules)) {
    if (entry.startsWith('.')) continue;
    if (entry.startsWith('@')) {
      for (const scoped of fs.readdirSync(path.join(nodeModules, entry))) {
        names.push(`${entry}/${scoped}`);
      }
    } else {
      names.push(entry);
    }
  }
  return names.sort();
}

function isPinFile(value: unknown): value is PinFile {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['sdkVersion'] === 'string' &&
    typeof v['sdkIntegrity'] === 'string' &&
    typeof v['sdkEntrySha256'] === 'string' &&
    Array.isArray(v['tree']) &&
    v['tree'].every(
      (p: unknown) =>
        p !== null &&
        typeof p === 'object' &&
        typeof (p as Record<string, unknown>)['name'] === 'string' &&
        typeof (p as Record<string, unknown>)['version'] === 'string'
    )
  );
}

function pinPath(dataDir: string): string {
  return path.join(resolveRuntimeDir(dataDir), 'pin.json');
}

/** Data-dir branch: entry sha256 and the full installed tree must match what setup recorded. */
function verifyDataDirInstall(dataDir: string, entry: string): PinFile {
  const file = pinPath(dataDir);
  assertOwnerOnlyFile(file);
  if (!fs.existsSync(file)) {
    return integrityFailure(
      'runtime/pin.json is missing; the data-dir SDK install is unverified'
    );
  }
  let pin: unknown;
  try {
    pin = readJson(file);
  } catch {
    return integrityFailure('runtime/pin.json is unreadable');
  }
  if (!isPinFile(pin) || pin.sdkVersion !== PINNED_SDK_VERSION) {
    return integrityFailure('runtime/pin.json does not record the pinned SDK');
  }
  if (sha256File(entry) !== pin.sdkEntrySha256) {
    return integrityFailure(
      `${SDK_PACKAGE} entry file sha256 does not match runtime/pin.json`
    );
  }
  const nodeModules = path.join(resolveRuntimeDir(dataDir), 'node_modules');
  const installed = listInstalledPackages(nodeModules);
  const pinned = pin.tree.map((p) => p.name).sort();
  if (installed.join('\n') !== pinned.join('\n')) {
    return integrityFailure(
      'installed packages under runtime/node_modules differ from runtime/pin.json'
    );
  }
  for (const p of pin.tree) {
    let version: unknown;
    try {
      version = (
        readJson(
          path.join(packageDir(nodeModules, p.name), 'package.json')
        ) as { version?: unknown }
      ).version;
    } catch {
      return integrityFailure(`${p.name} package.json is unreadable`);
    }
    if (version !== p.version) {
      return integrityFailure(
        `${p.name} is ${String(version)}, runtime/pin.json records ${p.version}`
      );
    }
  }
  return pin;
}

/**
 * Locates and verifies the SDK without importing it. Throws
 * JULES_SDK_INTEGRITY on any verification failure (a present-but-wrong
 * install is never reported as `missing`); returns `missing` when neither
 * location holds the package. Runs the data-dir owner checks first, because
 * `runtime/node_modules` is executable code.
 */
export function probeSdkResolution(
  dataDir: string,
  options: ResolverOptions = {}
): SdkProbe {
  assertOwnerOnlyDir(dataDir);
  const pluginRoot = options.pluginRoot ?? resolvePluginRoot();

  const workspacePkg = packageDir(
    path.join(pluginRoot, 'node_modules'),
    SDK_PACKAGE
  );
  if (
    options.dataDirOnly !== true &&
    fs.existsSync(path.join(workspacePkg, 'package.json'))
  ) {
    const { version, entry } = entryFileOf(workspacePkg);
    return { resolution: 'workspace', sdkVersion: version, entryPath: entry };
  }

  const runtimeDir = resolveRuntimeDir(dataDir);
  if (!fs.existsSync(runtimeDir)) return { resolution: 'missing' };
  assertOwnerOnlyDir(runtimeDir);
  const dataPkg = packageDir(
    path.join(runtimeDir, 'node_modules'),
    SDK_PACKAGE
  );
  if (!fs.existsSync(path.join(dataPkg, 'package.json')))
    return { resolution: 'missing' };
  const { version, entry } = entryFileOf(dataPkg);
  const pin = verifyDataDirInstall(dataDir, entry);
  return {
    resolution: 'data-dir',
    sdkVersion: version,
    sdkIntegrity: pin.sdkIntegrity,
    sdkEntrySha256: pin.sdkEntrySha256,
    entryPath: entry,
  };
}

let cached: ResolvedSdk | undefined;

/** Test-only: forces the next resolveSdk() call to re-resolve. */
export function resetSdkCache(): void {
  cached = undefined;
}

export async function resolveSdk(
  dataDir: string,
  options: ResolverOptions = {}
): Promise<ResolvedSdk> {
  if (cached !== undefined) return cached;
  const probe = probeSdkResolution(dataDir, options);
  if (probe.resolution === 'missing' || probe.entryPath === undefined) {
    return throwAppError(
      'JULES_SDK_MISSING',
      `${SDK_PACKAGE}@${PINNED_SDK_VERSION} is not installed`
    );
  }
  const module: unknown = await import(pathToFileURL(probe.entryPath).href);
  cached = {
    ...probe,
    resolution: probe.resolution,
    entryPath: probe.entryPath,
    module,
  };
  return cached;
}

// ---------------------------------------------------------------------------
// Install (setup --install-sdk only; never per task)
// ---------------------------------------------------------------------------

export interface NpmRunResult {
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export type NpmRunner = (
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }
) => Promise<NpmRunResult>;

const STDERR_CAP = 64 * 1024;

export const defaultNpmRunner: NpmRunner = (args, options) =>
  new Promise((resolve) => {
    const child = spawn('npm', [...args], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < STDERR_CAP) stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ exitCode: null, stderr: `${stderr}${err.message}`, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stderr, timedOut });
    });
  });

/** The install child never sees the credential or anything that injects code into node. */
export function scrubInstallEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (
      key === 'JULES_API_KEY' ||
      key === 'NODE_OPTIONS' ||
      key === 'NODE_PATH'
    )
      continue;
    if (key.toLowerCase() === 'npm_config_ignore_scripts') continue;
    out[key] = value;
  }
  return out;
}

interface LockfilePackage {
  readonly version?: unknown;
  readonly integrity?: unknown;
}

function lockfileTree(lockfilePath: string): PinnedPackage[] {
  const lock = readJson(lockfilePath) as {
    packages?: Record<string, LockfilePackage>;
  };
  const tree: PinnedPackage[] = [];
  for (const [key, value] of Object.entries(lock.packages ?? {})) {
    if (key === '') continue;
    const name = key.replace(/^node_modules\//, '');
    if (name.includes('node_modules/')) {
      return integrityFailure(
        `lockfile entry ${key} is nested; the pinned tree must be flat`
      );
    }
    if (
      typeof value.version !== 'string' ||
      typeof value.integrity !== 'string'
    ) {
      return integrityFailure(
        `lockfile entry ${key} has no version or integrity`
      );
    }
    tree.push({ name, version: value.version, integrity: value.integrity });
  }
  return tree.sort((a, b) => a.name.localeCompare(b.name));
}

async function removeInstall(runtimeDir: string): Promise<void> {
  await fs.promises.rm(path.join(runtimeDir, 'node_modules'), {
    recursive: true,
    force: true,
  });
  await fs.promises.rm(path.join(runtimeDir, 'pin.json'), { force: true });
}

async function writePin(file: string, pin: PinFile): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fs.promises.writeFile(tmp, `${JSON.stringify(pin, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  });
  await fs.promises.rename(tmp, file);
  await fs.promises.chmod(file, 0o600);
}

export interface InstallOptions extends ResolverOptions {
  readonly runNpm?: NpmRunner;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
}

/**
 * `npm ci --ignore-scripts` from the lockfile shipped with the plugin, so
 * every package's integrity hash is checked and no lifecycle script runs
 * (R4). npm raises EINTEGRITY only after the tarball has streamed, so on any
 * failure `runtime/node_modules` and `pin.json` are removed before anything
 * under them can be loaded.
 */
export async function installSdk(
  dataDir: string,
  options: InstallOptions = {}
): Promise<SdkProbe> {
  const pluginRoot = options.pluginRoot ?? resolvePluginRoot();
  const shippedRuntime = path.join(pluginRoot, 'runtime');
  const runtimeDir = resolveRuntimeDir(dataDir);
  assertOwnerOnlyDir(dataDir);
  ensureOwnerOnlyDir(runtimeDir);
  await removeInstall(runtimeDir);

  for (const name of ['package.json', 'package-lock.json']) {
    const target = path.join(runtimeDir, name);
    await fs.promises.rm(target, { force: true });
    await fs.promises.copyFile(
      path.join(shippedRuntime, name),
      target,
      fs.constants.COPYFILE_EXCL
    );
    await fs.promises.chmod(target, 0o600);
  }

  const runNpm = options.runNpm ?? defaultNpmRunner;
  const result = await runNpm(
    ['ci', '--ignore-scripts', '--no-audit', '--no-fund'],
    {
      cwd: runtimeDir,
      env: scrubInstallEnv(options.env ?? process.env),
      timeoutMs: options.timeoutMs ?? INSTALL_TIMEOUT_MS,
    }
  );

  try {
    if (result.exitCode !== 0) {
      if (/EINTEGRITY/.test(result.stderr)) {
        return integrityFailure(
          'npm ci reported EINTEGRITY; the install was removed'
        );
      }
      return throwAppError(
        'JULES_SDK_MISSING',
        result.timedOut
          ? `npm ci timed out after ${options.timeoutMs ?? INSTALL_TIMEOUT_MS} ms; the install was removed`
          : `npm ci exited ${String(result.exitCode)}; the install was removed`,
        {
          recoveryAction:
            'Check network access to the npm registry, then rerun /jules:setup.',
        }
      );
    }
    const tree = lockfileTree(path.join(runtimeDir, 'package-lock.json'));
    const sdk = tree.find((p) => p.name === SDK_PACKAGE);
    if (sdk === undefined || sdk.version !== PINNED_SDK_VERSION) {
      return integrityFailure(
        `the shipped lockfile does not pin ${SDK_PACKAGE}@${PINNED_SDK_VERSION}`
      );
    }
    const nodeModules = path.join(runtimeDir, 'node_modules');
    const { entry } = entryFileOf(packageDir(nodeModules, SDK_PACKAGE));
    const pin: PinFile = {
      sdkVersion: sdk.version,
      sdkIntegrity: sdk.integrity,
      sdkEntrySha256: sha256File(entry),
      tree,
    };
    await writePin(pinPath(dataDir), pin);
    verifyDataDirInstall(dataDir, entry);
  } catch (err) {
    await removeInstall(runtimeDir);
    throw err;
  }
  resetSdkCache();
  return probeSdkResolution(dataDir, { pluginRoot, dataDirOnly: true });
}
