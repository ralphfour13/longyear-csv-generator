import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { useLoaderData, useActionData, useNavigation, Form } from 'react-router';
import { authenticate } from '../shopify.server';
import {
  generateUncapturedAuthReport,
  reportToCsv,
  type UncapturedAuthReport,
} from '../services/uncaptured-auth-report.server';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return {};
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const accessToken = session.accessToken || '';

  const formData = await request.formData();
  const intent = formData.get('intent');
  const sinceDate = (formData.get('sinceDate') as string) || '2026-01-01';

  if (intent === 'generate') {
    const report = await generateUncapturedAuthReport(shop, accessToken, sinceDate);
    return { report, csv: null };
  }

  if (intent === 'download') {
    const reportJson = formData.get('reportData') as string;
    if (!reportJson) return { report: null, csv: null };
    const report: UncapturedAuthReport = JSON.parse(reportJson);
    const csv = reportToCsv(report);
    return { report, csv };
  }

  return { report: null, csv: null };
};

export default function UncapturedAuths() {
  useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isLoading = navigation.state === 'submitting';

  const report = actionData?.report as UncapturedAuthReport | null;
  const csv = actionData?.csv as string | null;

  // Trigger CSV download when csv data is available
  if (csv) {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `uncaptured-auths-${report?.sinceDate || 'report'}.csv`;
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
                name="intent"
                value="generate"
              >
                {isLoading ? 'Scanning orders...' : 'Generate Report'}
              </s-button>
            </div>
          </Form>
        </div>
      </s-section>

      {isLoading && (
        <s-section>
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <s-spinner size="large" />
            <div style={{ marginTop: '12px' }}>
              <s-text>Scanning orders for uncaptured authorizations... This may take a minute.</s-text>
            </div>
          </div>
        </s-section>
      )}

      {report && !isLoading && (
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
                <Form method="post">
                  <input type="hidden" name="reportData" value={JSON.stringify(report)} />
                  <input type="hidden" name="sinceDate" value={report.sinceDate} />
                  <s-button name="intent" value="download">
                    Download CSV
                  </s-button>
                </Form>
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
