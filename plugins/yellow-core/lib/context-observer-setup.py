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
  plan        print what install would do; write nothing
  install     copy the observer, back up settings.json once, and compose the
              observer ahead of the existing command
  remove      strip the observer stage, restoring the command it wrapped

Composition (the existing command is statusLine.command):
  absent                   -> { python3 <observer> || cat; } | python3 <statusline>
  any command              -> { python3 <observer> || cat; } | <existing>
                              (the "|| cat" keeps the payload flowing to the next
                              stage when the observer file is missing or cannot
                              start; the existing command is wrapped in "(" ... ")"
                              on their own lines when it
                              contains shell control characters, so the payload
                              reaches its first stage and a trailing comment or
                              heredoc stays closed)
  already contains observer -> no change to settings; the observer copy is
                              refreshed when missing or different from the source
                              ("contains" means a leading observer stage, guarded or
                              the older plain "python3 <observer> |", that resolves
                              to --observer-dest; a command
                              that only mentions the observer's path elsewhere,
                              e.g. in a `test -f <observer> && ...` guard, is
                              treated as not installed)

Refuses with exit 1 and no write: JSONC or otherwise invalid settings.json
(statusline instead backs up invalid, non-JSONC settings and starts fresh),
a non-object statusLine, and an absent statusLine when <statusline> does not
exist. Never reads or writes autoCompactEnabled, autoCompactWindow, hooks, or
any other key (R2).

Every run prints one JSON object on stdout with the same keys:
  {action, error_code, existing_command, proposed_command, settings, backup,
   observer, reason}
action: statusline-set, install, installed, refresh, refreshed,
already-installed, removed, not-installed, or error (exit 1; exit 2 for a
usage error). error_code is null unless action is error.

Stdlib only; Python 3.7+.
"""
import argparse
import json
import os
import re
import shlex
import shutil
import sys
import tempfile

JSONC_RE = re.compile(r"(^\s*//|/\*)", re.MULTILINE)
SHELL_CONTROL_RE = re.compile(r"[;&|\n#]")
OBSERVER_NAME = "yellow-context-observer.py"
BACKUP_SUFFIX = ".pre-observer.backup"
CORRUPT_SUFFIX = ".corrupt.backup"

# Stable error_code values of the JSON contract; SetupError rejects anything else.
ERROR_CODES = frozenset((
    "settings_unreadable", "settings_jsonc", "settings_invalid", "settings_not_object",
    "statusline_not_object", "command_not_string", "statusline_missing",
    "observer_src_missing", "observer_not_removable",
))

# A leading observer stage, guarded ("{ python3 <observer> || cat; } |", the
# installer's form) or plain ("python3 <observer> |", the older form and the
# simplest manual merge). "path" is one shell word, possibly several quoted
# segments joined (shlex.quote emits '...'"'"'...' for a path containing an
# apostrophe); leading_observer_path() tokenises it and compares the result to
# --observer-dest. A command that only mentions the observer elsewhere never
# matches here.
OBSERVER_PREFIX_RE = re.compile(
    r"\A\s*(?P<guard>\{\s*)?python3?\s+(?P<path>(?:'[^']*'|\"[^\"]*\"|[^\s'\"|;])+)"
    r"(?(guard)\s*\|\|\s*cat\s*;\s*\}|)\s*\|(?!\|)\s*"
)


class SetupError(Exception):
    def __init__(self, code, message):
        if code not in ERROR_CODES:
            raise ValueError("unknown error code %r" % code)
        super().__init__(message)
        self.code = code


def fail(result, code, reason):
    """Fill result as the one error shape shared by every failure path."""
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


def load_settings(path, recover_invalid=False, result=None):
    """Return (settings_dict, raw_text_or_None). Raise SetupError on JSONC/invalid."""
    if not os.path.exists(path):
        return {}, None
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
        corrupt = numbered_backup(os.path.realpath(path), CORRUPT_SUFFIX, raw)
        if result is not None:
            result["backup"] = corrupt
            result["reason"] = "settings.json was not valid JSON and was reset; the original is saved at %s" % corrupt
        return {}, raw
    if not isinstance(settings, dict):
        raise SetupError("settings_not_object", "settings.json is not a JSON object")
    return settings, raw


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
    # "|| cat": a missing or unstartable observer must not starve the next stage.
    return "{ python3 " + shlex.quote(normalize(observer_dest)) + " || cat; }"


def statusline_stage(statusline):
    return "python3 " + shlex.quote(normalize(statusline))


def contains_observer(command, observer_dest):
    """True only when command's leading stage is the observer at observer_dest.

    A command that merely mentions the observer path elsewhere (e.g. in a
    later stage, or in a `test -f <observer> && ...` guard) does not count:
    that path is never executed as the observer stage.
    """
    return leading_observer_path(command) == normalize(observer_dest)


def wrap(command):
    command = command.strip()
    if SHELL_CONTROL_RE.search(command):
        return "(\n" + command + "\n)"
    return command


def compose(existing, observer_dest, statusline):
    """Return (action, proposed_command) for install."""
    if existing is not None and contains_observer(existing, observer_dest):
        return "already-installed", existing
    if existing is None:
        if not os.path.isfile(normalize(statusline)):
            raise SetupError(
                "statusline_missing",
                "no statusLine is configured and %s does not exist; install the statusline first" % statusline,
            )
        return "install", observer_stage(observer_dest) + " | " + statusline_stage(statusline)
    return "install", observer_stage(observer_dest) + " | " + wrap(existing)


def leading_observer_path(command):
    """Return the normalized path of a leading observer stage, or None."""
    match = OBSERVER_PREFIX_RE.match(command)
    if match is None:
        return None
    parts = tokens(match.group("path"))
    if not parts or len(parts) != 1 or os.path.basename(parts[0]) != OBSERVER_NAME:
        return None
    return normalize(os.path.expandvars(parts[0]))


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


def numbered_backup(path, suffix, raw):
    """Copy path aside; reuse an identical backup, never clobber a different one."""
    candidate = path + suffix
    n = 1
    while os.path.exists(candidate):
        try:
            with open(candidate, "r", encoding="utf-8") as handle:
                if handle.read() == raw:
                    return candidate
        except (OSError, UnicodeDecodeError):
            pass
        n += 1
        candidate = "%s%s.%d" % (path, suffix, n)
    shutil.copy2(path, candidate)
    return candidate


def backup_settings(path, raw):
    """Back up settings.json before a change; None when the file does not exist."""
    if raw is None:
        return None
    return numbered_backup(path, BACKUP_SUFFIX, raw)


def install_observer(src, dest):
    """Atomic publish: sibling temp -> copy bytes -> chmod -> os.replace.

    A symlinked observer destination is written through to its target, same
    as write_settings, so a re-run or a concurrent statusline invocation
    never sees a truncated or partial observer file.
    """
    src, dest = normalize(src), normalize(dest)
    if not os.path.isfile(src):
        raise SetupError("observer_src_missing", "observer source %s does not exist" % src)
    dest = os.path.realpath(dest)
    directory = os.path.dirname(dest) or "."
    os.makedirs(directory, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=directory, prefix=".observer.", suffix=".tmp")
    os.close(fd)
    try:
        shutil.copyfile(src, tmp)
        os.chmod(tmp, 0o755)
        os.replace(tmp, dest)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return dest


def write_settings(path, settings):
    """Atomic write: sibling temp -> json re-validate -> os.replace, keeping the file mode.

    A symlinked settings.json (dotfile managers) is written through to its
    target so the link survives.
    """
    path = os.path.realpath(path)
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=directory, prefix=".settings.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(settings, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
        with open(tmp, "r", encoding="utf-8") as handle:
            json.load(handle)
        if os.path.exists(path):
            shutil.copymode(path, tmp)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def set_command(settings, command):
    status_line = settings.get("statusLine")
    if not isinstance(status_line, dict):
        settings["statusLine"] = {"type": "command", "command": command}
    else:
        status_line["type"] = "command"
        status_line["command"] = command


def run_statusline(args, result):
    settings, _ = load_settings(args.settings, recover_invalid=True, result=result)
    existing = existing_command(settings)
    command = statusline_stage(args.statusline)
    if existing is not None and contains_observer(existing, args.observer_dest):
        command = observer_stage(args.observer_dest) + " | " + command
    result.update(existing_command=existing, proposed_command=command)
    set_command(settings, command)
    write_settings(args.settings, settings)
    result["action"] = "statusline-set"


def run_plan_or_install(args, result):
    settings, raw = load_settings(args.settings)
    existing = existing_command(settings)
    action, proposed = compose(existing, args.observer_dest, args.statusline)
    result.update(existing_command=existing, proposed_command=proposed, action=action)
    src = getattr(args, "observer_src", None)
    if action == "already-installed":
        missing_copy = not src and not os.path.isfile(normalize(args.observer_dest))
        if missing_copy and args.command == "plan":
            result["action"] = "refresh"
        elif src and not observer_is_current(src, args.observer_dest):
            if args.command == "plan":
                result["action"] = "refresh"
            else:
                result["observer"] = install_observer(src, args.observer_dest)
                result["action"] = "refreshed"
        return
    if src and not os.path.isfile(normalize(src)):
        raise SetupError("observer_src_missing", "observer source %s does not exist" % src)
    if args.command == "plan":
        return
    result["backup"] = backup_settings(args.settings, raw)
    result["observer"] = install_observer(src, args.observer_dest)
    set_command(settings, proposed)
    write_settings(args.settings, settings)
    result["action"] = "installed"


def run_remove(args, result):
    settings, raw = load_settings(args.settings)
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
    result["backup"] = backup_settings(args.settings, raw)
    set_command(settings, restored)
    write_settings(args.settings, settings)
    result["action"] = "removed"


class JsonArgumentParser(argparse.ArgumentParser):
    """Usage errors print the same JSON object as every other run (exit 2)."""

    def error(self, message):
        result = new_result(None)
        fail(result, "usage", "%s: %s" % (self.prog, message))
        sys.stdout.write(json.dumps(result, sort_keys=True) + "\n")
        sys.exit(2)


def parse_args(argv):
    parser = JsonArgumentParser(
        prog="context-observer-setup.py",
        description="Write statusLine.command for the yellow statusline and the opt-in context observer.",
        epilog="Every run prints one JSON object: action, error_code, existing_command, proposed_command, "
        "settings, backup, observer, reason. Exit 0 on success, 1 on a refusal, 2 on a usage error. "
        "Example: context-observer-setup.py plan --settings ~/.claude/settings.json "
        "--observer-dest ~/.claude/yellow-context-observer.py --statusline ~/.claude/yellow-statusline.py",
    )
    # parser_class is explicit: subparser usage errors must print JSON too.
    sub = parser.add_subparsers(dest="command", required=True, metavar="{statusline,plan,install,remove}",
                                parser_class=JsonArgumentParser)
    helps = {
        "statusline": "point statusLine.command at the yellow statusline, keeping a composed observer",
        "plan": "print what install would do; writes nothing",
        "install": "copy the observer, back up settings.json, compose the observer ahead of statusLine.command",
        "remove": "strip the observer stage from statusLine.command, restoring the command it wrapped",
    }
    for name, text in helps.items():
        cmd = sub.add_parser(name, help=text, description=text)
        cmd.add_argument("--settings", required=True, help="path to settings.json")
        cmd.add_argument("--observer-dest", required=True, help="installed observer path")
        if name != "remove":
            cmd.add_argument("--statusline", required=True, help="yellow statusline script path")
        if name == "install":
            cmd.add_argument("--observer-src", required=True, help="lib/context-observer.py to copy")
        if name == "plan":
            cmd.add_argument("--observer-src", help="lib/context-observer.py, to report a missing or stale copy")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    result = new_result(args.settings)
    runners = {"statusline": run_statusline, "plan": run_plan_or_install,
               "install": run_plan_or_install, "remove": run_remove}
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
    return code


if __name__ == "__main__":
    sys.exit(main())
