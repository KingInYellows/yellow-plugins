/**
 * @yellow-plugins/domain - Uninstall Service Implementation
 *
 * Orchestrates plugin uninstall operations with lifecycle hooks, cache retention,
 * atomic symlink removal, and audit logging.
 *
 * Architecture References:
 * - Section 3.10: Install Transaction Lifecycle (uninstall variant)
 * - Section 6.3: Uninstall Flow UX
 * - CRIT-004 / CRIT-011: Lifecycle consent + failure handling
 * - FR-010: Cache purge and retention policies
 */

import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, rm, lstat, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join, resolve, sep as pathSeparator } from 'node:path';

import type { ICacheService } from '../cache/contracts.js';
import type { Config } from '../config/contracts.js';
import type { IRegistryService } from '../registry/contracts.js';
import type { InstalledPlugin } from '../registry/types.js';

import type {
  CacheRetentionPolicy,
  LifecycleExecutionResult,
  UninstallRequest,
  UninstallResult,
} from './types.js';

interface PluginManifest {
  lifecycle?: {
    uninstall?: string;
  };
}

interface LifecycleScriptInfo {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly digest: string;
  readonly preview: string;
  readonly bytes: number;
}

interface LifecycleExecutionOutcome {
  readonly result: LifecycleExecutionResult;
  readonly stdout?: string;
  readonly stderr?: string;
}

type CacheRetentionSummary = NonNullable<UninstallResult['cacheRetention']>;

const MAX_SCRIPT_PREVIEW_CHARS = 4000;
const AUDIT_DIR_NAME = 'audit';

export class UninstallService {
  private readonly config: Config;
  private readonly cacheService: ICacheService;
  private readonly registryService: IRegistryService;

  constructor(config: Config, cacheService: ICacheService, registryService: IRegistryService) {
    this.config = config;
    this.cacheService = cacheService;
    this.registryService = registryService;
  }

  /**
   * Execute uninstall lifecycle with consent, cache retention, and audit logging.
   */
  async uninstall(request: UninstallRequest): Promise<UninstallResult> {
    const transactionId = this.generateTransactionId();
    const startTime = Date.now();
    const messages: UninstallResult['messages'] = [];

    let plugin: InstalledPlugin | undefined;
    let lifecycleInfo: LifecycleScriptInfo | undefined;
    let lifecycleOutcome: LifecycleExecutionOutcome | undefined;
    let cacheSummary: CacheRetentionSummary | undefined;

    const finalize = async (result: UninstallResult): Promise<UninstallResult> =>
      this.finalizeResult(request, result, {
        plugin,
        lifecycleInfo,
        lifecycleOutcome,
        cacheSummary,
      });

    try {
      messages.push({
        level: 'info',
        message: `Starting uninstallation of ${request.pluginId}`,
        step: 'VALIDATE',
      });

      plugin = await this.registryService.getPlugin(request.pluginId);
      if (!plugin) {
        const failure = this.buildErrorResult(
          transactionId,
          'ERR-UNINSTALL-001',
          `Plugin ${request.pluginId} is not installed`,
          'VALIDATE',
          startTime,
          messages,
          request.correlationId
        );
        return finalize(failure);
      }

      const skipInteractiveGuards = Boolean(request.force || request.dryRun);
      if (!skipInteractiveGuards) {
        if (!request.confirmationToken) {
          return finalize(
            this.buildErrorResult(
              transactionId,
              'ERR-UNINSTALL-CONFIRM',
              'Uninstall confirmation token is required',
              'VALIDATE',
              startTime,
              messages,
              request.correlationId,
              { reason: 'missing-token' }
            )
          );
        }
        if (request.confirmationToken !== request.pluginId) {
          return finalize(
            this.buildErrorResult(
              transactionId,
              'ERR-UNINSTALL-CONFIRM',
              'Confirmation token does not match plugin identifier',
              'VALIDATE',
              startTime,
              messages,
              request.correlationId,
              { reason: 'mismatch', expected: plugin.pluginId, received: request.confirmationToken }
            )
          );
        }
      }

      lifecycleInfo = await this.loadLifecycleScriptInfo(plugin);
      if (lifecycleInfo) {
        messages.push({
          level: 'info',
          message: `Lifecycle uninstall script detected (${lifecycleInfo.relativePath})`,
          step: 'LIFECYCLE_PRE',
        });

        if (!skipInteractiveGuards && !request.scriptReviewDigest) {
          return finalize(
            this.buildErrorResult(
              transactionId,
              'ERR-UNINSTALL-CONSENT',
              'Lifecycle uninstall script requires explicit consent',
              'LIFECYCLE_PRE',
              startTime,
              messages,
              request.correlationId,
              {
                reason: 'consent-required',
                script: {
                  digest: lifecycleInfo.digest,
                  path: lifecycleInfo.relativePath,
                  preview: lifecycleInfo.preview,
                  bytes: lifecycleInfo.bytes,
                },
              }
            )
          );
        }

        if (!skipInteractiveGuards && request.scriptReviewDigest !== lifecycleInfo.digest) {
          return finalize(
            this.buildErrorResult(
              transactionId,
              'ERR-UNINSTALL-CONSENT',
              'Lifecycle uninstall script changed since consent was granted',
              'LIFECYCLE_PRE',
              startTime,
              messages,
              request.correlationId,
              {
                reason: 'digest-mismatch',
                expected: lifecycleInfo.digest,
                received: request.scriptReviewDigest,
              }
            )
          );
        }
      }

      const policy: CacheRetentionPolicy = request.cacheRetentionPolicy ?? 'keep-last-n';
      const keepLastN =
        typeof request.keepLastN === 'number' && Number.isFinite(request.keepLastN)
          ? Math.max(0, Math.trunc(request.keepLastN))
          : 3;

      if (request.dryRun) {
        messages.push({
          level: 'info',
          message: 'Dry-run enabled; no filesystem mutations will be performed',
          step: 'VALIDATE',
        });

        cacheSummary = await this.applyCacheRetention(
          request.pluginId,
          policy,
          keepLastN,
          true /* simulate */
        );
        messages.push({
          level: 'info',
          message: `Cache retention simulation complete (${cacheSummary.versionsRemoved} removal candidates)`,
          step: 'CACHE_CLEANUP',
        });

        const result: UninstallResult = {
          success: true,
          transactionId,
          registryDelta: {
            removed: [plugin.pluginId],
          },
          cacheRetention: cacheSummary,
          uninstallScript: lifecycleInfo
            ? this.buildDryRunLifecycleResult(lifecycleInfo)
            : undefined,
          metadata: {
            durationMs: Date.now() - startTime,
            timestamp: new Date(),
            correlationId: request.correlationId,
          },
          messages,
        };

        return finalize(result);
      }

      if (lifecycleInfo) {
        messages.push({
          level: 'info',
          message: 'Executing lifecycle uninstall script',
          step: 'LIFECYCLE',
        });
        lifecycleOutcome = await this.executeLifecycleScript(lifecycleInfo, plugin);

        if (lifecycleOutcome.result.success) {
          messages.push({
            level: 'info',
            message: 'Lifecycle uninstall script completed successfully',
            step: 'LIFECYCLE',
          });
        } else {
          messages.push({
            level: 'warn',
            message:
              lifecycleOutcome.result.error?.message ??
              'Lifecycle uninstall script reported a failure but uninstall will continue',
            step: 'LIFECYCLE',
          });
        }
      }

      const symlinkPath = this.resolveSymlinkPath(plugin);
      messages.push({
        level: 'info',
        message: `Removing symlink at ${symlinkPath}`,
        step: 'DEACTIVATE',
      });
      const symlinkRemoval = await this.removeSymlink(symlinkPath);
      if (!symlinkRemoval) {
        messages.push({
          level: 'warn',
          message: 'Symlink not found; continuing cleanup',
          step: 'DEACTIVATE',
        });
      }

      messages.push({
        level: 'info',
        message: 'Updating registry',
        step: 'REGISTRY_UPDATE',
      });
      const registryResult = await this.registryService.removePlugin(request.pluginId, {
        transactionId,
        createBackup: true,
        validateAfterUpdate: true,
        telemetryContext: {
          transactionId,
          commandType: 'uninstall',
          durationMs: Date.now() - startTime,
        },
      });

      if (!registryResult.success) {
        const failure = this.buildErrorResult(
          transactionId,
          'ERR-UNINSTALL-002',
          registryResult.error?.message ||
            `Failed to update registry for plugin ${request.pluginId}`,
          'REGISTRY_UPDATE',
          startTime,
          messages,
          request.correlationId,
          registryResult.error
        );
        return finalize(failure);
      }

      cacheSummary = await this.applyCacheRetention(request.pluginId, policy, keepLastN, false);
      messages.push({
        level: 'info',
        message: `Cache retention applied (${cacheSummary.policy}, removed ${cacheSummary.versionsRemoved} versions)`,
        step: 'CACHE_CLEANUP',
      });

      const result: UninstallResult = {
        success: true,
        transactionId,
        registryDelta: {
          removed: [plugin.pluginId],
        },
        cacheRetention: cacheSummary,
        uninstallScript: lifecycleOutcome?.result,
        metadata: {
          durationMs: Date.now() - startTime,
          timestamp: new Date(),
          correlationId: request.correlationId,
        },
        messages: [
          ...messages,
          {
            level: 'info',
            message: 'Telemetry + audit log recorded',
            step: 'TELEMETRY',
          },
        ],
      };

      return finalize(result);
    } catch (error) {
      const failure = this.buildErrorResult(
        transactionId,
        'ERR-UNINSTALL-999',
        `Unexpected uninstall failure: ${(error as Error).message}`,
        'UNKNOWN',
        startTime,
        messages,
        request.correlationId,
        error
      );
      return finalize(failure);
    }
  }

  private async finalizeResult(
    request: UninstallRequest,
    result: UninstallResult,
    context: {
      plugin?: InstalledPlugin;
      lifecycleInfo?: LifecycleScriptInfo;
      lifecycleOutcome?: LifecycleExecutionOutcome;
      cacheSummary?: CacheRetentionSummary;
    }
  ): Promise<UninstallResult> {
    try {
      await this.writeAuditLog(
        request,
        result,
        context.plugin,
        context.lifecycleInfo,
        context.lifecycleOutcome,
        context.cacheSummary ?? result.cacheRetention ?? undefined
      );
    } catch {
      // Swallow audit failures to avoid masking uninstall result
    }

    return result;
  }

  private async loadManifest(cachePath: string): Promise<PluginManifest | undefined> {
    const manifestCandidates = [
      join(cachePath, '.claude-plugin', 'plugin.json'),
      join(cachePath, 'plugin.json'),
    ];

    for (const candidate of manifestCandidates) {
      try {
        const content = await readFile(candidate, 'utf-8');
        return JSON.parse(content) as PluginManifest;
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === 'ENOENT') {
          continue;
        }
        throw new Error(`Failed to read plugin manifest at ${candidate}: ${err.message}`);
      }
    }

    return undefined;
  }

  private resolveScriptPath(cachePath: string, relativePath: string): string {
    if (!relativePath || relativePath.startsWith('..') || relativePath.includes('..')) {
      throw new Error('Lifecycle uninstall script path must stay within the plugin directory');
    }

    const absoluteBase = resolve(cachePath);
    const candidate = resolve(absoluteBase, relativePath);
    const safeBase = absoluteBase.endsWith(pathSeparator)
      ? absoluteBase
      : `${absoluteBase}${pathSeparator}`;

    if (!candidate.startsWith(safeBase)) {
      throw new Error('Lifecycle uninstall script path escapes plugin directory');
    }

    return candidate;
  }

  private async loadLifecycleScriptInfo(
    plugin: InstalledPlugin
  ): Promise<LifecycleScriptInfo | undefined> {
    const manifest = await this.loadManifest(plugin.cachePath);
    const relativePath = manifest?.lifecycle?.uninstall;

    if (!relativePath) {
      return undefined;
    }

    const absolutePath = this.resolveScriptPath(plugin.cachePath, relativePath);

    let scriptContent: string;
    try {
      scriptContent = await readFile(absolutePath, 'utf-8');
    } catch (error) {
      throw new Error(
        `Lifecycle uninstall script not found at ${relativePath}: ${(error as Error).message}`
      );
    }

    const digest = createHash('sha256').update(scriptContent).digest('hex');
    const truncated = scriptContent.length > MAX_SCRIPT_PREVIEW_CHARS;
    const preview = truncated
      ? `${scriptContent.slice(0, MAX_SCRIPT_PREVIEW_CHARS)}\n... (truncated)`
      : scriptContent;

    return {
      relativePath,
      absolutePath,
      digest,
      preview,
      bytes: Buffer.byteLength(scriptContent, 'utf-8'),
    };
  }

  private resolveSymlinkPath(plugin: InstalledPlugin): string {
    if (plugin.symlinkTarget) {
      return resolve(plugin.symlinkTarget);
    }
    return resolve(join(this.config.installDir, plugin.pluginId));
  }

  private async removeSymlink(targetPath: string): Promise<boolean> {
    try {
      const stats = await lstat(targetPath);
      if (stats.isSymbolicLink() || stats.isFile()) {
        await rm(targetPath, { force: true });
      } else {
        await rm(targetPath, { recursive: true, force: true });
      }
      return true;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return false;
      }
      throw new Error(`Failed to remove symlink ${targetPath}: ${err.message}`);
    }
  }

  private async executeLifecycleScript(
    scriptInfo: LifecycleScriptInfo,
    plugin: InstalledPlugin
  ): Promise<LifecycleExecutionOutcome> {
    const start = Date.now();
    const isJavascript = scriptInfo.absolutePath.endsWith('.js');
    const command = isJavascript ? process.execPath : scriptInfo.absolutePath;
    const args = isJavascript ? [scriptInfo.absolutePath] : [];

    const child = spawn(command, args, {
      cwd: plugin.cachePath,
      shell: !isJavascript,
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ID: plugin.pluginId,
        CLAUDE_PLUGIN_VERSION: plugin.version,
      },
    });

    let stdout = '';
    let stderr = '';
    let spawnError: string | undefined;

    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
    }

    const timeoutMs = Math.max(this.config.lifecycleTimeoutMs || 30000, 1000);
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    const exitCode = await new Promise<number>((resolve) => {
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(code ?? 0);
      });
      child.on('error', (error) => {
        spawnError = (error as Error).message;
        clearTimeout(timer);
        resolve(-1);
      });
    });

    const success = exitCode === 0 && !timedOut;
    const result: LifecycleExecutionResult = {
      success,
      exitCode: timedOut ? -1 : exitCode,
      durationMs: Date.now() - start,
      digest: scriptInfo.digest,
      consented: true,
      executedAt: new Date(),
    };

    if (!success) {
      result.error = {
        code: timedOut ? 'CRIT-011-TIMEOUT' : 'CRIT-011',
        message: timedOut
          ? `Lifecycle script timed out after ${timeoutMs}ms`
          : spawnError || stderr.trim() || `Lifecycle script exited with code ${exitCode}`,
      };
    }

    return {
      result,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    };
  }

  private buildDryRunLifecycleResult(info: LifecycleScriptInfo): LifecycleExecutionResult {
    return {
      success: true,
      exitCode: 0,
      durationMs: 0,
      digest: info.digest,
      consented: true,
      executedAt: new Date(),
    };
  }

  private async applyCacheRetention(
    pluginId: string,
    policy: CacheRetentionPolicy,
    keepLastN: number,
    simulateOnly: boolean
  ): Promise<CacheRetentionSummary> {
    const entries = this.cacheService.listEntries(pluginId);

    if (entries.length === 0) {
      return {
        policy,
        versionsRemoved: 0,
        versionsRetained: 0,
        freedMb: 0,
      };
    }

    const sorted = [...entries].sort((a, b) => this.compareVersions(b.version, a.version));
    let removalTargets = sorted;
    let retainedCount = 0;

    if (policy === 'keep-all') {
      removalTargets = [];
      retainedCount = sorted.length;
    } else if (policy === 'keep-last-n') {
      const keepCount = Math.max(0, keepLastN);
      removalTargets = keepCount >= sorted.length ? [] : sorted.slice(keepCount);
      retainedCount = Math.min(keepCount, sorted.length);
    } else {
      retainedCount = 0;
    }

    let freedBytes = removalTargets.reduce((sum, entry) => sum + entry.sizeBytes, 0);
    if (!simulateOnly) {
      freedBytes = 0;
      for (const target of removalTargets) {
        const removed = await this.cacheService.removeEntry(target.pluginId, target.version);
        if (removed) {
          freedBytes += removed.sizeBytes;
        }
      }
    }

    const freedMb = Math.round((freedBytes / (1024 * 1024)) * 100) / 100;

    return {
      policy,
      versionsRemoved: removalTargets.length,
      versionsRetained: retainedCount,
      freedMb,
    };
  }

  private buildErrorResult(
    transactionId: string,
    errorCode: string,
    errorMessage: string,
    failedStep: string,
    startTime: number,
    messages: UninstallResult['messages'],
    correlationId?: string,
    details?: unknown
  ): UninstallResult {
    messages.push({
      level: 'error',
      message: errorMessage,
      step: failedStep,
    });

    return {
      success: false,
      transactionId,
      error: {
        code: errorCode,
        message: errorMessage,
        failedStep,
        details,
      },
      metadata: {
        durationMs: Date.now() - startTime,
        timestamp: new Date(),
        correlationId,
      },
      messages,
    };
  }

  private async writeAuditLog(
    request: UninstallRequest,
    result: UninstallResult,
    plugin?: InstalledPlugin,
    lifecycleInfo?: LifecycleScriptInfo,
    lifecycleOutcome?: LifecycleExecutionOutcome,
    cacheSummary?: CacheRetentionSummary
  ): Promise<void> {
    const auditDir = join(this.config.pluginDir, AUDIT_DIR_NAME);
    await mkdir(auditDir, { recursive: true });

    const completion = result.metadata.timestamp;
    const startedAt = new Date(completion.getTime() - result.metadata.durationMs);

    const payload = {
      transactionId: result.transactionId,
      operation: 'uninstall',
      pluginId: plugin?.pluginId ?? request.pluginId,
      version: plugin?.version,
      timestamp: startedAt.toISOString(),
      completedAt: completion.toISOString(),
      durationMs: result.metadata.durationMs,
      success: result.success,
      error: result.error,
      cacheRetention: cacheSummary,
      registryDelta: result.registryDelta,
      lifecycleScript: lifecycleInfo
        ? {
            path: lifecycleInfo.relativePath,
            digest: lifecycleInfo.digest,
            executed: Boolean(lifecycleOutcome),
            exitCode: lifecycleOutcome?.result.exitCode,
            success: lifecycleOutcome?.result.success ?? false,
            stdout: lifecycleOutcome?.stdout,
            stderr: lifecycleOutcome?.stderr,
          }
        : undefined,
      request: {
        pluginId: request.pluginId,
        cacheRetentionPolicy: request.cacheRetentionPolicy ?? 'keep-last-n',
        keepLastN: request.keepLastN ?? 3,
        force: Boolean(request.force),
        dryRun: Boolean(request.dryRun),
        correlationId: request.correlationId,
      },
      steps: result.messages.map((msg) => ({
        phase: msg.step ?? 'INFO',
        level: msg.level,
        message: msg.message,
      })),
      environment: {
        hostname: hostname(),
        platform: process.platform,
        nodeVersion: process.version,
        claudeCodeVersion: 'unknown',
      },
    };

    const filePath = join(auditDir, `uninstall-${result.transactionId}.json`);
    await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  }

  private generateTransactionId(): string {
    return `tx-uninstall-${randomUUID()}`;
  }

  private compareVersions(a: string, b: string): number {
    const parse = (version: string): [number, number, number] => {
      const parts = version.split('.').map((part) => parseInt(part, 10) || 0);
      return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
    };

    const [aMaj, aMin, aPatch] = parse(a);
    const [bMaj, bMin, bPatch] = parse(b);

    if (aMaj !== bMaj) return aMaj - bMaj;
    if (aMin !== bMin) return aMin - bMin;
    return aPatch - bPatch;
  }
}
