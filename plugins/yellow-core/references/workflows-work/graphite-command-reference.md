# Common Graphite Commands

Loaded by `/workflows:work` (commands/workflows/work.md). Content moved
verbatim from the command file (C6 progressive-disclosure split).

```bash
# Create new branch
gt create feature-name

# Make a commit
gt modify -m "feat: message"

# View stack
gt log short

# Sync with trunk
gt sync

# Rebase stack
gt upstack restack

# Submit PR(s)
gt submit --no-interactive

# Amend last commit
gt commit amend -m "new message"

# Continue after fixing conflicts
gt continue
```
