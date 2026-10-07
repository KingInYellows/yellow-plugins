import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');

function scratch<T>(run: (directory: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), 'yellow-remote-orchestration-'));
  try {
    return run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function installedCursor(directory: string) {
  const plugin = join(directory, 'cache', 'yellow-cursor');
  mkdirSync(plugin, { recursive: true });
  cpSync(join(root, 'plugins/yellow-cursor/dist'), join(plugin, 'dist'), {
    recursive: true,
  });
  cpSync(
    join(root, 'plugins/yellow-cursor/skills/cursor-plan'),
    join(plugin, 'codex/skills/cursor-plan'),
    { recursive: true }
  );
  const home = join(directory, 'empty-home');
  mkdirSync(home);
  return {
    cli: join(plugin, 'dist/cli.js'),
    home,
    env: {
      PATH: process.env.PATH,
      HOME: home,
      YELLOW_CURSOR_DATA_DIR: join(home, 'cursor-state'),
    },
  };
}

describe('packaged offline Cursor plan runtime', () => {
  it('validates without SDK, credentials, sibling plugins or local state writes', () =>
    scratch((directory) => {
      const fixture = installedCursor(directory);
      const result = spawnSync(
        process.execPath,
        [
          fixture.cli,
          'delegate',
          '--dry-run',
          '--repo',
          'https://github.com/example/project',
          '--prompt',
          'Fix the failing unit test',
          '--ref',
          'main',
          '--idempotency-key',
          'fixture-cursor-plan',
        ],
        { cwd: directory, env: fixture.env, encoding: 'utf8', timeout: 15000 }
      );
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual({
        ok: true,
        operation: 'delegate',
        dryRun: true,
        repository: 'https://github.com/example/project',
        startingRef: 'main',
        idempotencyKey: 'fixture-cursor-plan',
      });
      expect(readdirSync(fixture.home)).toEqual([]);
      expect(existsSync(join(directory, 'cache/yellow-core'))).toBe(false);
      expect(
        existsSync(join(directory, 'cache/yellow-cursor/node_modules'))
      ).toBe(false);
    }));

  it.each([
    'http://github.com/example/project',
    'https://user:fixture-value@github.com/example/project',
    'https://github.com/example/project#fragment',
    'https://unlisted.example/project',
  ])('rejects unsafe repository %s without writing state', (repository) =>
    scratch((directory) => {
      const fixture = installedCursor(directory);
      const result = spawnSync(
        process.execPath,
        [
          fixture.cli,
          'delegate',
          '--dry-run',
          '--repo',
          repository,
          '--prompt',
          'Inspect tests',
        ],
        { cwd: directory, env: fixture.env, encoding: 'utf8', timeout: 15000 }
      );
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout).error.code).toBe('CURSOR_INVALID_INPUT');
      expect(readdirSync(fixture.home)).toEqual([]);
    })
  );

  it('keeps task metacharacters as data and cannot execute them', () =>
    scratch((directory) => {
      const fixture = installedCursor(directory);
      const sentinel = join(directory, 'must-not-exist');
      const result = spawnSync(
        process.execPath,
        [
          fixture.cli,
          'delegate',
          '--dry-run',
          '--repo',
          'https://github.com/example/project',
          '--prompt',
          `Inspect $(touch ${sentinel}); do not execute this text`,
        ],
        { cwd: directory, env: fixture.env, encoding: 'utf8', timeout: 15000 }
      );
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).dryRun).toBe(true);
      expect(existsSync(sentinel)).toBe(false);
      expect(readdirSync(fixture.home)).toEqual([]);
    }));
});

describe('Codex readiness private-capture Bash adapter', () => {
  const reference = readFileSync(
    join(
      root,
      'plugins/yellow-codex/skills/codex-readiness/references/readiness-contract.md'
    ),
    'utf8'
  );
  const block = reference.match(/```bash\n([\s\S]*?)\n```/)?.[1];
  if (!block) throw new Error('Readiness Bash adapter missing');

  it.each([
    [
      'Logged in using fixture-secret-do-not-emit',
      0,
      'authenticated-local-state',
    ],
    ['Not logged in', 1, 'missing'],
    ['fixture-secret-do-not-emit keyring error', 1, 'probe-error'],
    ['unexpected fixture-secret-do-not-emit', 0, 'unverified'],
    ['fixture-secret-do-not-emit', 124, 'timeout'],
  ])(
    'classifies native status without raw output: %s',
    (message, exit, expected) =>
      scratch((directory) => {
        const binary = join(directory, 'bin');
        mkdirSync(binary);
        writeFileSync(
          join(binary, 'codex'),
          '#!/bin/sh\n[ "$1" = login ] && [ "$2" = status ] || exit 99\nprintf "%s\\n" "$FIXTURE_LOGIN_MESSAGE" >&2\nexit "$FIXTURE_LOGIN_EXIT"\n',
          { mode: 0o755 }
        );
        const result = spawnSync('bash', ['-c', block], {
          cwd: directory,
          encoding: 'utf8',
          timeout: 20000,
          env: {
            PATH: `${binary}:${process.env.PATH}`,
            HOME: directory,
            FIXTURE_LOGIN_MESSAGE: String(message),
            FIXTURE_LOGIN_EXIT: String(exit),
          },
        });
        expect(result.status).toBe(0);
        expect(result.stdout).toBe(`authentication=${expected}\n`);
        expect(result.stderr).toBe('');
        expect(result.stdout).not.toContain('fixture-secret-do-not-emit');
        expect(readdirSync(directory)).toEqual(['bin']);
      })
  );
});
