"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.GRANT_OPERATIONS = exports.GRANT_ID_RE = void 0;
exports.validateRef = validateRef;
exports.validateIdempotencyKey = validateIdempotencyKey;
exports.validateRequestId = validateRequestId;
exports.validateTaskRef = validateTaskRef;
exports.validateSessionId = validateSessionId;
exports.validateSessionResource = validateSessionResource;
exports.sessionIdOf = sessionIdOf;
exports.validateActivityId = validateActivityId;
exports.validateActivityResource = validateActivityResource;
exports.validatePlanId = validatePlanId;
exports.validateSourceResource = validateSourceResource;
exports.repoOfSourceResource = repoOfSourceResource;
exports.validateRepoInput = validateRepoInput;
exports.sourceResourceFor = sourceResourceFor;
exports.validateBaseCommitId = validateBaseCommitId;
exports.validatePullRequestUrl = validatePullRequestUrl;
exports.validateSessionDisplayUrl = validateSessionDisplayUrl;
exports.isValidPageToken = isValidPageToken;
exports.validatePageToken = validatePageToken;
exports.validateLocalId = validateLocalId;
exports.mintLocalId = mintLocalId;
exports.extractTitleTag = extractTitleTag;
exports.parseSessionRef = parseSessionRef;
exports.validatePositiveInt = validatePositiveInt;
exports.validateGrantId = validateGrantId;
exports.mintGrantId = mintGrantId;
exports.validateBranchPattern = validateBranchPattern;
exports.branchMatchesPattern = branchMatchesPattern;
exports.validateOperations = validateOperations;
exports.validateControllerId = validateControllerId;
exports.validateOwnerLabel = validateOwnerLabel;
const crypto = __importStar(require("node:crypto"));
const errors_js_1 = require("./errors.js");
function codeFor(origin) {
    return origin === 'input'
        ? 'JULES_INVALID_INPUT'
        : 'JULES_MALFORMED_RESPONSE';
}
function checkPattern(value, pattern, label, origin) {
    if (typeof value !== 'string' || !pattern.test(value)) {
        return (0, errors_js_1.throwAppError)(codeFor(origin), `${label} has an unexpected shape`);
    }
    return value;
}
const REF_METACHAR_RE = /[\s~^:?*[\\`;|&$()<>'"\r\n]/;
// replica:validateRef:start
function validateRef(input) {
    if (input.length === 0 || input.length > 255) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', 'ref must be 1-255 characters');
    }
    if (input.startsWith('-')) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', 'ref must not start with a dash');
    }
    if (input.startsWith('/') || input.endsWith('/') || input.endsWith('.lock')) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', 'ref must not start/end with "/" or end with ".lock"');
    }
    if (input.includes('..') || input.includes('//')) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', 'ref must not contain ".." or "//"');
    }
    if (REF_METACHAR_RE.test(input)) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', 'ref contains whitespace or shell/git metacharacters');
    }
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(input)) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', 'ref contains control characters');
    }
    return input;
}
// replica:validateRef:end
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{1,200}$/;
// replica:validateIdempotencyKey:start
function validateIdempotencyKey(input) {
    if (!IDEMPOTENCY_KEY_RE.test(input)) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', 'idempotency key must be 1-200 characters of [A-Za-z0-9._:-]');
    }
    return input;
}
// replica:validateIdempotencyKey:end
const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
/** Local request id and `--task-ref`: journal and grant match keys, so prototype names are refused too. */
function validateRequestId(input, label = 'request id') {
    if (!IDEMPOTENCY_KEY_RE.test(input) || PROTOTYPE_KEYS.has(input)) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', `${label} must be 1-200 characters of [A-Za-z0-9._:-] and not a prototype key`);
    }
    return input;
}
function validateTaskRef(input) {
    return validateRequestId(input, 'task ref');
}
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const SESSION_RESOURCE_RE = /^sessions\/([A-Za-z0-9_-]{1,128})$/;
const ACTIVITY_RESOURCE_RE = /^sessions\/[A-Za-z0-9_-]{1,128}\/activities\/([A-Za-z0-9_-]{1,128})$/;
const OWNER_PART = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})';
const REPO_PART = '(?!\\.{1,2}$)[A-Za-z0-9_.-]{1,100}';
const REPO_INPUT_RE = new RegExp(`^(${OWNER_PART})/(${REPO_PART})$`);
const SOURCE_RESOURCE_RE = new RegExp(`^sources/github/(${OWNER_PART})/(${REPO_PART})$`);
const BASE_COMMIT_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const PAGE_TOKEN_RE = /^(?!\.{1,2}$)[A-Za-z0-9_.=-]{1,512}$/;
const LOCAL_ID_RE = /^jl-[0-9a-f]{32}$/;
const TITLE_TAG_RE = /^\[yellow:(jl-[0-9a-f]{32})\](?: |$)/;
function validateSessionId(value, origin = 'input') {
    return checkPattern(value, ID_RE, 'session id', origin);
}
function validateSessionResource(value, origin = 'input') {
    return checkPattern(value, SESSION_RESOURCE_RE, 'session resource', origin);
}
/** `sessions/{id}` -> `{id}`; the resource must already be valid. */
function sessionIdOf(resource) {
    const match = SESSION_RESOURCE_RE.exec(resource);
    if (!match || match[1] === undefined) {
        return (0, errors_js_1.throwAppError)('JULES_MALFORMED_RESPONSE', 'session resource has an unexpected shape');
    }
    return match[1];
}
function validateActivityId(value, origin = 'response') {
    return checkPattern(value, ID_RE, 'activity id', origin);
}
function validateActivityResource(value, origin = 'response') {
    return checkPattern(value, ACTIVITY_RESOURCE_RE, 'activity resource', origin);
}
/** Plan ids and plan-step ids share the pattern. */
function validatePlanId(value, origin = 'response') {
    return checkPattern(value, ID_RE, 'plan id', origin);
}
function validateSourceResource(value, origin = 'response') {
    return checkPattern(value, SOURCE_RESOURCE_RE, 'source resource', origin);
}
function repoOfSourceResource(resource) {
    const match = SOURCE_RESOURCE_RE.exec(resource);
    if (!match || match[1] === undefined || match[2] === undefined) {
        return (0, errors_js_1.throwAppError)('JULES_MALFORMED_RESPONSE', 'source resource has an unexpected shape');
    }
    return { owner: match[1], repo: match[2] };
}
/** `--repo owner/repo` (GitHub owner and repo rules; `.github` stays valid, `.`/`..` never). */
function validateRepoInput(input) {
    const match = REPO_INPUT_RE.exec(input);
    if (!match || match[1] === undefined || match[2] === undefined) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', 'repository must be <owner>/<repo>');
    }
    return { owner: match[1], repo: match[2] };
}
function sourceResourceFor(ref) {
    return `sources/github/${ref.owner}/${ref.repo}`;
}
/** Reaches git argv in PR4, so exactly a full sha1 or sha256 hex object id. */
function validateBaseCommitId(value, origin = 'response') {
    return checkPattern(value, BASE_COMMIT_RE, 'base commit id', origin);
}
/**
 * Parse-then-compare, never a templated regex: an https github.com URL whose
 * owner and repo segments strict-equal the session's validated source, then
 * `/pull/<n>`. Any other value is a policy deviation, never a rendered link.
 */
function validatePullRequestUrl(value, sourceResource) {
    if (typeof value !== 'string')
        return { valid: false, reason: 'not a string' };
    let url;
    try {
        url = new URL(value);
    }
    catch {
        return { valid: false, reason: 'not a URL' };
    }
    if (url.protocol !== 'https:')
        return { valid: false, reason: 'not https' };
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
function validateSessionDisplayUrl(value) {
    if (typeof value !== 'string')
        return undefined;
    try {
        return new URL(value).protocol === 'https:' ? value : undefined;
    }
    catch {
        return undefined;
    }
}
function isValidPageToken(value) {
    return typeof value === 'string' && PAGE_TOKEN_RE.test(value);
}
/** Page and resume tokens: query parameter only, never a path. */
function validatePageToken(value, origin = 'input') {
    return checkPattern(value, PAGE_TOKEN_RE, 'page token', origin);
}
function validateLocalId(value, origin = 'input') {
    return checkPattern(value, LOCAL_ID_RE, 'local id', origin);
}
/** `jl-` + 16 random bytes hex: the only id ever used in a filesystem path (R40). */
function mintLocalId() {
    return `jl-${crypto.randomBytes(16).toString('hex')}`;
}
/** Anchored extraction of the `[yellow:<local-id>]` reconcile tag; the tag is stripped for display. */
function extractTitleTag(title) {
    const match = TITLE_TAG_RE.exec(title);
    if (!match || match[1] === undefined)
        return { title };
    return { localId: match[1], title: title.slice(match[0].length) };
}
/** `--session` accepts a local id or a vendor `sessions/{id}` resource. */
function parseSessionRef(input) {
    if (LOCAL_ID_RE.test(input))
        return { kind: 'local', localId: input };
    if (SESSION_RESOURCE_RE.test(input))
        return { kind: 'resource', sessionResource: input };
    return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', '--session must be a local id (jl-<32 hex>) or sessions/<id>');
}
function validatePositiveInt(value, label, min, max) {
    if (!/^[0-9]{1,9}$/.test(value)) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', `${label} must be an integer`);
    }
    const parsed = Number(value);
    if (parsed < min || parsed > max) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', `${label} must be between ${min} and ${max}`);
    }
    return parsed;
}
exports.GRANT_ID_RE = /^jg-[0-9a-f]{32}$/;
const CONTROLLER_ID_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62})$/;
const BRANCH_PATTERN_MAX = 200;
exports.GRANT_OPERATIONS = [
    'create',
    'reply',
    'approve',
    'collect',
];
function validateGrantId(value, origin = 'input') {
    return checkPattern(value, exports.GRANT_ID_RE, 'grant id', origin);
}
/** `jg-` + 16 random bytes hex. */
function mintGrantId() {
    return `jg-${crypto.randomBytes(16).toString('hex')}`;
}
/**
 * An exact ref or a ref with a single trailing `*` glob, anchored and
 * length-bounded. The glob never appears mid-ref, so matching is a prefix
 * test and cannot be turned into an unbounded pattern.
 */
function validateBranchPattern(input) {
    if (input.length === 0 || input.length > BRANCH_PATTERN_MAX) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', `branch pattern must be 1-${BRANCH_PATTERN_MAX} characters`);
    }
    const star = input.indexOf('*');
    if (star === -1)
        return validateRef(input);
    if (star !== input.length - 1 || input.indexOf('*', star + 1) !== -1) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', 'branch pattern allows a single trailing "*" only');
    }
    const prefix = input.slice(0, -1);
    if (prefix.length === 0) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', 'branch pattern "*" alone matches every branch and is refused');
    }
    // The prefix must itself be a valid ref head; a trailing "/" is allowed
    // here ("feat/*") although validateRef refuses it on a complete ref.
    validateRef(prefix.endsWith('/') ? `${prefix}x` : prefix);
    return input;
}
/** True when `branch` is covered by the validated `pattern`. */
function branchMatchesPattern(pattern, branch) {
    if (!pattern.endsWith('*'))
        return pattern === branch;
    return branch.startsWith(pattern.slice(0, -1));
}
/** `create,reply,approve,collect` subset: non-empty, known, no duplicates. */
function validateOperations(input) {
    const parts = input.split(',');
    const seen = new Set();
    const out = [];
    for (const raw of parts) {
        const part = raw.trim();
        const op = exports.GRANT_OPERATIONS.find((candidate) => candidate === part);
        if (op === undefined) {
            return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', `operations must be a comma-separated subset of ${exports.GRANT_OPERATIONS.join(', ')}`);
        }
        if (seen.has(op)) {
            return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', `operation ${op} is listed more than once`);
        }
        seen.add(op);
        out.push(op);
    }
    return out;
}
function validateControllerId(input) {
    if (!CONTROLLER_ID_RE.test(input) || PROTOTYPE_KEYS.has(input)) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', 'controller id must be 1-63 characters of [A-Za-z0-9._-] starting with an alphanumeric');
    }
    return input;
}
const OWNER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._@-]{0,63}$/;
/** `--owner`: a display label for the grant summary; bounded and printable. */
function validateOwnerLabel(input) {
    if (!OWNER_NAME_RE.test(input)) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', 'owner must be 1-64 characters of [A-Za-z0-9 ._@-] starting with an alphanumeric');
    }
    return input;
}
