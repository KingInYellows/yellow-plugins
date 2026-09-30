"use strict";
/**
 * Process-local `globalThis.fetch` guard (contract "Network guard").
 *
 * The SDK's ApiClient calls global `fetch`, so this wrapper is where the
 * runtime pins the vendor origin and refuses redirects: `X-Goog-Api-Key` is
 * not among the headers `fetch` strips on a cross-origin redirect, so
 * following one would forward the credential. A refusal is thrown (never
 * returned), so it surfaces through the SDK's fetchWithTimeout as
 * JulesNetworkError and classifies as JULES_SERVICE_UNAVAILABLE before
 * dispatch or JULES_UNKNOWN_OUTCOME after a mutating POST.
 *
 * Installed exactly once per process, before `connect()`. The loopback
 * allowance exists only through test-seam.ts; it is never read from config,
 * env, or argv.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResponseTooLarge = exports.FetchGuardRefusal = exports.MAX_RESPONSE_BYTES = exports.READ_TIMEOUT_MS = exports.VENDOR_ORIGIN = void 0;
exports.installFetchGuard = installFetchGuard;
const deadline_js_1 = require("./deadline.js");
exports.VENDOR_ORIGIN = 'https://jules.googleapis.com';
exports.READ_TIMEOUT_MS = 30_000;
/**
 * Per-response body cap. It equals the 100 MiB aggregate artifact cap
 * (AGGREGATE_ARTIFACT_CAP_BYTES in runtime.ts): no single vendor response may
 * exceed what a whole invocation may stage, and the SDK never parses a larger
 * body. Exceeding it surfaces as JULES_MALFORMED_RESPONSE.
 */
exports.MAX_RESPONSE_BYTES = 100 * 1024 * 1024;
let installed = false;
class FetchGuardRefusal extends Error {
    constructor(message) {
        super(`fetch guard: ${message}`);
        this.name = 'FetchGuardRefusal';
    }
}
exports.FetchGuardRefusal = FetchGuardRefusal;
/** A response body larger than the per-response cap; classified as malformed. */
class ResponseTooLarge extends FetchGuardRefusal {
    constructor(limit) {
        super(`response body exceeds ${limit} bytes`);
        this.name = 'ResponseTooLarge';
    }
}
exports.ResponseTooLarge = ResponseTooLarge;
function limitBody(response, limit) {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > limit) {
        void response.body?.cancel().catch(() => undefined);
        throw new ResponseTooLarge(limit);
    }
    if (response.body === null)
        return response;
    let seen = 0;
    const counted = response.body.pipeThrough(new TransformStream({
        transform(chunk, controller) {
            seen += chunk.byteLength;
            if (seen > limit)
                controller.error(new ResponseTooLarge(limit));
            else
                controller.enqueue(chunk);
        },
    }));
    return new Response(counted, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    });
}
function isLoopbackHost(hostname) {
    return hostname === '127.0.0.1';
}
function requestParts(input, init) {
    if (typeof input === 'string')
        return { url: input, method: (init?.method ?? 'GET').toUpperCase() };
    if (input instanceof URL)
        return { url: input.href, method: (init?.method ?? 'GET').toUpperCase() };
    if (input instanceof Request) {
        return {
            url: input.url,
            method: (init?.method ?? input.method).toUpperCase(),
        };
    }
    throw new FetchGuardRefusal('unsupported request input');
}
function installFetchGuard(options) {
    if (installed) {
        throw new Error('fetch guard is already installed in this process');
    }
    const allowed = new Set(options.allowedOrigins.map((o) => new URL(o).origin));
    const original = globalThis.fetch;
    let posts = 0;
    const guarded = async (input, init) => {
        const { url, method } = requestParts(input, init);
        let parsed;
        try {
            parsed = new URL(url);
        }
        catch {
            throw new FetchGuardRefusal('unparseable request URL');
        }
        if (!allowed.has(parsed.origin)) {
            throw new FetchGuardRefusal(`origin ${parsed.origin} is not the pinned vendor origin`);
        }
        if (parsed.protocol !== 'https:' && !isLoopbackHost(parsed.hostname)) {
            throw new FetchGuardRefusal(`non-https scheme ${parsed.protocol}`);
        }
        const signals = [];
        if (init?.signal)
            signals.push(init.signal);
        if (input instanceof Request)
            signals.push(input.signal);
        const attemptSignal = deadline_js_1.readAttemptSignal.getStore();
        if (attemptSignal)
            signals.push(attemptSignal);
        if (method !== 'POST') {
            const timeout = new AbortController();
            const timer = setTimeout(() => timeout.abort(new FetchGuardRefusal(`read timed out after ${options.readTimeoutMs} ms`)), options.readTimeoutMs);
            timer.unref();
            signals.push(timeout.signal);
        }
        const nextInit = {
            ...init,
            redirect: 'manual',
            ...(signals.length > 0 ? { signal: AbortSignal.any(signals) } : {}),
        };
        if (method === 'POST') {
            posts += 1;
            options.onPostDispatch?.(parsed.href, Date.now());
        }
        const response = await original(input instanceof Request ? new Request(input, nextInit) : input, nextInit);
        if (response.status >= 300 && response.status < 400) {
            // Discard the body so the connection can be reused, then refuse.
            await response.body?.cancel().catch(() => undefined);
            throw new FetchGuardRefusal(`refused a ${response.status} redirect`);
        }
        return limitBody(response, options.maxResponseBytes ?? exports.MAX_RESPONSE_BYTES);
    };
    globalThis.fetch = guarded;
    installed = true;
    return {
        postCount: () => posts,
        uninstall: () => {
            if (globalThis.fetch === guarded)
                globalThis.fetch = original;
            installed = false;
        },
    };
}
