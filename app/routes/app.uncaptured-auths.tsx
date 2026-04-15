import type { LoaderFunctionArgs, ActionFunctionArgs } from 'react-router';
import { useLoaderData, useActionData, useNavigation, Form } from 'react-router';
import { authenticate } from '../shopify.server';
import {
  generateUncapturedAuthReport,
  reportToCsv,
  type UncapturedAuthReport,
} from '../services/uncaptured-auth-report.server';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { shop: session.shop };
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
      <s-link slot="backAction" href="/app">Back</s-link>

      <s-box padding="400">
        <s-text variant="bodyMd">
          Find orders where a credit card authorization was never captured.
          These are typically split-tender orders (gift card + credit card) where the CC portion was authorized but never collected.
        </s-text>

        <s-box paddingBlockStart="400">
          <Form method="post">
            <s-inline-stack gap="300" blockAlign="end">
              <s-box>
                <label htmlFor="sinceDate">
                  <s-text variant="bodySm" fontWeight="semibold">Orders since</s-text>
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
                    marginTop: '4px',
                  }}
                />
              </s-box>
              <s-button
                variant="primary"
                name="intent"
                value="generate"
                disabled={isLoading}
              >
                {isLoading ? 'Scanning orders...' : 'Generate Report'}
              </s-button>
            </s-inline-stack>
          </Form>
        </s-box>
      </s-box>

      {isLoading && (
        <s-box padding="800">
          <s-inline-stack align="center">
            <s-spinner size="large" />
            <s-text variant="bodyMd">
              Scanning orders for uncaptured authorizations... This may take a minute.
            </s-text>
          </s-inline-stack>
        </s-box>
      )}

      {report && !isLoading && (
        <>
          <s-box padding="400" paddingBlockStart="600">
            <s-card>
              <s-box padding="400">
                <s-inline-stack gap="800">
                  <s-box>
                    <s-text variant="headingLg">{report.orderCount}</s-text>
                    <s-text variant="bodySm" tone="subdued">Affected Orders</s-text>
                  </s-box>
                  <s-box>
                    <s-text variant="headingLg" tone="critical">${report.totalUncaptured}</s-text>
                    <s-text variant="bodySm" tone="subdued">Total Uncaptured</s-text>
                  </s-box>
                  <s-box>
                    <s-text variant="headingLg">${report.totalCaptured}</s-text>
                    <s-text variant="bodySm" tone="subdued">Total Captured (other methods)</s-text>
                  </s-box>
                  <s-box>
                    <s-text variant="bodyMd">{report.totalOrdersScanned} scanned / {report.splitTenderCandidates} split-tender</s-text>
                    <s-text variant="bodySm" tone="subdued">Orders checked</s-text>
                  </s-box>
                </s-inline-stack>
              </s-box>
            </s-card>
          </s-box>

          {report.orders.length > 0 && (
            <s-box padding="400">
              <s-box paddingBlockEnd="300">
                <Form method="post">
                  <input type="hidden" name="reportData" value={JSON.stringify(report)} />
                  <input type="hidden" name="sinceDate" value={report.sinceDate} />
                  <s-button name="intent" value="download">
                    Download CSV
                  </s-button>
                </Form>
              </s-box>

              <s-card>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e1e3e5', textAlign: 'left' }}>
                      <th style={{ padding: '8px 12px' }}>Order</th>
                      <th style={{ padding: '8px 12px' }}>Date</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Order Total</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Captured</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Uncaptured</th>
                      <th style={{ padding: '8px 12px' }}>Gateway</th>
                      <th style={{ padding: '8px 12px' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.orders.map((order) => (
                      <tr key={order.id} style={{ borderBottom: '1px solid #f1f2f3' }}>
                        <td style={{ padding: '8px 12px' }}>
                          <a
                            href={order.adminUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#2c6ecb', textDecoration: 'none' }}
                          >
                            {order.name}
                          </a>
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          {order.createdAt.split('T')[0]}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                          ${order.orderTotal}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                          ${order.capturedAmount}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: '#d72c0d', fontWeight: 600 }}>
                          ${order.uncapturedAmount}
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          {order.gateway}
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          {order.financialStatus}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </s-card>
            </s-box>
          )}

          {report.orders.length === 0 && (
            <s-box padding="400">
              <s-card>
                <s-box padding="800">
                  <s-text variant="bodyMd" alignment="center">
                    No orders with uncaptured authorizations found since {report.sinceDate}.
                  </s-text>
                </s-box>
              </s-card>
            </s-box>
          )}
        </>
      )}
    </s-page>
  );
}
