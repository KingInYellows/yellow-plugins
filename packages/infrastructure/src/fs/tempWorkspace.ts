/**
 * @yellow-plugins/infrastructure - Temporary Workspace Adapter
 *
 * Infrastructure adapter for managing temporary workspaces during plugin installation.
 * Provisions transaction-scoped directories for staging artifacts before promotion.
 *
 * Part of Task I2.T3: Install Transaction Orchestrator
 *
 * Architecture References:
 * - Section 3.10: Install Transaction Lifecycle (temp directory management)
 * - Section 3.4: Data Persistence & Cache Layout
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Temporary workspace management for install transactions.
 * Provides isolated directories for staging artifacts with automatic cleanup.
 */
export class TempWorkspace {
  /**
   * Provision a new temporary workspace for a transaction.
   * Creates `.claude-plugin/tmp/<transactionId>` directory.
   *
   * @param baseDir - Base directory (typically `.claude-plugin`)
   * @param transactionId - Unique transaction identifier
   * @returns Absolute path to temp workspace
   */
  async provision(baseDir: string, transactionId: string): Promise<string> {
    const tempRoot = join(baseDir, 'tmp');
    const workspacePath = join(tempRoot, transactionId);

    try {
      await mkdir(workspacePath, { recursive: true });
      return workspacePath;
    } catch (error) {
      throw new Error(
        `Failed to provision temp workspace for ${transactionId}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Cleanup a temporary workspace after transaction completes.
   * Removes the entire transaction directory.
   *
   * @param workspacePath - Path to temp workspace
   */
  async cleanup(workspacePath: string): Promise<void> {
    try {
      await rm(workspacePath, { recursive: true, force: true });
    } catch (error) {
      // Log warning but don't fail the operation
      console.warn(`Failed to cleanup temp workspace ${workspacePath}: ${(error as Error).message}`);
    }
  }

  /**
   * List all orphaned temporary directories.
   * Returns directories older than maxAgeMs (default 24 hours).
   *
   * @param baseDir - Base directory (typically `.claude-plugin`)
   * @param maxAgeMs - Maximum age in milliseconds (default 24 hours)
   * @returns Array of orphaned workspace paths
   */
  async listOrphaned(baseDir: string, maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<string[]> {
    const tempRoot = join(baseDir, 'tmp');
    const orphaned: string[] = [];

    try {
      const entries = await readdir(tempRoot, { withFileTypes: true });
      const now = Date.now();

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const entryPath = join(tempRoot, entry.name);
        try {
          const stats = await stat(entryPath);
          const ageMs = now - stats.mtime.getTime();

          if (ageMs > maxAgeMs) {
            orphaned.push(entryPath);
          }
        } catch {
          // Skip entries we can't stat
        }
      }

      return orphaned;
    } catch (error) {
      // Temp root doesn't exist or can't be read
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw new Error(`Failed to list orphaned workspaces: ${(error as Error).message}`);
    }
  }

  /**
   * Cleanup all orphaned temporary directories.
   *
   * @param baseDir - Base directory (typically `.claude-plugin`)
   * @param maxAgeMs - Maximum age in milliseconds (default 24 hours)
   * @returns Number of directories cleaned
   */
  async cleanupOrphaned(baseDir: string, maxAgeMs?: number): Promise<number> {
    const orphaned = await this.listOrphaned(baseDir, maxAgeMs);
    let cleaned = 0;

    for (const workspacePath of orphaned) {
      try {
        await this.cleanup(workspacePath);
        cleaned++;
      } catch {
        // Continue even if some cleanups fail
      }
    }

    return cleaned;
  }

  /**
   * Verify checksum of artifacts in workspace.
   * Calculates SHA-256 hash of all files in directory.
   *
   * @param workspacePath - Path to workspace
   * @param expectedChecksum - Expected SHA-256 checksum
   * @returns True if checksum matches
   */
  async verifyChecksum(workspacePath: string, expectedChecksum: string): Promise<boolean> {
    const { createHash } = await import('node:crypto');
    const { readFile } = await import('node:fs/promises');

    try {
      const entries = await readdir(workspacePath, { recursive: true, withFileTypes: true });
      const hash = createHash('sha256');

      // Sort entries for deterministic hashing
      const files = entries
        .filter((e) => e.isFile())
        .map((e) => join(e.path || workspacePath, e.name))
        .sort();

      for (const filePath of files) {
        const content = await readFile(filePath);
        hash.update(filePath); // Include path in hash
        hash.update(content);
      }

      const actualChecksum = hash.digest('hex');
      return actualChecksum === expectedChecksum;
    } catch (error) {
      throw new Error(`Failed to verify checksum for ${workspacePath}: ${(error as Error).message}`);
    }
  }

  /**
   * Generate a unique transaction ID.
   *
   * @returns Transaction ID in format `tx-<timestamp>-<uuid>`
   */
  generateTransactionId(): string {
    return `tx-${Date.now()}-${randomUUID().substring(0, 8)}`;
  }
}
