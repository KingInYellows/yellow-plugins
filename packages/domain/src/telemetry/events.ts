/**
 * @yellow-plugins/domain - Telemetry Event Contracts
 *
 * Typed event definitions for telemetry instrumentation across compatibility,
 * cache, and install paths. Supports JSON logs, Prometheus metrics, and OTEL spans.
 *
 * Part of Task I2.T5: Telemetry & Audit Logging Integration
 *
 * Architecture References:
 * - Section 3.0: Observability Rulebook
 * - Section 3.5: Observability Fabric
 * - Section 3.11: Operational Metrics Catalog
 * - CRIT-004: Lifecycle script consent logging
 * - CRIT-008: Telemetry correlation
 * - CRIT-021: CI runtime budget validation
 */

/**
 * Base telemetry event with required correlation fields.
 */
export interface BaseTelemetryEvent {
  /** Correlation ID for this command invocation */
  correlationId: string;
  /** Transaction ID for multi-step operations */
  transactionId?: string;
  /** ISO timestamp of event occurrence */
  timestamp: string;
  /** Event type discriminator */
  eventType: string;
}

/**
 * Install operation telemetry event.
 */
export interface InstallEvent extends BaseTelemetryEvent {
  eventType: 'install' | 'update' | 'rollback';
  /** Plugin identifier */
  pluginId: string;
  /** Target version */
  version: string;
  /** Operation result */
  success: boolean;
  /** Duration in milliseconds */
  durationMs: number;
  /** Installation step where operation completed or failed */
  step: 'VALIDATE' | 'STAGE' | 'EXTRACT' | 'LIFECYCLE_PRE' | 'PROMOTE' | 'ACTIVATE' | 'TELEMETRY';
  /** Error code if failed */
  errorCode?: string;
  /** Whether cache was hit */
  cacheHit?: boolean;
  /** Cache size in bytes */
  cacheSizeBytes?: number;
  /** Number of entries evicted */
  evictedCount?: number;
  /** Whether lifecycle consent was required */
  lifecycleConsentRequired?: boolean;
  /** Whether lifecycle consent was granted */
  lifecycleConsentGranted?: boolean;
}

/**
 * Cache operation telemetry event.
 */
export interface CacheEvent extends BaseTelemetryEvent {
  eventType: 'cache_hit' | 'cache_miss' | 'cache_evict' | 'cache_promote' | 'cache_stage';
  /** Plugin identifier */
  pluginId: string;
  /** Plugin version */
  version: string;
  /** Transaction ID if part of install flow */
  transactionId?: string;
  /** Cache path */
  cachePath?: string;
  /** Size in bytes */
  sizeBytes?: number;
  /** Checksum for integrity validation */
  checksum?: string;
  /** Number of entries evicted (for eviction events) */
  evictedCount?: number;
  /** Whether entry is pinned */
  pinned?: boolean;
}

/**
 * Compatibility check telemetry event.
 */
export interface CompatibilityEvent extends BaseTelemetryEvent {
  eventType: 'compatibility_check';
  /** Plugin identifier */
  pluginId: string;
  /** Plugin version */
  version: string;
  /** Compatibility verdict */
  verdict: 'ALLOW' | 'WARN' | 'DENY';
  /** Reason for verdict */
  reason?: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Policy rules evaluated */
  rulesEvaluated?: number;
  /** Policy rule that triggered the verdict */
  triggeredRule?: string;
}

/**
 * Schema validation telemetry event.
 */
export interface ValidationEvent extends BaseTelemetryEvent {
  eventType: 'schema_validation';
  /** Schema type being validated */
  schemaType: 'marketplace' | 'plugin' | 'registry' | 'contract';
  /** Validation result */
  success: boolean;
  /** Number of validation errors */
  errorCount: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Plugin ID if validating plugin manifest */
  pluginId?: string;
  /** Error codes if failed */
  errorCodes?: string[];
}

/**
 * Lifecycle script consent event (audit-level).
 */
export interface LifecycleConsentEvent extends BaseTelemetryEvent {
  eventType: 'lifecycle_consent';
  /** Plugin identifier */
  pluginId: string;
  /** Plugin version */
  version: string;
  /** SHA-256 digest of the script shown to user */
  scriptDigest: string;
  /** Typed confirmation string */
  confirmationString?: string;
  /** Whether consent was granted */
  consentGranted: boolean;
  /** Timestamp of consent decision */
  consentTimestamp: string;
  /** Script exit code if executed */
  exitCode?: number;
  /** Script execution duration if executed */
  executionDurationMs?: number;
}

/**
 * Feature flag usage event.
 */
export interface FeatureFlagEvent extends BaseTelemetryEvent {
  eventType: 'feature_flag_usage';
  /** Flag name */
  flagName: string;
  /** Flag value (enabled/disabled) */
  enabled: boolean;
  /** Command context */
  command: string;
}

/**
 * CI validation event.
 */
export interface CIValidationEvent extends BaseTelemetryEvent {
  eventType: 'ci_validation';
  /** Validation stage */
  stage: 'lint' | 'unit_test' | 'integration_test' | 'schema_validation' | 'build';
  /** Success status */
  success: boolean;
  /** Duration in milliseconds */
  durationMs: number;
  /** Error count */
  errorCount?: number;
  /** Warning count */
  warningCount?: number;
}

/**
 * Registry operation event.
 */
export interface RegistryEvent extends BaseTelemetryEvent {
  eventType: 'registry_read' | 'registry_write' | 'registry_backup' | 'registry_corruption';
  /** Operation result */
  success: boolean;
  /** Duration in milliseconds */
  durationMs: number;
  /** Error code if failed */
  errorCode?: string;
  /** Number of plugins in registry */
  pluginCount?: number;
  /** Registry size in bytes */
  sizeBytes?: number;
  /** Whether backup was created */
  backupCreated?: boolean;
}

/**
 * Command execution event.
 */
export interface CommandEvent extends BaseTelemetryEvent {
  eventType: 'command_start' | 'command_complete' | 'command_error';
  /** Command name */
  command: string;
  /** Command arguments (sanitized) */
  args?: Record<string, unknown>;
  /** Success status */
  success?: boolean;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Error code if failed */
  errorCode?: string;
}

/**
 * Union type of all telemetry events.
 */
export type TelemetryEvent =
  | InstallEvent
  | CacheEvent
  | CompatibilityEvent
  | ValidationEvent
  | LifecycleConsentEvent
  | FeatureFlagEvent
  | CIValidationEvent
  | RegistryEvent
  | CommandEvent;

/**
 * Telemetry event emitter interface.
 */
export interface ITelemetryEmitter {
  /**
   * Emit a telemetry event.
   */
  emit(event: TelemetryEvent): void;

  /**
   * Flush any buffered events.
   */
  flush(): Promise<void>;
}

/**
 * Factory functions for creating telemetry events with defaults.
 */
export class TelemetryEventFactory {
  /**
   * Create an install event.
   */
  static createInstallEvent(params: Omit<InstallEvent, 'timestamp'>): InstallEvent {
    return {
      ...params,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Create a cache event.
   */
  static createCacheEvent(params: Omit<CacheEvent, 'timestamp'>): CacheEvent {
    return {
      ...params,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Create a compatibility event.
   */
  static createCompatibilityEvent(
    params: Omit<CompatibilityEvent, 'timestamp' | 'eventType'>
  ): CompatibilityEvent {
    return {
      ...params,
      eventType: 'compatibility_check',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Create a validation event.
   */
  static createValidationEvent(
    params: Omit<ValidationEvent, 'timestamp' | 'eventType'>
  ): ValidationEvent {
    return {
      ...params,
      eventType: 'schema_validation',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Create a lifecycle consent event (audit-level).
   */
  static createLifecycleConsentEvent(
    params: Omit<LifecycleConsentEvent, 'timestamp' | 'eventType'>
  ): LifecycleConsentEvent {
    return {
      ...params,
      eventType: 'lifecycle_consent',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Create a feature flag event.
   */
  static createFeatureFlagEvent(
    params: Omit<FeatureFlagEvent, 'timestamp' | 'eventType'>
  ): FeatureFlagEvent {
    return {
      ...params,
      eventType: 'feature_flag_usage',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Create a CI validation event.
   */
  static createCIValidationEvent(
    params: Omit<CIValidationEvent, 'timestamp' | 'eventType'>
  ): CIValidationEvent {
    return {
      ...params,
      eventType: 'ci_validation',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Create a registry event.
   */
  static createRegistryEvent(params: Omit<RegistryEvent, 'timestamp'>): RegistryEvent {
    return {
      ...params,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Create a command event.
   */
  static createCommandEvent(params: Omit<CommandEvent, 'timestamp'>): CommandEvent {
    return {
      ...params,
      timestamp: new Date().toISOString(),
    };
  }
}
