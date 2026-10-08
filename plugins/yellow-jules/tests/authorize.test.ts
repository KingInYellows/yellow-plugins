import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadGrants } from '../src/authority.js';
import {
  ACTIVE_GRANT_ENV,
  authorizeCreate,
  authorizeList,
  authorizeRevoke,
  authorizeTakeOver,
  defaultControllerId,
} from '../src/authorize.js';
import { resolveGrantsPath } from '../src/config.js';
import {
  assertControllerAuthority,
  controllerFilePath,
} from '../src/controller.js';

import { codeOfAsync } from './support/app-error.js';
import {
  createGrant,
  type GrantHarness,
  makeHarness,
} from './support/grants.js';

let h: GrantHarness;
beforeEach(() => {
  h = makeHarness('correct');
});
afterEach(() => {
  h.cleanup();
});

const BASE = {
  repo: 'acme/widgets',
  branch: 'scratch/*',
  taskRefs: ['t1'],
  operations: 'create,reply',
  owner: 'tester',
};

describe('authorize (create)', () => {
  it('writes a 0600 grant and the controller file outside the data dir after a typed challenge', async () => {
    const result = await authorizeCreate(h.deps, BASE);
    expect(result).toMatchObject({
      repository: 'acme/widgets',
      sourceResource: 'sources/github/acme/widgets',
      branchPattern: 'scratch/*',
      taskRefs: ['t1'],
      operations: ['create', 'reply'],
      limits: {
        maxActiveSessions: 1,
        maxTotalTasks: 3,
        maxCorrectiveRounds: 2,
      },
      controllerId: 'testhost',
      epoch: 1,
    });
    expect(result.grantId).toMatch(/^jg-[0-9a-f]{32}$/);
    expect(fs.statSync(resolveGrantsPath(h.dataDir)).mode & 0o777).toBe(0o600);
    const controllerFile = controllerFilePath(h.controllerDir, 'testhost');
    expect(fs.existsSync(controllerFile)).toBe(true);
    expect(controllerFile.startsWith(h.dataDir)).toBe(false);
    const ttlMs = Date.parse(result.expiresAt) - h.deps.clock.now();
    expect(ttlMs).toBe(120 * 60_000);
  });

  it('prints the grant summary on the terminal and nowhere else', async () => {
    await authorizeCreate(h.deps, BASE);
    const prompt = h.tty.written.join('');
    expect(prompt).toContain('acme/widgets');
    expect(prompt).toContain('scratch/*');
    expect(prompt).toContain('create, reply');
  });

  it('resolves the source through the adapter (R17)', async () => {
    await authorizeCreate(h.deps, BASE);
    expect(h.adapter.callsTo('getSource')).toHaveLength(1);
  });

  it('with no terminal: JULES_CONFIRMATION_REQUIRED, no grant, no controller file, no vendor write', async () => {
    const noTty = makeHarness('no-tty');
    try {
      expect(await codeOfAsync(() => authorizeCreate(noTty.deps, BASE))).toBe(
        'JULES_CONFIRMATION_REQUIRED'
      );
      expect(fs.existsSync(resolveGrantsPath(noTty.dataDir))).toBe(false);
      expect(
        fs.existsSync(controllerFilePath(noTty.controllerDir, 'testhost'))
      ).toBe(false);
      // The source is read before the prompt; nothing is written.
      expect(noTty.adapter.writeCount()).toBe(0);
    } finally {
      noTty.cleanup();
    }
  });

  it.each(['wrong', 'eof', 'timeout'] as const)(
    'a %s answer writes nothing',
    async (mode) => {
      const bad = makeHarness(mode);
      try {
        await expect(authorizeCreate(bad.deps, BASE)).rejects.toThrow();
        expect(fs.existsSync(resolveGrantsPath(bad.dataDir))).toBe(false);
        expect(bad.adapter.writeCount()).toBe(0);
      } finally {
        bad.cleanup();
      }
    }
  );

  it('refuses inside a supervised session, before any terminal prompt', async () => {
    const deps = {
      ...h.deps,
      env: { ...h.deps.env, [ACTIVE_GRANT_ENV]: 'jg-x' },
    };
    expect(await codeOfAsync(() => authorizeCreate(deps, BASE))).toBe(
      'JULES_AUTHORITY_DENIED'
    );
    expect(h.tty.opened).toBe(0);
  });

  it('refuses values above the documented ceilings', async () => {
    for (const over of [
      { maxActiveSessions: 4 },
      { maxTotalTasks: 11 },
      { maxCorrectiveRounds: 4 },
      { ttlMinutes: 1441 },
    ]) {
      expect(
        await codeOfAsync(() => authorizeCreate(h.deps, { ...BASE, ...over }))
      ).toBe('JULES_INVALID_INPUT');
    }
    expect(h.tty.opened).toBe(0);
  });

  it('accepts the ceilings exactly', async () => {
    const result = await authorizeCreate(h.deps, {
      ...BASE,
      maxActiveSessions: 3,
      maxTotalTasks: 10,
      maxCorrectiveRounds: 3,
      ttlMinutes: 1440,
    });
    expect(result.limits).toEqual({
      maxActiveSessions: 3,
      maxTotalTasks: 10,
      maxCorrectiveRounds: 3,
    });
  });

  it('requires a task ref, a valid branch pattern, known operations, and a matching --source', async () => {
    const bad: Array<Partial<typeof BASE> & { source?: string }> = [
      { taskRefs: [] },
      { branch: '*' },
      { branch: 'a*b' },
      { operations: 'create,delete' },
      { operations: 'create,create' },
      { repo: 'not-a-repo' },
      { owner: '' },
      { source: 'sources/github/other/repo' },
    ];
    for (const patch of bad) {
      expect(
        await codeOfAsync(() => authorizeCreate(h.deps, { ...BASE, ...patch }))
      ).toBe('JULES_INVALID_INPUT');
    }
  });

  it('a source Jules does not know -> JULES_SOURCE_ACCESS and nothing is written', async () => {
    expect(
      await codeOfAsync(() =>
        authorizeCreate(h.deps, { ...BASE, repo: 'acme/unknown' })
      )
    ).toBe('JULES_SOURCE_ACCESS');
    expect(fs.existsSync(resolveGrantsPath(h.dataDir))).toBe(false);
  });

  it('a second grant reuses the epoch; a copied data dir with grants but no controller file fails', async () => {
    const first = await authorizeCreate(h.deps, BASE);
    const second = await authorizeCreate(h.deps, BASE);
    expect(second.epoch).toBe(first.epoch);
    expect(Object.keys(loadGrants(h.dataDir).grants)).toHaveLength(2);

    fs.rmSync(controllerFilePath(h.controllerDir, 'testhost'));
    expect(await codeOfAsync(() => authorizeCreate(h.deps, BASE))).toBe(
      'JULES_CONTROLLER_MISMATCH'
    );
  });

  it('a controller authority for a different data dir blocks creation', async () => {
    await authorizeCreate(h.deps, BASE);
    const copy = path.join(path.dirname(h.dataDir), 'copy');
    fs.cpSync(h.dataDir, copy, { recursive: true });
    const deps = { ...h.deps, dataDir: copy };
    expect(await codeOfAsync(() => authorizeCreate(deps, BASE))).toBe(
      'JULES_CONTROLLER_MISMATCH'
    );
  });
});

describe('authorize --list / --revoke', () => {
  it('need no terminal', async () => {
    const id = await createGrant(h);
    const noTty = { ...h.deps, openTty: makeHarness('no-tty').tty.openTty };
    const listed = authorizeList(noTty);
    expect(listed.grants.map((g) => g.grantId)).toEqual([id]);
    expect(listed.grants[0]).toMatchObject({ expired: false, revoked: false });
    const revoked = await authorizeRevoke(noTty, id);
    expect(revoked.grantId).toBe(id);
    expect(authorizeList(noTty).grants[0]).toMatchObject({ revoked: true });
  });

  it('revoke rejects a malformed id', async () => {
    expect(await codeOfAsync(() => authorizeRevoke(h.deps, 'nope'))).toBe(
      'JULES_INVALID_INPUT'
    );
  });
});

describe('authorize --take-over', () => {
  it('needs the terminal, advances the epoch, and rebinds grants', async () => {
    const id = await createGrant(h);
    const result = await authorizeTakeOver(h.deps);
    expect(result).toMatchObject({ epoch: 2, grantsRebound: 1 });
    expect(loadGrants(h.dataDir).grants[id]?.epochRef.epoch).toBe(2);
    expect(
      assertControllerAuthority(h.controllerDir, h.dataDir, {
        controllerId: 'testhost',
        epoch: 2,
      }).epoch
    ).toBe(2);
  });

  it('without a terminal it changes nothing', async () => {
    const id = await createGrant(h);
    const noTty = { ...h.deps, openTty: makeHarness('no-tty').tty.openTty };
    expect(await codeOfAsync(() => authorizeTakeOver(noTty))).toBe(
      'JULES_CONFIRMATION_REQUIRED'
    );
    expect(loadGrants(h.dataDir).grants[id]?.epochRef.epoch).toBe(1);
  });

  it('refuses inside a supervised session', async () => {
    const deps = {
      ...h.deps,
      env: { ...h.deps.env, [ACTIVE_GRANT_ENV]: 'jg-x' },
    };
    expect(await codeOfAsync(() => authorizeTakeOver(deps))).toBe(
      'JULES_AUTHORITY_DENIED'
    );
  });
});

describe('defaultControllerId', () => {
  it('sanitizes a host name into the allowlist', () => {
    expect(defaultControllerId(() => 'my host_1.local')).toBe(
      'my-host_1.local'
    );
    expect(defaultControllerId(() => '---')).toBe('host');
    expect(defaultControllerId(() => 'a'.repeat(100))).toHaveLength(63);
  });
});
