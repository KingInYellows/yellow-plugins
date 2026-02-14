---
status: complete
priority: p1
issue_id: "020"
tags: [code-review, security, injection]
dependencies: []
---

# GitHub issue body injection

## Problem Statement

The test-reporter agent creates GitHub issues with content derived from test results, which contain web page content (error messages, page text). This web content could include markdown injection (`[link](javascript:...)`) or GitHub Actions command injection (`::set-output`) that executes when the issue is viewed or processed.

## Findings

**File:** `plugins/yellow-browser-test/agents/testing/test-reporter.md`

**Issue:** Test results contain untrusted web content that flows into GitHub issue bodies without sanitization:

```
Test Result → Error Message (from web page) → GitHub Issue Body
```

**Attack vectors:**

1. **Markdown injection:**
   ```markdown
   Error: Test failed [click here](javascript:alert('XSS'))
   ```

2. **GitHub Actions command injection:**
   ```
   Error: ::set-output name=token::ghp_malicious_token
   ```

3. **HTML injection (if markdown allows):**
   ```markdown
   <img src=x onerror="alert('XSS')">
   ```

4. **Link injection:**
   ```markdown
   See details at [docs](http://malicious.com/phishing)
   ```

When developers view the issue, malicious content could:
- Execute JavaScript (if markdown renderer is vulnerable)
- Inject GitHub Actions commands (if issue is processed by CI)
- Phish credentials via fake links
- Inject tracking pixels

## Proposed Solutions

### Option A: Sanitize and escape untrusted content (Recommended)

Add sanitization layer before issue creation:

```markdown
## Issue Body Sanitization

Before creating GitHub issues:

1. **Strip HTML tags** from all test results and error messages
2. **Escape markdown special characters** in untrusted content:
   - Replace `[` with `\[`
   - Replace `]` with `\]`
   - Replace `<` with `&lt;`
   - Replace `>` with `&gt;`
3. **Wrap user-derived content in code blocks** to prevent interpretation:
   ```
   Error message:
   ```
   [untrusted error text here]
   ```
   ```
4. **Remove GitHub Actions command sequences** (`::set-output`, `::add-mask`, etc.)
```

**Pros:**
- Mechanically prevents injection
- Preserves error message content for debugging
- Defense in depth

**Cons:**
- May over-sanitize legitimate content
- Requires careful implementation

### Option B: Enhanced AskUserQuestion preview

Show complete issue body to user for review:

```markdown
## Before Issue Creation

Use AskUserQuestion to show:
- Full issue title
- Complete issue body (rendered markdown)
- Warning: "Review for malicious content before approval"

Only create issue after user approval.
```

**Pros:**
- Human review catches sophisticated attacks
- Already partially implemented

**Cons:**
- Relies on user vigilance
- User may not recognize all injection patterns
- Adds friction to workflow

## Recommended Action

Implement **both Option A and enhanced Option B** for defense in depth:

1. Add sanitization rules to test-reporter agent (Option A)
2. Enhance AskUserQuestion to show complete issue body preview (Option B)
3. Document markdown injection risk in agent file
4. Test with malicious web content

## Technical Details

**Current code location:**
- `plugins/yellow-browser-test/agents/testing/test-reporter.md`

**Content flow:**
```
Web Page → agent-browser → Test Results → test-reporter → GitHub Issue
              ↑                                                    ↑
         untrusted input                              needs sanitization
```

**Injection points:**
- Test error messages (from page assertions)
- Page text content (from accessibility checks)
- Console errors (from browser console)
- Network error messages (from failed requests)
- Stack traces (could contain malicious strings)

**GitHub markdown security:**
- GitHub sanitizes HTML in markdown (but has had bypasses)
- JavaScript URLs in links (`javascript:`) are blocked (but check current status)
- GitHub Actions commands in issue bodies CAN be processed by workflows

## Acceptance Criteria

- [ ] Sanitization rules added to test-reporter agent
- [ ] HTML tags stripped from all untrusted content
- [ ] Markdown special characters escaped in error messages
- [ ] User-derived content wrapped in code blocks
- [ ] GitHub Actions command sequences removed
- [ ] AskUserQuestion shows complete issue body preview
- [ ] Preview includes security warning
- [ ] Tested with malicious web content (markdown injection, Actions commands)
- [ ] No raw HTML in generated issue bodies

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-13 | Created from PR #11 code review | Test results containing web content are untrusted and must be sanitized before creating GitHub issues |

## Resources

- PR: #11 (yellow-browser-test plugin code review)
- File: `plugins/yellow-browser-test/agents/testing/test-reporter.md`
- Related: GitHub markdown security documentation
- Related: GitHub Actions command injection patterns
- Related: OWASP markdown injection guidelines
