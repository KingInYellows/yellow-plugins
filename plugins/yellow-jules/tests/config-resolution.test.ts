import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  assertDataDirLocation,
  assertOwnerOnlyDir,
  ensureOwnerOnlyDir,
  findGitWorkTree,
  hasEnvApiKey,
  prepareDataDir,
  resolveArtifactsDir,
  resolveDataDir,
  resolveJournalPath,
  resolveLockPath,
  resolvePluginRoot,
  resolveRuntimeDir,
  resolveSdkScratchDir,
  resolveStateDir,
} from '../src/config.js';

import { codeOf } from './support/app-error.js';

const posixOnly = process.platform === 'win32' ? it.skip : it;

describe('hasEnvApiKey', () => {
  it('reports presence of JULES_API_KEY only', () => {
    expect(hasEnvApiKey({ JULES_API_KEY: 'x' })).toBe(true);
    expect(hasEnvApiKey({ JULES_API_KEY: '' })).toBe(false);
    expect(hasEnvApiKey({ CURSOR_API_KEY: 'x' })).toBe(false);
    expect(hasEnvApiKey({})).toBe(false);
  });
});

describe('resolveDataDir precedence (R35)', () => {
  const homedir = () => '/home/u';

  it('YELLOW_JULES_DATA_DIR wins over everything', () => {
    expect(
      resolveDataDir({
        env: { YELLOW_JULES_DATA_DIR: '/custom', XDG_DATA_HOME: '/xdg' },
        platform: 'linux',
        homedir,
      })
    ).toBe('/custom');
  });

  it('XDG_DATA_HOME is next', () => {
    expect(
      resolveDataDir({
        env: { XDG_DATA_HOME: '/xdg' },
        platform: 'linux',
        homedir,
      })
    ).toBe('/xdg/yellow-jules');
  });

  it('falls back to the platform default', () => {
    expect(resolveDataDir({ env: {}, platform: 'linux', homedir })).toBe(
      '/home/u/.local/share/yellow-jules'
    );
    expect(resolveDataDir({ env: {}, platform: 'darwin', homedir })).toBe(
      '/home/u/Library/Application Support/yellow-jules'
    );
    expect(
      resolveDataDir({
        env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' },
        platform: 'win32',
        homedir: () => 'C:\\Users\\u',
      })
    ).toBe('C:\\Users\\u\\AppData\\Roaming\\yellow-jules');
    expect(
      resolveDataDir({
        env: {},
        platform: 'win32',
        homedir: () => 'C:\\Users\\u',
      })
    ).toBe('C:\\Users\\u\\AppData\\Roaming\\yellow-jules');
  });

  it('ignores empty overrides', () => {
    expect(
      resolveDataDir({
        env: { YELLOW_JULES_DATA_DIR: '', XDG_DATA_HOME: '' },
        platform: 'linux',
        homedir,
      })
    ).toBe('/home/u/.local/share/yellow-jules');
  });

  it('lays out state, journal, lock, artifacts, scratch, and runtime under the data dir', () => {
    const d = '/data';
    expect(resolveStateDir(d)).toBe(path.join(d, 'state'));
    expect(resolveJournalPath(d)).toBe(path.join(d, 'state', 'journal.json'));
    expect(resolveLockPath(d)).toBe(path.join(d, 'state', '.lock'));
    expect(resolveArtifactsDir(d)).toBe(path.join(d, 'artifacts'));
    expect(resolveSdkScratchDir(d)).toBe(path.join(d, 'sdk-scratch'));
    expect(resolveRuntimeDir(d)).toBe(path.join(d, 'runtime'));
  });
});

describe('owner-only enforcement', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'yellow-jules-config-')
    );
  });

  afterEach(async () => {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  });

  posixOnly('creates a missing directory 0700', () => {
    const dir = path.join(tmp, 'a', 'data');
    ensureOwnerOnlyDir(dir);
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
  });

  posixOnly('refuses a group- or world-writable directory', () => {
    const dir = path.join(tmp, 'open');
    fs.mkdirSync(dir);
    fs.chmodSync(dir, 0o777);
    expect(codeOf(() => assertOwnerOnlyDir(dir))).toBe('JULES_DATA_DIR');
    fs.chmodSync(dir, 0o720);
    expect(codeOf(() => assertOwnerOnlyDir(dir))).toBe('JULES_DATA_DIR');
  });

  posixOnly('tightens a merely readable directory to 0700', () => {
    const dir = path.join(tmp, 'readable');
    fs.mkdirSync(dir);
    fs.chmodSync(dir, 0o755);
    assertOwnerOnlyDir(dir);
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('refuses a symlinked directory', () => {
    const real = path.join(tmp, 'real');
    const link = path.join(tmp, 'link');
    fs.mkdirSync(real, { mode: 0o700 });
    fs.symlinkSync(real, link);
    expect(codeOf(() => assertOwnerOnlyDir(link))).toBe('JULES_DATA_DIR');
  });

  it('refuses a regular file where a directory is expected', () => {
    const file = path.join(tmp, 'file');
    fs.writeFileSync(file, '');
    expect(codeOf(() => assertOwnerOnlyDir(file))).toBe('JULES_DATA_DIR');
  });

  posixOnly('applies to a YELLOW_JULES_DATA_DIR override too', () => {
    const dir = path.join(tmp, 'override');
    fs.mkdirSync(dir);
    fs.chmodSync(dir, 0o777);
    const dataDir = resolveDataDir({
      env: { YELLOW_JULES_DATA_DIR: dir },
      platform: 'linux',
    });
    expect(
      codeOf(() =>
        prepareDataDir(dataDir, { pluginRoot: resolvePluginRoot(), cwd: tmp })
      )
    ).toBe('JULES_DATA_DIR');
  });

  posixOnly(
    'prepareDataDir checks existing sdk-scratch and runtime subdirectories',
    () => {
      const dataDir = path.join(tmp, 'data');
      prepareDataDir(dataDir, { pluginRoot: resolvePluginRoot(), cwd: tmp });
      expect(fs.statSync(resolveStateDir(dataDir)).mode & 0o777).toBe(0o700);
      fs.mkdirSync(resolveRuntimeDir(dataDir));
      fs.chmodSync(resolveRuntimeDir(dataDir), 0o777);
      expect(
        codeOf(() =>
          prepareDataDir(dataDir, { pluginRoot: resolvePluginRoot(), cwd: tmp })
        )
      ).toBe('JULES_DATA_DIR');
    }
  );

  it('refuses a symlinked runtime directory', () => {
    const dataDir = path.join(tmp, 'data');
    prepareDataDir(dataDir, { pluginRoot: resolvePluginRoot(), cwd: tmp });
    fs.symlinkSync(tmp, resolveRuntimeDir(dataDir));
    expect(
      codeOf(() =>
        prepareDataDir(dataDir, { pluginRoot: resolvePluginRoot(), cwd: tmp })
      )
    ).toBe('JULES_DATA_DIR');
  });
});

describe('data dir location (R15)', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'yellow-jules-location-')
    );
  });

  afterEach(async () => {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  });

  it('refuses a data dir under the plugin root', () => {
    const pluginRoot = path.join(tmp, 'plugin');
    fs.mkdirSync(pluginRoot);
    expect(
      codeOf(() =>
        assertDataDirLocation(path.join(pluginRoot, 'data'), {
          pluginRoot,
          cwd: tmp,
        })
      )
    ).toBe('JULES_DATA_DIR');
  });

  it('refuses a data dir inside the git work tree containing the cwd', () => {
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(repo, 'sub'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.git'));
    expect(findGitWorkTree(path.join(repo, 'sub'))).toBe(fs.realpathSync(repo));
    expect(
      codeOf(() =>
        assertDataDirLocation(path.join(repo, '.jules-data'), {
          pluginRoot: path.join(tmp, 'plugin'),
          cwd: path.join(repo, 'sub'),
        })
      )
    ).toBe('JULES_DATA_DIR');
  });

  it('treats a worktree `.git` file as a work tree marker', () => {
    const repo = path.join(tmp, 'wt');
    fs.mkdirSync(repo);
    fs.writeFileSync(path.join(repo, '.git'), 'gitdir: /elsewhere\n');
    expect(findGitWorkTree(repo)).toBe(fs.realpathSync(repo));
  });

  it('refuses a data dir inside a different git checkout than the cwd', () => {
    const cwdRepo = path.join(tmp, 'cwd-repo');
    const otherRepo = path.join(tmp, 'other-repo');
    fs.mkdirSync(path.join(cwdRepo, '.git'), { recursive: true });
    fs.mkdirSync(path.join(otherRepo, '.git'), { recursive: true });
    expect(
      codeOf(() =>
        assertDataDirLocation(path.join(otherRepo, 'not-yet', 'data'), {
          pluginRoot: path.join(tmp, 'plugin'),
          cwd: cwdRepo,
        })
      )
    ).toBe('JULES_DATA_DIR');
  });

  it('refuses a data dir inside a checkout when the cwd is outside any checkout', () => {
    const repo = path.join(tmp, 'repo');
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.mkdirSync(outside);
    expect(
      codeOf(() =>
        assertDataDirLocation(path.join(repo, 'data'), {
          pluginRoot: path.join(tmp, 'plugin'),
          cwd: outside,
        })
      )
    ).toBe('JULES_DATA_DIR');
  });

  it('accepts a data dir outside both', () => {
    expect(() =>
      assertDataDirLocation(path.join(tmp, 'data'), {
        pluginRoot: path.join(tmp, 'plugin'),
        cwd: tmp,
      })
    ).not.toThrow();
  });

  it('refuses a relative data dir', () => {
    expect(
      codeOf(() =>
        assertDataDirLocation('relative/data', {
          pluginRoot: path.join(tmp, 'p'),
          cwd: tmp,
        })
      )
    ).toBe('JULES_DATA_DIR');
  });
});
