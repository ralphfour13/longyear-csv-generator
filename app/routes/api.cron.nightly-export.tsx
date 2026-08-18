import type { LoaderFunctionArgs } from 'react-router';
import { processExport, calculateExportDates } from '../services/batch-processor.server';
import { runExportStepsWithinBudget } from '../services/export-steps.server';
import { createExportJob } from '../services/background-jobs.server';
import { getShopConfig } from '../services/storage-adapter.server';
import { logInfo, logError } from '../services/error-logger.server';
import prisma from '../db.server';

/** Mirrors the job processor: chunk exports wherever a function timeout applies. */
const CHUNKED_EXPORTS = process.env.CHUNKED_EXPORTS
  ? process.env.CHUNKED_EXPORTS === '1'
  : process.env.VERCEL === '1' || process.env.VERCEL_ENV !== undefined;

/**
 * Total time this handler may spend, kept under the `maxDuration` in vercel.json (60s)
 * so it returns a response rather than being killed.
 */
const CRON_BUDGET_MS = 50_000;

/**
 * Vercel Cron Job for nightly exports
 * Runs daily at 2:00 AM (configured in vercel.json)
 *
 * This replaces the node-cron scheduler for serverless deployment
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Verify this is a legitimate Vercel cron request
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    console.error('Unauthorized cron request');
    return new Response('Unauthorized', { status: 401 });
  }

  const cronStartedAt = Date.now();

  try {
    await logInfo('system', 'Cron', 'Starting nightly export cron job');

    // Get all shops with enabled sync from database
    const sessions = await prisma.session.findMany({
      where: {
        accessToken: { not: '' },
      },
    });

    const results = [];

    for (const session of sessions) {
      const shop = session.shop;

      try {
        const config = await getShopConfig(shop);

        // Only process shops with nightly sync enabled
        if (config.syncEnabled && config.syncSchedule === 'nightly') {
          await logInfo(shop, 'Cron', 'Processing nightly export');

          const { startDate } = calculateExportDates(config.autoExportDate);

          if (CHUNKED_EXPORTS) {
            // Running the export inline would outlive the function timeout and be
            // killed partway through. Queue it, then spend the remaining invocation
            // budget draining steps. Anything unfinished stays checkpointed on the
            // job and resumes on the next run.
            const jobId = await createExportJob(shop, startDate, undefined, {});
            const spent = Date.now() - cronStartedAt;
            const outcome = await runExportStepsWithinBudget(
              jobId,
              session.accessToken!,
              CRON_BUDGET_MS - spent,
            );

            results.push({
              shop,
              success: true,
              jobId,
              complete: outcome.done,
              filesSoFar: outcome.files.length,
            });

            await logInfo(
              shop,
              'Cron',
              outcome.done
                ? `Export completed via job ${jobId}`
                : `Export queued as job ${jobId}; ${outcome.files.length} file(s) done, remainder will resume`,
            );
          } else {
            const result = await processExport(
              shop,
              session.accessToken!,
              startDate
            );

            results.push({
              shop,
              success: true,
              filename: result.filename,
              entryCount: result.entryCount,
            });

            await logInfo(shop, 'Cron', `Export completed: ${result.filename}`);
          }
        }
      } catch (error) {
        await logError(shop, 'Cron', error as Error);

        results.push({
          shop,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await logInfo('system', 'Cron', `Nightly export completed: ${results.length} shops processed`);

    return Response.json({
      success: true,
      timestamp: new Date().toISOString(),
      processed: results.length,
      results,
    });
  } catch (error) {
    await logError('system', 'Cron', error as Error);

    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Cron job failed',
      },
      { status: 500 }
    );
  }
};
