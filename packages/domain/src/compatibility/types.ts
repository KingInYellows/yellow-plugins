/**
 * Compatibility & Policy Engine - Type Definitions
 *
 * Defines types for compatibility checking, policy enforcement, and verdict
 * evidence structures. These types support the deterministic evaluation of
 * plugin compatibility with host environments.
 *
 * @module domain/compatibility/types
 */

import type { DomainValidationError } from '../validation/types.js';

/**
 * Compatibility verdict status
 *
 * - compatible: Plugin meets all requirements
 * - warn: Plugin meets minimum requirements but has warnings
 * - block: Plugin fails critical compatibility checks
 */
export enum CompatibilityStatus {
  COMPATIBLE = 'compatible',
  WARN = 'warn',
  BLOCK = 'block',
}

/**
 * Individual compatibility check result
 */
export interface CompatibilityCheck {
  /** Check identifier (e.g., 'claude-version', 'node-min', 'os-platform') */
  id: string;

  /** Check type for grouping */
  type: 'claude-runtime' | 'node-version' | 'os' | 'arch' | 'plugin-conflict';

  /** Check passed/failed status */
  passed: boolean;

  /** Required value or range */
  required: string;

  /** Actual system value */
  actual: string;

  /** Human-readable message */
  message: string;

  /** Associated validation error if check failed */
  error?: DomainValidationError;
}

/**
 * Compatibility verdict with evidence payload
 */
export interface CompatibilityVerdict {
  /** Overall verdict status */
  status: CompatibilityStatus;

  /** All compatibility checks performed */
  checks: CompatibilityCheck[];

  /** Plugin identifier */
  pluginId: string;

  /** Plugin version */
  version: string;

  /** Timestamp of evaluation */
  evaluatedAt: Date;

  /** IDs of conflicting plugins (if any) */
  conflictingPlugins?: string[];

  /** Summary message for CLI display */
  summary: string;
}

/**
 * Installed plugin registry snapshot for conflict detection
 */
export interface RegistrySnapshot {
  /** List of installed plugin IDs */
  installedPlugins: string[];

  /** Mapping of plugin IDs to versions */
  versions?: Record<string, string>;
}

/**
 * Compatibility policy overrides from flags/config
 */
export interface CompatibilityPolicyOverrides {
  /** Skip Claude Code version checks */
  skipClaudeCheck?: boolean;

  /** Skip Node.js version checks */
  skipNodeCheck?: boolean;

  /** Skip OS/arch checks */
  skipPlatformCheck?: boolean;

  /** Allow plugin conflicts (warn instead of block) */
  allowConflicts?: boolean;
}
