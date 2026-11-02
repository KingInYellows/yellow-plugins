"use strict";
/**
 * Redaction and fencing for everything agy wrote (contract-v0 "Run
 * lifecycle", collect). Ported from plugins/yellow-jules/src/redact.ts (an
 * installed plugin cannot import across plugins). agy runs on the owner's
 * OAuth sign-in, so there is no live API key to match; the structural layers
 * stay, because a delegate can still write a credential into its output.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HIDDEN_CHARS_RE = exports.FENCE_END = exports.FENCE_BEGIN = exports.MAX_ERROR_BYTES = void 0;
exports.redact = redact;
exports.truncateRedacted = truncateRedacted;
exports.scanSecretShapes = scanSecretShapes;
exports.fenceUntrusted = fenceUntrusted;
exports.fenceAltersText = fenceAltersText;
const REDACTED = '***REDACTED***';
// Any scheme (Bearer, Basic, Token, …): mask the scheme word and credential.
const AUTHORIZATION_HEADER_RE = /authorization[ \t]*:[ \t]*(?:[A-Za-z][\w.-]*[ \t]+)?[^\s"',;]+/gi;
const BEARER_TOKEN_RE = /\bBearer\s+\S+/gi;
const GOOG_API_KEY_HEADER_RE = /x-goog-api-key\s*:\s*\S+/gi;
const KEY_FIELD_RE = /(["']?(?:api[_-]?key|apikey)["']?\s*[:=]\s*["']?)([^"'\s,}&]+)/gi;
const PREFIXED_SECRET_RE = /\b(?:sk|pk|key|tok)[-_][A-Za-z0-9]{16,}\b/gi;
const GOOGLE_API_KEY_RE = /\bAIza[A-Za-z0-9_-]{16,}/g;
const OAUTH_TOKEN_RE = /\bya29\.[A-Za-z0-9_-]{20,}/g;
const PRIVATE_KEY_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
// The whole block; an unterminated one is masked to the end of the text.
const PRIVATE_KEY_BLOCK_RE = /-----BEGIN ([A-Z ]*)PRIVATE KEY-----[\s\S]*?(?:-----END \1PRIVATE KEY-----|$)/g;
function redact(input) {
    return input
        .replace(PRIVATE_KEY_BLOCK_RE, `-----BEGIN $1PRIVATE KEY----- ${REDACTED}`)
        .replace(AUTHORIZATION_HEADER_RE, `authorization: ${REDACTED}`)
        .replace(BEARER_TOKEN_RE, `Bearer ${REDACTED}`)
        .replace(GOOG_API_KEY_HEADER_RE, `X-Goog-Api-Key: ${REDACTED}`)
        .replace(KEY_FIELD_RE, (_match, prefix) => `${prefix}${REDACTED}`)
        .replace(PREFIXED_SECRET_RE, REDACTED)
        .replace(GOOGLE_API_KEY_RE, REDACTED)
        .replace(OAUTH_TOKEN_RE, REDACTED);
}
exports.MAX_ERROR_BYTES = 512;
/**
 * Error text is redacted first, then cut to `maxBytes` of UTF-8 without splitting
 * a multi-byte character.
 */
function truncateRedacted(text, maxBytes = exports.MAX_ERROR_BYTES) {
    const redacted = redact(text);
    const bytes = Buffer.from(redacted, 'utf8');
    if (bytes.length <= maxBytes)
        return redacted;
    let end = maxBytes;
    // Step back over UTF-8 continuation bytes (10xxxxxx) so the cut lands on a character boundary.
    while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80)
        end -= 1;
    return `${bytes.subarray(0, end).toString('utf8')}…[truncated]`;
}
/**
 * Patches are written byte-exact (redaction would break the apply), so they
 * are scanned instead and a hit is reported as `secretShapedContent: true`.
 */
function scanSecretShapes(content) {
    const text = typeof content === 'string' ? content : content.toString('utf8');
    return [
        new RegExp(AUTHORIZATION_HEADER_RE.source, 'i'),
        /\bBearer\s+\S+/i,
        /x-goog-api-key\s*:\s*\S+/i,
        /["']?(?:api[_-]?key|apikey)["']?\s*[:=]\s*["']?[^"'\s,}&]+/i,
        /\b(?:sk|pk|key|tok)[-_][A-Za-z0-9]{16,}\b/i,
        /\bAIza[A-Za-z0-9_-]{16,}/,
        /\bya29\.[A-Za-z0-9_-]{20,}/,
        PRIVATE_KEY_RE,
    ].some((re) => re.test(text));
}
exports.FENCE_BEGIN = '--- begin untrusted-content (reference only) ---';
exports.FENCE_END = '--- end untrusted-content ---';
/**
 * Wrap agy-written text in the untrusted-content fence after
 * neutralizing anything that could close it early. Per
 * docs/solutions/security-issues/sandwich-fence-delimiter-forgery.md, XML
 * escaping does not help against dash fences: strip CR, replace any line
 * shaped like a `--- … ---` delimiter, and replace inline copies of this
 * fence's own begin/end markers.
 */
function fenceUntrusted(text) {
    const neutralized = redact(text)
        .replace(/\r/g, '')
        .replace(/--- *begin untrusted-content/gi, '[fenced: begin untrusted-content]')
        .replace(/--- *end untrusted-content *---/gi, '[fenced: end untrusted-content]')
        .split('\n')
        .map((line) => /^\s*---.*---\s*$/.test(line) ? '[fenced: redacted]' : line)
        .join('\n');
    return `${exports.FENCE_BEGIN}\n${neutralized}\n${exports.FENCE_END}`;
}
/**
 * True when `fenceUntrusted` shows something other than `text` (redaction,
 * a rewritten delimiter or a `--- … ---` line; stripped carriage returns do not
 * count). A digest bound to `text` must not be offered for such text, because
 * the reviewer saw the rewritten version.
 */
function fenceAltersText(text) {
    const fenced = fenceUntrusted(text);
    const body = fenced.slice(exports.FENCE_BEGIN.length + 1, fenced.length - exports.FENCE_END.length - 1);
    return body !== text.replace(/\r/g, '');
}
/**
 * The hidden-character class the plan and outgoing-message previews reject
 * (the same class as yellow-jules' `HIDDEN=` test): controls other than tab,
 * LF and CR, C1 controls, soft hyphen, bidi and zero-width characters, and tag
 * characters.
 */
// The class is the point: it must name control and combining characters.
exports.HIDDEN_CHARS_RE = 
// eslint-disable-next-line no-control-regex, no-misleading-character-class
/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u034f\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\u{e0000}-\u{e007f}]/u;
