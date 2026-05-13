#!/usr/bin/env node
// yellow-composio: minimal stdio<->HTTPS MCP proxy.
//
// MCP stdio transport per spec: newline-delimited JSON, one JSON-RPC object
// per line. https://modelcontextprotocol.io/docs/concepts/transports
//
// This proxy reads JSON-RPC messages from stdin, POSTs each one to the
// Composio MCP HTTPS endpoint with the X-API-Key header, and writes the
// response back to stdout. No persistent SSE/WebSocket — Composio's
// endpoint is request/response per the docs.
//
// Required env: COMPOSIO_MCP_URL, COMPOSIO_API_KEY. The wrapper script
// start-composio.sh resolves these from userConfig OR shell env.

import { createInterface } from 'node:readline';

const URL = process.env.COMPOSIO_MCP_URL;
const API_KEY = process.env.COMPOSIO_API_KEY;

if (!URL) {
  process.stderr.write('[composio-proxy] Fatal: COMPOSIO_MCP_URL is not set\n');
  process.exit(1);
}
if (!API_KEY) {
  process.stderr.write('[composio-proxy] Fatal: COMPOSIO_API_KEY is not set\n');
  process.exit(1);
}
if (!URL.startsWith('https://')) {
  process.stderr.write(`[composio-proxy] Fatal: COMPOSIO_MCP_URL must be https:// (got ${URL.slice(0, 8)}...)\n`);
  process.exit(1);
}

const rl = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

async function forward(jsonRpcMessage) {
  let parsed;
  try {
    parsed = JSON.parse(jsonRpcMessage);
  } catch (err) {
    process.stderr.write(`[composio-proxy] Skipping unparseable line: ${err.message}\n`);
    return;
  }

  try {
    const response = await fetch(URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-API-Key': API_KEY,
      },
      body: JSON.stringify(parsed),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      process.stderr.write(`[composio-proxy] HTTP ${response.status} ${response.statusText}: ${errBody.slice(0, 200)}\n`);
      // Only emit a JSON-RPC error response if the inbound was a request (has id).
      if (parsed.id !== undefined) {
        const errResponse = {
          jsonrpc: '2.0',
          id: parsed.id,
          error: {
            code: -32603,
            message: `Composio HTTP ${response.status}: ${response.statusText}`,
          },
        };
        process.stdout.write(JSON.stringify(errResponse) + '\n');
      }
      return;
    }

    const responseBody = await response.text();
    if (responseBody.trim().length === 0) {
      // Notification (no response expected) — drop silently.
      return;
    }

    // Composio returns one JSON object per request — emit as one stdio line.
    process.stdout.write(responseBody.trim() + '\n');
  } catch (err) {
    process.stderr.write(`[composio-proxy] Network error: ${err.message}\n`);
    if (parsed.id !== undefined) {
      const errResponse = {
        jsonrpc: '2.0',
        id: parsed.id,
        error: {
          code: -32603,
          message: `Composio network error: ${err.message}`,
        },
      };
      process.stdout.write(JSON.stringify(errResponse) + '\n');
    }
  }
}

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (trimmed.length === 0) return;
  // Fire-and-forget per line; Composio's request/response means each line
  // is independent so we don't need ordered serialization.
  forward(trimmed).catch((err) => {
    process.stderr.write(`[composio-proxy] Unhandled forward error: ${err.message}\n`);
  });
});

rl.on('close', () => {
  process.exit(0);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
