/**
 * @yellow-plugins/infrastructure - Cache Filesystem Adapter
 *
 * Infrastructure adapter implementing filesystem operations for cache management.
 * Provides atomic writes, directory operations, checksums, and temp directory management.
 *
 * Part of Task I2.T2: Cache manager + registry persistence
 *
 * Architecture References:
 * - Section 3.4: Data Persistence & Cache Layout (atomic writes, temp directories)
 * - Implements ICacheAdapter from domain layer
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  constants,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

import type { ICacheAdapter } from '@yellow-plugins/domain';

/**
 * Cache filesystem adapter implementation.
 * Handles all filesystem I/O for cache operations.
 */
export class CacheAdapter implements ICacheAdapter {
  /**
   * Ensure a directory exists, creating it recursively if necessary.
   */
  async ensureDirectory(path: string): Promise<void> {
    try {
      await mkdir(path, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to ensure directory ${path}: ${(error as Error).message}`);
    }
  }

  /**
   * Calculate total size of a directory in bytes (recursive).
   */
  async calculateDirectorySize(path: string): Promise<number> {
    try {
      const pathStat = await stat(path);

      if (!pathStat.isDirectory()) {
        return pathStat.size;
      }

      const entries = await readdir(path, { withFileTypes: true });
      let totalSize = 0;

      for (const entry of entries) {
        const entryPath = join(path, entry.name);

        if (entry.isDirectory()) {
          totalSize += await this.calculateDirectorySize(entryPath);
        } else if (entry.isFile()) {
          const entryStat = await stat(entryPath);
          totalSize += entryStat.size;
        }
      }

      return totalSize;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return 0;
      }
      throw new Error(`Failed to calculate size of ${path}: ${(error as Error).message}`);
    }
  }

  /**
   * List all entries in a directory.
   */
  async listDirectory(
    path: string
  ): Promise<Array<{ name: string; path: string; isDirectory: boolean; size: number; mtime: Date }>> {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      const results = [];

      for (const entry of entries) {
        const entryPath = join(path, entry.name);
        const entryStat = await stat(entryPath);

        results.push({
          name: entry.name,
          path: entryPath,
          isDirectory: entry.isDirectory(),
          size: entryStat.size,
          mtime: entryStat.mtime,
        });
      }

      return results;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw new Error(`Failed to list directory ${path}: ${(error as Error).message}`);
    }
  }

  /**
   * Check if a path exists.
   */
  async exists(path: string): Promise<boolean> {
    try {
      await access(path, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Remove a directory recursively.
   */
  async removeDirectory(path: string): Promise<void> {
    try {
      await rm(path, { recursive: true, force: true });
    } catch (error) {
      throw new Error(`Failed to remove directory ${path}: ${(error as Error).message}`);
    }
  }

  /**
   * Move/rename a directory atomically.
   * Uses fs.rename which is atomic on the same filesystem.
   */
  async moveDirectory(source: string, destination: string): Promise<void> {
    try {
      // Ensure parent directory of destination exists
      const parentDir = join(destination, '..');
      await this.ensureDirectory(parentDir);

      // Atomic rename
      await rename(source, destination);
    } catch (error) {
      throw new Error(
        `Failed to move directory from ${source} to ${destination}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Write JSON file with atomic temp-rename pattern.
   * Writes to `.tmp` file first, then atomically renames to target.
   */
  async writeJsonAtomic<T>(path: string, data: T): Promise<void> {
    const tempPath = `${path}.tmp`;

    try {
      // Ensure parent directory exists
      const parentDir = join(path, '..');
      await this.ensureDirectory(parentDir);

      // Serialize JSON with formatting
      const jsonContent = JSON.stringify(data, null, 2);

      // Write to temp file
      await writeFile(tempPath, jsonContent, { encoding: 'utf-8' });

      // Atomic rename to target
      await rename(tempPath, path);
    } catch (error) {
      // Clean up temp file on failure
      try {
        await rm(tempPath, { force: true });
      } catch {
        // Ignore cleanup errors
      }

      throw new Error(`Failed to write JSON atomically to ${path}: ${(error as Error).message}`);
    }
  }

  /**
   * Read and parse JSON file.
   * Returns undefined if file doesn't exist.
   */
  async readJson<T>(path: string): Promise<T | undefined> {
    try {
      const content = await readFile(path, { encoding: 'utf-8' });
      return JSON.parse(content) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw new Error(`Failed to read JSON from ${path}: ${(error as Error).message}`);
    }
  }

  /**
   * Calculate checksum (SHA-256) for a directory.
   * Computes hash of sorted file paths + contents for deterministic result.
   */
  async calculateChecksum(path: string): Promise<string> {
    try {
      const hash = createHash('sha256');
      const pathStat = await stat(path);

      if (pathStat.isFile()) {
        // Single file: hash its contents
        const content = await readFile(path);
        hash.update(content);
        return hash.digest('hex');
      }

      // Directory: hash all files recursively in sorted order
      await this.hashDirectory(path, hash);
      return hash.digest('hex');
    } catch (error) {
      throw new Error(`Failed to calculate checksum for ${path}: ${(error as Error).message}`);
    }
  }

  /**
   * Recursively hash a directory's contents.
   */
  private async hashDirectory(dirPath: string, hash: ReturnType<typeof createHash>): Promise<void> {
    const entries = await readdir(dirPath, { withFileTypes: true });

    // Sort entries for deterministic ordering
    const sortedEntries = entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of sortedEntries) {
      const entryPath = join(dirPath, entry.name);

      // Hash the relative path
      hash.update(entry.name);

      if (entry.isDirectory()) {
        await this.hashDirectory(entryPath, hash);
      } else if (entry.isFile()) {
        const content = await readFile(entryPath);
        hash.update(content);
      }
    }
  }

  /**
   * Touch a file to update its access time.
   */
  async touchFile(path: string): Promise<void> {
    try {
      const now = new Date();
      await utimes(path, now, now);
    } catch (error) {
      throw new Error(`Failed to touch file ${path}: ${(error as Error).message}`);
    }
  }

  /**
   * Create a temporary directory with unique ID.
   * Returns absolute path to temp directory.
   */
  async createTempDirectory(prefix: string): Promise<string> {
    const uniqueId = randomUUID();
    const tempDirName = `tmp-${uniqueId}`;
    const tempPath = join(prefix, tempDirName);

    await this.ensureDirectory(tempPath);
    return tempPath;
  }

  /**
   * List all temporary directories matching a pattern.
   * Searches for directories starting with the pattern prefix.
   */
  async listTempDirectories(pattern: string): Promise<string[]> {
    try {
      if (!(await this.exists(pattern))) {
        return [];
      }

      const entries = await readdir(pattern, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(pattern, entry.name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw new Error(`Failed to list temp directories: ${(error as Error).message}`);
    }
  }
}

/**
 * Global singleton cache adapter instance.
 */
let globalCacheAdapter: CacheAdapter | null = null;

/**
 * Get the global cache adapter instance.
 */
export function getCacheAdapter(): CacheAdapter {
  if (!globalCacheAdapter) {
    globalCacheAdapter = new CacheAdapter();
  }
  return globalCacheAdapter;
}

/**
 * Reset the global cache adapter (useful for testing).
 */
export function resetCacheAdapter(): void {
  globalCacheAdapter = null;
}
