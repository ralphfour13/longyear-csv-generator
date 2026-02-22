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

    // Update scheduler with new config
    const getAccessToken = async (shopDomain: string): Promise<string> => {
      const sessionStorage = new PrismaSessionStorage(prisma);
      const sessions = await sessionStorage.findSessionsByShop(shopDomain);
      if (sessions.length === 0 || !sessions[0].accessToken) {
        throw new Error(`No access token for ${shopDomain}`);
      }
      return sessions[0].accessToken;
    };

    await updateShopSchedule(shop, config, getAccessToken);

    return Response.json({ success: true, message: 'Settings saved successfully. Scheduler updated.' });
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
    <div style={{ padding: '20px', maxWidth: '800px' }}>
      <h1>Sync Settings</h1>
      <p>Configure how and when journal entries are exported for Sage 50.</p>

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

      <Form method="post">
        {/* Sync Schedule Section */}
        <section style={{ marginBottom: '32px' }}>
          <h2>Export Schedule</h2>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                name="syncEnabled"
                value="true"
                defaultChecked={config.syncEnabled}
              />
              <span>Enable automatic exports</span>
            </label>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
              Schedule Type
            </label>
            <select
              name="syncSchedule"
              defaultValue={config.syncSchedule}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #c9cccf',
                borderRadius: '4px',
                fontSize: '14px',
              }}
            >
              <option value="manual">Manual Only</option>
              <option value="nightly">Nightly (Automatic)</option>
            </select>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
              Scheduled Time (24-hour format)
            </label>
            <input
              type="time"
              name="scheduledTime"
              defaultValue={config.scheduledTime}
              style={{
                padding: '8px',
                border: '1px solid #c9cccf',
                borderRadius: '4px',
                fontSize: '14px',
              }}
            />
            <p style={{ fontSize: '12px', color: '#637381', marginTop: '4px' }}>
              Time when automatic exports will run (e.g., 02:00 for 2:00 AM)
            </p>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
              Auto-Export Date Range
            </label>
            <select
              name="autoExportDate"
              defaultValue={config.autoExportDate}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #c9cccf',
                borderRadius: '4px',
                fontSize: '14px',
              }}
            >
              <option value="yesterday">Yesterday</option>
              <option value="today">Today</option>
              <option value="last_7_days">Last 7 Days</option>
            </select>
            <p style={{ fontSize: '12px', color: '#637381', marginTop: '4px' }}>
              Which date(s) to export during automatic runs
            </p>
          </div>
        </section>

        {/* Transaction Types Section */}
        <section style={{ marginBottom: '32px' }}>
          <h2>Transaction Types</h2>
          <p style={{ fontSize: '14px', color: '#637381', marginBottom: '16px' }}>
            Select which transaction types to include in exports
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                name="orders"
                value="true"
                defaultChecked={config.transactionTypes.orders}
              />
              <span>Orders (Sales Revenue)</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                name="refunds"
                value="true"
                defaultChecked={config.transactionTypes.refunds}
              />
              <span>Refunds</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                name="payments"
                value="true"
                defaultChecked={config.transactionTypes.payments}
              />
              <span>Payments & Fees</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                name="inventory"
                value="true"
                defaultChecked={config.transactionTypes.inventory}
              />
              <span>Inventory Adjustments (Coming Soon)</span>
            </label>
          </div>
        </section>

        {/* CSV Format Section */}
        <section style={{ marginBottom: '32px' }}>
          <h2>CSV Format</h2>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
              Format Type
            </label>
            <select
              name="csvFormat"
              defaultValue={config.csvFormat}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #c9cccf',
                borderRadius: '4px',
                fontSize: '14px',
              }}
            >
              <option value="standard">Standard (Date, Reference, Account, Debit, Credit, Memo)</option>
              <option value="extended">Extended (Additional fields for reconciliation)</option>
            </select>
          </div>
        </section>

        {/* Save Button */}
        <div>
          <button
            type="submit"
            style={{
              padding: '12px 24px',
              backgroundColor: '#008060',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500',
            }}
          >
            Save Settings
          </button>
        </div>
      </Form>

      {/* Info Section */}
      <div
        style={{
          marginTop: '32px',
          padding: '16px',
          backgroundColor: '#f6f6f7',
          borderRadius: '4px',
          fontSize: '14px',
        }}
      >
        <h3 style={{ marginTop: 0 }}>How It Works</h3>
        <ul style={{ marginBottom: 0, paddingLeft: '20px' }}>
          <li>
            <strong>Manual Export:</strong> Go to the Exports page and select a specific date or
            date range to generate a CSV file on-demand.
          </li>
          <li>
            <strong>Automatic Export:</strong> Enable nightly sync to automatically generate CSV
            files for the configured date range at the scheduled time.
          </li>
          <li>
            <strong>Payout-First Reconciliation:</strong> The app fetches Shopify payouts (what hit
            your bank), then works backwards through balance transactions and orders to ensure
            perfect reconciliation.
          </li>
          <li>
            <strong>CSV Import:</strong> Download the generated CSV files and import them into Sage
            50 using the Journal Entry import feature.
          </li>
        </ul>
      </div>
    </div>
  );
}
