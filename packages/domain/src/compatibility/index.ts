/**
 * Compatibility & Policy Engine - Public API
 *
 * Exports compatibility checking services, contracts, and types for use by
 * CLI and infrastructure packages. Supports deterministic compatibility
 * evaluation with evidence-based verdicts.
 *
 * @module domain/compatibility
 */

// Service contracts
export type {
  ICompatibilityService,
  IHostFingerprintProvider,
} from './contracts.js';

// Core types
export {
  CompatibilityStatus,
  type CompatibilityCheck,
  type CompatibilityVerdict,
  type CompatibilityPolicyOverrides,
  type RegistrySnapshot,
} from './types.js';

// Service implementation
export { CompatibilityService } from './compatibilityService.js';
