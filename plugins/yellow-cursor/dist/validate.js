"use strict";
/**
 * All input validation for the CLI. Every function either returns a
 * normalized value or throws AppErrorException(CURSOR_INVALID_INPUT) via
 * throwAppError — nothing here talks to the SDK or the network, which is
 * what keeps `delegate --dry-run` a zero-network operation.
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
exports.validateRepoUrl = validateRepoUrl;
exports.validateRef = validateRef;
exports.validateModelId = validateModelId;
exports.validateAgentId = validateAgentId;
exports.validateRunId = validateRunId;
exports.validateIdempotencyKey = validateIdempotencyKey;
exports.validatePrompt = validatePrompt;
exports.validateArtifactRemotePath = validateArtifactRemotePath;
exports.validateLocalOutPath = validateLocalOutPath;
exports.validateMaxActive = validateMaxActive;
exports.validateCursor = validateCursor;
const path = __importStar(require("node:path"));
const errors_js_1 = require("./errors.js");
const ALLOWED_REPO_HOSTS = new Set([
    'github.com',
    'gitlab.com',
    'dev.azure.com',
    'bitbucket.org',
]);
function validateRepoUrl(input) {
    let url;
    try {
        url = new URL(input);
    }
    catch {
        return (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', `Invalid repository URL: ${input}`);
    }
    if (url.protocol !== 'https:') {
        return (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', 'Repository URL must use https://');
    }
    if (url.username !== '' || url.password !== '') {
        return (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', 'Repository URL must not contain userinfo (user:pass@)');
    }
    if (url.hash !== '') {
        return (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', 'Repository URL must not contain a fragment');
    }
    if (!ALLOWED_REPO_HOSTS.has(url.hostname.toLowerCase())) {
        return (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', `Repository host "${url.hostname}" is not allowlisted (github.com, gitlab.com, dev.azure.com, bitbucket.org)`);
    }
    return url.toString();
}
const REF_METACHAR_RE = /[\s~^:?*[\\`;|&$()<>'"\r\n]/;
function validateRef(input) {
    if (input.length === 0 || input.length > 255) {
        return (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', 'ref must be 1-255 characters');
    }
    if (input.startsWith('-')) {
        return (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', 'ref must not start with a dash');
    }
    if (input.startsWith('/') || input.endsWith('/') || input.endsWith('.lock')) {
        return (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', 'ref must not start/end with "/" or end with ".lock"');
    }
    if (input.includes('..') || input.includes('//')) {
        return (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', 'ref must not contain ".." or "//"');
    }
    if (REF_METACHAR_RE.test(input)) {
        return (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', 'ref contains whitespace or shell/git metacharacters');
    }
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(input)) {
        return (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', 'ref contains control characters');
    }
    return input;
}
function validateModelId(input) {
    if (input === undefined)
        return undefined;
    if (input.length === 0 || input.length > 128) {
        return (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', 'model id must be 1-128 characters');
    }
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(input)) {
        return (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', 'model id contains control characters');
    }
    return input;
}
const AGENT_ID_RE = /^bc-[0-9a-f-]+$/i;
function validateAgentId(input) {
    if (input.length < 4 || input.length > 128) {
        return (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', 'agent id must be 4-128 characters');
    }
    if (!AGENT_ID_RE.test(input)) {
        return (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', 'agent id has an unexpected shape (expected bc-<hex/dashes>)');
    }
    return input;
}
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
function validateRunId(input) {
    if (!SAFE_ID_RE.test(input)) {
        return (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', 'run id must be 1-128 characters of [A-Za-z0-9_-]');
    }
    return input;
}
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{1,200}$/;
function validateIdempotencyKey(input) {
    if (!IDEMPOTENCY_KEY_RE.test(input)) {
        return (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', 'idempotency key must be 1-200 characters of [A-Za-z0-9._:-]');
    }
    return input;
}
const MAX_PROMPT_BYTES = 100 * 1024;
function validatePrompt(input) {
    if (input.length === 0) {
        return (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', 'prompt must not be empty');
    }
    // eslint-disable-next-line no-control-regex
    if (/\x00/.test(input)) {
        return (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', 'prompt must not contain NUL bytes');
    }
    if (Buffer.byteLength(input, 'utf8') > MAX_PROMPT_BYTES) {
        return (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', `prompt exceeds ${MAX_PROMPT_BYTES} byte cap`);
    }
    return input;
}
function validateArtifactRemotePath(input) {
    if (input.length === 0 || input.length > 4096) {
        return (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', 'artifact path must be 1-4096 characters');
    }
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(input)) {
        return (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', 'artifact path contains control characters');
    }
    if (path.isAbsolute(input)) {
        return (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', 'artifact path must be relative');
    }
    const segments = input.split('/');
    if (segments.some((segment) => segment === '..')) {
        return (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', 'artifact path must not contain ".." segments');
    }
    return input;
}
function validateLocalOutPath(input) {
    if (input.length === 0 || input.length > 4096) {
        return (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', 'output path must be 1-4096 characters');
    }
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(input)) {
        return (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', 'output path contains control characters');
    }
    return input;
}
function validateMaxActive(input) {
    if (!Number.isInteger(input) || input < 1 || input > 50) {
        return (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', 'max-active must be an integer between 1 and 50');
    }
    return input;
}
function validateCursor(input) {
    if (input === undefined)
        return undefined;
    if (input.length === 0 || input.length > 512) {
        return (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', 'cursor must be 1-512 characters');
    }
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f]/.test(input)) {
        return (0, errors_js_1.throwAppError)('CURSOR_INVALID_INPUT', 'cursor contains control characters');
    }
    return input;
}
