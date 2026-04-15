import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { useLoaderData, useActionData, useNavigation, Form } from 'react-router';
import { useState, useEffect, useRef, useCallback } from 'react';
import { authenticate } from '../shopify.server';

interface UncapturedAuthOrder {
  name: string;
  id: string;
  createdAt: string;
  orderTotal: string;
  uncapturedAmount: string;
  capturedAmount: string;
  gateway: string;
  financialStatus: string;
  paymentMethods: string;
  adminUrl: string;
}

interface UncapturedAuthReport {
  orders: UncapturedAuthOrder[];
  totalUncaptured: string;
  totalCaptured: string;
  orderCount: number;
  sinceDate: string;
  totalOrdersScanned: number;
  splitTenderCandidates: number;
}

function reportToCsv(report: UncapturedAuthReport): string {
  const header = 'Order,Date,Order Total,Captured,Uncaptured,Gateway,Status,Payment Methods,Admin URL';
  const rows = report.orders.map(o =>
    `${o.name},${o.createdAt.split('T')[0]},${o.orderTotal},${o.capturedAmount},${o.uncapturedAmount},${o.gateway},${o.financialStatus},"${o.paymentMethods}",${o.adminUrl}`
  );
  const summary = `\nTotal Uncaptured:,$${report.totalUncaptured}\nAffected Orders:,${report.orderCount}\nOrders Scanned:,${report.totalOrdersScanned}\nSplit-Tender Candidates:,${report.splitTenderCandidates}`;
  return [header, ...rows, summary].join('\n');
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return {};
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get('intent');
  const sinceDate = (formData.get('sinceDate') as string) || '2026-01-01';

  if (intent === 'generate') {
    try {
      const { createUncapturedAuthJob } = await import('../services/background-jobs.server');
      const { processPendingJobs } = await import('../services/job-processor.server');

      const jobId = await createUncapturedAuthJob(shop, sinceDate);

      const accessToken = session.accessToken || '';
      processPendingJobs(shop, accessToken).catch((error) => {
        console.error('[UncapturedAuth] Background job processing error:', error);
      });

      return { jobId, error: null };
    } catch (error) {
      console.error('Uncaptured auth report error:', error);
      return {
        jobId: null,
        error: `Report failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return { jobId: null, error: null };
};

interface JobProgressData {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  startedAt?: string;
  progress?: {
    phaseLabel?: string;
    overallPercentage?: number;
    currentActivity?: string;
    ordersFound?: number;
    ordersProcessed?: number;
    estimatedSecondsRemaining?: number;
  };
  result?: UncapturedAuthReport;
}

export default function UncapturedAuths() {
  useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  const [jobId, setJobId] = useState<string | null>(null);
  const [jobData, setJobData] = useState<JobProgressData | null>(null);
  const [report, setReport] = useState<UncapturedAuthReport | null>(null);
  const [elapsed, setElapsed] = useState('');
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // When action returns a jobId, start polling
  useEffect(() => {
    if (actionData?.jobId) {
      setJobId(actionData.jobId);
      setReport(null);
      setJobData(null);
    }
  }, [actionData?.jobId]);

  const fetchProgress = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/job-progress/${id}`);
      if (!response.ok) return;
      const data: JobProgressData = await response.json();
      setJobData(data);

      if (data.status === 'completed' || data.status === 'failed') {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        if (data.status === 'completed' && data.result) {
          setReport(data.result);
        }
      }
    } catch (error) {
      console.error('Error fetching job progress:', error);
    }
  }, []);

  useEffect(() => {
    if (!jobId) return;

    // Initial fetch
    fetchProgress(jobId);

    // Poll every 10 seconds
    pollingRef.current = setInterval(() => fetchProgress(jobId), 10000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [jobId, fetchProgress]);

  // Live elapsed timer
  const jobStartedAt = jobData?.startedAt;
  const jobStatus = jobData?.status;
  useEffect(() => {
    if (jobStatus !== 'processing' || !jobStartedAt) {
      setElapsed('');
      return;
    }

    function updateElapsed() {
      const start = new Date(jobStartedAt!).getTime();
      const durationMs = Date.now() - start;
      setElapsed(formatDuration(Math.floor(durationMs / 1000)));
    }

    updateElapsed();
    const timer = setInterval(updateElapsed, 1000);
    return () => clearInterval(timer);
  }, [jobStatus, jobStartedAt]);

  const isProcessing = jobData && (jobData.status === 'pending' || jobData.status === 'processing');
  const progress = jobData?.progress;
  const percentage = progress?.overallPercentage || 0;

  // CSV download handler
  function downloadCsv() {
    if (!report) return;
    const csv = reportToCsv(report);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `uncaptured-auths-${report.sinceDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <s-page heading="Orders with Uncaptured Authorizations">

      <s-section>
        <s-text>
          Find orders where a credit card authorization was never captured.
          These are typically split-tender orders (gift card + credit card) where the CC portion was authorized but never collected.
        </s-text>

        <div style={{ marginTop: '16px' }}>
          <Form method="post">
            <input type="hidden" name="intent" value="generate" />
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px' }}>
              <div>
                <label htmlFor="sinceDate">
                  <span style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Orders since
                  </span>
                </label>
                <input
                  type="date"
                  id="sinceDate"
                  name="sinceDate"
                  defaultValue="2026-01-01"
                  style={{
                    padding: '8px 12px',
                    border: '1px solid #c9cccf',
                    borderRadius: '8px',
                    fontSize: '14px',
                  }}
                />
              </div>
              <s-button
                variant="primary"
                type="submit"
                disabled={isSubmitting || isProcessing ? true : undefined}
              >
                {isSubmitting ? 'Starting...' : 'Generate Report'}
              </s-button>
            </div>
          </Form>
        </div>
      </s-section>

      {actionData?.error && (
        <s-banner tone="critical">
          <s-text>{actionData.error}</s-text>
        </s-banner>
      )}

      {jobData?.status === 'failed' && (
        <s-banner tone="critical">
          <s-text>Report failed: {jobData.error || 'An unknown error occurred'}</s-text>
        </s-banner>
      )}

      {isProcessing && (
        <s-section>
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: '16px' }}>Scanning Orders</strong>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {elapsed && (
                  <span style={{ fontSize: '13px', color: '#6D7175', fontVariantNumeric: 'tabular-nums' }}>
                    {elapsed}
                  </span>
                )}
                <span style={{
                  padding: '4px 12px',
                  borderRadius: '12px',
                  backgroundColor: '#E3F2FD',
                  color: '#0D5EAF',
                  fontSize: '12px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                }}>
                  {jobData.status === 'pending' ? 'Queued' : 'Processing'}
                </span>
              </div>
            </div>

            {/* Progress bar */}
            <div style={{
              width: '100%',
              height: '8px',
              backgroundColor: '#E1E3E5',
              borderRadius: '4px',
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${percentage}%`,
                height: '100%',
                backgroundColor: '#008060',
                transition: 'width 0.3s ease',
              }} />
            </div>

            {progress && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#202223' }}>
                  {progress.phaseLabel || 'Processing...'}
                </span>
                <span style={{ fontSize: '14px', color: '#6D7175' }}>
                  {percentage}%
                </span>
              </div>
            )}

            {progress?.currentActivity && (
              <div style={{ fontSize: '14px', color: '#6D7175' }}>
                {progress.currentActivity}
              </div>
            )}

            {progress?.ordersFound && progress.ordersProcessed !== undefined && (
              <div style={{ fontSize: '13px', color: '#6D7175' }}>
                Checked {progress.ordersProcessed} / {progress.ordersFound} candidates
              </div>
            )}

            {progress?.estimatedSecondsRemaining !== undefined && progress.estimatedSecondsRemaining > 0 && (
              <div style={{ fontSize: '13px', color: '#6D7175' }}>
                Est. {formatDuration(progress.estimatedSecondsRemaining)} remaining
              </div>
            )}
          </div>
        </s-section>
      )}

      {report && !isProcessing && (
        <>
          <s-section>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '16px',
              marginBottom: '20px',
            }}>
              <div style={{
                padding: '20px',
                backgroundColor: '#F6F6F7',
                borderRadius: '12px',
                border: '1px solid #E1E3E5',
              }}>
                <span style={{ color: '#6D7175', fontSize: '13px', display: 'block' }}>
                  Affected Orders
                </span>
                <span style={{ fontSize: '24px', fontWeight: 700 }}>
                  {report.orderCount}
                </span>
              </div>

              <div style={{
                padding: '20px',
                backgroundColor: '#FFF4F4',
                borderRadius: '12px',
                border: '1px solid #E1E3E5',
              }}>
                <span style={{ color: '#6D7175', fontSize: '13px', display: 'block' }}>
                  Total Uncaptured
                </span>
                <span style={{ fontSize: '24px', fontWeight: 700, color: '#D72C0D' }}>
                  ${report.totalUncaptured}
                </span>
              </div>

              <div style={{
                padding: '20px',
                backgroundColor: '#F6F6F7',
                borderRadius: '12px',
                border: '1px solid #E1E3E5',
              }}>
                <span style={{ color: '#6D7175', fontSize: '13px', display: 'block' }}>
                  Total Captured (other methods)
                </span>
                <span style={{ fontSize: '24px', fontWeight: 700 }}>
                  ${report.totalCaptured}
                </span>
              </div>

              <div style={{
                padding: '20px',
                backgroundColor: '#F6F6F7',
                borderRadius: '12px',
                border: '1px solid #E1E3E5',
              }}>
                <span style={{ color: '#6D7175', fontSize: '13px', display: 'block' }}>
                  Orders Scanned
                </span>
                <span style={{ fontSize: '14px' }}>
                  {report.totalOrdersScanned} total / {report.splitTenderCandidates} split-tender
                </span>
              </div>
            </div>
          </s-section>

          {report.orders.length > 0 && (
            <s-section>
              <div style={{ marginBottom: '12px' }}>
                <s-button onClick={downloadCsv}>
                  Download CSV
                </s-button>
              </div>

              <div style={{
                border: '1px solid #E1E3E5',
                borderRadius: '12px',
                overflow: 'hidden',
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e1e3e5', textAlign: 'left', backgroundColor: '#F6F6F7' }}>
                      <th style={{ padding: '10px 12px' }}>Order</th>
                      <th style={{ padding: '10px 12px' }}>Date</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right' }}>Order Total</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right' }}>Captured</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right' }}>Uncaptured</th>
                      <th style={{ padding: '10px 12px' }}>Gateway</th>
                      <th style={{ padding: '10px 12px' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.orders.map((order) => (
                      <tr key={order.id} style={{ borderBottom: '1px solid #f1f2f3' }}>
                        <td style={{ padding: '10px 12px' }}>
                          <a
                            href={order.adminUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#2c6ecb', textDecoration: 'none' }}
                          >
                            {order.name}
                          </a>
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          {order.createdAt.split('T')[0]}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                          ${order.orderTotal}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                          ${order.capturedAmount}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: '#D72C0D', fontWeight: 600 }}>
                          ${order.uncapturedAmount}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          {order.gateway}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          {order.financialStatus}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </s-section>
          )}

          {report.orders.length === 0 && (
            <s-section>
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <s-text>
                  No orders with uncaptured authorizations found since {report.sinceDate}.
                </s-text>
              </div>
            </s-section>
          )}
        </>
      )}
    </s-page>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (minutes < 60) {
    return `${minutes}m ${secs}s`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}
