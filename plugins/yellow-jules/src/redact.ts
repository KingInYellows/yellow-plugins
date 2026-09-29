/**
 * Centralized redaction (contract "Redaction" layers 1-8). Applied to every
 * stdout/stderr write (cli.ts) and every state-file write (state.ts) — no
 * other module should print or persist a value without passing it through
 * here first. A deliberate copy of plugins/yellow-cursor/src/redact.ts (an
 * installed plugin cannot import across plugins); `scripts/validate-jules.js`
 * drift-checks the `replica:` units against the original.
 *
 * Layered: an exact match on the live JULES_API_KEY value (zero false
 * positives), plus structural patterns for the shapes secrets travel in
 * (Authorization / X-Goog-Api-Key headers, api-key fields and query values,
 * Bearer tokens, common key prefixes including Google's `AIza`). Deliberately
 * does NOT do a blanket "long opaque string" match — that would also redact
 * legitimate session and activity ids the CLI must echo.
 */

const REDACTED = '***REDACTED***';

const AUTHORIZATION_HEADER_RE = /authorization\s*:\s*(?:bearer\s+)?\S+/gi;
const BEARER_TOKEN_RE = /\bBearer\s+\S+/gi;
const GOOG_API_KEY_HEADER_RE = /x-goog-api-key\s*:\s*\S+/gi;
const KEY_FIELD_RE =
  /(["']?(?:api[_-]?key|apikey)["']?\s*[:=]\s*["']?)([^"'\s,}&]+)/gi;
const PREFIXED_SECRET_RE = /\b(?:sk|pk|key|tok)[-_][A-Za-z0-9]{16,}\b/gi;
const GOOGLE_API_KEY_RE = /\bAIza[A-Za-z0-9_-]{16,}/g;

function liveApiKeyPatterns(): string[] {
  const value = process.env['JULES_API_KEY'];
  return value && value.length > 0 ? [value] : [];
}

export function redact(input: string): string {
  let out = input;
  for (const secret of liveApiKeyPatterns()) {
    out = out.split(secret).join(REDACTED);
  }
  out = out.replace(AUTHORIZATION_HEADER_RE, `authorization: ${REDACTED}`);
  out = out.replace(BEARER_TOKEN_RE, `Bearer ${REDACTED}`);
  out = out.replace(GOOG_API_KEY_HEADER_RE, `X-Goog-Api-Key: ${REDACTED}`);
  out = out.replace(
    KEY_FIELD_RE,
    (_match, prefix: string) => `${prefix}${REDACTED}`
  );
  out = out.replace(PREFIXED_SECRET_RE, REDACTED);
  out = out.replace(GOOGLE_API_KEY_RE, REDACTED);
  return out;
}

function looksSecretShaped(value: string): boolean {
  if (liveApiKeyPatterns().includes(value)) return true;
  // Already-redacted text (e.g. "Bearer ***REDACTED***") is safe to persist.
  if (value.includes(REDACTED)) return false;
  if (/^Bearer\s+\S+$/i.test(value)) return true;
  if (/^(?:sk|pk|key|tok)[-_][A-Za-z0-9]{16,}$/i.test(value)) return true;
  if (/^AIza[A-Za-z0-9_-]{16,}$/.test(value)) return true;
  return false;
}

const SECRET_FIELD_NAMES = new Set([
  'apikey',
  'api_key',
  'token',
  'authorization',
  'secret',
  'password',
  'prompt',
]);

// replica:assertNoSecretShapedValues:start
/**
 * Recursively walks a plain JSON-like value and throws if any field name is
 * a known secret-shaped key, or any string value looks secret-shaped.
 * `prompt` is included on purpose — state records may only ever carry a
 * promptDigest, never the raw prompt text.
 */
export function assertNoSecretShapedValues(value: unknown, path = '$'): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (looksSecretShaped(value)) {
      throw new Error(`refusing to persist secret-shaped value at ${path}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoSecretShapedValues(item, `${path}[${index}]`)
    );
    return;
  }
  if (typeof value === 'object') {
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>
    )) {
      if (SECRET_FIELD_NAMES.has(key.toLowerCase())) {
        throw new Error(
          `refusing to persist secret-shaped field "${key}" at ${path}`
        );
      }
      assertNoSecretShapedValues(nested, `${path}.${key}`);
    }
  }
}
// replica:assertNoSecretShapedValues:end

// replica:redactDeep:start
/** Deep-redacts string leaves in a JSON-like value before it is printed. */
export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') {
    return redact(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>
    )) {
      out[key] = redactDeep(nested);
    }
    return out as unknown as T;
  }
  return value;
}
// replica:redactDeep:end

export const MAX_VENDOR_ERROR_BYTES = 512;

/**
 * Layer 6: vendor error text (JulesApiError.message embeds the response
 * body) is redacted first, then cut to `maxBytes` of UTF-8 without splitting
 * a multi-byte character.
 */
export function truncateRedacted(
  text: string,
  maxBytes: number = MAX_VENDOR_ERROR_BYTES
): string {
  const redacted = redact(text);
  const bytes = Buffer.from(redacted, 'utf8');
  if (bytes.length <= maxBytes) return redacted;
  let end = maxBytes;
  // Step back over UTF-8 continuation bytes (10xxxxxx) so the cut lands on a character boundary.
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return `${bytes.subarray(0, end).toString('utf8')}…[truncated]`;
}

/**
 * Layer 8: staged artifacts are written byte-exact (redaction would break the
 * sha256 and the apply), so they are scanned with layers 1-4 instead and the
 * hit is surfaced as `secretShapedContent: true`.
 */
export function scanSecretShapes(content: Buffer | string): boolean {
  const text = typeof content === 'string' ? content : content.toString('utf8');
  for (const secret of liveApiKeyPatterns()) {
    if (text.includes(secret)) return true;
  }
  return [
    /authorization\s*:\s*(?:bearer\s+)?\S+/i,
    /\bBearer\s+\S+/i,
    /x-goog-api-key\s*:\s*\S+/i,
    /["']?(?:api[_-]?key|apikey)["']?\s*[:=]\s*["']?[^"'\s,}&]+/i,
    /\b(?:sk|pk|key|tok)[-_][A-Za-z0-9]{16,}\b/i,
    /\bAIza[A-Za-z0-9_-]{16,}/,
  ].some((re) => re.test(text));
}

export const FENCE_BEGIN = '--- begin untrusted-content (reference only) ---';
export const FENCE_END = '--- end untrusted-content ---';

/**
 * Layer 7: wrap vendor-writable text in the untrusted-content fence after
 * neutralizing anything that could close it early. Per
 * docs/solutions/security-issues/sandwich-fence-delimiter-forgery.md, XML
 * escaping does not help against dash fences: strip CR, replace any line
 * shaped like a `--- … ---` delimiter, and replace inline copies of this
 * fence's own begin/end markers.
 */
export function fenceUntrusted(text: string): string {
  const neutralized = redact(text)
    .replace(/\r/g, '')
    .replace(
      /--- *begin untrusted-content/gi,
      '[fenced: begin untrusted-content]'
    )
    .replace(
      /--- *end untrusted-content *---/gi,
      '[fenced: end untrusted-content]'
    )
    .split('\n')
    .map((line) =>
      /^\s*---.*---\s*$/.test(line) ? '[fenced: redacted]' : line
    )
    .join('\n');
  return `${FENCE_BEGIN}\n${neutralized}\n${FENCE_END}`;
}
