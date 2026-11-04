"use strict";
/**
 * The MCP gate `setup` runs before it records host.json (CLAUDE-254). agy
 * starts every enabled MCP server on every run and the command allowlist does
 * not govern their tools, so a delegate host must have none enabled unless
 * the owner names the server with `setup --allow-mcp <name>` and confirms it
 * on their own terminal.
 *
 * `agy mcp list` has no machine-readable flag (1.4.12). Its stdout is a
 * table, captured on the owner's PC in tests/fixtures/mcp-list-1.4.12.txt:
 *
 *   NAME     TYPE   STATUS   COMMAND/URL
 *   GitHits  stdio  enabled  npx -y githits@latest mcp start
 *
 * Anything else fails closed.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseMcpList = parseMcpList;
exports.parseAllowedMcp = parseAllowedMcp;
exports.isUnpinned = isUnpinned;
exports.mcpWarnings = mcpWarnings;
exports.assertMcpGate = assertMcpGate;
const node_child_process_1 = require("node:child_process");
const errors_1 = require("./errors");
const invocation_1 = require("./invocation");
const process_1 = require("./process");
const HEADER_RE = /^NAME\s+TYPE\s+STATUS\s+COMMAND\/URL$/;
const ROW_RE = /^(\S+)\s+(\S+)\s+(enabled|disabled)(?:\s+(.*))?$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
// An npx/uvx/bunx/pnpm dlx launch that names no exact version fetches
// whatever is newest on every run.
const LAUNCHER_RE = /\b(?:npx|uvx|bunx|dlx)\b/;
const EXACT_VERSION_RE = /@\d+\.\d+\.\d+(?:[-+][\w.-]+)?(?:\s|$)|==\d/;
const MAX_OUTPUT_BYTES = 64 * 1024;
const TIMEOUT_MS = 60_000;
/** Parses `agy mcp list` stdout; throws AGY_MCP on any other shape. */
function parseMcpList(stdout) {
    const lines = stdout
        .split('\n')
        .map((l) => l.replace(/\r$/, '').trimEnd())
        .filter((l) => l !== '');
    const unparseable = (why) => new errors_1.AgyError('AGY_MCP', `could not read agy mcp list output (${why}); check it by hand with agy mcp list`);
    if (lines.length === 0 || !HEADER_RE.test(lines[0] ?? '')) {
        throw unparseable('no NAME TYPE STATUS COMMAND/URL header');
    }
    return lines.slice(1).map((line) => {
        const m = ROW_RE.exec(line);
        if (m === null || m[1] === undefined) {
            throw unparseable(`unexpected row ${JSON.stringify(line.slice(0, 200))}`);
        }
        return { name: m[1], enabled: m[3] === 'enabled', command: m[4] ?? '' };
    });
}
function defaultRun(inv) {
    const res = (0, node_child_process_1.spawnSync)(inv.file, [...inv.args], {
        cwd: inv.cwd,
        env: inv.env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
    });
    if (res.error !== undefined) {
        const code = res.error.code;
        throw new errors_1.AgyError(code === 'ENOENT' ? 'AGY_NOT_INSTALLED' : 'AGY_MCP', code === 'ENOENT'
            ? `${inv.file} was not found`
            : `agy mcp list did not finish: ${res.error.message}`);
    }
    return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}
/** Validates `--allow-mcp` names; they must look like agy server names. */
function parseAllowedMcp(values) {
    if (values === undefined)
        return [];
    const list = Array.isArray(values) ? values : [values];
    for (const v of list) {
        if (typeof v !== 'string' || !NAME_RE.test(v)) {
            throw new errors_1.AgyError('AGY_INVALID_INPUT', '--allow-mcp takes an MCP server name as agy mcp list shows it');
        }
    }
    return [...new Set(list)];
}
/** True when the server's launch line would fetch an unpinned package. */
function isUnpinned(command) {
    return LAUNCHER_RE.test(command) && !EXACT_VERSION_RE.test(command);
}
/** What the owner must accept for each allowed server that is enabled. */
function mcpWarnings(servers, allowed) {
    const warnings = [];
    for (const s of servers) {
        if (!s.enabled || !allowed.includes(s.name))
            continue;
        warnings.push(`${s.name} starts on every delegated run; its tools are not limited by the command allowlist and can send task code to its service`);
        if (isUnpinned(s.command)) {
            warnings.push(`${s.name} launches an unpinned package (${s.command.slice(0, 200)}); pin an exact version in agy's MCP config`);
        }
    }
    return warnings;
}
/**
 * Runs `agy mcp list` on `host` (scrubbed env, git hooks off, exec-only on
 * the bridge) and throws AGY_MCP unless it exits 0 and every enabled server
 * is in `allowed`. `cwd` is a directory on that host; setup passes the
 * worktree root.
 */
function assertMcpGate(host, cwd, baseEnv, allowed = [], run = defaultRun) {
    const inv = (0, invocation_1.buildInvocation)(host, ['mcp', 'list'], {
        cwd,
        baseEnv,
        filterDrivers: [],
    });
    const res = run(inv);
    let stderr = res.stderr;
    if (inv.linuxGroup !== undefined) {
        const split = (0, process_1.splitPgidMarker)(Buffer.from(stderr, 'utf8'));
        if (split !== undefined)
            stderr = split.rest.toString('utf8');
    }
    if (res.status !== 0) {
        const detail = stderr.trim().slice(0, 500);
        throw new errors_1.AgyError('AGY_MCP', `agy mcp list exited ${res.status ?? 'by signal'}${detail === '' ? '' : `: ${detail}`}`);
    }
    const servers = parseMcpList(res.stdout);
    const blocked = servers
        .filter((s) => s.enabled && !allowed.includes(s.name))
        .map((s) => s.name);
    if (blocked.length > 0) {
        throw new errors_1.AgyError('AGY_MCP', `enabled MCP servers: ${blocked.join(', ')}; disable them or allow them by name with setup --allow-mcp`);
    }
    return servers;
}
