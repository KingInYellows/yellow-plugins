import { describe, expect, it } from 'vitest';

import { AgyError } from '../src/errors';
import {
  AUTH_MODE_VARS,
  authModeVarsSet,
  buildInvocation,
  scrubEnv,
  windowsCommandLineLength,
  WINDOWS_ARGV_LIMIT,
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
    });
    expect(inv.file).toBe('agy');
    expect(inv.args).toEqual(['-p', 'hi']);
    expect(inv.cwd).toBe('/w');
    expect(inv.env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/owner',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.hooksPath',
      GIT_CONFIG_VALUE_0: '/dev/null',
    });
  });

  it('windows-native: agy.exe with NUL as the hooks path', () => {
    const inv = buildInvocation({ kind: 'windows-native' }, ['-p', 'hi'], {
      cwd: 'C:\\w',
      baseEnv: {},
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
      }
    );
    expect(inv.file).toBe('wsl.exe');
    expect(inv.cwd).toBeUndefined();
    const unsets = AUTH_MODE_VARS.flatMap((v) => ['-u', v]);
    expect(inv.args).toEqual([
      '-d',
      'Ubuntu-24.04',
      '--cd',
      '/home/owner/.local/share/yellow-agy/worktrees/t1',
      '-e',
      'env',
      ...unsets,
      'GIT_CONFIG_COUNT=1',
      'GIT_CONFIG_KEY_0=core.hooksPath',
      'GIT_CONFIG_VALUE_0=/dev/null',
      'agy',
      '-p',
      'do "this"; rm -rf /',
    ]);
    expect(inv.args).not.toContain('--');
    expect(inv.env['WSLENV']).toBeUndefined();
    expect(inv.env['GEMINI_API_KEY']).toBeUndefined();
  });

  it('wsl-bridge: default distro omits -d', () => {
    const inv = buildInvocation({ kind: 'wsl-bridge' }, ['-p', 'x'], {
      cwd: '/home/o/w',
      baseEnv: {},
    });
    expect(inv.args.slice(0, 2)).toEqual(['--cd', '/home/o/w']);
  });

  it('wsl-bridge: refuses /mnt paths, relative paths and odd distro names', () => {
    expect(
      codeOf(() =>
        buildInvocation({ kind: 'wsl-bridge' }, ['-p', 'x'], {
          cwd: '/mnt/c/repo',
          baseEnv: {},
        })
      )
    ).toBe('AGY_BRIDGE');
    expect(
      codeOf(() =>
        buildInvocation({ kind: 'wsl-bridge' }, ['-p', 'x'], {
          cwd: 'repo',
          baseEnv: {},
        })
      )
    ).toBe('AGY_BRIDGE');
    expect(
      codeOf(() =>
        buildInvocation({ kind: 'wsl-bridge', distro: 'a b' }, ['-p', 'x'], {
          cwd: '/home/o',
          baseEnv: {},
        })
      )
    ).toBe('AGY_INVALID_INPUT');
    expect(
      codeOf(() =>
        buildInvocation({ kind: 'wsl-bridge', distro: '-e' }, ['-p', 'x'], {
          cwd: '/home/o',
          baseEnv: {},
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
          })
        )
      ).toBe('AGY_INTERNAL');
      expect(
        codeOf(() =>
          buildInvocation(host, ['--dangerously-skip-permissions=true'], {
            cwd: '/home/o',
            baseEnv: {},
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
        })
      )
    ).toBe('AGY_PROMPT_TOO_LONG');
    expect(
      codeOf(() =>
        buildInvocation({ kind: 'windows-native' }, ['-p', long], {
          cwd: 'C:\\w',
          baseEnv: {},
        })
      )
    ).toBe('AGY_PROMPT_TOO_LONG');
    // POSIX has no such limit here.
    expect(
      codeOf(() =>
        buildInvocation({ kind: 'posix' }, ['-p', long], {
          cwd: '/w',
          baseEnv: {},
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
