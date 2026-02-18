---
status: complete
priority: p1
issue_id: '017'
tags: [code-review, security, supply-chain]
dependencies: []
---

# npm version pinning in install script

## Problem Statement

The `install-agent-browser.sh` script uses `npm install -g agent-browser`
without version pinning. A compromised package version could execute arbitrary
code on user machines during installation, representing a critical supply chain
security risk.

## Findings

**File:** `plugins/yellow-browser-test/scripts/install-agent-browser.sh`

**Issue:** The npm installation command has no version constraint:

```bash
npm install -g agent-browser
```

This means every installation pulls the latest version from npm, which could be:

- A compromised package version with malicious code
- A version with known vulnerabilities
- An incompatible breaking change

The npm install process runs arbitrary scripts (preinstall, postinstall) which
execute with the user's permissions, making this a high-severity attack vector.

## Proposed Solutions

### Option A: Pin to specific version (Recommended)

Pin to a specific known-good version:

```bash
npm install -g agent-browser@x.y.z
```

**Pros:**

- Guarantees reproducible installations
- Prevents automatic updates to compromised versions
- Allows controlled update process with testing

**Cons:**

- Requires manual updates
- Need to document update process

### Option B: Version pin + ignore-scripts flag

Combine version pinning with npm's `--ignore-scripts` flag:

```bash
npm install -g agent-browser@x.y.z --ignore-scripts
```

**Pros:**

- Maximum security — prevents execution of package scripts
- Still pins to known version

**Cons:**

- May break legitimate installation steps
- Chromium installation might rely on postinstall scripts

## Recommended Action

Implement **Option A** with the following steps:

1. Pin agent-browser to specific version in install script
2. Add version check for Chromium installation
3. Document update process in plugin README
4. Add version compatibility matrix to docs

## Technical Details

**Current code location:**
`plugins/yellow-browser-test/scripts/install-agent-browser.sh`

**Affected components:**

- npm package installation
- Chromium browser installation (transitively)
- All users running the install script

**Security considerations:**

- Supply chain attack surface
- Code execution during install
- Dependency vulnerabilities

## Acceptance Criteria

- [ ] agent-browser version pinned to specific version in install script
- [ ] Chromium installation version also checked/validated
- [ ] Update process documented in plugin README or docs
- [ ] Version compatibility matrix added (agent-browser version → Chromium
      version)
- [ ] Install script tested with pinned version
- [ ] Security advisory added to plugin documentation

## Work Log

| Date       | Action                          | Learnings                                                                                 |
| ---------- | ------------------------------- | ----------------------------------------------------------------------------------------- |
| 2026-02-13 | Created from PR #11 code review | npm package installation without version pinning is a critical supply chain security risk |

## Resources

- PR: #11 (yellow-browser-test plugin code review)
- File: `plugins/yellow-browser-test/scripts/install-agent-browser.sh`
- Related: npm supply chain security best practices
