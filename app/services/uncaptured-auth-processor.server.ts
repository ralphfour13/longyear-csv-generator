import { updateJobProgress } from './background-jobs.server';
import {
  generateUncapturedAuthReport,
  type UncapturedAuthReport,
} from './uncaptured-auth-report.server';

/**
 * Process an uncaptured authorization report as a background job.
 * Wraps generateUncapturedAuthReport with job progress tracking.
 */
export async function processUncapturedAuthReport(
  shop: string,
  accessToken: string,
  sinceDate: string,
  jobId: string,
): Promise<UncapturedAuthReport> {
  await updateJobProgress(jobId, {
    phase: 'fetching',
    phaseLabel: 'Scanning orders',
    currentActivity: `Fetching orders since ${sinceDate}...`,
    overallPercentage: 5,
    startTime: Date.now(),
  });

  const report = await generateUncapturedAuthReport(
    shop,
    accessToken,
    sinceDate,
    async (progress) => {
      await updateJobProgress(jobId, progress);
    },
  );

  return report;
}
