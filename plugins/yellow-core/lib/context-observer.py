#!/usr/bin/env python3
"""yellow-core: opt-in context observer for the Claude Code statusline pipeline.

Installed by /statusline:setup (or a manual merge) as the first stage of the
user's statusLine command, as lib/statusline-settings.py composes it:

    { command -v python3 >/dev/null && [ -r OBS ] && exec python3 OBS; exec cat; } \
      | python3 ~/.claude/yellow-statusline.py

where OBS is ~/.claude/yellow-context-observer.py. The cat fallback keeps the
payload flowing when python3 or the observer file is missing; exec leaves the
observer as the only holder of the pipe's write end.

Contract (spec R19-R22, plans/specs/session-continuity-foundation.md):
  - Reads the statusline JSON payload from stdin, writes it to stdout
    byte-for-byte, and releases stdout BEFORE any other work, so the next
    stage sees EOF and computes its output while the observer records. Once
    main() runs, a failure while recording cannot blank the statusline; the
    cat fallback covers only a missing python3 or an unreadable observer
    file, so an observer that fails before it reads stdin (a syntax error,
    say) leaves the next stage with no payload. Claude Code shows the
    statusline only once the whole statusLine command exits, and the shell
    waits for the observer, so the display still waits for the record write
    (bounded by DEADLINE_SECONDS). A stage that wraps the observer without
    exec, such as "{ python3 OBS || cat; }", keeps the pipe open in its
    subshell, so the next stage does not see EOF, and cannot finish reading
    its payload, until recording ends.
  - Exits 0 on every path: malformed input, missing session id, unwritable
    disk, SIGPIPE from a closed downstream, anything else.
  - Records one observation per session to
      ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/<slug>/context-observations/<session_id>.json
    (observer_format 1) through the writer's own .<session_id>.<pid>.part
    file plus os.replace, so a reader sees either the previous complete
    record or the new one, never a partial. There is no lock: concurrent
    renders race last-writer-wins, which can at worst lose or repeat one
    advisory crossing (a hint, not a ledger). A killed writer leaves at most
    its .part file, swept once STALE_PART_SECONDS old. A record whose numbers
    are unchanged is rewritten only once it is REWRITE_AFTER_SECONDS old,
    which keeps it well inside the reader's 300 s staleness window. Recording
    is bounded by a DEADLINE_SECONDS deadline so a hung filesystem cannot hold
    the statusLine command open.
  - Tracks a provisional advisory watermark on remaining context (default
    50 %); crossing it below is counted in the record and nothing else
    happens: no stdout, no stderr, no spawn, no model call.
  - No git, no network, no subprocess; stdlib only; Python 3.7+.
  - Silent: with CONTEXT_OBSERVER_DEBUG=1 it writes one stderr line saying
    why nothing was recorded (a skipped payload, or a recording failure);
    otherwise nothing. Without the flag, a failing writer shows up only as a
    stale record on the reader side.
  - Run by hand with -h/--help, or with a terminal on stdin, it prints this
    text instead of waiting for a payload.

Environment:
  CLAUDE_CONFIG_DIR                          overrides ~/.claude as the record root
  YELLOW_CONTEXT_WATERMARK                   remaining-% watermark, integer 1-99 (default 50)
  CONTEXT_OBSERVER_DEBUG=1                   say on stderr why nothing was recorded
  CONTEXT_OBSERVER_TEST_SLEEP_BEFORE_RENAME  test only: seconds to sleep before the rename
"""
import calendar
import glob
import json
import math
import os
import re
import signal
import sys
import time

OBSERVER_FORMAT = 1
DEFAULT_WATERMARK = 50
SESSION_ID_RE = re.compile(r"[A-Za-z0-9_-]{1,128}")
TIMESTAMP_FORMAT = "%Y-%m-%dT%H:%M:%SZ"
STALE_PART_SECONDS = 10
REWRITE_AFTER_SECONDS = 60
DEADLINE_SECONDS = 2
PASS_THROUGH_CHUNK = 65536


def parse_payload(raw):
    """Return the payload as a dict, or None for malformed JSON or a non-object."""
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def sanitize_session_id(value):
    """Accept only [A-Za-z0-9_-]{1,128}; anything else means write nothing."""
    # fullmatch: re's `$` would also accept a trailing newline.
    if isinstance(value, str) and SESSION_ID_RE.fullmatch(value):
        return value
    return None


def _is_unsafe_path_candidate(candidate):
    """True if candidate is relative, has a "." / ".." component, or control chars."""
    if not candidate.startswith("/"):
        return True
    if any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in candidate):
        return True
    return any(part in (".", "..") for part in candidate.split("/"))


def project_slug(payload):
    """Slug for ~/.claude/projects/<slug>: workspace.project_dir, else cwd.

    Slashes become hyphens, which equals lib/compound-staging.sh's
    cs_derive_project_slug for a git toplevel without running git here (R22).
    The candidate is external input: only an absolute path with no "."/".."
    component and no control characters is accepted, and the resulting slug
    must be non-empty and not "." or ".."; anything else means no slug (the
    caller writes nothing) rather than joining an unsafe value into a path.
    """
    workspace = payload.get("workspace")
    candidate = workspace.get("project_dir") if isinstance(workspace, dict) else None
    if not isinstance(candidate, str) or not candidate:
        candidate = payload.get("cwd")
    if not isinstance(candidate, str) or not candidate:
        return None
    if _is_unsafe_path_candidate(candidate):
        return None
    slug = candidate.replace("/", "-")
    if not slug or slug in (".", "..") or "/" in slug:
        return None
    return slug


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
    """A finite int or float (bool excluded) passes through; everything else is None.

    json.loads accepts NaN and Infinity; they would be written back as
    non-JSON tokens, and NaN != NaN would defeat unchanged().
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and math.isfinite(value):
        return value
    return None


def build_record(payload, session_id):
    window = payload.get("context_window")
    if not isinstance(window, dict):
        window = {}
    return {
        "observer_format": OBSERVER_FORMAT,
        "session_id": session_id,
        "observed_at": time.strftime(TIMESTAMP_FORMAT, time.gmtime()),
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
    """Previous record for the same session, or None when absent or malformed.

    Raises OSError when the record exists but cannot be read (EIO, EACCES):
    the caller keeps the old record instead of resetting its advisory state.
    """
    try:
        with open(path, "r", encoding="utf-8") as handle:
            previous = json.load(handle)
    except FileNotFoundError:
        return None
    except (ValueError, UnicodeDecodeError):
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


def part_path(directory, session_id):
    """This process's data file: .<session_id>.<pid>.part."""
    return os.path.join(directory, ".%s.%d.part" % (session_id, os.getpid()))


def remove_stale_parts(directory, session_id):
    """Unlink data files older than STALE_PART_SECONDS left by killed writers."""
    pattern = os.path.join(glob.escape(directory), ".%s.*.part" % glob.escape(session_id))
    for leftover in glob.glob(pattern):
        try:
            if time.time() - os.stat(leftover).st_mtime >= STALE_PART_SECONDS:
                os.unlink(leftover)
        except OSError:
            pass


def age_seconds(observed_at):
    try:
        return time.time() - calendar.timegm(time.strptime(observed_at, TIMESTAMP_FORMAT))
    except (TypeError, ValueError):
        return None


def unchanged(previous, record):
    """True when previous carries the same numbers and is recent enough to keep."""
    if not isinstance(previous, dict):
        return False
    for key in ("context_window", "advisory", "transcript_present"):
        if previous.get(key) != record.get(key):
            return False
    age = age_seconds(previous.get("observed_at"))
    return age is not None and 0 <= age < REWRITE_AFTER_SECONDS


def write_record(path, record):
    """Finish the record from the previous one and publish it atomically.

    0700 dir; the record is written to this process's own
    .<session_id>.<pid>.part and published with os.replace, so no writer can
    ever publish another writer's partial file. No fsync: os.replace already
    gives readers the old or the new complete record, and a record lost to a
    power failure reads as unknown anyway.
    """
    directory = os.path.dirname(path)
    session_id = record["session_id"]
    # Refuse a symlinked slug or observations directory (projects/ itself may be
    # a symlink, as prune allows): makedirs, chmod and the publish would follow it.
    root = config_dir()
    expected = os.path.join(
        os.path.realpath(os.path.join(root or "", "projects")),
        os.path.basename(os.path.dirname(directory)),
        "context-observations",
    )
    if root is None or os.path.realpath(directory) != expected:
        raise OSError("observation directory resolves outside %s/projects" % root)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    try:
        os.chmod(directory, 0o700)
    except OSError:
        pass
    remove_stale_parts(directory, session_id)
    part = part_path(directory, session_id)
    try:
        previous = load_previous(path, session_id)
        record["advisory"] = advisory_state(
            previous, record["context_window"]["remaining_percentage"], watermark_remaining()
        )
        if unchanged(previous, record):
            return
        # A leftover with this pid's name (pid reuse) is removed, then the part
        # file is created exclusively: never through a planted symlink.
        try:
            os.unlink(part)
        except FileNotFoundError:
            pass
        part_fd = os.open(part, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
        with os.fdopen(part_fd, "w", encoding="utf-8") as handle:
            json.dump(record, handle, sort_keys=True)
            handle.write("\n")
        delay = os.environ.get("CONTEXT_OBSERVER_TEST_SLEEP_BEFORE_RENAME")
        if delay:  # test only: widens the window a kill test aims at
            time.sleep(float(delay))
        os.replace(part, path)
    finally:
        try:
            os.unlink(part)
        except OSError:
            pass


def record_observation(raw):
    """Record the payload; return None, or why nothing was written (a debug reason)."""
    payload = parse_payload(raw)
    if payload is None:
        return "payload is not a JSON object"
    session_id = sanitize_session_id(payload.get("session_id"))
    if session_id is None:
        return "session_id missing or malformed"
    slug = project_slug(payload)
    if slug is None:
        return "workspace.project_dir and cwd are missing or unsafe"
    path = record_path(slug, session_id)
    if path is None:
        return "no config dir (CLAUDE_CONFIG_DIR and HOME unset)"
    write_record(path, build_record(payload, session_id))
    return None


def pass_through():
    """Copy stdin to stdout chunk by chunk and return every byte read.

    Each chunk is forwarded as it arrives, so an interruption mid-read
    (SIGTERM, a read error) still leaves the next stage everything read so
    far. A failed write (a downstream that closed early) stops forwarding but
    not reading, so the record is still built from the whole payload.
    """
    raw = bytearray()
    source = getattr(sys.stdin, "buffer", None)
    sink = getattr(sys.stdout, "buffer", None)
    if source is None:
        return bytes(raw)
    read = source.read1 if hasattr(source, "read1") else source.read
    try:
        while True:
            chunk = read(PASS_THROUGH_CHUNK)
            if not chunk:
                break
            raw += chunk
            if sink is not None:
                try:
                    sink.write(chunk)
                    sink.flush()
                except (OSError, ValueError):
                    sink = None
    except BaseException:
        # SIGTERM (SystemExit from on_sigterm) or a read error: forward and
        # record what arrived.
        pass
    return bytes(raw)


def debug(message):
    """One stderr line, only with CONTEXT_OBSERVER_DEBUG=1."""
    if os.environ.get("CONTEXT_OBSERVER_DEBUG") != "1":
        return
    try:
        sys.stderr.write("[context-observer] %s\n" % message)
    except BaseException:
        pass


def release_stdout():
    """Point fd 1 at /dev/null: the next stage sees EOF now, and the
    interpreter's exit-time flush has nowhere to fail."""
    try:
        devnull = os.open(os.devnull, os.O_WRONLY)
    except OSError:
        return
    try:
        os.dup2(devnull, sys.stdout.fileno())
    except (OSError, AttributeError, ValueError):
        # stdout closed or detached (sys.stdout is None / has no fileno).
        pass
    finally:
        os.close(devnull)


def on_sigterm(signum, frame):
    # Unwind through write_record's cleanup instead of dying mid-write.
    raise SystemExit(0)


class DeadlineReached(BaseException):
    """Not an Exception: TimeoutError is an OSError, which write_record's
    cleanup handlers swallow, leaving later filesystem calls with no deadline."""


def on_deadline(signum, frame):
    raise DeadlineReached("recording deadline reached")


def wants_help(argv):
    return any(arg in ("-h", "--help") for arg in argv[1:])


def main():
    stdin = sys.stdin
    if wants_help(sys.argv) or (stdin is not None and stdin.isatty()):
        # Run by hand: explain instead of blocking on a terminal.
        sys.stdout.write(__doc__)
        sys.exit(0)
    signal.signal(signal.SIGTERM, on_sigterm)
    raw = pass_through()
    release_stdout()
    try:
        if hasattr(signal, "SIGALRM"):
            signal.signal(signal.SIGALRM, on_deadline)
            signal.alarm(DEADLINE_SECONDS)
        skipped = record_observation(raw)
        if skipped is not None:
            debug("skip: " + skipped)
    except BaseException as exc:  # never let recording affect the statusline
        debug("%s: %s" % (type(exc).__name__, exc))
    sys.exit(0)


if __name__ == "__main__":
    main()
