/**
 * All input validation for the CLI. Every function either returns a
 * normalized value or throws AppErrorException(CURSOR_INVALID_INPUT) via
 * throwAppError — nothing here talks to the SDK or the network, which is
 * what keeps `delegate --dry-run` a zero-network operation.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { throwAppError } from './errors.js';

const ALLOWED_REPO_HOSTS = new Set([
  'github.com',
  'gitlab.com',
  'dev.azure.com',
  'bitbucket.org',
]);

export function validateRepoUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      `Invalid repository URL: ${input}`
    );
  }
  if (url.protocol !== 'https:') {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'Repository URL must use https://'
    );
  }
  if (url.username !== '' || url.password !== '') {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'Repository URL must not contain userinfo (user:pass@)'
    );
  }
  if (url.hash !== '') {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'Repository URL must not contain a fragment'
    );
  }
  if (url.port !== '') {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'Repository URL must not contain an explicit port'
    );
  }
  if (!ALLOWED_REPO_HOSTS.has(url.hostname.toLowerCase())) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      `Repository host "${url.hostname}" is not allowlisted (github.com, gitlab.com, dev.azure.com, bitbucket.org)`
    );
  }
  return url.toString();
}

const REF_METACHAR_RE = /[\s~^:?*[\\`;|&$()<>'"\r\n]/;

export function validateRef(input: string): string {
  if (input.length === 0 || input.length > 255) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'ref must be 1-255 characters'
    );
  }
  if (input.startsWith('-')) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'ref must not start with a dash'
    );
  }
  if (input.startsWith('/') || input.endsWith('/') || input.endsWith('.lock')) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'ref must not start/end with "/" or end with ".lock"'
    );
  }
  if (input.includes('..') || input.includes('//')) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'ref must not contain ".." or "//"'
    );
  }
  if (REF_METACHAR_RE.test(input)) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'ref contains whitespace or shell/git metacharacters'
    );
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(input)) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'ref contains control characters'
    );
  }
  return input;
}

export function validateModelId(input: string | undefined): string | undefined {
  if (input === undefined) return undefined;
  if (input.length === 0 || input.length > 128) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'model id must be 1-128 characters'
    );
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(input)) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'model id contains control characters'
    );
  }
  return input;
}

const AGENT_ID_RE = /^bc-[0-9a-f-]+$/i;

export function validateAgentId(input: string): string {
  if (input.length < 4 || input.length > 128) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'agent id must be 4-128 characters'
    );
  }
  if (!AGENT_ID_RE.test(input)) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'agent id has an unexpected shape (expected bc-<hex/dashes>)'
    );
  }
  return input;
}

const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function validateRunId(input: string): string {
  if (!SAFE_ID_RE.test(input)) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'run id must be 1-128 characters of [A-Za-z0-9_-]'
    );
  }
  return input;
}

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{1,200}$/;

export function validateIdempotencyKey(input: string): string {
  if (!IDEMPOTENCY_KEY_RE.test(input)) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'idempotency key must be 1-200 characters of [A-Za-z0-9._:-]'
    );
  }
  return input;
}

const MAX_PROMPT_BYTES = 100 * 1024;

export function validatePrompt(input: string): string {
  if (input.length === 0) {
    return throwAppError('CURSOR_INVALID_INPUT', 'prompt must not be empty');
  }
  // eslint-disable-next-line no-control-regex
  if (/\x00/.test(input)) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'prompt must not contain NUL bytes'
    );
  }
  if (Buffer.byteLength(input, 'utf8') > MAX_PROMPT_BYTES) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      `prompt exceeds ${MAX_PROMPT_BYTES} byte cap`
    );
  }
  return input;
}

export function validateArtifactRemotePath(input: string): string {
  if (input.length === 0 || input.length > 4096) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'artifact path must be 1-4096 characters'
    );
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(input)) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'artifact path contains control characters'
    );
  }
  if (path.isAbsolute(input)) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'artifact path must be relative'
    );
  }
  const segments = input.split('/');
  if (segments.some((segment) => segment === '..')) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'artifact path must not contain ".." segments'
    );
  }
  return input;
}

const OUT_PATH_METACHAR_RE = /[;|&$()<>'"`\\]/;

export function validateLocalOutPath(input: string): string {
  if (input.length === 0 || input.length > 4096) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'output path must be 1-4096 characters'
    );
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(input)) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'output path contains control characters'
    );
  }
  if (path.isAbsolute(input)) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'output path must be relative to the artifact download directory'
    );
  }
  if (input.startsWith('-')) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'output path must not start with a dash'
    );
  }
  const segments = input.split(/[/\\]/);
  if (segments.some((segment) => segment === '..')) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'output path must not contain ".." segments'
    );
  }
  if (segments.some((segment) => segment.length > 0 && OUT_PATH_METACHAR_RE.test(segment))) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'output path contains unsafe shell metacharacters'
    );
  }
  return input;
}

/** Resolve a validated relative path under an approved root; rejects symlink escapes. */
export function resolveLocalOutPath(rootDir: string, input: string): string {
  const relative = validateLocalOutPath(input);
  const resolvedRoot = path.resolve(rootDir);
  const resolved = path.resolve(resolvedRoot, relative);
  const rel = path.relative(resolvedRoot, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'output path escapes the artifact download directory'
    );
  }
  return resolved;
}

async function lstatRejectSymlink(target: string): Promise<void> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.lstat(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  if (stat.isSymbolicLink()) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      `refusing to follow symlink at ${target}`
    );
  }
}

/**
 * Create parent directories without following symlinks and verify every
 * existing component under `rootDir` is a real directory (not a symlink).
 */
export async function ensureContainedPathForWrite(
  rootDir: string,
  filePath: string
): Promise<void> {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedFile = path.resolve(filePath);
  const rel = path.relative(resolvedRoot, resolvedFile);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'output path escapes the artifact download directory'
    );
  }

  await lstatRejectSymlink(resolvedRoot);
  try {
    await fs.promises.mkdir(resolvedRoot, { recursive: false, mode: 0o700 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }

  const dirRel = path.dirname(rel);
  if (dirRel === '.' || dirRel === '') {
    await lstatRejectSymlink(resolvedFile);
    return;
  }

  const segments = dirRel.split(path.sep).filter((segment) => segment.length > 0);
  let current = resolvedRoot;
  for (const segment of segments) {
    current = path.join(current, segment);
    await lstatRejectSymlink(current);
    try {
      await fs.promises.mkdir(current, { mode: 0o700 });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    await lstatRejectSymlink(current);
  }

  await lstatRejectSymlink(resolvedFile);
}

export function validateMaxActive(input: number): number {
  if (!Number.isInteger(input) || input < 1 || input > 50) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'max-active must be an integer between 1 and 50'
    );
  }
  return input;
}

export function validateCursor(input: string | undefined): string | undefined {
  if (input === undefined) return undefined;
  if (input.length === 0 || input.length > 512) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'cursor must be 1-512 characters'
    );
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(input)) {
    return throwAppError(
      'CURSOR_INVALID_INPUT',
      'cursor contains control characters'
    );
  }
  return input;
}
