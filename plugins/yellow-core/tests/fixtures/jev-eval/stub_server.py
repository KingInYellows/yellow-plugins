#!/usr/bin/env python3
"""Stub TypeSafe endpoint for tests/jev-category-eval.bats.

Usage: stub_server.py SCENARIO LOG_FILE

Binds 127.0.0.1 on an ephemeral port and prints the port (the readiness
signal). Every request (GET or POST) is appended to LOG_FILE as one JSON
line: method, path, lower-cased headers and the parsed body. Scenarios:

  ok            answer from ANSWERS keyed by state.lesson.title
  500           always HTTP 500 with Retry-After: 0
  429-then-200  first request per title gets 429 (Retry-After: 0), then ok
  timeout       sleep 3 s before answering
  invalid       answer a choice outside the criteria
  redirect      302 to /target on this server
  garbage       HTTP 200 with a body that is not JSON
"""

import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ANSWERS = {
    "Alpha lesson": ("code-quality", 0.97),
    "Beta lesson": ("code-quality", 0.62),
    "Gamma lesson": ("workflow", 0.99),
}
SCENARIO = sys.argv[1]
LOG = sys.argv[2]
LOCK = threading.Lock()
SEEN = set()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _reply(self, code, payload=None, headers=None):
        body = json.dumps(payload or {}).encode()
        self.send_response(code)
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _log(self, body):
        with LOCK, open(LOG, "a") as fh:
            fh.write(json.dumps({"method": self.command, "path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}, "body": body}) + "\n")

    def do_GET(self):
        # urllib follows a 302 on a POST as a GET: log it so a followed
        # redirect shows up in the request log.
        self._log(None)
        self._reply(200, {})

    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        try:
            body = json.loads(raw)
        except ValueError:
            body = None
        self._log(body)
        title = ((body or {}).get("state") or {}).get("lesson", {}).get("title", "")
        if self.path == "/target":
            return self._reply(200, {})
        if SCENARIO == "500":
            return self._reply(500, {"error": "boom"}, {"Retry-After": "0"})
        if SCENARIO == "429-then-200":
            with LOCK:
                first = title not in SEEN
                SEEN.add(title)
            if first:
                return self._reply(429, {"error": "slow down"}, {"Retry-After": "0"})
        if SCENARIO == "timeout":
            time.sleep(3)
        if SCENARIO == "garbage":
            body = b"<html>not json</html>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if SCENARIO == "redirect":
            return self._reply(302, {}, {"Location": "http://127.0.0.1:%d/target" % self.server.server_port})
        choice, conf = ANSWERS.get(title, ("code-quality", 0.5))
        if SCENARIO == "invalid":
            choice = "not-a-category"
        probs = {"security-issues": 0.0, "logic-errors": 0.0, "build-errors": 0.0, "integration-issues": 0.0, "code-quality": 0.0, "workflow": 0.0, "bogus": 0.5}
        probs[choice] = conf
        self._reply(200, {
            "model": "jev-1.13.0",
            "answers": {"category": {"type": "choice", "choice": choice, "confidence": conf, "probabilities": probs}},
            "usage": {"input_tokens": 900, "output_tokens": 90},
        })


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
server.daemon_threads = True
print(server.server_port, flush=True)
server.serve_forever()
