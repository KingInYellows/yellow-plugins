import { describe, expect, it } from 'vitest';

import { AgyError } from '../src/errors';
import {
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
  it('read-only: overages off, workspace only, git read commands, no flags', () => {
    const p = readOnlyProfile(tp);
    expect(JSON.parse(p.settings)).toEqual({
      useG1Credits: false,
      allowNonWorkspaceAccess: false,
      toolPermission: 'request-review',
      agentMode: '',
      enableTerminalSandbox: false,
      permissions: {
        allow: ['command(git status)', 'command(git diff)', 'command(git log)'],
      },
    });
    expect(p.flags).toEqual([]);
  });

  it('implement: adds git add/commit and accept-edits, no sandbox without extra commands', () => {
    const p = implementProfile({
      ...tp,
      allowCommands: [],
      sandboxVerified: false,
    });
    expect(JSON.parse(p.settings).permissions.allow).toEqual([
      'command(git status)',
      'command(git diff)',
      'command(git log)',
      'command(git add)',
      'command(git commit)',
    ]);
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
  });
});

describe('validateAllowCommand', () => {
  it.each(['pnpm test', 'npm run lint', 'pytest -q', 'cargo test --workspace'])(
    'accepts %s',
    (c) => {
      expect(validateAllowCommand(c)).toBe(c);
    }
  );
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
