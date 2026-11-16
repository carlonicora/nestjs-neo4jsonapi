import { Injectable } from "@nestjs/common";
import { HealthIndicatorResult, HealthIndicatorService } from "@nestjs/terminus";
import * as fs from "fs";
import * as os from "os";

interface DiskStats {
  total: number;
  free: number;
  used: number;
  usedPercentage: number;
}

@Injectable()
export class DiskHealthIndicator {
  // Minimum free space threshold: 1GB or 10% of total, whichever is smaller
  private readonly MIN_FREE_BYTES = 1024 * 1024 * 1024; // 1GB
  private readonly MIN_FREE_PERCENTAGE = 10; // 10%

  constructor(private readonly healthIndicatorService: HealthIndicatorService) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);

    try {
      const stats = await this.getDiskStats();

      const minRequiredByPercentage = (stats.total * this.MIN_FREE_PERCENTAGE) / 100;
      const threshold = Math.min(this.MIN_FREE_BYTES, minRequiredByPercentage);

      const isHealthy = stats.free >= threshold;

      if (!isHealthy) {
        return indicator.down({
          message: `Low disk space: ${this.formatBytes(stats.free)} free (${(100 - stats.usedPercentage).toFixed(1)}%)`,
          total: this.formatBytes(stats.total),
          free: this.formatBytes(stats.free),
          used: this.formatBytes(stats.used),
          usedPercentage: `${stats.usedPercentage.toFixed(1)}%`,
        });
      }

      return indicator.up({
        message: "Disk space healthy",
        total: this.formatBytes(stats.total),
        free: this.formatBytes(stats.free),
        used: this.formatBytes(stats.used),
        usedPercentage: `${stats.usedPercentage.toFixed(1)}%`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return indicator.down({
        message: errorMessage,
      });
    }
  }

  private async getDiskStats(): Promise<DiskStats> {
    // Get the root path based on OS
    const checkPath = os.platform() === "win32" ? "C:\\" : "/";

    return new Promise((resolve) => {
      // Use statvfs-like approach for Unix systems
      if (os.platform() !== "win32") {
        try {
          const stats = fs.statfsSync(checkPath);
          const total = stats.bsize * stats.blocks;
          const free = stats.bsize * stats.bfree;
          const used = total - free;

          resolve({
            total,
            free,
            used,
            usedPercentage: (used / total) * 100,
          });
        } catch {
          // Fallback: use os module for basic memory info as indicator
          const totalMem = os.totalmem();
          const freeMem = os.freemem();
          resolve({
            total: totalMem,
            free: freeMem,
            used: totalMem - freeMem,
            usedPercentage: ((totalMem - freeMem) / totalMem) * 100,
          });
        }
      } else {
        // For Windows, use a different approach or return system memory
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        resolve({
          total: totalMem,
          free: freeMem,
          used: totalMem - freeMem,
          usedPercentage: ((totalMem - freeMem) / totalMem) * 100,
        });
      }
    });
  }

  private formatBytes(bytes: number): string {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let unitIndex = 0;
    let size = bytes;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }
}
