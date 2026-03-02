import type { LoaderFunctionArgs } from 'react-router';
import { useLoaderData, useRevalidator } from 'react-router';
import { useEffect, useState } from 'react';
import { authenticate } from '../shopify.server';
import { getShopJobs, type ExportJob } from '../services/background-jobs.server';
import { format } from 'date-fns';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Get all jobs for this shop
  const jobs = await getShopJobs(shop);

  return Response.json({ shop, jobs });
};

export default function Jobs() {
  const { shop, jobs: initialJobs } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Auto-refresh every 15 seconds if there are pending or processing jobs
  useEffect(() => {
    const hasActiveJobs = initialJobs.some(
      (job: ExportJob) => job.status === 'pending' || job.status === 'processing'
    );

    if (hasActiveJobs) {
      const interval = setInterval(() => {
        revalidator.revalidate();
      }, 15000);

      return () => clearInterval(interval);
    }
  }, [initialJobs, revalidator]);

  // Filter jobs based on status filter
  const filteredJobs = statusFilter === 'all'
    ? initialJobs
    : initialJobs.filter((job: ExportJob) => job.status === statusFilter);

  // Count jobs by status
  const statusCounts = {
    all: initialJobs.length,
    pending: initialJobs.filter((j: ExportJob) => j.status === 'pending').length,
    processing: initialJobs.filter((j: ExportJob) => j.status === 'processing').length,
    completed: initialJobs.filter((j: ExportJob) => j.status === 'completed').length,
    failed: initialJobs.filter((j: ExportJob) => j.status === 'failed').length,
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

  // Format date range
  const formatDateRange = (job: ExportJob) => {
    if (job.endDate) {
      return `${format(new Date(job.startDate), 'MMM d')} - ${format(new Date(job.endDate), 'MMM d, yyyy')}`;
    }
    return format(new Date(job.startDate), 'MMM d, yyyy');
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

  // Download handler
  const handleDownload = (filename: string) => {
    const url = `https://sage50-sync.four13.dev/api/download-csv?shop=${shop}&filename=${filename}`;
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

      {/* Status Filter Tabs */}
      <s-section style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {(['all', 'pending', 'processing', 'completed', 'failed'] as const).map((status) => (
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

      {/* Jobs Table */}
      <s-section>
        {filteredJobs.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center' }}>
            <s-text variant="bodyMd" style={{ color: '#6D7175' }}>
              No {statusFilter !== 'all' ? statusFilter : ''} jobs found.
            </s-text>
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
                    Date Range
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
                    <td style={{ padding: '12px' }}>
                      <s-text variant="bodySm" style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                        {job.id.split('_').slice(-1)[0]}
                      </s-text>
                    </td>
                    <td style={{ padding: '12px' }}>
                      {getStatusBadge(job.status)}
                    </td>
                    <td style={{ padding: '12px' }}>
                      <s-text variant="bodySm">
                        {formatDateRange(job)}
                      </s-text>
                    </td>
                    <td style={{ padding: '12px' }}>
                      <s-text variant="bodySm">
                        {format(new Date(job.createdAt), 'MMM d, h:mm a')}
                      </s-text>
                    </td>
                    <td style={{ padding: '12px' }}>
                      <s-text variant="bodySm">
                        {getDuration(job)}
                      </s-text>
                    </td>
                    <td style={{ padding: '12px' }}>
                      {job.status === 'completed' && job.result?.files ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {job.result.files.slice(0, 3).map((file: any, idx: number) => (
                            <button
                              key={idx}
                              onClick={() => handleDownload(file.filename)}
                              style={{
                                padding: '4px 8px',
                                fontSize: '11px',
                                color: '#008060',
                                backgroundColor: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                textAlign: 'left',
                                textDecoration: 'underline',
                              }}
                            >
                              {file.filename.split('_')[0]}
                            </button>
                          ))}
                          {job.result.files.length > 3 && (
                            <s-text variant="bodySm" style={{ color: '#6D7175', fontSize: '11px' }}>
                              +{job.result.files.length - 3} more
                            </s-text>
                          )}
                        </div>
                      ) : job.status === 'failed' ? (
                        <s-text variant="bodySm" style={{ color: '#D72C0D', fontSize: '11px' }}>
                          {job.error || 'Unknown error'}
                        </s-text>
                      ) : job.status === 'processing' ? (
                        <s-text variant="bodySm" style={{ color: '#0D5EAF', fontSize: '11px' }}>
                          Processing...
                        </s-text>
                      ) : (
                        <s-text variant="bodySm" style={{ color: '#6D7175', fontSize: '11px' }}>
                          Pending
                        </s-text>
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
      {statusCounts.pending + statusCounts.processing > 0 && (
        <s-banner tone="info" style={{ marginTop: '20px' }}>
          <s-text variant="bodySm">
            🔄 Auto-refreshing every 15 seconds while jobs are active
          </s-text>
        </s-banner>
      )}
    </s-page>
  );
}
