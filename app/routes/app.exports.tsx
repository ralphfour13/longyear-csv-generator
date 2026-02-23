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
  const { session, admin } = await authenticate.admin(request);
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
    <div style={{ padding: '20px' }}>
      <h1>Export Center</h1>
      <p>Generate CSV files for import into Sage 50.</p>

      {actionData?.success && (
        <div
          style={{
            padding: '12px',
            marginBottom: '16px',
            backgroundColor: '#d4edda',
            border: '1px solid #c3e6cb',
            borderRadius: '4px',
            color: '#155724',
          }}
        >
          {actionData.message}
          {actionData.filename && (
            <div style={{ marginTop: '8px' }}>
              <a
                href={`/app/api/download-csv?shop=${shop}&filename=${actionData.filename}`}
                download
                style={{
                  color: '#155724',
                  textDecoration: 'underline',
                  fontWeight: '500',
                }}
              >
                Download {actionData.filename}
              </a>
            </div>
          )}
        </div>
      )}

      {actionData?.error && (
        <div
          style={{
            padding: '12px',
            marginBottom: '16px',
            backgroundColor: '#f8d7da',
            border: '1px solid #f5c6cb',
            borderRadius: '4px',
            color: '#721c24',
          }}
        >
          {actionData.error}
        </div>
      )}

      {/* Export Form */}
      <div
        style={{
          marginBottom: '32px',
          padding: '20px',
          backgroundColor: '#f6f6f7',
          borderRadius: '8px',
        }}
      >
        <h2 style={{ marginTop: 0 }}>Generate New Export</h2>

        <Form method="post">
          <input type="hidden" name="action" value="export" />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                Start Date
              </label>
              <input
                type="date"
                name="startDate"
                defaultValue={defaultDate}
                required
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #c9cccf',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                End Date
              </label>
              <input
                type="date"
                name="endDate"
                defaultValue={defaultDate}
                required
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #c9cccf',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isExporting}
            style={{
              padding: '12px 24px',
              backgroundColor: isExporting ? '#c9cccf' : '#008060',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isExporting ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: '500',
            }}
          >
            {isExporting ? 'Generating Export...' : 'Generate CSV'}
          </button>
        </Form>

        <div
          style={{
            marginTop: '16px',
            padding: '12px',
            backgroundColor: '#fff',
            borderRadius: '4px',
            fontSize: '14px',
            color: '#637381',
          }}
        >
          <strong>How it works:</strong>
          <ol style={{ marginBottom: 0, paddingLeft: '20px' }}>
            <li>Select date range (payouts that hit your bank during this period)</li>
            <li>Click "Generate CSV" to start payout-first reconciliation</li>
            <li>Download the generated CSV file</li>
            <li>Import into Sage 50 using Journal Entry import feature</li>
          </ol>
        </div>
      </div>

      {/* Export History */}
      <div>
        <h2>Export History</h2>

        {exports.length === 0 ? (
          <p style={{ color: '#637381' }}>No exports yet. Generate your first export above.</p>
        ) : (
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              backgroundColor: '#fff',
              borderRadius: '8px',
              overflow: 'hidden',
            }}
          >
            <thead>
              <tr style={{ backgroundColor: '#f6f6f7', borderBottom: '1px solid #e1e3e5' }}>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '500' }}>Filename</th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '500' }}>Created</th>
                <th style={{ padding: '12px', textAlign: 'right', fontWeight: '500' }}>Size</th>
                <th style={{ padding: '12px', textAlign: 'center', fontWeight: '500' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {exports.map((exp, index) => (
                <tr
                  key={exp.filename}
                  style={{
                    borderBottom: index < exports.length - 1 ? '1px solid #e1e3e5' : 'none',
                  }}
                >
                  <td style={{ padding: '12px' }}>
                    <code style={{ fontSize: '13px' }}>{exp.filename}</code>
                  </td>
                  <td style={{ padding: '12px', fontSize: '14px', color: '#637381' }}>
                    {format(new Date(exp.created), 'MMM d, yyyy h:mm a')}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right', fontSize: '14px', color: '#637381' }}>
                    {formatFileSize(exp.size)}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'center' }}>
                    <a
                      href={`/app/api/download-csv?shop=${shop}&filename=${exp.filename}`}
                      download
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#f6f6f7',
                        color: '#202223',
                        border: '1px solid #c9cccf',
                        borderRadius: '4px',
                        textDecoration: 'none',
                        fontSize: '13px',
                        display: 'inline-block',
                      }}
                    >
                      Download
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
