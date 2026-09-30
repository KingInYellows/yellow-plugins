/**
 * The only path to a loopback `baseUrl` (contract "Transport verdict").
 *
 * Called only by tests: `tests/support/loopback-preload.cjs` (loaded with
 * `node --require` before the CLI's main runs) or in-process suites. The
 * runtime never reads a base URL from config, env, or argv, so a production
 * invocation always talks to the pinned vendor origin.
 */

export interface TestTransport {
  /** `http(s)://127.0.0.1:<port>[/path]`, e.g. `http://127.0.0.1:4321/v1alpha`. */
  readonly baseUrl: string;
  /** Origins the fetch guard admits; defaults to the baseUrl origin. */
  readonly allowedOrigins: readonly string[];
}

let transport: TestTransport | undefined;

function assertLoopback(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`test seam: ${label} is not a URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`test seam: ${label} must be http(s)`);
  }
  if (url.hostname !== '127.0.0.1' || url.port === '') {
    throw new Error(
      `test seam: ${label} must be 127.0.0.1 with an explicit port`
    );
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error(`test seam: ${label} must not carry userinfo`);
  }
  return url;
}

export function __setTestTransport(next: {
  baseUrl: string;
  allowedOrigins?: readonly string[];
}): void {
  const base = assertLoopback(next.baseUrl, 'baseUrl');
  const allowedOrigins = next.allowedOrigins ?? [base.origin];
  for (const origin of allowedOrigins) assertLoopback(origin, 'allowed origin');
  transport = { baseUrl: next.baseUrl, allowedOrigins };
}

export function __clearTestTransport(): void {
  transport = undefined;
}

export function getTestTransport(): TestTransport | undefined {
  return transport;
}
