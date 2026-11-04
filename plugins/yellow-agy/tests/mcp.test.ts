import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { AgyError } from '../src/errors';
import type { Invocation } from '../src/invocation';
import type { McpListResult } from '../src/mcp';
import {
  assertMcpGate,
  isUnpinned,
  mcpWarnings,
  parseAllowedMcp,
  parseMcpList,
} from '../src/mcp';

const CAPTURED = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'mcp-list-1.4.12.txt'),
  'utf8'
);
const DISABLED = CAPTURED.replace(' enabled  ', ' disabled ');
const HEADER = 'NAME     TYPE   STATUS   COMMAND/URL\n';

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof AgyError ? e.code : 'not-agy-error';
  }
  return undefined;
}

describe('parseMcpList', () => {
  it('reads the captured agy 1.4.12 table', () => {
    expect(parseMcpList(CAPTURED)).toEqual([
      {
        name: 'GitHits',
        enabled: true,
        command: 'npx -y githits@latest mcp start',
      },
    ]);
  });

  it('reads disabled servers, CRLF line ends and a header-only table', () => {
    expect(parseMcpList(DISABLED.replace(/\n/g, '\r\n'))).toEqual([
      {
        name: 'GitHits',
        enabled: false,
        command: 'npx -y githits@latest mcp start',
      },
    ]);
    expect(parseMcpList(HEADER)).toEqual([]);
  });

  it('fails closed on output of any other shape', () => {
    for (const out of [
      '',
      'No MCP servers configured\n',
      '{"servers":[]}\n',
      `${HEADER}GitHits  stdio  starting  npx\n`,
      `${HEADER}GitHits\n`,
      `name type status command/url\n`,
    ]) {
      expect(code(() => parseMcpList(out))).toBe('AGY_MCP');
    }
  });
});

describe('assertMcpGate', () => {
  const run =
    (res: McpListResult, seen: Invocation[] = []) =>
    (inv: Invocation): McpListResult => {
      seen.push(inv);
      return res;
    };

  it('refuses the captured host, naming the enabled server', () => {
    let message = '';
    try {
      assertMcpGate(
        { kind: 'posix' },
        '/tmp',
        {},
        [],
        run({
          status: 0,
          stdout: CAPTURED,
          stderr: '',
        })
      );
    } catch (e) {
      expect(e).toBeInstanceOf(AgyError);
      expect((e as AgyError).code).toBe('AGY_MCP');
      message = (e as AgyError).message;
    }
    expect(message).toContain('GitHits');
  });

  it('passes when every server is disabled', () => {
    expect(
      assertMcpGate(
        { kind: 'posix' },
        '/tmp',
        {},
        [],
        run({
          status: 0,
          stdout: DISABLED,
          stderr: '',
        })
      )
    ).toMatchObject([{ name: 'GitHits', enabled: false }]);
  });

  it('refuses a nonzero exit even when stdout parses', () => {
    expect(
      code(() =>
        assertMcpGate(
          { kind: 'posix' },
          '/tmp',
          {},
          [],
          run({
            status: 1,
            stdout: HEADER,
            stderr: 'boom',
          })
        )
      )
    ).toBe('AGY_MCP');
  });

  it('runs agy mcp list through the bridge with a scrubbed env', () => {
    const seen: Invocation[] = [];
    assertMcpGate(
      { kind: 'wsl-bridge', distro: 'Ubuntu-24.04' },
      '/home/k/.local/share/yellow-agy/worktrees',
      { GEMINI_API_KEY: 'x', PATH: '/usr/bin' },
      [],
      run({ status: 0, stdout: HEADER, stderr: 'yellow-agy-pgid:42\n' }, seen)
    );
    const inv = seen[0] as Invocation;
    expect(inv.file).toBe('wsl.exe');
    expect(inv.args.slice(-3)).toEqual(['agy', 'mcp', 'list']);
    expect(inv.args).toContain('-u');
    expect(inv.env['GEMINI_API_KEY']).toBeUndefined();
  });
});

describe('MCP allowlist', () => {
  const ok = (stdout: string) => () => ({ status: 0, stdout, stderr: '' });
  const TWO = `${HEADER}GitHits  stdio  enabled  npx -y githits@latest mcp start\nOther  stdio  enabled  /usr/bin/other\n`;

  it('passes an enabled server the owner allowed by name', () => {
    expect(
      assertMcpGate({ kind: 'posix' }, '/tmp', {}, ['GitHits'], ok(CAPTURED))
    ).toMatchObject([{ name: 'GitHits', enabled: true }]);
  });

  it('still refuses enabled servers that are not allowed, and names only those', () => {
    let message = '';
    try {
      assertMcpGate({ kind: 'posix' }, '/tmp', {}, ['GitHits'], ok(TWO));
    } catch (e) {
      expect((e as AgyError).code).toBe('AGY_MCP');
      message = (e as AgyError).message;
    }
    expect(message).toContain('Other');
    expect(message).not.toContain('GitHits');
  });

  it('matches names exactly', () => {
    expect(
      code(() =>
        assertMcpGate({ kind: 'posix' }, '/tmp', {}, ['githits'], ok(CAPTURED))
      )
    ).toBe('AGY_MCP');
  });

  it('validates --allow-mcp names', () => {
    expect(parseAllowedMcp(undefined)).toEqual([]);
    expect(parseAllowedMcp(['GitHits', 'GitHits'])).toEqual(['GitHits']);
    for (const bad of [[''], ['a b'], ['x;rm'], [42]]) {
      expect(code(() => parseAllowedMcp(bad))).toBe('AGY_INVALID_INPUT');
    }
  });

  it('flags unpinned launchers and accepts exact versions', () => {
    expect(isUnpinned('npx -y githits@latest mcp start')).toBe(true);
    expect(isUnpinned('npx -y githits mcp start')).toBe(true);
    expect(isUnpinned('npx -y githits@1 mcp start')).toBe(true);
    expect(isUnpinned('npx -y githits@1.2.3 mcp start')).toBe(false);
    expect(isUnpinned('uvx tool==0.4.1')).toBe(false);
    expect(isUnpinned('/usr/bin/other --stdio')).toBe(false);
  });

  it('warns about each allowed enabled server and its unpinned launch', () => {
    const servers = parseMcpList(CAPTURED);
    const w = mcpWarnings(servers, ['GitHits']);
    expect(w).toHaveLength(2);
    expect(w[1]).toContain('githits@latest');
    expect(mcpWarnings(servers, [])).toEqual([]);
  });
});
