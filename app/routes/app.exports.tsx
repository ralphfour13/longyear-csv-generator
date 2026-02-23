import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Form, useActionData, useLoaderData, useNavigation } from 'react-router';
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
    const startDate = formData.get('startDate') as string;
    const endDate = formData.get('endDate') as string;

    if (!startDate || !endDate) {
      return Response.json(
        { success: false, error: 'Start and end dates are required' },
        { status: 400 }
      );
    }

    try {
      const { processExport } = await import('../services/batch-processor.server');

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

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const defaultDate = format(yesterday, 'yyyy-MM-dd');

  return (
    <s-page heading="Export Center">
      {actionData?.success && (
        <s-banner tone="success" style={{ marginBottom: '20px' }}>
          <s-stack direction="block" gap="tight">
            <s-text variant="headingSm">{actionData.message}</s-text>
            {actionData.filename && (
              <s-stack direction="inline" gap="tight" alignItems="center">
                <s-link href={`https://sage50-sync.four13.dev/api/download-csv?shop=${shop}&filename=${actionData.filename}`}>
                  Download {actionData.filename}
                </s-link>
                <s-text>
                  ({actionData.entryCount} entries, {actionData.balanced ? '✓ balanced' : '✗ unbalanced'})
                </s-text>
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
            Select a date range to export journal entries. The export uses payout-first reconciliation to ensure perfect balance.
          </s-paragraph>

          <Form method="post">
            <input type="hidden" name="action" value="export" />

            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="base" style={{ width: '100%' }}>
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <s-stack direction="block" gap="tight">
                    <s-text variant="bodySm">Start Date</s-text>
                    <input
                      type="date"
                      name="startDate"
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

                <div style={{ flex: 1, minWidth: '200px' }}>
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
              </s-stack>

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
                <s-text>1. Select date range (payouts that hit your bank during this period)</s-text>
                <s-text>2. Click "Generate CSV" to start payout-first reconciliation</s-text>
                <s-text>3. Download the generated CSV file</s-text>
                <s-text>4. Import into Sage 50 using Journal Entry import feature</s-text>
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
                      <s-button
                        href={`https://sage50-sync.four13.dev/api/download-csv?shop=${shop}&filename=${exp.filename}`}
                        variant="secondary"
                        size="slim"
                      >
                        Download
                      </s-button>
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
