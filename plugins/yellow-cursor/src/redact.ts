/**
 * Centralized redaction. Applied to every stdout/stderr write (cli.ts) and
 * every state-file write (state.ts) — no other module should print or
 * persist a value without passing it through here first.
 *
 * The SDK does not document the CURSOR_API_KEY token format, so this can't
 * rely on a single known shape. Layered instead: an exact-match on the live
 * env value (zero false positives, catches whatever the real secret is),
 * plus structural patterns for the shapes secrets are known to travel in
 * (api-key fields, Authorization headers, Bearer tokens, common key
 * prefixes). Deliberately does NOT do a blanket "long opaque string" match —
 * that would also redact legitimate agentId/runId values the CLI must echo.
 */

const REDACTED = '***REDACTED***';

const AUTHORIZATION_HEADER_RE = /authorization\s*:\s*(?:bearer\s+)?\S+/gi;
const BEARER_TOKEN_RE = /\bBearer\s+\S+/gi;
const KEY_FIELD_RE =
  /(["']?(?:api[_-]?key|apikey)["']?\s*[:=]\s*["']?)([^"'\s,}]+)/gi;
const PREFIXED_SECRET_RE = /\b(?:sk|pk|key|tok|cursor)[-_][A-Za-z0-9]{16,}\b/gi;

function liveApiKeyPatterns(): string[] {
  const value = process.env['CURSOR_API_KEY'];
  return value && value.length > 0 ? [value] : [];
}

export function redact(input: string): string {
  let out = input;
  for (const secret of liveApiKeyPatterns()) {
    out = out.split(secret).join(REDACTED);
  }
  out = out.replace(AUTHORIZATION_HEADER_RE, `authorization: ${REDACTED}`);
  out = out.replace(BEARER_TOKEN_RE, `Bearer ${REDACTED}`);
  out = out.replace(
    KEY_FIELD_RE,
    (_match, prefix: string) => `${prefix}${REDACTED}`
  );
  out = out.replace(PREFIXED_SECRET_RE, REDACTED);
  return out;
}

function looksSecretShaped(value: string): boolean {
  if (liveApiKeyPatterns().includes(value)) return true;
  if (/^Bearer\s+\S+$/i.test(value)) return true;
  if (/^(?:sk|pk|key|tok|cursor)[-_][A-Za-z0-9]{16,}$/i.test(value))
    return true;
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
