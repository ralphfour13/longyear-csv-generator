import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { useLoaderData, useRevalidator, useActionData, Form } from 'react-router';
import { useEffect, useState } from 'react';
import { authenticate } from '../shopify.server';
import { getShopJobs, getJobStatus, createExportJob, clearCompletedJobs, clearFailedJobs, cancelPendingJobs, cancelAllProcessingJobs, type ExportJob } from '../services/background-jobs.server';
import { processPendingJobs } from '../services/job-processor.server';
import { format } from 'date-fns';
import { JobProgressBar } from '../components/JobProgressBar';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Get all jobs for this shop
  const allJobs = await getShopJobs(shop);

  // Separate active jobs (pending/processing) from completed/failed
  const activeJobs = allJobs.filter(
    job => job.status === 'pending' || job.status === 'processing'
  );
  const completedJobs = allJobs.filter(
    job => job.status === 'completed' || job.status === 'failed'
  );

  return { shop, allJobs, activeJobs, completedJobs };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const actionType = formData.get('action');

  if (actionType === 'clearCompleted') {
    const count = await clearCompletedJobs(shop);
    return { success: true, message: `Cleared ${count} completed/failed jobs`, count };
  }

  if (actionType === 'clearFailed') {
    const count = await clearFailedJobs(shop);
    return { success: true, message: `Cleared ${count} failed jobs`, count };
  }

  if (actionType === 'cancelPending') {
    const count = await cancelPendingJobs(shop);
    return { success: true, message: `Cancelled ${count} pending jobs`, count };
  }

  if (actionType === 'cancelProcessing') {
    // Cancel ALL processing jobs (user-initiated, no time limit)
    const count = await cancelAllProcessingJobs(shop);
    return { success: true, message: `Cancelled ${count} processing jobs`, count };
  }

  if (actionType === 'retryJob') {
    const jobId = formData.get('jobId');
    if (!jobId || typeof jobId !== 'string') {
      return { success: false, error: 'Job ID required' };
    }

    const job = await getJobStatus(jobId);
    if (!job || job.status !== 'failed') {
      return { success: false, error: 'Can only retry failed jobs' };
    }

    // Create a new job with the same parameters
    const newJobId = await createExportJob(shop, job.startDate, job.endDate, job.fileOptions);

    // Start processing in background
    const accessToken = session.accessToken || '';
    processPendingJobs(shop, accessToken).catch((error) => {
      console.error('Retry job processing error:', error);
    });

    return {
      success: true,
      message: `Retrying export for ${job.startDate}. New job created.`,
      newJobId,
    };
  }

  if (actionType === 'processPending') {
    // Manually trigger job processing for pending jobs
    try {
      const accessToken = session.accessToken || '';

      // Get pending job count before processing
      const jobs = await getShopJobs(shop);
      const pendingCount = jobs.filter(j => j.status === 'pending').length;

      if (pendingCount === 0) {
        return { success: true, message: 'No pending jobs to process' };
      }

      // Trigger job processing in background (don't await to avoid blocking)
      processPendingJobs(shop, accessToken).catch((error) => {
        console.error('Manual job processing error:', error);
      });

      return {
        success: true,
        message: `Started processing ${pendingCount} pending job${pendingCount === 1 ? '' : 's'}. Refresh to see progress.`,
        count: pendingCount
      };
    } catch (error) {
      console.error('Process pending jobs error:', error);
      return {
        success: false,
        error: `Failed to start job processing: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  return { success: false, error: 'Unknown action' };
};

export default function Jobs() {
  const { shop, allJobs, activeJobs, completedJobs } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const revalidator = useRevalidator();
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Auto-refresh every 5 minutes if there are pending or processing jobs
  useEffect(() => {
    if (activeJobs.length > 0) {
      const interval = setInterval(() => {
        revalidator.revalidate();
      }, 300000);

      return () => clearInterval(interval);
    }
  }, [activeJobs.length, revalidator]);

  // Filter completed jobs based on status filter
  const filteredJobs = statusFilter === 'all'
    ? completedJobs
    : completedJobs.filter((job: ExportJob) => job.status === statusFilter);

  // Count jobs by status
  const statusCounts = {
    all: allJobs.length,
    pending: allJobs.filter((j: ExportJob) => j.status === 'pending').length,
    processing: allJobs.filter((j: ExportJob) => j.status === 'processing').length,
    completed: allJobs.filter((j: ExportJob) => j.status === 'completed').length,
    failed: allJobs.filter((j: ExportJob) => j.status === 'failed').length,
  };

  // Get status badge styling
  const getStatusBadge = (status: string) => {
    const styles = {
      pending: { bg: '#FFF4E5', color: '#916A00', label: 'Pending' },
      processing: { bg: '#E3F2FD', color: '#0D5EAF', label: 'Processing' },
      completed: { bg: '#E3F5ED', color: '#008060', label: 'Completed' },
      failed: { bg: '#FFEAE8', color: '#D72C0D', label: 'Failed' },
    };

    const style = styles[status as keyof typeof styles] || styles.pending;

    return (
      <span
        style={{
          padding: '4px 12px',
          borderRadius: '12px',
          backgroundColor: style.bg,
          color: style.color,
          fontSize: '12px',
          fontWeight: 600,
          textTransform: 'uppercase',
        }}
      >
        {style.label}
      </span>
    );
  };

  // Format date - parse YYYY-MM-DD strings without timezone conversion
  const formatDateString = (dateStr: string): string => {
    const [year, month, day] = dateStr.split('-').map(Number);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[month - 1]} ${day}, ${year}`;
  };

  // Calculate duration
  const getDuration = (job: ExportJob) => {
    if (!job.startedAt) return '—';

    const start = new Date(job.startedAt).getTime();
    const end = job.completedAt ? new Date(job.completedAt).getTime() : Date.now();
    const durationMs = end - start;

    const seconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  // Download handler for job zip
  const handleDownloadJobZip = (jobId: string) => {
    const url = `https://sage50-sync.four13.dev/api/download-job-zip?shop=${shop}&jobId=${jobId}`;
    window.open(url, '_blank');
  };

  return (
    <s-page heading="Job Queue">
      <s-button
        slot="primary-action"
        href="/app/exports"
        variant="primary"
      >
        New Export
      </s-button>

      {/* Action feedback */}
      {actionData?.success && (
        <div style={{ marginBottom: '20px' }}>
          <s-banner tone="success">
            {actionData.message}
          </s-banner>
        </div>
      )}

      {/* Clear/Cancel Actions */}
      <div style={{ marginBottom: '20px' }}>
        <s-section>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: '14px', color: '#202223' }}>Queue Actions:</span>
            <Form method="post" style={{ display: 'inline' }}>
              <input type="hidden" name="action" value="clearCompleted" />
              <button
                type="submit"
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: '1px solid #C9CCCF',
                  backgroundColor: '#ffffff',
                  color: '#202223',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                disabled={statusCounts.completed + statusCounts.failed === 0}
              >
                🗑️ Clear Completed ({statusCounts.completed + statusCounts.failed})
              </button>
            </Form>
            <Form method="post" style={{ display: 'inline' }}>
              <input type="hidden" name="action" value="clearFailed" />
              <button
                type="submit"
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: '1px solid #C9CCCF',
                  backgroundColor: '#ffffff',
                  color: '#D72C0D',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                disabled={statusCounts.failed === 0}
              >
                🗑️ Clear Failed ({statusCounts.failed})
              </button>
            </Form>
            <Form method="post" style={{ display: 'inline' }}>
              <input type="hidden" name="action" value="cancelPending" />
              <button
                type="submit"
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: '1px solid #C9CCCF',
                  backgroundColor: '#ffffff',
                  color: '#D72C0D',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                disabled={statusCounts.pending === 0}
              >
                ❌ Cancel Pending ({statusCounts.pending})
              </button>
            </Form>
            <Form method="post" style={{ display: 'inline' }}>
              <input type="hidden" name="action" value="cancelProcessing" />
              <button
                type="submit"
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: '1px solid #C9CCCF',
                  backgroundColor: '#ffffff',
                  color: '#D72C0D',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                disabled={statusCounts.processing === 0}
              >
                ⏹️ Cancel Processing ({statusCounts.processing})
              </button>
            </Form>
            <Form method="post" style={{ display: 'inline' }}>
              <input type="hidden" name="action" value="processPending" />
              <button
                type="submit"
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: '1px solid #008060',
                  backgroundColor: '#008060',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                disabled={statusCounts.pending === 0}
              >
                ▶️ Process Pending ({statusCounts.pending})
              </button>
            </Form>
          </div>
        </s-section>
      </div>

      {/* Active Jobs Section */}
      {activeJobs.length > 0 && (
        <div style={{ marginBottom: '32px' }}>
          <div style={{ marginBottom: '16px' }}>
            <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#202223', margin: 0 }}>
              Active Jobs
            </h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {activeJobs.map((job: ExportJob) => (
              <JobProgressBar
                key={job.id}
                jobId={job.id}
                onComplete={() => {
                  // Refresh job list when job completes
                  revalidator.revalidate();
                }}
                onError={(error) => {
                  console.error('Job error:', error);
                  // Refresh job list when job fails
                  revalidator.revalidate();
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Job History Section */}
      <div style={{ marginBottom: '16px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#202223', margin: 0 }}>
          Job History
        </h2>
      </div>

      {/* Status Filter Tabs */}
      <div style={{ marginBottom: '20px' }}>
        <s-section>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {(['all', 'completed', 'failed'] as const).map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: '1px solid #C9CCCF',
                  backgroundColor: statusFilter === status ? '#008060' : '#ffffff',
                  color: statusFilter === status ? '#ffffff' : '#202223',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                  transition: 'all 0.2s',
                }}
              >
                {status} ({statusCounts[status]})
              </button>
            ))}
          </div>
        </s-section>
      </div>

      {/* Jobs Table */}
      <s-section>
        {filteredJobs.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#6D7175' }}>
            No {statusFilter !== 'all' ? statusFilter : ''} jobs found.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #E1E3E5' }}>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600, fontSize: '12px', color: '#6D7175', textTransform: 'uppercase' }}>
                    Job ID
                  </th>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600, fontSize: '12px', color: '#6D7175', textTransform: 'uppercase' }}>
                    Status
                  </th>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600, fontSize: '12px', color: '#6D7175', textTransform: 'uppercase' }}>
                    Date
                  </th>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600, fontSize: '12px', color: '#6D7175', textTransform: 'uppercase' }}>
                    Created
                  </th>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600, fontSize: '12px', color: '#6D7175', textTransform: 'uppercase' }}>
                    Duration
                  </th>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600, fontSize: '12px', color: '#6D7175', textTransform: 'uppercase' }}>
                    Results
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredJobs.map((job: ExportJob) => (
                  <tr
                    key={job.id}
                    style={{
                      borderBottom: '1px solid #E1E3E5',
                      backgroundColor: '#ffffff',
                      transition: 'background-color 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#F6F6F7';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = '#ffffff';
                    }}
                  >
                    <td style={{ padding: '12px', fontFamily: 'monospace', fontSize: '11px' }}>
                      {job.id.split('_').slice(-1)[0]}
                    </td>
                    <td style={{ padding: '12px' }}>
                      {getStatusBadge(job.status)}
                    </td>
                    <td style={{ padding: '12px', fontSize: '14px' }}>
                      {formatDateString(job.startDate)}
                    </td>
                    <td style={{ padding: '12px', fontSize: '14px' }}>
                      {format(new Date(job.createdAt), 'MMM d, h:mm a')}
                    </td>
                    <td style={{ padding: '12px', fontSize: '14px' }}>
                      {getDuration(job)}
                    </td>
                    <td style={{ padding: '12px' }}>
                      {job.status === 'completed' && job.result?.files && job.result.files.length > 0 ? (
                        <button
                          onClick={() => handleDownloadJobZip(job.id)}
                          style={{
                            padding: '6px 12px',
                            fontSize: '12px',
                            color: '#008060',
                            backgroundColor: '#E3F5ED',
                            border: '1px solid #B3E0D1',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          📦 Download ({job.result.files.length} {job.result.files.length === 1 ? 'file' : 'files'})
                        </button>
                      ) : job.status === 'failed' ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ color: '#D72C0D', fontSize: '11px' }}>
                            {job.error || 'Unknown error'}
                          </span>
                          <Form method="post" style={{ display: 'inline', flexShrink: 0 }}>
                            <input type="hidden" name="action" value="retryJob" />
                            <input type="hidden" name="jobId" value={job.id} />
                            <button
                              type="submit"
                              style={{
                                padding: '4px 10px',
                                fontSize: '12px',
                                color: '#0D5EAF',
                                backgroundColor: '#E3F2FD',
                                border: '1px solid #B3D4FC',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontWeight: 600,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              Retry
                            </button>
                          </Form>
                        </div>
                      ) : job.status === 'processing' ? (
                        <span style={{ color: '#0D5EAF', fontSize: '11px' }}>
                          Processing...
                        </span>
                      ) : (
                        <span style={{ color: '#6D7175', fontSize: '11px' }}>
                          Pending
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </s-section>

      {/* Auto-refresh indicator */}
      {activeJobs.length > 0 && (
        <div style={{ marginTop: '20px' }}>
          <s-banner tone="info">
            🔄 Auto-refreshing every 5 minutes ({activeJobs.length} active {activeJobs.length === 1 ? 'job' : 'jobs'})
          </s-banner>
        </div>
      )}
    </s-page>
  );
}
