/**
 * Loopback-only fake of the Jules v1alpha REST surface: the productized form
 * of docs/yellow-jules/sdk-investigation.md Appendix A, with that appendix's
 * hardening list applied:
 * - binds 127.0.0.1 port 0 only and refuses any other host;
 * - every route checks its method;
 * - headers are logged by allowlist (content-type, content-length,
 *   user-agent); the API key is recorded as presence only — never its value
 *   or length — and any other header as its name only;
 * - the request log is in memory (no file, nothing to follow or append to)
 *   and is reset per scenario;
 * - bodies are capped (413 over the limit), a `prompt` is logged as a
 *   digest, and an unparseable JSON body is answered 400, never routed;
 * - counters are kept as it goes rather than recomputed per call.
 *
 * Response bodies are ILLUSTRATIVE shapes derived from the SDK's types.d.ts
 * (source-inspected). A passing test against this server proves request
 * shape, count, and side effects — not vendor response compatibility
 * (docs/solutions/code-quality/golden-fixture-parity-vs-contract-correctness.md).
 */

import * as crypto from 'node:crypto';
import * as http from 'node:http';
import * as https from 'node:https';
import type { AddressInfo, Socket } from 'node:net';

export const API_PREFIX = '/v1alpha';
const MAX_BODY_BYTES = 1024 * 1024;
const LOGGED_HEADERS = new Set([
  'content-type',
  'content-length',
  'user-agent',
]);

export interface LoggedRequest {
  readonly seq: number;
  readonly method: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly apiKeyPresent: boolean;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

export interface ScriptedResponse {
  readonly status?: number;
  readonly body?: unknown;
  /** Raw body text, e.g. invalid JSON for a "2xx that does not parse" fixture. */
  readonly rawBody?: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Accept the request, then destroy the socket without answering ("lost 2xx"). */
  readonly lost?: true;
}

/** Return a response to override the default route, or undefined to fall through. */
export type Override = (req: LoggedRequest) => ScriptedResponse | undefined;

export interface FakeSource {
  readonly owner: string;
  readonly repo: string;
}

export interface FakeState {
  sources: FakeSource[];
  /** REST-shaped sessions keyed by id. */
  sessions: Map<string, Record<string, unknown>>;
  /** REST-shaped activities per session id, served in pages by `pageSize` with tokens `t<offset>`. */
  activities: Map<string, Array<Record<string, unknown>>>;
  /** Answer 400 to any activities request carrying `filter`. */
  rejectFilteredActivities: boolean;
  /** Tried in order before the default routes. */
  overrides: Override[];
}

export function freshState(): FakeState {
  return {
    sources: [{ owner: 'octo', repo: 'repo' }],
    sessions: new Map(),
    activities: new Map(),
    rejectFilteredActivities: false,
    overrides: [],
  };
}

export function restSource(s: FakeSource): Record<string, unknown> {
  return {
    name: `sources/github/${s.owner}/${s.repo}`,
    id: `github/${s.owner}/${s.repo}`,
    githubRepo: {
      owner: s.owner,
      repo: s.repo,
      isPrivate: false,
      defaultBranch: { displayName: 'main' },
      branches: [{ displayName: 'main' }],
    },
  };
}

export function restSession(
  id: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    name: `sessions/${id}`,
    id,
    prompt: 'p',
    title: 't',
    sourceContext: {
      source: 'sources/github/octo/repo',
      githubRepoContext: { startingBranch: 'main' },
    },
    state: 'IN_PROGRESS',
    createTime: '2026-09-10T00:00:00Z',
    updateTime: '2026-09-10T00:00:00Z',
    url: `https://jules.google.com/session/${id}`,
    outputs: [],
    ...overrides,
  };
}

export function restActivity(
  sessionId: string,
  id: string,
  createTime: string,
  extra: Record<string, unknown> = {
    progressUpdated: { title: 'Working', description: 'd' },
  }
): Record<string, unknown> {
  return {
    name: `sessions/${sessionId}/activities/${id}`,
    createTime,
    originator: 'agent',
    artifacts: [],
    ...extra,
  };
}

function page<T>(
  all: readonly T[],
  query: Readonly<Record<string, string>>,
  fallbackSize: number
): { items: T[]; nextPageToken: string | undefined } {
  const size = Number(query['pageSize'] ?? fallbackSize) || fallbackSize;
  const token = query['pageToken'];
  const offset =
    token !== undefined && /^t\d+$/.test(token) ? Number(token.slice(1)) : 0;
  const items = all.slice(offset, offset + size);
  const next = offset + size;
  return { items, nextPageToken: next < all.length ? `t${next}` : undefined };
}

export class FakeJulesServer {
  readonly log: LoggedRequest[] = [];
  state: FakeState = freshState();
  private server: http.Server | https.Server | undefined;
  private readonly sockets = new Set<Socket>();
  private seq = 0;
  private counts = { post: 0, mutating: 0 };

  constructor(private readonly tls?: { key: string; cert: string }) {}

  /** Starts on 127.0.0.1:0. `host` exists only so the refusal can be tested. */
  async start(
    host = '127.0.0.1'
  ): Promise<{ origin: string; baseUrl: string }> {
    if (host !== '127.0.0.1')
      throw new Error(`refusing to bind to ${host}; loopback only`);
    const handler = (
      req: http.IncomingMessage,
      res: http.ServerResponse
    ): void => this.handle(req, res);
    this.server = this.tls
      ? https.createServer({ key: this.tls.key, cert: this.tls.cert }, handler)
      : http.createServer(handler);
    this.server.on('connection', (socket: Socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
    await new Promise<void>((resolve) =>
      this.server!.listen(0, '127.0.0.1', resolve)
    );
    const { port } = this.server.address() as AddressInfo;
    const origin = `${this.tls ? 'https' : 'http'}://127.0.0.1:${port}`;
    return { origin, baseUrl: `${origin}${API_PREFIX}` };
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve()
    );
  }

  /** Clears the log, counters, and state between scenarios. */
  reset(): void {
    this.log.length = 0;
    this.seq = 0;
    this.counts = { post: 0, mutating: 0 };
    this.state = freshState();
  }

  get postCount(): number {
    return this.counts.post;
  }

  /** POST, PATCH, PUT, and DELETE requests seen (the R52 negative test's counter). */
  get mutatingCount(): number {
    return this.counts.mutating;
  }

  paths(): string[] {
    return this.log.map((r) => `${r.method} ${r.path}`);
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) tooLarge = true;
      else chunks.push(chunk);
    });
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const method = req.method ?? 'GET';
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(req.headers)) {
        if (
          name === 'x-goog-api-key' ||
          name === 'host' ||
          name === 'connection'
        )
          continue;
        headers[name] = LOGGED_HEADERS.has(name) ? String(value) : '<present>';
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: unknown;
      let parseFailed = false;
      if (raw !== '') {
        try {
          body = JSON.parse(raw);
        } catch {
          parseFailed = true;
        }
      }
      if (
        body !== null &&
        typeof body === 'object' &&
        typeof (body as Record<string, unknown>)['prompt'] === 'string'
      ) {
        const { prompt, ...rest } = body as Record<string, unknown>;
        body = {
          ...rest,
          promptDigest: crypto
            .createHash('sha256')
            .update(String(prompt))
            .digest('hex'),
        };
      }
      const entry: LoggedRequest = {
        seq: ++this.seq,
        method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        apiKeyPresent: req.headers['x-goog-api-key'] !== undefined,
        headers,
        ...(body !== undefined ? { body } : {}),
      };
      this.log.push(entry);
      if (method === 'POST') this.counts.post += 1;
      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method))
        this.counts.mutating += 1;

      if (tooLarge)
        return this.send(res, {
          status: 413,
          body: { error: { code: 413, message: 'too large' } },
        });
      if (parseFailed)
        return this.send(res, {
          status: 400,
          body: { error: { code: 400, message: 'invalid JSON' } },
        });
      for (const override of this.state.overrides) {
        const scripted = override(entry);
        if (scripted !== undefined) return this.send(res, scripted);
      }
      this.send(res, this.route(entry));
    });
  }

  private send(res: http.ServerResponse, r: ScriptedResponse): void {
    if (r.lost === true) {
      res.socket?.destroy();
      return;
    }
    res.writeHead(r.status ?? 200, {
      'content-type': 'application/json',
      ...(r.headers ?? {}),
    });
    res.end(r.rawBody ?? (r.body === undefined ? '' : JSON.stringify(r.body)));
  }

  private route(req: LoggedRequest): ScriptedResponse {
    const p = req.path.startsWith(API_PREFIX)
      ? req.path.slice(API_PREFIX.length)
      : undefined;
    const notFound = (what: string): ScriptedResponse => ({
      status: 404,
      body: { error: { code: 404, message: `${what} not found` } },
    });
    if (p === undefined) return notFound('path');
    let m: RegExpMatchArray | null;

    if (req.method === 'GET' && p === '/sources') {
      const { items, nextPageToken } = page(this.state.sources, req.query, 100);
      return {
        body: {
          sources: items.map(restSource),
          ...(nextPageToken ? { nextPageToken } : {}),
        },
      };
    }
    if (
      req.method === 'GET' &&
      (m = p.match(/^\/sources\/github\/([^/]+)\/([^/]+)$/))
    ) {
      const found = this.state.sources.find(
        (s) => s.owner === m![1] && s.repo === m![2]
      );
      return found ? { body: restSource(found) } : notFound('source');
    }
    if (req.method === 'GET' && p === '/sessions') {
      const { items, nextPageToken } = page(
        [...this.state.sessions.values()],
        req.query,
        30
      );
      return {
        body: { sessions: items, ...(nextPageToken ? { nextPageToken } : {}) },
      };
    }
    if (req.method === 'POST' && p === '/sessions') {
      const id = String(4242424242 + this.state.sessions.size);
      const b = (req.body ?? {}) as Record<string, unknown>;
      const created = restSession(id, {
        title: b['title'] ?? 't',
        state: 'QUEUED',
        requirePlanApproval: b['requirePlanApproval'],
        automationMode: b['automationMode'],
        ...(b['sourceContext'] !== undefined
          ? { sourceContext: b['sourceContext'] }
          : {}),
      });
      this.state.sessions.set(id, created);
      return { body: created };
    }
    if (
      req.method === 'GET' &&
      (m = p.match(/^\/sessions\/([^/:]+)\/activities$/))
    ) {
      if (
        this.state.rejectFilteredActivities &&
        req.query['filter'] !== undefined
      ) {
        return {
          status: 400,
          body: { error: { code: 400, message: 'unsupported filter' } },
        };
      }
      const all = this.state.activities.get(m[1]!) ?? [];
      const { items, nextPageToken } = page(all, req.query, 50);
      return {
        body: {
          activities: items,
          ...(nextPageToken ? { nextPageToken } : {}),
        },
      };
    }
    if (req.method === 'GET' && (m = p.match(/^\/sessions\/([^/:]+)$/))) {
      const found = this.state.sessions.get(m[1]!);
      return found ? { body: found } : notFound('session');
    }
    if (
      req.method === 'POST' &&
      (m = p.match(/^\/sessions\/([^/:]+):(sendMessage|approvePlan)$/))
    ) {
      return this.state.sessions.has(m[1]!)
        ? { body: {} }
        : notFound('session');
    }
    return notFound('route');
  }
}
