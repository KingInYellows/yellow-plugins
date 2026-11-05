"use strict";
/**
 * The AGY_* error catalog (docs/yellow-agy/contract-v0.md, "Output envelope,
 * exit codes, error catalog"). Every refusal the CLI makes carries one of
 * these codes, an exit code, and a default recovery action that a call site
 * may override with something more specific.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgyError = exports.ERROR_CATALOG = void 0;
exports.ERROR_CATALOG = {
    AGY_NOT_INSTALLED: {
        exit: 2,
        recoveryAction: 'Install the Antigravity CLI, sign in by running agy once, then run /agy:setup.',
    },
    AGY_VERSION: {
        exit: 2,
        recoveryAction: 'Update agy to the pinned floor or later.',
    },
    AGY_AUTH_MODE: {
        exit: 2,
        recoveryAction: 'Remove the named API-key or Vertex variables from the shell profile (or the WSL distro), then run /agy:setup.',
    },
    AGY_OVERAGES: {
        exit: 2,
        recoveryAction: 'Turn Use AI Credits off in agy /config, or set useG1Credits and userSettings.useAiCredits to false by hand, then run /agy:setup.',
    },
    AGY_AUTH_REQUIRED: {
        exit: 1,
        recoveryAction: 'Run agy once in a terminal and sign in with the Google account that holds the AI Pro plan.',
    },
    AGY_BUSY: {
        exit: 2,
        recoveryAction: 'Wait for the live run to finish, or cancel it.',
    },
    AGY_QUOTA: {
        exit: 1,
        recoveryAction: 'Wait for the AI Pro quota to reset, then retry with a new --request-id.',
    },
    AGY_QUOTA_LOW: {
        exit: 2,
        recoveryAction: 'Wait for the AI Pro quota to reset, or re-authorize the grant with a lower minQuotaPercent.',
    },
    AGY_QUOTA_UNKNOWN: {
        exit: 2,
        recoveryAction: 'Check that agy -p "/usage" works, then retry.',
    },
    AGY_TIMEOUT: {
        exit: 1,
        recoveryAction: 'Review the partial edits, then retry with --keep-partial or --reset-partial.',
    },
    AGY_BUDGET: {
        exit: 1,
        recoveryAction: "Retry with a new request id. A slow git call or quota probe used up the command's 600 s budget; a refusal before the turn ran refunded the task or corrective round. If a FAILED delegate task came back, its branch exists: abandon it and delegate again on a new branch.",
    },
    AGY_INTERRUPTED: {
        exit: 1,
        recoveryAction: 'Review the partial edits, then retry with --keep-partial or --reset-partial.',
    },
    AGY_DENIED: {
        exit: 0,
        recoveryAction: 'Reply with a narrower request, or re-authorize with a wider grant.',
    },
    AGY_MODEL_ERROR: {
        exit: 1,
        recoveryAction: 'Retry with a new --request-id.',
    },
    AGY_WORKTREE: {
        exit: 2,
        recoveryAction: 'Resolve the worktree or branch conflict named in the message.',
    },
    AGY_BRIDGE: {
        exit: 2,
        recoveryAction: 'Check the WSL distro and that agy runs inside it, then run /agy:setup.',
    },
    AGY_MCP: {
        exit: 2,
        recoveryAction: 'Disable each enabled MCP server with agy mcp disable <name> (see agy mcp list), then run /agy:setup.',
    },
    AGY_PROMPT_TOO_LONG: {
        exit: 2,
        recoveryAction: 'Shorten the prompt.',
    },
    AGY_SETTINGS: {
        exit: 2,
        recoveryAction: 'Tighten the named keys in ~/.gemini/antigravity-cli/settings.json by hand.',
    },
    AGY_AUTHORITY_DENIED: {
        exit: 2,
        recoveryAction: 'Run /agy:authorize for a grant that covers this repo, branch and operation, then run the command it prints in your own terminal.',
    },
    AGY_GRANT_EXPIRED: {
        exit: 2,
        recoveryAction: 'Run /agy:authorize for a new grant, then run the command it prints in your own terminal.',
    },
    AGY_GRANT_EXHAUSTED: {
        exit: 2,
        recoveryAction: 'Run /agy:authorize for a new grant with room left, then run the command it prints in your own terminal.',
    },
    AGY_CONFIRMATION_REQUIRED: {
        exit: 2,
        recoveryAction: 'Run the command yourself in a terminal; an agent without a terminal cannot confirm it.',
    },
    AGY_INVALID_INPUT: {
        exit: 2,
        recoveryAction: 'Fix the named argument.',
    },
    AGY_INTERNAL: {
        exit: 1,
        recoveryAction: 'Report the message, and check the worktree and run journal before retrying.',
    },
};
class AgyError extends Error {
    code;
    exit;
    recoveryAction;
    constructor(code, message, recoveryAction) {
        super(message);
        this.name = 'AgyError';
        this.code = code;
        this.exit = exports.ERROR_CATALOG[code].exit;
        this.recoveryAction = recoveryAction ?? exports.ERROR_CATALOG[code].recoveryAction;
    }
}
exports.AgyError = AgyError;
