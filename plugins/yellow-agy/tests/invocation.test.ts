import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AgyError } from '../src/errors';
import {
  AUTH_MODE_VARS,
  BRIDGE_GROUP_SCRIPT,
  BRIDGE_UNSET_VARS,
  authModeVarsSet,
  buildInvocation,
  hookConfig,
  scrubEnv,
  windowsCommandLineLength,
  WINDOWS_ARGV_LIMIT,
  filterDriverNames,
} from '../src/invocation';

const dirtyEnv = {
  PATH: '/usr/bin',
  HOME: '/home/owner',
  GEMINI_API_KEY: 'k',
  google_api_key: 'lower-case on Windows',
  GOOGLE_GENAI_USE_VERTEXAI: 'true',
  GOOGLE_CLOUD_PROJECT: 'p',
  GOOGLE_APPLICATION_CREDENTIALS: '/c.json',
  AGY_ADC_AUTH: '1',
  WSLENV: 'GEMINI_API_KEY/u',
  GIT_CONFIG_COUNT: '3',
  GIT_CONFIG_PARAMETERS: "'core.hooksPath=/evil'",
  UNSET: undefined,
};

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return err instanceof AgyError ? err.code : 'not-agy-error';
  }
  return undefined;
}

describe('scrubEnv', () => {
  it('drops every auth-mode variable, WSLENV and caller git config, case-insensitively', () => {
    const env = scrubEnv(dirtyEnv);
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/owner' });
  });

  it('reports set auth-mode variable names only', () => {
    expect(authModeVarsSet(dirtyEnv)).toEqual([...AUTH_MODE_VARS].sort());
    expect(authModeVarsSet({ GEMINI_API_KEY: '' })).toEqual([]);
  });
});

describe('buildInvocation', () => {
  it('posix: plain agy, scrubbed env, hooks off via /dev/null', () => {
    const inv = buildInvocation({ kind: 'posix' }, ['-p', 'hi'], {
      cwd: '/w',
      baseEnv: dirtyEnv,
      filterDrivers: [],
    });
    expect(inv.file).toBe('agy');
    expect(inv.args).toEqual(['-p', 'hi']);
    expect(inv.cwd).toBe('/w');
    expect(inv.env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/owner',
      ...hookConfig('/dev/null', []),
    });
  });

  it('windows-native: agy.exe with NUL as the hooks path', () => {
    const inv = buildInvocation({ kind: 'windows-native' }, ['-p', 'hi'], {
      cwd: 'C:\\w',
      baseEnv: {},
      filterDrivers: [],
    });
    expect(inv.file).toBe('agy.exe');
    expect(inv.env['GIT_CONFIG_VALUE_0']).toBe('NUL');
  });

  it('wsl-bridge: exec-only argv that scrubs and sets git config inside the distro', () => {
    const inv = buildInvocation(
      { kind: 'wsl-bridge', distro: 'Ubuntu-24.04' },
      ['-p', 'do "this"; rm -rf /'],
      {
        cwd: '/home/owner/.local/share/yellow-agy/worktrees/t1',
        baseEnv: dirtyEnv,
        filterDrivers: [],
      }
    );
    expect(inv.file).toBe('wsl.exe');
    expect(inv.cwd).toBeUndefined();
    const unsets = BRIDGE_UNSET_VARS.flatMap((v) => ['-u', v]);
    expect(inv.args).toEqual([
      '-d',
      'Ubuntu-24.04',
      '--cd',
      '/home/owner/.local/share/yellow-agy/worktrees/t1',
      '-e',
      'env',
      ...unsets,
      ...Object.entries(hookConfig('/dev/null', [])).map(
        ([k, v]) => `${k}=${v}`
      ),
      'setsid',
      '-w',
      'sh',
      '-c',
      BRIDGE_GROUP_SCRIPT,
      'sh',
      'agy',
      '-p',
      'do "this"; rm -rf /',
    ]);
    expect(inv.linuxGroup).toEqual({ distro: 'Ubuntu-24.04' });
    expect(inv.args).not.toContain('--');
    expect(inv.env['WSLENV']).toBeUndefined();
    expect(inv.env['GEMINI_API_KEY']).toBeUndefined();
  });

  it('wsl-bridge: default distro omits -d', () => {
    const inv = buildInvocation({ kind: 'wsl-bridge' }, ['-p', 'x'], {
      cwd: '/home/o/w',
      baseEnv: {},
      filterDrivers: [],
    });
    expect(inv.args.slice(0, 2)).toEqual(['--cd', '/home/o/w']);
  });

  it('scrubs every GIT_* variable, including repository routing', () => {
    const inv = buildInvocation({ kind: 'posix' }, ['-p', 'x'], {
      cwd: '/w',
      baseEnv: {
        GIT_DIR: '/elsewhere/.git',
        GIT_WORK_TREE: '/e',
        git_index_file: '/i',
        KEEP: '1',
      },
      filterDrivers: [],
    });
    expect(inv.env['GIT_DIR']).toBeUndefined();
    expect(inv.env['GIT_WORK_TREE']).toBeUndefined();
    expect(inv.env['git_index_file']).toBeUndefined();
    expect(inv.env['KEEP']).toBe('1');
  });

  it('wsl-bridge: refuses traversal segments that could reach /mnt', () => {
    for (const cwd of [
      '/home/o/../../mnt/c',
      '/home/./o',
      '/home//o',
      '/mnt',
      '/',
    ]) {
      expect(
        codeOf(() =>
          buildInvocation({ kind: 'wsl-bridge' }, ['-p', 'x'], {
            cwd,
            baseEnv: {},
            filterDrivers: [],
          })
        )
      ).toBe('AGY_BRIDGE');
    }
  });

  it('counts doubled trailing backslashes in quoted Windows arguments', () => {
    expect(windowsCommandLineLength('a', ['b c\\\\'])).toBe(
      'a "b c\\\\\\\\"'.length
    );
  });

  it('wsl-bridge: refuses /mnt paths, relative paths and odd distro names', () => {
    expect(
      codeOf(() =>
        buildInvocation({ kind: 'wsl-bridge' }, ['-p', 'x'], {
          cwd: '/mnt/c/repo',
          baseEnv: {},
          filterDrivers: [],
        })
      )
    ).toBe('AGY_BRIDGE');
    expect(
      codeOf(() =>
        buildInvocation({ kind: 'wsl-bridge' }, ['-p', 'x'], {
          cwd: 'repo',
          baseEnv: {},
          filterDrivers: [],
        })
      )
    ).toBe('AGY_BRIDGE');
    expect(
      codeOf(() =>
        buildInvocation({ kind: 'wsl-bridge', distro: 'a b' }, ['-p', 'x'], {
          cwd: '/home/o',
          baseEnv: {},
          filterDrivers: [],
        })
      )
    ).toBe('AGY_INVALID_INPUT');
    expect(
      codeOf(() =>
        buildInvocation({ kind: 'wsl-bridge', distro: '-e' }, ['-p', 'x'], {
          cwd: '/home/o',
          baseEnv: {},
          filterDrivers: [],
        })
      )
    ).toBe('AGY_INVALID_INPUT');
  });

  it('never passes --dangerously-skip-permissions on any host', () => {
    for (const host of [
      { kind: 'posix' },
      { kind: 'windows-native' },
      { kind: 'wsl-bridge' },
    ] as const) {
      expect(
        codeOf(() =>
          buildInvocation(host, ['--dangerously-skip-permissions'], {
            cwd: '/home/o',
            baseEnv: {},
            filterDrivers: [],
          })
        )
      ).toBe('AGY_INTERNAL');
      expect(
        codeOf(() =>
          buildInvocation(host, ['--dangerously-skip-permissions=true'], {
            cwd: '/home/o',
            baseEnv: {},
            filterDrivers: [],
          })
        )
      ).toBe('AGY_INTERNAL');
    }
  });

  it('refuses an over-long Windows command line before spawning', () => {
    const long = 'x'.repeat(WINDOWS_ARGV_LIMIT);
    expect(
      codeOf(() =>
        buildInvocation({ kind: 'wsl-bridge' }, ['-p', long], {
          cwd: '/home/o',
          baseEnv: {},
          filterDrivers: [],
        })
      )
    ).toBe('AGY_PROMPT_TOO_LONG');
    expect(
      codeOf(() =>
        buildInvocation({ kind: 'windows-native' }, ['-p', long], {
          cwd: 'C:\\w',
          baseEnv: {},
          filterDrivers: [],
        })
      )
    ).toBe('AGY_PROMPT_TOO_LONG');
    // POSIX has no such limit here.
    expect(
      codeOf(() =>
        buildInvocation({ kind: 'posix' }, ['-p', long], {
          cwd: '/w',
          baseEnv: {},
          filterDrivers: [],
        })
      )
    ).toBeUndefined();
  });

  it('counts quotes and escapes in the Windows command line length', () => {
    expect(windowsCommandLineLength('a', ['b'])).toBe(3);
    expect(windowsCommandLineLength('a', ['b c'])).toBe(7);
    expect(windowsCommandLineLength('a', ['"'])).toBe(6);
  });
});

describe('injected git config', () => {
  it('git status runs no configured fsmonitor or hook script', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agy-fsmon-'));
    try {
      const git = (args: string[], env?: Record<string, string>) =>
        execFileSync('git', args, { cwd: dir, env, stdio: 'pipe' });
      git(['init', '-q']);
      const marker = join(dir, 'ran');
      writeFileSync(join(dir, 'monitor.sh'), `#!/bin/sh\ntouch '${marker}'\n`, {
        mode: 0o755,
      });
      git(['config', 'core.fsmonitor', './monitor.sh']);
      const inv = buildInvocation({ kind: 'posix' }, ['-p', 'x'], {
        cwd: dir,
        baseEnv: { PATH: process.env['PATH'], HOME: dir },
        filterDrivers: [],
      });
      git(['status', '--porcelain'], { ...inv.env });
      expect(existsSync(marker)).toBe(false);
      git(['status', '--porcelain'], {
        PATH: process.env['PATH'] ?? '',
        HOME: dir,
      });
      expect(existsSync(marker)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('git status and git add run no named filter driver', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agy-filter-'));
    try {
      const git = (args: string[], env?: Record<string, string>) =>
        execFileSync('git', args, { cwd: dir, env, stdio: 'pipe' });
      git(['init', '-q']);
      const marker = join(dir, 'ran');
      writeFileSync(join(dir, 'f.sh'), `#!/bin/sh\ntouch '${marker}'\ncat\n`, {
        mode: 0o755,
      });
      git(['config', 'filter.demo.clean', 'sh ./f.sh']);
      writeFileSync(join(dir, '.gitattributes'), 'd.txt filter=demo\n');
      writeFileSync(join(dir, 'd.txt'), 'hi\n');
      const inv = buildInvocation({ kind: 'posix' }, ['-p', 'x'], {
        cwd: dir,
        baseEnv: { PATH: process.env['PATH'], HOME: dir },
        filterDrivers: ['demo'],
      });
      git(['status', '--porcelain'], { ...inv.env });
      git(['add', 'd.txt'], { ...inv.env });
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parses filter driver names from git config --name-only output', () => {
    expect(
      filterDriverNames(
        'filter.lfs.clean\nfilter.lfs.smudge\r\nfilter.a.b.process\n\n'
      )
    ).toEqual(['a.b', 'lfs']);
    expect(filterDriverNames('')).toEqual([]);
    expect(() => filterDriverNames('lfs\n')).toThrow(AgyError);
    expect(() => filterDriverNames('filter.lfs\n')).toThrow(AgyError);
  });

  it('the parsed names turn off a real filter driver', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agy-filter2-'));
    try {
      const git = (args: string[], env?: Record<string, string>) =>
        execFileSync('git', args, { cwd: dir, env, stdio: 'pipe' });
      git(['init', '-q']);
      const marker = join(dir, 'ran');
      writeFileSync(join(dir, 'f.sh'), `#!/bin/sh\ntouch '${marker}'\ncat\n`, {
        mode: 0o755,
      });
      git(['config', 'filter.x.y.clean', 'sh ./f.sh']);
      writeFileSync(join(dir, '.gitattributes'), 'd.txt filter=x.y\n');
      writeFileSync(join(dir, 'd.txt'), 'hi\n');
      const names = filterDriverNames(
        git(['config', '--name-only', '--get-regexp', '^filter\\.']).toString()
      );
      expect(names).toContain('x.y');
      const inv = buildInvocation({ kind: 'posix' }, ['-p', 'x'], {
        cwd: dir,
        baseEnv: { PATH: process.env['PATH'], HOME: dir },
        filterDrivers: names,
      });
      git(['add', 'd.txt'], { ...inv.env });
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('unsets the program-running git variables on the bridge', () => {
    for (const name of [
      'GIT_EDITOR',
      'GIT_EXTERNAL_DIFF',
      'GIT_PAGER',
      'GIT_ASKPASS',
      'GIT_SEQUENCE_EDITOR',
      'GIT_PROXY_COMMAND',
    ]) {
      expect(BRIDGE_UNSET_VARS).toContain(name);
    }
  });

  it('refuses a filter driver name that could inject config', () => {
    expect(() =>
      buildInvocation({ kind: 'posix' }, ['-p', 'x'], {
        cwd: '/w',
        baseEnv: {},
        filterDrivers: ['x.clean=evil y'],
      })
    ).toThrow(AgyError);
  });

  it('git commit runs no configured editor or signing program', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agy-commit-'));
    try {
      const marker = join(dir, 'ran');
      const inv = buildInvocation({ kind: 'posix' }, ['-p', 'x'], {
        cwd: dir,
        baseEnv: { PATH: process.env['PATH'], HOME: dir },
        filterDrivers: [],
      });
      const git = (args: string[]) =>
        execFileSync('git', args, {
          cwd: dir,
          env: { ...inv.env },
          stdio: 'pipe',
        });
      git(['init', '-q']);
      writeFileSync(join(dir, 'x.sh'), `#!/bin/sh\ntouch '${marker}'\n`, {
        mode: 0o755,
      });
      git(['config', 'user.email', 'a@b']);
      git(['config', 'user.name', 'a']);
      git(['config', 'core.editor', './x.sh']);
      git(['config', 'gpg.program', './x.sh']);
      git(['commit', '--allow-empty', '-m', 'm', '--edit']);
      expect(() => git(['commit', '--allow-empty', '-m', 'm', '-S'])).toThrow();
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
