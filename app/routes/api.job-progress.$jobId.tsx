import type { LoaderFunctionArgs } from 'react-router';
import { getJobStatus } from '../services/background-jobs.server';

/**
 * GET /api/job-progress/{jobId}
 * Returns current progress data for a job
 */
export async function loader({ params }: LoaderFunctionArgs) {
  const { jobId } = params;

  if (!jobId) {
    return Response.json({ error: 'Job ID required' }, { status: 400 });
  }

  const job = await getJobStatus(jobId);

  if (!job) {
    return Response.json({ error: 'Job not found' }, { status: 404 });
  }

  // Return job status and progress
  return Response.json({
    id: job.id,
    status: job.status,
    startDate: job.startDate,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
    progress: job.progress,
    result: job.result,
  });
}
