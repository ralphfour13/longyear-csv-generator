import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { useLoaderData, useActionData, useNavigation, Form } from 'react-router';
import { useState, useEffect, useRef, useCallback } from 'react';
import { authenticate } from '../shopify.server';

interface CogsPushSkipped {
  sku: string | null;
  productTitle: string;
  reason: string;
}

interface CogsPushFailed {
  sku: string | null;
  productTitle: string;
  error: string;
}

interface CogsProbe {
  sku: string;
  url: string;
  status: number | null;
  matchedCount: number | null;
  firstReturnedSku: string | null;
  firstAverageCost: number | null;
  bodySnippet: string;
  error: string | null;
}

interface CogsPushResult {
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  totalVariants: number;
  skipped: CogsPushSkipped[];
  failed: CogsPushFailed[];
  ranAt: string;
  diagnostics?: {
    configNote: string | null;
    probes: CogsProbe[];
  };
}

function reportToCsv(report: CogsPushResult): string {
  const cell = (value: string | null) => `"${(value ?? '').replace(/"/g, '""')}"`;
  const row = (...cells: (string | null)[]) => cells.map(cell).join(',');

  const header = row('Type', 'SKU', 'Product', 'Detail');
  const skipRows = report.skipped.map((s) => row('Skipped', s.sku, s.productTitle, s.reason));
  const failRows = report.failed.map((f) => row('Failed', f.sku, f.productTitle, f.error));
  const summary = `\nUpdated:,${report.updatedCount}\nSkipped:,${report.skippedCount}\nFailed:,${report.failedCount}\nTotal Variants:,${report.totalVariants}`;
  return [header, ...skipRows, ...failRows, summary].join('\n');
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

  if (intent === 'push') {
    try {
      const { createCogsPushJob } = await import('../services/background-jobs.server');
      const { processPendingJobs } = await import('../services/job-processor.server');

      const jobId = await createCogsPushJob(shop);

      const accessToken = session.accessToken || '';
      processPendingJobs(shop, accessToken).catch((error) => {
        console.error('[CogsSync] Background job processing error:', error);
      });

      return { jobId, error: null, oneOff: null };
    } catch (error) {
      console.error('COGS sync error:', error);
      return {
        jobId: null,
        oneOff: null,
        error: `COGS sync failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  if (intent === 'pull-skus') {
    try {
      const { parseSkuList, pullCogsForSkus, MAX_ONE_OFF_SKUS } = await import(
        '../services/shopify/cogs-push-processor.server'
      );

      const skus = parseSkuList((formData.get('skus') as string) || '');
      if (skus.length === 0) {
        return { jobId: null, oneOff: null, error: 'Please enter at least one SKU.' };
      }
      if (skus.length > MAX_ONE_OFF_SKUS) {
        return {
          jobId: null,
          oneOff: null,
          error: `Too many SKUs for a one-off pull (${skus.length}). The one-off pull runs live and is capped at ${MAX_ONE_OFF_SKUS}. Use "Pull COGS from Cin7" for the full catalog.`,
        };
      }

      const accessToken = session.accessToken || '';
      const oneOff = await pullCogsForSkus(shop, accessToken, skus);

      return { jobId: null, oneOff, error: null };
    } catch (error) {
      console.error('COGS one-off pull error:', error);
      return {
        jobId: null,
        oneOff: null,
        error: `One-off pull failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return { jobId: null, error: null, oneOff: null };
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
  result?: CogsPushResult;
}

export default function CogsSync() {
  useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  const [jobId, setJobId] = useState<string | null>(null);
  const [jobData, setJobData] = useState<JobProgressData | null>(null);
  const [report, setReport] = useState<CogsPushResult | null>(null);
  const [elapsed, setElapsed] = useState('');
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

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

    fetchProgress(jobId);
    pollingRef.current = setInterval(() => fetchProgress(jobId), 10000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [jobId, fetchProgress]);

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

  // Result shown on the page comes from either the background full-sync job or
  // the inline one-off SKU pull (returned directly by the action).
  const displayReport: CogsPushResult | null = report ?? actionData?.oneOff ?? null;

  function downloadCsv() {
    if (!displayReport) return;
    const csv = reportToCsv(displayReport);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cogs-sync-${displayReport.ranAt.split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const flaggedRows = displayReport
    ? [
        ...displayReport.skipped.map((s) => ({ kind: 'Skipped', sku: s.sku, title: s.productTitle, detail: s.reason })),
        ...displayReport.failed.map((f) => ({ kind: 'Failed', sku: f.sku, title: f.productTitle, detail: f.error })),
      ]
    : [];

  return (
    <s-page heading="COGS Sync — Cin7 → Shopify">
      <s-section>
        <s-text>
          Pull the cost of goods (COGS) for every active product live from Cin7 (no caching) and write
          it into the Shopify &quot;Cost per item&quot; field. Products whose SKU is not found in Cin7 (or
          whose Cin7 cost is zero) are left unchanged and flagged below. You can run this any time.
        </s-text>

        <div style={{ marginTop: '16px' }}>
          <Form method="post">
            <input type="hidden" name="intent" value="push" />
            <s-button
              variant="primary"
              type="submit"
              disabled={isSubmitting || isProcessing ? true : undefined}
            >
              {isSubmitting ? 'Starting...' : 'Pull COGS from Cin7'}
            </s-button>
          </Form>
        </div>
      </s-section>

      <s-section heading="One-off pull (specific SKUs)">
        <s-text>
          Grab live Cin7 COGS for just these SKUs and write them to the matching Shopify variants.
          Runs immediately. Paste up to 50 SKUs separated by commas or new lines.
        </s-text>

        <div style={{ marginTop: '16px' }}>
          <Form method="post">
            <input type="hidden" name="intent" value="pull-skus" />
            <textarea
              name="skus"
              rows={4}
              placeholder={'SKU-001\nSKU-002, SKU-003'}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #c9cccf',
                borderRadius: '8px',
                fontSize: '14px',
                fontFamily: 'monospace',
                resize: 'vertical',
              }}
            />
            <div style={{ marginTop: '12px' }}>
              <s-button
                variant="primary"
                type="submit"
                disabled={isSubmitting || isProcessing ? true : undefined}
              >
                {isSubmitting ? 'Pulling...' : 'Grab these COGS'}
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
          <s-text>COGS sync failed: {jobData.error || 'An unknown error occurred'}</s-text>
        </s-banner>
      )}

      {isProcessing && (
        <s-section>
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: '16px' }}>Syncing COGS</strong>
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
                <span style={{ fontSize: '14px', color: '#6D7175' }}>{percentage}%</span>
              </div>
            )}

            {progress?.currentActivity && (
              <div style={{ fontSize: '14px', color: '#6D7175' }}>{progress.currentActivity}</div>
            )}

            {progress?.ordersFound && progress.ordersProcessed !== undefined && (
              <div style={{ fontSize: '13px', color: '#6D7175' }}>
                Processed {progress.ordersProcessed} / {progress.ordersFound} variants
              </div>
            )}
          </div>
        </s-section>
      )}

      {displayReport && !isProcessing && (
        <>
          <s-section>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '16px',
              marginBottom: '20px',
            }}>
              <div style={{ padding: '20px', backgroundColor: '#F1F8F5', borderRadius: '12px', border: '1px solid #E1E3E5' }}>
                <span style={{ color: '#6D7175', fontSize: '13px', display: 'block' }}>Costs Updated</span>
                <span style={{ fontSize: '24px', fontWeight: 700, color: '#008060' }}>{displayReport.updatedCount}</span>
              </div>
              <div style={{ padding: '20px', backgroundColor: displayReport.skippedCount > 0 ? '#FFF8E1' : '#F6F6F7', borderRadius: '12px', border: '1px solid #E1E3E5' }}>
                <span style={{ color: '#6D7175', fontSize: '13px', display: 'block' }}>Skipped</span>
                <span style={{ fontSize: '24px', fontWeight: 700, color: displayReport.skippedCount > 0 ? '#B98900' : '#202223' }}>{displayReport.skippedCount}</span>
              </div>
              <div style={{ padding: '20px', backgroundColor: displayReport.failedCount > 0 ? '#FFF4F4' : '#F6F6F7', borderRadius: '12px', border: '1px solid #E1E3E5' }}>
                <span style={{ color: '#6D7175', fontSize: '13px', display: 'block' }}>Failed</span>
                <span style={{ fontSize: '24px', fontWeight: 700, color: displayReport.failedCount > 0 ? '#D72C0D' : '#202223' }}>{displayReport.failedCount}</span>
              </div>
              <div style={{ padding: '20px', backgroundColor: '#F6F6F7', borderRadius: '12px', border: '1px solid #E1E3E5' }}>
                <span style={{ color: '#6D7175', fontSize: '13px', display: 'block' }}>Total</span>
                <span style={{ fontSize: '24px', fontWeight: 700 }}>{displayReport.totalVariants}</span>
              </div>
            </div>
          </s-section>

          {(displayReport.skippedCount > 0 || displayReport.failedCount > 0) && (
            <s-banner tone="warning">
              <s-text>
                {displayReport.skippedCount} item(s) were skipped and {displayReport.failedCount} failed — review the
                list below. Skipped items had no matching Cin7 cost, a zero cost, no SKU, or no matching Shopify
                product, and their Shopify cost was left unchanged.
              </s-text>
            </s-banner>
          )}

          {displayReport.diagnostics && (
            <s-banner tone="critical">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <strong>Nothing matched Cin7 — diagnostics</strong>
                {displayReport.diagnostics.configNote && (
                  <div>{displayReport.diagnostics.configNote}</div>
                )}
                {displayReport.diagnostics.probes.map((p) => (
                  <div
                    key={p.sku}
                    style={{
                      fontFamily: 'monospace',
                      fontSize: '12px',
                      background: '#FFF4F4',
                      border: '1px solid #E1E3E5',
                      borderRadius: '8px',
                      padding: '8px 10px',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}
                  >
                    SKU {`"${p.sku}"`} → HTTP {p.status ?? 'ERR'}
                    {p.error ? ` | error: ${p.error}` : ''}
                    {p.matchedCount !== null ? ` | matched: ${p.matchedCount}` : ''}
                    {p.firstReturnedSku ? ` | firstReturnedSku: ${p.firstReturnedSku}` : ''}
                    {p.firstAverageCost !== null ? ` | AverageCost: ${p.firstAverageCost}` : ''}
                    {p.bodySnippet ? `\nbody: ${p.bodySnippet}` : ''}
                  </div>
                ))}
                <div style={{ fontSize: '12px' }}>
                  Read: <code>HTTP 404</code> or empty body → wrong endpoint/SKU format.
                  <code> matched: 0</code> → SKU not found in Cin7 (or prefix mismatch).
                  <code> matched: ≥1 but AverageCost empty</code> → cost not set in Cin7.
                  Config note → Cin7 disabled/credentials.
                </div>
              </div>
            </s-banner>
          )}

          {flaggedRows.length > 0 && (
            <s-section>
              <div style={{ marginBottom: '12px' }}>
                <s-button onClick={downloadCsv}>Download CSV</s-button>
              </div>

              <div style={{ border: '1px solid #E1E3E5', borderRadius: '12px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e1e3e5', textAlign: 'left', backgroundColor: '#F6F6F7' }}>
                      <th style={{ padding: '10px 12px' }}>Type</th>
                      <th style={{ padding: '10px 12px' }}>SKU</th>
                      <th style={{ padding: '10px 12px' }}>Product</th>
                      <th style={{ padding: '10px 12px' }}>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flaggedRows.map((row, idx) => (
                      <tr key={`${row.sku ?? 'nosku'}-${idx}`} style={{ borderBottom: '1px solid #f1f2f3' }}>
                        <td style={{
                          padding: '10px 12px',
                          fontWeight: 600,
                          color: row.kind === 'Failed' ? '#D72C0D' : '#B98900',
                        }}>
                          {row.kind}
                        </td>
                        <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>{row.sku ?? '—'}</td>
                        <td style={{ padding: '10px 12px' }}>{row.title}</td>
                        <td style={{ padding: '10px 12px', color: '#6D7175' }}>{row.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </s-section>
          )}

          {flaggedRows.length === 0 && (
            <s-section>
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <s-text>All {displayReport.updatedCount} item(s) were updated successfully. 🎉</s-text>
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
