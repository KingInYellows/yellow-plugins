"use strict";
/**
 * Per-run permission profiles passed to agy as `--settings <json>` and the
 * argv for each kind of turn (contract-v0 "Permission profiles" and "Run
 * lifecycle"). Pure builders: the guards here are the last place a wider
 * permission could slip into a run, so they throw instead of degrading.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.IMPLEMENT_EXTRA_COMMANDS = exports.READ_ONLY_COMMANDS = void 0;
exports.validateAllowCommand = validateAllowCommand;
exports.readOnlyProfile = readOnlyProfile;
exports.implementProfile = implementProfile;
exports.turnArgs = turnArgs;
exports.usageArgs = usageArgs;
const errors_1 = require("./errors");
exports.READ_ONLY_COMMANDS = [
    'git status',
    'git diff',
    'git log',
];
exports.IMPLEMENT_EXTRA_COMMANDS = ['git add', 'git commit'];
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
];
/** A plain command: words of safe characters separated by single spaces. */
const COMMAND_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@+=-]*( [A-Za-z0-9._:/@+=-]+)*$/;
/** Throws unless `command` is a plain command a grant may allow. */
function validateAllowCommand(command) {
    if (!COMMAND_RE.test(command) || command.length > 200) {
        throw new errors_1.AgyError('AGY_INVALID_INPUT', `--allow-command must be plain words without shell syntax: ${JSON.stringify(command)}`);
    }
    for (const prefix of DENIED_COMMAND_PREFIXES) {
        if (command === prefix || command.startsWith(`${prefix} `)) {
            throw new errors_1.AgyError('AGY_INVALID_INPUT', `--allow-command ${JSON.stringify(command)} is never allowed in a delegated run`);
        }
    }
    return command;
}
function checkToolPermission(value) {
    if (value === '' || value === 'always-proceed') {
        throw new errors_1.AgyError('AGY_SETTINGS', `refusing to build a profile with toolPermission ${JSON.stringify(value)}`);
    }
}
function settingsJson(toolPermission, commands) {
    return JSON.stringify({
        useG1Credits: false,
        allowNonWorkspaceAccess: false,
        toolPermission,
        permissions: { allow: commands.map((c) => `command(${c})`) },
    });
}
function readOnlyProfile(options) {
    checkToolPermission(options.toolPermission);
    return {
        settings: settingsJson(options.toolPermission, exports.READ_ONLY_COMMANDS),
        flags: [],
    };
}
function implementProfile(options) {
    checkToolPermission(options.toolPermission);
    const extra = options.allowCommands.map(validateAllowCommand);
    if (extra.length > 0 && !options.sandboxVerified) {
        throw new errors_1.AgyError('AGY_SETTINGS', 'test and lint commands need a host where --sandbox is verified; this host has none');
    }
    const commands = [
        ...exports.READ_ONLY_COMMANDS,
        ...exports.IMPLEMENT_EXTRA_COMMANDS,
        ...extra,
    ];
    const flags = ['--mode', 'accept-edits'];
    if (extra.length > 0)
        flags.push('--sandbox');
    return { settings: settingsJson(options.toolPermission, commands), flags };
}
const CONVERSATION_RE = /^[A-Za-z0-9_-]{1,128}$/;
/** The agy argv (without the binary) for one model turn. */
function turnArgs(options) {
    if (options.prompt.trim() === '') {
        throw new errors_1.AgyError('AGY_INVALID_INPUT', 'the prompt is empty');
    }
    // A prompt that starts with "-" could be read as a flag by agy's parser.
    if (options.prompt.startsWith('-')) {
        throw new errors_1.AgyError('AGY_INVALID_INPUT', 'the prompt may not start with "-"');
    }
    if (!Number.isInteger(options.printTimeoutSeconds) ||
        options.printTimeoutSeconds < 1) {
        throw new errors_1.AgyError('AGY_INVALID_INPUT', 'printTimeoutSeconds must be a positive integer');
    }
    const args = ['-p', options.prompt, '--output-format', 'json'];
    if (options.conversationId !== undefined) {
        if (!CONVERSATION_RE.test(options.conversationId)) {
            throw new errors_1.AgyError('AGY_INVALID_INPUT', `invalid conversation id ${JSON.stringify(options.conversationId)}`);
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
function usageArgs(profile) {
    return [
        '-p',
        '/usage',
        '--output-format',
        'json',
        '--settings',
        profile.settings,
    ];
}
