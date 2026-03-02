import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Form, useActionData, useLoaderData, useNavigation, useFetcher, useRevalidator } from 'react-router';
import { useEffect, useState, useRef } from 'react';
import { authenticate } from '../shopify.server';
import { listExports, getExportStats } from '../services/storage.server';
import { format } from 'date-fns';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const exportFiles = await listExports(shop);

  const exports = await Promise.all(
    exportFiles.slice(0, 20).map(async (filename) => {
      const stats = await getExportStats(shop, filename);
      return stats;
    })
  );

  return Response.json({ shop, exports });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const action = formData.get('action');

  // Check job status
  if (action === 'checkJob') {
    const jobId = formData.get('jobId');
    if (!jobId || typeof jobId !== 'string') {
      return Response.json({ success: false, error: 'Job ID required' }, { status: 400 });
    }

    const { getJobStatus } = await import('../services/background-jobs.server');
    const job = await getJobStatus(jobId);

    if (!job) {
      return Response.json({ success: false, error: 'Job not found' }, { status: 404 });
    }

    return Response.json({
      success: true,
      job,
    });
  }

  if (action === 'export') {
    const useRange = formData.get('useRange') === 'true';
    const fileOptions = {
      generateDailySales: formData.get('generateDailySales') === 'true',
      generatePayoutsOrders: formData.get('generatePayoutsOrders') === 'true',
      generateJournalDetails: formData.get('generateJournalDetails') === 'true',
      generateJournalSummary: formData.get('generateJournalSummary') === 'true',
      generateCogsDetails: formData.get('generateCogsDetails') === 'true',
      generateReconciliation: formData.get('generateReconciliation') === 'true',
    };

    try {
      const { createExportJob } = await import('../services/background-jobs.server');
      const { processPendingJobs } = await import('../services/job-processor.server');

      if (useRange) {
        // Date range mode
        const startDateParam = formData.get('startDate');
        const endDateParam = formData.get('endDate');

        if (!startDateParam || typeof startDateParam !== 'string' ||
            !endDateParam || typeof endDateParam !== 'string') {
          return Response.json(
            { success: false, error: 'Start and end dates are required' },
            { status: 400 }
          );
        }

        const startDate = new Date(startDateParam);
        const endDate = new Date(endDateParam);

        if (startDate > endDate) {
          return Response.json(
            { success: false, error: 'Start date must be before end date' },
            { status: 400 }
          );
        }

        // Create background job
        const jobId = await createExportJob(
          shop,
          startDateParam,
          endDateParam,
          fileOptions
        );

        // Start processing in background (don't await)
        processPendingJobs(shop, session.accessToken).catch((error) => {
          console.error('Background job processing error:', error);
        });

        const dayCount = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

        return Response.json({
          success: true,
          processing: true,
          jobId,
          message: `Export started for ${dayCount} days (${format(startDate, 'MMM d')} - ${format(endDate, 'MMM d, yyyy')}). Processing in background...`,
          dateRange: { start: startDateParam, end: endDateParam, count: dayCount },
        });
      } else {
        // Single date mode
        const dateParam = formData.get('date');

        if (!dateParam || typeof dateParam !== 'string') {
          return Response.json(
            { success: false, error: 'Export date is required' },
            { status: 400 }
          );
        }

        // Create background job
        const jobId = await createExportJob(
          shop,
          dateParam,
          undefined,
          fileOptions
        );

        // Start processing in background (don't await)
        processPendingJobs(shop, session.accessToken).catch((error) => {
          console.error('Background job processing error:', error);
        });

        return Response.json({
          success: true,
          processing: true,
          jobId,
          message: `Export started for ${dateParam}. Processing in background...`,
        });
      }
    } catch (error) {
      console.error('Export error:', error);
      return Response.json(
        {
          success: false,
          error: `Export failed: ${error instanceof Error ? error.message : String(error)}`,
        },
        { status: 500 }
      );
    }
  }

  return Response.json({ success: false, error: 'Invalid action' }, { status: 400 });
};

export default function Exports() {
  const { shop, exports } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();

  const isExporting = navigation.state === 'submitting';
  const [useRange, setUseRange] = useState(false);
  const [autoDownload, setAutoDownload] = useState(false);
  const [generateDailySales, setGenerateDailySales] = useState(true);
  const [generatePayoutsOrders, setGeneratePayoutsOrders] = useState(true);
  const [generateJournalDetails, setGenerateJournalDetails] = useState(true);
  const [generateJournalSummary, setGenerateJournalSummary] = useState(true);
  const [generateCogsDetails, setGenerateCogsDetails] = useState(true);
  const [generateReconciliation, setGenerateReconciliation] = useState(true);
  const [currentJob, setCurrentJob] = useState<any>(null);
  const [jobStatus, setJobStatus] = useState<string>('');
  const fetcher = useFetcher();

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const defaultDate = format(yesterday, 'yyyy-MM-dd');

  // Download handler to bypass Shopify routing
  const handleDownload = (filename: string) => {
    const url = `https://sage50-sync.four13.dev/api/download-csv?shop=${shop}&filename=${filename}`;
    window.open(url, '_blank');
  };

  // Store polling interval ref so we can clear it when job completes
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Track which jobs have already triggered downloads to prevent repeated downloads
  const downloadedJobsRef = useRef<Set<string>>(new Set());
  const lastActionDataRef = useRef<any>(null);

  // Poll for job status when job is created
  useEffect(() => {
    if (actionData?.processing && actionData?.jobId) {
      setCurrentJob(actionData.jobId);
      setJobStatus('Processing...');

      pollIntervalRef.current = setInterval(() => {
        const formData = new FormData();
        formData.append('action', 'checkJob');
        formData.append('jobId', actionData.jobId);
        fetcher.submit(formData, { method: 'post' });
      }, 15000); // Poll every 15 seconds

      return () => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      };
    }
  }, [actionData, fetcher]);

  // Handle job status updates
  useEffect(() => {
    if (fetcher.data?.job) {
      const job = fetcher.data.job;

      if (job.status === 'completed') {
        setJobStatus('Completed!');
        setCurrentJob(null);

        // Stop polling when job completes
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }

        // Revalidate to refresh export history table
        revalidator.revalidate();

        // Trigger auto-download if enabled (only once per job)
        if (autoDownload && job.result?.files && !downloadedJobsRef.current.has(job.id)) {
          downloadedJobsRef.current.add(job.id);
          setTimeout(() => {
            job.result.files.forEach((file: any, index: number) => {
              if (!file.error) {
                setTimeout(() => {
                  const url = `https://sage50-sync.four13.dev/api/download-csv?shop=${shop}&filename=${file.filename}`;
                  window.open(url, '_blank');
                }, index * 300);
              }
            });
          }, 500);
        }
      } else if (job.status === 'failed') {
        setJobStatus(`Failed: ${job.error || 'Unknown error'}`);
        setCurrentJob(null);

        // Stop polling when job fails
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }

        // Revalidate even on failure to show any partial exports
        revalidator.revalidate();
      } else if (job.status === 'processing') {
        setJobStatus('Processing export...');
      }
    }
  }, [fetcher.data, autoDownload, shop, revalidator]);

  // Legacy: Auto-download all files when export completes immediately (backward compatibility)
  useEffect(() => {
    if (actionData?.success && actionData?.files && !actionData?.processing && autoDownload) {
      // Only trigger downloads if this is new actionData
      if (lastActionDataRef.current !== actionData) {
        lastActionDataRef.current = actionData;

        // Revalidate to refresh export history table
        revalidator.revalidate();

        // Small delay to ensure UI updates before downloads start
        setTimeout(() => {
          actionData.files.forEach((file: any, index: number) => {
            if (!file.error) {
              // Stagger downloads slightly to avoid browser blocking
              setTimeout(() => {
                const url = `https://sage50-sync.four13.dev/api/download-csv?shop=${shop}&filename=${file.filename}`;
                window.open(url, '_blank');
              }, index * 300); // 300ms between each download
            }
          });
        }, 500);
      }
    }
  }, [actionData, shop, autoDownload, revalidator]);

  return (
    <s-page heading="Export Center">
      {currentJob && (
        <s-banner tone="info" style={{ marginBottom: '20px' }}>
          <s-stack direction="block" gap="tight">
            <s-text variant="headingSm">Export in Progress</s-text>
            <s-text>{jobStatus}</s-text>
            <s-text variant="bodySm">This may take several minutes for large date ranges. You can refresh the page to check progress, or wait here.</s-text>
          </s-stack>
        </s-banner>
      )}

      {fetcher.data?.job?.status === 'completed' && fetcher.data?.job?.result && (
        <s-banner tone="success" style={{ marginBottom: '20px' }}>
          <s-stack direction="block" gap="base">
            <s-text variant="headingSm">{fetcher.data.job.result.message}</s-text>
            {fetcher.data.job.result.files && fetcher.data.job.result.files.length > 0 && (
              <s-stack direction="block" gap="tight">
                {fetcher.data.job.result.files.map((file: any) => {
                  let label = '';
                  let description = '';
                  if (file.type === 'daily-sales') {
                    label = 'Detailed Sales Report';
                    description = `${file.rowCount} transaction rows`;
                  } else if (file.type === 'payouts-orders') {
                    label = 'Payouts with Orders';
                    description = `${file.rowCount} order rows`;
                  } else if (file.type === 'journal-entries-details') {
                    label = 'Journal Entry Details';
                    description = `${file.rowCount} detailed entries`;
                  } else if (file.type === 'journal-entry-summary') {
                    label = 'Journal Entry';
                    description = `${file.rowCount} accounts, ${fetcher.data.job.result.balanced ? '✓ balanced' : '✗ unbalanced'}`;
                  } else if (file.type === 'daily-reconciliation') {
                    label = 'Daily Reconciliation';
                    description = `${file.rowCount} order rows`;
                  }

                  return (
                    <s-stack key={file.type} direction="inline" gap="tight" alignItems="center">
                      <s-text variant="bodySm"><strong>{label}:</strong></s-text>
                      {file.error ? (
                        <s-text tone="critical">{file.error}</s-text>
                      ) : (
                        <>
                          <button
                            onClick={() => handleDownload(file.filename)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--p-color-text-link)',
                              textDecoration: 'underline',
                              cursor: 'pointer',
                              padding: 0,
                              font: 'inherit',
                              fontWeight: 500,
                              marginLeft: '4px',
                            }}
                          >
                            {file.filename}
                          </button>
                          <s-text style={{ marginLeft: '4px' }}>({description})</s-text>
                        </>
                      )}
                    </s-stack>
                  );
                })}
              </s-stack>
            )}
          </s-stack>
        </s-banner>
      )}

      {fetcher.data?.job?.status === 'failed' && (
        <s-banner tone="critical" style={{ marginBottom: '20px' }}>
          <s-text>Export failed: {fetcher.data.job.error || 'Unknown error'}</s-text>
        </s-banner>
      )}

      {actionData?.success && actionData?.processing && (
        <s-banner tone="info" style={{ marginBottom: '20px' }}>
          <s-text>{actionData.message}</s-text>
        </s-banner>
      )}

      {actionData?.success && !actionData?.processing && (
        <s-banner tone="success" style={{ marginBottom: '20px' }}>
          <s-stack direction="block" gap="base">
            <s-text variant="headingSm">{actionData.message}</s-text>
            {actionData.files && actionData.files.length > 0 && (
              <s-stack direction="block" gap="tight">
                {actionData.files.map((file: any) => {
                  // Get file type label
                  let label = '';
                  let description = '';
                  if (file.type === 'daily-sales') {
                    label = 'Detailed Sales Report';
                    description = `${file.rowCount} transaction rows`;
                  } else if (file.type === 'payouts-orders') {
                    label = 'Payouts with Orders';
                    description = `${file.rowCount} order rows`;
                  } else if (file.type === 'journal-entries-details') {
                    label = 'Journal Entry Details';
                    description = `${file.rowCount} detailed entries`;
                  } else if (file.type === 'journal-entry-summary') {
                    label = 'Journal Entry';
                    description = `${file.rowCount} accounts, ${actionData.balanced ? '✓ balanced' : '✗ unbalanced'}`;
                  } else if (file.type === 'daily-reconciliation') {
                    label = 'Daily Reconciliation';
                    description = `${file.rowCount} order rows`;
                  }

                  return (
                    <s-stack key={file.type} direction="inline" gap="tight" alignItems="center">
                      <s-text variant="bodySm"><strong>{label}:</strong></s-text>
                      {file.error ? (
                        <s-text tone="critical">{file.error}</s-text>
                      ) : (
                        <>
                          <button
                            onClick={() => handleDownload(file.filename)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--p-color-text-link)',
                              textDecoration: 'underline',
                              cursor: 'pointer',
                              padding: 0,
                              font: 'inherit',
                              fontWeight: 500,
                              marginLeft: '4px',
                            }}
                          >
                            {file.filename}
                          </button>
                          <s-text style={{ marginLeft: '4px' }}>({description})</s-text>
                        </>
                      )}
                    </s-stack>
                  );
                })}
              </s-stack>
            )}
          </s-stack>
        </s-banner>
      )}

      {actionData?.error && (
        <s-banner tone="critical" style={{ marginBottom: '20px' }}>
          <s-text>{actionData.error}</s-text>
        </s-banner>
      )}

      <s-section heading="Generate New Export">
        <s-stack direction="block" gap="large">
          <s-paragraph>
            Select a date {useRange ? 'range' : ''} to export journal entries for charges captured on {useRange ? 'those days' : 'that day'}.
          </s-paragraph>

          <Form method="post">
            <input type="hidden" name="action" value="export" />
            <input type="hidden" name="useRange" value={useRange ? 'true' : 'false'} />
            <input type="hidden" name="generateDailySales" value={generateDailySales ? 'true' : 'false'} />
            <input type="hidden" name="generatePayoutsOrders" value={generatePayoutsOrders ? 'true' : 'false'} />
            <input type="hidden" name="generateJournalDetails" value={generateJournalDetails ? 'true' : 'false'} />
            <input type="hidden" name="generateJournalSummary" value={generateJournalSummary ? 'true' : 'false'} />
            <input type="hidden" name="generateCogsDetails" value={generateCogsDetails ? 'true' : 'false'} />
            <input type="hidden" name="generateReconciliation" value={generateReconciliation ? 'true' : 'false'} />

            <s-stack direction="block" gap="base">
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={useRange}
                    onChange={(e) => setUseRange(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <s-text>Use date range (generate exports for multiple days)</s-text>
                </label>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={autoDownload}
                    onChange={(e) => setAutoDownload(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <s-text>Auto-download files after export</s-text>
                </label>
              </div>

              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <s-stack direction="block" gap="tight">
                  <s-text variant="headingSm">Files to Generate</s-text>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={generateDailySales}
                      onChange={(e) => setGenerateDailySales(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                    <s-text>Detailed Sales Report</s-text>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={generatePayoutsOrders}
                      onChange={(e) => setGeneratePayoutsOrders(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                    <s-text>Payouts with Orders</s-text>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={generateJournalDetails}
                      onChange={(e) => setGenerateJournalDetails(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                    <s-text>Journal Entry Details</s-text>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={generateJournalSummary}
                      onChange={(e) => setGenerateJournalSummary(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                    <s-text>Journal Entry Summary (Sage 50 Import)</s-text>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={generateCogsDetails}
                      onChange={(e) => setGenerateCogsDetails(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                    <s-text>COGS Details (if Cin7 enabled)</s-text>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={generateReconciliation}
                      onChange={(e) => setGenerateReconciliation(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                    <s-text>Daily Reconciliation Report (Quick review format)</s-text>
                  </label>
                </s-stack>
              </s-box>

              <div style={{ maxWidth: '300px' }}>
                <s-stack direction="block" gap="tight">
                  <s-text variant="bodySm">{useRange ? 'Start Date' : 'Export Date'}</s-text>
                  <input
                    type="date"
                    name={useRange ? 'startDate' : 'date'}
                    defaultValue={defaultDate}
                    required
                    style={{
                      width: '100%',
                      padding: '10px',
                      border: '1px solid var(--p-color-border)',
                      borderRadius: 'var(--p-border-radius-200)',
                      fontSize: '14px',
                    }}
                  />
                </s-stack>
              </div>

              {useRange && (
                <div style={{ maxWidth: '300px' }}>
                  <s-stack direction="block" gap="tight">
                    <s-text variant="bodySm">End Date</s-text>
                    <input
                      type="date"
                      name="endDate"
                      defaultValue={defaultDate}
                      required
                      style={{
                        width: '100%',
                        padding: '10px',
                        border: '1px solid var(--p-color-border)',
                        borderRadius: 'var(--p-border-radius-200)',
                        fontSize: '14px',
                      }}
                    />
                  </s-stack>
                </div>
              )}

              <div>
                <s-button type="submit" variant="primary" loading={isExporting ? true : undefined}>
                  {isExporting ? 'Generating Export...' : 'Generate CSV'}
                </s-button>
              </div>
            </s-stack>
          </Form>

          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-text variant="headingSm">How it works</s-text>
              <s-stack direction="block" gap="tight">
                <s-text>1. Select the date (transactions captured on this day)</s-text>
                <s-text>2. Click "Generate CSV" to create four export files:</s-text>
                <s-text style={{ paddingLeft: '20px' }}>• Detailed Sales Report - Transaction-level detail for bookkeeping</s-text>
                <s-text style={{ paddingLeft: '20px' }}>• Payouts with Orders - Reconciliation view of payout breakdown</s-text>
                <s-text style={{ paddingLeft: '20px' }}>• Journal Entry Details - Detailed transaction entries</s-text>
                <s-text style={{ paddingLeft: '20px' }}>• Journal Entry - Summary by account (import into Sage 50)</s-text>
                <s-text>3. Download all four files for complete audit trail</s-text>
              </s-stack>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      <s-section heading="Export History">
        {exports.length === 0 ? (
          <s-paragraph>No exports yet. Generate your first export above.</s-paragraph>
        ) : (
          <s-box borderWidth="base" borderRadius="base" background="surface">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--p-color-border)' }}>
                  <th style={{ padding: '16px', textAlign: 'left' }}>
                    <s-text variant="headingSm">Filename</s-text>
                  </th>
                  <th style={{ padding: '16px', textAlign: 'left' }}>
                    <s-text variant="headingSm">Created</s-text>
                  </th>
                  <th style={{ padding: '16px', textAlign: 'right' }}>
                    <s-text variant="headingSm">Size</s-text>
                  </th>
                  <th style={{ padding: '16px', textAlign: 'center' }}>
                    <s-text variant="headingSm">Actions</s-text>
                  </th>
                </tr>
              </thead>
              <tbody>
                {exports.map((exp, index) => (
                  <tr
                    key={exp.filename}
                    style={{
                      borderBottom: index < exports.length - 1 ? '1px solid var(--p-color-border-subdued)' : 'none',
                    }}
                  >
                    <td style={{ padding: '16px' }}>
                      <code style={{ fontSize: '13px', fontFamily: 'monospace' }}>
                        {exp.filename}
                      </code>
                    </td>
                    <td style={{ padding: '16px' }}>
                      <s-text>{format(new Date(exp.created), 'MMM d, yyyy h:mm a')}</s-text>
                    </td>
                    <td style={{ padding: '16px', textAlign: 'right' }}>
                      <s-text>{formatFileSize(exp.size)}</s-text>
                    </td>
                    <td style={{ padding: '16px', textAlign: 'center' }}>
                      <button
                        onClick={() => handleDownload(exp.filename)}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: 'var(--p-color-bg-surface-secondary)',
                          color: 'var(--p-color-text)',
                          border: '1px solid var(--p-color-border)',
                          borderRadius: 'var(--p-border-radius-200)',
                          cursor: 'pointer',
                          fontSize: '13px',
                          fontWeight: 500,
                        }}
                      >
                        Download
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </s-box>
        )}
      </s-section>
    </s-page>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
