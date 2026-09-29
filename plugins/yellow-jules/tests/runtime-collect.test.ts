import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveArtifactsDir } from '../src/config.js';
import { AdapterError } from '../src/errors.js';
import { collect } from '../src/runtime.js';
import { markOperation, readJournal, reserveOperation } from '../src/state.js';
import type { AdapterActivity } from '../src/types.js';

import {
  FakeSdkAdapter,
  makeActivities,
  makeDeps,
  makeSession,
  resetActivitySeq,
} from './fake-sdk.js';

vi.setConfig({ testTimeout: 30_000 });

const S = 'sessions/s1';
const BASE = 'a'.repeat(40);
const PATCH =
  'diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-old\n+new\n';
const PATCH2 =
  'diff --git a/y.ts b/y.ts\n--- a/y.ts\n+++ b/y.ts\n@@ -1 +1 @@\n-a\n+b\n';

let root: string;
let dataDir: string;
let fake: FakeSdkAdapter;

beforeEach(async () => {
  root = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'yellow-jules-collect-')
  );
  dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir, { mode: 0o700 });
  fake = new FakeSdkAdapter();
  resetActivitySeq();
});

afterEach(async () => {
  await fs.promises.rm(root, { recursive: true, force: true });
});

function changeSetActivity(
  patch: string,
  baseCommitId = BASE
): AdapterActivity {
  return {
    ...makeActivities(1)[0]!,
    artifacts: [
      {
        type: 'changeSet',
        source: 'sources/github/acme/widgets',
        unidiffPatch: patch,
        baseCommitId,
        suggestedCommitMessage: 'msg',
      },
      { type: 'bashOutput' },
      { type: 'media' },
    ],
  };
}

function listFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)))
    .sort();
}

describe('collect', () => {
  it('stages every artifact kind under artifacts/<local-id>/ only', async () => {
    fake.sessions.set(
      S,
      makeSession({
        vendorState: 'completed',
        outputs: [
          {
            type: 'changeSet',
            source: 'sources/github/acme/widgets',
            unidiffPatch: PATCH,
            baseCommitId: BASE,
            suggestedCommitMessage: 'm',
          },
          {
            type: 'pullRequest',
            url: 'https://github.com/acme/widgets/pull/9',
            title: 'T',
            description: 'D',
          },
        ],
        generatedFiles: [
          {
            path: '../../escape.txt',
            changeType: 'created',
            content: 'hello\n',
          },
          { path: 'gone.txt', changeType: 'deleted', content: '' },
        ],
      })
    );
    fake.activities.set(S, [
      changeSetActivity(PATCH),
      changeSetActivity(PATCH2),
    ]);

    const result = await collect(makeDeps(dataDir, fake), { session: S });
    expect(result.localId).toMatch(/^jl-[0-9a-f]{32}$/);
    expect(result.noSupportedArtifact).toBe(false);
    expect(result.partialStaging).toBe(false);
    expect(result.artifacts.map((a) => a.kind)).toEqual([
      'patch',
      'pr-ref',
      'patch',
      'generated-file',
    ]);
    expect(result.artifacts[0]).toMatchObject({
      path: 'patch.diff',
      baseCommit: BASE,
      verification: 'unverified',
      secretShapedContent: false,
    });
    expect(result.artifacts[1]).toMatchObject({
      prUrl: 'https://github.com/acme/widgets/pull/9',
    });
    expect(result.artifacts[3]).toMatchObject({
      vendorPath: '../../escape.txt',
    });
    expect(result.artifacts[3]?.path).toMatch(/^generated\/01-[0-9a-f]{12}$/);

    const dir = path.join(resolveArtifactsDir(dataDir), result.localId);
    expect(fs.readFileSync(path.join(dir, 'patch.diff'), 'utf8')).toBe(PATCH);
    expect(listFiles(dir)).toEqual(
      [
        'generated/' + path.basename(result.artifacts[3]!.path!),
        'manifest.json',
        'patch.diff',
        result.artifacts[2]!.path!,
      ].sort()
    );
    // The vendor path is data only: nothing escaped the staging directory.
    expect(fs.existsSync(path.join(dataDir, 'escape.txt'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'escape.txt'))).toBe(false);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')
    );
    expect(manifest.artifacts[3].vendorPath).toBe('../../escape.txt');
    if (process.platform !== 'win32') {
      expect(fs.statSync(path.join(dir, 'patch.diff')).mode & 0o777).toBe(
        0o600
      );
      expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    }
  });

  it('records artifacts in the journal once, all unverified', async () => {
    fake.sessions.set(
      S,
      makeSession({
        outputs: [
          {
            type: 'changeSet',
            source: 's',
            unidiffPatch: PATCH,
            baseCommitId: BASE,
            suggestedCommitMessage: 'm',
          },
        ],
      })
    );
    await collect(makeDeps(dataDir, fake), { session: S });
    await collect(makeDeps(dataDir, fake), { session: S });
    const record = Object.values((await readJournal(dataDir)).operations)[0];
    expect(record?.artifacts).toHaveLength(1);
    expect(record?.artifacts[0]).toMatchObject({
      kind: 'patch',
      sessionResource: S,
      verification: 'unverified',
    });
  });

  it('an invalid base commit is never recorded', async () => {
    fake.sessions.set(
      S,
      makeSession({
        outputs: [
          {
            type: 'changeSet',
            source: 's',
            unidiffPatch: PATCH,
            baseCommitId: 'HEAD; rm -rf /',
            suggestedCommitMessage: 'm',
          },
        ],
      })
    );
    const result = await collect(makeDeps(dataDir, fake), { session: S });
    expect(result.artifacts[0]).not.toHaveProperty('baseCommit');
  });

  it('encodes absence once: noSupportedArtifact only after a complete walk', async () => {
    fake.sessions.set(S, makeSession());
    fake.activities.set(S, makeActivities(5));
    const complete = await collect(makeDeps(dataDir, fake), { session: S });
    expect(complete).toMatchObject({
      artifacts: [],
      noSupportedArtifact: true,
      partialStaging: false,
    });
    expect(complete.activities.partialPagination).toBe(false);

    fake.activities.set(S, makeActivities(25));
    const base = fake.listActivitiesImpl;
    fake.listActivitiesImpl = async (s, o) => {
      if (o.pageToken === 'p10')
        throw new AdapterError('server-error', '503', { status: 503 });
      return base(s, o);
    };
    const truncated = await collect(makeDeps(dataDir, fake), { session: S });
    expect(truncated).toMatchObject({
      noSupportedArtifact: false,
      activities: { partialPagination: true },
    });
    expect(truncated.attention).toContain('partialPagination');
  });

  it('pages activities 10 at a time and keeps its own resume token, never status read-state', async () => {
    fake.sessions.set(S, makeSession());
    fake.activities.set(S, makeActivities(25));
    const base = fake.listActivitiesImpl;
    fake.listActivitiesImpl = async (s, o) => {
      if (o.pageToken === 'p20') throw new AdapterError('network', 'reset');
      return base(s, o);
    };
    await collect(makeDeps(dataDir, fake), { session: S });
    expect(
      (fake.callsTo('listActivities')[0]?.args[1] as { pageSize: number })
        .pageSize
    ).toBe(10);
    let record = Object.values((await readJournal(dataDir)).operations)[0];
    expect(record?.artifactResumePageToken).toBe('p20');
    expect(record?.resumePageToken).toBeUndefined();
    expect(record?.lastActivityId).toBeUndefined();
    expect(record?.recentActivityIds).toEqual([]);

    fake.listActivitiesImpl = base;
    fake.calls.length = 0;
    await collect(makeDeps(dataDir, fake), { session: S });
    expect(
      (fake.callsTo('listActivities')[0]?.args[1] as { pageToken?: string })
        .pageToken
    ).toBe('p20');
    record = Object.values((await readJournal(dataDir)).operations)[0];
    expect(record?.artifactResumePageToken).toBeUndefined();
  });

  it('a resumed walk that makes no progress restarts from the beginning, then fails on the second', async () => {
    fake.sessions.set(S, makeSession());
    fake.activities.set(S, makeActivities(25));
    const base = fake.listActivitiesImpl;
    fake.listActivitiesImpl = async (s, o) => {
      if (o.pageToken === 'p10') throw new AdapterError('network', 'reset');
      return base(s, o);
    };
    await collect(makeDeps(dataDir, fake), { session: S });
    const recordFor = async () =>
      Object.values((await readJournal(dataDir)).operations)[0];
    expect((await recordFor())?.artifactResumePageToken).toBe('p10');

    // The vendor keeps handing back the same token with empty pages.
    fake.listActivitiesImpl = async () => ({
      activities: [],
      nextPageToken: 'p10',
    });
    const stuck = await collect(makeDeps(dataDir, fake), { session: S });
    expect(stuck.activities.partialPagination).toBe(true);
    let record = await recordFor();
    expect(record?.artifactResumePageToken).toBeUndefined();
    expect(record?.artifactResumeRestartCount).toBe(1);

    // Restart from the session beginning: a partial walk stores a token again
    // (empty pages, so nothing new resets the guard).
    fake.listActivitiesImpl = async () => ({
      activities: [],
      nextPageToken: 'p10',
    });
    fake.calls.length = 0;
    await collect(makeDeps(dataDir, fake), { session: S });
    expect(
      (fake.callsTo('listActivities')[0]?.args[1] as { pageToken?: string })
        .pageToken
    ).toBeUndefined();
    record = await recordFor();
    expect(record?.artifactResumePageToken).toBe('p10');

    // Second consecutive no-progress restart fails.
    fake.listActivitiesImpl = async () => ({
      activities: [],
      nextPageToken: 'p10',
    });
    await expect(
      collect(makeDeps(dataDir, fake), { session: S })
    ).rejects.toMatchObject({
      appError: { code: 'JULES_NO_PROGRESS' },
    });
    record = await recordFor();
    expect(record?.artifactResumePageToken).toBeUndefined();
    expect(record?.artifactResumeRestartCount).toBe(2);
  });

  it('a resumed collect never overwrites patch.diff and merges the manifest', async () => {
    fake.sessions.set(S, makeSession());
    fake.activities.set(S, [
      changeSetActivity(PATCH),
      ...makeActivities(12),
      changeSetActivity(PATCH2),
    ]);
    const base = fake.listActivitiesImpl;
    let failSecondPage = true;
    fake.listActivitiesImpl = async (s, o) => {
      if (failSecondPage && o.pageToken === 'p10')
        throw new AdapterError('network', 'reset');
      return base(s, o);
    };
    const first = await collect(makeDeps(dataDir, fake), { session: S });
    expect(first.activities.partialPagination).toBe(true);
    failSecondPage = false;
    const second = await collect(makeDeps(dataDir, fake), { session: S });
    const dir = path.join(resolveArtifactsDir(dataDir), second.localId);
    expect(fs.readFileSync(path.join(dir, 'patch.diff'), 'utf8')).toBe(PATCH);
    const patches = second.artifacts.filter((a) => a.kind === 'patch');
    expect(patches.map((a) => a.path)).toEqual([
      'patch.diff',
      expect.stringMatching(/^patches\/02-[0-9a-f]{12}\.diff$/),
    ]);
    expect(fs.readFileSync(path.join(dir, patches[1]!.path!), 'utf8')).toBe(
      PATCH2
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')
    );
    expect(manifest.artifacts).toHaveLength(2);
    const record = Object.values((await readJournal(dataDir)).operations)[0];
    expect(record?.artifacts.filter((a) => a.kind === 'patch')).toHaveLength(2);
  });

  it('overlapping collects for one session never share a patch slot', async () => {
    fake.sessions.set(S, makeSession());
    fake.activities.set(S, [changeSetActivity(PATCH)]);
    const base = fake.listActivitiesImpl;
    let calls = 0;
    // The second collect reads a different patch after the first has read.
    fake.listActivitiesImpl = async (s, o) => {
      const page = await base(s, o);
      calls += 1;
      if (calls === 1) fake.activities.set(S, [changeSetActivity(PATCH2)]);
      await new Promise((r) => setTimeout(r, 20));
      return page;
    };
    const [a, b] = await Promise.all([
      collect(makeDeps(dataDir, fake), { session: S }),
      collect(makeDeps(dataDir, fake), { session: S }),
    ]);
    const dir = path.join(resolveArtifactsDir(dataDir), a.localId);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')
    );
    const paths = manifest.artifacts.map((x: { path: string }) => x.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain('patch.diff');
    for (const art of manifest.artifacts as Array<{
      path: string;
      sha256: string;
    }>) {
      const bytes = fs.readFileSync(path.join(dir, art.path));
      expect(
        (await import('node:crypto'))
          .createHash('sha256')
          .update(bytes)
          .digest('hex')
      ).toBe(art.sha256);
    }
    expect(a.localId).toBe(b.localId);
  });

  it('a tampered manifest is rebuilt from validated fields only', async () => {
    fake.sessions.set(
      S,
      makeSession({
        outputs: [
          {
            type: 'changeSet',
            source: 's',
            unidiffPatch: PATCH,
            baseCommitId: BASE,
            suggestedCommitMessage: 'm',
          },
        ],
      })
    );
    const first = await collect(makeDeps(dataDir, fake), { session: S });
    const dir = path.join(resolveArtifactsDir(dataDir), first.localId);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')
    );
    manifest.artifacts[0].verification = 'passed';
    manifest.artifacts[0].secretShapedContent = false;
    manifest.artifacts[0].injected = 'x';
    manifest.artifacts.push(
      {
        kind: 'patch',
        path: '../../escape.diff',
        sha256: 'a'.repeat(64),
        secretShapedContent: false,
        verification: 'passed',
      },
      {
        kind: 'patch',
        path: 'patches/02-aaaaaaaaaaaa.diff',
        sha256: 'b'.repeat(64),
        secretShapedContent: false,
        verification: 'passed',
      },
      {
        kind: 'pr-ref',
        prUrl: 'https://github.com/evil/repo/pull/1',
        secretShapedContent: false,
        verification: 'passed',
      }
    );
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    const second = await collect(makeDeps(dataDir, fake), { session: S });
    expect(second.artifacts).toEqual([
      expect.objectContaining({
        kind: 'patch',
        path: 'patch.diff',
        verification: 'unverified',
      }),
    ]);
    expect(second.artifacts[0]).not.toHaveProperty('injected');
  });

  it('stops staging at the aggregate cap and lists the rest as skipped', async () => {
    fake.sessions.set(
      S,
      makeSession({
        outputs: [
          {
            type: 'changeSet',
            source: 's',
            unidiffPatch: PATCH,
            baseCommitId: BASE,
            suggestedCommitMessage: 'm',
          },
        ],
      })
    );
    fake.activities.set(S, [changeSetActivity(PATCH2)]);
    const result = await collect(
      makeDeps(dataDir, fake, { aggregateCapBytes: Buffer.byteLength(PATCH) }),
      { session: S }
    );
    expect(result.artifacts).toHaveLength(1);
    expect(result.skipped).toEqual([
      {
        kind: 'patch',
        reason: 'aggregate-cap-reached',
        bytes: Buffer.byteLength(PATCH2),
      },
    ]);
    expect(result.partialStaging).toBe(true);
    expect(result.noSupportedArtifact).toBe(false);
    expect(result.attention).toContain('partialStaging');
  });

  it('flags secret-shaped content without altering the staged bytes', async () => {
    const leaky = `${PATCH}+const key = "AIzaSyA1234567890abcdefXYZ";\n`;
    fake.sessions.set(
      S,
      makeSession({
        outputs: [
          {
            type: 'changeSet',
            source: 's',
            unidiffPatch: leaky,
            baseCommitId: BASE,
            suggestedCommitMessage: 'm',
          },
        ],
      })
    );
    const result = await collect(makeDeps(dataDir, fake), { session: S });
    expect(result.artifacts[0]?.secretShapedContent).toBe(true);
    const dir = path.join(resolveArtifactsDir(dataDir), result.localId);
    expect(fs.readFileSync(path.join(dir, 'patch.diff'), 'utf8')).toBe(leaky);
  });

  it('marks a session with an unreconciled policy deviation', async () => {
    await reserveOperation(dataDir, {
      localRequestId: 'req-1',
      kind: 'create',
      repository: 'acme/widgets',
      requestedBranch: 'main',
      sourceResource: 'sources/github/acme/widgets',
      autoPrRequested: false,
    });
    await markOperation(dataDir, 'req-1', 'accepted', { sessionResource: S });
    fake.sessions.set(
      S,
      makeSession({
        outputs: [
          {
            type: 'pullRequest',
            url: 'https://github.com/acme/widgets/pull/9',
            title: 'T',
            description: 'D',
          },
        ],
      })
    );
    const result = await collect(makeDeps(dataDir, fake), { session: S });
    expect(result.policyDeviation).toBe(true);
    expect(result.attention).toContain('policyDeviation');
    expect(result.artifacts).toEqual([
      expect.objectContaining({ kind: 'pr-ref' }),
    ]);
  });

  it('refuses a symlinked artifacts directory', async () => {
    fake.sessions.set(S, makeSession());
    fs.symlinkSync(root, resolveArtifactsDir(dataDir));
    await expect(
      collect(makeDeps(dataDir, fake), { session: S })
    ).rejects.toThrow(/symlink/);
  });
});
