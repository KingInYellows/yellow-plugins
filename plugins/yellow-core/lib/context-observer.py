#!/usr/bin/env python3
"""yellow-core: opt-in context observer for the Claude Code statusline pipeline.

Installed by /statusline:setup (or a manual merge) as the first stage of the
user's statusLine command:

    python3 ~/.claude/yellow-context-observer.py | python3 ~/.claude/yellow-statusline.py

Contract (spec R19-R22, plans/specs/session-continuity-foundation.md):
  - Reads the statusline JSON payload from stdin and writes it to stdout
    byte-for-byte BEFORE any other work, so the statusline never waits on
    the observer and a broken observer cannot blank the statusline.
  - Exits 0 on every path: malformed input, missing session id, unwritable
    disk, SIGPIPE from a closed downstream, anything else.
  - Records one observation per session to
      ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/<slug>/context-observations/<session_id>.json
    (observer_format 1) through a temp file plus os.replace, so a reader
    sees either the previous complete record or the new one, never a partial.
  - Tracks a provisional advisory watermark on remaining context (default
    50 %); crossing it below is counted in the record and nothing else
    happens: no stdout, no stderr, no spawn, no model call.
  - No git, no network, no subprocess; stdlib only; Python 3.7+.
  - Silent: one stderr line only when CONTEXT_OBSERVER_DEBUG=1.

Environment:
  CLAUDE_CONFIG_DIR                          overrides ~/.claude as the record root
  YELLOW_CONTEXT_WATERMARK                   remaining-% watermark, integer 1-99 (default 50)
  CONTEXT_OBSERVER_DEBUG=1                   report a recording failure on stderr
  CONTEXT_OBSERVER_TEST_SLEEP_BEFORE_RENAME  test only: seconds to sleep before the rename
"""
import json
import os
import re
import sys
import tempfile
import time
from datetime import datetime, timezone

OBSERVER_FORMAT = 1
DEFAULT_WATERMARK = 50
SESSION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def parse_payload(raw):
    """Return the payload as a dict, or None for malformed JSON or a non-object."""
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def sanitize_session_id(value):
    """Accept only [A-Za-z0-9_-]{1,128}; anything else means write nothing."""
    if isinstance(value, str) and SESSION_ID_RE.match(value):
        return value
    return None


def project_slug(payload):
    """Slug for ~/.claude/projects/<slug>: workspace.project_dir, else cwd.

    Slashes become hyphens, which equals lib/compound-staging.sh's
    cs_derive_project_slug for a git toplevel without running git here (R22).
    """
    workspace = payload.get("workspace")
    candidate = workspace.get("project_dir") if isinstance(workspace, dict) else None
    if not isinstance(candidate, str) or not candidate:
        candidate = payload.get("cwd")
    if not isinstance(candidate, str) or not candidate:
        return None
    return candidate.replace("/", "-")


def config_dir():
    explicit = os.environ.get("CLAUDE_CONFIG_DIR")
    if explicit:
        return explicit
    home = os.environ.get("HOME")
    if home:
        return os.path.join(home, ".claude")
    return None


def record_path(slug, session_id):
    root = config_dir()
    if root is None or not slug or not session_id:
        return None
    return os.path.join(root, "projects", slug, "context-observations", session_id + ".json")


def number_or_none(value):
    """int or float (bool excluded) passes through; everything else is None."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value
    return None


def build_record(payload, session_id):
    window = payload.get("context_window")
    if not isinstance(window, dict):
        window = {}
    return {
        "observer_format": OBSERVER_FORMAT,
        "session_id": session_id,
        "observed_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        # Private state: stays in this untracked record and is never printed.
        "cwd": payload.get("cwd") if isinstance(payload.get("cwd"), str) else None,
        "transcript_present": bool(payload.get("transcript_path")),
        "context_window": {
            "used_percentage": number_or_none(window.get("used_percentage")),
            "remaining_percentage": number_or_none(window.get("remaining_percentage")),
            "context_window_size": number_or_none(window.get("context_window_size")),
            "current_usage_null": window.get("current_usage") is None,
        },
    }


def watermark_remaining():
    raw = os.environ.get("YELLOW_CONTEXT_WATERMARK", "")
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_WATERMARK
    return value if 1 <= value <= 99 else DEFAULT_WATERMARK


def load_previous(path, session_id):
    """Previous record for the same session, or None when absent or unusable."""
    try:
        with open(path, "r", encoding="utf-8") as handle:
            previous = json.load(handle)
    except (OSError, ValueError, UnicodeDecodeError):
        return None
    if not isinstance(previous, dict) or previous.get("session_id") != session_id:
        return None
    return previous


def advisory_state(previous, remaining, watermark):
    """Carry the advisory block forward per R21.

    state is "below" / "above" from a 0-100 remaining percentage, else
    "unknown". A crossing is counted when the state becomes "below" from
    anything that was not already "below" (the spec's "ten identical samples
    below the watermark yield one marker"). A null sample keeps the previous
    last_state, so below -> unknown -> below never manufactures a second
    crossing.
    """
    prev_advisory = previous.get("advisory") if isinstance(previous, dict) else None
    if not isinstance(prev_advisory, dict):
        prev_advisory = {}
    prev_state = prev_advisory.get("last_state")
    if prev_state not in ("above", "below"):
        prev_state = "unknown"
    prev_crossings = prev_advisory.get("crossings")
    if isinstance(prev_crossings, bool) or not isinstance(prev_crossings, int) or prev_crossings < 0:
        prev_crossings = 0

    if remaining is not None and 0 <= remaining <= 100:
        state = "below" if remaining < watermark else "above"
    else:
        state = "unknown"

    crossings = prev_crossings
    if state == "below" and prev_state != "below":
        crossings += 1
    last_state = state if state != "unknown" else prev_state
    return {"watermark_remaining": watermark, "crossings": crossings, "last_state": last_state}


def write_record(path, record):
    """Atomic write: 0700 dir, 0600 temp sibling, fsync, os.replace."""
    directory = os.path.dirname(path)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    try:
        os.chmod(directory, 0o700)
    except OSError:
        pass
    tmp = tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=directory,
        prefix="." + record["session_id"] + ".",
        suffix=".tmp",
        delete=False,
    )
    try:
        with tmp:
            os.fchmod(tmp.fileno(), 0o600)
            json.dump(record, tmp, sort_keys=True)
            tmp.write("\n")
            tmp.flush()
            os.fsync(tmp.fileno())
        delay = os.environ.get("CONTEXT_OBSERVER_TEST_SLEEP_BEFORE_RENAME")
        if delay:
            time.sleep(float(delay))
        os.replace(tmp.name, path)
    except BaseException:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
        raise


def record_observation(raw):
    payload = parse_payload(raw)
    if payload is None:
        return
    session_id = sanitize_session_id(payload.get("session_id"))
    slug = project_slug(payload)
    path = record_path(slug, session_id)
    if path is None:
        return
    record = build_record(payload, session_id)
    previous = load_previous(path, session_id)
    record["advisory"] = advisory_state(
        previous, record["context_window"]["remaining_percentage"], watermark_remaining()
    )
    write_record(path, record)


def main():
    raw = b""
    try:
        raw = sys.stdin.buffer.read()
        sys.stdout.buffer.write(raw)
        sys.stdout.buffer.flush()
    except BrokenPipeError:
        # Downstream closed early; point stdout at /dev/null so the interpreter's
        # exit-time flush cannot raise again, then still record what we read.
        try:
            os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        except OSError:
            pass
    except BaseException:
        pass
    try:
        record_observation(raw)
    except BaseException as exc:  # never let recording affect the statusline
        if os.environ.get("CONTEXT_OBSERVER_DEBUG") == "1":
            try:
                sys.stderr.write("[context-observer] %s: %s\n" % (type(exc).__name__, exc))
            except BaseException:
                pass
    sys.exit(0)


if __name__ == "__main__":
    main()
