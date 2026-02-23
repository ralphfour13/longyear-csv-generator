import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Form, useActionData, useLoaderData, useNavigation } from 'react-router';
import { useEffect } from 'react';
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

  if (action === 'export') {
    const dateParam = formData.get('date');

    if (!dateParam || typeof dateParam !== 'string') {
      return Response.json(
        { success: false, error: 'Export date is required' },
        { status: 400 }
      );
    }

    const date = dateParam;

    try {
      const { processExport } = await import('../services/batch-processor.server');

      const result = await processExport(
        shop,
        session.accessToken,
        date
      );

      return Response.json({
        success: true,
        message: 'Export completed successfully',
        filename: result.filename, // Keep for backward compatibility
        files: result.files, // NEW: Include all generated files
        entryCount: result.entryCount,
        balanced: result.balanced,
      });
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

  const isExporting = navigation.state === 'submitting';

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const defaultDate = format(yesterday, 'yyyy-MM-dd');

  // Download handler to bypass Shopify routing
  const handleDownload = (filename: string) => {
    const url = `https://sage50-sync.four13.dev/api/download-csv?shop=${shop}&filename=${filename}`;
    window.open(url, '_blank');
  };

  // Auto-download all files when export completes
  useEffect(() => {
    if (actionData?.success && actionData?.files) {
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
  }, [actionData, shop]);

  return (
    <s-page heading="Export Center">
      {actionData?.success && (
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
            Select a date to export journal entries for charges captured on that day.
          </s-paragraph>

          <Form method="post">
            <input type="hidden" name="action" value="export" />

            <s-stack direction="block" gap="base">
              <div style={{ maxWidth: '300px' }}>
                <s-stack direction="block" gap="tight">
                  <s-text variant="bodySm">Export Date</s-text>
                  <input
                    type="date"
                    name="date"
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
