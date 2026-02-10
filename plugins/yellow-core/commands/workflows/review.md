---
name: workflows:review
description: Multi-agent comprehensive code review with security, performance, and architecture analysis
argument-hint: "[PR number/URL/branch/latest]"
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
  - Task
  - AskUserQuestion
---

# Comprehensive Code Review Workflow

Execute multi-agent code review with parallel analysis from security, performance, architecture, and code quality perspectives.

## Phase 1: Determine Review Target

**Objective:** Identify and fetch the code to review.

**Steps:**

1. Parse `#$ARGUMENTS` to determine review target:
   - **PR number:** `123` → Fetch PR #123
   - **GitHub URL:** `https://github.com/org/repo/pull/123` → Extract PR number
   - **Branch name:** `feature-x` → Review branch against main
   - **"latest":** Review current branch or most recent PR
   - **Empty/none:** Review current working changes

2. Check current branch:
   ```bash
   git branch --show-current
   git status --short
   ```

3. Fetch PR metadata if reviewing a PR:
   ```bash
   # For PR number
   gh pr view 123 --json number,title,body,headRefName,baseRefName,author,createdAt,updatedAt,additions,deletions,files

   # For GitHub URL
   gh pr view https://github.com/org/repo/pull/123 --json number,title,body,headRefName,baseRefName,author,createdAt,updatedAt,additions,deletions,files

   # For "latest"
   gh pr list --author "@me" --state open --limit 1 --json number,title,headRefName
   ```

4. Get file changes:
   ```bash
   # For PR
   gh pr diff 123

   # For branch
   git diff main...feature-branch

   # For working changes
   git diff HEAD
   ```

5. Get list of changed files:
   ```bash
   # For PR
   gh pr view 123 --json files --jq '.files[].path'

   # For branch
   git diff --name-only main...feature-branch

   # For working changes
   git diff --name-only HEAD
   ```

6. If not on target branch, offer to use git-worktree for isolated review:
   ```
   Use AskUserQuestion:

   "You're currently on branch X, but reviewing branch Y.

   Would you like to:
   1. Review from here (read-only)
   2. Create isolated worktree for hands-on review
   3. Switch to branch Y"
   ```

7. Read changed files into context:
   ```bash
   # Read each changed file
   bat path/to/changed/file.ts
   ```

## Phase 2: Parallel Agent Review

**Objective:** Get comprehensive analysis from multiple specialized perspectives.

**Steps:**

1. Launch ALL reviewer agents in parallel using Task tool:

   ```
   Task: polyglot-reviewer
   Input: {pr_content, changed_files, language}
   Goal: Review language-specific best practices, idioms, type safety
   ```

   ```
   Task: code-simplicity-reviewer
   Input: {pr_content, changed_files}
   Goal: Identify complexity, suggest simplifications, check readability
   ```

   ```
   Task: security-sentinel
   Input: {pr_content, changed_files}
   Goal: Find security vulnerabilities, unsafe patterns, injection risks
   ```

   ```
   Task: performance-oracle
   Input: {pr_content, changed_files}
   Goal: Identify performance issues, inefficiencies, scaling concerns
   ```

   ```
   Task: architecture-strategist
   Input: {pr_content, changed_files, codebase_structure}
   Goal: Assess architectural fit, coupling, cohesion, design patterns
   ```

   ```
   Task: test-coverage-analyst
   Input: {pr_content, changed_files, test_files}
   Goal: Evaluate test coverage, quality, edge cases, brittleness
   ```

   ```
   Task: git-history-analyzer
   Input: {pr_content, commits}
   Goal: Review commit structure, messages, atomic changes
   ```

2. Wait for all agents to complete (they run in parallel).

3. Collect findings from each agent:
   - Store findings by agent
   - Note severity levels
   - Track file locations
   - Capture suggested fixes

## Phase 3: Deep Analysis

**Objective:** Ultra-thinking phase for thorough review.

**Steps:**

1. **Stakeholder Perspective Analysis:**

   a. **Developer Experience:**
      - Is the code easy to understand?
      - Can others maintain this?
      - Are APIs intuitive?
      - Is documentation sufficient?

   b. **Operations Perspective:**
      - How will this deploy?
      - Monitoring/observability?
      - Debugging capabilities?
      - Resource usage?
      - Rollback strategy?

   c. **End User Impact:**
      - Performance characteristics?
      - Error handling/UX?
      - Accessibility?
      - Backwards compatibility?

   d. **Security Team View:**
      - Attack surface changes?
      - Input validation?
      - Auth/authz correct?
      - Data protection?
      - Dependency security?

2. **Scenario Exploration:**

   a. **Happy Path:**
      - Does normal flow work correctly?
      - Are success cases handled?

   b. **Invalid Inputs:**
      - Null/undefined handling?
      - Type mismatches?
      - Boundary values?
      - Malformed data?

   c. **Edge Cases:**
      - Empty collections?
      - Maximum values?
      - Race conditions?
      - Network failures?

   d. **Concurrency:**
      - Thread safety?
      - Race conditions?
      - Deadlock potential?
      - State management?

   e. **Scale:**
      - Performance at 10x load?
      - Memory usage patterns?
      - Database query efficiency?
      - Caching strategy?

   f. **Failure Modes:**
      - Graceful degradation?
      - Error propagation?
      - Recovery mechanisms?
      - User notification?

3. **Cross-Cutting Concerns:**

   - **Logging:** Sufficient for debugging?
   - **Metrics:** Can we measure success?
   - **Tracing:** Distributed system visibility?
   - **Configuration:** Externalized properly?
   - **Feature Flags:** Gradual rollout possible?
   - **Documentation:** API docs, ADRs, runbooks?

4. **Code Quality Metrics:**

   - Cyclomatic complexity
   - Function length
   - Nesting depth
   - Coupling metrics
   - Test coverage percentage
   - Code duplication

## Phase 4: Synthesis

**Objective:** Organize findings and present actionable review.

**Steps:**

1. **Categorize All Findings:**

   a. By Type:
      - Security vulnerabilities
      - Performance issues
      - Bug risks
      - Code quality
      - Architecture concerns
      - Test gaps
      - Documentation needs
      - Style/convention violations

   b. By Severity:
      - **P1 CRITICAL:** Blocks merge, must fix
        - Security vulnerabilities
        - Data corruption risks
        - Breaking changes without migration
        - Critical bugs
      - **P2 IMPORTANT:** Should fix before merge
        - Significant performance issues
        - Test coverage gaps
        - Design pattern violations
        - Poor error handling
      - **P3 NICE-TO-HAVE:** Can address later
        - Minor optimizations
        - Style improvements
        - Documentation enhancements
        - Refactoring opportunities

2. **Remove Duplicates:**
   - Merge similar findings from multiple agents
   - Consolidate related issues
   - Keep most detailed explanation

3. **Estimate Effort:**
   - For each finding, estimate fix time:
     - Quick: < 30 min
     - Medium: 30 min - 2 hours
     - Large: > 2 hours

4. **Prepare Summary Report:**

```markdown
# Code Review Summary

**PR:** #123 - Feature Name
**Author:** username
**Reviewed:** YYYY-MM-DD
**Changed Files:** X files (+Y, -Z lines)

## 📊 Overview

- **Total Findings:** N
- **P1 Critical:** X (⛔ blocks merge)
- **P2 Important:** Y (⚠️ should fix)
- **P3 Nice-to-have:** Z (💡 optional)

**Agents Consulted:**
- ✅ Polyglot Reviewer (language best practices)
- ✅ Code Simplicity Reviewer (complexity analysis)
- ✅ Security Sentinel (vulnerability scan)
- ✅ Performance Oracle (optimization review)
- ✅ Architecture Strategist (design assessment)
- ✅ Test Coverage Analyst (testing evaluation)
- ✅ Git History Analyzer (commit review)

---

## ⛔ P1 Critical Issues (Must Fix)

### 1. [Security] SQL Injection Risk in Query Builder
**File:** `src/database/query.ts:45`
**Agent:** Security Sentinel

**Issue:**
Direct string concatenation in SQL query allows injection:
```typescript
const query = `SELECT * FROM users WHERE id = ${userId}`;
```

**Impact:** High - allows arbitrary database access

**Fix:**
```typescript
const query = `SELECT * FROM users WHERE id = ?`;
db.execute(query, [userId]);
```

**Effort:** Quick (15 min)

---

### 2. [Bug] Null Pointer Exception in Error Handler
**File:** `src/handlers/error.ts:78`
**Agent:** Polyglot Reviewer

**Issue:**
Accessing `error.stack` without null check:
```typescript
logger.error(error.stack.split('\n')[0]);
```

**Impact:** High - crashes error handler

**Fix:**
```typescript
logger.error(error?.stack?.split('\n')?.[0] ?? 'Unknown error');
```

**Effort:** Quick (10 min)

---

## ⚠️ P2 Important Issues (Should Fix)

### 3. [Performance] N+1 Query Pattern
**File:** `src/services/user.ts:123`
**Agent:** Performance Oracle

**Issue:**
Loading related data in loop causes N+1 queries:
```typescript
for (const user of users) {
  user.posts = await db.posts.findByUserId(user.id);
}
```

**Impact:** Medium - slow for large datasets

**Fix:**
```typescript
const userIds = users.map(u => u.id);
const posts = await db.posts.findByUserIds(userIds);
const postsByUser = groupBy(posts, 'userId');
users.forEach(u => u.posts = postsByUser[u.id] || []);
```

**Effort:** Medium (45 min)

---

### 4. [Testing] Missing Edge Case Tests
**File:** `tests/validator.test.ts`
**Agent:** Test Coverage Analyst

**Issue:**
No tests for boundary conditions:
- Empty string input
- Maximum length input
- Unicode/emoji handling
- Null/undefined values

**Impact:** Medium - bugs may slip through

**Fix:** Add test cases for all edge cases

**Effort:** Medium (1 hour)

---

## 💡 P3 Nice-to-have (Optional)

### 5. [Code Quality] High Cyclomatic Complexity
**File:** `src/utils/parser.ts:200`
**Agent:** Code Simplicity Reviewer

**Issue:**
Function has cyclomatic complexity of 15 (recommended max: 10).
Deeply nested conditionals make it hard to understand.

**Suggestion:** Extract sub-functions or use strategy pattern

**Effort:** Large (2 hours)

---

### 6. [Documentation] Missing JSDoc
**File:** `src/api/routes.ts`
**Agent:** Polyglot Reviewer

**Issue:**
Public API functions lack documentation:
- Parameter descriptions
- Return type documentation
- Usage examples

**Suggestion:** Add JSDoc comments

**Effort:** Medium (30 min)

---

## 🏗️ Architecture Observations

**Agent:** Architecture Strategist

**Strengths:**
- Good separation of concerns
- Clear module boundaries
- Consistent error handling pattern

**Concerns:**
- New service bypasses existing middleware layer
- Tight coupling to specific database implementation
- Consider introducing repository pattern for better testability

**Recommendations:**
- Refactor to use existing middleware for consistency
- Add abstraction layer for data access
- Consider these for follow-up PR

---

## 🧪 Testing Assessment

**Agent:** Test Coverage Analyst

**Coverage:** 87% (target: 90%)
**Missing Coverage:**
- Error handling branches
- Edge case scenarios
- Integration with external service

**Quality:**
- Tests are well-structured
- Good use of fixtures
- Some tests are brittle (depend on specific IDs)

**Recommendations:**
- Add error path tests
- Use factories instead of hard-coded IDs
- Add integration test for external API

---

## 📝 Git History Review

**Agent:** Git History Analyzer

**Commit Structure:** Good
- 8 atomic commits
- Clear conventional commit messages
- Logical progression

**Suggestions:**
- Consider squashing "fix typo" commits
- One commit mixes refactor + feature (commit 3)

---

## ✅ What Went Well

- Clean, readable code
- Good error handling
- Thoughtful variable naming
- Comprehensive happy path testing
- Clear commit history

---

## 🎯 Next Steps

### Required (P1 Issues):
1. Fix SQL injection vulnerability
2. Add null check in error handler

**⛔ Do not merge until P1 issues are resolved.**

### Recommended (P2 Issues):
3. Optimize N+1 query pattern
4. Add edge case tests

### Optional (P3 Issues):
5. Reduce complexity in parser
6. Add JSDoc documentation
7. Consider architecture improvements

---

## 🤖 Review Methodology

This review was conducted using parallel analysis from 7 specialized agents:
- Language-specific best practices
- Complexity and readability
- Security vulnerability scanning
- Performance profiling
- Architectural design review
- Test coverage analysis
- Git history evaluation

Combined with deep scenario analysis covering:
- Multiple stakeholder perspectives
- Edge cases and failure modes
- Concurrency and scale concerns
- Cross-cutting concerns

---

**Reviewer:** Claude Code
**Time:** ~X minutes
**Confidence:** High
```

5. Present summary to user.

6. Ask next steps via AskUserQuestion:
   ```
   Review complete. What would you like to do?

   1. Address P1 issues immediately
   2. Discuss specific findings
   3. Create follow-up issues for P2/P3 items
   4. Export review as comment (I'll post to PR)
   5. Something else
   ```

7. Handle user response:
   - Option 1: Help fix P1 issues
   - Option 2: Dive into specific findings
   - Option 3: Create GitHub issues with `gh issue create`
   - Option 4: Format and post review with `gh pr comment`
   - Option 5: Custom action

## Guidelines

- **Run agents in parallel:** Use Task tool for all 7 agents simultaneously
- **Be thorough:** Check all aspects (security, performance, architecture, tests)
- **Prioritize correctly:** P1 blocks merge, P2 should fix, P3 is optional
- **Be specific:** Include file paths, line numbers, code examples
- **Suggest fixes:** Don't just identify problems, propose solutions
- **Estimate effort:** Help prioritize by indicating fix complexity
- **Be constructive:** Balance criticism with recognition of good work
- **Consider context:** Understand project constraints and trade-offs
- **Document methodology:** Show how review was conducted
- **Guide next steps:** Make it clear what actions are needed

## Review Checklist

- [ ] Security vulnerabilities checked
- [ ] Performance issues identified
- [ ] Architecture fit assessed
- [ ] Code complexity evaluated
- [ ] Test coverage analyzed
- [ ] Error handling reviewed
- [ ] Edge cases considered
- [ ] Documentation checked
- [ ] Git history reviewed
- [ ] Backwards compatibility verified
- [ ] Dependencies security checked
- [ ] Resource usage assessed
- [ ] Monitoring/observability considered
- [ ] Rollback strategy reviewed
