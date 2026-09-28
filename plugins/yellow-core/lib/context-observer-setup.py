#!/usr/bin/env python3
"""yellow-core: opt-in installer for the context observer (spec R18, T11).

The setup logic behind /statusline:setup Step 5b, extracted so bats can test
it against throwaway settings files. It composes the observer ahead of the
user's existing statusline command and changes nothing else:

    plan     print what install would do; write nothing
    install  copy the observer, back up settings.json, rewrite ONLY
             statusLine.command (atomic tmp -> validate -> os.replace)

Composition (the existing command is statusLine.command):
  absent                              -> python3 <observer> | python3 <statusline>
  any command (yellow's or custom)    -> python3 <observer> | <existing>
                                         (wrapped in "(" ... ")" on their own
                                         lines when it contains shell control
                                         characters, so the payload still
                                         reaches its first stage and a trailing
                                         comment or heredoc stays closed)
  already contains <observer>         -> no change (action "already-installed")

Refuses with exit 1 and no write: JSONC or otherwise invalid settings.json,
a non-object statusLine, and an absent statusLine when <statusline> does not
exist (the pipeline would have nothing to render). Never reads or writes
autoCompactEnabled, autoCompactWindow, hooks, or any other key (R2).

Every run prints one JSON object on stdout:
  {action, existing_command, proposed_command, settings, backup, observer, reason}
action is one of: install, installed, already-installed, error.

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
SHELL_CONTROL_RE = re.compile(r"[;&|\n]")
BACKUP_SUFFIX = ".pre-observer.backup"


class SetupError(Exception):
    pass


def normalize(path):
    return os.path.normpath(os.path.expanduser(path))


def load_settings(path):
    """Return (settings_dict, raw_text_or_None). Raise SetupError on JSONC/invalid."""
    if not os.path.exists(path):
        return {}, None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            raw = handle.read()
    except (OSError, UnicodeDecodeError) as exc:
        raise SetupError("cannot read %s: %s" % (path, exc))
    try:
        settings = json.loads(raw)
    except ValueError:
        if JSONC_RE.search(raw):
            raise SetupError("settings.json contains JSONC comments; remove them or use the manual merge")
        raise SetupError("settings.json is not valid JSON; fix it or use the manual merge")
    if not isinstance(settings, dict):
        raise SetupError("settings.json is not a JSON object")
    return settings, raw


def existing_command(settings):
    status_line = settings.get("statusLine")
    if status_line is None:
        return None
    if not isinstance(status_line, dict):
        raise SetupError("statusLine is not an object; use the manual merge")
    command = status_line.get("command")
    if command is None:
        return None
    if not isinstance(command, str):
        raise SetupError("statusLine.command is not a string; use the manual merge")
    return command if command.strip() else None


def tokens(command):
    try:
        return shlex.split(command)
    except ValueError:
        return None


def contains_observer(command, observer_dest):
    parts = tokens(command)
    if parts is None:
        return observer_dest in command
    target = normalize(observer_dest)
    return any(normalize(part) == target for part in parts)


def compose(existing, observer_dest, statusline):
    """Return (action, proposed_command)."""
    # Expand "~" before quoting: a quoted "~/..." would reach the shell literally.
    observer_stage = "python3 " + shlex.quote(normalize(observer_dest))
    if existing is not None and contains_observer(existing, observer_dest):
        return "already-installed", existing
    if existing is None:
        if not os.path.isfile(normalize(statusline)):
            raise SetupError(
                "no statusLine is configured and %s does not exist; install the statusline first" % statusline
            )
        return "install", observer_stage + " | python3 " + shlex.quote(normalize(statusline))
    if SHELL_CONTROL_RE.search(existing):
        return "install", observer_stage + " | (\n" + existing.strip() + "\n)"
    return "install", observer_stage + " | " + existing.strip()


def backup_settings(path, raw):
    """Copy settings.json aside once; reuse an identical backup, never clobber a different one."""
    if raw is None:
        return None
    candidate = path + BACKUP_SUFFIX
    n = 1
    while os.path.exists(candidate):
        try:
            with open(candidate, "r", encoding="utf-8") as handle:
                if handle.read() == raw:
                    return candidate
        except (OSError, UnicodeDecodeError):
            pass
        n += 1
        candidate = "%s%s.%d" % (path, BACKUP_SUFFIX, n)
    shutil.copy2(path, candidate)
    return candidate


def install_observer(src, dest):
    dest = normalize(dest)
    os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
    shutil.copy2(normalize(src), dest)
    os.chmod(dest, 0o755)
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


def run(args):
    result = {
        "action": None,
        "existing_command": None,
        "proposed_command": None,
        "settings": args.settings,
        "backup": None,
        "observer": None,
        "reason": None,
    }
    settings, raw = load_settings(args.settings)
    existing = existing_command(settings)
    action, proposed = compose(existing, args.observer_dest, args.statusline)
    result.update(existing_command=existing, proposed_command=proposed, action=action)
    if args.command == "plan" or action == "already-installed":
        return result

    if not os.path.isfile(normalize(args.observer_src)):
        raise SetupError("observer source %s does not exist" % args.observer_src)
    result["backup"] = backup_settings(args.settings, raw)
    result["observer"] = install_observer(args.observer_src, args.observer_dest)
    status_line = settings.get("statusLine")
    if status_line is None:
        settings["statusLine"] = {"type": "command", "command": proposed}
    else:
        status_line["command"] = proposed
    write_settings(args.settings, settings)
    result["action"] = "installed"
    return result


def parse_args(argv):
    parser = argparse.ArgumentParser(description="Compose the yellow-core context observer into statusLine.")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("plan", "install"):
        cmd = sub.add_parser(name)
        cmd.add_argument("--settings", required=True, help="path to settings.json")
        cmd.add_argument("--observer-dest", required=True, help="installed observer path")
        cmd.add_argument("--statusline", required=True, help="yellow statusline script path")
        if name == "install":
            cmd.add_argument("--observer-src", required=True, help="lib/context-observer.py to copy")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        result = run(args)
        code = 0
    except (SetupError, OSError) as exc:
        result = {"action": "error", "settings": args.settings, "reason": str(exc)}
        code = 1
    sys.stdout.write(json.dumps(result, sort_keys=True) + "\n")
    return code


if __name__ == "__main__":
    sys.exit(main())
