/**
 * @yellow-plugins/cli - Metrics Command
 *
 * Exports Prometheus-format metrics snapshot for monitoring and observability.
 * Provides operational visibility into command durations, cache performance,
 * validation failures, and system health.
 *
 * Part of Task I2.T5: Telemetry & Audit Logging Integration
 *
 * Architecture References:
 * - Section 3.5: Observability Fabric
 * - Section 3.11: Operational Metrics Catalog
 * - CRIT-010: Telemetry instrumentation
 * - CRIT-021: CI runtime budget validation
 */

import { globalPrometheusExporter } from '@yellow-plugins/infrastructure';

import type { BaseCommandOptions, CommandHandler, CommandMetadata } from '../types/commands.js';

interface MetricsOptions extends BaseCommandOptions {
  format?: 'prometheus' | 'json';
  reset?: boolean;
}

const metricsHandler: CommandHandler<MetricsOptions> = async (options, context) => {
  const { logger } = context;
  const startTime = Date.now();

  try {
    logger.info('Metrics snapshot requested', {
      format: options.format || 'prometheus',
      reset: options.reset || false,
    });

    // Export metrics in requested format
    if (options.format === 'json') {
      // Export as JSON for programmatic consumption
      const prometheusText = globalPrometheusExporter.export();
      const jsonMetrics = parsePrometheusToJson(prometheusText);

      logger.info('Metrics snapshot generated', {
        format: 'json',
        metricCount: Object.keys(jsonMetrics).length,
      });

      return {
        success: true,
        status: 'success',
        message: 'Metrics snapshot exported successfully',
        data: {
          format: 'json',
          metrics: jsonMetrics,
          timestamp: new Date().toISOString(),
        },
      };
    } else {
      // Default: Prometheus text format
      const prometheusText = globalPrometheusExporter.export();

      // Output to stdout for scraping (bypass logger to avoid JSON wrapper)
      process.stdout.write('\n' + prometheusText + '\n');

      logger.info('Metrics snapshot generated', {
        format: 'prometheus',
        sizeBytes: prometheusText.length,
      });

      // Reset metrics if requested
      if (options.reset) {
        globalPrometheusExporter.reset();
        logger.info('Metrics reset after export');
      }

      const durationMs = Date.now() - startTime;

      logger.timing('Metrics command completed', durationMs);

      return {
        success: true,
        status: 'success',
        message: 'Metrics snapshot exported successfully',
        data: {
          format: 'prometheus',
          sizeBytes: prometheusText.length,
          reset: options.reset || false,
          durationMs,
        },
      };
    }
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.error('Failed to export metrics', {
      errorCode: 'ERR-METRICS-001',
      error: (error as Error).message,
      durationMs,
    });

    return {
      success: false,
      status: 'error',
      message: `Failed to export metrics: ${(error as Error).message}`,
      error: {
        code: 'ERR-METRICS-001',
        message: (error as Error).message,
        details: error,
      },
    };
  }
};

export const metricsCommand: CommandMetadata<MetricsOptions> = {
  name: 'metrics',
  aliases: ['stats', 'telemetry'],
  description: 'Export metrics snapshot for monitoring and observability',
  usage: 'plugin metrics [--format <fmt>] [--reset]',
  requiredFlags: [],
  specAnchors: ['CRIT-010', 'CRIT-021', '3-5-observability-fabric', '3-11-operational-metrics-catalog'],
  errorCodes: ['ERR-METRICS-001'],
  examples: [
    {
      command: 'plugin metrics',
      description: 'Export metrics in Prometheus text format',
    },
    {
      command: 'plugin metrics --format json',
      description: 'Export metrics as JSON for programmatic consumption',
    },
    {
      command: 'plugin metrics --reset',
      description: 'Export metrics and reset counters to zero',
    },
  ],
  handler: metricsHandler,
  builder: (yargs) => {
    return yargs
      .option('format', {
        describe: 'Output format for metrics',
        type: 'string',
        choices: ['prometheus', 'json'],
        default: 'prometheus',
        alias: 'f',
      })
      .option('reset', {
        describe: 'Reset metrics after export',
        type: 'boolean',
        default: false,
        alias: 'r',
      });
  },
};

/**
 * Parse Prometheus text format into JSON structure.
 * Simplified parser for basic counter/gauge/histogram metrics.
 */
interface ParsedMetricValue {
  labels: Record<string, string>;
  value: number;
  suffix: string | null;
}

interface ParsedMetric {
  type: string;
  help?: string;
  values: ParsedMetricValue[];
}

function parsePrometheusToJson(prometheusText: string): Record<string, ParsedMetric> {
  const lines = prometheusText.split('\n');
  const metrics: Record<string, ParsedMetric> = {};

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments (except TYPE/HELP)
    if (!trimmed || (trimmed.startsWith('#') && !trimmed.includes('TYPE') && !trimmed.includes('HELP'))) {
      continue;
    }

    // Parse TYPE comment
    if (trimmed.startsWith('# TYPE ')) {
      const match = trimmed.match(/# TYPE (\S+) (\S+)/);
      if (match) {
        const [, metricName, metricType] = match;
        if (!metrics[metricName]) {
          metrics[metricName] = { type: metricType, values: [] };
        } else {
          metrics[metricName].type = metricType;
        }
      }
      continue;
    }

    // Parse HELP comment
    if (trimmed.startsWith('# HELP ')) {
      const match = trimmed.match(/# HELP (\S+) (.+)/);
      if (match) {
        const [, metricName, help] = match;
        if (!metrics[metricName]) {
          metrics[metricName] = { type: 'unknown', values: [], help };
        } else {
          metrics[metricName].help = help;
        }
      }
      continue;
    }

    // Parse metric line
    const metricMatch = trimmed.match(/^(\S+?)(\{[^}]+\})?\s+(\S+)$/);
    if (metricMatch) {
      const metricName = metricMatch[1];
      const labelsStr = metricMatch[2] || '';
      const value = metricMatch[3];

      // Parse labels
      const labels: Record<string, string> = {};
      if (labelsStr) {
        const labelMatches = Array.from(labelsStr.matchAll(/(\w+)="([^"]+)"/g));
        for (const labelMatch of labelMatches) {
          labels[labelMatch[1]] = labelMatch[2];
        }
      }

      // Find base metric name (strip _bucket, _sum, _count suffixes)
      let baseMetricName = metricName;
      if (metricName.endsWith('_bucket') || metricName.endsWith('_sum') || metricName.endsWith('_count')) {
        baseMetricName = metricName.replace(/_(bucket|sum|count)$/, '');
      }

      if (!metrics[baseMetricName]) {
        metrics[baseMetricName] = { type: 'unknown', values: [] };
      }

      metrics[baseMetricName].values.push({
        labels,
        value: parseFloat(value),
        suffix: metricName === baseMetricName ? null : metricName.replace(baseMetricName + '_', ''),
      });
    }
  }

  return metrics;
}
