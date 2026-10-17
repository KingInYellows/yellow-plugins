#!/usr/bin/env python3
"""Stub TypeSafe endpoint for tests/persona-shadow.bats.

Usage: stub_server.py SCENARIO LOG_FILE

Binds 127.0.0.1 on an ephemeral port and prints the port (the readiness
signal). Every POST is appended to LOG_FILE as one JSON line: path,
lower-cased headers and the parsed body. Scenarios:

  ok        a valid noul answer for every question
  invalid   one probability outside [0, 1]
  missing   one question left unanswered
  garbage   HTTP 200 with a body that is not JSON
  500       HTTP 500
  429       HTTP 429
  timeout   sleep 3 s before answering
"""

import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SCENARIO = sys.argv[1]
LOG = sys.argv[2]
PROBS = {
    "auth_or_secrets": 0.35,
    "untrusted_input": 0.1,
    "trust_boundary": 0.1,
    "io_async": 0.9,
    "perf_hot_path": 0.1,
    "testable_logic": 0.6,
    "new_convention": 0.1,
    "hidden_fallback": 0.2,
    "language_specific": 0.4,
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code, body, ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        try:
            body = json.loads(raw)
        except ValueError:
            body = None
        with open(LOG, "a") as fh:
            fh.write(json.dumps({"path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}, "body": body}) + "\n")
        if SCENARIO == "500":
            return self._send(500, b'{"error": "boom"}')
        if SCENARIO == "429":
            return self._send(429, b'{"error": "slow down"}')
        if SCENARIO == "garbage":
            return self._send(200, b"<html>not json</html>", "text/html")
        if SCENARIO == "timeout":
            time.sleep(3)
        probs = dict(PROBS)
        if SCENARIO == "invalid":
            probs["io_async"] = 1.5
        if SCENARIO == "missing":
            del probs["hidden_fallback"]
        answers = {k: {"type": "noul", "noul": v} for k, v in probs.items()}
        self._send(200, json.dumps({"model": "jev-1.13.0", "answers": answers}).encode())


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
server.daemon_threads = True
print(server.server_port, flush=True)
server.serve_forever()
