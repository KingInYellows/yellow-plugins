/**
 * Per-run permission profiles passed to agy as `--settings <json>` and the
 * argv for each kind of turn (contract-v0 "Permission profiles" and "Run
 * lifecycle"). Pure builders: the guards here are the last place a wider
 * permission could slip into a run, so they throw instead of degrading.
 */

import { AgyError } from './errors';

export const READ_ONLY_COMMANDS = [
  'git status',
  'git diff',
  'git log',
] as const;
export const IMPLEMENT_EXTRA_COMMANDS = ['git add', 'git commit'] as const;

/**
 * First words (or first two words) a grant can never allow: anything that
 * reaches the network, publishes, or changes git remotes. `agy never pushes`.
 */
const DENIED_COMMAND_PREFIXES = [
  'git push',
  'git remote',
  'git fetch',
  'git pull',
  'git clone',
  'git submodule',
  'git config',
  'gh',
  'curl',
  'wget',
  'ssh',
  'scp',
  'rsync',
  'nc',
  'sudo',
  'su',
  'npm publish',
  'pnpm publish',
  'yarn publish',
  'docker',
  'agy',
  'rm',
] as const;

/** A plain command: words of safe characters separated by single spaces. */
const COMMAND_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+=-]*( [A-Za-z0-9._:/@+=-]+)*$/;

export interface ProfileOptions {
  /** The probed toolPermission value that runs headless; never always-proceed. */
  readonly toolPermission: string;
}

export interface ImplementOptions extends ProfileOptions {
  /** The grant's --allow-command entries (test and lint commands). */
  readonly allowCommands: readonly string[];
  /** True only on a host where --sandbox was verified to confine files and network. */
  readonly sandboxVerified: boolean;
}

export interface TurnProfile {
  /** The --settings JSON, already serialized. */
  readonly settings: string;
  /** Extra flags the profile requires on the turn, e.g. --mode, --sandbox. */
  readonly flags: readonly string[];
}

/** Throws unless `command` is a plain command a grant may allow. */
export function validateAllowCommand(command: string): string {
  if (!COMMAND_RE.test(command) || command.length > 200) {
    throw new AgyError(
      'AGY_INVALID_INPUT',
      `--allow-command must be plain words without shell syntax: ${JSON.stringify(command)}`
    );
  }
  for (const prefix of DENIED_COMMAND_PREFIXES) {
    if (command === prefix || command.startsWith(`${prefix} `)) {
      throw new AgyError(
        'AGY_INVALID_INPUT',
        `--allow-command ${JSON.stringify(command)} is never allowed in a delegated run`
      );
    }
  }
  return command;
}

function checkToolPermission(value: string): void {
  if (value === '' || value === 'always-proceed') {
    throw new AgyError(
      'AGY_SETTINGS',
      `refusing to build a profile with toolPermission ${JSON.stringify(value)}`
    );
  }
}

function settingsJson(
  toolPermission: string,
  commands: readonly string[]
): string {
  return JSON.stringify({
    useG1Credits: false,
    allowNonWorkspaceAccess: false,
    toolPermission,
    permissions: { allow: commands.map((c) => `command(${c})`) },
  });
}

export function readOnlyProfile(options: ProfileOptions): TurnProfile {
  checkToolPermission(options.toolPermission);
  return {
    settings: settingsJson(options.toolPermission, READ_ONLY_COMMANDS),
    flags: [],
  };
}

export function implementProfile(options: ImplementOptions): TurnProfile {
  checkToolPermission(options.toolPermission);
  const extra = options.allowCommands.map(validateAllowCommand);
  if (extra.length > 0 && !options.sandboxVerified) {
    throw new AgyError(
      'AGY_SETTINGS',
      'test and lint commands need a host where --sandbox is verified; this host has none'
    );
  }
  const commands = [
    ...READ_ONLY_COMMANDS,
    ...IMPLEMENT_EXTRA_COMMANDS,
    ...extra,
  ];
  const flags = ['--mode', 'accept-edits'];
  if (extra.length > 0) flags.push('--sandbox');
  return { settings: settingsJson(options.toolPermission, commands), flags };
}

export interface TurnArgsOptions {
  readonly prompt: string;
  readonly profile: TurnProfile;
  /** Absent for the first (plan) turn. */
  readonly conversationId?: string;
  /** Path to plan.schema.json; plan turns and PLAN_PENDING corrections only. */
  readonly jsonSchemaPath?: string;
  /** Seconds before agy stops the turn itself. */
  readonly printTimeoutSeconds: number;
}

const CONVERSATION_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** The agy argv (without the binary) for one model turn. */
export function turnArgs(options: TurnArgsOptions): string[] {
  if (options.prompt.trim() === '') {
    throw new AgyError('AGY_INVALID_INPUT', 'the prompt is empty');
  }
  // A prompt that starts with "-" could be read as a flag by agy's parser.
  if (options.prompt.startsWith('-')) {
    throw new AgyError(
      'AGY_INVALID_INPUT',
      'the prompt may not start with "-"'
    );
  }
  if (
    !Number.isInteger(options.printTimeoutSeconds) ||
    options.printTimeoutSeconds < 1
  ) {
    throw new AgyError(
      'AGY_INVALID_INPUT',
      'printTimeoutSeconds must be a positive integer'
    );
  }
  const args = ['-p', options.prompt, '--output-format', 'json'];
  if (options.conversationId !== undefined) {
    if (!CONVERSATION_RE.test(options.conversationId)) {
      throw new AgyError(
        'AGY_INVALID_INPUT',
        `invalid conversation id ${JSON.stringify(options.conversationId)}`
      );
    }
    args.push('--conversation', options.conversationId);
  }
  if (options.jsonSchemaPath !== undefined) {
    args.push('--json-schema', options.jsonSchemaPath);
  }
  args.push('--settings', options.profile.settings, ...options.profile.flags);
  args.push('--print-timeout', `${options.printTimeoutSeconds}s`);
  return args;
}

/** The argv for the quota probe: same profile as the turn it guards, no model cost. */
export function usageArgs(profile: TurnProfile): string[] {
  return [
    '-p',
    '/usage',
    '--output-format',
    'json',
    '--settings',
    profile.settings,
  ];
}
