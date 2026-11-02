/**
 * Per-run permission profiles passed to agy as `--settings <json>` and the
 * argv for each kind of turn (contract-v0 "Permission profiles" and "Run
 * lifecycle"). Pure builders: the guards here are the last place a wider
 * permission could slip into a run, so they throw instead of degrading.
 */

import { AgyError } from './errors';

/*
 * No profile allows git. A command rule matches any trailing arguments, and
 * git's options and config reach executables (`--output`, `--ignore-submodules`,
 * `--trailer`, editors, signers, filters). The model reads and edits files with
 * its own tools, and `collect` captures its uncommitted changes as a patch.
 */

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

/** Probed 2026-11: the default value; an unapproved call is soft-denied at once headless. */
export const DEFAULT_TOOL_PERMISSION = 'request-review';

export interface ProfileOptions {
  /** A toolPermission value that runs headless; never always-proceed. */
  readonly toolPermission?: string;
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

/**
 * Package and build tools whose subcommands can publish or run arbitrary code.
 * A grant for one must name a safe subcommand, because a rule matches every
 * argument after its words: `pnpm` alone would allow `pnpm publish`, and
 * `pnpm --filter x` would allow `pnpm --filter x publish`. npx, pnpx and bunx
 * are left out: they fetch and run packages by name.
 */
const SUBCOMMAND_TOOLS = new Set([
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'cargo',
  'go',
  'pip',
  'pip3',
  'uv',
  'poetry',
  'gem',
  'bundle',
  'dotnet',
  'mvn',
  'gradle',
  'make',
]);
/** Only these run a named package script with `run <script>`. */
const SCRIPT_RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const SAFE_SUBCOMMANDS = new Set([
  'test',
  'lint',
  'check',
  'build',
  'typecheck',
  'fmt',
  'format',
  'clippy',
  'vet',
]);
/**
 * Test and lint tools a grant may name on their own. The first word of a grant
 * must be one of these or a SUBCOMMAND_TOOLS entry, so wrappers (`env`,
 * `timeout`, `xargs`, shells), paths and `.exe`/`.cmd` spellings are refused.
 */
const STANDALONE_TOOLS = new Set([
  'pytest',
  'tox',
  'nox',
  'jest',
  'vitest',
  'mocha',
  'eslint',
  'prettier',
  'tsc',
  'ruff',
  'mypy',
  'black',
  'flake8',
  'pylint',
  'rspec',
  'bats',
  'shellcheck',
  'phpunit',
  'ctest',
]);

function refuse(command: string, why: string): never {
  throw new AgyError(
    'AGY_INVALID_INPUT',
    `--allow-command ${JSON.stringify(command)} ${why}`
  );
}

/** Throws unless `command` is a plain command a grant may allow. */
export function validateAllowCommand(command: string): string {
  if (!COMMAND_RE.test(command) || command.length > 200) {
    throw new AgyError(
      'AGY_INVALID_INPUT',
      `--allow-command must be plain words without shell syntax: ${JSON.stringify(command)}`
    );
  }
  // Windows resolves executables case-insensitively, so compare lower-cased.
  const lower = command.toLowerCase();
  const words = lower.split(' ');
  const tool = words[0] ?? '';
  // No profile allows git; a grant can't add it (git -C . push).
  if (tool === 'git') refuse(command, 'may not grant git');
  if (SUBCOMMAND_TOOLS.has(tool)) {
    const sub = words[1] ?? '';
    const script = words[2] ?? '';
    const runsScript =
      SCRIPT_RUNNERS.has(tool) &&
      (sub === 'run' || sub === 'run-script') &&
      script !== '' &&
      !script.startsWith('-');
    if (!SAFE_SUBCOMMANDS.has(sub) && !runsScript) {
      refuse(
        command,
        `must name a test, lint or build subcommand of ${tool} (or run <script>)`
      );
    }
  } else if (!STANDALONE_TOOLS.has(tool)) {
    refuse(
      command,
      'must start with a known test, lint or build tool (no wrappers, paths or .exe names)'
    );
  }
  for (const prefix of DENIED_COMMAND_PREFIXES) {
    if (lower === prefix || lower.startsWith(`${prefix} `)) {
      throw new AgyError(
        'AGY_INVALID_INPUT',
        `--allow-command ${JSON.stringify(command)} is never allowed in a delegated run`
      );
    }
  }
  return command;
}

/** The probed values that run headless; always-proceed is never used. */
export const TOOL_PERMISSIONS = [
  'request-review',
  'strict',
  'proceed-in-sandbox',
] as const;

function checkToolPermission(value: string): void {
  if (!(TOOL_PERMISSIONS as readonly string[]).includes(value)) {
    throw new AgyError(
      'AGY_SETTINGS',
      `refusing to build a profile with toolPermission ${JSON.stringify(value)}`
    );
  }
}

interface SettingsInput {
  readonly toolPermission: string;
  readonly commands: readonly string[];
  readonly agentMode: '' | 'accept-edits';
  readonly sandbox: boolean;
}

/**
 * agy overlays --settings on the global config per top-level key: a key given
 * here replaces the global one, a key left out leaks through. So every key
 * that can widen a run is pinned, even where the value matches agy's default.
 */
function settingsJson(input: SettingsInput): string {
  return JSON.stringify({
    useG1Credits: false,
    allowNonWorkspaceAccess: false,
    toolPermission: input.toolPermission,
    agentMode: input.agentMode,
    enableTerminalSandbox: input.sandbox,
    permissions: { allow: input.commands.map((c) => `command(${c})`) },
  });
}

export function readOnlyProfile(options: ProfileOptions = {}): TurnProfile {
  const toolPermission = options.toolPermission ?? DEFAULT_TOOL_PERMISSION;
  checkToolPermission(toolPermission);
  return {
    settings: settingsJson({
      toolPermission,
      commands: [],
      agentMode: '',
      sandbox: false,
    }),
    flags: [],
  };
}

export function implementProfile(options: ImplementOptions): TurnProfile {
  const toolPermission = options.toolPermission ?? DEFAULT_TOOL_PERMISSION;
  checkToolPermission(toolPermission);
  const extra = options.allowCommands.map(validateAllowCommand);
  if (extra.length > 0 && !options.sandboxVerified) {
    throw new AgyError(
      'AGY_SETTINGS',
      'test and lint commands need a host where --sandbox is verified; this host has none'
    );
  }
  const commands = extra;
  const sandbox = extra.length > 0;
  const flags = ['--mode', 'accept-edits'];
  if (sandbox) flags.push('--sandbox');
  return {
    settings: settingsJson({
      toolPermission,
      commands,
      agentMode: 'accept-edits',
      sandbox,
    }),
    flags,
  };
}

const SETTINGS_KEYS = [
  'useG1Credits',
  'allowNonWorkspaceAccess',
  'toolPermission',
  'agentMode',
  'enableTerminalSandbox',
  'permissions',
].sort();

function badProfile(why: string): never {
  throw new AgyError('AGY_SETTINGS', `refusing a turn profile: ${why}`);
}

/**
 * Re-checks a profile at the argv boundary, so one built by hand can't widen
 * a run past what the builders allow.
 */
export function assertSafeProfile(profile: TurnProfile): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(profile.settings);
  } catch {
    badProfile('settings are not JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    badProfile('settings are not an object');
  }
  const v = parsed as Record<string, unknown>;
  if (JSON.stringify(Object.keys(v).sort()) !== JSON.stringify(SETTINGS_KEYS)) {
    badProfile('settings keys differ from the pinned set');
  }
  if (v['useG1Credits'] !== false) badProfile('useG1Credits must be false');
  if (v['allowNonWorkspaceAccess'] !== false) {
    badProfile('allowNonWorkspaceAccess must be false');
  }
  checkToolPermission(String(v['toolPermission']));
  const mode = v['agentMode'];
  if (mode !== '' && mode !== 'accept-edits') badProfile('unknown agentMode');
  const perms = v['permissions'] as { allow?: unknown } | null;
  const allow = perms?.allow;
  if (
    perms === null ||
    typeof perms !== 'object' ||
    Object.keys(perms).join() !== 'allow' ||
    !Array.isArray(allow)
  ) {
    badProfile('permissions must hold only an allow list');
  }
  let extra = 0;
  for (const rule of allow as unknown[]) {
    const m = typeof rule === 'string' ? /^command\((.*)\)$/.exec(rule) : null;
    if (m === null) badProfile(`unexpected rule ${JSON.stringify(rule)}`);
    const cmd = m[1] ?? '';
    if (mode !== 'accept-edits')
      badProfile(`${cmd} needs the implement profile`);
    validateAllowCommand(cmd);
    extra += 1;
  }
  const flags = profile.flags.join(' ');
  const expected =
    mode === 'accept-edits'
      ? `--mode accept-edits${extra > 0 ? ' --sandbox' : ''}`
      : '';
  if (flags !== expected)
    badProfile(`flags ${JSON.stringify(flags)} don't match`);
  if (v['enableTerminalSandbox'] !== extra > 0) {
    badProfile(
      'enableTerminalSandbox must be on exactly when extra commands are granted'
    );
  }
  if (extra > 0 && mode !== 'accept-edits') {
    badProfile('extra commands need the implement profile');
  }
}

export interface TurnArgsOptions {
  readonly prompt: string;
  readonly profile: TurnProfile;
  /** Absent for the first (plan) turn, which must pass jsonSchemaPath. */
  readonly conversationId?: string;
  /** Path to plan.schema.json; read-only plan turns and corrections only. */
  readonly jsonSchemaPath?: string;
  /** Seconds before agy stops the turn itself. */
  readonly printTimeoutSeconds: number;
}

const CONVERSATION_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** The agy argv (without the binary) for one model turn. */
export function turnArgs(options: TurnArgsOptions): string[] {
  assertSafeProfile(options.profile);
  const implementing = options.profile.flags.includes('accept-edits');
  if (options.jsonSchemaPath !== undefined && implementing) {
    throw new AgyError(
      'AGY_INVALID_INPUT',
      'the plan schema belongs to read-only turns, not implement turns'
    );
  }
  if (options.conversationId === undefined) {
    if (options.jsonSchemaPath === undefined || implementing) {
      throw new AgyError(
        'AGY_INVALID_INPUT',
        'the first turn is a read-only plan turn with the plan schema'
      );
    }
  }
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
  assertSafeProfile(profile);
  return [
    '-p',
    '/usage',
    '--output-format',
    'json',
    '--settings',
    profile.settings,
  ];
}
