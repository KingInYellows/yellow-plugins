# Semgrep To-Fix Fixer: Claude Code Plugin Design Research

**Date:** 2026-03-03
**Sources:** Perplexity Research (deep + ask + reason), Tavily Search + Extract, GitHub raw source extraction, local yellow-plugins monorepo analysis

## Summary

The Semgrep ecosystem provides three integration surfaces for building an automated "To-Fix Fixer" plugin: (1) the **Semgrep MCP server** (`semgrep-mcp`), which exposes 9 tools for scanning, AST analysis, and platform findings retrieval; (2) the **Semgrep AppSec Platform REST API**, which provides deployment-scoped endpoints for listing findings by triage state and bulk-triaging them; and (3) the **Semgrep CLI** (`semgrep scan`), which enables local re-verification after fixes are applied. The yellow-plugins monorepo follows a well-established pattern of commands, agents, skills, and MCP server registration that this plugin should replicate. The plugin should combine MCP-based findings retrieval with direct REST API calls for triage state management, using the CLI for post-fix verification.

---

## 1. Semgrep MCP Server Tool Catalog

### Overview

The Semgrep MCP server has been merged into the main `semgrep/semgrep` repository (as of September 2025) and is now invoked via `semgrep mcp` rather than as a standalone package. The PyPI package `semgrep-mcp` (v0.9.0) remains available for backward compatibility. The server is open-source and provides a Model Context Protocol interface that bridges LLMs, AI coding assistants, and IDEs with Semgrep's static analysis engine.

### Installation Methods

| Method | Command |
|---|---|
| uv (recommended) | `uvx semgrep-mcp` |
| pipx | `pipx install semgrep-mcp` |
| Semgrep CLI (current) | `semgrep mcp --help` |
| Docker (stdio) | `docker run -i --rm ghcr.io/semgrep/mcp -t stdio` |
| Docker (HTTP) | `docker run -p 8000:8000 ghcr.io/semgrep/mcp` |

### Environment Variables

| Variable | Purpose | Required? |
|---|---|---|
| `SEMGREP_APP_TOKEN` | AppSec Platform auth (findings, cloud features) | For `semgrep_findings` tool only |

### Transport Modes

- **`stdio`** (default) -- for local IDE/CLI integrations; server reads from stdin, writes to stdout
- **`streamable-http`** -- for remote/hosted deployments; listens on `127.0.0.1:8000/mcp` by default; requires OAuth as of January 2026
- **`sse`** -- **deprecated** as of January 2026; migrate to streamable-http

### MCP Client Configuration

**Claude Code:**
```bash
claude mcp add semgrep uvx semgrep-mcp
```

**Cursor / VS Code / Claude Desktop (JSON config):**
```json
{
  "mcpServers": {
    "semgrep": {
      "command": "uvx",
      "args": ["semgrep-mcp"],
      "env": {
        "SEMGREP_APP_TOKEN": "${SEMGREP_APP_TOKEN}"
      }
    }
  }
}
```

**Docker-based configuration:**
```json
{
  "mcpServers": {
    "semgrep": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "ghcr.io/semgrep/mcp", "-t", "stdio"]
    }
  }
}
```

**Hosted server (experimental):**
```json
{
  "mcpServers": {
    "semgrep": {
      "type": "streamable-http",
      "url": "https://mcp.semgrep.ai/mcp"
    }
  }
}
```

### Complete Tool Signatures

All signatures extracted from the authoritative source at `cli/src/semgrep/mcp/server.py` in the `semgrep/semgrep` repository.

#### Scan Tools

**`security_check`** -- Scan code for security vulnerabilities (hosted-only alias)
```python
async def security_check(
    ctx: Context,
    code_files: list[CodeFile]  # List of { path: str, content: str }
) -> SemgrepScanResult
```
Alias for `semgrep_scan_remote`. Only available when the MCP server is running in hosted mode.

**`semgrep_scan`** -- Scan local code files for security vulnerabilities
```python
async def semgrep_scan(
    ctx: Context,
    code_files: list[CodePath]  # List of { path: str } (absolute paths)
) -> SemgrepScanResult
```
Local-only tool. Scans files on disk using the workspace directory. Unavailable when `is_hosted()` is true. Files must be specified as absolute paths.

**`semgrep_scan_remote`** -- Scan code content for security vulnerabilities (hosted)
```python
async def semgrep_scan_remote(
    ctx: Context,
    code_files: list[CodeFile]  # List of { path: str, content: str }
) -> SemgrepScanResult
```
Hosted-only tool. Receives code content inline (not file paths). Creates temporary files, runs scan, cleans up.

**`semgrep_scan_with_custom_rule`** -- Scan code with a custom Semgrep rule
```python
async def semgrep_scan_with_custom_rule(
    ctx: Context,
    code_files: list[CodeFile],  # List of { path: str, content: str }
    rule: str                     # Semgrep YAML rule string
) -> SemgrepScanResult
```
Creates temporary directory, writes code files and rule YAML, runs scan with custom rule file, cleans up. Works in both local and hosted modes.

**`semgrep_scan_supply_chain`** -- Scan workspace for dependency vulnerabilities
```python
async def semgrep_scan_supply_chain(
    ctx: Context
) -> CliOutput
```
Runs Semgrep Supply Chain analysis on the workspace directory. Detects reachable vulnerabilities in third-party dependencies. Use when dependencies change or lockfiles are updated.

#### Understanding Tools

**`get_abstract_syntax_tree`** -- Get the AST of code in JSON format
```python
async def get_abstract_syntax_tree(
    ctx: Context,
    code: str,        # The code content to parse
    language: str      # Programming language (e.g., "python", "javascript")
) -> str              # JSON-formatted AST
```
Returns the Abstract Syntax Tree for provided code. Useful for understanding code structure, pattern matching, and transformation planning.

#### Platform Tools (require SEMGREP_APP_TOKEN)

**`semgrep_findings`** -- Fetch findings from Semgrep AppSec Platform
```python
async def semgrep_findings(
    ctx: Context,
    issue_type: Literal[
        "ISSUE_TYPE_SAST",
        "ISSUE_TYPE_SCA"
    ] = "ISSUE_TYPE_SAST",
    repos: list[str] = [],
    status: Literal[
        "ISSUE_TAB_OPEN",
        "ISSUE_TAB_CLOSED",
        "ISSUE_TAB_IGNORED",
        "ISSUE_TAB_REVIEWING",
        "ISSUE_TAB_FIXING"
    ] = "ISSUE_TAB_OPEN",
    severities: list[Literal[
        "SEVERITY_CRITICAL",
        "SEVERITY_HIGH",
        "SEVERITY_MEDIUM",
        "SEVERITY_LOW"
    ]] | None = None,
    confidence: list[Literal[
        "CONFIDENCE_HIGH",
        "CONFIDENCE_MEDIUM",
        "CONFIDENCE_LOW"
    ]] | None = None,
    autotriage_verdict: Literal[
        "VERDICT_TRUE_POSITIVE",
        "VERDICT_FALSE_POSITIVE"
    ] = "VERDICT_TRUE_POSITIVE",
    limit: int = 10
) -> list[Finding] | str
```

Internal implementation details:
- Authenticates via OAuth token or API token with `webapi` role
- Validates deployment ID exists via `get_deployment_id()`
- Requires at least one repository name in `repos`
- Calls internal endpoint: `POST {SEMGREP_API_URL}/agent/deployments/{deployment_id}/issues/v2`
- Request body: `{ deploymentId, issueType, filter: { status: [status], repositoryNames: repos, severities, confidences, aiVerdicts: [autotriage_verdict], on_primary_branch: true }, limit }`
- Returns `list[Finding]` or the string `"No findings found"` (empty list "confuses the agent")
- Error handling: 401 = invalid token, 404 = deployment not found

**Critical note:** The `status` parameter uses internal enum values (`ISSUE_TAB_FIXING`) rather than public API triage states (`fixing`). The "to fix" concept maps to `ISSUE_TAB_FIXING`.

**`semgrep_whoami`** -- Get current user identity
```python
async def semgrep_whoami(
    ctx: Context
) -> WhoamiResult  # { id: int, name: str, email: str, login: str }
```
Only works with JWTs (OAuth), not API tokens.

#### Meta Tools

**`semgrep_rule_schema`** -- Get the JSON Schema for Semgrep rules
```python
async def semgrep_rule_schema(
    ctx: Context
) -> str  # JSON Schema document
```
Fetches the latest rule schema from `{SEMGREP_API_URL}/schema_url`. Useful for validating custom rules before scanning.

**`get_supported_languages`** -- List supported languages
```python
async def get_supported_languages(
    ctx: Context
) -> list[str]  # e.g., ["python", "javascript", "java", "go", ...]
```
Returns the complete list of programming languages Semgrep supports for static analysis.

### MCP Prompts

| Prompt | Description |
|---|---|
| `write_custom_semgrep_rule` | Returns a prompt to guide writing a Semgrep rule |

### MCP Resources

| URI | Description |
|---|---|
| `semgrep://rule/schema` | Specification of the Semgrep rule YAML syntax using JSON Schema |
| `semgrep://rule/{rule_id}/yaml` | Full Semgrep rule in YAML format from the Semgrep Registry |

### Key Data Models

From `cli/src/semgrep/mcp/models.py`:

```python
class CodeFile(BaseModel):
    path: str = Field(description="Path of the code file")
    content: str = Field(description="Content of the code file")

class CodePath(BaseModel):
    path: str = Field(description="Absolute path of the code file")

class CodeWithLanguage(BaseModel):
    content: str = Field(description="Content of the code file")
    language: str = Field(description="Programming language of the code file", default="python")

class Finding(BaseModel):
    """Models protos.issues.v1.Issue from the semgrep-app repo."""
    model_config = ConfigDict(extra="allow", populate_by_name=True)
    id: int
    created_at: datetime | None = Field(default=None, validation_alias="createdAt")
    ref: str | None = None
    syntactic_id: str | None = Field(default=None, validation_alias="syntacticId")
    match_based_id: str | None = Field(default=None, validation_alias="matchBasedId")
    # Additional fields via extra="allow":
    # check_id, severity, message, path, line, fixable, cwe,
    # triage_state, confidence, component_tags, ...

class SemgrepScanResult(BaseModel):
    version: str = Field(description="Version of Semgrep used for the scan")
    results: list[dict[str, Any]] = Field(description="List of semgrep scan results")
    errors: list[dict[str, Any]] = Field(
        description="List of errors encountered during scan", default_factory=list
    )
    paths: dict[str, Any] = Field(description="Paths of the scanned files")
    skipped_rules: list[str] = Field(...)

class WhoamiResult(BaseModel):
    id: int = Field(description="ID of the current user")
    name: str = Field(description="Name of the current user")
    email: str = Field(description="Email of the current user")
    login: str = Field(description="Login of the current user")

class CodeSnippet(BaseModel):
    """Issue.CodeSnippet in the semgrep-app repo."""
    model_config = ConfigDict(extra="allow", populate_by_name=True)
    path: str | None = None
    content: str | None = None
```

---

## 2. Semgrep AppSec Platform REST API Reference

### Authentication

**Mechanism:** HTTP Bearer Token

**Header format:**
```
Authorization: Bearer {SEMGREP_APP_TOKEN}
```

**Base URL:** `https://semgrep.dev/api/v1/`

**Token generation:** Organization Settings > API Tokens > Create API Token

**Token format:** Tokens are prefixed with `sgp_` (e.g., `sgp_123456789abcdef...`)

**Token scope requirements:**
- Token must have `Web API` scope (not just `CI` scope)
- `CI`-scoped tokens return 404 errors on REST API endpoints
- Tokens inherit permissions from the creating user/organization

**Rate limit:** ~60 requests per minute

**Token validation endpoint:**
```
GET /api/v1/me
Authorization: Bearer {token}

Response:
{
  "user": {
    "id": "user_12345",
    "email": "security@company.com",
    "organizations": [
      { "id": "org_67890", "name": "Security Team" }
    ]
  }
}
```

### Endpoint Reference

#### List Deployments

```
GET /api/v1/deployments
Authorization: Bearer {token}

Response:
{
  "deployments": [
    {
      "id": 12345,
      "slug": "my-org",
      "name": "My Organization"
    }
  ]
}
```

The `slug` value is used in subsequent API calls as `{deployment_slug}`.

#### List Findings

```
GET /api/v1/deployments/{deployment_slug}/findings
Authorization: Bearer {token}
```

**Query Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `triage_state` | string | Filter by triage state: `open`, `reviewing`, `fixing`, `ignored`, `fixed`, `provisionally_ignored` |
| `repos` | string[] | Filter by repository name(s) |
| `severity` | string | Filter: `HIGH`, `MEDIUM`, `LOW`, `INFO` |
| `confidence` | string | Filter: `HIGH`, `MEDIUM`, `LOW` |
| `check_id` | string | Filter by specific rule ID (e.g., `python.lang.security.audit.dangerous-eval`) |
| `ref` | string | Git branch name (e.g., `main`). Must be explicit -- `_default` does NOT work. |
| `dedup` | string | `"true"` to deduplicate findings (IMPORTANT: required to match UI counts) |
| `categories` | string[] | List of categories to filter by |
| `component_tags` | string[] | List of component tags to filter by |
| `autotriage_verdict` | string | `"true_positive"` or `"false_positive"` |
| `dependencies` | string[] | Filter by dependency name (SCA findings only) |
| `page` | int | Page number (0-indexed) |
| `page_size` | int | Results per page (default: 100) |

**Response schema:**
```json
{
  "findings": [
    {
      "id": 12345,
      "check_id": "python.lang.security.audit.dangerous-eval",
      "severity": "HIGH",
      "confidence": "HIGH",
      "message": "Detected use of eval(). This can allow arbitrary code execution.",
      "path": "src/utils/parser.py",
      "line": 42,
      "fixable": true,
      "cwe": "CWE-95",
      "triage_state": "fixing",
      "ref": "main",
      "created_at": "2026-01-15T09:00:00Z",
      "syntactic_id": "abc123...",
      "match_based_id": "def456..."
    }
  ]
}
```

**Pagination:**
- Code and Supply Chain findings use **offset-based** pagination: `page` (0-indexed) + `page_size`
- Secrets findings use **cursor-based** pagination: `cursor` (opaque string) + `limit`
- Dependency endpoints use **mixed** pagination (JSON body with `page_size`, response includes `cursor`)

**Deduplication warning:** Without `dedup=true`, the API returns non-deduplicated findings, which can be significantly higher than UI counts. Always use `dedup=true` for consistency with the Semgrep AppSec Platform UI.

#### Bulk Triage Findings

```
POST /api/v1/deployments/{deployment_slug}/triage
Authorization: Bearer {token}
Content-Type: application/json
```

**Request Body:**
```json
{
  "issue_type": "sast",
  "issue_ids": [12345, 67890],
  "new_triage_state": "fixed",
  "new_note": "Fixed via automated remediation by yellow-semgrep plugin"
}
```

**Request Body (alternative -- filter-based selection):**
```json
{
  "issue_type": "sast",
  "new_triage_state": "ignored",
  "new_triage_reason": "False positive confirmed by manual review",
  "repos": ["backend-api"],
  "severity": "LOW"
}
```

**Parameters:**

| Field | Type | Required | Description |
|---|---|---|---|
| `issue_type` | string | Yes | `"sast"` or `"sca"` |
| `issue_ids` | int[] | No* | Explicit list of finding IDs to triage |
| `new_triage_state` | string | No** | Target state: `open`, `reviewing`, `fixing`, `ignored`, `fixed` |
| `new_note` | string | No** | Note to attach to findings |
| `new_triage_reason` | string | Conditional | Required when `new_triage_state=ignored` |

\* Either `issue_ids` or filter parameters must be provided.
\** At least one of `new_triage_state` or `new_note` is required.

**Response:**
```json
{
  "succeeded": [
    {
      "issue_ids": [12345, 67890],
      "external_slug": "...",
      "ticket_id": 0,
      "ticket_url": "..."
    }
  ],
  "failed": [
    {
      "error": "Finding not found",
      "issue_ids": [99999]
    }
  ],
  "skipped": [
    {
      "reason": "Already in target state",
      "issue_ids": [11111]
    }
  ]
}
```

#### List Projects

```
GET /api/v1/orgs/{org_id}/projects
Authorization: Bearer {token}

Response:
{
  "projects": [
    {
      "id": "proj_123",
      "name": "backend-api",
      "provider": "github",
      "url": "https://github.com/company/backend-api"
    }
  ]
}
```

#### List Scans

```
GET /api/v1/orgs/{org_id}/scans
Authorization: Bearer {token}

Response:
{
  "scans": [
    {
      "id": "scan_456",
      "project_id": "proj_123",
      "started_at": "2025-10-13T09:00:00Z",
      "status": "success",
      "findings_count": 24
    }
  ]
}
```

### Triage State Model

| State | Meaning | Assignable via API? | Set Automatically? |
|---|---|---|---|
| `open` | New or reopened, needs triage | Yes | Yes (on new detection) |
| `reviewing` | Under investigation | Yes | No |
| `fixing` | Scheduled for remediation ("to fix") | Yes | No |
| `ignored` | Deprioritized or false positive | Yes (requires `new_triage_reason`) | No |
| `fixed` | Remediated, no longer present in code | Yes | Yes (auto-set when finding disappears on re-scan) |
| `provisionally_ignored` | AI-flagged as likely false positive | No (Semgrep Assistant only) | Yes |

**Triage state propagation:** During full scans, findings previously triaged on another branch automatically receive the same triage state on the current branch. This does NOT apply to diff-aware scans.

**MCP vs REST API status mapping:**

| MCP `status` parameter | REST API `triage_state` | Meaning |
|---|---|---|
| `ISSUE_TAB_OPEN` | `open` | Untriaged findings |
| `ISSUE_TAB_REVIEWING` | `reviewing` | Under review |
| `ISSUE_TAB_FIXING` | `fixing` | Marked "to fix" |
| `ISSUE_TAB_IGNORED` | `ignored` | Deprioritized |
| `ISSUE_TAB_CLOSED` | `fixed` | Resolved |

### API Documentation

The official OpenAPI/Swagger specification is available at: **https://semgrep.dev/api/v1/docs/**

This provides machine-readable endpoint definitions, parameter descriptions, and response schemas. The API requires a Team or Enterprise tier account.

---

## 3. Semgrep CLI for Local Verification

### Core Scan Commands

```bash
# Basic scan with auto-detected rules
semgrep scan --config auto

# Scan with a specific ruleset
semgrep scan --config p/security-audit

# Scan with a specific rule by ID
semgrep scan --config r/python.lang.security.audit.dangerous-eval path/to/file.py

# Scan with a local rule file
semgrep scan --config rules/custom-rule.yaml path/to/file.py

# Scan specific files only
semgrep scan --config auto --include "src/auth/*.py"

# Exclude directories
semgrep scan --config auto --exclude "tests/" --exclude "vendor/"

# Don't respect .gitignore
semgrep scan --config auto --no-git-ignore
```

### Output Formats

```bash
# JSON output to stdout
semgrep scan --json

# JSON output to file
semgrep scan --json-output=findings.json

# SARIF format
semgrep scan --sarif

# Multiple output streams simultaneously
semgrep scan --text --output=findings.txt --json-output=findings.json --sarif-output=findings.sarif

# Available formats: text, json, sarif, gitlab-sast, gitlab-secrets, junit-xml, emacs, vim
```

The JSON schema for Semgrep CLI output is defined in the [`semgrep/semgrep-interfaces`](https://github.com/semgrep/semgrep-interfaces/blob/main/semgrep_output_v1.jsonschema) repository.

### Autofix Support

**Rule-level autofix (`fix:` key):**
```yaml
rules:
  - id: use-dict-get
    patterns:
      - pattern: $DICT[$KEY]
    fix: $DICT.get($KEY)
    message: "Use .get() method to avoid a KeyNotFound error"
    languages: [python]
    severity: HIGH
```

**CLI autofix flags:**
```bash
# Apply autofixes in place (MODIFIES FILES)
semgrep scan --config auto --autofix

# Dry run: show what would change without modifying
semgrep scan --config auto --autofix --dryrun

# Autofix with specific pattern (command-line rule)
semgrep scan -e '$DICT[$KEY]' --lang=python --replacement '$DICT.get($KEY)'
```

Semgrep uses AST-based autofix (since v0.120.0) rather than text-based replacement, which avoids syntax errors from naive string substitution. The AST approach correctly handles edge cases like empty variadic matches (`$...BEFORE`).

### Verification Strategy

The recommended approach for verifying that a fix resolves a finding:

```bash
# Step 1: Before fix -- capture baseline finding
semgrep scan --config "r/{check_id}" --json path/to/file.py > /tmp/before.json
# Verify: results array should contain the finding

# Step 2: Apply the fix (via Edit tool, --autofix, or LLM-based remediation)

# Step 3: After fix -- re-scan with the SAME rule
semgrep scan --config "r/{check_id}" --json path/to/file.py > /tmp/after.json
# Verify: results array should NOT contain the finding

# Step 4: Check for new findings introduced by the fix
semgrep scan --config auto --json path/to/file.py > /tmp/full-rescan.json
# Verify: no new findings at the modified lines
```

### Key CLI Flags Reference

| Flag | Purpose |
|---|---|
| `--config`, `-c`, `-f` | Rule source: `auto`, `p/ruleset`, `r/rule-id`, path to YAML |
| `--json` | Output in JSON format |
| `--json-output=FILE` | Write JSON output to file |
| `--autofix` | Apply rule-defined fixes in place |
| `--dryrun` | With `--autofix`, show changes without applying |
| `--include GLOB` | Only scan files matching pattern |
| `--exclude GLOB` | Skip files matching pattern |
| `--severity LEVEL` | Filter by severity: `ERROR`, `WARNING`, `INFO` |
| `--no-git-ignore` | Don't respect `.gitignore` |
| `-j N`, `--jobs N` | Number of parallel jobs |
| `--max-memory MB` | Memory limit for scanning |
| `--timeout SEC` | Per-rule timeout |
| `--metrics off` | Disable anonymous metrics collection |
| `--test` | Run rule tests |
| `--debug` | Enable debug output |

### Performance Considerations

- Semgrep now uses `uv` instead of `pipenv` for package management (Jan 2026)
- The `-j`/`--jobs` flag controls parallelism; Semgrep suggests starting values based on CPU count
- In `--debug` mode, Semgrep warns if job count exceeds available CPUs
- `semgrep ci` no longer applies autofixes locally even if the platform toggle is enabled (Jan 2026)

---

## 4. Automated Code Remediation Best Practices

### Industry Approaches

**GitHub Copilot Autofix:**
- Generates fixes per individual CodeQL alert
- Creates a dedicated branch and PR per fix (e.g., `alert-autofix-1`)
- Does NOT batch multiple vulnerabilities into one PR
- Post-merge: scans the fixed main branch to verify closure
- Coverage: ~29% of alerts can be auto-fixed

**Snyk Code Fix / Cycode:**
- Triggers single-issue workflows (e.g., updating one vulnerable dependency via PR)
- Enriches detections with execution paths and compensating controls before triggering
- Automated testing + reporting in CI/CD post-fix

**Semgrep's Own Autofix:**
- Rule authors include a `fix:` key with metavariable-based replacement
- Semgrep Assistant can suggest AI-powered autofix code snippets for true positives
- Autofixes are available in PR/MR comments for developer review
- Minimum autofix confidence level is configurable in platform settings
- If many new issues are found in a scan, Assistant auto-triage and autofix may not run on every issue

### Design Principles

**1. Per-finding remediation, not batch:**
- Each fix should target a single finding to minimize blast radius
- Individual commits enable per-fix revert via `git revert`
- Batching multiple fixes into one changeset increases risk of conflicts and makes rollback harder

**2. Deterministic-first strategy:**
- Try the rule's built-in `fix:` autofix first (high confidence, AST-based)
- Fall back to LLM-based remediation only when no autofix exists
- Clearly label which fixes are deterministic vs LLM-generated

**3. Validation pipeline:**

| Stage | Action |
|---|---|
| Pre-validation | Fetch finding details, read affected file, understand vulnerability context |
| Fix generation | Try `semgrep --autofix --dryrun` first; spawn LLM fixer if no autofix |
| Post-validation (rule) | Re-scan with the same rule to confirm finding is resolved |
| Post-validation (full) | Full scan of modified file to check for newly introduced findings |
| Post-validation (tests) | Run existing test suite to detect regressions |
| Human review | Present diff + verification results; require explicit approval |

**4. Guardrails:**
- Never auto-merge or auto-commit -- always require human approval
- Limit scope to the specific finding; minimize diff surface
- Show proposed changes as a diff before applying
- Verify fix resolves the finding via re-scan BEFORE updating triage state
- Skip findings in auto-generated code, vendored dependencies, or test fixtures
- Log all actions with finding ID, rule ID, file path, and fix description

**5. Rollback:**
- Each fix on its own git commit for easy `git revert`
- Preview/dry-run mode as the default
- Git stash as a safety net before applying changes
- Confirmation step via `AskUserQuestion` before every destructive operation

**6. Confidence scoring:**

| Confidence Level | Source | Approach |
|---|---|---|
| High | Rule `fix:` key (deterministic, AST-based) | Apply with user confirmation |
| Medium | Semgrep Assistant autofix suggestion | Apply with user review of diff |
| Low | LLM-generated remediation | Apply with detailed review, test verification required |

### Anti-patterns to Avoid

- Applying fixes without re-scanning to verify resolution
- Updating triage state to "fixed" before confirming the finding is actually gone
- Modifying files outside the scope of the finding (especially unrelated imports or dependencies)
- Running `--autofix` without `--dryrun` first on files with uncommitted changes
- Batching many fixes and committing them all at once (makes bisecting and reverting impossible)
- Trusting LLM-generated fixes for security-critical code without human review

---

## 5. Yellow-Plugins Architecture Conventions

### Monorepo Structure

From analysis of the local monorepo at `/home/kinginyellow/projects/yellow-plugins/`:

```
yellow-plugins/
  plugins/            # Installable plugins
    yellow-ci/        # Reference: CI diagnosis plugin
    yellow-debt/      # Reference: tech debt audit plugin
    yellow-chatprd/   # Reference: ChatPRD MCP integration
    yellow-devin/     # Reference: Devin AI delegation
    yellow-research/  # Reference: multi-source research
    yellow-review/
    yellow-morph/
    yellow-linear/
    yellow-ruvector/
    yellow-browser-test/
    gt-workflow/
  packages/           # TypeScript workspace packages (domain, infrastructure, cli)
  schemas/            # JSON schemas for marketplace and plugin validation
  scripts/            # Validation/versioning/release scripts
  tests/integration/  # Cross-package integration tests (Vitest)
  docs/               # Operational guides, contracts, architecture notes
```

### Plugin Directory Structure Pattern

Every plugin follows this canonical structure (derived from yellow-ci, yellow-debt, yellow-chatprd):

```
plugins/yellow-{name}/
  .claude-plugin/
    plugin.json           # Manifest: name, version, mcpServers, metadata
  commands/
    {namespace}/          # Namespace matches plugin prefix
      {command-name}.md   # One markdown file per slash command
  agents/
    {namespace}/          # Grouped by functional area
      {agent-name}.md     # Agent definition with frontmatter
  skills/
    {skill-name}/
      SKILL.md            # Skill definition
      references/         # Reference data files loaded by skill
        {ref-name}.md
  hooks/
    hooks.json            # Hook configuration (reference copy)
    scripts/
      session-start.sh    # SessionStart hook script
  tests/
    *.bats                # Bats tests for hooks and shell scripts
  CLAUDE.md               # Plugin documentation (loaded as system context)
  README.md               # User-facing documentation
  package.json            # { name, version, private: true, description }
```

### Plugin Manifest (`plugin.json`)

Pattern from yellow-research (MCP-heavy plugin):

```json
{
  "name": "yellow-research",
  "version": "1.1.0",
  "description": "Deep research plugin with Perplexity, Tavily, EXA...",
  "author": {
    "name": "KingInYellows",
    "url": "https://github.com/KingInYellows"
  },
  "homepage": "https://github.com/KingInYellows/yellow-plugins#yellow-research",
  "repository": "https://github.com/KingInYellows/yellow-plugins",
  "license": "MIT",
  "keywords": ["research", "mcp"],
  "mcpServers": {
    "perplexity": {
      "command": "npx",
      "args": ["-y", "@perplexity-ai/mcp-server@0.8.2"],
      "env": {
        "PERPLEXITY_API_KEY": "${PERPLEXITY_API_KEY}"
      }
    },
    "tavily": {
      "command": "npx",
      "args": ["-y", "tavily-mcp@0.2.17"],
      "env": { "TAVILY_API_KEY": "${TAVILY_API_KEY}" }
    }
  }
}
```

Pattern from yellow-devin (HTTP MCP servers):

```json
{
  "mcpServers": {
    "deepwiki": {
      "type": "http",
      "url": "https://mcp.deepwiki.com/mcp"
    },
    "devin": {
      "type": "http",
      "url": "https://mcp.devin.ai/mcp"
    }
  }
}
```

### Command Frontmatter Pattern

From `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/commands/ci/diagnose.md`:

```markdown
---
name: ci:diagnose
description: "Diagnose CI failure and suggest fixes..."
argument-hint: '[run-id] [--repo owner/name]'
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - AskUserQuestion
  - Task
model: sonnet
---
```

Key conventions:
- `name` uses `{namespace}:{command}` format
- `description` is a natural language trigger description
- `argument-hint` shows usage pattern
- `allowed-tools` is an explicit allowlist of tools the command can use
- `model` specifies the Claude model (e.g., `sonnet`, or omit for default)
- Command body contains step-by-step instructions in markdown

### Agent Frontmatter Pattern

From `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/agents/ci/failure-analyst.md`:

```markdown
---
name: failure-analyst
description: "CI failure diagnosis specialist..."
model: inherit
color: red
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - AskUserQuestion
  - Task
---

<examples>
<example>
Context: User notices CI failed.
user: "My CI build failed with exit code 137"
assistant: "Exit code 137 indicates OOM (F01)."
<commentary>CI failure analyst triggered.</commentary>
</example>
</examples>

You are a CI failure diagnosis specialist...
```

Key conventions:
- `model: inherit` inherits from the spawning command/agent
- `color` provides visual distinction in the UI
- Examples section uses `<examples>` XML tags
- Agent body defines role, responsibilities, and step-by-step process
- Agents reference skills with: "Follow conventions in the `{skill-name}` skill"

### Skill Pattern

From `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/skills/ci-conventions/SKILL.md`:

```markdown
---
name: ci-conventions
description: "Shared conventions for CI analysis..."
user-invokable: false
---

# CI Conventions for Yellow-CI Plugin

## When This Skill Loads
Loaded automatically by:
- `failure-analyst` agent during log analysis
- `/ci:diagnose` command when processing run IDs

## Core Failure Categories
...
```

Key conventions:
- `user-invokable: false` for internal reference skills
- `user-invokable: true` for skills users can invoke directly
- Skills contain reference data, validation rules, and shared conventions
- `references/` subdirectory holds supplementary reference files

### Hooks Pattern

From `/home/kinginyellow/projects/yellow-plugins/plugins/yellow-ci/hooks/hooks.json`:

```json
{
  "_comment": "REFERENCE ONLY -- not loaded by Claude Code. Authoritative hook config is in .claude-plugin/plugin.json.",
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/session-start.sh",
            "timeout": 3
          }
        ]
      }
    ]
  }
}
```

### Critical Rules from AGENTS.md

1. **Content fencing:** Wrap all untrusted input in `--- begin/end ---` delimiters with `(reference only)` annotation
2. **No credentials in output:** Never include credential values; use `--- redacted credential at line N ---`
3. **Skill tool inclusion:** If an agent references a skill by name, include `Skill` in `allowed-tools`
4. **MCP tool name qualification:** Use fully-qualified names: `mcp__plugin_{pluginName}_{serverName}__{toolName}`
5. **Conventional commits:** `feat(scope): ...`, `fix(scope): ...`, `docs: ...`
6. **Prettier formatting:** 2 spaces, single quotes, semicolons, LF endings, 80-char width
7. **Testing:** Vitest for TypeScript (`*.test.ts`), Bats for shell (`*.bats`)

---

## 6. Recommended Plugin Architecture

### Plugin Name: `yellow-semgrep`

### Design Philosophy

Hybrid MCP + REST API + CLI plugin. The Semgrep MCP server handles findings retrieval and code scanning. Direct `curl` calls to the REST API handle triage state updates (the MCP server does not expose triage mutation tools). The Semgrep CLI handles local post-fix verification.

### Three-Layer Architecture

Following the yellow-ci pattern:

1. **Reactive** -- Fetch findings marked "fixing" (to-fix), display status dashboard
2. **Remediation** -- Apply fixes (deterministic autofix first, LLM fallback), verify via re-scan
3. **Lifecycle** -- Update triage state via REST API after successful fix + verification

### Proposed Directory Layout

```
plugins/yellow-semgrep/
  .claude-plugin/
    plugin.json
  commands/
    semgrep/
      setup.md              # /semgrep:setup
      status.md             # /semgrep:status
      scan.md               # /semgrep:scan
      fix.md                # /semgrep:fix [finding-id]
      fix-batch.md          # /semgrep:fix-batch
  agents/
    semgrep/
      finding-fixer.md      # Specialist for applying code fixes
      scan-verifier.md      # Post-fix verification specialist
  skills/
    semgrep-conventions/
      SKILL.md              # Shared conventions, validation, state mappings
      references/
        triage-states.md    # Triage state reference
        fix-patterns.md     # Common fix patterns by rule category
        api-reference.md    # REST API quick reference
  hooks/
    hooks.json
    scripts/
      session-start.sh      # Check for pending "fixing" findings
  tests/
    setup.bats
    session-start.bats
  CLAUDE.md
  README.md
  package.json
```

### MCP Server Registration

```json
{
  "name": "yellow-semgrep",
  "version": "0.1.0",
  "description": "Semgrep security finding remediation -- fetch, fix, and verify 'to fix' findings from the Semgrep AppSec Platform",
  "author": {
    "name": "KingInYellows",
    "url": "https://github.com/KingInYellows"
  },
  "homepage": "https://github.com/KingInYellows/yellow-plugins#yellow-semgrep",
  "repository": "https://github.com/KingInYellows/yellow-plugins",
  "license": "MIT",
  "keywords": ["semgrep", "security", "sast", "remediation", "mcp"],
  "mcpServers": {
    "semgrep": {
      "command": "uvx",
      "args": ["semgrep-mcp"],
      "env": {
        "SEMGREP_APP_TOKEN": "${SEMGREP_APP_TOKEN}"
      }
    }
  }
}
```

### Commands (5)

| Command | Purpose | Key Tools |
|---|---|---|
| `/semgrep:setup` | Validate `SEMGREP_APP_TOKEN`, test MCP connection, detect deployment slug, cache config | Bash, AskUserQuestion |
| `/semgrep:status` | Dashboard of findings by triage state, severity, repo | Bash (curl), MCP semgrep_findings |
| `/semgrep:scan` | Local scan of current workspace, compare with platform findings | Bash (semgrep), MCP semgrep_scan |
| `/semgrep:fix [finding-id]` | Fix single finding: fetch, analyze, fix, verify, update triage | Bash, Read, Edit, Write, Grep, Glob, AskUserQuestion, Task, Skill |
| `/semgrep:fix-batch` | Fix multiple "to-fix" findings with human approval between each | Bash, Read, Edit, Write, Task, AskUserQuestion, Skill |

### Agents (2)

| Agent | Role | Spawned By |
|---|---|---|
| `finding-fixer` | Applies code fixes for specific findings. Receives finding context (rule, message, code location, CWE). Tries deterministic autofix first (`semgrep --autofix --dryrun`), falls back to LLM-based fix generation. Shows diff for approval. | `/semgrep:fix`, `/semgrep:fix-batch` |
| `scan-verifier` | Post-fix verification. Re-runs the specific rule against the fixed file. Compares before/after results. Reports pass/fail with evidence. | `finding-fixer` agent |

### Skills (1)

| Skill | Purpose |
|---|---|
| `semgrep-conventions` | Shared validation rules, triage state mappings (MCP vs REST API), API endpoint patterns, fix strategy decision tree (autofix vs LLM), severity/confidence mappings, content fencing rules |

### Hooks (1)

| Hook | Trigger | Purpose | Budget |
|---|---|---|---|
| `session-start.sh` | SessionStart | Check for pending "fixing" findings via REST API; inject reminder count | 3 seconds |

### MCP Tool Name Convention

When referencing Semgrep MCP tools from agent/command bodies, use fully-qualified names:

```
mcp__plugin_yellow-semgrep_semgrep__semgrep_findings
mcp__plugin_yellow-semgrep_semgrep__semgrep_scan
mcp__plugin_yellow-semgrep_semgrep__semgrep_scan_with_custom_rule
mcp__plugin_yellow-semgrep_semgrep__get_abstract_syntax_tree
mcp__plugin_yellow-semgrep_semgrep__semgrep_rule_schema
mcp__plugin_yellow-semgrep_semgrep__get_supported_languages
mcp__plugin_yellow-semgrep_semgrep__semgrep_scan_supply_chain
mcp__plugin_yellow-semgrep_semgrep__semgrep_whoami
```

### Data Flow: `/semgrep:fix [finding-id]`

```
/semgrep:fix [finding-id]
  |
  v
1. VALIDATE prerequisites
   - Check SEMGREP_APP_TOKEN is set (never echo its value)
   - Load cached deployment slug from .claude/yellow-semgrep.local.md
   - Detect current repo name from git remote
  |
  v
2. FETCH finding details
   - Via MCP: mcp__plugin_yellow-semgrep_semgrep__semgrep_findings
     (status=ISSUE_TAB_FIXING, repos=[current_repo])
   - OR via REST API: GET /api/v1/deployments/{slug}/findings?triage_state=fixing
   - Fence response in --- begin/end semgrep-api-response (reference only) ---
  |
  v
3. READ the affected file at finding.path, around finding.line
   - Show surrounding context (20 lines before/after)
   - Identify the vulnerable code pattern
  |
  v
4. DETERMINE fix strategy
   |
   |-- Check if rule has deterministic autofix:
   |   semgrep scan --config "r/{check_id}" --autofix --dryrun path/file
   |   |
   |   |-- If autofix available and produces clean diff:
   |   |   Show diff to user, ask approval via AskUserQuestion
   |   |
   |   |-- If no autofix OR autofix produces invalid code:
   |       Spawn finding-fixer agent with context:
   |       { check_id, severity, message, cwe, path, line, code_context }
   |
  v
5. APPLY fix
   - Deterministic: semgrep scan --autofix (after approval)
   - LLM-based: Edit tool with targeted replacement
  |
  v
6. VERIFY fix (spawn scan-verifier agent)
   - Re-scan: semgrep scan --config "r/{check_id}" --json path/file
   - If finding STILL PRESENT: report failure, offer to revert (git checkout path/file)
   - If finding GONE: proceed
   - Full rescan: semgrep scan --config auto --json path/file
   - If NEW findings introduced: warn user, show new findings
  |
  v
7. RUN tests (if detectable)
   - Detect test framework from package.json, pyproject.toml, etc.
   - Run relevant test file(s) for the modified file
   - If tests fail: warn user, offer to revert
  |
  v
8. ASK user for final approval via AskUserQuestion
   - Show: finding details, applied fix diff, verification result, test result
   - Options: approve, revert, skip
  |
  v
9. UPDATE triage state (only after approval)
   curl -s -X POST -H "Authorization: Bearer $SEMGREP_APP_TOKEN" \
     -H "Content-Type: application/json" \
     "https://semgrep.dev/api/v1/deployments/${SLUG}/triage" \
     -d '{"issue_type":"sast","issue_ids":[FINDING_ID],"new_triage_state":"fixed",
          "new_note":"Fixed via yellow-semgrep plugin"}'
  |
  v
10. REPORT outcome
    - Finding ID, rule ID, file path, fix type (autofix/LLM), verification status
```

### REST API Calls (via Bash/curl)

```bash
# List findings with triage_state=fixing ("to fix")
curl -s -H "Authorization: Bearer $SEMGREP_APP_TOKEN" \
  "https://semgrep.dev/api/v1/deployments/${SLUG}/findings?triage_state=fixing&dedup=true&page=0&page_size=50"

# Validate token
curl -s -H "Authorization: Bearer $SEMGREP_APP_TOKEN" \
  "https://semgrep.dev/api/v1/me"

# List deployments (to discover slug)
curl -s -H "Authorization: Bearer $SEMGREP_APP_TOKEN" \
  "https://semgrep.dev/api/v1/deployments"

# Bulk triage after fix
curl -s -X POST -H "Authorization: Bearer $SEMGREP_APP_TOKEN" \
  -H "Content-Type: application/json" \
  "https://semgrep.dev/api/v1/deployments/${SLUG}/triage" \
  -d "$(jq -n --argjson id "$FINDING_ID" '{
    issue_type: "sast",
    issue_ids: [$id],
    new_triage_state: "fixed",
    new_note: "Fixed via yellow-semgrep plugin automated remediation"
  }')"
```

### Safety Guardrails

1. **Human-in-the-loop:** Every fix requires `AskUserQuestion` approval before committing
2. **Dry-run default:** `--dryrun` flag shows proposed diff before applying
3. **Verify before triage update:** Only mark "fixed" after re-scan confirms finding is gone
4. **Single-file scope:** Never modify files not mentioned in the finding
5. **Git safety:** Each fix is a separate commit for easy `git revert`
6. **Rate limiting:** Respect 60 req/min API limit; add 1s delay between API calls in batch mode
7. **Content fencing:** All API responses wrapped in `--- begin/end semgrep-api-response (reference only) ---`
8. **Deduplication:** Always pass `dedup=true` when listing findings via REST API
9. **Branch filtering:** Always specify `ref=main` (or detected primary branch) to match UI
10. **Autofix preference:** Try deterministic `fix:` key autofixes before LLM remediation
11. **Credential protection:** Never echo/log `SEMGREP_APP_TOKEN`; redact with pattern `sgp_[a-zA-Z0-9]*/***REDACTED***`
12. **Error logging:** All failures logged with `[yellow-semgrep] Error: ...` prefix

### Cross-Plugin Dependencies

| Dependency | Purpose | Required? |
|---|---|---|
| `yellow-morph` | `mcp__plugin_yellow-morph_morph__edit_file` for applying fixes in large files (>200 lines) where built-in Edit accuracy degrades | Optional (enhances fix accuracy) |
| `yellow-linear` | Create Linear issues from findings that cannot be auto-fixed | Optional |
| `yellow-ci` | Re-run CI pipeline after fixes to verify no regressions | Optional |

### Known Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| MCP `semgrep_findings` uses internal API with different enum values | Status filtering may not map cleanly to REST API | Maintain explicit mapping table in `semgrep-conventions` skill |
| MCP server has no triage mutation tools | Cannot update triage state via MCP | Use REST API directly via `curl` in Bash |
| REST API rate limit (60 req/min) | Batch operations may be throttled | Add delays; batch triage calls by grouping `issue_ids` |
| `semgrep_findings` requires `repos` parameter | Must detect current repo name | Parse from `git remote get-url origin`; cache in local config |
| `semgrep --autofix` modifies files in place | Could lose uncommitted work | Check `git status` clean before applying; use `git stash` as safety net |
| LLM-generated fixes may introduce new vulnerabilities | Fix creates worse problem | Mandatory full re-scan after every fix; never auto-commit |
| Token may lack `Web API` scope | REST API returns 404 | Validate on setup via `GET /api/v1/me`; provide clear error message |
| Findings may reference files not in working directory | Fix cannot be applied | Validate file exists locally before attempting fix; skip with warning |

### Configuration File

Cached in `.claude/yellow-semgrep.local.md` (following yellow-ci pattern):

```yaml
---
schema: 1
deployment_slug: my-org
primary_branch: main
default_severity_filter:
  - SEVERITY_CRITICAL
  - SEVERITY_HIGH
batch_limit: 10
auto_commit: false
---
```

---

## Sources

- [Semgrep MCP Server - GitHub](https://github.com/semgrep/mcp) -- tool catalog, installation, configuration, README
- [Semgrep MCP Server source (server.py)](https://github.com/semgrep/semgrep/blob/develop/cli/src/semgrep/mcp/server.py) -- exact tool function signatures, internal API endpoint
- [Semgrep MCP Server source (models.py)](https://github.com/semgrep/semgrep/blob/develop/cli/src/semgrep/mcp/models.py) -- data models
- [Semgrep API v1 Docs (OpenAPI)](https://semgrep.dev/api/v1/docs/) -- REST API endpoints, triage operations
- [Semgrep AppSec Platform API docs](https://semgrep.dev/docs/semgrep-appsec-platform/semgrep-api) -- API overview, tier requirements
- [Semgrep CLI Reference](https://semgrep.dev/docs/cli-reference) -- all CLI flags and options
- [Semgrep Customize Scans](https://semgrep.dev/docs/customize-semgrep-ce) -- config, include/exclude, output formats
- [Semgrep Rule Syntax](https://semgrep.dev/docs/writing-rules/rule-syntax) -- `fix:` key, autofix patterns
- [Semgrep Triage & Remediation](https://semgrep.dev/docs/semgrep-code/triage-remediation) -- triage states, bulk triage
- [Semgrep Pagination KB](https://semgrep.dev/docs/kb/integrations/pagination) -- offset vs cursor pagination
- [Semgrep Findings Count KB](https://semgrep.dev/docs/kb/semgrep-appsec-platform/findings-count-differ-api-platform) -- dedup parameter
- [Semgrep API Token Scope KB](https://semgrep.dev/docs/kb/semgrep-appsec-platform/api-404-token-scope) -- Web API vs CI scope
- [Semgrep January 2026 Release Notes](https://semgrep.dev/docs/release-notes/january-2026) -- MCP transport changes
- [Semgrep September 2025 Release Notes](https://semgrep.dev/docs/release-notes/september-2025) -- MCP server moved to main repo
- [Semgrep Autofix Blog Post](https://semgrep.dev/blog/2022/autofixing-code-with-semgrep) -- AST-based autofix
- [Semgrep MCP Integration Docs](https://semgrep.dev/docs/mcp) -- official MCP integration guide
- [Semgrep Assistant Overview](https://semgrep.dev/docs/semgrep-assistant/overview) -- AI autofix, auto-triage
- [PyPI semgrep-mcp](https://pypi.org/project/semgrep-mcp/) -- package metadata
- [semgrep-interfaces JSON Schema](https://github.com/semgrep/semgrep-interfaces/blob/main/semgrep_output_v1.jsonschema) -- CLI output schema
- [Cycode Automated Remediation](https://cycode.com/blog/automated-remediation-everything-you-need-to-know/) -- remediation best practices
- [Kusari Remediation Automation](https://www.kusari.dev/learning-center/remediation-automation) -- guardrails and validation
- Local monorepo analysis: yellow-ci, yellow-debt, yellow-chatprd, yellow-devin, yellow-research plugin patterns
