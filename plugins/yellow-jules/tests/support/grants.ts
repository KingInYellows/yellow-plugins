/**
 * Test helpers for the grant, controller, and TTY layers: an in-memory TTY
 * that answers the runtime's challenge (correctly or not), grant builders, and
 * deps wired to throwaway data and controller directories.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { emptyUsage } from '../../src/authority.js';
import { type AuthorizeDeps, authorizeCreate } from '../../src/authorize.js';
import type { OpenTty, TtyHandle } from '../../src/tty-confirm.js';
import type { GrantRecord } from '../../src/types.js';
import { FakeSdkAdapter, makeDeps } from '../fake-sdk.js';

export type TtyMode = 'correct' | 'wrong' | 'eof' | 'timeout' | 'no-tty';

export interface FakeTty {
  readonly openTty: OpenTty;
  /** Everything the runtime wrote to the terminal. */
  readonly written: string[];
  opened: number;
}

/** A terminal that reads the challenge off the prompt and answers per `mode`. */
export function fakeTty(mode: TtyMode = 'correct'): FakeTty {
  const written: string[] = [];
  const state: FakeTty = {
    written,
    opened: 0,
    openTty: () => {
      state.opened += 1;
      if (mode === 'no-tty') {
        const err = new Error(
          'no controlling terminal'
        ) as NodeJS.ErrnoException;
        err.code = 'ENXIO';
        throw err;
      }
      const handle: TtyHandle = {
        write: (text) => {
          written.push(text);
        },
        readLine: async () => {
          // The newest prompt carries the live challenge.
          const matches = [
            ...written.join('').matchAll(/Type ([A-Z0-9]{6}) to confirm/g),
          ];
          const code = matches[matches.length - 1]?.[1];
          if (mode === 'timeout') throw new Error('timeout');
          if (mode === 'eof') return null;
          if (mode === 'wrong') return code === 'AAAAAA' ? 'BBBBBB' : 'AAAAAA';
          return code ?? '';
        },
        close: () => undefined,
      };
      return handle;
    },
  };
  return state;
}

export interface GrantHarness {
  readonly dataDir: string;
  readonly controllerDir: string;
  readonly adapter: FakeSdkAdapter;
  readonly tty: FakeTty;
  readonly deps: AuthorizeDeps & {
    clock: ReturnType<typeof makeDeps>['clock'];
  };
  cleanup(): void;
}

export function makeHarness(ttyMode: TtyMode = 'correct'): GrantHarness {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yellow-jules-grant-'));
  const dataDir = path.join(root, 'data');
  const controllerDir = path.join(root, 'controller');
  const adapter = new FakeSdkAdapter();
  const tty = fakeTty(ttyMode);
  const deps = {
    ...makeDeps(dataDir, adapter),
    cwd: root,
    controllerDir,
    controllerId: 'testhost',
    openTty: tty.openTty,
  } as GrantHarness['deps'];
  return {
    dataDir,
    controllerDir,
    adapter,
    tty,
    deps,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

export const NOW = new Date('2026-09-29T12:00:00Z');

export function makeGrant(overrides: Partial<GrantRecord> = {}): GrantRecord {
  return {
    grantId: 'jg-00000000000000000000000000000001',
    repository: 'acme/widgets',
    sourceResource: 'sources/github/acme/widgets',
    branchPattern: 'scratch/*',
    taskRefs: ['t1'],
    operations: ['create', 'reply', 'approve', 'collect'],
    maxActiveSessions: 1,
    maxTotalTasks: 3,
    maxCorrectiveRounds: 2,
    expiresAt: '2026-09-29T14:00:00.000Z',
    createdAt: '2026-09-29T12:00:00.000Z',
    owner: 'tester',
    controllerId: 'testhost',
    epochRef: { controllerId: 'testhost', epoch: 1 },
    usage: emptyUsage(),
    ...overrides,
  };
}

/** Creates a real grant through the TTY-confirmed path and returns its id. */
export async function createGrant(
  harness: GrantHarness,
  overrides: Partial<Parameters<typeof authorizeCreate>[1]> = {}
): Promise<string> {
  const result = await authorizeCreate(harness.deps, {
    repo: 'acme/widgets',
    branch: 'scratch/*',
    taskRefs: ['t1'],
    operations: 'create,reply,approve,collect',
    owner: 'tester',
    ...overrides,
  });
  return result.grantId;
}
