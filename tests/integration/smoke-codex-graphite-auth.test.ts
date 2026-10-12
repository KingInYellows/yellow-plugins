import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const { classify, nativeConfig } = createRequire(import.meta.url)(
  resolve(__dirname, '../../scripts/smoke-codex-graphite-auth.js')
);
describe('Graphite authentication prerequisite classification', () => {
  it('accepts positive account and repository access without retaining identity', () => {
    expect(
      classify('{"status":"ok","githubLogin":"private-identity"}')
    ).toEqual({
      observedStatus: 'ok',
      authenticated: true,
      repositoryAccess: true,
    });
  });
  it('separates account authentication from repository authorization', () => {
    expect(classify('{"status":"no_repo_access"}')).toEqual({
      observedStatus: 'no_repo_access',
      authenticated: true,
      repositoryAccess: false,
    });
  });
  it.each(['no_token', 'invalid_token'])(
    'does not infer authentication from %s',
    (status) => {
      expect(classify(JSON.stringify({ status })).authenticated).toBe(false);
    }
  );
  it('rejects missing, unsupported and ambiguous responses', () => {
    expect(() => classify('{"authStatus":"unsupported"}')).toThrow();
    expect(() => classify('{"status":"ok"}\n{"status":"no_token"}')).toThrow();
  });
});

describe('native Graphite config discovery', () => {
  const fixtures: string[] = [];
  afterEach(() => {
    for (const dir of fixtures.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });
  function setup() {
    const root = mkdtempSync(join(tmpdir(), 'graphite-native-config-'));
    fixtures.push(root);
    return { home: join(root, 'home'), configHome: join(root, 'xdg') };
  }
  function config(file: string) {
    mkdirSync(dirname(file), { recursive: true });
    // Deliberately invalid JSON: discovery must inspect metadata, never contents.
    writeFileSync(file, 'synthetic configuration');
  }
  it.each([
    ['legacy', 'home/.graphite_user_config'],
    ['xdg', 'config/graphite/user_config'],
    ['default', 'home/.config/graphite/user_config'],
  ])('finds and preserves the %s native location', (location, target) => {
    const { home, configHome } = setup();
    const source =
      location === 'legacy'
        ? join(home, '.graphite_user_config')
        : location === 'xdg'
          ? join(configHome, 'graphite/user_config')
          : join(home, '.config/graphite/user_config');
    config(source);
    expect(nativeConfig(home, configHome)).toEqual({ source, target });
  });
  it('prefers legacy then XDG then default, matching prerequisite discovery', () => {
    const { home, configHome } = setup();
    const legacy = join(home, '.graphite_user_config');
    const xdg = join(configHome, 'graphite/user_config');
    config(legacy);
    config(xdg);
    config(join(home, '.config/graphite/user_config'));
    expect(nativeConfig(home, configHome).source).toBe(legacy);
    rmSync(legacy);
    expect(nativeConfig(home, configHome).source).toBe(xdg);
  });
  it('uses the standard XDG default when no override is provided', () => {
    const { home } = setup();
    const source = join(home, '.config/graphite/user_config');
    config(source);
    expect(nativeConfig(home)).toEqual({
      source,
      target: 'config/graphite/user_config',
    });
  });
  it('rejects missing, directory and symlink config paths', () => {
    const { home, configHome } = setup();
    expect(() => nativeConfig(home, configHome)).toThrow(
      'Native config unavailable'
    );
    const legacy = join(home, '.graphite_user_config');
    mkdirSync(legacy, { recursive: true });
    expect(() => nativeConfig(home, configHome)).toThrow('regular file');
    rmSync(legacy, { recursive: true });
    const source = join(configHome, 'graphite/user_config');
    config(source);
    symlinkSync(source, legacy);
    expect(() => nativeConfig(home, configHome)).toThrow('regular file');
  });
});
