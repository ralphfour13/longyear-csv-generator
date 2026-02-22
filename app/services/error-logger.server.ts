import { promises as fs } from 'fs';
import path from 'path';

/**
 * Error logging service
 *
 * Logs errors to shop-specific log files for debugging and monitoring
 */

interface ErrorLogEntry {
  timestamp: string;
  level: 'error' | 'warning' | 'info';
  context: string;
  message: string;
  details?: any;
  stack?: string;
}

/**
 * Log an error to shop-specific error log
 */
export async function logError(
  shop: string,
  context: string,
  error: Error | string,
  details?: any
): Promise<void> {
  const logEntry: ErrorLogEntry = {
    timestamp: new Date().toISOString(),
    level: 'error',
    context,
    message: error instanceof Error ? error.message : error,
    details,
    stack: error instanceof Error ? error.stack : undefined,
  };

  await writeLog(shop, logEntry);
  console.error(`[${shop}] ${context}:`, error, details);
}

/**
 * Log a warning
 */
export async function logWarning(
  shop: string,
  context: string,
  message: string,
  details?: any
): Promise<void> {
  const logEntry: ErrorLogEntry = {
    timestamp: new Date().toISOString(),
    level: 'warning',
    context,
    message,
    details,
  };

  await writeLog(shop, logEntry);
  console.warn(`[${shop}] ${context}:`, message, details);
}

/**
 * Log an info message
 */
export async function logInfo(
  shop: string,
  context: string,
  message: string,
  details?: any
): Promise<void> {
  const logEntry: ErrorLogEntry = {
    timestamp: new Date().toISOString(),
    level: 'info',
    context,
    message,
    details,
  };

  await writeLog(shop, logEntry);
  console.log(`[${shop}] ${context}:`, message, details);
}

/**
 * Write log entry to file
 */
async function writeLog(shop: string, entry: ErrorLogEntry): Promise<void> {
  try {
    const logDir = path.join(process.cwd(), 'data', shop);
    await fs.mkdir(logDir, { recursive: true });

    const logFile = path.join(logDir, 'error.log');
    const logLine = JSON.stringify(entry) + '\n';

    await fs.appendFile(logFile, logLine, 'utf-8');
  } catch (error) {
    console.error('Failed to write error log:', error);
  }
}

/**
 * Read recent error logs for a shop
 */
export async function getRecentLogs(
  shop: string,
  limit: number = 100,
  level?: 'error' | 'warning' | 'info'
): Promise<ErrorLogEntry[]> {
  try {
    const logFile = path.join(process.cwd(), 'data', shop, 'error.log');
    const content = await fs.readFile(logFile, 'utf-8');

    const lines = content.trim().split('\n');
    const entries: ErrorLogEntry[] = [];

    for (const line of lines.slice(-limit * 2)) {
      try {
        const entry = JSON.parse(line) as ErrorLogEntry;
        if (!level || entry.level === level) {
          entries.push(entry);
        }
      } catch {
        // Skip invalid lines
      }
    }

    return entries.slice(-limit).reverse();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Clear old logs (keep last 30 days)
 */
export async function cleanupOldLogs(shop: string): Promise<void> {
  try {
    const logFile = path.join(process.cwd(), 'data', shop, 'error.log');
    const content = await fs.readFile(logFile, 'utf-8');

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const lines = content.trim().split('\n');
    const recentLines: string[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as ErrorLogEntry;
        const entryDate = new Date(entry.timestamp);

        if (entryDate >= thirtyDaysAgo) {
          recentLines.push(line);
        }
      } catch {
        // Skip invalid lines
      }
    }

    // Write cleaned logs back
    await fs.writeFile(logFile, recentLines.join('\n') + '\n', 'utf-8');

    console.log(`Cleaned up logs for ${shop}, kept ${recentLines.length} entries`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`Failed to cleanup logs for ${shop}:`, error);
    }
  }
}

/**
 * Get error statistics
 */
export async function getErrorStats(shop: string): Promise<{
  totalErrors: number;
  totalWarnings: number;
  totalInfo: number;
  recentErrors: ErrorLogEntry[];
}> {
  const logs = await getRecentLogs(shop, 1000);

  const stats = {
    totalErrors: logs.filter((log) => log.level === 'error').length,
    totalWarnings: logs.filter((log) => log.level === 'warning').length,
    totalInfo: logs.filter((log) => log.level === 'info').length,
    recentErrors: logs.filter((log) => log.level === 'error').slice(0, 10),
  };

  return stats;
}
