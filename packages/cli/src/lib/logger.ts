/**
 * @yellow-plugins/cli - Structured Logger
 *
 * Dual-channel logger implementation:
 * - JSON structured logs to stdout for automation
 * - Human-readable logs to stderr for interactive use
 *
 * Includes correlation IDs for tracing operations across the system.
 *
 * Part of Task I1.T4: CLI command manifest and structured logging
 */

import { randomUUID } from 'node:crypto';

import type { ILogger, LoggerContext, LogLevel, StructuredLogEntry } from '../types/logging.js';
import { LogLevel as LogLevelEnum } from '../types/logging.js';

/**
 * Implementation of the ILogger interface providing dual-channel output.
 */
class Logger implements ILogger {
  private readonly context: LoggerContext;
  private readonly verbose: boolean;

  constructor(context: LoggerContext, verbose = false) {
    this.context = { ...context };
    this.verbose = verbose;
  }

  debug(message: string, data?: Record<string, unknown>): void {
    if (this.verbose) {
      this.log(LogLevelEnum.DEBUG, message, data);
    }
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevelEnum.INFO, message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevelEnum.WARN, message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevelEnum.ERROR, message, data);
  }

  audit(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevelEnum.AUDIT, message, data);
  }

  timing(message: string, durationMs: number, data?: Record<string, unknown>): void {
    this.log(LogLevelEnum.INFO, message, { ...data, durationMs });
  }

  getContext(): Readonly<LoggerContext> {
    return this.context;
  }

  /**
   * Core logging method that writes to both channels.
   */
  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    // Structured log entry for automation (stdout)
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      command: this.context.command,
      correlationId: this.context.correlationId,
      message,
    };

    if (data) {
      const normalizedData: Record<string, unknown> = { ...data };

      if ('durationMs' in normalizedData) {
        const durationValue = normalizedData['durationMs'];
        if (typeof durationValue === 'number') {
          entry.durationMs = durationValue;
        }
        delete normalizedData['durationMs'];
      }

      if ('errorCode' in normalizedData) {
        const errorCodeValue = normalizedData['errorCode'];
        if (typeof errorCodeValue === 'string') {
          entry.errorCode = errorCodeValue;
        }
        delete normalizedData['errorCode'];
      }

      if (Object.keys(normalizedData).length > 0) {
        entry.data = normalizedData;
      }
    }

    // Write JSON to stdout
    process.stdout.write(JSON.stringify(entry) + '\n');

    // Human-readable format for stderr
    const humanReadable = this.formatHumanReadable(level, message, data);
    process.stderr.write(humanReadable + '\n');
  }

  /**
   * Format a log entry for human consumption.
   */
  private formatHumanReadable(level: LogLevel, message: string, data?: Record<string, unknown>): string {
    const levelPrefix = this.getLevelPrefix(level);
    const correlationShort = this.context.correlationId.substring(0, 8);
    let output = `${levelPrefix} [${this.context.command}:${correlationShort}] ${message}`;

    // Add duration if present
    if (data && 'durationMs' in data) {
      output += ` (${data['durationMs']}ms)`;
    }

    // Add error code if present
    if (data && 'errorCode' in data) {
      output += ` [${data['errorCode']}]`;
    }

    return output;
  }

  /**
   * Get a colored/prefixed log level indicator.
   */
  private getLevelPrefix(level: LogLevel): string {
    const prefixes: Record<LogLevel, string> = {
      [LogLevelEnum.DEBUG]: '[DEBUG]',
      [LogLevelEnum.INFO]: '[INFO ]',
      [LogLevelEnum.WARN]: '[WARN ]',
      [LogLevelEnum.ERROR]: '[ERROR]',
      [LogLevelEnum.AUDIT]: '[AUDIT]',
    };
    return prefixes[level] || '[INFO ]';
  }
}

/**
 * Create a logger instance for a command.
 */
export function createLogger(command: string, verbose = false): ILogger {
  const context: LoggerContext = {
    command,
    correlationId: randomUUID(),
  };
  return new Logger(context, verbose);
}

/**
 * Create a logger with a specific correlation ID (for testing or resuming operations).
 */
export function createLoggerWithContext(context: LoggerContext, verbose = false): ILogger {
  return new Logger(context, verbose);
}

/**
 * Generate a new correlation ID.
 */
export function generateCorrelationId(): string {
  return randomUUID();
}
