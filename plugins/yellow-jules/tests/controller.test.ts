import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { emptyGrants } from '../src/authority.js';
import { canonicalPath, resolveControllerDir } from '../src/config.js';
import {
  assertControllerAuthority,
  controllerFilePath,
  initControllerAuthority,
  readControllerAuthority,
  takeOverController,
} from '../src/controller.js';
import { AppErrorException } from '../src/errors.js';

import { makeGrant } from './support/grants.js';

let root: string;
let dataDir: string;
let controllerDir: string;
const ctx = () => ({ controllerDir, controllerId: 'testhost' });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'yellow-jules-ctl-'));
  dataDir = path.join(root, 'data');
  controllerDir = path.join(root, 'controller');
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(controllerDir, { recursive: true, mode: 0o700 });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof AppErrorException) return err.appError.code;
    throw err;
  }
  throw new Error('did not throw');
}

describe('initControllerAuthority / assertControllerAuthority', () => {
  it('writes epoch 1 for the canonical data dir, 0600, and matches it back', () => {
    const authority = initControllerAuthority(ctx(), dataDir);
    expect(authority.epoch).toBe(1);
    expect(authority.dataDir).toBe(canonicalPath(dataDir));
    const file = controllerFilePath(controllerDir, 'testhost');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(
      assertControllerAuthority(controllerDir, dataDir, {
        controllerId: 'testhost',
        epoch: 1,
      }).epoch
    ).toBe(1);
  });

  it('refuses to overwrite an existing authority', () => {
    initControllerAuthority(ctx(), dataDir);
    expect(codeOf(() => initControllerAuthority(ctx(), dataDir))).toBe(
      'JULES_CONTROLLER_MISMATCH'
    );
  });

  it('a missing file -> JULES_CONTROLLER_MISMATCH', () => {
    expect(
      codeOf(() =>
        assertControllerAuthority(controllerDir, dataDir, {
          controllerId: 'testhost',
          epoch: 1,
        })
      )
    ).toBe('JULES_CONTROLLER_MISMATCH');
  });

  it('a different epoch -> JULES_CONTROLLER_MISMATCH', () => {
    initControllerAuthority(ctx(), dataDir);
    expect(
      codeOf(() =>
        assertControllerAuthority(controllerDir, dataDir, {
          controllerId: 'testhost',
          epoch: 2,
        })
      )
    ).toBe('JULES_CONTROLLER_MISMATCH');
  });

  it('a data dir copied to another path fails even with the right epoch', () => {
    initControllerAuthority(ctx(), dataDir);
    const copy = path.join(root, 'data-copy');
    fs.cpSync(dataDir, copy, { recursive: true });
    expect(
      codeOf(() =>
        assertControllerAuthority(controllerDir, copy, {
          controllerId: 'testhost',
          epoch: 1,
        })
      )
    ).toBe('JULES_CONTROLLER_MISMATCH');
  });

  it('a moved data dir (renamed) fails', () => {
    initControllerAuthority(ctx(), dataDir);
    const moved = path.join(root, 'data-moved');
    fs.renameSync(dataDir, moved);
    expect(
      codeOf(() =>
        assertControllerAuthority(controllerDir, moved, {
          controllerId: 'testhost',
          epoch: 1,
        })
      )
    ).toBe('JULES_CONTROLLER_MISMATCH');
  });

  it('a symlink to the data dir resolves to the same canonical path', () => {
    initControllerAuthority(ctx(), dataDir);
    const link = path.join(root, 'link');
    fs.symlinkSync(dataDir, link);
    expect(
      assertControllerAuthority(controllerDir, link, {
        controllerId: 'testhost',
        epoch: 1,
      }).epoch
    ).toBe(1);
  });

  it('a corrupt authority file fails closed', () => {
    const file = controllerFilePath(controllerDir, 'testhost');
    fs.writeFileSync(file, '{not json', { mode: 0o600 });
    expect(
      codeOf(() => readControllerAuthority(controllerDir, 'testhost'))
    ).toBe('JULES_CONTROLLER_MISMATCH');
  });

  it('a group-readable authority file is not trusted', () => {
    initControllerAuthority(ctx(), dataDir);
    fs.chmodSync(controllerFilePath(controllerDir, 'testhost'), 0o640);
    expect(
      codeOf(() => readControllerAuthority(controllerDir, 'testhost'))
    ).toBe('JULES_CONTROLLER_MISMATCH');
  });

  it('a symlinked authority file is not trusted', () => {
    const real = path.join(root, 'real.json');
    fs.writeFileSync(real, '{}', { mode: 0o600 });
    fs.symlinkSync(real, controllerFilePath(controllerDir, 'testhost'));
    expect(
      codeOf(() => readControllerAuthority(controllerDir, 'testhost'))
    ).toBe('JULES_CONTROLLER_MISMATCH');
  });

  it('rejects a controller id that escapes the directory', () => {
    expect(() => controllerFilePath(controllerDir, '../evil')).toThrow();
  });
});

describe('takeOverController', () => {
  it('increments the epoch and rebinds every grant to this host and path', () => {
    initControllerAuthority(ctx(), dataDir);
    const file = emptyGrants();
    const grant = makeGrant();
    file.grants[grant.grantId] = grant;

    const result = takeOverController(ctx(), dataDir, file);
    expect(result.authority.epoch).toBe(2);
    expect(result.grants.grants[grant.grantId]?.epochRef).toEqual({
      controllerId: 'testhost',
      epoch: 2,
    });
    expect(
      assertControllerAuthority(controllerDir, dataDir, {
        controllerId: 'testhost',
        epoch: 2,
      }).epoch
    ).toBe(2);
  });

  it('on a new host with no file goes above every epoch the copied grants reference', () => {
    const file = emptyGrants();
    const grant = makeGrant({
      controllerId: 'oldhost',
      epochRef: { controllerId: 'oldhost', epoch: 4 },
    });
    file.grants[grant.grantId] = grant;
    const result = takeOverController(ctx(), dataDir, file);
    expect(result.authority.epoch).toBe(5);
    expect(result.grants.grants[grant.grantId]?.controllerId).toBe('testhost');
  });

  it('invalidates the previous epoch reference', () => {
    initControllerAuthority(ctx(), dataDir);
    takeOverController(ctx(), dataDir, emptyGrants());
    expect(
      codeOf(() =>
        assertControllerAuthority(controllerDir, dataDir, {
          controllerId: 'testhost',
          epoch: 1,
        })
      )
    ).toBe('JULES_CONTROLLER_MISMATCH');
  });
});

describe('resolveControllerDir', () => {
  it('prefers YELLOW_JULES_CONTROLLER_DIR, then XDG_STATE_HOME, then ~/.local/state', () => {
    const explicit = path.join(root, 'explicit');
    expect(
      resolveControllerDir(dataDir, { YELLOW_JULES_CONTROLLER_DIR: explicit })
    ).toBe(explicit);
    const xdg = path.join(root, 'xdg');
    expect(resolveControllerDir(dataDir, { XDG_STATE_HOME: xdg })).toBe(
      path.join(xdg, 'yellow-jules-controller')
    );
    const home = path.join(root, 'home');
    expect(resolveControllerDir(dataDir, {}, () => home)).toBe(
      path.join(home, '.local', 'state', 'yellow-jules-controller')
    );
    expect(fs.statSync(explicit).mode & 0o777).toBe(0o700);
  });

  it('refuses a directory inside the data dir, or one that contains it', () => {
    expect(
      codeOf(() =>
        resolveControllerDir(dataDir, {
          YELLOW_JULES_CONTROLLER_DIR: path.join(dataDir, 'ctl'),
        })
      )
    ).toBe('JULES_DATA_DIR');
    expect(
      codeOf(() =>
        resolveControllerDir(dataDir, { YELLOW_JULES_CONTROLLER_DIR: root })
      )
    ).toBe('JULES_DATA_DIR');
  });

  it('refuses a symlink that lands inside the data dir', () => {
    const link = path.join(root, 'linked-ctl');
    fs.symlinkSync(dataDir, link);
    expect(
      codeOf(() =>
        resolveControllerDir(dataDir, { YELLOW_JULES_CONTROLLER_DIR: link })
      )
    ).toBe('JULES_DATA_DIR');
  });

  it('refuses a relative path', () => {
    expect(
      codeOf(() =>
        resolveControllerDir(dataDir, {
          YELLOW_JULES_CONTROLLER_DIR: 'rel/dir',
        })
      )
    ).toBe('JULES_DATA_DIR');
  });
});
