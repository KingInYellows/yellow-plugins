# Workspace paths

Resolve local inputs, source, and preview under the selected workspace before
opening or writing them. Run the following check from the trusted workspace
root for each candidate. Pass a relative path with forward slashes as one
literal argument. Prefer a structured process call. With a POSIX shell,
reject single quotes before single-quoting the argument. On Windows use
structured argv.

```python
from pathlib import Path
import os
import re
import sys

raw = sys.argv[1]
if not re.fullmatch(r"[\w./ (),–—-]+", raw):
    raise SystemExit("Invalid path characters")
path = Path(raw)
if path.anchor or ".." in path.parts or any(p.startswith("-") for p in path.parts):
    raise SystemExit("Expected a workspace-relative path")
if os.name == "nt":
    for part in path.parts:
        reserved = os.path.isreserved(part) if hasattr(os.path, "isreserved") else Path(part).is_reserved()
        if reserved or part.endswith((" ", ".")):
            raise SystemExit("Reserved Windows path")
root = Path.cwd().resolve()
target = root / path
if target.resolve() != target:
    raise SystemExit("Path follows a symlink")
print(target)
```

This check identifies a candidate. Perform the actual read or save with a
workspace-scoped tool that enforces containment and rejects symlink or
reparse-point traversal at open time. For POSIX file APIs, start from an open
trusted root, walk parent directories with directory-relative no-follow opens,
and use the retained parent descriptor for the final no-follow open or atomic
replacement. Render scratch output separately and install it through the same
scoped operation. When the host lacks a safe operation, return the proposed
diff for application in the editor. For a board, use its connector and ID.
