/**
 * Deterministic, network-free test double for SdkAdapter. Every behavior is
 * an overridable async field with a working default over in-memory
 * sessions, activities, and sources, so a test scripts exactly the scenario
 * it needs by reassigning one field. Every call is recorded.
 */

import { AdapterError } from '../src/errors.js';
import type { RuntimeDeps } from '../src/runtime.js';
import type {
  ActivityPage,
  AdapterActivity,
  AdapterSession,
  AdapterSource,
  Clock,
  PageOptions,
  SdkAdapter,
  SessionPage,
  SourcePage,
} from '../src/types.js';

export interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

export function makeSession(
  overrides: Partial<AdapterSession> = {}
): AdapterSession {
  return {
    sessionResource: 'sessions/s1',
    vendorState: 'inProgress',
    title: 'Fix the flaky test',
    createTime: '2026-09-01T00:00:00Z',
    sourceResource: 'sources/github/acme/widgets',
    startingBranch: 'main',
    outputs: [],
    generatedFiles: [],
    archived: false,
    ...overrides,
  };
}

let activitySeq = 0;

/** Activities one second apart from a base time, ids `a0001`, `a0002`, ... */
export function makeActivities(
  count: number,
  overrides: Partial<AdapterActivity> = {}
): AdapterActivity[] {
  return Array.from({ length: count }, () => {
    activitySeq += 1;
    return {
      activityId: `a${String(activitySeq).padStart(4, '0')}`,
      createTime: new Date(
        Date.parse('2026-09-01T00:00:00Z') + activitySeq * 1000
      ).toISOString(),
      type: 'progressUpdated',
      artifacts: [],
      ...overrides,
    };
  });
}

export function resetActivitySeq(): void {
  activitySeq = 0;
}

export class FakeSdkAdapter implements SdkAdapter {
  readonly calls: Call[] = [];
  readonly sessions = new Map<string, AdapterSession>();
  /** Activities per session, served in pages of `pageSize` via numeric page tokens `p<offset>`. */
  readonly activities = new Map<string, AdapterActivity[]>();
  sources: AdapterSource[] = [
    {
      sourceResource: 'sources/github/acme/widgets',
      owner: 'acme',
      repo: 'widgets',
    },
  ];
  closed = false;

  getSessionImpl: (sessionResource: string) => Promise<AdapterSession> = async (
    sessionResource
  ) => {
    const session = this.sessions.get(sessionResource);
    if (session === undefined)
      throw new AdapterError('not-found', `no ${sessionResource}`, {
        status: 404,
      });
    return session;
  };

  listSessionsImpl: (options: PageOptions) => Promise<SessionPage> = async (
    options
  ) => {
    const all = [...this.sessions.values()];
    const offset =
      options.pageToken !== undefined ? Number(options.pageToken.slice(1)) : 0;
    const page = all.slice(offset, offset + options.pageSize);
    const next = offset + options.pageSize;
    return {
      sessions: page,
      ...(next < all.length ? { nextPageToken: `p${next}` } : {}),
    };
  };

  listActivitiesImpl: (
    sessionResource: string,
    options: PageOptions
  ) => Promise<ActivityPage> = async (sessionResource, options) => {
    const all = this.activities.get(sessionResource) ?? [];
    const offset =
      options.pageToken !== undefined ? Number(options.pageToken.slice(1)) : 0;
    const page = all.slice(offset, offset + options.pageSize);
    const next = offset + options.pageSize;
    return {
      activities: page,
      ...(next < all.length ? { nextPageToken: `p${next}` } : {}),
    };
  };

  getSourceImpl: (owner: string, repo: string) => Promise<AdapterSource> =
    async (owner, repo) => {
      const found = this.sources.find(
        (s) => s.owner === owner && s.repo === repo
      );
      if (found === undefined)
        throw new AdapterError(
          'source-not-found',
          `no source ${owner}/${repo}`
        );
      return found;
    };

  listSourcesImpl: (options: {
    readonly pageSize: number;
  }) => Promise<SourcePage> = async (options) => ({
    sources: this.sources.slice(0, options.pageSize),
    truncated: this.sources.length > options.pageSize,
  });

  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }

  callsTo(method: string): Call[] {
    return this.calls.filter((c) => c.method === method);
  }

  getSession(sessionResource: string): Promise<AdapterSession> {
    this.record('getSession', sessionResource);
    return this.getSessionImpl(sessionResource);
  }

  listSessions(options: PageOptions): Promise<SessionPage> {
    this.record('listSessions', options);
    return this.listSessionsImpl(options);
  }

  listActivities(
    sessionResource: string,
    options: PageOptions
  ): Promise<ActivityPage> {
    this.record('listActivities', sessionResource, options);
    return this.listActivitiesImpl(sessionResource, options);
  }

  getSource(owner: string, repo: string): Promise<AdapterSource> {
    this.record('getSource', owner, repo);
    return this.getSourceImpl(owner, repo);
  }

  listSources(options: { readonly pageSize: number }): Promise<SourcePage> {
    this.record('listSources', options);
    return this.listSourcesImpl(options);
  }

  async close(): Promise<void> {
    this.record('close');
    this.closed = true;
  }
}

/** A clock whose sleep advances time instantly, so retry backoff never slows a test. */
export class FakeClock implements Clock {
  constructor(public time = Date.parse('2026-09-29T12:00:00Z')) {}
  now(): number {
    return this.time;
  }
  async sleep(ms: number): Promise<void> {
    this.time += ms;
  }
}

export function makeDeps(
  dataDir: string,
  adapter: FakeSdkAdapter,
  overrides: Partial<RuntimeDeps> = {}
): RuntimeDeps & { clock: FakeClock } {
  const clock = new FakeClock();
  return {
    dataDir,
    clock,
    env: { JULES_API_KEY: 'dummy-test-key' },
    adapterFactory: async () => adapter,
    // The data dir lives under the OS temp dir; keep the location checks meaningful but independent of the repo.
    pluginRoot: '/nonexistent-plugin-root',
    cwd: dataDir,
    probeSdk: () => ({
      resolution: 'workspace',
      sdkVersion: '0.2.0',
      entryPath: '/x',
    }),
    ...overrides,
  } as RuntimeDeps & { clock: FakeClock };
}
