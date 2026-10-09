"use strict";
/**
 * `authorize` — the only trust root (R29, R30). Creating a grant, taking over
 * the controller (R38), and — in mutations.ts — `abandon` all require the
 * owner to type a runtime-minted challenge back on the controlling terminal.
 * `--list` and `--revoke` need no terminal because they never widen authority.
 *
 * Flow for a new grant: validate, confirm on the TTY (before the lock, so a
 * waiting human never holds it), resolve the source through the adapter (R17),
 * then under the journal lock initialize or assert the controller authority
 * and write the grant atomically.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveControllerContext = exports.refuseInsideSupervisedSession = exports.defaultControllerId = exports.ACTIVE_GRANT_ENV = void 0;
exports.authorizeCreate = authorizeCreate;
exports.authorizeList = authorizeList;
exports.authorizeRevoke = authorizeRevoke;
exports.authorizeTakeOver = authorizeTakeOver;
const authority_js_1 = require("./authority.js");
const config_js_1 = require("./config.js");
const controller_js_1 = require("./controller.js");
const deadline_js_1 = require("./deadline.js");
const errors_js_1 = require("./errors.js");
const runtime_support_js_1 = require("./runtime-support.js");
const state_js_1 = require("./state.js");
const validate_js_1 = require("./validate.js");
// The shared write-path deps and helpers live in runtime-support.ts; they are
// re-exported here under their original names for callers of this module.
var runtime_support_js_2 = require("./runtime-support.js");
Object.defineProperty(exports, "ACTIVE_GRANT_ENV", { enumerable: true, get: function () { return runtime_support_js_2.ACTIVE_GRANT_ENV; } });
Object.defineProperty(exports, "defaultControllerId", { enumerable: true, get: function () { return runtime_support_js_2.defaultControllerId; } });
Object.defineProperty(exports, "refuseInsideSupervisedSession", { enumerable: true, get: function () { return runtime_support_js_2.refuseInsideSupervisedSession; } });
Object.defineProperty(exports, "resolveControllerContext", { enumerable: true, get: function () { return runtime_support_js_2.resolveControllerContext; } });
function boundedInt(value, fallback, ceiling, min, label) {
    const chosen = value ?? fallback;
    if (!Number.isInteger(chosen) || chosen < min || chosen > ceiling) {
        return (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', `${label} must be an integer between ${min} and the ceiling ${ceiling}`);
    }
    return chosen;
}
function summaryOf(grant, ttlMinutes) {
    return [
        'yellow-jules: CREATE GRANT',
        `  repository:  ${grant.repository} (${grant.sourceResource})`,
        `  branch:      ${grant.branchPattern}`,
        `  task refs:   ${grant.taskRefs.join(', ')}`,
        `  operations:  ${grant.operations.join(', ')}`,
        `  limits:      ${grant.maxActiveSessions} active session(s), ${grant.maxTotalTasks} task(s), ${grant.maxCorrectiveRounds} corrective round(s) per task`,
        `  expires:     ${ttlMinutes} minutes after you confirm (about ${grant.expiresAt})`,
        `  owner:       ${grant.owner}`,
        `  controller:  ${grant.controllerId}`,
        '',
        'A supervised session may act without asking inside these limits.',
    ].join('\n');
}
async function authorizeCreate(deps, args) {
    (0, runtime_support_js_1.refuseInsideSupervisedSession)(deps.env);
    const repo = (0, validate_js_1.validateRepoInput)(args.repo);
    const repository = `${repo.owner}/${repo.repo}`;
    const branchPattern = (0, validate_js_1.validateBranchPattern)(args.branch);
    const sourceResource = (0, validate_js_1.sourceResourceFor)(repo);
    if (args.source !== undefined) {
        (0, validate_js_1.validateSourceResource)(args.source, 'input');
        if (args.source !== sourceResource) {
            (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', '--source does not match --repo; sources are discovered, never synthesized');
        }
    }
    if (args.taskRefs.length === 0) {
        (0, errors_js_1.throwAppError)('JULES_INVALID_INPUT', 'at least one --task-ref is required');
    }
    const taskRefs = [...new Set(args.taskRefs.map((t) => (0, validate_js_1.validateTaskRef)(t)))];
    const operations = (0, validate_js_1.validateOperations)(args.operations);
    const owner = (0, validate_js_1.validateOwnerLabel)(args.owner);
    const maxActiveSessions = boundedInt(args.maxActiveSessions, authority_js_1.GRANT_DEFAULTS.maxActiveSessions, authority_js_1.GRANT_CEILINGS.maxActiveSessions, 1, '--max-active-sessions');
    const maxTotalTasks = boundedInt(args.maxTotalTasks, authority_js_1.GRANT_DEFAULTS.maxTotalTasks, authority_js_1.GRANT_CEILINGS.maxTotalTasks, 1, '--max-total-tasks');
    const maxCorrectiveRounds = boundedInt(args.maxCorrectiveRounds, authority_js_1.GRANT_DEFAULTS.maxCorrectiveRounds, authority_js_1.GRANT_CEILINGS.maxCorrectiveRounds, 0, '--max-corrective-rounds');
    const ttlMinutes = boundedInt(args.ttlMinutes, authority_js_1.GRANT_DEFAULTS.ttlMinutes, authority_js_1.GRANT_CEILINGS.ttlMinutes, 1, '--ttl-minutes');
    (0, runtime_support_js_1.prepare)(deps);
    const ctx = (0, runtime_support_js_1.resolveControllerContext)(deps);
    // R17: the source is discovered through the adapter, never synthesized. The
    // read runs before the prompt so a missing key or an unreachable repository
    // fails before the owner types a code.
    const deadline = (0, deadline_js_1.deadlineIn)(deps.clock, args.deadlineMs ?? deadline_js_1.DEFAULT_READ_DEADLINE_MS);
    const source = await (0, runtime_support_js_1.withAdapter)(deps, (adapter) => (0, runtime_support_js_1.read)(deps, deadline, () => adapter.getSource(repo.owner, repo.repo)));
    if (source.sourceResource !== sourceResource) {
        (0, errors_js_1.throwAppError)('JULES_SOURCE_ACCESS', 'the discovered source does not match the requested repository');
    }
    await (0, runtime_support_js_1.confirmOwner)(deps, summaryOf({
        repository,
        sourceResource,
        branchPattern,
        taskRefs,
        operations,
        maxActiveSessions,
        maxTotalTasks,
        maxCorrectiveRounds,
        expiresAt: new Date(deps.clock.now() + ttlMinutes * 60_000).toISOString(),
        owner,
        controllerId: ctx.controllerId,
    }, ttlMinutes));
    // The grant's clock starts when the owner confirms, not when the prompt opened.
    const createdAt = (0, runtime_support_js_1.nowFn)(deps)().toISOString();
    const expiresAt = new Date(deps.clock.now() + ttlMinutes * 60_000).toISOString();
    return (0, state_js_1.withJournalLock)(deps.dataDir, async () => {
        const grants = (0, authority_js_1.loadGrants)(deps.dataDir);
        const existing = (0, controller_js_1.readControllerAuthority)(ctx.controllerDir, ctx.controllerId);
        let epoch;
        if (existing === undefined) {
            if (Object.keys(grants.grants).length > 0) {
                return (0, errors_js_1.throwAppError)('JULES_CONTROLLER_MISMATCH', `grants exist but this host has no controller authority for ${ctx.controllerId}`);
            }
            epoch = (0, controller_js_1.initControllerAuthority)(ctx, deps.dataDir).epoch;
        }
        else {
            if (existing.dataDir !== (0, config_js_1.canonicalPath)(deps.dataDir)) {
                return (0, errors_js_1.throwAppError)('JULES_CONTROLLER_MISMATCH', 'this data directory is not the one the controller authority authorizes');
            }
            epoch = existing.epoch;
        }
        const grantId = (0, validate_js_1.mintGrantId)();
        const grant = {
            grantId,
            repository,
            sourceResource,
            branchPattern,
            taskRefs,
            operations,
            maxActiveSessions,
            maxTotalTasks,
            maxCorrectiveRounds,
            expiresAt,
            createdAt,
            owner,
            controllerId: ctx.controllerId,
            epochRef: { controllerId: ctx.controllerId, epoch },
            usage: (0, authority_js_1.emptyUsage)(),
        };
        const next = Object.create(null);
        for (const [id, g] of Object.entries(grants.grants))
            next[id] = g;
        next[grantId] = grant;
        (0, authority_js_1.writeGrants)(deps.dataDir, { version: 1, grants: next });
        return {
            operation: 'authorize',
            grantId,
            repository,
            sourceResource,
            branchPattern,
            taskRefs,
            operations,
            limits: { maxActiveSessions, maxTotalTasks, maxCorrectiveRounds },
            expiresAt,
            controllerId: ctx.controllerId,
            epoch,
        };
    });
}
async function authorizeList(deps) {
    (0, runtime_support_js_1.prepare)(deps);
    const journal = await (0, state_js_1.readJournal)(deps.dataDir);
    return {
        operation: 'authorize',
        grants: (0, authority_js_1.listGrants)(deps.dataDir, (0, runtime_support_js_1.nowFn)(deps)(), journal),
    };
}
async function authorizeRevoke(deps, grantId) {
    (0, runtime_support_js_1.prepare)(deps);
    (0, validate_js_1.validateGrantId)(grantId);
    const result = await (0, authority_js_1.revokeGrant)(deps.dataDir, grantId, (0, runtime_support_js_1.nowFn)(deps)());
    return { operation: 'authorize', ...result };
}
/** R38 handoff: TTY-confirmed; writes epoch+1 for this host and path and rebinds every grant. */
async function authorizeTakeOver(deps) {
    (0, runtime_support_js_1.refuseInsideSupervisedSession)(deps.env);
    (0, runtime_support_js_1.prepare)(deps);
    const ctx = (0, runtime_support_js_1.resolveControllerContext)(deps);
    const dataDir = (0, config_js_1.canonicalPath)(deps.dataDir);
    await (0, runtime_support_js_1.confirmOwner)(deps, [
        'yellow-jules: TAKE OVER CONTROLLER',
        `  controller:  ${ctx.controllerId}`,
        `  data dir:    ${dataDir}`,
        '',
        'This host becomes the only writer. Every grant is rebound to the new epoch;',
        'any other copy of this data directory stops being able to write.',
    ].join('\n'));
    return (0, state_js_1.withJournalLock)(deps.dataDir, async () => {
        const grants = (0, authority_js_1.loadGrants)(deps.dataDir);
        const result = (0, controller_js_1.takeOverController)(ctx, deps.dataDir, grants);
        (0, authority_js_1.writeGrants)(deps.dataDir, result.grants);
        return {
            operation: 'authorize',
            controllerId: result.authority.controllerId,
            epoch: result.authority.epoch,
            dataDir: result.authority.dataDir,
            grantsRebound: Object.keys(result.grants.grants).length,
        };
    });
}
