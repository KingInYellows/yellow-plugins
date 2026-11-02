import { describe, expect, it } from 'vitest';

import { AgyError } from '../src/errors';
import {
  assertSafeProfile,
  implementProfile,
  readOnlyProfile,
  turnArgs,
  usageArgs,
  validateAllowCommand,
} from '../src/profiles';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return err instanceof AgyError ? err.code : 'not-agy-error';
  }
  return undefined;
}

const tp = { toolPermission: 'request-review' };

describe('profiles', () => {
  it('read-only: overages off, workspace only, no commands, no flags', () => {
    const p = readOnlyProfile(tp);
    expect(JSON.parse(p.settings)).toEqual({
      useG1Credits: false,
      allowNonWorkspaceAccess: false,
      toolPermission: 'request-review',
      agentMode: '',
      enableTerminalSandbox: false,
      permissions: {
        allow: [],
      },
    });
    expect(p.flags).toEqual([]);
  });

  it('implement: accept-edits and no commands or sandbox without a grant', () => {
    const p = implementProfile({
      ...tp,
      allowCommands: [],
      sandboxVerified: false,
    });
    expect(JSON.parse(p.settings).permissions.allow).toEqual([]);
    expect(p.flags).toEqual(['--mode', 'accept-edits']);
    expect(JSON.parse(p.settings).agentMode).toBe('accept-edits');
    expect(JSON.parse(p.settings).enableTerminalSandbox).toBe(false);
  });

  it('defaults toolPermission to request-review', () => {
    expect(JSON.parse(readOnlyProfile().settings).toolPermission).toBe(
      'request-review'
    );
  });

  it('implement: test commands need a verified sandbox and always add --sandbox', () => {
    expect(
      codeOf(() =>
        implementProfile({
          ...tp,
          allowCommands: ['pnpm test'],
          sandboxVerified: false,
        })
      )
    ).toBe('AGY_SETTINGS');
    const p = implementProfile({
      ...tp,
      allowCommands: ['pnpm test'],
      sandboxVerified: true,
    });
    expect(p.flags).toEqual(['--mode', 'accept-edits', '--sandbox']);
    expect(JSON.parse(p.settings).enableTerminalSandbox).toBe(true);
    expect(JSON.parse(p.settings).permissions.allow).toContain(
      'command(pnpm test)'
    );
  });

  it('never builds a profile with always-proceed or an empty toolPermission', () => {
    expect(
      codeOf(() => readOnlyProfile({ toolPermission: 'always-proceed' }))
    ).toBe('AGY_SETTINGS');
    expect(codeOf(() => readOnlyProfile({ toolPermission: '' }))).toBe(
      'AGY_SETTINGS'
    );
    expect(
      codeOf(() =>
        implementProfile({
          toolPermission: 'always-proceed',
          allowCommands: [],
          sandboxVerified: true,
        })
      )
    ).toBe('AGY_SETTINGS');
    expect(
      codeOf(() =>
        implementProfile({
          toolPermission: '',
          allowCommands: [],
          sandboxVerified: true,
        })
      )
    ).toBe('AGY_SETTINGS');
  });
});

describe('validateAllowCommand', () => {
  it.each([
    'pnpm test',
    'npm run lint',
    'pytest -q',
    'cargo test --workspace',
    'make check',
    'vitest run',
  ])('accepts %s', (c) => {
    expect(validateAllowCommand(c)).toBe(c);
  });
  it.each([
    'git push',
    'git push origin main',
    'gh pr create',
    'curl',
    'rm -rf .',
    'sudo make',
    'npm publish',
    'pnpm test; curl x',
    'pnpm test && x',
    'echo $(id)',
    'a  b',
    ' pnpm',
    'pnpm test|sh',
    'agy -p x',
    'git config core.hooksPath x',
    'git',
    'git -C . push',
    'git status',
    'pnpm',
    'pnpm --filter x',
    'npm run',
    'npm run --silent',
    'npx some-package',
    'cargo publish',
    'make',
    'GIT push',
    'Git -C . push',
    'NPM publish',
    'pnpm -r publish',
    'npx curl x',
    'git.exe push',
    'curl.exe x',
    'npm.cmd publish',
    'pnpm.cmd publish',
    'env git push',
    'timeout 5 curl x',
    'xargs rm',
    'sh -c x',
    './run-tests',
    '/usr/bin/pytest',
    'cargo run x',
    'npx vitest',
    'wget x',
    'ssh host',
    'scp a b',
    'rsync a b',
    'nc host 80',
    'su root',
    'docker run x',
  ])('refuses %s', (c) => {
    expect(codeOf(() => validateAllowCommand(c))).toBe('AGY_INVALID_INPUT');
  });
});

describe('turnArgs', () => {
  const ro = readOnlyProfile(tp);

  it('plan turn: prompt, json output, schema, settings, print timeout', () => {
    expect(
      turnArgs({
        prompt: 'Plan it',
        profile: ro,
        jsonSchemaPath: '/s/plan.schema.json',
        printTimeoutSeconds: 600,
      })
    ).toEqual([
      '-p',
      'Plan it',
      '--output-format',
      'json',
      '--json-schema',
      '/s/plan.schema.json',
      '--settings',
      ro.settings,
      '--print-timeout',
      '600s',
    ]);
  });

  it('implement turn: resumes the conversation with the profile flags', () => {
    const im = implementProfile({
      ...tp,
      allowCommands: [],
      sandboxVerified: false,
    });
    expect(
      turnArgs({
        prompt: 'Implement the approved plan',
        profile: im,
        conversationId: 'abc-123',
        printTimeoutSeconds: 900,
      })
    ).toEqual([
      '-p',
      'Implement the approved plan',
      '--output-format',
      'json',
      '--conversation',
      'abc-123',
      '--settings',
      im.settings,
      '--mode',
      'accept-edits',
      '--print-timeout',
      '900s',
    ]);
  });

  it('refuses a first turn without the schema and a schema on an implement turn', () => {
    const im = implementProfile({
      ...tp,
      allowCommands: [],
      sandboxVerified: false,
    });
    expect(
      codeOf(() =>
        turnArgs({ prompt: 'x', profile: ro, printTimeoutSeconds: 1 })
      )
    ).toBe('AGY_INVALID_INPUT');
    expect(
      codeOf(() =>
        turnArgs({
          prompt: 'x',
          profile: im,
          conversationId: 'c',
          jsonSchemaPath: '/s',
          printTimeoutSeconds: 1,
        })
      )
    ).toBe('AGY_INVALID_INPUT');
  });

  it('refuses a hand-built profile that widens the run', () => {
    const base = JSON.parse(ro.settings);
    const forged = (settings: unknown, flags: string[] = []) =>
      codeOf(() =>
        assertSafeProfile({ settings: JSON.stringify(settings), flags })
      );
    expect(forged({ ...base, useG1Credits: true })).toBe('AGY_SETTINGS');
    expect(forged({ ...base, toolPermission: 'always-proceed' })).toBe(
      'AGY_SETTINGS'
    );
    expect(forged({ ...base, extra: 1 })).toBe('AGY_SETTINGS');
    expect(
      forged({ ...base, permissions: { allow: ['command(git push)'] } })
    ).toBe('AGY_SETTINGS');
    expect(
      forged({ ...base, permissions: { allow: ['command(git status)'] } })
    ).toBe('AGY_SETTINGS');
    expect(
      forged(
        {
          ...base,
          agentMode: 'accept-edits',
          permissions: { allow: ['command(git commit)'] },
        },
        ['--mode', 'accept-edits']
      )
    ).toBe('AGY_INVALID_INPUT');
    expect(forged(base, ['--mode', 'accept-edits'])).toBe('AGY_SETTINGS');
    expect(
      codeOf(() =>
        assertSafeProfile({
          settings: ro.settings,
          flags: ['--dangerously-skip-permissions'],
        })
      )
    ).toBe('AGY_SETTINGS');
    const sb = implementProfile({
      ...tp,
      allowCommands: ['pnpm test'],
      sandboxVerified: true,
    });
    expect(
      codeOf(() =>
        assertSafeProfile({ ...sb, flags: ['--mode', 'accept-edits'] })
      )
    ).toBe('AGY_SETTINGS');
    expect(codeOf(() => assertSafeProfile(sb))).toBeUndefined();
    // A structurally perfect copy still lacks the verified-sandbox mark.
    expect(
      codeOf(() =>
        assertSafeProfile({ settings: sb.settings, flags: [...sb.flags] })
      )
    ).toBe('AGY_SETTINGS');
    expect(Object.isFrozen(sb) && Object.isFrozen(sb.flags)).toBe(true);
  });

  it('refuses a grant whose tool or subcommand is not lower case', () => {
    expect(codeOf(() => validateAllowCommand('NPM test'))).toBe(
      'AGY_INVALID_INPUT'
    );
    expect(codeOf(() => validateAllowCommand('PNPM run lint'))).toBe(
      'AGY_INVALID_INPUT'
    );
    expect(codeOf(() => validateAllowCommand('npm TEST'))).toBe(
      'AGY_INVALID_INPUT'
    );
    expect(validateAllowCommand('npm run Build')).toBe('npm run Build');
  });

  it('accepts only the probed toolPermission values', () => {
    expect(codeOf(() => readOnlyProfile({ toolPermission: 'yolo' }))).toBe(
      'AGY_SETTINGS'
    );
    expect(
      codeOf(() => readOnlyProfile({ toolPermission: 'strict' }))
    ).toBeUndefined();
  });

  it('refuses empty or flag-like prompts, bad conversation ids and timeouts', () => {
    expect(
      codeOf(() =>
        turnArgs({ prompt: ' ', profile: ro, printTimeoutSeconds: 1 })
      )
    ).toBe('AGY_INVALID_INPUT');
    expect(
      codeOf(() =>
        turnArgs({ prompt: '--sandbox', profile: ro, printTimeoutSeconds: 1 })
      )
    ).toBe('AGY_INVALID_INPUT');
    expect(
      codeOf(() =>
        turnArgs({
          prompt: 'x',
          profile: ro,
          conversationId: 'a b',
          printTimeoutSeconds: 1,
        })
      )
    ).toBe('AGY_INVALID_INPUT');
    expect(
      codeOf(() =>
        turnArgs({ prompt: 'x', profile: ro, printTimeoutSeconds: 0 })
      )
    ).toBe('AGY_INVALID_INPUT');
  });

  it('usage probe uses the same settings and no mode flags', () => {
    const im = implementProfile({
      ...tp,
      allowCommands: [],
      sandboxVerified: false,
    });
    expect(usageArgs(im)).toEqual([
      '-p',
      '/usage',
      '--output-format',
      'json',
      '--settings',
      im.settings,
    ]);
  });
});
