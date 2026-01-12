/**
 * @yellow-plugins/infrastructure - Prometheus Metrics Exporter
 *
 * In-memory metrics collector with Prometheus-format text export.
 * Tracks counters, histograms, and gauges as defined in Section 3.11.
 *
 * Part of Task I2.T5: Telemetry & Audit Logging Integration
 *
 * Architecture References:
 * - Section 3.5: Observability Fabric
 * - Section 3.11: Operational Metrics Catalog
 * - CRIT-010: Telemetry instrumentation
 * - CRIT-021: CI runtime budget validation
 *
 * Metrics exported:
 * - yellow_plugins_command_duration_ms (histogram)
 * - yellow_plugins_cache_hit_ratio (gauge)
 * - yellow_plugins_schema_validation_failures_total (counter)
 * - yellow_plugins_lifecycle_prompt_declines_total (counter)
 * - yellow_plugins_feature_flag_usage_total (counter)
 * - yellow_plugins_ci_duration_seconds (histogram)
 * - yellow_plugins_cache_size_bytes (gauge)
 * - yellow_plugins_registry_corruption_incidents_total (counter)
 * - yellow_plugins_install_total (counter)
 * - yellow_plugins_rollback_total (counter)
 * - yellow_plugins_cache_evictions_total (counter)
 */

import type {
  CacheEvent,
  CIValidationEvent,
  CommandEvent,
  CompatibilityEvent,
  FeatureFlagEvent,
  InstallEvent,
  LifecycleConsentEvent,
  RegistryEvent,
  TelemetryEvent,
  ValidationEvent,
} from '@yellow-plugins/domain';

/**
 * Counter metric for tracking event counts.
 */
interface Counter {
  type: 'counter';
  value: number;
  labels: Record<string, string>;
}

/**
 * Histogram metric for tracking value distributions.
 */
interface Histogram {
  type: 'histogram';
  sum: number;
  count: number;
  buckets: Map<number, number>; // bucket upper bound -> count
  labels: Record<string, string>;
}

/**
 * Gauge metric for tracking current values.
 */
interface Gauge {
  type: 'gauge';
  value: number;
  labels: Record<string, string>;
}

type Metric = Counter | Histogram | Gauge;

/**
 * Prometheus metrics exporter with in-memory storage.
 */
export class PrometheusExporter {
  private metrics: Map<string, Map<string, Metric>> = new Map();

  // Histogram bucket boundaries (in milliseconds for durations, bytes for sizes)
  private readonly durationBuckets = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, 120000];
  private readonly sizeBuckets = [
    1024, // 1KB
    10240, // 10KB
    102400, // 100KB
    1048576, // 1MB
    10485760, // 10MB
    52428800, // 50MB
    104857600, // 100MB
    524288000, // 500MB
  ];

  /**
   * Record a telemetry event and update corresponding metrics.
   */
  recordEvent(event: TelemetryEvent): void {
    switch (event.eventType) {
      case 'install':
      case 'update':
      case 'rollback':
        this.recordInstallEvent(event);
        break;
      case 'cache_hit':
      case 'cache_miss':
      case 'cache_evict':
      case 'cache_promote':
      case 'cache_stage':
        this.recordCacheEvent(event);
        break;
      case 'compatibility_check':
        this.recordCompatibilityEvent(event);
        break;
      case 'schema_validation':
        this.recordValidationEvent(event);
        break;
      case 'lifecycle_consent':
        this.recordLifecycleConsentEvent(event);
        break;
      case 'feature_flag_usage':
        this.recordFeatureFlagEvent(event);
        break;
      case 'ci_validation':
        this.recordCIValidationEvent(event);
        break;
      case 'registry_read':
      case 'registry_write':
      case 'registry_backup':
      case 'registry_corruption':
        this.recordRegistryEvent(event);
        break;
      case 'command_start':
      case 'command_complete':
      case 'command_error':
        this.recordCommandEvent(event);
        break;
    }
  }

  /**
   * Export metrics in Prometheus text format.
   */
  export(): string {
    const lines: string[] = [];

    // Sort metrics by name for consistent output
    const sortedMetricNames = Array.from(this.metrics.keys()).sort();

    for (const metricName of sortedMetricNames) {
      const metricVariants = this.metrics.get(metricName);
      if (!metricVariants) continue;

      // Determine metric type from first variant
      const firstVariant = Array.from(metricVariants.values())[0];
      if (!firstVariant) continue;

      // Add HELP and TYPE comments
      lines.push(`# HELP ${metricName} ${this.getMetricHelp(metricName)}`);
      lines.push(`# TYPE ${metricName} ${firstVariant.type}`);

      // Add metric lines
      for (const metric of Array.from(metricVariants.values())) {
        if (metric.type === 'counter' || metric.type === 'gauge') {
          lines.push(`${metricName}${this.formatLabels(metric.labels)} ${metric.value}`);
        } else if (metric.type === 'histogram') {
          // Histogram buckets
          for (const [bucket, count] of Array.from(metric.buckets.entries())) {
            const bucketLabels = { ...metric.labels, le: bucket === Infinity ? '+Inf' : bucket.toString() };
            lines.push(`${metricName}_bucket${this.formatLabels(bucketLabels)} ${count}`);
          }
          // Histogram sum and count
          lines.push(`${metricName}_sum${this.formatLabels(metric.labels)} ${metric.sum}`);
          lines.push(`${metricName}_count${this.formatLabels(metric.labels)} ${metric.count}`);
        }
      }

      lines.push(''); // Blank line between metrics
    }

    return lines.join('\n');
  }

  /**
   * Reset all metrics (useful for testing).
   */
  reset(): void {
    this.metrics.clear();
  }

  /**
   * Get current value of a gauge metric.
   */
  getGaugeValue(metricName: string, labels: Record<string, string> = {}): number | undefined {
    const labelKey = this.serializeLabels(labels);
    const metric = this.metrics.get(metricName)?.get(labelKey);
    if (metric?.type === 'gauge') {
      return metric.value;
    }
    return undefined;
  }

  /**
   * Get current value of a counter metric.
   */
  getCounterValue(metricName: string, labels: Record<string, string> = {}): number | undefined {
    const labelKey = this.serializeLabels(labels);
    const metric = this.metrics.get(metricName)?.get(labelKey);
    if (metric?.type === 'counter') {
      return metric.value;
    }
    return undefined;
  }

  // Private helper methods

  private recordInstallEvent(event: InstallEvent): void {
    const labels = { command: event.eventType, status: event.success ? 'success' : 'failure' };

    // Command duration histogram
    this.recordHistogram('yellow_plugins_command_duration_ms', event.durationMs, labels);

    // Install/rollback counters
    if (event.eventType === 'install') {
      this.incrementCounter('yellow_plugins_install_total', labels);
    } else if (event.eventType === 'rollback') {
      this.incrementCounter('yellow_plugins_rollback_total', labels);
    }

    // Cache hit ratio tracking
    if (event.cacheHit !== undefined) {
      const cacheHits = this.getCounterValue('yellow_plugins_cache_hits_total') || 0;
      const cacheMisses = this.getCounterValue('yellow_plugins_cache_misses_total') || 0;
      const total = cacheHits + cacheMisses;
      const ratio = total > 0 ? cacheHits / total : 0;
      this.setGauge('yellow_plugins_cache_hit_ratio', ratio, {});
    }

    // Lifecycle consent tracking
    if (event.lifecycleConsentRequired && !event.lifecycleConsentGranted) {
      this.incrementCounter('yellow_plugins_lifecycle_prompt_declines_total', {
        plugin_id: event.pluginId,
      });
    }
  }

  private recordCacheEvent(event: CacheEvent): void {
    if (event.eventType === 'cache_hit') {
      this.incrementCounter('yellow_plugins_cache_hits_total', {});
    } else if (event.eventType === 'cache_miss') {
      this.incrementCounter('yellow_plugins_cache_misses_total', {});
    } else if (event.eventType === 'cache_evict') {
      this.incrementCounter('yellow_plugins_cache_evictions_total', {
        pinned: event.pinned ? 'true' : 'false',
      });
    }

    // Update cache size gauge if provided
    if (event.sizeBytes !== undefined) {
      this.setGauge('yellow_plugins_cache_size_bytes', event.sizeBytes, {});
    }
  }

  private recordCompatibilityEvent(event: CompatibilityEvent): void {
    this.recordHistogram('yellow_plugins_compatibility_check_duration_ms', event.durationMs, {
      verdict: event.verdict,
    });

    this.incrementCounter('yellow_plugins_compatibility_checks_total', {
      verdict: event.verdict,
    });
  }

  private recordValidationEvent(event: ValidationEvent): void {
    if (!event.success) {
      this.incrementCounter('yellow_plugins_schema_validation_failures_total', {
        schema_type: event.schemaType,
      });
    }

    this.recordHistogram('yellow_plugins_validation_duration_ms', event.durationMs, {
      schema_type: event.schemaType,
      status: event.success ? 'success' : 'failure',
    });
  }

  private recordLifecycleConsentEvent(event: LifecycleConsentEvent): void {
    if (!event.consentGranted) {
      this.incrementCounter('yellow_plugins_lifecycle_prompt_declines_total', {
        plugin_id: event.pluginId,
      });
    }

    if (event.exitCode !== undefined) {
      this.incrementCounter('yellow_plugins_lifecycle_executions_total', {
        plugin_id: event.pluginId,
        exit_code: event.exitCode.toString(),
      });

      if (event.executionDurationMs !== undefined) {
        this.recordHistogram('yellow_plugins_lifecycle_execution_duration_ms', event.executionDurationMs, {
          plugin_id: event.pluginId,
        });
      }
    }
  }

  private recordFeatureFlagEvent(event: FeatureFlagEvent): void {
    this.incrementCounter('yellow_plugins_feature_flag_usage_total', {
      flag_name: event.flagName,
      enabled: event.enabled ? 'true' : 'false',
      command: event.command,
    });
  }

  private recordCIValidationEvent(event: CIValidationEvent): void {
    // Convert milliseconds to seconds for CI duration
    this.recordHistogram('yellow_plugins_ci_duration_seconds', event.durationMs / 1000, {
      stage: event.stage,
      status: event.success ? 'success' : 'failure',
    });

    this.incrementCounter('yellow_plugins_ci_validations_total', {
      stage: event.stage,
      status: event.success ? 'success' : 'failure',
    });
  }

  private recordRegistryEvent(event: RegistryEvent): void {
    if (event.eventType === 'registry_corruption') {
      this.incrementCounter('yellow_plugins_registry_corruption_incidents_total', {});
    }

    this.recordHistogram('yellow_plugins_registry_operation_duration_ms', event.durationMs, {
      operation: event.eventType,
      status: event.success ? 'success' : 'failure',
    });

    if (event.pluginCount !== undefined) {
      this.setGauge('yellow_plugins_registry_plugin_count', event.pluginCount, {});
    }

    if (event.sizeBytes !== undefined) {
      this.setGauge('yellow_plugins_registry_size_bytes', event.sizeBytes, {});
    }
  }

  private recordCommandEvent(event: CommandEvent): void {
    if (event.eventType === 'command_complete' && event.durationMs !== undefined) {
      this.recordHistogram('yellow_plugins_command_duration_ms', event.durationMs, {
        command: event.command,
        status: event.success ? 'success' : 'failure',
      });
    }
  }

  private incrementCounter(metricName: string, labels: Record<string, string>): void {
    const labelKey = this.serializeLabels(labels);
    if (!this.metrics.has(metricName)) {
      this.metrics.set(metricName, new Map());
    }

    const metricVariants = this.metrics.get(metricName)!;
    const existing = metricVariants.get(labelKey) as Counter | undefined;

    if (existing && existing.type === 'counter') {
      existing.value += 1;
    } else {
      metricVariants.set(labelKey, { type: 'counter', value: 1, labels });
    }
  }

  private setGauge(metricName: string, value: number, labels: Record<string, string>): void {
    const labelKey = this.serializeLabels(labels);
    if (!this.metrics.has(metricName)) {
      this.metrics.set(metricName, new Map());
    }

    const metricVariants = this.metrics.get(metricName)!;
    metricVariants.set(labelKey, { type: 'gauge', value, labels });
  }

  private recordHistogram(metricName: string, value: number, labels: Record<string, string>): void {
    const labelKey = this.serializeLabels(labels);
    if (!this.metrics.has(metricName)) {
      this.metrics.set(metricName, new Map());
    }

    const metricVariants = this.metrics.get(metricName)!;
    const existing = metricVariants.get(labelKey) as Histogram | undefined;

    // Determine bucket boundaries based on metric name
    const buckets = metricName.includes('size_bytes') || metricName.includes('cache_size')
      ? this.sizeBuckets
      : this.durationBuckets;

    if (existing && existing.type === 'histogram') {
      existing.sum += value;
      existing.count += 1;
      for (const bucket of buckets) {
        if (value <= bucket) {
          existing.buckets.set(bucket, (existing.buckets.get(bucket) || 0) + 1);
        }
      }
      // +Inf bucket
      existing.buckets.set(Infinity, (existing.buckets.get(Infinity) || 0) + 1);
    } else {
      const bucketMap = new Map<number, number>();
      for (const bucket of buckets) {
        bucketMap.set(bucket, value <= bucket ? 1 : 0);
      }
      bucketMap.set(Infinity, 1); // +Inf bucket always increments

      metricVariants.set(labelKey, {
        type: 'histogram',
        sum: value,
        count: 1,
        buckets: bucketMap,
        labels,
      });
    }
  }

  private serializeLabels(labels: Record<string, string>): string {
    const sortedKeys = Object.keys(labels).sort();
    return sortedKeys.map((key) => `${key}="${labels[key]}"`).join(',');
  }

  private formatLabels(labels: Record<string, string>): string {
    if (Object.keys(labels).length === 0) return '';
    return `{${this.serializeLabels(labels)}}`;
  }

  private getMetricHelp(metricName: string): string {
    const helpTexts: Record<string, string> = {
      yellow_plugins_command_duration_ms: 'Duration of CLI commands in milliseconds',
      yellow_plugins_cache_hit_ratio: 'Ratio of cache hits to total cache accesses',
      yellow_plugins_schema_validation_failures_total: 'Total number of schema validation failures',
      yellow_plugins_lifecycle_prompt_declines_total: 'Total number of declined lifecycle script prompts',
      yellow_plugins_feature_flag_usage_total: 'Total number of feature flag usages',
      yellow_plugins_ci_duration_seconds: 'Duration of CI validation stages in seconds',
      yellow_plugins_cache_size_bytes: 'Current size of the plugin cache in bytes',
      yellow_plugins_registry_corruption_incidents_total: 'Total number of registry corruption incidents',
      yellow_plugins_install_total: 'Total number of plugin installations',
      yellow_plugins_rollback_total: 'Total number of plugin rollbacks',
      yellow_plugins_cache_evictions_total: 'Total number of cache evictions',
      yellow_plugins_cache_hits_total: 'Total number of cache hits',
      yellow_plugins_cache_misses_total: 'Total number of cache misses',
      yellow_plugins_compatibility_check_duration_ms: 'Duration of compatibility checks in milliseconds',
      yellow_plugins_compatibility_checks_total: 'Total number of compatibility checks',
      yellow_plugins_validation_duration_ms: 'Duration of validation operations in milliseconds',
      yellow_plugins_lifecycle_executions_total: 'Total number of lifecycle script executions',
      yellow_plugins_lifecycle_execution_duration_ms: 'Duration of lifecycle script executions in milliseconds',
      yellow_plugins_ci_validations_total: 'Total number of CI validation runs',
      yellow_plugins_registry_operation_duration_ms: 'Duration of registry operations in milliseconds',
      yellow_plugins_registry_plugin_count: 'Current number of plugins in the registry',
      yellow_plugins_registry_size_bytes: 'Current size of the registry file in bytes',
    };

    return helpTexts[metricName] || 'No description available';
  }
}

/**
 * Global singleton instance for convenient access.
 */
export const globalPrometheusExporter = new PrometheusExporter();
