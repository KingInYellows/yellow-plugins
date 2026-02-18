# Implementation Guide: Plugin Marketplace

**For**: Development teams implementing this specification
**Specification**: SPEC-KIY-MKT-001 v1.1.0
**Quality Score**: 92/100
**Status**: Ready for Implementation

---

## Quick Start

**1. Read This First** (~2 hours):
- Executive Summary (`docs/EXECUTIVE-SUMMARY.md`) - 5 minutes
- Part 1 Section 2.0 (User Journeys) - 30 minutes
- Part 1 Section 3.0 (Data Models) - 20 minutes
- Part 2 Section 7.0 (NFRs) - 30 minutes

**2. Understand Core Architecture** (~1 hour):
- Part 2 Section 8.0 (Technical Constraints) - 45 minutes
- JSON Schemas (`schemas/*.schema.json`) - 30 minutes

**3. Review Non-Functional Requirements** (~30 minutes):
- Part 2 Section 7.0 (NFRs) - identify performance/reliability targets

**Total Reading Time**: ~3.5 hours

---

## Implementation Phases

### Phase 1: Core Installation (4 weeks)

**Week 1-2: Schema and Validation**

**Tasks**:
1. Implement JSON schema validation (AJV integration)
2. Build CLI commands: `/plugin install`, `/plugin list`
3. Create cache directory structure at `~/.claude/plugins/`
4. Implement config.json registry management

**Deliverables**:
- Working schema validation for marketplace.json and plugin.json
- CLI skeleton with basic commands
- Cache directory initialization with pre-flight checks
- Registry CRUD operations

**Success Criteria**:
✅ Can validate both marketplace.json and plugin.json
✅ CLI commands parse correctly
✅ Cache directory created with proper permissions
✅ Registry persists plugin state

**Estimated Effort**: 40 hours (2 developers × 2 weeks)

---

**Week 3-4: Install/Rollback**

**Tasks**:
1. Implement 4-dimensional compatibility checking
2. Build atomic install operation with staging directory
3. Implement symlink-based activation
4. Build instant rollback via symlink swap
5. Add permission disclosure flow

**Deliverables**:
- Complete install flow (2.2.1 with 10 steps)
- Rollback functionality (2.2.3)
- Compatibility validation for Claude Code, Node.js, OS, arch
- Permission display and confirmation

**Success Criteria**:
✅ Can install plugin end-to-end
✅ Rollback works 100% of the time
✅ Incompatible plugins blocked with clear errors
✅ Install time ≤ 2 minutes (p95) for typical plugins

**Estimated Effort**: 60 hours (2 developers × 3 weeks)

**Key Challenges**:
- Atomic operations (see CRIT-001 for transaction boundaries)
- Symlink handling on Windows (see CRIT-026 for fallback)
- npm install failures (robust error handling required)

---

### Phase 2: Discovery (2 weeks)

**Week 5-6: Browse and Search**

**Tasks**:
1. Implement `/plugin browse` with category filtering
2. Implement `/plugin search` with exact substring matching
3. Implement `/plugin info` with full metadata display
4. Add offline cache fallback for marketplace.json

**Deliverables**:
- Browse functionality with filters and pagination
- Search functionality (exact match only in Phase 1)
- Detail view with permissions and compatibility
- Cached marketplace fallback

**Success Criteria**:
✅ Users can discover plugins via browse/search
✅ All plugin metadata visible in detail view
✅ Offline mode works with cached marketplace
✅ Search time < 200ms (p95)

**Estimated Effort**: 40 hours (2 developers × 2 weeks)

---

### Phase 3: Publishing (1 week)

**Week 7: CI/CD Automation**

**Tasks**:
1. Create GitHub Actions workflow (`.github/workflows/validate-schemas.yml`)
2. Implement validation scripts (10 marketplace rules + 12 plugin rules)
3. Add auto-tagging and release creation
4. Test end-to-end publishing flow

**Deliverables**:
- Working CI validation on PRs
- Automated git tagging on merge
- GitHub release creation with changelog
- Validation execution < 1 minute

**Success Criteria**:
✅ Publishing via PR works end-to-end
✅ Invalid schemas blocked by CI
✅ Time from commit to availability < 10 minutes
✅ CI execution < 1 minute (NFR-MAINT-002)

**Estimated Effort**: 20 hours (1 developer × 1 week)

---

### Phase 4: Polish (2 weeks)

**Week 8-9: Error Handling and Optimization**

**Tasks**:
1. Implement all 23 error scenarios from Section 4.0
2. Performance optimization to meet NFR targets
3. Write user documentation and API docs
4. Comprehensive testing (unit + integration + performance)

**Deliverables**:
- Complete error handling with actionable messages
- Performance benchmarks passing all NFRs
- User guide and troubleshooting documentation
- Test coverage ≥ 85%

**Success Criteria**:
✅ All error scenarios implemented
✅ All NFRs pass validation
✅ Documentation complete
✅ Test coverage ≥ 85%

**Estimated Effort**: 60 hours (2 developers × 2 weeks)

---

## Testing Strategy

### Unit Tests

**Coverage Target**: ≥85% for core logic

**Test Areas**:
- JSON schema validation (marketplace, plugin)
- Version parsing and comparison (semver)
- Compatibility checking (4 dimensions)
- Symlink operations (atomic swaps)
- Registry CRUD operations
- Error message formatting

**Tools**: Jest, Mocha, or built-in Node.js test runner

**Example**:
```javascript
describe('Compatibility Checker', () => {
  it('blocks install when Claude Code version too old', () => {
    const result = checkCompatibility({
      claudeCodeMin: '2.1.0',
      currentVersion: '2.0.12'
    });
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain('Claude Code');
  });
});
```

---

### Integration Tests

**Coverage Target**: All user journeys (10 total)

**Test Scenarios**:
1. Fresh install on clean system
2. Update with cached previous version
3. Rollback after failed update
4. Install with dependency resolution
5. Install with permission confirmation
6. Uninstall with cache cleanup
7. Offline browse with cached marketplace
8. Publishing via PR (full CI workflow)

**Tools**: Playwright (E2E), Supertest (API), Docker (isolated environments)

**Example**:
```bash
# Integration test: Install → Rollback
/plugin install hookify@1.2.3
assert_installed hookify 1.2.3

/plugin update hookify
assert_installed hookify 1.3.0

/plugin rollback hookify
assert_installed hookify 1.2.3
assert_rollback_time < 1s
```

---

### Performance Tests

**NFR Validation**:
- NFR-PERF-001: Install time p95 ≤ 2 minutes
- NFR-PERF-002: Publish time p95 ≤ 10 minutes
- NFR-PERF-003: Parse time p95 < 1 second
- NFR-PERF-004: Update check p95 < 3 seconds
- NFR-PERF-005: Rollback p95 < 1 second

**Benchmark Script**:
```bash
#!/bin/bash
# NFR-PERF-001: Install time benchmark
results=()
for i in {1..100}; do
  start=$(date +%s.%N)
  /plugin install hookify@1.2.3 --force
  end=$(date +%s.%N)
  duration=$(echo "$end - $start" | bc)
  results+=($duration)
done

# Calculate p95
sorted=($(printf '%s\n' "${results[@]}" | sort -n))
p95_index=$((${#sorted[@]} * 95 / 100))
echo "p95 install time: ${sorted[$p95_index]} seconds"

# Assert < 120 seconds (2 minutes)
if [ $(echo "${sorted[$p95_index]} < 120" | bc) -eq 1 ]; then
  echo "✅ NFR-PERF-001 PASS"
else
  echo "❌ NFR-PERF-001 FAIL"
fi
```

---

### Reliability Tests

**NFR Validation**:
- NFR-REL-001: Deterministic installs (100%)
- NFR-REL-002: Rollback success (100%)
- NFR-REL-003: Install success (95%)
- NFR-REL-004: Schema validation (100%)
- NFR-REL-005: Compatibility check (100%)
- NFR-REL-006: Version pin stability (100%)

**Determinism Test**:
```bash
# NFR-REL-001: Verify same version produces same files
/plugin install hookify@1.2.3
checksum1=$(find ~/.claude/plugins/cache/hookify/1.2.3 -type f -exec sha256sum {} \; | sha256sum)

/plugin uninstall hookify
/plugin install hookify@1.2.3
checksum2=$(find ~/.claude/plugins/cache/hookify/1.2.3 -type f -exec sha256sum {} \; | sha256sum)

/plugin uninstall hookify
/plugin install hookify@1.2.3
checksum3=$(find ~/.claude/plugins/cache/hookify/1.2.3 -type f -exec sha256sum {} \; | sha256sum)

# Assert all three identical
[ "$checksum1" = "$checksum2" ] && [ "$checksum2" = "$checksum3" ]
```

---

## Key Technical Challenges

### 1. Atomic Operations

**Challenge**: Install must be all-or-nothing (no partial state)

**Solution** (from CRIT-001):
```
BEGIN TRANSACTION
1. Create staging directory
2. Download files → IF FAIL: delete staging, ABORT
3. Validate entrypoints → IF FAIL: delete staging, ABORT
4. Run npm install → IF FAIL: delete staging, ABORT
5. Run lifecycle scripts → IF FAIL: run uninstall, delete staging, ABORT
6. Move staging → cache (atomic rename)
7. Create symlink (atomic on Linux/macOS)
8. Write config.json.tmp
9. Rename config.json.tmp → config.json (atomic)
COMMIT TRANSACTION
```

**Rollback Points**:
- Steps 1-5: Delete staging (no state modified)
- Steps 6-7: Delete cache + symlink
- Steps 8-9: Delete cache + symlink + tmp file

---

### 2. Symlink Handling on Windows

**Challenge**: Symlinks require developer mode OR admin on Windows

**Solution** (from CRIT-026):
1. Attempt symbolic link (requires developer mode)
2. Fallback to directory junction (works without admin on NTFS)
3. Fallback to hard links for individual files
4. If all fail: Error with "Enable developer mode" instructions

**Alternative**: Document Windows developer mode requirement

---

### 3. Permission Disclosure vs Enforcement

**Challenge**: Users may assume permissions are enforced

**Solution** (from CRIT-003):
- Display clear warning: "⚠️ Permissions informational only (not enforced at runtime)"
- Show permissions BEFORE install with explicit confirmation
- Only install plugins from trusted sources (personal marketplace)
- Phase 2: Add runtime enforcement (sandboxing)

---

### 4. npm Install Failures

**Challenge**: Dependency installation can fail for many reasons

**Solution**:
- Retry npm install 3x with exponential backoff
- Log full stdout/stderr to `~/.claude/plugins/logs/`
- Display actionable error with log file path
- Clean up staging directory on failure (atomic rollback)

**Error Message Template**:
```
[DEPENDENCY INSTALLATION FAILED]: npm install failed for hookify
[REASON]: Missing peer dependency 'ajv@8.12.0'
[FIX]: Check error log:
  cat ~/.claude/plugins/logs/hookify-install-20260111T103045Z.log

  OR clone plugin and diagnose manually:
  git clone https://github.com/kinginyellow/yellow-plugins
  cd yellow-plugins/plugins/hookify
  npm install
```

---

### 5. Cache Management

**Challenge**: Cache can grow unbounded, wasting disk space

**Solution** (from CRIT-002):
- Keep last 3 versions per plugin (minimum for rollback)
- Limit total cache to 500 MB (configurable via env var)
- LRU eviction: Delete oldest versions when limit exceeded
- Warn user when cache > 450 MB (90% of limit)

**Cache Eviction Algorithm**:
```javascript
function evictCache() {
  const cacheSize = getTotalCacheSize();
  const limit = process.env.CLAUDE_PLUGINS_CACHE_SIZE || 500 * 1024 * 1024; // 500 MB

  if (cacheSize < limit) return; // No eviction needed

  // Sort all cached versions by last access time
  const versions = getAllCachedVersions().sort((a, b) => a.lastAccess - b.lastAccess);

  for (const version of versions) {
    // Keep current version + at least 1 previous version per plugin
    if (isCurrentVersion(version) || isPrimaryRollbackTarget(version)) continue;

    // Delete oldest versions until under limit
    deleteCachedVersion(version);
    if (getTotalCacheSize() < limit) break;
  }
}
```

---

## File Structure After Implementation

```
~/.claude/plugins/
├── cache/
│   ├── hookify/
│   │   ├── 1.0.0/          # Old version (rollback target)
│   │   ├── 1.2.3/          # Previous version (rollback target)
│   │   └── 1.3.0/          # Current version
│   ├── pr-review-toolkit/
│   │   ├── 2.0.0/
│   │   └── 2.1.0/
│   └── ... (LRU eviction when > 500 MB)
│
├── installed/
│   ├── hookify -> ../cache/hookify/1.3.0/          # Symlink to active version
│   ├── pr-review-toolkit -> ../cache/pr-review-toolkit/2.1.0/
│   └── ...
│
├── logs/
│   ├── hookify-install-20260111T103045Z.log
│   ├── hookify-update-20260111T140230Z.log
│   └── ... (rotate oldest, max 50 MB total)
│
├── staging/
│   └── {temporary-install-directories}/         # Deleted after install
│
└── config.json                                  # Plugin registry
    {
      "version": "1.0",
      "plugins": {
        "hookify": {
          "currentVersion": "1.3.0",
          "pinned": false,
          "installedAt": "2026-01-11T10:30:00Z",
          "lastUpdated": "2026-01-11T14:02:30Z",
          "previousVersions": ["1.0.0", "1.2.3"],
          "marketplace": "https://github.com/kinginyellow/yellow-plugins"
        }
      },
      "settings": {
        "autoUpdate": false,
        "updateCheckInterval": 86400,
        "lastUpdateCheck": "2026-01-11T09:00:00Z"
      }
    }
```

---

## Risk Mitigation During Implementation

**RISK-01** (Update breaks workflow, RPN 252):
- Test rollback on EVERY merge to main branch
- Automated rollback tests in CI
- User journey 2.2.3 implemented with < 1s target

**RISK-02** (Schema drift, RPN 72):
- Enforce schema validation in CI (block PRs on failure)
- Version schema files (schemaVersion field)
- Test backward compatibility on schema updates

**RISK-03** (Marketplace unavailable, RPN 112):
- Implement local cache with timestamp warnings
- Cache marketplace.json for 24 hours
- Allow offline browsing with cached index

**RISK-04** (Plugin conflict, RPN 180):
- Implement dependency resolution (topological sort)
- Detect circular dependencies in CI
- Prompt user to install dependencies first

**RISK-05** (Permission creep, RPN 112):
- Mandatory permission disclosure before install
- Structured permissions with reasons
- Warning: "Permissions informational only"

**All risks have concrete mitigations in specification.**

---

## Development Environment Setup

**Prerequisites**:
- Node.js 18 LTS or 20 LTS (NOT 25+)
- Git 2.30+ with symlink support
- Claude Code 2.0.12+ (for testing)
- Linux or macOS (Windows requires developer mode)

**Setup Steps**:
```bash
# Clone repository
git clone https://github.com/kinginyellow/yellow-plugins
cd yellow-plugins

# Install dependencies
npm install

# Run validation
npm run validate

# Run tests
npm test

# Build CLI
npm run build

# Link CLI globally (for testing)
npm link
```

**Environment Variables**:
```bash
# Optional configuration
export CLAUDE_PLUGINS_CACHE_SIZE=524288000  # 500 MB cache limit
export GITHUB_TOKEN=ghp_xxxxxxxxxxxxx      # For higher API rate limits (5000/hr vs 60/hr)
export LOG_LEVEL=debug                      # Verbose logging during development
```

---

## Troubleshooting Common Issues

### Issue 1: npm install fails during plugin installation

**Diagnosis**:
```bash
cat ~/.claude/plugins/logs/hookify-install-{timestamp}.log
```

**Common Causes**:
- Missing peer dependencies → Add to plugin's package.json
- Incompatible Node.js version → Check nodeMin/nodeMax in plugin.json
- Network timeout → Retry with longer timeout or use npm cache

**Solution**:
- Fix plugin's package.json dependencies
- Update compatibility constraints in plugin.json
- Contact plugin author if dependency issue persists

---

### Issue 2: Symlink creation fails on Windows

**Diagnosis**:
```
[FILESYSTEM UNSUPPORTED]: Cannot create plugin links
[REASON]: Windows requires developer mode OR admin
```

**Solution**:
Enable developer mode:
1. Settings → Update & Security → For developers
2. Toggle "Developer mode" ON
3. Restart terminal
4. Retry install

**Alternative**: Run Claude Code as administrator (not recommended)

---

### Issue 3: Cache fills disk space

**Diagnosis**:
```bash
du -sh ~/.claude/plugins/cache/
# Output: 520M
```

**Solution**:
```bash
# Manual cleanup (delete old versions)
/plugin cache clean

# OR adjust cache limit
export CLAUDE_PLUGINS_CACHE_SIZE=1073741824  # 1 GB

# OR delete entire cache (reinstall will re-populate)
rm -rf ~/.claude/plugins/cache/
```

---

### Issue 4: Rollback target not cached

**Diagnosis**:
```
[ROLLBACK UNAVAILABLE]: No previous version to rollback to
```

**Solution**:
```bash
# Reinstall specific old version
/plugin install hookify --version 1.2.3

# OR check which versions are cached
ls ~/.claude/plugins/cache/hookify/
```

---

## Performance Optimization Tips

1. **Parallel Installs**: Install multiple plugins in parallel (separate processes)
2. **Git Sparse Checkout**: Use sparse checkout to download only plugin directory (not full monorepo)
3. **npm Cache**: Leverage npm global cache to avoid re-downloading dependencies
4. **Symlink Caching**: Cache symlink targets to avoid repeated stat() calls
5. **Lazy Loading**: Load plugin manifests on-demand (not all at startup)

---

## Code Quality Standards

**Formatting**: Prettier with 2-space indentation
**Linting**: ESLint with recommended rules
**Type Safety**: TypeScript (optional) or JSDoc type annotations
**Error Handling**: Always use structured error objects with WHAT+WHY+HOW format
**Logging**: Structured logging with timestamps (ISO 8601)
**Comments**: Explain WHY, not WHAT (code should be self-documenting)

**Example Error Object**:
```javascript
class InstallError extends Error {
  constructor(what, why, how, details = {}) {
    super(`[${what}]: ${why}\n[FIX]: ${how}`);
    this.name = 'InstallError';
    this.what = what;
    this.why = why;
    this.how = how;
    this.details = details;
  }
}

throw new InstallError(
  'DEPENDENCY INSTALLATION FAILED',
  'npm install failed with exit code 1',
  'Check error log:\n  cat ~/.claude/plugins/logs/hookify-install.log',
  { pluginId: 'hookify', exitCode: 1 }
);
```

---

## Continuous Integration Setup

**GitHub Actions Workflow** (`.github/workflows/validate-schemas.yml`):

```yaml
name: Validate Schemas

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install

      - name: Validate marketplace schema
        run: node scripts/validate-marketplace.js .claude-plugin/marketplace.json

      - name: Validate all plugin schemas
        run: node scripts/validate-all-plugins.js

      - name: Check for circular dependencies
        run: node scripts/check-circular-deps.js

      - name: Verify version consistency
        run: node scripts/verify-versions.js
```

**Execution Time**: < 1 minute (meets NFR-MAINT-002)

---

## Deployment Strategy

**Phase 1: Alpha Release** (Internal Testing)
- Deploy to personal machine only
- Test with 3-5 plugins
- Collect performance metrics
- Fix critical bugs

**Phase 2: Beta Release** (Limited Users)
- Deploy to 2-3 additional machines
- Test cross-platform (Linux + macOS)
- Validate all NFRs pass
- Document edge cases

**Phase 3: Production Release** (General Availability)
- Tag v1.0.0
- Create GitHub release with changelog
- Update README with installation instructions
- Announce on personal blog/Twitter

**Rollback Plan**: Keep previous CLI version available as `~/.claude/plugins-v0.9.x` backup

---

## Success Metrics Tracking

**Primary Success Metric (PSM)**:
```bash
# Measure install time (p95)
./benchmark-install.sh
# Target: ≤ 2 minutes

# Track over time
echo "$(date +%s),$(measure_install_time)" >> metrics/install-times.csv
```

**Secondary Success Metrics (SSM)**:
```bash
# SSM-1: Rollback success rate
./test-rollback-reliability.sh
# Target: 100%

# SSM-2: Publish time
./benchmark-publish.sh
# Target: ≤ 10 minutes
```

**Dashboard**: Create simple dashboard to visualize metrics over time (optional)

---

## Support and Maintenance

**Bug Reports**: GitHub Issues
**Feature Requests**: GitHub Discussions
**Security Issues**: Email dev@kingin-yellows.dev (private disclosure)
**Documentation**: README.md + docs/ directory

**Maintenance Cadence**:
- Weekly dependency updates (npm audit)
- Monthly schema updates (if needed)
- Quarterly major releases (breaking changes)

---

## Conclusion

This implementation guide provides a roadmap for building a production-quality plugin marketplace in 9 weeks. Follow the phased approach, validate all NFRs, and address critical issues first.

**Key Success Factors**:
1. ✅ Address all CRITICAL issues from adversarial review
2. ✅ Implement atomic operations correctly (CRIT-001)
3. ✅ Test rollback thoroughly (100% success required)
4. ✅ Validate all 21 NFRs pass before release
5. ✅ Document edge cases and troubleshooting

**Questions?** Refer to:
- Complete specification: `docs/SPECIFICATION.md`
- Adversarial review: `docs/ADVERSARIAL-REVIEW.md`
- Traceability matrix: `docs/traceability-matrix.md`

---

**Document Status**: FINAL ✅
**Version**: 1.0
**Last Updated**: 2026-01-11
**Prepared By**: AI Research Team (Phase 4 Validation)
