import { getJobStatus, updateJobStatus, cleanupOldJobs, getShopJobs } from './background-jobs.server';
import { processExport } from './batch-processor.server';

// Track processing state per shop to prevent concurrent processing of the same shop's jobs
// Key: shop domain, Value: true if currently processing
const processingShops = new Map<string, boolean>();

/**
 * Process a single export job
 */
async function processJob(jobId: string, shop: string, accessToken: string): Promise<void> {
  const job = await getJobStatus(jobId);
  if (!job || job.status !== 'pending') {
    return;
  }

  try {
    // Mark as processing
    await updateJobStatus(jobId, {
      status: 'processing',
      startedAt: new Date().toISOString(),
    });

    const startTime = Date.now();
    console.log(
      `[Job ${jobId}] Starting export for ${shop}`,
      `\n  Date: ${job.startDate}`,
      `\n  Files: ${Object.entries(job.fileOptions).filter(([, v]) => v).map(([k]) => k).join(', ')}`
    );

    // All jobs are now single-date exports (date ranges are split into separate jobs)
    const result = await processExport(
      shop,
      accessToken,
      job.startDate,
      job.fileOptions,
      jobId  // Pass jobId for progress tracking
    );

    // Mark as completed
    await updateJobStatus(jobId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      progress: undefined,  // Clear progress on completion
      result: {
        success: true,
        message: `Export completed for ${job.startDate}`,
        filename: result.filename,
        files: result.files,
        entryCount: result.entryCount,
        balanced: result.balanced,
      },
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `[Job ${jobId}] ✓ Completed in ${duration}s`,
      `\n  Entries: ${result.entryCount}`,
      `\n  Files: ${result.files.length}`,
      `\n  Balanced: ${result.balanced ? 'YES' : 'NO'}`
    );
  } catch (error) {
    console.error(`[Job ${jobId}] Failed:`, error);

    // Mark as failed
    await updateJobStatus(jobId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      progress: undefined,  // Clear progress on failure
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Process pending jobs for a shop
 */
export async function processPendingJobs(shop: string, accessToken: string): Promise<void> {
  // Check if this shop is already processing jobs
  if (processingShops.get(shop)) {
    console.log(`[Job Processor] Already processing jobs for ${shop}`);
    return;
  }

  // Mark this shop as processing
  processingShops.set(shop, true);

  try {
    // Loop to pick up jobs added while we were processing the previous batch
    let hasMore = true;
    while (hasMore) {
      const jobs = await getShopJobs(shop);
      const pendingJobs = jobs.filter((job) => job.status === 'pending');

      if (pendingJobs.length === 0) {
        hasMore = false;
        break;
      }

      console.log(`[Job Processor] Found ${pendingJobs.length} pending jobs for ${shop}`);

      for (const job of pendingJobs) {
        await processJob(job.id, shop, accessToken);
      }
    }

    // Cleanup old jobs
    await cleanupOldJobs();
  } catch (error) {
    console.error('[Job Processor] Error processing jobs:', error);
  } finally {
    // Mark this shop as no longer processing
    processingShops.delete(shop);
  }
}
