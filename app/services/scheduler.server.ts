import cron from 'node-cron';
import { promises as fs } from 'fs';
import path from 'path';
import type { SyncConfig } from '../types/journal-entry';
import { getShopConfig } from './storage.server';
import { processExport, calculateExportDates } from './batch-processor.server';

/**
 * Scheduler for automated nightly exports
 *
 * This service manages cron jobs for each shop that has enabled automatic exports
 */

// Map of shop domain to cron task
const activeTasks = new Map<string, cron.ScheduledTask>();

/**
 * Initialize scheduler for all shops
 *
 * Called at app startup to set up scheduled exports for all shops
 * that have syncEnabled: true
 */
export async function initializeScheduler(
  getAccessToken: (shop: string) => Promise<string>
): Promise<void> {
  console.log('Initializing scheduler...');

  try {
    const dataDir = path.join(process.cwd(), 'data');

    // Check if data directory exists
    try {
      await fs.access(dataDir);
    } catch {
      console.log('No data directory found, skipping scheduler initialization');
      return;
    }

    // Read all shop directories
    const shopDirs = await fs.readdir(dataDir);

    for (const shopDomain of shopDirs) {
      const shopPath = path.join(dataDir, shopDomain);
      const stats = await fs.stat(shopPath);

      if (stats.isDirectory()) {
        try {
          const config = await getShopConfig(shopDomain);

          if (config.syncEnabled && config.syncSchedule === 'nightly') {
            await scheduleShopExport(shopDomain, config, getAccessToken);
            console.log(`Scheduled export for ${shopDomain} at ${config.scheduledTime}`);
          }
        } catch (error) {
          console.error(`Failed to schedule export for ${shopDomain}:`, error);
        }
      }
    }

    console.log(`Scheduler initialized with ${activeTasks.size} active tasks`);
  } catch (error) {
    console.error('Failed to initialize scheduler:', error);
  }
}

/**
 * Schedule export for a specific shop
 *
 * @param shop - Shop domain
 * @param config - Shop configuration
 * @param getAccessToken - Function to retrieve access token for the shop
 */
export async function scheduleShopExport(
  shop: string,
  config: SyncConfig,
  getAccessToken: (shop: string) => Promise<string>
): Promise<void> {
  // Stop existing task if any
  stopScheduledExport(shop);

  if (!config.syncEnabled || config.syncSchedule !== 'nightly') {
    console.log(`Sync not enabled for ${shop}, skipping schedule`);
    return;
  }

  // Parse scheduled time (format: "HH:mm" or "HH:MM")
  const [hour, minute] = config.scheduledTime.split(':').map(Number);

  if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    console.error(`Invalid scheduled time for ${shop}: ${config.scheduledTime}`);
    return;
  }

  // Create cron expression: "minute hour * * *" (daily at specified time)
  const cronExpression = `${minute} ${hour} * * *`;

  console.log(`Creating cron schedule for ${shop}: ${cronExpression} (${config.scheduledTime})`);

  // Create scheduled task
  const task = cron.schedule(
    cronExpression,
    async () => {
      await executeScheduledExport(shop, config, getAccessToken);
    },
    {
      scheduled: true,
      timezone: 'America/New_York', // Default timezone, could be configurable
    }
  );

  // Store task
  activeTasks.set(shop, task);

  console.log(`Scheduled export for ${shop} at ${config.scheduledTime}`);
}

/**
 * Execute scheduled export for a shop
 */
async function executeScheduledExport(
  shop: string,
  config: SyncConfig,
  getAccessToken: (shop: string) => Promise<string>
): Promise<void> {
  const startTime = new Date();
  console.log(`[${startTime.toISOString()}] Starting scheduled export for ${shop}`);

  try {
    // Get access token
    const accessToken = await getAccessToken(shop);

    // Calculate export dates based on config
    const { startDate } = calculateExportDates(config.autoExportDate);

    console.log(`Exporting data for ${shop} for date ${startDate}`);

    // Process export
    const result = await processExport(shop, accessToken, startDate);

    const endTime = new Date();
    const duration = (endTime.getTime() - startTime.getTime()) / 1000;

    console.log(
      `[${endTime.toISOString()}] Scheduled export completed for ${shop}:`,
      {
        filename: result.filename,
        entryCount: result.entryCount,
        balanced: result.balanced,
        duration: `${duration}s`,
      }
    );

    // Log success
    await logScheduledExport(shop, {
      success: true,
      filename: result.filename,
      entryCount: result.entryCount,
      startDate,
      endDate,
      duration,
    });
  } catch (error) {
    const endTime = new Date();
    const duration = (endTime.getTime() - startTime.getTime()) / 1000;

    console.error(`[${endTime.toISOString()}] Scheduled export failed for ${shop}:`, error);

    // Log failure
    await logScheduledExport(shop, {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      duration,
    });
  }
}

/**
 * Stop scheduled export for a shop
 */
export function stopScheduledExport(shop: string): void {
  const task = activeTasks.get(shop);

  if (task) {
    task.stop();
    activeTasks.delete(shop);
    console.log(`Stopped scheduled export for ${shop}`);
  }
}

/**
 * Update schedule for a shop (called when config changes)
 */
export async function updateShopSchedule(
  shop: string,
  config: SyncConfig,
  getAccessToken: (shop: string) => Promise<string>
): Promise<void> {
  console.log(`Updating schedule for ${shop}...`);

  // Stop existing schedule
  stopScheduledExport(shop);

  // Create new schedule if enabled
  if (config.syncEnabled && config.syncSchedule === 'nightly') {
    await scheduleShopExport(shop, config, getAccessToken);
  }
}

/**
 * Get status of scheduled tasks
 */
export function getSchedulerStatus(): {
  activeShops: string[];
  taskCount: number;
} {
  return {
    activeShops: Array.from(activeTasks.keys()),
    taskCount: activeTasks.size,
  };
}

/**
 * Stop all scheduled tasks (called on app shutdown)
 */
export function stopAllScheduledExports(): void {
  console.log(`Stopping ${activeTasks.size} scheduled tasks...`);

  for (const [shop, task] of activeTasks.entries()) {
    task.stop();
    console.log(`Stopped task for ${shop}`);
  }

  activeTasks.clear();
  console.log('All scheduled tasks stopped');
}

/**
 * Log scheduled export result
 */
async function logScheduledExport(
  shop: string,
  result: {
    success: boolean;
    filename?: string;
    entryCount?: number;
    startDate?: string;
    endDate?: string;
    error?: string;
    duration: number;
  }
): Promise<void> {
  const logDir = path.join(process.cwd(), 'data', shop);
  const logFile = path.join(logDir, 'scheduled-exports.log');

  const logEntry = {
    timestamp: new Date().toISOString(),
    ...result,
  };

  const logLine = JSON.stringify(logEntry) + '\n';

  try {
    await fs.appendFile(logFile, logLine, 'utf-8');
  } catch (error) {
    console.error(`Failed to write log for ${shop}:`, error);
  }
}

/**
 * Read scheduled export logs for a shop
 */
export async function getScheduledExportLogs(
  shop: string,
  limit: number = 50
): Promise<any[]> {
  const logFile = path.join(process.cwd(), 'data', shop, 'scheduled-exports.log');

  try {
    const content = await fs.readFile(logFile, 'utf-8');
    const lines = content.trim().split('\n');

    // Parse and return last N entries
    return lines
      .slice(-limit)
      .reverse()
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((entry) => entry !== null);
  } catch (error) {
    // Log file doesn't exist yet
    return [];
  }
}
