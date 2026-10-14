#!/usr/bin/env python3
"""yellow-core: offline TypeSafe Jev evaluation of the solution-category pick.

Manual tool, never run by a hook or agent. It measures whether Jev, given the
frozen criteria in jev-category-criteria.json, picks the same docs/solutions/
folder a doc already lives in (plans/jev-category-offline-eval.md).

  run     --out DIR [--repo DIR] [--model ID] [--url URL] [--timeout S]
          [--limit N] [--dry-run]
      Reads the git index of --repo, keeps docs/solutions/<category>/*.md for
      the six criteria categories, and sends each doc's frontmatter title,
      problem and tags (never the body) as state.lesson with one `category`
      choice question. Writes one JSONL row per doc to
      DIR/results-<utc>.jsonl (mode 600, never overwritten). DIR must be
      outside the repository. Needs TYPESAFE_API_KEY, which goes only into an
      unredirected Authorization header. --dry-run sends nothing and needs
      no key.

  report  RESULTS [--review TSV] [--seed N]
      Offline. Prints agreement per split, coverage and agreement at
      confidence >= each frozen threshold, adjudicated accuracy from review
      judgements, and the pre-registered verdict. Writes disagreements.tsv
      beside RESULTS for the user to judge (paths only, no doc text),
      carrying over judgements from --review, or from an existing private
      disagreements.tsv when --review is absent. A judgement that no longer
      matches a listed row is kept as kind=stale or kind=orphan, never
      dropped.

`run` ends the results file with one summary record (eligible and written
counts, --limit, abort flag, skip counts). `report` gives a verdict only for
a complete run made under the current criteria file.

Exit codes: 0 success; 1 no request in `run` returned a usable answer, or
`run` stopped after ABORT_AFTER_ERRORS consecutive failed requests (the
results file is then partial); 2 usage error (missing key, no eligible docs,
--out inside the repository or writable by others, bad URL, a malformed
criteria, results or review file, mixed criteria sha or model in RESULTS,
duplicate paths, an existing disagreements.tsv that is not a private regular
file). --timeout bounds each socket operation of an attempt, not the whole
request.

Stdlib only, Python 3.9+.
"""

import argparse
import collections
import hashlib
import http.client
import json
import math
import os
import re
import socket
import ssl
import stat
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from ipaddress import ip_address

ROW_SCHEMA = 1
CRITERIA_FILE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "jev-category-criteria.json"
)
DEFAULT_URL = "https://api.typesafe.ai/v1/systemone"
RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
RETRY_AFTER_CAP_S = 10.0
ABORT_AFTER_ERRORS = 5
MAX_RESPONSE_BYTES = 1 << 20
MODEL_RE = re.compile(r"jev-[0-9.]+")
DATE_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")
SPLITS = ("dev", "test", "holdout")
JUDGEMENTS = ("folder", "jev", "both", "neither")
TSV_COLUMNS = ("path", "folder", "jev", "confidence", "kind", "judgement")


class UsageError(Exception):
    """Exit 2. Messages never include the API key or doc text."""


# --------------------------------------------------------------------------
# Frontmatter: a strict parser for the YAML subset docs/solutions uses.
# Every value stays a string (no YAML 1.1 typing). Anything outside the
# subset raises FrontmatterError with a line number instead of guessing.
# --------------------------------------------------------------------------


class FrontmatterError(ValueError):
    def __init__(self, line, msg):
        super().__init__("line %d: %s" % (line, msg))
        self.line = line


KEY_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_-]*):(?:[ ]+(.*)|)$")
WANTED = ("title", "problem", "tags", "date")
PLAIN_BAD_START = set("`@&*!%{}[]?,|>#'\"")


def parse_frontmatter(text):
    """Return {title, problem, tags, date} or None when there is no
    frontmatter. Missing keys come back as "" (or [] for tags)."""
    if text.startswith("\ufeff---"):
        raise FrontmatterError(1, "byte order mark")
    lines = text.split("\n")
    if lines[0].rstrip("\r") != "---":
        return None
    end = None
    for i in range(1, len(lines)):
        if lines[i].rstrip("\r") in ("---", "..."):
            end = i
            break
    if end is None:
        raise FrontmatterError(1, "unterminated frontmatter")
    for idx in range(end + 1):
        if "\r" in lines[idx]:
            raise FrontmatterError(idx + 1, "CR line ending")

    entries = {}
    current = None
    for idx in range(1, end):
        raw = lines[idx]
        lineno = idx + 1
        if "\t" in raw[: len(raw) - len(raw.lstrip())]:
            raise FrontmatterError(lineno, "tab indentation")
        if raw.startswith("#"):
            continue
        if raw[:1] not in (" ", "-", ""):
            m = KEY_RE.match(raw)
            if not m:
                raise FrontmatterError(lineno, "expected `key: value`")
            key = m.group(1)
            if key in entries:
                raise FrontmatterError(lineno, "duplicate key %r" % key)
            current = (lineno, m.group(2) or "", [])
            entries[key] = current
            continue
        if current is None:
            if raw.strip():
                raise FrontmatterError(lineno, "content before the first key")
            continue
        current[2].append((lineno, raw))

    out = {"title": "", "problem": "", "tags": [], "date": ""}
    for key in WANTED:
        if key not in entries:
            continue
        lineno, inline, children = entries[key]
        if key == "tags":
            out[key] = _parse_list(lineno, inline, children)
        else:
            out[key] = _parse_scalar(lineno, inline, children)
    return out


def _trim_trailing_blank(children):
    while children and not children[-1][1].strip():
        children = children[:-1]
    return children


def _fold(lines):
    """YAML flow folding: a single break becomes a space, each blank line a
    newline. Lines are already stripped as the caller requires."""
    out = lines[0] if lines else ""
    breaks = 0
    for line in lines[1:]:
        if line == "":
            breaks += 1
            continue
        out += ("\n" * breaks) if breaks else " "
        out += line
        breaks = 0
    return out


def _strip_comment(s):
    m = re.search(r"(^|[ \t])#", s)
    return s[: m.start()] if m else s


def _parse_scalar(lineno, inline, children):
    children = _trim_trailing_blank(children)
    head = inline.strip()
    if head == "":
        if not children:
            return ""
        first_no, first = children[0]
        lead = first.strip()
        if lead.startswith("- "):
            raise FrontmatterError(first_no, "expected a scalar, found a list")
        return _parse_scalar_text(first_no, lead, children[1:])
    if head[0] in ">|":
        return _parse_block(lineno, head, children)
    return _parse_scalar_text(lineno, inline.lstrip(), children)


def _parse_scalar_text(lineno, first, rest):
    if first.startswith("'") or first.startswith('"'):
        return _parse_quoted(lineno, first, rest)
    if first[:1] in PLAIN_BAD_START or first.startswith("- "):
        raise FrontmatterError(lineno, "unsupported plain scalar start %r" % first[:1])
    parts = [(lineno, _strip_comment(first).strip())]
    for no, raw in rest:
        body = raw.strip()
        if body.startswith("#"):
            raise FrontmatterError(no, "comment inside a plain scalar")
        if raw[:1] != " " and body:
            raise FrontmatterError(no, "unindented continuation")
        parts.append((no, _strip_comment(body).strip()))
    for no, part in parts:
        if ": " in part or part.endswith(":"):
            raise FrontmatterError(no, "`: ` inside a plain scalar")
    return _fold([p for _, p in parts])


def _parse_quoted(lineno, first, rest):
    quote = first[0]
    segments = [(lineno, first[1:])] + [(no, raw) for no, raw in rest]
    pieces = []
    for seg_index, (no, seg) in enumerate(segments):
        if seg_index > 0:
            if seg[:1] != " " and seg.strip():
                raise FrontmatterError(no, "unindented continuation")
            seg = seg.lstrip(" ")
        i = 0
        while i < len(seg):
            ch = seg[i]
            if quote == "'" and ch == "'":
                if seg[i + 1 : i + 2] == "'":
                    i += 2
                    continue
                return _close_quoted(segments, seg_index, seg, i, pieces, quote)
            if quote == '"' and ch == "\\":
                i += 2
                continue
            if quote == '"' and ch == '"':
                return _close_quoted(segments, seg_index, seg, i, pieces, quote)
            i += 1
        pieces.append(seg)
    raise FrontmatterError(lineno, "unterminated quoted scalar")


def _close_quoted(segments, seg_index, seg, i, pieces, quote):
    no = segments[seg_index][0]
    tail = seg[i + 1 :]
    if tail.strip() and not re.match(r"^[ \t]+#", tail):
        raise FrontmatterError(no, "text after the closing quote")
    for later_no, later in segments[seg_index + 1 :]:
        if later.strip():
            raise FrontmatterError(later_no, "text after the closing quote")
    pieces = pieces + [seg[:i]]
    if quote == "'":
        lines = [p.rstrip(" \t") if k < len(pieces) - 1 else p for k, p in enumerate(pieces)]
        return _fold(lines).replace("''", "'")
    # Double quotes: a backslash before the line break joins with no space.
    out = pieces[0]
    breaks = 0
    for k in range(1, len(pieces)):
        last = k == len(pieces) - 1
        line = pieces[k] if last else pieces[k].rstrip(" \t")
        if line == "" and not last:
            breaks += 1
            continue
        if not breaks and _ends_with_escape(out.rstrip(" \t")):
            out = out.rstrip(" \t")[:-1] + line
        else:
            out = out.rstrip(" \t") + (("\n" * breaks) if breaks else " ") + line
        breaks = 0
    return _unescape_double(out, segments[0][0])


def _ends_with_escape(s):
    n = len(s) - len(s.rstrip("\\"))
    return n % 2 == 1


_ESCAPES = {"n": "\n", "t": "\t", '"': '"', "\\": "\\", "/": "/", "0": "\0", " ": " "}


def _unescape_double(s, lineno):
    out = []
    i = 0
    while i < len(s):
        ch = s[i]
        if ch != "\\":
            out.append(ch)
            i += 1
            continue
        nxt = s[i + 1 : i + 2]
        if nxt in _ESCAPES:
            out.append(_ESCAPES[nxt])
            i += 2
        elif nxt in ("x", "u"):
            width = 2 if nxt == "x" else 4
            hexpart = s[i + 2 : i + 2 + width]
            if not re.fullmatch(r"[0-9A-Fa-f]{%d}" % width, hexpart):
                raise FrontmatterError(lineno, "bad \\%s escape" % nxt)
            code = int(hexpart, 16)
            if 0xD800 <= code <= 0xDFFF:
                raise FrontmatterError(lineno, "surrogate escape")
            out.append(chr(code))
            i += 2 + width
        else:
            raise FrontmatterError(lineno, "unsupported escape \\%s" % nxt)
    return "".join(out)


def _parse_block(lineno, head, children):
    m = re.fullmatch(r"([>|])([-+]?)", head)
    if not m:
        raise FrontmatterError(lineno, "unsupported block scalar header %r" % head)
    style, chomp = m.group(1), m.group(2)
    indent = None
    for _, raw in children:
        if raw.strip():
            indent = len(raw) - len(raw.lstrip(" "))
            break
    if not indent:
        return ""
    lines = []
    for no, raw in children:
        if not raw.strip():
            lines.append("")
            continue
        if len(raw) - len(raw.lstrip(" ")) < indent:
            raise FrontmatterError(no, "block scalar line less indented than the first")
        if style == ">" and len(raw) - len(raw.lstrip(" ")) > indent:
            raise FrontmatterError(no, "more-indented line in a folded block")
        lines.append(raw[indent:])
    trailing = 0
    while lines and lines[-1] == "":
        lines.pop()
        trailing += 1
    body = "\n".join(lines) if style == "|" else _fold(lines)
    if chomp == "-" or not body:
        return body
    if chomp == "+":
        return body + "\n" * (trailing + 1)
    return body + "\n"


def _parse_list(lineno, inline, children):
    children = _trim_trailing_blank(children)
    head = inline.strip()
    if not head and children and children[0][1].strip().startswith("["):
        lineno, first = children[0]
        head, children = first.strip(), children[1:]
    if head.startswith("["):
        text = head
        for no, raw in children:
            if raw[:1] != " " and raw.strip():
                raise FrontmatterError(no, "unindented continuation")
            text += " " + raw.strip()
        return _parse_flow_list(lineno, text)
    if head:
        raise FrontmatterError(lineno, "expected a list")
    items = []
    for no, raw in children:
        body = raw.strip()
        if not body or body.startswith("#"):
            continue
        if not (body.startswith("- ") or body == "-"):
            raise FrontmatterError(no, "expected `- item`")
        item = body[1:].strip()
        if not item:
            raise FrontmatterError(no, "empty list item")
        items.append(_parse_scalar_text(no, item, []))
    return items


def _parse_flow_list(lineno, text):
    text = _strip_flow_comment(text)
    if not text.endswith("]"):
        raise FrontmatterError(lineno, "unterminated flow list")
    inner = text[1:-1]
    items = []
    buf = ""
    quote = None
    i = 0
    while i < len(inner):
        ch = inner[i]
        if quote:
            buf += ch
            if ch == quote:
                if quote == "'" and inner[i + 1 : i + 2] == "'":
                    buf += "'"
                    i += 1
                elif not (quote == '"' and _ends_with_escape(buf[:-1])):
                    quote = None
        elif ch in "'\"" and not buf.strip():
            quote = ch
            buf += ch
        elif ch in "[]{}":
            raise FrontmatterError(lineno, "nested flow collection")
        elif ch == ",":
            items.append(buf)
            buf = ""
        else:
            buf += ch
        i += 1
    if quote:
        raise FrontmatterError(lineno, "unterminated quoted item")
    items.append(buf)
    out = []
    for k, raw in enumerate(items):
        item = raw.strip()
        if not item:
            if k == len(items) - 1:
                continue
            raise FrontmatterError(lineno, "empty flow list item")
        if item[0] in "'\"":
            out.append(_parse_quoted(lineno, item, []))
        else:
            if ": " in item:
                raise FrontmatterError(lineno, "`: ` inside a flow list item")
            out.append(item)
    return out


def _strip_flow_comment(text):
    quote = None
    for i, ch in enumerate(text):
        if quote:
            if ch == quote:
                quote = None
        elif ch in "'\"":
            quote = ch
        elif ch == "#" and i > 0 and text[i - 1] in " \t":
            return text[:i].rstrip()
    return text.rstrip()


# --------------------------------------------------------------------------
# Criteria and corpus
# --------------------------------------------------------------------------


def _num_in(v, lo, hi):
    return _number(v) is not None and lo <= v <= hi


def load_criteria():
    """Load and check the frozen criteria file; return (data, sha256 of the
    file's bytes). Every value run or report reads is validated here."""
    with open(CRITERIA_FILE, "rb") as fh:
        raw = fh.read()
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise UsageError("criteria file is not valid UTF-8 JSON") from None
    if not isinstance(data, dict) or data.get("schema") != 1:
        raise UsageError("unsupported criteria schema")
    crit = data.get("criteria")
    if not isinstance(crit, dict) or not crit:
        raise UsageError("criteria file has no criteria")
    for name, entry in crit.items():
        if not isinstance(entry, dict) or not all(
            isinstance(entry.get(k), str) and entry[k] for k in ("what", "not_for")
        ):
            raise UsageError("criteria entry %s needs `what` and `not_for`" % name)
    if not (isinstance(data.get("frozen_at"), str) and DATE_RE.fullmatch(data["frozen_at"])):
        raise UsageError("criteria file needs frozen_at as YYYY-MM-DD")
    if not (isinstance(data.get("instructions"), str) and data["instructions"].strip()):
        raise UsageError("criteria file needs instructions")
    if not (isinstance(data.get("model_default"), str) and MODEL_RE.fullmatch(data["model_default"])):
        raise UsageError("criteria file needs model_default like jev-1.13.0")
    protocol = data.get("protocol")
    try:
        rule = protocol["go_rule"]
        adj = protocol["adjudication"]
        ok = (
            isinstance(protocol["primary_metric"], str)
            and isinstance(rule["test"], str)
            and isinstance(protocol["confidence_thresholds"], list)
            and protocol["confidence_thresholds"]
            and all(_num_in(t, 0, 1) and t > 0 for t in protocol["confidence_thresholds"])
            and _num_in(rule["margin"], 0, 1) and rule["margin"] > 0
            and _num_in(rule["alpha_one_sided"], 0, 0.5) and rule["alpha_one_sided"] > 0
            and isinstance(rule["look_at_n"], int) and not isinstance(rule["look_at_n"], bool)
            and rule["look_at_n"] >= 1
            and _num_in(adj["agreement_sample_fraction"], 0, 1)
            and isinstance(adj["agreement_sample_seed"], int)
            and not isinstance(adj["agreement_sample_seed"], bool)
        )
    except (KeyError, TypeError):
        ok = False
    if not ok:
        raise UsageError("criteria file has a missing or out-of-range protocol value")
    return data, hashlib.sha256(raw).hexdigest()


def git(repo, *args, data=None):
    """Run git with the API key removed from its environment and the
    repository's fsmonitor and hooks disabled, since --repo may be any
    checkout."""
    env = {k: v for k, v in os.environ.items() if k != "TYPESAFE_API_KEY"}
    proc = subprocess.run(
        ["git", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-C", repo, *args],
        input=data,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if proc.returncode != 0:
        raise UsageError("git %s failed in %s" % (args[0], repo))
    return proc.stdout


def read_index_blobs(repo, paths):
    """Read each path's staged blob, so only git-tracked content is sent."""
    if not paths:
        return {}
    req = "".join(":%s\n" % p for p in paths).encode("utf-8")
    out = git(repo, "cat-file", "--batch", data=req)
    blobs = {}
    pos = 0
    for p in paths:
        nl = out.index(b"\n", pos)
        header = out[pos:nl].decode("utf-8", "replace").split()
        pos = nl + 1
        if len(header) != 3 or header[1] != "blob":
            blobs[p] = None
            continue
        size = int(header[2])
        blobs[p] = out[pos : pos + size]
        pos += size + 1
    return blobs


def split_for(path, date, frozen_at):
    m = DATE_RE.match(date or "")
    if m and m.group(1) > frozen_at:
        return "holdout"
    bucket = int(hashlib.sha256(path.encode("utf-8")).hexdigest(), 16) % 100
    return "dev" if bucket < 30 else "test"


def collect_docs(repo, criteria):
    """Return (docs, skipped) where skipped counts docs per skip reason."""
    names = git(repo, "ls-files", "-z", "--", "docs/solutions").split(b"\0")
    skipped = collections.Counter()
    skip = skipped.update

    candidates = []
    for raw in names:
        if not raw:
            continue
        try:
            path = raw.decode("utf-8")
        except UnicodeDecodeError:
            skip(["bad-path"])
            continue
        parts = path.split("/")
        if len(parts) != 4 or not path.endswith(".md"):
            continue
        if re.search(r"[\t\n\r]", path):
            skip(["bad-path"])
            continue
        folder = parts[2]
        if folder == "archived":
            skip(["archived"])
            continue
        if folder not in criteria["criteria"]:
            skip(["unknown-folder"])
            continue
        candidates.append((path, folder))
    candidates.sort()
    blobs = read_index_blobs(repo, [p for p, _ in candidates])
    docs = []
    for path, folder in candidates:
        blob = blobs.get(path)
        if blob is None:
            skip(["unreadable"])
            continue
        try:
            fm = parse_frontmatter(blob.decode("utf-8"))
        except (UnicodeDecodeError, FrontmatterError):
            skip(["parse-error"])
            continue
        if fm is None:
            skip(["no-frontmatter"])
            continue
        title, problem = fm["title"].strip(), fm["problem"].strip()
        if not title and not problem:
            skip(["no-title-or-problem"])
            continue
        date = fm["date"].strip()
        m = DATE_RE.match(date)
        docs.append(
            {
                "path": path,
                "folder": folder,
                "date": m.group(1) if m else None,
                "split": split_for(path, date, criteria["frozen_at"]),
                "lesson": {
                    "title": title,
                    "problem": problem,
                    "tags": [t.strip() for t in fm["tags"] if t.strip()],
                },
            }
        )
    return docs, skipped


def request_body(doc, criteria, model):
    return json.dumps(
        {
            "model": model,
            "state": {"lesson": doc["lesson"]},
            "questions": {
                "category": {
                    "type": "choice",
                    "instructions": criteria["instructions"],
                    "criteria": criteria["criteria"],
                }
            },
        },
        ensure_ascii=False,
    ).encode("utf-8")


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def validate_url(url):
    parts = urllib.parse.urlsplit(url)
    if parts.username is not None or parts.password is not None:
        raise UsageError("--url must not carry credentials")
    if not parts.hostname:
        raise UsageError("--url needs a host")
    try:
        parts.port
    except ValueError:
        raise UsageError("--url has an invalid port") from None
    if parts.scheme == "https":
        return
    if parts.scheme == "http":
        try:
            loopback = ip_address(parts.hostname).is_loopback
        except ValueError:
            loopback = False
        if loopback:
            return
        raise UsageError("--url over plain http is allowed only to a loopback IP address")
    raise UsageError("--url must be https")


def _retry_after(headers):
    """Seconds from a delta-seconds Retry-After, capped; None otherwise."""
    value = ((headers or {}).get("Retry-After") or "").strip()
    if re.fullmatch(r"[0-9]{1,6}", value):
        return min(float(value), RETRY_AFTER_CAP_S)
    return None


def post_once(opener, url, body, key, timeout):
    """Return (status, http_code, payload, retry_after). status is "ok" or
    an "error:<class>" token; payload is the decoded JSON for "ok". Never
    raises, and never carries exception or response text."""
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    req.add_unredirected_header("Authorization", "Bearer " + key)
    try:
        with opener.open(req, timeout=timeout) as resp:
            raw = resp.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as exc:
        retry_after = _retry_after(exc.headers)
        exc.close()
        if 300 <= exc.code < 400:
            return "error:redirect", exc.code, None, None
        return "error:http-%d" % exc.code, exc.code, None, retry_after
    except (OSError, http.client.HTTPException) as exc:
        reason = getattr(exc, "reason", exc)
        if isinstance(reason, (socket.timeout, TimeoutError)):
            return "error:timeout", None, None, None
        return "error:network", None, None, None
    except Exception:  # anything else from the client stack: no detail kept
        return "error:client", None, None, None
    if len(raw) > MAX_RESPONSE_BYTES:
        return "error:bad-response", None, None, None
    try:
        return "ok", None, json.loads(raw.decode("utf-8")), None
    except (UnicodeDecodeError, ValueError, RecursionError):
        return "error:bad-response", None, None, None


def post_with_retry(opener, url, body, key, timeout):
    """One retry on a timeout, a network error or a RETRY_STATUSES code.
    `timeout` bounds each attempt's socket operations, not the whole
    request. Returns (status, payload, elapsed seconds across attempts)."""
    started = time.monotonic()
    for attempt in (1, 2):
        status, code, payload, retry_after = post_once(opener, url, body, key, timeout)
        retryable = status in ("error:timeout", "error:network") or code in RETRY_STATUSES
        if not retryable or attempt == 2:
            break
        time.sleep(1.0 if retry_after is None else retry_after)
    return status, payload, time.monotonic() - started


def _number(v):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    try:
        f = float(v)
    except OverflowError:
        return None
    return f if math.isfinite(f) else None


def empty_fields():
    return {
        "prediction": None,
        "confidence": None,
        "probabilities": {},
        "model_returned": None,
        "input_tokens": None,
    }


def interpret(payload, criteria):
    """Map a decoded response to (status, row fields). A well-formed answer
    whose choice is outside the criteria is "invalid" (a Jev miss); a body
    without a category answer is "error:bad-response" (no answer at all)."""
    keys = criteria["criteria"]
    fields = empty_fields()
    if not isinstance(payload, dict):
        return "error:bad-response", fields
    model = payload.get("model")
    if isinstance(model, str) and MODEL_RE.fullmatch(model):
        fields["model_returned"] = model
    usage = payload.get("usage")
    if isinstance(usage, dict) and isinstance(usage.get("input_tokens"), int):
        fields["input_tokens"] = usage["input_tokens"]
    answers = payload.get("answers")
    answer = answers.get("category") if isinstance(answers, dict) else None
    if not isinstance(answer, dict) or not isinstance(answer.get("choice"), str):
        return "error:bad-response", fields
    conf = _number(answer.get("confidence"))
    if conf is not None and 0 <= conf <= 1:
        fields["confidence"] = conf
    probs = answer.get("probabilities")
    if isinstance(probs, dict):
        fields["probabilities"] = {
            k: _number(v) for k, v in probs.items() if k in keys and _number(v) is not None
        }
    choice = answer["choice"]
    if choice not in keys:
        return "invalid", fields
    fields["prediction"] = choice
    return "ok", fields


# --------------------------------------------------------------------------
# run
# --------------------------------------------------------------------------


def _inside(child, parent):
    return child == parent or child.startswith(parent.rstrip(os.sep) + os.sep)


def cmd_run(args):
    criteria, criteria_sha = load_criteria()
    repo = os.path.realpath(args.repo)
    try:
        top = git(repo, "rev-parse", "--show-toplevel").decode("utf-8").strip()
    except UsageError:
        raise UsageError("--repo is not a git repository") from None
    top = os.path.realpath(top)
    if args.out is None and not args.dry_run:
        raise UsageError("--out is required")
    out_dir = None
    if args.out is not None:
        out_dir = os.path.realpath(args.out)
        if _inside(out_dir, top):
            raise UsageError("--out must be outside the repository")
    validate_url(args.url)
    if not (math.isfinite(args.timeout) and 0 < args.timeout <= 600):
        raise UsageError("--timeout must be between 0 and 600 seconds")
    model = args.model or criteria["model_default"]

    key = None
    if not args.dry_run:
        key = os.environ.get("TYPESAFE_API_KEY", "").strip()
        if not key:
            raise UsageError("TYPESAFE_API_KEY is not set")
        if not re.fullmatch(r"[\x21-\x7e]+", key):
            raise UsageError("TYPESAFE_API_KEY must be printable ASCII with no spaces")

    docs, skipped = collect_docs(top, criteria)
    eligible = len(docs)
    if args.limit is not None:
        docs = docs[: args.limit]
    skip_text = _fmt_counts(skipped)
    per_split = collections.Counter(d["split"] for d in docs)
    split_text = "dev=%d test=%d holdout=%d" % (per_split["dev"], per_split["test"], per_split["holdout"])

    if args.dry_run:
        size = sum(len(request_body(d, criteria, model)) for d in docs)
        print("dry-run: nothing sent")
        print("eligible_docs=%d (%s)" % (len(docs), split_text))
        print("skipped: %s" % skip_text)
        print("estimated_input_bytes=%d (~%d tokens)" % (size, size // 4))
        print("model=%s criteria_sha=%s" % (model, criteria_sha))
        return 0
    if not docs:
        raise UsageError("no eligible docs to send (skipped: %s)" % skip_text)

    if os.path.isdir(out_dir) and os.stat(out_dir).st_mode & 0o022:
        raise UsageError("--out is writable by other users; use a private directory")
    os.makedirs(out_dir, mode=0o700, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_path = os.path.join(out_dir, "results-%s.jsonl" % stamp)
    try:
        fd = os.open(out_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    except FileExistsError:
        raise UsageError("results file already exists: %s" % out_path) from None

    ctx = ssl.create_default_context()
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=ctx), _NoRedirect()
    )
    counts = collections.Counter()
    streak = 0
    aborted = False
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        for index, doc in enumerate(docs, 1):
            status, payload, elapsed = post_with_retry(
                opener, args.url, request_body(doc, criteria, model), key, args.timeout
            )
            if status == "ok":
                status, fields = interpret(payload, criteria)
            else:
                fields = empty_fields()
            row = {
                "schema": ROW_SCHEMA,
                "path": doc["path"],
                "folder": doc["folder"],
                "split": doc["split"],
                "date": doc["date"],
                "prediction": fields["prediction"],
                "confidence": fields["confidence"],
                "probabilities": fields["probabilities"],
                "model_requested": model,
                "model_returned": fields["model_returned"],
                "criteria_sha": criteria_sha,
                "latency_s": round(elapsed, 3),
                "input_tokens": fields["input_tokens"],
                "status": status,
            }
            fh.write(json.dumps(row, sort_keys=True) + "\n")
            fh.flush()
            counts[status] += 1
            streak = streak + 1 if status.startswith("error:") else 0
            if index % 25 == 0:
                print("progress: %d/%d" % (index, len(docs)), file=sys.stderr, flush=True)
            if streak >= ABORT_AFTER_ERRORS and index < len(docs):
                aborted = True
                break
        summary = {
            "schema": ROW_SCHEMA,
            "record": "summary",
            "criteria_sha": criteria_sha,
            "eligible": eligible,
            "written": sum(counts.values()),
            "limit": args.limit,
            "aborted": aborted,
            "skipped": dict(skipped),
        }
        fh.write(json.dumps(summary, sort_keys=True) + "\n")

    print("requests=%d of %d (%s)" % (sum(counts.values()), len(docs), split_text))
    print("status: %s" % _fmt_counts(counts))
    print("skipped: %s" % skip_text)
    print("results: %s" % out_path)
    if aborted:
        print(
            "jev-category-eval: stopped after %d consecutive failed requests; the results file is partial"
            % ABORT_AFTER_ERRORS,
            file=sys.stderr,
        )
        return 1
    if counts["ok"] == 0:
        return 1
    return 0


def _fmt_counts(counter):
    return ", ".join("%s=%d" % kv for kv in sorted(counter.items())) or "none"


# --------------------------------------------------------------------------
# Statistics
# --------------------------------------------------------------------------


def wilson(k, n, z):
    if n == 0:
        return None
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, centre - half), min(1.0, centre + half)


def tango_score(b, c, n, delta):
    """Tango (1998) score statistic for delta = (b - c) / n, where b counts
    pairs only the first rater got right and c pairs only the second got
    right. Decreasing in delta."""
    a2 = 2 * n
    b2 = -b - c + (2 * n - b + c) * delta
    c2 = -c * delta * (1 - delta)
    q21 = (math.sqrt(max(b2 * b2 - 4 * a2 * c2, 0.0)) - b2) / (2 * a2)
    var = n * (2 * q21 + delta * (1 - delta))
    num = b - c - n * delta
    if var <= 0:
        return 0.0 if num == 0 else math.copysign(math.inf, num)
    return num / math.sqrt(var)


def tango_interval(b, c, n, z):
    """Two-sided score interval for (b - c) / n at normal quantile z, by
    bisection on the score function. Agrees with a line-for-line Python port
    of PropCIs::scoreci.mp (with its b and c swapped: PropCIs estimates
    (c - b) / n) and with an independent numeric-MLE check; it has not been
    compared with output from R itself."""
    if n <= 0:
        return None

    def solve(target, lo, hi):
        # score(lo) > target > score(hi); find the crossing.
        for _ in range(200):
            mid = (lo + hi) / 2
            if tango_score(b, c, n, mid) > target:
                lo = mid
            else:
                hi = mid
        return (lo + hi) / 2

    est = (b - c) / n
    eps = 1e-12
    lower = -1.0 if c == n else solve(z, -1.0 + eps, est)
    upper = 1.0 if b == n else solve(-z, est, 1.0 - eps)
    if tango_score(b, c, n, -1.0 + eps) <= z:
        lower = -1.0
    if tango_score(b, c, n, 1.0 - eps) >= -z:
        upper = 1.0
    return lower, upper


# --------------------------------------------------------------------------
# report
# --------------------------------------------------------------------------


ROW_PATH_RE = re.compile(r"docs/solutions/[a-z0-9-]+/[^\x00-\x1f\x7f/]+\.md")
LABEL_RE = re.compile(r"[a-z0-9-]+")
STATUS_RE = re.compile(r"ok|invalid|error:[a-z0-9-]+")


def _is(pattern, value):
    """Whole-string match; re.match with `$` would accept a trailing newline."""
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def _check_row(row):
    checks = (
        ("path", _is(ROW_PATH_RE, row.get("path"))),
        ("folder", _is(LABEL_RE, row.get("folder"))),
        ("split", row.get("split") in SPLITS),
        ("status", _is(STATUS_RE, row.get("status"))),
        ("criteria_sha", _is(LABEL_RE, row.get("criteria_sha"))),
        ("prediction", row.get("prediction") is None or _is(LABEL_RE, row["prediction"])),
        ("prediction", (row.get("status") == "ok") == (row.get("prediction") is not None)),
        ("confidence", row.get("confidence") is None or _num_in(row["confidence"], 0, 1)),
        ("model_returned", row.get("model_returned") is None or _is(MODEL_RE, row["model_returned"])),
        ("date", row.get("date") is None or _is(DATE_RE, row["date"])),
    )
    return next((field for field, ok in checks if not ok), None)


def _check_summary(rec):
    def count(v):
        return isinstance(v, int) and not isinstance(v, bool) and v >= 0

    checks = (
        ("criteria_sha", _is(LABEL_RE, rec.get("criteria_sha"))),
        ("eligible", count(rec.get("eligible"))),
        ("written", count(rec.get("written"))),
        ("limit", rec.get("limit") is None or count(rec["limit"])),
        ("aborted", isinstance(rec.get("aborted"), bool)),
        ("skipped", isinstance(rec.get("skipped"), dict)
         and all(_is(LABEL_RE, k) and count(v) for k, v in rec["skipped"].items())),
    )
    return next((field for field, ok in checks if not ok), None)


def load_rows(path):
    """Read and validate a results file; return (rows, summary or None).
    Every field report prints or writes is checked, so a crafted file cannot
    inject terminal escapes or extra TSV rows. A path may appear only once,
    and the summary record, when present, must be the last line."""
    rows = []
    summary = None
    seen = set()
    try:
        with open(path, encoding="utf-8") as fh:
            lines = [(n, line) for n, line in enumerate(fh, 1) if line.strip()]
    except UnicodeDecodeError:
        raise UsageError("%s is not UTF-8" % path) from None
    for lineno, line in lines:
        where = "%s:%d" % (path, lineno)
        if summary is not None:
            raise UsageError("%s follows the summary record" % where)
        try:
            row = json.loads(line)
        except (ValueError, RecursionError):
            raise UsageError("%s is not JSON" % where) from None
        if not isinstance(row, dict) or row.get("schema") != ROW_SCHEMA:
            raise UsageError("%s has an unsupported row schema" % where)
        if row.get("record") == "summary":
            bad = _check_summary(row)
            if bad:
                raise UsageError("%s has a bad summary %s" % (where, bad))
            summary = row
            continue
        if "record" in row:
            raise UsageError("%s has an unknown record type" % where)
        bad = _check_row(row)
        if bad:
            raise UsageError("%s has a bad %s" % (where, bad))
        if row["path"] in seen:
            raise UsageError("%s repeats path %s; report one run at a time" % (where, row["path"]))
        seen.add(row["path"])
        rows.append(row)
    return rows, summary


def read_review(path):
    """Return {(path, folder, jev): judgement} for every judged row. A judged
    row with a malformed path or label, or a repeated triple, is an error
    rather than a judgement silently dropped later."""
    marks = {}
    try:
        with open(path, encoding="utf-8") as fh:
            header = fh.readline().rstrip("\n").split("\t")
            missing = [c for c in ("path", "folder", "jev", "judgement") if c not in header]
            if missing:
                raise UsageError("%s: header lacks %s" % (path, ", ".join(missing)))
            idx = {name: header.index(name) for name in header}
            for lineno, line in enumerate(fh, 2):
                line = line.rstrip("\n")
                if not line.strip():
                    continue
                cols = line.split("\t")
                if len(cols) < len(header):
                    cols += [""] * (len(header) - len(cols))
                judgement = cols[idx["judgement"]].strip()
                if not judgement:
                    continue
                if judgement not in JUDGEMENTS:
                    raise UsageError(
                        "%s:%d: judgement must be one of %s or empty" % (path, lineno, "|".join(JUDGEMENTS))
                    )
                key = (cols[idx["path"]], cols[idx["folder"]], cols[idx["jev"]])
                if not (_is(ROW_PATH_RE, key[0]) and _is(LABEL_RE, key[1]) and _is(LABEL_RE, key[2])):
                    raise UsageError("%s:%d: judged row has a malformed path, folder or jev" % (path, lineno))
                if key in marks:
                    raise UsageError("%s:%d: repeats a judged path/folder/jev row" % (path, lineno))
                marks[key] = judgement
    except UnicodeDecodeError:
        raise UsageError("%s is not UTF-8" % path) from None
    return marks


def _private_regular_file(path):
    try:
        st = os.lstat(path)
    except FileNotFoundError:
        return False
    return stat.S_ISREG(st.st_mode) and st.st_uid == os.getuid() and not st.st_mode & 0o022


def sampled(path, seed, fraction):
    """Deterministic per-path draw, stable as the results grow."""
    h = int(hashlib.sha256(("%s:%s" % (seed, path)).encode("utf-8")).hexdigest(), 16)
    return (h % 10000) < round(fraction * 10000)


def _pct(k, n):
    return "%d/%d = %.1f%%" % (k, n, 100.0 * k / n) if n else "%d/%d = n/a" % (k, n)


def write_tsv(path, entries):
    """Atomic replace through a fresh mode-600 temp file (O_EXCL, random
    name), removed again if anything fails before the rename."""
    fd, tmp = tempfile.mkstemp(prefix=".disagreements-", suffix=".part", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write("\t".join(TSV_COLUMNS) + "\n")
            for e in entries:
                conf = "" if e["confidence"] is None else "%.2f" % e["confidence"]
                fh.write("\t".join([e["path"], e["folder"], e["jev"], conf, e["kind"], e["judgement"]]) + "\n")
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _outcome(row, judged):
    """(folder_right, jev_right) for an ok row, or None while a listed row
    awaits its judgement. A row not listed is an unsampled agreement and
    counts as correct for both."""
    if row["path"] not in judged:
        return (True, True)
    judgement = judged[row["path"]]
    if not judgement:
        return None
    if row["prediction"] == row["folder"]:
        right = judgement != "neither"
        return (right, right)
    return (judgement in ("folder", "both"), judgement in ("jev", "both"))


def _coverage_problem(rows, summary):
    """None for a complete run, else why the results cannot carry a verdict."""
    if summary is None:
        return "the results file has no run summary (an interrupted run?)"
    if summary["aborted"]:
        return "the run stopped early after repeated request failures"
    if summary["limit"] is not None:
        return "the run used --limit %d" % summary["limit"]
    if summary["written"] != summary["eligible"] or len(rows) != summary["written"]:
        return "the run wrote %d of %d eligible docs" % (len(rows), summary["eligible"])
    return None


def cmd_report(args):
    criteria, current_sha = load_criteria()
    protocol = criteria["protocol"]
    rows, summary = load_rows(args.results)
    shas = sorted({r["criteria_sha"] for r in rows} | ({summary["criteria_sha"]} if summary else set()))
    if len(shas) > 1:
        raise UsageError("results mix %d criteria shas; report one criteria version at a time" % len(shas))
    models = sorted({r["model_returned"] for r in rows if r.get("model_returned")})
    if len(models) > 1:
        raise UsageError("results mix models (%s); report one model at a time" % ", ".join(models))
    frozen_seed = protocol["adjudication"]["agreement_sample_seed"]
    seed = frozen_seed if args.seed is None else args.seed
    fraction = protocol["adjudication"]["agreement_sample_fraction"]
    thresholds = protocol["confidence_thresholds"]
    rule = protocol["go_rule"]
    z95 = statistics.NormalDist().inv_cdf(0.975)

    # Where judgements come from. Never overwrite a file whose judgements
    # this run did not read.
    tsv_path = os.path.join(os.path.dirname(os.path.abspath(args.results)), "disagreements.tsv")
    if args.review:
        review_path = args.review
        marks = read_review(args.review)
        if os.path.realpath(args.review) != os.path.realpath(tsv_path) and os.path.lexists(tsv_path):
            lost = [k for k, j in read_review(tsv_path).items() if marks.get(k) != j]
            if lost:
                raise UsageError(
                    "%s holds %d judgement(s) missing from --review that this run would overwrite; "
                    "pass it as --review or move it" % (tsv_path, len(lost))
                )
    elif _private_regular_file(tsv_path):
        review_path = tsv_path
        marks = read_review(tsv_path)
    elif os.path.lexists(tsv_path):
        raise UsageError(
            "%s exists but is not a private regular file you own; check it, then pass it as --review "
            "(or move it) so its judgements are not overwritten" % tsv_path
        )
    else:
        review_path = None
        marks = {}

    sha = shas[0] if shas else "none"
    coverage = _coverage_problem(rows, summary)
    print("jev-category-eval report")
    print("results: %s (%d rows)" % (args.results, len(rows)))
    print("criteria_sha: %s (%s)" % (sha, "matches the current criteria file" if sha == current_sha else "differs from the current criteria file %s" % current_sha))
    print("model: %s" % (models[0] if models else "none returned"))
    print("coverage: %s" % ("complete, %d of %d eligible docs" % (len(rows), summary["eligible"]) if coverage is None else "partial: " + coverage))
    if summary:
        print("skipped by run: %s" % _fmt_counts(summary["skipped"]))
    print("protocol: primary metric = %s" % protocol["primary_metric"])
    print(
        "protocol: thresholds %s fixed in advance; verdict = %s, margin %.2f, one-sided alpha %.2f, one look at n=%d holdout docs; no change ships without GO"
        % (", ".join("%.2f" % t for t in thresholds), rule["test"], rule["margin"], rule["alpha_one_sided"], rule["look_at_n"])
    )
    if seed != frozen_seed:
        print("warning: --seed %d is not the pre-registered seed %d; this is not the pre-registered analysis" % (seed, frozen_seed))

    groups = []
    for name, group in [(s, [r for r in rows if r["split"] == s]) for s in SPLITS] + [("all", rows)]:
        groups.append((name, group, [r for r in group if r["status"] == "ok"]))
    for name, group, ok in groups:
        errors = sum(1 for r in group if r["status"].startswith("error:"))
        invalid = sum(1 for r in group if r["status"] == "invalid")
        print("")
        print("split %s: n=%d ok=%d error=%d invalid=%d" % (name, len(group), len(ok), errors, invalid))
        if not ok:
            continue
        agree = sum(1 for r in ok if r["prediction"] == r["folder"])
        lo, hi = wilson(agree, len(ok), z95)
        print("  agreement %s of ok rows (Wilson 95%% %.1f%%-%.1f%%)" % (_pct(agree, len(ok)), 100 * lo, 100 * hi))
        for t in thresholds:
            covered = [r for r in ok if r.get("confidence") is not None and r["confidence"] >= t]
            hit = sum(1 for r in covered if r["prediction"] == r["folder"])
            print("  conf>=%.2f: coverage %s, agreement %s" % (t, _pct(len(covered), len(ok)), _pct(hit, len(covered))))
        pairs = collections.Counter("%s -> %s" % (r["folder"], r["prediction"]) for r in ok if r["prediction"] != r["folder"])
        top = sorted(pairs.items(), key=lambda kv: (-kv[1], kv[0]))[:8]
        print("  confusion (folder -> jev): %s" % ("; ".join("%s %d" % kv for kv in top) or "none"))

    # List every disagreement, the sampled agreements, and any agreement
    # already judged; carry a judgement only onto the same path/folder/jev.
    entries = []
    judged = {}
    used = set()
    ok_rows = sorted((r for r in rows if r["status"] == "ok"), key=lambda r: r["path"])
    for r in ok_rows:
        key = (r["path"], r["folder"], r["prediction"])
        if r["prediction"] != r["folder"]:
            kind = "disagreement"
        elif sampled(r["path"], seed, fraction):
            kind = "agreement-sample"
        elif key in marks:
            kind = "agreement-judged"
        else:
            continue
        judgement = marks.get(key, "")
        if judgement:
            used.add(key)
        judged[r["path"]] = judgement
        entries.append(
            {"path": r["path"], "folder": r["folder"], "jev": r["prediction"], "confidence": r.get("confidence"), "kind": kind, "judgement": judgement}
        )
    ok_paths = {r["path"] for r in ok_rows}
    kept = {"stale": 0, "orphan": 0}
    for key in sorted(k for k in marks if k not in used):
        kind = "stale" if key[0] in ok_paths else "orphan"
        kept[kind] += 1
        entries.append({"path": key[0], "folder": key[1], "jev": key[2], "confidence": None, "kind": kind, "judgement": marks[key]})
    write_tsv(tsv_path, entries)

    print("")
    print("adjudication (review: %s)" % (review_path or "none"))
    if kept["stale"]:
        print("  %d judgement(s) kept as kind=stale: the doc's folder or Jev's answer changed since it was judged" % kept["stale"])
    if kept["orphan"]:
        print("  %d judgement(s) kept as kind=orphan: the doc has no ok row in these results" % kept["orphan"])
    for name, group, ok in groups:
        if not ok:
            continue
        outcomes = [(r, _outcome(r, judged)) for r in ok]
        done = [o for _, o in outcomes if o is not None]
        assumed = sum(1 for r, _ in outcomes if r["path"] not in judged)
        print(
            "  %s: folder %s, jev %s; awaiting judgement %d; unsampled agreements counted correct for both %d"
            % (name, _pct(sum(o[0] for o in done), len(done)), _pct(sum(o[1] for o in done), len(done)), len(outcomes) - len(done), assumed)
        )

    # Verdict on the first look_at_n holdout docs by (date, path), whatever
    # their status, so failed requests cannot change which docs are in the
    # look. An invalid answer is a Jev miss (folder taken as right); a
    # request error blocks the verdict until a new full run answers it.
    holdout = sorted((r for r in rows if r["split"] == "holdout"), key=lambda r: (r.get("date") or "", r["path"]))
    look = rule["look_at_n"]
    margin = rule["margin"]
    z = statistics.NormalDist().inv_cdf(1 - rule["alpha_one_sided"])
    window = holdout[:look]
    errored = sum(1 for r in window if r["status"].startswith("error:"))
    pending = b = c = n = 0
    for r in window:
        if r["status"].startswith("error:"):
            continue
        outcome = (True, False) if r["status"] == "invalid" else _outcome(r, judged)
        if outcome is None:
            pending += 1
            continue
        n += 1
        if outcome[1] and not outcome[0]:
            b += 1
        elif outcome[0] and not outcome[1]:
            c += 1
    interval = tango_interval(b, c, n, z)
    print("")
    if sha != current_sha:
        print("verdict: INSUFFICIENT-DATA (the results were made under another criteria file; its protocol is not the one loaded here; descriptive only)")
    elif coverage is not None:
        print("verdict: INSUFFICIENT-DATA (%s; descriptive only)" % coverage)
    elif len(holdout) < look:
        print("verdict: INSUFFICIENT-DATA (holdout has %d docs, the look is at %d; descriptive only)" % (len(holdout), look))
    elif errored:
        print(
            "verdict: INSUFFICIENT-DATA (%d of the first %d holdout docs have no answer (request errors); "
            "make a new full run, since report reads one results file; descriptive only)" % (errored, look)
        )
    elif pending:
        print("verdict: INSUFFICIENT-DATA (%d of the first %d holdout docs await a judgement; descriptive only)" % (pending, look))
    elif interval[0] > -margin:
        print("verdict: GO (lower bound above -%.2f)" % margin)
    elif interval[1] < -margin:
        print("verdict: NO-GO (upper bound below -%.2f)" % margin)
    else:
        print("verdict: INSUFFICIENT-DATA (interval straddles -%.2f)" % margin)
    print(
        "  jev minus folder on %d adjudicated holdout docs: jev-only %d, folder-only %d, Tango %.0f%% interval %s"
        % (n, b, c, 100 * (1 - 2 * rule["alpha_one_sided"]), "[%.4f, %.4f]" % interval if interval else "n/a")
    )
    listed = [e for e in entries if e["kind"] not in ("stale", "orphan")]
    print(
        "disagreements: %s (%d disagreements, %d agreements listed, %d judged)"
        % (tsv_path, sum(1 for e in listed if e["kind"] == "disagreement"),
           sum(1 for e in listed if e["kind"] != "disagreement"), sum(1 for e in listed if e["judgement"]))
    )
    return 0


# --------------------------------------------------------------------------


def main(argv=None):
    parser = argparse.ArgumentParser(prog="jev-category-eval.py", description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run", help="send each doc's frontmatter to Jev")
    run.add_argument("--repo", default=".")
    run.add_argument("--out")
    run.add_argument("--model")
    run.add_argument("--url", default=DEFAULT_URL)
    run.add_argument("--timeout", type=float, default=30.0)
    run.add_argument("--limit", type=int)
    run.add_argument("--dry-run", action="store_true")
    rep = sub.add_parser("report", help="summarise a results file offline")
    rep.add_argument("results")
    rep.add_argument("--review")
    rep.add_argument("--seed", type=int)
    args = parser.parse_args(argv)
    try:
        if args.command == "run":
            if args.limit is not None and args.limit < 0:
                raise UsageError("--limit must be zero or more")
            return cmd_run(args)
        return cmd_report(args)
    except UsageError as exc:
        print("jev-category-eval: %s" % exc, file=sys.stderr)
        return 2
    except OSError as exc:
        print("jev-category-eval: %s: %s" % (type(exc).__name__, exc.strerror or "I/O error"), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
