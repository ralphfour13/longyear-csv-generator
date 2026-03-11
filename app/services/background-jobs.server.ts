import { promises as fs } from 'fs';
import path from 'path';
import type { FileGenerationOptions } from './batch-processor.server';

const DATA_DIR = path.join(process.cwd(), 'data');
const JOBS_DIR = path.join(DATA_DIR, 'jobs');

export interface ExportJob {
  id: string;
  shop: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  startDate: string;
  endDate?: string;
  fileOptions: FileGenerationOptions;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result?: any;
}

/**
 * Ensure jobs directory exists
 */
async function ensureJobsDir() {
  await fs.mkdir(JOBS_DIR, { recursive: true });
}

/**
 * Create a new export job
 */
export async function createExportJob(
  shop: string,
  startDate: string,
  endDate: string | undefined,
  fileOptions: FileGenerationOptions
): Promise<string> {
  await ensureJobsDir();

  const jobId = `export_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const job: ExportJob = {
    id: jobId,
    shop,
    status: 'pending',
    startDate,
    endDate,
    fileOptions,
    createdAt: new Date().toISOString(),
  };

  const jobPath = path.join(JOBS_DIR, `${jobId}.json`);
  await fs.writeFile(jobPath, JSON.stringify(job, null, 2));

  const dateRange = endDate ? `${startDate} to ${endDate}` : startDate;
  const fileTypes = Object.entries(fileOptions)
    .filter(([, enabled]) => enabled)
    .map(([type]) => type)
    .join(', ');

  console.log(
    `[Job] Created job ${jobId} for shop ${shop}`,
    `\n  Date range: ${dateRange}`,
    `\n  File options: ${fileTypes}`
  );

  return jobId;
}

/**
 * Get job status
 */
export async function getJobStatus(jobId: string): Promise<ExportJob | null> {
  try {
    const jobPath = path.join(JOBS_DIR, `${jobId}.json`);
    const content = await fs.readFile(jobPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Update job status
 */
export async function updateJobStatus(
  jobId: string,
  updates: Partial<ExportJob>
): Promise<void> {
  const job = await getJobStatus(jobId);
  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  const updatedJob = { ...job, ...updates };
  const jobPath = path.join(JOBS_DIR, `${jobId}.json`);
  await fs.writeFile(jobPath, JSON.stringify(updatedJob, null, 2));

  // Log status changes
  if (updates.status && updates.status !== job.status) {
    const dateRange = job.endDate ? `${job.startDate} to ${job.endDate}` : job.startDate;
    console.log(
      `[Job] ${jobId} status changed: ${job.status} → ${updates.status}`,
      `(${dateRange})`
    );

    if (updates.status === 'completed' && job.startedAt) {
      const duration = Date.now() - new Date(job.startedAt).getTime();
      console.log(`[Job] ${jobId} completed in ${(duration / 1000).toFixed(1)}s`);
    }

    if (updates.status === 'failed' && updates.error) {
      console.error(`[Job] ${jobId} failed:`, updates.error);
    }
  }
}

/**
 * Get all jobs for a shop
 */
export async function getShopJobs(shop: string): Promise<ExportJob[]> {
  try {
    await ensureJobsDir();
    const files = await fs.readdir(JOBS_DIR);
    const jobs: ExportJob[] = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const content = await fs.readFile(path.join(JOBS_DIR, file), 'utf-8');
        const job = JSON.parse(content);
        if (job.shop === shop) {
          jobs.push(job);
        }
      }
    }

    // Sort by created date, newest first
    return jobs.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  } catch {
    return [];
  }
}

/**
 * Clean up old completed jobs (older than 7 days)
 */
export async function cleanupOldJobs(): Promise<void> {
  try {
    await ensureJobsDir();
    const files = await fs.readdir(JOBS_DIR);
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(JOBS_DIR, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const job = JSON.parse(content);

        if (
          (job.status === 'completed' || job.status === 'failed') &&
          new Date(job.createdAt).getTime() < sevenDaysAgo
        ) {
          await fs.unlink(filePath);
        }
      }
    }
  } catch (error) {
    console.error('Error cleaning up old jobs:', error);
  }
}

/**
 * Clear all completed/failed jobs for a shop
 */
export async function clearCompletedJobs(shop: string): Promise<number> {
  try {
    await ensureJobsDir();
    const files = await fs.readdir(JOBS_DIR);
    let deletedCount = 0;

    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(JOBS_DIR, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const job = JSON.parse(content);

        if (
          job.shop === shop &&
          (job.status === 'completed' || job.status === 'failed')
        ) {
          await fs.unlink(filePath);
          deletedCount++;
        }
      }
    }

    return deletedCount;
  } catch (error) {
    console.error('Error clearing completed jobs:', error);
    return 0;
  }
}

/**
 * Cancel all pending jobs for a shop
 */
export async function cancelPendingJobs(shop: string): Promise<number> {
  try {
    await ensureJobsDir();
    const files = await fs.readdir(JOBS_DIR);
    let cancelledCount = 0;

    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(JOBS_DIR, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const job = JSON.parse(content);

        if (job.shop === shop && job.status === 'pending') {
          // Mark as failed with cancellation message
          const cancelledJob = {
            ...job,
            status: 'failed' as const,
            error: 'Cancelled by user',
            completedAt: new Date().toISOString(),
          };

          await fs.writeFile(filePath, JSON.stringify(cancelledJob, null, 2));
          cancelledCount++;
        }
      }
    }

    return cancelledCount;
  } catch (error) {
    console.error('Error cancelling pending jobs:', error);
    return 0;
  }
}

/**
 * Cancel orphaned processing jobs for a shop
 *
 * Cancels jobs that have been in "processing" status for longer than the timeout threshold.
 * Default timeout is 1 hour (3600000 ms).
 *
 * @param shop - Shop domain
 * @param timeoutMs - Max time a job can be processing before being considered orphaned (default: 1 hour)
 * @returns Number of jobs cancelled
 */
export async function cancelOrphanedProcessingJobs(
  shop: string,
  timeoutMs: number = 3600000 // 1 hour default
): Promise<number> {
  try {
    await ensureJobsDir();
    const files = await fs.readdir(JOBS_DIR);
    let cancelledCount = 0;
    const now = Date.now();

    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(JOBS_DIR, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const job = JSON.parse(content);

        if (job.shop === shop && job.status === 'processing') {
          // Check if job has been processing too long
          const startedAt = job.startedAt ? new Date(job.startedAt).getTime() : now;
          const processingDuration = now - startedAt;

          if (processingDuration > timeoutMs) {
            // Mark as failed with timeout message
            const cancelledJob = {
              ...job,
              status: 'failed' as const,
              error: `Cancelled - orphaned (processing for ${Math.round(processingDuration / 3600000)}h)`,
              completedAt: new Date().toISOString(),
            };

            await fs.writeFile(filePath, JSON.stringify(cancelledJob, null, 2));
            cancelledCount++;

            console.log(
              `Cancelled orphaned job ${job.id} (processing for ${Math.round(processingDuration / 3600000)}h ${Math.round((processingDuration % 3600000) / 60000)}m)`
            );
          }
        }
      }
    }

    return cancelledCount;
  } catch (error) {
    console.error('Error cancelling orphaned processing jobs:', error);
    return 0;
  }
}

/**
 * Cancel ALL processing jobs for a shop (use with caution!)
 *
 * @param shop - Shop domain
 * @returns Number of jobs cancelled
 */
export async function cancelAllProcessingJobs(shop: string): Promise<number> {
  try {
    await ensureJobsDir();
    const files = await fs.readdir(JOBS_DIR);
    let cancelledCount = 0;

    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(JOBS_DIR, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const job = JSON.parse(content);

        if (job.shop === shop && job.status === 'processing') {
          // Mark as failed with cancellation message
          const cancelledJob = {
            ...job,
            status: 'failed' as const,
            error: 'Cancelled by user',
            completedAt: new Date().toISOString(),
          };

          await fs.writeFile(filePath, JSON.stringify(cancelledJob, null, 2));
          cancelledCount++;
        }
      }
    }

    return cancelledCount;
  } catch (error) {
    console.error('Error cancelling all processing jobs:', error);
    return 0;
  }
}

/**
 * Delete a specific job
 */
export async function deleteJob(jobId: string): Promise<boolean> {
  try {
    const jobPath = path.join(JOBS_DIR, `${jobId}.json`);
    await fs.unlink(jobPath);
    return true;
  } catch (error) {
    console.error(`Error deleting job ${jobId}:`, error);
    return false;
  }
}
