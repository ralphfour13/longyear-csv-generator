import type { FileGenerationOptions } from './batch-processor.server';
import {
  readJob,
  writeJob,
  listJobs,
  removeJob,
  jobStoreBackend,
} from './job-store.server';

export interface ExportJob {
  id: string;
  shop: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  jobType?: 'export' | 'sales-tax' | 'uncaptured-auth' | 'cogs-push'; // Defaults to 'export' for backwards compatibility
  startDate: string;
  endDate?: string;
  fileOptions: FileGenerationOptions;
  salesTaxRequest?: {
    periodType: 'month' | 'quarter';
    year: number;
    month?: number;
    quarter?: number;
  };
  uncapturedAuthRequest?: {
    sinceDate: string;
  };
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result?: any;

  // Progress tracking
  progress?: {
    phase?: 'fetching' | 'reconciling' | 'cogs' | 'generating' | 'validating';
    phaseLabel?: string;
    overallPercentage?: number;

    // Metrics
    ordersFound?: number;
    ordersProcessed?: number;
    transactionsFetched?: number;
    journalEntriesGenerated?: number;
    filesGenerated?: number;
    filesTotalCount?: number;

    // Timing
    startTime?: number;
    lastUpdate?: number;
    estimatedTotalSeconds?: number;
    estimatedSecondsRemaining?: number;

    // Current activity
    currentActivity?: string;
  };

  // Chunked-export cursor. On Vercel an export runs as a series of short steps across
  // separate invocations; these record how far it got so the next step can resume.
  currentStep?: string;
  completedSteps?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stepState?: any;
}

/**
 * Persist a job, creating or overwriting it.
 */
async function saveJob(job: ExportJob): Promise<void> {
  await writeJob(job);
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
  const jobId =`export_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const job: ExportJob = {
    id: jobId,
    shop,
    status: 'pending',
    startDate,
    endDate,
    fileOptions,
    createdAt: new Date().toISOString(),
  };

  await saveJob(job);

  const dateRange = endDate ? `${startDate} to ${endDate}` : startDate;
  const fileTypes = Object.entries(fileOptions)
    .filter(([, enabled]) => enabled)
    .map(([type]) => type)
    .join(', ');

  console.log(
    `[Job] Created job ${jobId} for shop ${shop}`,
    `\n  Date range: ${dateRange}`,
    `\n  File options: ${fileTypes}`,
    `\n  Job store: ${jobStoreBackend}`
  );

  return jobId;
}

/**
 * Create a new sales tax report job
 */
export async function createSalesTaxJob(
  shop: string,
  salesTaxRequest: { periodType: 'month' | 'quarter'; year: number; month?: number; quarter?: number },
): Promise<string> {
  const jobId =`salestax_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const job: ExportJob = {
    id: jobId,
    shop,
    status: 'pending',
    jobType: 'sales-tax',
    startDate: '', // Not used for sales tax jobs
    fileOptions: {}, // Not used for sales tax jobs
    salesTaxRequest,
    createdAt: new Date().toISOString(),
  };

  await saveJob(job);

  const periodLabel = salesTaxRequest.periodType === 'month'
    ? `${salesTaxRequest.year}-${String(salesTaxRequest.month).padStart(2, '0')}`
    : `Q${salesTaxRequest.quarter} ${salesTaxRequest.year}`;

  console.log(
    `[Job] Created sales tax job ${jobId} for shop ${shop}`,
    `\n  Period: ${periodLabel}`,
  );

  return jobId;
}

/**
 * Create a new uncaptured authorization report job
 */
export async function createUncapturedAuthJob(
  shop: string,
  sinceDate: string,
): Promise<string> {
  const jobId =`uncapturedauth_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const job: ExportJob = {
    id: jobId,
    shop,
    status: 'pending',
    jobType: 'uncaptured-auth',
    startDate: sinceDate,
    fileOptions: {}, // Not used for uncaptured-auth jobs
    uncapturedAuthRequest: { sinceDate },
    createdAt: new Date().toISOString(),
  };

  await saveJob(job);

  console.log(
    `[Job] Created uncaptured auth job ${jobId} for shop ${shop}`,
    `\n  Since: ${sinceDate}`,
  );

  return jobId;
}

/**
 * Create a new COGS push job
 *
 * Pulls COGS from Cin7 and writes them into the Shopify product "Cost per item"
 * field for all active products. Scope is fixed (all active products), so there
 * is no request payload.
 */
export async function createCogsPushJob(shop: string): Promise<string> {
  const jobId =`cogspush_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const job: ExportJob = {
    id: jobId,
    shop,
    status: 'pending',
    jobType: 'cogs-push',
    startDate: '', // Not used for cogs-push jobs
    fileOptions: {}, // Not used for cogs-push jobs
    createdAt: new Date().toISOString(),
  };

  await saveJob(job);

  console.log(`[Job] Created COGS push job ${jobId} for shop ${shop}`);

  return jobId;
}

/**
 * Get job status
 */
export async function getJobStatus(jobId: string): Promise<ExportJob | null> {
  try {
    return await readJob(jobId);
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
  await saveJob(updatedJob);

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
    const jobs = await listJobs(shop);

    // Sort by created date, oldest first (FIFO — process jobs in the order they were queued)
    return jobs.sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
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
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    for (const job of await listJobs()) {
      if (
        (job.status === 'completed' || job.status === 'failed') &&
        new Date(job.createdAt).getTime() < sevenDaysAgo
      ) {
        await removeJob(job.id);
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
    let deletedCount = 0;

    for (const job of await listJobs(shop)) {
      if (job.status === 'completed' || job.status === 'failed') {
        await removeJob(job.id);
        deletedCount++;
      }
    }

    return deletedCount;
  } catch (error) {
    console.error('Error clearing completed jobs:', error);
    return 0;
  }
}

export async function clearFailedJobs(shop: string): Promise<number> {
  try {
    let deletedCount = 0;

    for (const job of await listJobs(shop)) {
      if (job.status === 'failed') {
        await removeJob(job.id);
        deletedCount++;
      }
    }

    return deletedCount;
  } catch (error) {
    console.error('Error clearing failed jobs:', error);
    return 0;
  }
}

/**
 * Cancel all pending jobs for a shop
 */
export async function cancelPendingJobs(shop: string): Promise<number> {
  try {
    let cancelledCount = 0;

    for (const job of await listJobs(shop)) {
      if (job.status === 'pending') {
        await saveJob({
          ...job,
          status: 'failed',
          error: 'Cancelled by user',
          completedAt: new Date().toISOString(),
        });
        cancelledCount++;
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
    let cancelledCount = 0;
    const now = Date.now();

    for (const job of await listJobs(shop)) {
      if (job.status !== 'processing') continue;

      // Check if job has been processing too long
      const startedAt = job.startedAt ? new Date(job.startedAt).getTime() : now;
      const processingDuration = now - startedAt;

      if (processingDuration > timeoutMs) {
        await saveJob({
          ...job,
          status: 'failed',
          error: `Cancelled - orphaned (processing for ${Math.round(processingDuration / 3600000)}h)`,
          completedAt: new Date().toISOString(),
        });
        cancelledCount++;

        console.log(
          `Cancelled orphaned job ${job.id} (processing for ${Math.round(processingDuration / 3600000)}h ${Math.round((processingDuration % 3600000) / 60000)}m)`
        );
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
    let cancelledCount = 0;

    for (const job of await listJobs(shop)) {
      if (job.status === 'processing') {
        await saveJob({
          ...job,
          status: 'failed',
          error: 'Cancelled by user',
          completedAt: new Date().toISOString(),
        });
        cancelledCount++;
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
    await removeJob(jobId);
    return true;
  } catch (error) {
    console.error(`Error deleting job ${jobId}:`, error);
    return false;
  }
}

/**
 * Update job progress (throttled to avoid excessive writes)
 *
 * @param jobId - Job ID
 * @param progressUpdate - Partial progress update
 */
export async function updateJobProgress(
  jobId: string,
  progressUpdate: Partial<ExportJob['progress']>
): Promise<void> {
  try {
    const job = await getJobStatus(jobId);
    if (!job) {
      console.error(`[Progress] Job not found: ${jobId}`);
      return;
    }

    const now = Date.now();
    const currentProgress = job.progress || {};

    // Throttle updates: Only write if >2 seconds since last update
    // (unless it's a phase change or completion)
    const timeSinceLastUpdate = currentProgress.lastUpdate
      ? now - currentProgress.lastUpdate
      : Infinity;

    const isPhaseChange = progressUpdate?.phase && progressUpdate.phase !== currentProgress.phase;
    const shouldUpdate = isPhaseChange || timeSinceLastUpdate > 2000;

    if (!shouldUpdate) {
      return;
    }

    // Merge progress updates
    const updatedProgress = {
      ...currentProgress,
      ...progressUpdate,
      lastUpdate: now,
    };

    // Calculate overall percentage based on phase
    if (!progressUpdate?.overallPercentage) {
      updatedProgress.overallPercentage = calculateOverallProgress(updatedProgress);
    }

    // Estimate remaining time
    if (updatedProgress.startTime && updatedProgress.ordersFound) {
      const elapsed = (now - updatedProgress.startTime) / 1000;
      const processed = updatedProgress.ordersProcessed || updatedProgress.transactionsFetched || 0;

      if (processed > 0 && processed < updatedProgress.ordersFound) {
        const avgTimePerOrder = elapsed / processed;
        const remaining = updatedProgress.ordersFound - processed;
        updatedProgress.estimatedSecondsRemaining = Math.round(avgTimePerOrder * remaining);
        updatedProgress.estimatedTotalSeconds = Math.round(avgTimePerOrder * updatedProgress.ordersFound);
      }
    }

    await updateJobStatus(jobId, { progress: updatedProgress });

    // Log progress for user watching logs
    logProgress(jobId, updatedProgress);
  } catch (error) {
    console.error('[Progress] Failed to update job progress:', error);
    console.error('[Progress] Job ID:', jobId);
    console.error('[Progress] Update:', JSON.stringify(progressUpdate));
  }
}

/**
 * Calculate overall progress percentage based on phase and metrics
 */
function calculateOverallProgress(progress: ExportJob['progress']): number {
  if (!progress) return 0;

  // Phase weights (total = 100%)
  const PHASE_WEIGHTS = {
    fetching: 60,      // Biggest bottleneck
    reconciling: 20,
    cogs: 10,
    generating: 8,
    validating: 2,
  };

  let overallProgress = 0;

  switch (progress.phase) {
    case 'fetching':
      if (progress.ordersFound && progress.transactionsFetched) {
        const fetchProgress = (progress.transactionsFetched / progress.ordersFound) * 100;
        overallProgress = (fetchProgress / 100) * PHASE_WEIGHTS.fetching;
      }
      break;

    case 'reconciling':
      overallProgress = PHASE_WEIGHTS.fetching; // Fetching complete
      if (progress.ordersFound && progress.ordersProcessed) {
        const reconProgress = (progress.ordersProcessed / progress.ordersFound) * 100;
        overallProgress += (reconProgress / 100) * PHASE_WEIGHTS.reconciling;
      }
      break;

    case 'cogs':
      overallProgress = PHASE_WEIGHTS.fetching + PHASE_WEIGHTS.reconciling;
      if (progress.ordersProcessed && progress.ordersFound) {
        const cogsProgress = (progress.ordersProcessed / progress.ordersFound) * 100;
        overallProgress += (cogsProgress / 100) * PHASE_WEIGHTS.cogs;
      }
      break;

    case 'generating':
      overallProgress = PHASE_WEIGHTS.fetching + PHASE_WEIGHTS.reconciling + PHASE_WEIGHTS.cogs;
      if (progress.filesTotalCount && progress.filesGenerated) {
        const fileProgress = (progress.filesGenerated / progress.filesTotalCount) * 100;
        overallProgress += (fileProgress / 100) * PHASE_WEIGHTS.generating;
      }
      break;

    case 'validating':
      overallProgress = 98; // Almost done
      break;
  }

  return Math.min(Math.round(overallProgress), 99); // Never show 100% until actually complete
}

/**
 * Log progress in a format useful for watching logs
 */
function logProgress(jobId: string, progress: ExportJob['progress']): void {
  if (!progress) return;

  const elapsed = progress.startTime
    ? formatDuration((Date.now() - progress.startTime) / 1000)
    : '0s';

  const remaining = progress.estimatedSecondsRemaining
    ? formatDuration(progress.estimatedSecondsRemaining)
    : 'calculating...';

  let details = '';
  // Jobs that set an explicit currentActivity (e.g. COGS push) describe their own
  // progress; prefer it over the export-centric phase wording below.
  if (progress.currentActivity) {
    details = progress.currentActivity;
  } else {
    switch (progress.phase) {
      case 'fetching':
        details = `Orders: ${progress.transactionsFetched || 0}/${progress.ordersFound || '?'}`;
        break;
      case 'reconciling':
        details = `Matched: ${progress.ordersProcessed || 0} orders with captures`;
        break;
      case 'cogs':
        details = `COGS: ${progress.ordersProcessed || 0}/${progress.ordersFound || '?'} orders`;
        break;
      case 'generating':
        details = `Files: ${progress.filesGenerated || 0}/${progress.filesTotalCount || '?'}`;
        break;
      case 'validating':
        details = 'Running quality checks...';
        break;
    }
  }

  console.log(
    `[Job ${jobId.split('_')[2]}] ${progress.overallPercentage}% | ` +
    `${progress.phaseLabel} | ${details} | ` +
    `Elapsed: ${elapsed} | Est. remaining: ${remaining}`
  );
}

/**
 * Format seconds into human-readable duration (2m 30s)
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${minutes}m ${secs}s`;
}
