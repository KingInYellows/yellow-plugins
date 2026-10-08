/**
 * Identifier allowlist (contract "Identifier allowlist", R7). Every
 * vendor-supplied identifier, accepted as input or returned by the API, is
 * checked against an anchored pattern before it reaches an adapter call, a
 * URL, a journal key, or a filesystem path. Patterns are deliberately
 * conservative: they reject rather than widen.
 *
 * `origin` selects the failure code: a caller-supplied value that fails is
 * JULES_INVALID_INPUT; a value the API returned is JULES_MALFORMED_RESPONSE.
 * Nothing here talks to the SDK or the network.
 */

import * as crypto from 'node:crypto';

import { type AppErrorCode, throwAppError } from './errors.js';
import type { GrantOperation } from './types.js';

export type ValueOrigin = 'input' | 'response';

function codeFor(origin: ValueOrigin): AppErrorCode {
  return origin === 'input'
    ? 'JULES_INVALID_INPUT'
    : 'JULES_MALFORMED_RESPONSE';
}

function checkPattern(
  value: unknown,
  pattern: RegExp,
  label: string,
  origin: ValueOrigin
): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    return throwAppError(codeFor(origin), `${label} has an unexpected shape`);
  }
  return value;
}

const REF_METACHAR_RE = /[\s~^:?*[\\`;|&$()<>'"\r\n]/;

// replica:validateRef:start
export function validateRef(input: string): string {
  if (input.length === 0 || input.length > 255) {
    return throwAppError('JULES_INVALID_INPUT', 'ref must be 1-255 characters');
  }
  if (input.startsWith('-')) {
    return throwAppError(
      'JULES_INVALID_INPUT',
      'ref must not start with a dash'
    );
  }
  if (input.startsWith('/') || input.endsWith('/') || input.endsWith('.lock')) {
    return throwAppError(
      'JULES_INVALID_INPUT',
      'ref must not start/end with "/" or end with ".lock"'
    );
  }
  if (input.includes('..') || input.includes('//')) {
    return throwAppError(
      'JULES_INVALID_INPUT',
      'ref must not contain ".." or "//"'
    );
  }
  if (REF_METACHAR_RE.test(input)) {
    return throwAppError(
      'JULES_INVALID_INPUT',
      'ref contains whitespace or shell/git metacharacters'
    );
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(input)) {
    return throwAppError(
      'JULES_INVALID_INPUT',
      'ref contains control characters'
    );
  }
  return input;
}
// replica:validateRef:end

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{1,200}$/;

// replica:validateIdempotencyKey:start
export function validateIdempotencyKey(input: string): string {
  if (!IDEMPOTENCY_KEY_RE.test(input)) {
    return throwAppError(
      'JULES_INVALID_INPUT',
      'idempotency key must be 1-200 characters of [A-Za-z0-9._:-]'
    );
  }
  return input;
}
// replica:validateIdempotencyKey:end

const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Local request id and `--task-ref`: journal and grant match keys, so prototype names are refused too. */
export function validateRequestId(input: string, label = 'request id'): string {
  if (!IDEMPOTENCY_KEY_RE.test(input) || PROTOTYPE_KEYS.has(input)) {
    return throwAppError(
      'JULES_INVALID_INPUT',
      `${label} must be 1-200 characters of [A-Za-z0-9._:-] and not a prototype key`
    );
  }
  return input;
}

export function validateTaskRef(input: string): string {
  return validateRequestId(input, 'task ref');
}

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const SESSION_RESOURCE_RE = /^sessions\/([A-Za-z0-9_-]{1,128})$/;
const ACTIVITY_RESOURCE_RE =
  /^sessions\/[A-Za-z0-9_-]{1,128}\/activities\/([A-Za-z0-9_-]{1,128})$/;
const OWNER_PART = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})';
const REPO_PART = '(?!\\.{1,2}$)[A-Za-z0-9_.-]{1,100}';
const REPO_INPUT_RE = new RegExp(`^(${OWNER_PART})/(${REPO_PART})$`);
const SOURCE_RESOURCE_RE = new RegExp(
  `^sources/github/(${OWNER_PART})/(${REPO_PART})$`
);
const BASE_COMMIT_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const PAGE_TOKEN_RE = /^(?!\.{1,2}$)[A-Za-z0-9_.=-]{1,512}$/;
const LOCAL_ID_RE = /^jl-[0-9a-f]{32}$/;
const TITLE_TAG_RE = /^\[yellow:(jl-[0-9a-f]{32})\](?: |$)/;

export function validateSessionId(
  value: unknown,
  origin: ValueOrigin = 'input'
): string {
  return checkPattern(value, ID_RE, 'session id', origin);
}

export function validateSessionResource(
  value: unknown,
  origin: ValueOrigin = 'input'
): string {
  return checkPattern(value, SESSION_RESOURCE_RE, 'session resource', origin);
}

/** `sessions/{id}` -> `{id}`; the resource must already be valid. */
export function sessionIdOf(resource: string): string {
  const match = SESSION_RESOURCE_RE.exec(resource);
  if (!match || match[1] === undefined) {
    return throwAppError(
      'JULES_MALFORMED_RESPONSE',
      'session resource has an unexpected shape'
    );
  }
  return match[1];
}

export function validateActivityId(
  value: unknown,
  origin: ValueOrigin = 'response'
): string {
  return checkPattern(value, ID_RE, 'activity id', origin);
}

export function validateActivityResource(
  value: unknown,
  origin: ValueOrigin = 'response'
): string {
  return checkPattern(value, ACTIVITY_RESOURCE_RE, 'activity resource', origin);
}

/** Plan ids and plan-step ids share the pattern. */
export function validatePlanId(
  value: unknown,
  origin: ValueOrigin = 'response'
): string {
  return checkPattern(value, ID_RE, 'plan id', origin);
}

export interface RepoRef {
  readonly owner: string;
  readonly repo: string;
}

export function validateSourceResource(
  value: unknown,
  origin: ValueOrigin = 'response'
): string {
  return checkPattern(value, SOURCE_RESOURCE_RE, 'source resource', origin);
}

export function repoOfSourceResource(resource: string): RepoRef {
  const match = SOURCE_RESOURCE_RE.exec(resource);
  if (!match || match[1] === undefined || match[2] === undefined) {
    return throwAppError(
      'JULES_MALFORMED_RESPONSE',
      'source resource has an unexpected shape'
    );
  }
  return { owner: match[1], repo: match[2] };
}

/** `--repo owner/repo` (GitHub owner and repo rules; `.github` stays valid, `.`/`..` never). */
export function validateRepoInput(input: string): RepoRef {
  const match = REPO_INPUT_RE.exec(input);
  if (!match || match[1] === undefined || match[2] === undefined) {
    return throwAppError(
      'JULES_INVALID_INPUT',
      'repository must be <owner>/<repo>'
    );
  }
  return { owner: match[1], repo: match[2] };
}

export function sourceResourceFor(ref: RepoRef): string {
  return `sources/github/${ref.owner}/${ref.repo}`;
}

/** Reaches git argv in PR4, so exactly a full sha1 or sha256 hex object id. */
export function validateBaseCommitId(
  value: unknown,
  origin: ValueOrigin = 'response'
): string {
  return checkPattern(value, BASE_COMMIT_RE, 'base commit id', origin);
}

export type PullRequestUrlCheck =
  | { readonly valid: true; readonly url: string; readonly number: number }
  | { readonly valid: false; readonly reason: string };

/**
 * Parse-then-compare, never a templated regex: an https github.com URL whose
 * owner and repo segments strict-equal the session's validated source, then
 * `/pull/<n>`. Any other value is a policy deviation, never a rendered link.
 */
export function validatePullRequestUrl(
  value: unknown,
  sourceResource: string
): PullRequestUrlCheck {
  if (typeof value !== 'string')
    return { valid: false, reason: 'not a string' };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { valid: false, reason: 'not a URL' };
  }
  if (url.protocol !== 'https:') return { valid: false, reason: 'not https' };
  if (url.hostname !== 'github.com')
    return { valid: false, reason: 'not github.com' };
  if (url.username !== '' || url.password !== '' || url.port !== '') {
    return { valid: false, reason: 'unexpected userinfo or port' };
  }
  if (url.search !== '' || url.hash !== '') {
    return { valid: false, reason: 'unexpected query or fragment' };
  }
  const expected = repoOfSourceResource(sourceResource);
  const segments = url.pathname.split('/');
  // ['', owner, repo, ...rest]
  if (segments[1] !== expected.owner || segments[2] !== expected.repo) {
    return {
      valid: false,
      reason: 'repository does not match the session source',
    };
  }
  const remainder = `/${segments.slice(3).join('/')}`;
  const pull = /^\/pull\/([0-9]{1,10})$/.exec(remainder);
  if (!pull || pull[1] === undefined) {
    return { valid: false, reason: 'not a pull request path' };
  }
  return { valid: true, url: url.toString(), number: Number(pull[1]) };
}

/** Display-only vendor text: kept only when it parses as https; never opened, never compared. */
export function validateSessionDisplayUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    return new URL(value).protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
}

export function isValidPageToken(value: unknown): value is string {
  return typeof value === 'string' && PAGE_TOKEN_RE.test(value);
}

/** Page and resume tokens: query parameter only, never a path. */
export function validatePageToken(
  value: unknown,
  origin: ValueOrigin = 'input'
): string {
  return checkPattern(value, PAGE_TOKEN_RE, 'page token', origin);
}

export function validateLocalId(
  value: unknown,
  origin: ValueOrigin = 'input'
): string {
  return checkPattern(value, LOCAL_ID_RE, 'local id', origin);
}

/** `jl-` + 16 random bytes hex: the only id ever used in a filesystem path (R40). */
export function mintLocalId(): string {
  return `jl-${crypto.randomBytes(16).toString('hex')}`;
}

export interface TitleTag {
  readonly localId?: string;
  readonly title: string;
}

/** Anchored extraction of the `[yellow:<local-id>]` reconcile tag; the tag is stripped for display. */
export function extractTitleTag(title: string): TitleTag {
  const match = TITLE_TAG_RE.exec(title);
  if (!match || match[1] === undefined) return { title };
  return { localId: match[1], title: title.slice(match[0].length) };
}

export type SessionRef =
  | { readonly kind: 'local'; readonly localId: string }
  | { readonly kind: 'resource'; readonly sessionResource: string };

/** `--session` accepts a local id or a vendor `sessions/{id}` resource. */
export function parseSessionRef(input: string): SessionRef {
  if (LOCAL_ID_RE.test(input)) return { kind: 'local', localId: input };
  if (SESSION_RESOURCE_RE.test(input))
    return { kind: 'resource', sessionResource: input };
  return throwAppError(
    'JULES_INVALID_INPUT',
    '--session must be a local id (jl-<32 hex>) or sessions/<id>'
  );
}

export function validatePositiveInt(
  value: string,
  label: string,
  min: number,
  max: number
): number {
  if (!/^[0-9]{1,9}$/.test(value)) {
    return throwAppError('JULES_INVALID_INPUT', `${label} must be an integer`);
  }
  const parsed = Number(value);
  if (parsed < min || parsed > max) {
    return throwAppError(
      'JULES_INVALID_INPUT',
      `${label} must be between ${min} and ${max}`
    );
  }
  return parsed;
}

const GRANT_ID_RE = /^jg-[0-9a-f]{32}$/;
const CONTROLLER_ID_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62})$/;
const BRANCH_PATTERN_MAX = 200;
const GRANT_OPERATIONS: readonly GrantOperation[] = [
  'create',
  'reply',
  'approve',
  'collect',
];

export function validateGrantId(
  value: unknown,
  origin: ValueOrigin = 'input'
): string {
  return checkPattern(value, GRANT_ID_RE, 'grant id', origin);
}

/** `jg-` + 16 random bytes hex. */
export function mintGrantId(): string {
  return `jg-${crypto.randomBytes(16).toString('hex')}`;
}

/**
 * An exact ref or a ref with a single trailing `*` glob, anchored and
 * length-bounded. The glob never appears mid-ref, so matching is a prefix
 * test and cannot be turned into an unbounded pattern.
 */
export function validateBranchPattern(input: string): string {
  if (input.length === 0 || input.length > BRANCH_PATTERN_MAX) {
    return throwAppError(
      'JULES_INVALID_INPUT',
      `branch pattern must be 1-${BRANCH_PATTERN_MAX} characters`
    );
  }
  const star = input.indexOf('*');
  if (star === -1) return validateRef(input);
  if (star !== input.length - 1 || input.indexOf('*', star + 1) !== -1) {
    return throwAppError(
      'JULES_INVALID_INPUT',
      'branch pattern allows a single trailing "*" only'
    );
  }
  const prefix = input.slice(0, -1);
  if (prefix.length === 0) {
    return throwAppError(
      'JULES_INVALID_INPUT',
      'branch pattern "*" alone matches every branch and is refused'
    );
  }
  // The prefix must itself be a valid ref head; a trailing "/" is allowed
  // here ("feat/*") although validateRef refuses it on a complete ref.
  validateRef(prefix.endsWith('/') ? `${prefix}x` : prefix);
  return input;
}

/** True when `branch` is covered by the validated `pattern`. */
export function branchMatchesPattern(pattern: string, branch: string): boolean {
  if (!pattern.endsWith('*')) return pattern === branch;
  return branch.startsWith(pattern.slice(0, -1));
}

/** `create,reply,approve,collect` subset: non-empty, known, no duplicates. */
export function validateOperations(input: string): GrantOperation[] {
  const parts = input.split(',');
  const seen = new Set<string>();
  const out: GrantOperation[] = [];
  for (const raw of parts) {
    const part = raw.trim();
    const op = GRANT_OPERATIONS.find((candidate) => candidate === part);
    if (op === undefined) {
      return throwAppError(
        'JULES_INVALID_INPUT',
        `operations must be a comma-separated subset of ${GRANT_OPERATIONS.join(', ')}`
      );
    }
    if (seen.has(op)) {
      return throwAppError(
        'JULES_INVALID_INPUT',
        `operation ${op} is listed more than once`
      );
    }
    seen.add(op);
    out.push(op);
  }
  return out;
}

export function validateControllerId(input: string): string {
  if (!CONTROLLER_ID_RE.test(input) || PROTOTYPE_KEYS.has(input)) {
    return throwAppError(
      'JULES_INVALID_INPUT',
      'controller id must be 1-63 characters of [A-Za-z0-9._-] starting with an alphanumeric'
    );
  }
  return input;
}

const OWNER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._@-]{0,63}$/;

/** `--owner`: a display label for the grant summary; bounded and printable. */
export function validateOwnerLabel(input: string): string {
  if (!OWNER_NAME_RE.test(input)) {
    return throwAppError(
      'JULES_INVALID_INPUT',
      'owner must be 1-64 characters of [A-Za-z0-9 ._@-] starting with an alphanumeric'
    );
  }
  return input;
}
