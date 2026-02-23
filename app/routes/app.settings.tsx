import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Form, useActionData, useLoaderData } from 'react-router';
import { authenticate } from '../shopify.server';
import { getShopConfig, saveShopConfig } from '../services/storage.server';
import { updateShopSchedule } from '../services/scheduler.server';
import type { SyncConfig } from '../types/journal-entry';
import { PrismaSessionStorage } from '@shopify/shopify-app-session-storage-prisma';
import prisma from '../db.server';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const config = await getShopConfig(shop);

  return Response.json({ shop, config });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();

  try {
    const config: SyncConfig = {
      shop,
      syncEnabled: formData.get('syncEnabled') === 'true',
      syncSchedule: (formData.get('syncSchedule') as 'nightly' | 'manual') || 'manual',
      scheduledTime: (formData.get('scheduledTime') as string) || '02:00',
      autoExportDate:
        (formData.get('autoExportDate') as 'yesterday' | 'today' | 'last_7_days') || 'yesterday',
      transactionTypes: {
        orders: formData.get('orders') === 'true',
        refunds: formData.get('refunds') === 'true',
        payments: formData.get('payments') === 'true',
        inventory: formData.get('inventory') === 'true',
      },
      csvFormat: (formData.get('csvFormat') as 'standard' | 'extended') || 'standard',
    };

    await saveShopConfig(shop, config);

    const getAccessToken = async (shopDomain: string): Promise<string> => {
      const sessionStorage = new PrismaSessionStorage(prisma);
      const sessions = await sessionStorage.findSessionsByShop(shopDomain);
      if (sessions.length === 0 || !sessions[0].accessToken) {
        throw new Error(`No access token for ${shopDomain}`);
      }
      return sessions[0].accessToken;
    };

    await updateShopSchedule(shop, config, getAccessToken);

    return Response.json({ success: true, message: 'Settings saved successfully' });
  } catch (error) {
    return Response.json(
      { success: false, error: 'Failed to save settings' },
      { status: 500 }
    );
  }
};

export default function Settings() {
  const { shop, config } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <s-page heading="Sync Settings">
      {actionData?.success && (
        <s-banner tone="success" style={{ marginBottom: '20px' }}>
          <s-text>{actionData.message}</s-text>
        </s-banner>
      )}

      {actionData?.error && (
        <s-banner tone="critical" style={{ marginBottom: '20px' }}>
          <s-text>{actionData.error}</s-text>
        </s-banner>
      )}

      <Form method="post">
        <s-section heading="Export Schedule">
          <s-stack direction="block" gap="large">
            <s-paragraph>
              Configure when and how journal entries are automatically exported to Sage 50.
            </s-paragraph>

            <s-stack direction="block" gap="base">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  name="syncEnabled"
                  value="true"
                  defaultChecked={config.syncEnabled}
                />
                <s-text>Enable automatic exports</s-text>
              </label>

              <s-stack direction="block" gap="tight">
                <s-text variant="bodySm">Schedule Type</s-text>
                <select
                  name="syncSchedule"
                  defaultValue={config.syncSchedule}
                  style={{
                    width: '100%',
                    maxWidth: '300px',
                    padding: '10px',
                    border: '1px solid var(--p-color-border)',
                    borderRadius: 'var(--p-border-radius-200)',
                    fontSize: '14px',
                  }}
                >
                  <option value="manual">Manual Only</option>
                  <option value="nightly">Nightly (Automatic)</option>
                </select>
              </s-stack>

              <s-stack direction="block" gap="tight">
                <s-text variant="bodySm">Scheduled Time (24-hour format)</s-text>
                <input
                  type="time"
                  name="scheduledTime"
                  defaultValue={config.scheduledTime}
                  style={{
                    padding: '10px',
                    border: '1px solid var(--p-color-border)',
                    borderRadius: 'var(--p-border-radius-200)',
                    fontSize: '14px',
                    maxWidth: '200px',
                  }}
                />
                <s-text tone="subdued" variant="bodySm">
                  Time when automatic exports will run (e.g., 02:00 for 2:00 AM)
                </s-text>
              </s-stack>

              <s-stack direction="block" gap="tight">
                <s-text variant="bodySm">Auto-Export Date Range</s-text>
                <select
                  name="autoExportDate"
                  defaultValue={config.autoExportDate}
                  style={{
                    width: '100%',
                    maxWidth: '300px',
                    padding: '10px',
                    border: '1px solid var(--p-color-border)',
                    borderRadius: 'var(--p-border-radius-200)',
                    fontSize: '14px',
                  }}
                >
                  <option value="yesterday">Yesterday</option>
                  <option value="today">Today</option>
                  <option value="last_7_days">Last 7 Days</option>
                </select>
                <s-text tone="subdued" variant="bodySm">
                  Which date(s) to export during automatic runs
                </s-text>
              </s-stack>
            </s-stack>
          </s-stack>
        </s-section>

        <s-section heading="Transaction Types">
          <s-stack direction="block" gap="large">
            <s-paragraph>
              Select which transaction types to include in exports
            </s-paragraph>

            <s-stack direction="block" gap="base">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  name="orders"
                  value="true"
                  defaultChecked={config.transactionTypes.orders}
                />
                <s-text>Orders (Sales Revenue)</s-text>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  name="refunds"
                  value="true"
                  defaultChecked={config.transactionTypes.refunds}
                />
                <s-text>Refunds</s-text>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  name="payments"
                  value="true"
                  defaultChecked={config.transactionTypes.payments}
                />
                <s-text>Payments & Fees</s-text>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  name="inventory"
                  value="true"
                  defaultChecked={config.transactionTypes.inventory}
                />
                <s-text tone="subdued">Inventory Adjustments (Coming Soon)</s-text>
              </label>
            </s-stack>
          </s-stack>
        </s-section>

        <s-section heading="CSV Format">
          <s-stack direction="block" gap="large">
            <s-stack direction="block" gap="tight">
              <s-text variant="bodySm">Format Type</s-text>
              <select
                name="csvFormat"
                defaultValue={config.csvFormat}
                style={{
                  width: '100%',
                  maxWidth: '400px',
                  padding: '10px',
                  border: '1px solid var(--p-color-border)',
                  borderRadius: 'var(--p-border-radius-200)',
                  fontSize: '14px',
                }}
              >
                <option value="standard">
                  Standard (Date, Reference, Account, Debit, Credit, Memo)
                </option>
                <option value="extended">Extended (Additional reconciliation fields)</option>
              </select>
            </s-stack>
          </s-stack>
        </s-section>

        <div style={{ marginTop: '24px' }}>
          <s-button type="submit" variant="primary">
            Save Settings
          </s-button>
        </div>
      </Form>

      <s-section heading="How It Works" slot="aside">
        <s-stack direction="block" gap="base">
          <s-text variant="bodySm">
            <strong>Manual Export:</strong> Go to Export Center and select specific dates to generate CSV on-demand.
          </s-text>
          <s-text variant="bodySm">
            <strong>Automatic Export:</strong> Enable nightly sync to generate CSV files at scheduled time.
          </s-text>
          <s-text variant="bodySm">
            <strong>Payout-First:</strong> Starts with bank deposits and works backwards for perfect reconciliation.
          </s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}
