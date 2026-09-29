#!/usr/bin/env python3
"""yellow-core: statusLine.command writer for /statusline:setup (spec R18, T11).

The one place that rewrites statusLine.command in settings.json, so the
statusline install (Step 5) and the opt-in context observer (Step 5b) cannot
undo each other. Extracted from the command so bats can test it against
throwaway settings files. Every write changes only statusLine (type and
command) through an atomic tmp -> validate -> os.replace; a symlinked
settings.json is written through to its target.

Subcommands:
  statusline  point statusLine.command at the yellow statusline, keeping the
              observer stage when it is already composed
  status      read-only: is the observer enabled, and is its installed copy
              current? Never fails on an unconfigured statusLine
  plan        print what install would do; write nothing (install --dry-run)
  install     copy the observer, back up settings.json, and compose the
              observer ahead of the existing command
  remove      strip the observer stage, restoring the command it wrapped
  prune       delete observation records older than --older-than-days

Every path has a default, so `install` alone works: --settings is
${CLAUDE_CONFIG_DIR:-~/.claude}/settings.json, --observer-dest is
<config>/yellow-context-observer.py, --statusline is
<config>/yellow-statusline.py and --observer-src is context-observer.py next
to this script. --dry-run (statusline, install, remove, prune) reports what
would happen and writes nothing.

Composition (the existing command is statusLine.command; STAGE is
"{ command -v python3 >/dev/null && [ -r <observer> ] && exec python3 <observer>; exec cat; }"):
  absent                   -> refused with statusline_missing: the observer only
                              wraps an existing command, so remove can always
                              restore exactly what the user had
  any command              -> STAGE | <existing>
                              (STAGE falls back to cat when python3 or the observer
                              file is missing, so the payload still reaches the next
                              stage; exec hands the group's pipe end to the observer,
                              so its early stdout release gives the next stage EOF
                              before recording; "{ python3 <observer> || cat; }"
                              would hold the pipe open until recording ends. The
                              existing command is wrapped in "(" ... ")" on their
                              own lines when it contains shell control characters,
                              so the payload reaches its first stage and a trailing
                              comment or heredoc stays closed)
  already contains observer -> no change to settings; the observer copy is
                              refreshed when missing or different from the source
                              ("contains" means a leading observer stage that
                              resolves to --observer-dest; a command that only
                              mentions the observer's path elsewhere, e.g. in a
                              `test -f <observer> && ...` guard, is treated as not
                              installed)
  older observer stage     -> upgrade: "{ python3 <observer> || cat; } |" or the
                              plain manual-merge "python3 <observer> |" is replaced
                              by STAGE, keeping the command it wraps

Refuses with exit 1 and no write: JSONC or otherwise invalid settings.json
(statusline instead backs up invalid, non-JSONC settings, starts fresh, and
reports action recovered), a non-object statusLine, and (install and plan) an
absent statusLine. Never reads or writes autoCompactEnabled,
autoCompactWindow, hooks, or any other key (R2).

Backups: settings.json.pre-observer.backup, then .2, .3, ... (always one past
the highest) when the file differs from every existing backup; the original
and the newest MAX_BACKUPS - 1 are kept.

Every run prints one JSON object on stdout with the same keys:
  {action, error_code, existing_command, proposed_command, settings, backup,
   observer, reason}
action: statusline-set, recovered (statusline reset invalid settings.json),
install, installed, upgrade, upgraded, refresh, refreshed, already-installed,
remove, removed, not-installed, enabled, not-enabled, prune, pruned,
statusline and recover (--dry-run statusline), or error (exit 1; exit 2 for a
usage error). A dry run reports the present-tense action (install, upgrade,
refresh, remove, prune, statusline, recover); a write reports the past tense.
error_code is null unless action is error, and is then one of ERROR_CODES:
settings_unreadable, settings_jsonc, settings_invalid, settings_not_object,
statusline_not_object, command_not_string, statusline_missing,
observer_src_missing, observer_not_removable, prune_incomplete, io_error,
internal, usage. A failure also prints "error_code: reason" on stderr.

Stdlib only; Python 3.7+.
"""
import argparse
import glob
import json
import os
import re
import shlex
import shutil
import stat
import sys
import tempfile
import time

JSONC_RE = re.compile(r"(^\s*//|/\*)", re.MULTILINE)
SHELL_CONTROL_RE = re.compile(r"[;&|\n#]")
OBSERVER_NAME = "yellow-context-observer.py"
BACKUP_SUFFIX = ".pre-observer.backup"
CORRUPT_SUFFIX = ".corrupt.backup"
MAX_BACKUPS = 5

# Every error_code the JSON contract can carry. SetupError accepts only these;
# usage, io_error and internal come from the argument parser and main()'s
# last-resort handlers, and fail() refuses anything outside the set.
ERROR_CODES = frozenset((
    "settings_unreadable", "settings_jsonc", "settings_invalid", "settings_not_object",
    "statusline_not_object", "command_not_string", "statusline_missing",
    "observer_src_missing", "observer_not_removable", "prune_incomplete",
    "io_error", "internal", "usage",
))

# One shell word, possibly several quoted segments joined (shlex.quote emits
# '...'"'"'...' for a path containing an apostrophe).
_WORD = r"(?:'[^']*'|\"[^\"]*\"|[^\s'\"|;])+"

# A leading observer stage in one of three forms, each naming the observer in
# its own group: "exec" (the installer's current form), "guarded" (the earlier
# "{ python3 <observer> || cat; } |") and "plain" ("python3 <observer> |", the
# simplest manual merge). leading_observer() tokenises the path and
# contains_observer() compares it to --observer-dest. A command that only
# mentions the observer elsewhere never matches here.
OBSERVER_PREFIX_RE = re.compile(
    r"\A\s*(?:"
    r"\{\s*command\s+-v\s+python3\s*>\s*/dev/null\s*&&\s*\[\s+-r\s+(?P<exec_path>" + _WORD + r")\s+\]\s*&&\s*"
    r"exec\s+python3\s+(?P=exec_path)\s*;\s*exec\s+cat\s*;\s*\}"
    r"|\{\s*python3?\s+(?P<guarded_path>" + _WORD + r")\s*\|\|\s*cat\s*;\s*\}"
    r"|python3?\s+(?P<plain_path>" + _WORD + r")"
    r")\s*\|(?!\|)\s*"
)
OBSERVER_FORMS = ("exec", "guarded", "plain")


class SetupError(Exception):
    def __init__(self, code, message):
        if code not in ERROR_CODES:
            raise ValueError("unknown error code %r" % code)
        super().__init__(message)
        self.code = code


def fail(result, code, reason):
    """Fill result as the one error shape shared by every failure path."""
    if code not in ERROR_CODES:
        reason = "unknown error code %r: %s" % (code, reason)
        code = "internal"
    result.update(action="error", error_code=code, reason=reason)


def new_result(settings):
    return {
        "action": None,
        "error_code": None,
        "existing_command": None,
        "proposed_command": None,
        "settings": settings,
        "backup": None,
        "observer": None,
        "reason": None,
    }


def normalize(path):
    return os.path.normpath(os.path.expanduser(path))


def config_dir():
    """${CLAUDE_CONFIG_DIR:-~/.claude}; the same rule as lib/context-observer.py."""
    return os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude")


def load_settings(path, recover_invalid=False, result=None, dry_run=False):
    """Return (settings_dict, raw_text_or_None, recovered). Raise SetupError on JSONC/invalid.

    recovered is True when recover_invalid reset invalid (non-JSONC) settings to {}.
    """
    if not os.path.exists(path):
        return {}, None, False
    try:
        with open(path, "r", encoding="utf-8") as handle:
            raw = handle.read()
    except (OSError, UnicodeDecodeError) as exc:
        raise SetupError("settings_unreadable", "cannot read %s: %s" % (path, exc))
    try:
        settings = json.loads(raw)
    except ValueError:
        if JSONC_RE.search(raw):
            raise SetupError("settings_jsonc", "settings.json contains JSONC comments; remove them or use the manual merge")
        if not recover_invalid:
            raise SetupError("settings_invalid", "settings.json is not valid JSON; fix it or use the manual merge")
        if result is not None:
            corrupt = None if dry_run else numbered_backup(os.path.realpath(path), CORRUPT_SUFFIX, raw)
            result["backup"] = corrupt
            result["reason"] = "settings.json is not valid JSON and %s; the original %s" % (
                "would be reset" if dry_run else "was reset",
                "would be saved as a .corrupt.backup" if dry_run else "is saved at %s" % corrupt,
            )
        return {}, raw, True
    if not isinstance(settings, dict):
        raise SetupError("settings_not_object", "settings.json is not a JSON object")
    return settings, raw, False


def existing_command(settings):
    status_line = settings.get("statusLine")
    if status_line is None:
        return None
    if not isinstance(status_line, dict):
        raise SetupError("statusline_not_object", "statusLine is not an object; use the manual merge")
    command = status_line.get("command")
    if command is None:
        return None
    if not isinstance(command, str):
        raise SetupError("command_not_string", "statusLine.command is not a string; use the manual merge")
    return command if command.strip() else None


def tokens(command):
    try:
        return shlex.split(command)
    except ValueError:
        return None


def observer_stage(observer_dest):
    # Expand "~" before quoting: a quoted "~/..." would reach the shell literally.
    # The cat fallback keeps a missing python3 or observer file from starving the
    # next stage. exec, not "python3 <observer> || cat": the group's subshell must
    # not keep the pipe's write end open while the observer records, or the next
    # stage waits for recording instead of seeing EOF when the observer releases
    # stdout.
    path = shlex.quote(normalize(observer_dest))
    return "{ command -v python3 >/dev/null && [ -r %s ] && exec python3 %s; exec cat; }" % (path, path)


def statusline_stage(statusline):
    return "python3 " + shlex.quote(normalize(statusline))


def leading_observer(command):
    """Return (normalized path, form) of a leading observer stage, or None.

    form is one of OBSERVER_FORMS. Any script path matches here;
    contains_observer() decides whether it is the observer at --observer-dest,
    so a custom destination name is recognised too.
    """
    match = OBSERVER_PREFIX_RE.match(command)
    if match is None:
        return None
    form = next(f for f in OBSERVER_FORMS if match.group(f + "_path") is not None)
    raw = match.group(form + "_path")
    parts = tokens(raw)
    if not parts or len(parts) != 1:
        return None
    path = parts[0]
    # Expand variables only where the shell would: observer_stage() single-quotes
    # its path, so a "$" there (or after a backslash) is literal and must stay so;
    # a wholly double-quoted path expands even when it holds an apostrophe.
    double_quoted = raw.startswith('"') and raw.endswith('"') and raw.count('"') == 2
    if "\\" not in raw and ("'" not in raw or double_quoted):
        path = os.path.expandvars(path)
    return normalize(path), form


def contains_observer(command, observer_dest):
    """True only when command's leading stage is the observer at observer_dest.

    A command that merely mentions the observer path elsewhere (e.g. in a
    later stage, or in a `test -f <observer> && ...` guard) does not count:
    that path is never executed as the observer stage.
    """
    found = leading_observer(command)
    return found is not None and found[0] == normalize(observer_dest)


def stage_is_current(command):
    """True when the leading observer stage is the installer's current exec form."""
    found = leading_observer(command)
    return found is not None and found[1] == "exec"


def wrap(command):
    command = command.strip()
    # A leading `!` negates a pipeline and is a syntax error after `|`.
    if SHELL_CONTROL_RE.search(command) or re.match(r"!(\s|$)", command):
        return "(\n" + command + "\n)"
    return command


def compose(existing, observer_dest):
    """Return (action, proposed_command) for install."""
    if existing is not None and contains_observer(existing, observer_dest):
        if stage_is_current(existing):
            return "already-installed", existing
        rest = decompose(existing)
        if rest is None:
            raise SetupError(
                "observer_not_removable",
                "statusLine.command has an older observer stage with nothing after it; edit it by hand",
            )
        return "upgrade", observer_stage(observer_dest) + " | " + wrap(rest)
    if existing is None:
        # The observer only wraps an existing command. Composing it ahead of a
        # statusline the user never configured would leave that statusline on
        # after remove, which cannot tell it apart from one the user chose.
        raise SetupError(
            "statusline_missing",
            "no statusLine is configured; run /statusline:setup to install the statusline first",
        )
    return "install", observer_stage(observer_dest) + " | " + wrap(existing)


def decompose(existing):
    """Return the command the observer stage wraps, or None when it is not a prefix."""
    match = OBSERVER_PREFIX_RE.match(existing)
    if match is None:
        return None
    rest = existing[match.end():]
    if rest.startswith("(\n") and rest.endswith("\n)"):
        rest = rest[2:-2]
    return rest.strip() or None


def observer_is_current(src, dest):
    """True when dest exists and matches src byte for byte."""
    try:
        with open(normalize(src), "rb") as a, open(normalize(dest), "rb") as b:
            return a.read() == b.read()
    except OSError:
        return False


def observer_copy_state(src, dest):
    """'current' or 'refresh': dest is missing, or differs from src (when src exists)."""
    if not os.path.isfile(normalize(dest)):
        return "refresh"
    if os.path.isfile(normalize(src)) and not observer_is_current(src, dest):
        return "refresh"
    return "current"


def numbered_backups(path, suffix):
    """Existing numbered backups (<path><suffix>.N), oldest first by N."""
    base = path + suffix
    found = []
    for candidate in glob.glob(glob.escape(base) + ".*"):
        tail = candidate[len(base) + 1:]
        if tail.isdigit():
            found.append((int(tail), candidate))
    return [candidate for _, candidate in sorted(found)]


def numbered_backup(path, suffix, raw):
    """Copy path aside; reuse an identical backup, never clobber a different one.

    Every existing backup is checked for identical content, so a gap left by
    pruning never hides a match. A new numbered backup takes the next number
    after the highest, so the suffix orders backups by creation. Keeps the
    first backup (the original) and the newest MAX_BACKUPS - 1.
    """
    original = path + suffix
    numbered = numbered_backups(path, suffix)
    for candidate in ([original] if os.path.exists(original) else []) + numbered:
        try:
            with open(candidate, "r", encoding="utf-8") as handle:
                if handle.read() == raw:
                    return candidate
        except (OSError, UnicodeDecodeError):
            pass
    if not os.path.exists(original):
        candidate = original
    else:
        last = int(numbered[-1][len(original) + 1:]) if numbered else 1
        candidate = "%s%s.%d" % (path, suffix, last + 1)
    shutil.copy2(path, candidate)
    prune_backups(path, suffix, keep=candidate)
    return candidate


def prune_backups(path, suffix, keep):
    """Delete the oldest numbered backups beyond MAX_BACKUPS; never the original or `keep`."""
    numbered = [b for b in numbered_backups(path, suffix) if b != keep]
    excess = len(numbered) + 2 - MAX_BACKUPS  # + the original + `keep`
    for old in numbered[:max(excess, 0)]:
        try:
            os.unlink(old)
        except OSError:
            pass


def backup_settings(path, raw):
    """Back up settings.json before a change; None when the file does not exist."""
    if raw is None:
        return None
    return numbered_backup(path, BACKUP_SUFFIX, raw)


def publish_atomically(dest, populate, mode_from=None, mode=None, prefix=".tmp."):
    """Sibling temp -> populate(tmp) -> chmod -> os.replace; returns the real destination.

    A symlinked destination is written through to its target so the link
    survives, and a concurrent reader never sees a truncated or partial file.
    """
    dest = os.path.realpath(dest)
    directory = os.path.dirname(dest) or "."
    os.makedirs(directory, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=directory, prefix=prefix, suffix=".tmp")
    os.close(fd)
    try:
        populate(tmp)
        if mode is not None:
            os.chmod(tmp, mode)
        elif mode_from is not None and os.path.exists(mode_from):
            shutil.copymode(mode_from, tmp)
        os.replace(tmp, dest)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return dest


def install_observer(src, dest):
    src = normalize(src)
    if not os.path.isfile(src):
        raise SetupError("observer_src_missing", "observer source %s does not exist" % src)
    return publish_atomically(
        normalize(dest), lambda tmp: shutil.copyfile(src, tmp), mode=0o755, prefix=".observer.")


def write_settings(path, settings):
    """Atomic write, re-validated as JSON before the replace, keeping the file mode."""
    def populate(tmp):
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(settings, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
        with open(tmp, "r", encoding="utf-8") as handle:
            json.load(handle)

    publish_atomically(path, populate, mode_from=os.path.realpath(path), prefix=".settings.")


def set_command(settings, command):
    status_line = settings.get("statusLine")
    if not isinstance(status_line, dict):
        settings["statusLine"] = {"type": "command", "command": command}
    else:
        status_line["type"] = "command"
        status_line["command"] = command


def run_statusline(args, result):
    settings, _, recovered = load_settings(
        args.settings, recover_invalid=True, result=result, dry_run=args.dry_run)
    existing = existing_command(settings)
    command = statusline_stage(args.statusline)
    if existing is not None and contains_observer(existing, args.observer_dest):
        command = observer_stage(args.observer_dest) + " | " + command
    result.update(existing_command=existing, proposed_command=command)
    if args.dry_run:
        result["action"] = "recover" if recovered else "statusline"
        return
    set_command(settings, command)
    write_settings(args.settings, settings)
    result["action"] = "recovered" if recovered else "statusline-set"


def run_status(args, result):
    """Read-only: enabled / refresh / not-enabled; a missing statusline is not an error."""
    settings, _, _ = load_settings(args.settings)
    existing = existing_command(settings)
    result["existing_command"] = existing
    if existing is None or not contains_observer(existing, args.observer_dest):
        result["action"] = "not-enabled"
        return
    if not stage_is_current(existing):
        result["action"] = "refresh"
        result["reason"] = "the composed observer stage is an older form; run install to upgrade it"
        return
    state = observer_copy_state(args.observer_src, args.observer_dest)
    result["action"] = "refresh" if state == "refresh" else "enabled"
    if state == "refresh":
        result["reason"] = "the installed observer copy is missing or differs from the plugin's; run install"


def plan_install(args):
    """What install would do: (settings, raw, existing, action, proposed)."""
    settings, raw, _ = load_settings(args.settings)
    existing = existing_command(settings)
    action, proposed = compose(existing, args.observer_dest)
    return settings, raw, existing, action, proposed


def run_install(args, result):
    dry_run = args.dry_run or args.command == "plan"
    settings, raw, existing, action, proposed = plan_install(args)
    result.update(existing_command=existing, proposed_command=proposed, action=action)
    if action == "already-installed":
        if observer_copy_state(args.observer_src, args.observer_dest) == "refresh":
            if dry_run:
                result["action"] = "refresh"
            else:
                result["observer"] = install_observer(args.observer_src, args.observer_dest)
                result["action"] = "refreshed"
        return
    if not os.path.isfile(normalize(args.observer_src)):
        raise SetupError("observer_src_missing", "observer source %s does not exist" % args.observer_src)
    if dry_run:
        return
    result["backup"] = backup_settings(args.settings, raw)
    result["observer"] = install_observer(args.observer_src, args.observer_dest)
    set_command(settings, proposed)
    write_settings(args.settings, settings)
    result["action"] = "upgraded" if action == "upgrade" else "installed"


def run_remove(args, result):
    settings, raw, _ = load_settings(args.settings)
    existing = existing_command(settings)
    result["existing_command"] = existing
    if existing is None or not contains_observer(existing, args.observer_dest):
        result["action"] = "not-installed"
        return
    restored = decompose(existing)
    if restored is None:
        raise SetupError(
            "observer_not_removable",
            "statusLine.command uses the observer but not as a leading observer stage; edit it by hand",
        )
    result["proposed_command"] = restored
    if args.dry_run:
        result["action"] = "remove"
        return
    result["backup"] = backup_settings(args.settings, raw)
    set_command(settings, restored)
    write_settings(args.settings, settings)
    result["action"] = "removed"


def run_prune(args, result):
    """Delete observation records (and stale part files) not modified for --older-than-days."""
    cutoff = time.time() - args.older_than_days * 86400
    projects_root = os.path.realpath(os.path.join(config_dir(), "projects"))
    dirs = glob.glob(os.path.join(glob.escape(config_dir()), "projects", "*", "context-observations"))
    doomed = []
    for obs_dir in dirs:
        # Never follow a symlinked observation directory out of the projects root.
        if os.path.islink(obs_dir) or not os.path.realpath(obs_dir).startswith(projects_root + os.sep):
            continue
        base = glob.escape(obs_dir)
        # "*" does not match dot files, and the writer's part files are dot files.
        for path in glob.glob(os.path.join(base, "*")) + glob.glob(os.path.join(base, ".*")):
            name = os.path.basename(path)
            if not (name.endswith(".json") or name.endswith(".part")):
                continue
            try:
                st = os.lstat(path)
                if stat.S_ISREG(st.st_mode) and st.st_mtime < cutoff:
                    doomed.append(path)
            except OSError:
                continue
    if args.dry_run:
        result["action"] = "prune"
        result["reason"] = "would remove %d observation file(s) not modified for %d day(s)" % (
            len(doomed), args.older_than_days)
        return
    removed, failures = 0, []
    for path in doomed:
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass  # a concurrent writer or prune got there first; nothing to count
        except OSError as exc:
            failures.append("%s: %s" % (path, exc.strerror or exc))
        else:
            removed += 1
    if failures:
        raise SetupError("prune_incomplete", "removed %d of %d observation file(s); could not remove %d (first: %s)" % (
            removed, len(doomed), len(failures), failures[0]))
    result["action"] = "pruned"
    result["reason"] = "removed %d observation file(s) not modified for %d day(s)" % (
        removed, args.older_than_days)


class JsonArgumentParser(argparse.ArgumentParser):
    """Usage errors print the same JSON object as every other run (exit 2)."""

    def error(self, message):
        result = new_result(None)
        fail(result, "usage", "%s: %s" % (self.prog, message))
        sys.stdout.write(json.dumps(result, sort_keys=True) + "\n")
        sys.stderr.write("usage: %s\n" % result["reason"])
        sys.exit(2)


def nonneg_days(value):
    days = int(value)
    if days < 0:
        raise argparse.ArgumentTypeError("must be 0 or more")
    return days


def parse_args(argv):
    here = os.path.dirname(os.path.abspath(__file__))
    parser = JsonArgumentParser(
        prog="statusline-settings.py",
        description="Write statusLine.command for the yellow statusline and the opt-in context observer.",
        epilog="Every run prints one JSON object: action, error_code, existing_command, proposed_command, "
        "settings, backup, observer, reason. Exit 0 on success, 1 on a refusal, 2 on a usage error. "
        "Every path has a default (see the module docstring), so `statusline-settings.py status` "
        "works with no flags.",
    )
    # parser_class is explicit: subparser usage errors must print JSON too.
    sub = parser.add_subparsers(dest="command", required=True,
                                metavar="{statusline,status,plan,install,remove,prune}",
                                parser_class=JsonArgumentParser)
    helps = {
        "statusline": "point statusLine.command at the yellow statusline, keeping a composed observer",
        "status": "read-only: enabled, refresh (outdated copy or older stage form) or not-enabled",
        "plan": "print what install would do; writes nothing",
        "install": "copy the observer, back up settings.json, compose the observer ahead of statusLine.command",
        "remove": "strip the observer stage from statusLine.command, restoring the command it wrapped",
        "prune": "delete observation records not modified for --older-than-days",
    }
    for name, text in helps.items():
        cmd = sub.add_parser(name, help=text, description=text)
        cmd.add_argument("--settings", default=os.path.join(config_dir(), "settings.json"),
                         help="path to settings.json (default: <config dir>/settings.json)")
        cmd.add_argument("--observer-dest", default=os.path.join(config_dir(), OBSERVER_NAME),
                         help="installed observer path (default: <config dir>/%s)" % OBSERVER_NAME)
        cmd.add_argument("--statusline", default=os.path.join(config_dir(), "yellow-statusline.py"),
                         help="yellow statusline script path (default: <config dir>/yellow-statusline.py)")
        cmd.add_argument("--observer-src", default=os.path.join(here, "context-observer.py"),
                         help="lib/context-observer.py to copy (default: next to this script)")
        if name in ("statusline", "install", "remove", "prune"):
            cmd.add_argument("--dry-run", action="store_true", help="report what would happen; write nothing")
        if name == "prune":
            cmd.add_argument("--older-than-days", type=nonneg_days, default=30,
                             help="delete records not modified for this many days (default 30)")
    args = parser.parse_args(argv)
    args.dry_run = getattr(args, "dry_run", False)
    return args


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    result = new_result(args.settings)
    runners = {"statusline": run_statusline, "status": run_status, "plan": run_install,
               "install": run_install, "remove": run_remove, "prune": run_prune}
    code = 0
    try:
        runners[args.command](args, result)
    except SetupError as exc:
        fail(result, exc.code, str(exc))
        code = 1
    except OSError as exc:
        fail(result, "io_error", str(exc))
        code = 1
    except Exception as exc:  # last resort: still one JSON object, never a traceback
        fail(result, "internal", "%s: %s" % (type(exc).__name__, exc))
        code = 1
    sys.stdout.write(json.dumps(result, sort_keys=True) + "\n")
    if code:
        sys.stderr.write("%s: %s\n" % (result["error_code"], result["reason"]))
    return code


if __name__ == "__main__":
    sys.exit(main())
