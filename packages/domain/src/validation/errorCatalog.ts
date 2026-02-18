/**
 * Error catalog mapping validation errors to specification error codes
 *
 * This module provides centralized error definitions that align with
 * the specification's Section 4 error scenarios and CRIT fixes from Appendix F.
 * Each error includes traceability to specification requirements.
 *
 * @module domain/validation/errorCatalog
 */

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
      resolution: this.getSchemaErrorResolution(keyword),
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
      resolution: `Please ensure your system meets the requirement: ${requirement} ${expected}`,
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
      resolution: this.getInstallationErrorResolution(code),
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
      resolution:
        'Verify marketplace configuration and plugin references are valid',
    };
  }

  /**
   * Get resolution guidance for schema errors
   */
  private static getSchemaErrorResolution(keyword: string): string {
    const resolutionMap: Record<string, string> = {
      required: 'Add the required field to your manifest file',
      pattern:
        'Ensure the field value matches the expected pattern (e.g., kebab-case, semver)',
      format: 'Verify the field format (e.g., valid URI, email, or date-time)',
      type: 'Correct the field type (e.g., string, number, array, object)',
      enum: 'Use one of the allowed values from the enumeration',
      minLength:
        'Increase the field value length to meet the minimum requirement',
      maxLength: 'Reduce the field value length to meet the maximum limit',
      additionalProperties:
        'Remove unexpected fields not defined in the schema',
    };

    return (
      resolutionMap[keyword] ||
      'Review the schema documentation and correct the field value'
    );
  }

  /**
   * Get resolution guidance for installation errors
   */
  private static getInstallationErrorResolution(code: string): string {
    const resolutionMap: Record<string, string> = {
      [ERROR_CODES.INST_PLUGIN_NOT_FOUND]:
        'Verify the plugin ID exists in the marketplace',
      [ERROR_CODES.INST_VERSION_NOT_FOUND]:
        'Check available versions with "/plugin info <id>"',
      [ERROR_CODES.INST_ALREADY_INSTALLED]:
        'Use "/plugin update <id>" to update or "/plugin uninstall <id>" to reinstall',
      [ERROR_CODES.INST_DOWNLOAD_FAILED]:
        'Check network connectivity and marketplace URL',
      [ERROR_CODES.INST_CHECKSUM_MISMATCH]:
        'Re-download the plugin or report a security issue to the maintainer',
      [ERROR_CODES.INST_LIFECYCLE_FAILED]:
        'Review lifecycle script logs and fix any errors',
      [ERROR_CODES.INST_MANIFEST_INVALID]:
        'Contact plugin maintainer to fix the manifest file',
    };

    return (
      resolutionMap[code] || 'Review installation logs and retry the operation'
    );
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
    [ErrorCategory.LIFECYCLE]: [], // Lifecycle errors are mapped to INSTALLATION category
  };
}
