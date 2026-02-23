import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Form, useActionData, useLoaderData, useNavigation } from 'react-router';
import { authenticate } from '../shopify.server';
import { listExports, getExportStats } from '../services/storage.server';
import { format } from 'date-fns';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // List recent exports
  const exportFiles = await listExports(shop);

  // Get file stats for each export
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
    const startDate = formData.get('startDate') as string;
    const endDate = formData.get('endDate') as string;

    if (!startDate || !endDate) {
      return Response.json(
        { success: false, error: 'Start and end dates are required' },
        { status: 400 }
      );
    }

    try {
      // Import processExport to call directly (has authentication context)
      const { processExport } = await import('../services/batch-processor.server');

      // Process export directly (we already have authenticated session)
      const result = await processExport(
        shop,
        session.accessToken,
        startDate,
        endDate
      );

      return Response.json({
        success: true,
        message: 'Export completed successfully',
        filename: result.filename,
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

  // Default dates: yesterday
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const defaultDate = format(yesterday, 'yyyy-MM-dd');

  return (
    <s-page heading="Export Center">
      <s-button slot="primary-action" variant="primary" disabled={isExporting ? true : undefined}>
        {isExporting ? 'Generating...' : 'Generate Export'}
      </s-button>

      {/* Success Banner */}
      {actionData?.success && (
        <s-banner tone="success">
          <s-paragraph>{actionData.message}</s-paragraph>
          {actionData.filename && (
            <s-paragraph>
              <s-link href={`/api/download-csv?shop=${shop}&filename=${actionData.filename}`}>
                Download {actionData.filename}
              </s-link>
              {' '}({actionData.entryCount} entries, {actionData.balanced ? 'balanced ✓' : 'unbalanced ✗'})
            </s-paragraph>
          )}
        </s-banner>
      )}

      {/* Error Banner */}
      {actionData?.error && (
        <s-banner tone="critical">
          <s-paragraph>{actionData.error}</s-paragraph>
        </s-banner>
      )}

      {/* Export Form Section */}
      <s-section heading="Generate New Export">
        <s-paragraph>
          Select a date range to export journal entries. The export uses payout-first reconciliation to ensure perfect balance.
        </s-paragraph>

        <Form method="post">
          <input type="hidden" name="action" value="export" />

          <s-stack direction="block" gap="base">
            <s-stack direction="inline" gap="base">
              <div style={{ flex: 1 }}>
                <s-text>Start Date</s-text>
                <input
                  type="date"
                  name="startDate"
                  defaultValue={defaultDate}
                  required
                  style={{
                    width: '100%',
                    padding: '8px',
                    marginTop: '4px',
                    border: '1px solid var(--p-color-border)',
                    borderRadius: 'var(--p-border-radius-100)',
                  }}
                />
              </div>

              <div style={{ flex: 1 }}>
                <s-text>End Date</s-text>
                <input
                  type="date"
                  name="endDate"
                  defaultValue={defaultDate}
                  required
                  style={{
                    width: '100%',
                    padding: '8px',
                    marginTop: '4px',
                    border: '1px solid var(--p-color-border)',
                    borderRadius: 'var(--p-border-radius-100)',
                  }}
                />
              </div>
            </s-stack>

            <s-button type="submit" variant="primary" loading={isExporting ? true : undefined}>
              {isExporting ? 'Generating Export...' : 'Generate CSV'}
            </s-button>
          </s-stack>
        </Form>

        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued" style={{ marginTop: '16px' }}>
          <s-stack direction="block" gap="tight">
            <s-text variant="headingSm">How it works:</s-text>
            <ol style={{ paddingLeft: '20px', margin: 0 }}>
              <li>Select date range (payouts that hit your bank during this period)</li>
              <li>Click "Generate CSV" to start payout-first reconciliation</li>
              <li>Download the generated CSV file</li>
              <li>Import into Sage 50 using Journal Entry import feature</li>
            </ol>
          </s-stack>
        </s-box>
      </s-section>

      {/* Export History Section */}
      <s-section heading="Export History">
        {exports.length === 0 ? (
          <s-paragraph>No exports yet. Generate your first export above.</s-paragraph>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--p-color-border)' }}>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600 }}>
                    <s-text>Filename</s-text>
                  </th>
                  <th style={{ padding: '12px', textAlign: 'left', fontWeight: 600 }}>
                    <s-text>Created</s-text>
                  </th>
                  <th style={{ padding: '12px', textAlign: 'right', fontWeight: 600 }}>
                    <s-text>Size</s-text>
                  </th>
                  <th style={{ padding: '12px', textAlign: 'center', fontWeight: 600 }}>
                    <s-text>Actions</s-text>
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
                    <td style={{ padding: '12px' }}>
                      <code style={{ fontSize: '13px' }}>{exp.filename}</code>
                    </td>
                    <td style={{ padding: '12px' }}>
                      <s-text>{format(new Date(exp.created), 'MMM d, yyyy h:mm a')}</s-text>
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right' }}>
                      <s-text>{formatFileSize(exp.size)}</s-text>
                    </td>
                    <td style={{ padding: '12px', textAlign: 'center' }}>
                      <s-button
                        href={`/api/download-csv?shop=${shop}&filename=${exp.filename}`}
                        variant="tertiary"
                        size="slim"
                      >
                        Download
                      </s-button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
