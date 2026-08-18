import type { LoaderFunctionArgs } from 'react-router';
import { processExport, calculateExportDates } from '../services/batch-processor.server';
import { getShopConfig } from '../services/storage-adapter.server';
import { logInfo, logError } from '../services/error-logger.server';
import prisma from '../db.server';

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
