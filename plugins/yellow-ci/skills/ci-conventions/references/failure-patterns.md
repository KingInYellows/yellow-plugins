# CI Failure Pattern Library

Detailed catalog of self-hosted runner failure patterns for the failure-analyst
agent.

## Pattern Index

Grouped by urgency:

- **Immediate** (auto-recovery unlikely): F01, F02, F09, F12
- **Fixable** (clear remediation): F03, F04, F06, F10, F11, F12
- **Investigative** (root cause analysis needed): F05, F07, F08

## F01: Out of Memory (OOM)

**Severity:** Critical | **Frequency:** Occasional | **Auto-recoverable:** No

**Log Signals:**

- `Killed` (signal 9 from OOM killer)
- `signal 9`, `SIGKILL`
- `ENOMEM`
- `JavaScript heap out of memory`
- `java.lang.OutOfMemoryError`
- Exit code 137

**Suggested Fixes:**

1. Reduce parallelism (`--max-workers`, `-j` flags)
2. Add swap:
   `sudo fallocate -l 4G /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`
3. Increase VM memory in Proxmox
4. For Node.js: `NODE_OPTIONS=--max-old-space-size=4096`

**Correlation:** Check runner memory with `/ci:runner-health` — if memory <90%,
failure was transient spike.

## F02: Disk Full

**Severity:** Critical | **Frequency:** Common | **Auto-recoverable:** No

**Log Signals:**

- `No space left on device`
- `ENOSPC`
- `write error`
- `cannot create directory`

**Suggested Fixes:**

1. Run `/ci:runner-cleanup <runner>` to free Docker/cache space
2. Resize disk in Proxmox
3. Add `actions/cache/save` with size limits
4. Configure Docker log rotation

**Correlation:** Check disk with `/ci:runner-health` — if >85%, cleanup
recommended.

## F03: Missing Dependencies

**Severity:** High | **Frequency:** Common | **Auto-recoverable:** No

**Log Signals:**

- `command not found`
- `not found in PATH`
- `No such file or directory`
- `Expected version X, got Y` (version mismatch)
- `Module not found`

**Suggested Fixes:**

1. Install missing tool in workflow setup step
2. Pin version: `uses: actions/setup-node@v4` with `node-version: '20'`
3. Add version check step before build
4. Use Docker container with pre-installed tools

## F04: Docker Issues

**Severity:** High | **Frequency:** Occasional | **Auto-recoverable:** Sometimes

**Log Signals:**

- `Cannot connect to the Docker daemon`
- `toomanyrequests` (Docker Hub rate limit)
- `pull rate limit exceeded`
- `docker: Error response from daemon`
- `permission denied while trying to connect to the Docker daemon socket`

**Suggested Fixes:**

1. Restart Docker: `sudo systemctl restart docker`
2. Configure Docker Hub mirror or authenticate: `docker login`
3. Add runner user to docker group: `sudo usermod -aG docker $USER`
4. Use GitHub Container Registry (ghcr.io) for private images

## F05: Network Issues

**Severity:** High | **Frequency:** Occasional | **Auto-recoverable:** Sometimes

**Log Signals:**

- `Could not resolve host`
- `Connection timed out`
- `Connection refused`
- `curl: (7)` or `curl: (28)`
- `ECONNREFUSED`
- `getaddrinfo ENOTFOUND`

**Suggested Fixes:**

1. Check DNS resolution on runner
2. Verify network connectivity to GitHub
3. Add retry with exponential backoff
4. Check firewall rules on Proxmox host

## F06: Stale State

**Severity:** Medium | **Frequency:** Common | **Auto-recoverable:** Yes

**Log Signals:**

- `EEXIST` (file already exists)
- Leftover lockfiles
- `port already in use`
- `address already in use` (EADDRINUSE)
- Tests pass locally but fail in CI

**Suggested Fixes:**

1. Add `clean: true` to checkout step
2. Add cleanup step: `rm -rf node_modules/.cache`
3. Use `--force` flags where safe
4. Kill stale processes before build

## F07: Flaky Tests

**Severity:** Medium | **Frequency:** Frequent | **Auto-recoverable:** Yes (on
retry)

**Log Signals:**

- Intermittent failures (passes on re-run)
- `timeout`, `ETIMEDOUT`
- Assertion errors with different values across runs
- `socket hang up`

**Suggested Fixes:**

1. Identify specific flaky test from logs
2. Add retry annotation (`@flaky`, `retry: 2`)
3. Increase timeout for slow operations
4. Fix underlying race condition

## F08: Permission Errors

**Severity:** Medium | **Frequency:** Occasional | **Auto-recoverable:** No

**Log Signals:**

- `Permission denied`
- `EACCES`
- `Operation not permitted`
- `EPERM`

**Suggested Fixes:**

1. Fix ownership: `sudo chown -R runner:runner /home/runner`
2. Check runner user has Docker group membership
3. Verify file permissions after cache restore
4. Use `sudo` where appropriate in workflow

## F09: Runner Agent Issues

**Severity:** High | **Frequency:** Rare | **Auto-recoverable:** No

**Log Signals:**

- `Runner.Listener` crash in logs
- Runner appears offline in GitHub UI
- Heartbeat timeout
- `Could not find a registered runner`
- `Mismatched runner version`

**Suggested Fixes:**

1. Restart runner service: `sudo systemctl restart actions.runner.*`
2. Check runner registration: `./config.sh --check`
3. Re-register runner if token expired
4. Update runner to latest version

## F10: Stale Cache

**Severity:** Medium | **Frequency:** Occasional | **Auto-recoverable:** Yes

**Log Signals:**

- `Error restoring cache`
- `Cache not found`
- Corrupted cache artifacts
- `tar: Unexpected EOF`

**Suggested Fixes:**

1. Clear GitHub Actions cache: `gh cache delete --all`
2. Update cache key with hash of lockfile
3. Add cache validation step after restore
4. Migrate to `actions/cache@v4`

## F11: Job Timeout

**Severity:** High | **Frequency:** Occasional | **Auto-recoverable:** No

**Log Signals:**

- `exceeded maximum execution time`
- `The job running on runner has exceeded the maximum execution time`
- Workflow timeout without error

**Suggested Fixes:**

1. Add/increase `timeout-minutes` on job
2. Optimize slow steps (cache, parallelism)
3. Split job into smaller parallel jobs
4. Profile: add timing to each step

## F12: Environment Leakage

**Severity:** Critical | **Frequency:** Rare | **Auto-recoverable:** No

**Log Signals:**

- Secrets visible in logs (`set -x` output with credentials)
- `printenv` output containing tokens
- `echo $SECRET_VAR` in logs

**Suggested Fixes:**

1. Remove `set -x` from scripts handling secrets
2. Use `::add-mask::` to mask values in GitHub Actions
3. Never echo environment variables containing secrets
4. Review workflow for accidental secret exposure
5. Rotate any exposed credentials immediately
