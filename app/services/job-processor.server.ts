import { getJobStatus, updateJobStatus, cleanupOldJobs, getShopJobs } from './background-jobs.server';
import { processExport } from './batch-processor.server';
import { format } from 'date-fns';

let isProcessing = false;

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

    console.log(`[Job ${jobId}] Starting export for ${shop}`);

    // Check if date range or single date
    const useRange = !!job.endDate;

    if (useRange && job.endDate) {
      // Date range processing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allFiles: any[] = [];
      let totalEntries = 0;
      let allBalanced = true;
      const dates: string[] = [];

      const currentDate = new Date(job.startDate);
      const endDate = new Date(job.endDate);

      while (currentDate <= endDate) {
        const dateStr = format(currentDate, 'yyyy-MM-dd');
        dates.push(dateStr);

        const result = await processExport(
          shop,
          accessToken,
          dateStr,
          job.fileOptions
        );

        // Append date to filenames for clarity
        const dateLabel = format(currentDate, 'MMM-dd');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result.files.forEach((file: any) => {
          const nameParts = file.filename.split('.');
          const ext = nameParts.pop();
          const baseName = nameParts.join('.');
          file.filename = `${baseName}_${dateLabel}.${ext}`;
          file.date = dateStr;
        });

        allFiles.push(...result.files);
        totalEntries += result.entryCount;
        if (!result.balanced) allBalanced = false;

        currentDate.setDate(currentDate.getDate() + 1);
      }

      // Mark as completed
      await updateJobStatus(jobId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        result: {
          success: true,
          message: `Export completed for ${dates.length} days (${format(new Date(job.startDate), 'MMM d')} - ${format(endDate, 'MMM d, yyyy')})`,
          files: allFiles,
          entryCount: totalEntries,
          balanced: allBalanced,
          dateRange: { start: job.startDate, end: job.endDate, count: dates.length },
        },
      });

      console.log(`[Job ${jobId}] Completed: ${dates.length} days, ${totalEntries} entries`);
    } else {
      // Single date processing
      const result = await processExport(
        shop,
        accessToken,
        job.startDate,
        job.fileOptions
      );

      // Mark as completed
      await updateJobStatus(jobId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        result: {
          success: true,
          message: 'Export completed successfully',
          filename: result.filename,
          files: result.files,
          entryCount: result.entryCount,
          balanced: result.balanced,
        },
      });

      console.log(`[Job ${jobId}] Completed: ${result.entryCount} entries`);
    }
  } catch (error) {
    console.error(`[Job ${jobId}] Failed:`, error);

    // Mark as failed
    await updateJobStatus(jobId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Process pending jobs for a shop
 */
export async function processPendingJobs(shop: string, accessToken: string): Promise<void> {
  if (isProcessing) {
    console.log(`[Job Processor] Already processing jobs for ${shop}`);
    return;
  }

  isProcessing = true;

  try {
    const jobs = await getShopJobs(shop);
    const pendingJobs = jobs.filter((job) => job.status === 'pending');

    console.log(`[Job Processor] Found ${pendingJobs.length} pending jobs for ${shop}`);

    for (const job of pendingJobs) {
      await processJob(job.id, shop, accessToken);
    }

    // Cleanup old jobs
    await cleanupOldJobs();
  } catch (error) {
    console.error('[Job Processor] Error processing jobs:', error);
  } finally {
    isProcessing = false;
  }
}
