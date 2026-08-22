import { describe, expect, it } from 'vitest';

import {
  hasEnvApiKey,
  resolveDataDir,
  resolveRuntimeDir,
  resolveStateFilePath,
} from '../src/config.js';

describe('hasEnvApiKey', () => {
  it('reports env source-only (never the value) when CURSOR_API_KEY is set', () => {
    expect(hasEnvApiKey({ CURSOR_API_KEY: 'sk-test-value' })).toBe(true);
  });

  it('reports false when unset or empty', () => {
    expect(hasEnvApiKey({})).toBe(false);
    expect(hasEnvApiKey({ CURSOR_API_KEY: '' })).toBe(false);
  });
});

describe('resolveDataDir', () => {
  it('prefers YELLOW_CURSOR_DATA_DIR above all else', () => {
    const dir = resolveDataDir({
      env: { YELLOW_CURSOR_DATA_DIR: '/custom/dir', XDG_DATA_HOME: '/xdg' },
      platform: 'linux',
      homedir: () => '/home/user',
    });
    expect(dir).toBe('/custom/dir');
  });

  it('falls back to XDG_DATA_HOME/yellow-cursor on linux', () => {
    const dir = resolveDataDir({
      env: { XDG_DATA_HOME: '/xdg' },
      platform: 'linux',
      homedir: () => '/home/user',
    });
    expect(dir).toBe('/xdg/yellow-cursor');
  });

  it('uses the darwin Application Support path when no explicit override is set', () => {
    const dir = resolveDataDir({
      env: {},
      platform: 'darwin',
      homedir: () => '/Users/test',
    });
    expect(dir).toBe('/Users/test/Library/Application Support/yellow-cursor');
  });

  it('uses APPDATA on win32 when set', () => {
    const dir = resolveDataDir({
      env: { APPDATA: 'C:\\Users\\test\\AppData\\Roaming' },
      platform: 'win32',
      homedir: () => 'C:\\Users\\test',
    });
    expect(dir).toBe('C:\\Users\\test\\AppData\\Roaming\\yellow-cursor');
  });

  it('falls back to homedir/AppData/Roaming on win32 when APPDATA is unset', () => {
    const dir = resolveDataDir({
      env: {},
      platform: 'win32',
      homedir: () => 'C:\\Users\\test',
    });
    expect(dir).toBe('C:\\Users\\test\\AppData\\Roaming\\yellow-cursor');
  });

  it('falls back to ~/.local/share/yellow-cursor on other platforms', () => {
    const dir = resolveDataDir({
      env: {},
      platform: 'freebsd',
      homedir: () => '/home/user',
    });
    expect(dir).toBe('/home/user/.local/share/yellow-cursor');
  });
});

describe('derived paths', () => {
  it('nests runtime/ and state/agents.json under the data dir', () => {
    expect(resolveRuntimeDir('/data')).toBe('/data/runtime');
    expect(resolveStateFilePath('/data')).toBe('/data/state/agents.json');
  });
});
