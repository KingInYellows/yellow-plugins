/**
 * Error catalog mapping validation errors to specification error codes
 *
 * This module provides centralized error definitions that align with
 * the specification's Section 4 error scenarios and CRIT fixes from Appendix F.
 * Each error includes traceability to specification requirements.
 *
 * @module domain/validation/errorCatalog
 */

// DIST_* codes (R14): the first category sourced from a plain-JSON registry
// consumed by both this ESM stack (import, resolveJsonModule + the "with"
// import-attribute below) and the CJS scripts/ stack (readFileSync +
// JSON.parse — see scripts/lint-error-codes.js's CATALOG_FILES scan)
// instead of inline literals + the string-concatenation workaround the
// SOL_*/PLAN_*/SETUP_* categories below still use. Like those categories,
// the codes are referenced by name in error messages, not emitted literally
// by any script yet — scripts/validate-codex.js does not read this registry.
import distCodes from './error-codes.json' with { type: 'json' };
import {
  ErrorCategory,
  ErrorSeverity,
  type DomainValidationError,
} from './types.js';

/**
 * Error code registry aligned with specification Section 4
 *
 * Format: ERROR-{CATEGORY}-{NUMBER}
 * - SCHEMA: JSON Schema validation failures
 * - COMPAT: Compatibility/dependency issues
 * - INST: Installation/lifecycle errors
 * - DISC: Discovery/marketplace errors
 * - PERM: Permission/security errors
 * - NET: Network/connectivity errors
 */
export const ERROR_CODES = {
  // Schema Validation Errors (SCHEMA)
  SCHEMA_INVALID_JSON: 'ERROR-SCHEMA-001',
  SCHEMA_MISSING_FIELD: 'ERROR-SCHEMA-002',
  SCHEMA_INVALID_FORMAT: 'ERROR-SCHEMA-003',
  SCHEMA_INVALID_TYPE: 'ERROR-SCHEMA-004',
  SCHEMA_CONSTRAINT_VIOLATION: 'ERROR-SCHEMA-005',
  SCHEMA_ADDITIONAL_PROPERTY: 'ERROR-SCHEMA-006',
  SCHEMA_ENUM_MISMATCH: 'ERROR-SCHEMA-007',

  // Compatibility Errors (COMPAT) - CRIT-002b, CRIT-005
  COMPAT_CLAUDE_VERSION_LOW: 'ERROR-COMPAT-001',
  COMPAT_CLAUDE_VERSION_HIGH: 'ERROR-COMPAT-002',
  COMPAT_NODE_VERSION_LOW: 'ERROR-COMPAT-003',
  COMPAT_NODE_VERSION_HIGH: 'ERROR-COMPAT-007',
  COMPAT_PLATFORM_UNSUPPORTED: 'ERROR-COMPAT-004',
  COMPAT_ARCH_UNSUPPORTED: 'ERROR-COMPAT-005',
  COMPAT_PLUGIN_DEPENDENCY_MISSING: 'ERROR-COMPAT-006',

  // Installation Errors (INST) - CRIT-007, CRIT-010
  INST_PLUGIN_NOT_FOUND: 'ERROR-INST-001',
  INST_VERSION_NOT_FOUND: 'ERROR-INST-002',
  INST_ALREADY_INSTALLED: 'ERROR-INST-003',
  INST_DOWNLOAD_FAILED: 'ERROR-INST-004',
  INST_CHECKSUM_MISMATCH: 'ERROR-INST-005',
  INST_LIFECYCLE_FAILED: 'ERROR-INST-006',
  INST_MANIFEST_INVALID: 'ERROR-INST-007',

  // Discovery Errors (DISC) - CRIT-008
  DISC_MARKETPLACE_NOT_FOUND: 'ERROR-DISC-001',
  DISC_MARKETPLACE_INVALID: 'ERROR-DISC-002',
  DISC_PLUGIN_REFERENCE_BROKEN: 'ERROR-DISC-003',
  DISC_CHANGELOG_UNAVAILABLE: 'ERROR-DISC-004',

  // Permission Errors (PERM) - CRIT-012
  PERM_MISSING_DECLARATION: 'ERROR-PERM-001',
  PERM_SCOPE_INVALID: 'ERROR-PERM-002',
  PERM_CONSENT_REQUIRED: 'ERROR-PERM-003',

  // Network Errors (NET) - CRIT-011
  NET_FETCH_FAILED: 'ERROR-NET-001',
  NET_TIMEOUT: 'ERROR-NET-002',
  NET_PARSE_FAILED: 'ERROR-NET-003',

  // Solution-doc Errors (SOL) — scripts/validate-solutions.js gates new
  // docs/solutions/ entries on slug uniqueness and required frontmatter.
  // See CONTRIBUTING.md "Solution Docs" and the policy plan at
  // plans/solution-doc-git-workflow.md.
  //
  // Note on the consumer wiring gap: scripts/validate-solutions.js does NOT
  // import these constants directly. The catalog package is ESM
  // (packages/domain/package.json: "type": "module") and scripts/*.js are
  // CJS — a direct `require()` of the built ESM output fails. Until the
  // scripts/ layer migrates to ESM (a tooling-level concern out of scope
  // for the solution-doc validator), the validator assembles the same
  // strings via concatenation per MEMORY.md's documented fallback. These
  // entries serve as the single source of truth that the validator's
  // assembled strings MUST match; any change here requires a paired edit
  // in scripts/validate-solutions.js (the constants SOL/SOL_SLUG_COLLISION/
  // SOL_FRONTMATTER).
  SOL_SLUG_COLLISION: 'ERROR-SOL-001',
  SOL_FRONTMATTER_INVALID: 'ERROR-SOL-002',

  // Plan Lifecycle Errors (PLAN) — scripts/validate-plans.js gates plans
  // newly added or modified under `plans/complete/` against stray unchecked
  // checkboxes (`- [ ]`). Catches premature archival where the plan was moved
  // before its task list was complete. See plans/plan-lifecycle-management.md
  // for the rationale and the PR-diff-scoping decision.
  //
  // Same ESM/CJS bridge constraint as SOL_*: the catalog is ESM, scripts/ is
  // CJS, so scripts/validate-plans.js cannot `require()` these constants
  // directly. The validator assembles the same strings via concatenation
  // (`const PLAN = 'ERROR-' + 'PLAN'; const PLAN_001 = PLAN + '-001';`) and
  // `scripts/lint-error-codes.js` (CODE_PATTERN /ERROR-[A-Z]+-\d+/g) does not
  // detect split-string assembly. Any change to the entry below requires a
  // paired edit in scripts/validate-plans.js (the constants PLAN /
  // PLAN_STRAY_CHECKBOX).
  PLAN_STRAY_CHECKBOX: 'ERROR-PLAN-001',

  // Setup Coverage Errors (SETUP) — scripts/validate-setup-all.js gates
  // plugins/yellow-core/commands/setup/all.md (and its Steps 1.6/1.7
  // reference file) against the marketplace: marker-delimited sections must
  // exist, plugin coverage/order must match marketplace.json, the delegated
  // command map must match real command files, the Step 1.5 ToolSearch probe
  // list must be internally consistent, the credential-status plugin list
  // must match hooks that actually emit credential-status, and the
  // illustrative dashboard example must list every marketplace plugin.
  //
  // Same ESM/CJS bridge constraint as SOL_*/PLAN_*: the catalog is ESM,
  // scripts/ is CJS, so scripts/validate-setup-all.js cannot `require()`
  // these constants directly. The validator assembles the same strings via
  // concatenation (`const SETUP = 'ERROR-' + 'SETUP';`) and
  // `scripts/lint-error-codes.js` (CODE_PATTERN /ERROR-[A-Z]+-\d+/g) does
  // not detect split-string assembly. Any change to the entries below
  // requires a paired edit in scripts/validate-setup-all.js (the SETUP_*
  // constants).
  SETUP_MISSING_MARKERS: 'ERROR-SETUP-001',
  SETUP_COVERAGE_DRIFT: 'ERROR-SETUP-002',
  SETUP_DELEGATION_DRIFT: 'ERROR-SETUP-003',
  SETUP_ORDER_DRIFT: 'ERROR-SETUP-004',
  SETUP_PROBE_LIST_DRIFT: 'ERROR-SETUP-005',
  SETUP_CREDENTIAL_LIST_DRIFT: 'ERROR-SETUP-006',
  SETUP_EXAMPLE_DRIFT: 'ERROR-SETUP-007',

  // Codex Distribution Errors (DIST) — see ./error-codes.json for the
  // canonical values; re-exported here (not redeclared as literals) so
  // scripts/lint-error-codes.js's CATALOG must scan error-codes.json too
  // (this file's raw text no longer contains the literal ERROR-DIST-*
  // strings once they move behind an import — see
  // docs/solutions/code-quality/raw-text-scan-inline-to-import-blind-spot.md).
  ...distCodes,
} as const;

/**
 * Error factory functions for creating structured validation errors
 */
export class ValidationErrorFactory {
  /**
   * Create a schema validation error
   *
   * @param path - JSON path to the invalid field
   * @param message - Human-readable error message
   * @param keyword - JSON Schema keyword that failed (e.g., 'required', 'pattern')
   * @param context - Additional context for debugging
   * @returns Structured validation error
   */
  static schemaError(
    path: string,
    message: string,
    keyword: string,
    context?: Record<string, unknown>
  ): DomainValidationError {
    // Map JSON Schema keywords to error codes
    const codeMap: Record<string, string> = {
      required: ERROR_CODES.SCHEMA_MISSING_FIELD,
      pattern: ERROR_CODES.SCHEMA_INVALID_FORMAT,
      format: ERROR_CODES.SCHEMA_INVALID_FORMAT,
      type: ERROR_CODES.SCHEMA_INVALID_TYPE,
      enum: ERROR_CODES.SCHEMA_ENUM_MISMATCH,
      minLength: ERROR_CODES.SCHEMA_CONSTRAINT_VIOLATION,
      maxLength: ERROR_CODES.SCHEMA_CONSTRAINT_VIOLATION,
      minimum: ERROR_CODES.SCHEMA_CONSTRAINT_VIOLATION,
      maximum: ERROR_CODES.SCHEMA_CONSTRAINT_VIOLATION,
      additionalProperties: ERROR_CODES.SCHEMA_ADDITIONAL_PROPERTY,
    };

    const code = codeMap[keyword] || ERROR_CODES.SCHEMA_CONSTRAINT_VIOLATION;

    return {
      code,
      message,
      path,
      severity: ErrorSeverity.ERROR,
      category: ErrorCategory.SCHEMA_VALIDATION,
      context: { keyword, ...context },
      specReference: 'FR-001, FR-002',
    };
  }

  /**
   * Create a compatibility error
   *
   * @param requirement - Compatibility requirement that failed
   * @param actual - Actual system value
   * @param expected - Expected value or range
   * @returns Structured validation error
   */
  static compatibilityError(
    requirement: string,
    actual: string,
    expected: string
  ): DomainValidationError {
    const codeMap: Record<string, { code: string; crit: string }> = {
      claudeCodeMin: {
        code: ERROR_CODES.COMPAT_CLAUDE_VERSION_LOW,
        crit: 'CRIT-002b',
      },
      claudeCodeMax: {
        code: ERROR_CODES.COMPAT_CLAUDE_VERSION_HIGH,
        crit: 'CRIT-002b',
      },
      nodeMin: {
        code: ERROR_CODES.COMPAT_NODE_VERSION_LOW,
        crit: 'CRIT-005',
      },
      nodeMax: {
        code: ERROR_CODES.COMPAT_NODE_VERSION_HIGH,
        crit: 'CRIT-019',
      },
      os: {
        code: ERROR_CODES.COMPAT_PLATFORM_UNSUPPORTED,
        crit: 'CRIT-005',
      },
      arch: {
        code: ERROR_CODES.COMPAT_ARCH_UNSUPPORTED,
        crit: 'CRIT-005',
      },
      pluginDependencies: {
        code: ERROR_CODES.COMPAT_PLUGIN_DEPENDENCY_MISSING,
        crit: 'CRIT-005',
      },
    };

    const errorInfo = codeMap[requirement] || {
      code: ERROR_CODES.COMPAT_CLAUDE_VERSION_LOW,
      crit: 'CRIT-002b',
    };

    return {
      code: errorInfo.code,
      message: `Compatibility check failed for ${requirement}: expected ${expected}, got ${actual}`,
      path: `/compatibility/${requirement}`,
      severity: ErrorSeverity.ERROR,
      category: ErrorCategory.COMPATIBILITY,
      context: { requirement, actual, expected },
      specReference: errorInfo.crit,
    };
  }

  /**
   * Create an installation error
   *
   * @param code - Specific installation error code
   * @param message - Human-readable error message
   * @param pluginId - Plugin identifier
   * @param context - Additional context
   * @returns Structured validation error
   */
  static installationError(
    code: string,
    message: string,
    pluginId: string,
    context?: Record<string, unknown>
  ): DomainValidationError {
    return {
      code,
      message,
      path: `/plugins/${pluginId}`,
      severity: ErrorSeverity.ERROR,
      category: ErrorCategory.INSTALLATION,
      context: { pluginId, ...context },
      specReference: 'CRIT-007, CRIT-010',
    };
  }

  /**
   * Create a discovery error
   *
   * @param code - Specific discovery error code
   * @param message - Human-readable error message
   * @param context - Additional context
   * @returns Structured validation error
   */
  static discoveryError(
    code: string,
    message: string,
    context?: Record<string, unknown>
  ): DomainValidationError {
    return {
      code,
      message,
      path: '/marketplace',
      severity: ErrorSeverity.ERROR,
      category: ErrorCategory.DISCOVERY,
      context,
      specReference: 'CRIT-008',
    };
  }
}

/**
 * Get all error codes grouped by category
 *
 * @returns Object mapping categories to error code arrays
 */
export function getErrorCodesByCategory(): Record<ErrorCategory, string[]> {
  return {
    [ErrorCategory.SCHEMA_VALIDATION]: [
      ERROR_CODES.SCHEMA_INVALID_JSON,
      ERROR_CODES.SCHEMA_MISSING_FIELD,
      ERROR_CODES.SCHEMA_INVALID_FORMAT,
      ERROR_CODES.SCHEMA_INVALID_TYPE,
      ERROR_CODES.SCHEMA_CONSTRAINT_VIOLATION,
      ERROR_CODES.SCHEMA_ADDITIONAL_PROPERTY,
      ERROR_CODES.SCHEMA_ENUM_MISMATCH,
    ],
    [ErrorCategory.COMPATIBILITY]: [
      ERROR_CODES.COMPAT_CLAUDE_VERSION_LOW,
      ERROR_CODES.COMPAT_CLAUDE_VERSION_HIGH,
      ERROR_CODES.COMPAT_NODE_VERSION_LOW,
      ERROR_CODES.COMPAT_NODE_VERSION_HIGH,
      ERROR_CODES.COMPAT_PLATFORM_UNSUPPORTED,
      ERROR_CODES.COMPAT_ARCH_UNSUPPORTED,
      ERROR_CODES.COMPAT_PLUGIN_DEPENDENCY_MISSING,
    ],
    [ErrorCategory.INSTALLATION]: [
      ERROR_CODES.INST_PLUGIN_NOT_FOUND,
      ERROR_CODES.INST_VERSION_NOT_FOUND,
      ERROR_CODES.INST_ALREADY_INSTALLED,
      ERROR_CODES.INST_DOWNLOAD_FAILED,
      ERROR_CODES.INST_CHECKSUM_MISMATCH,
      ERROR_CODES.INST_LIFECYCLE_FAILED,
      ERROR_CODES.INST_MANIFEST_INVALID,
    ],
    [ErrorCategory.DISCOVERY]: [
      ERROR_CODES.DISC_MARKETPLACE_NOT_FOUND,
      ERROR_CODES.DISC_MARKETPLACE_INVALID,
      ERROR_CODES.DISC_PLUGIN_REFERENCE_BROKEN,
      ERROR_CODES.DISC_CHANGELOG_UNAVAILABLE,
    ],
    [ErrorCategory.PERMISSION]: [
      ERROR_CODES.PERM_MISSING_DECLARATION,
      ERROR_CODES.PERM_SCOPE_INVALID,
      ERROR_CODES.PERM_CONSENT_REQUIRED,
    ],
    [ErrorCategory.NETWORK]: [
      ERROR_CODES.NET_FETCH_FAILED,
      ERROR_CODES.NET_TIMEOUT,
      ERROR_CODES.NET_PARSE_FAILED,
    ],
    [ErrorCategory.SOLUTION_DOCS]: [
      ERROR_CODES.SOL_SLUG_COLLISION,
      ERROR_CODES.SOL_FRONTMATTER_INVALID,
    ],
    [ErrorCategory.PLAN_LIFECYCLE]: [
      ERROR_CODES.PLAN_STRAY_CHECKBOX,
    ],
    [ErrorCategory.SETUP_COVERAGE]: [
      ERROR_CODES.SETUP_MISSING_MARKERS,
      ERROR_CODES.SETUP_COVERAGE_DRIFT,
      ERROR_CODES.SETUP_DELEGATION_DRIFT,
      ERROR_CODES.SETUP_ORDER_DRIFT,
      ERROR_CODES.SETUP_PROBE_LIST_DRIFT,
      ERROR_CODES.SETUP_CREDENTIAL_LIST_DRIFT,
      ERROR_CODES.SETUP_EXAMPLE_DRIFT,
    ],
    [ErrorCategory.DISTRIBUTION]: [
      ERROR_CODES.DIST_MALFORMED_CATALOG_SOURCE,
      ERROR_CODES.DIST_INVENTORY_ORDER_MISMATCH,
      ERROR_CODES.DIST_GENERATED_ARTIFACT_DRIFT,
      ERROR_CODES.DIST_INVALID_GENERATED_MANIFEST,
      ERROR_CODES.DIST_UNSUPPORTED_SURFACE_EXPOSED,
      ERROR_CODES.DIST_HOOK_CONTRACT_VIOLATION,
      ERROR_CODES.DIST_WINDOWS_PATH_PORTABILITY_FAILURE,
      ERROR_CODES.DIST_MCP_AUTH_CONFIG_FAILURE,
    ],
  };
}
