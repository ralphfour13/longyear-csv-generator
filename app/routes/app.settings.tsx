import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Form, useActionData, useLoaderData } from 'react-router';
import { authenticate } from '../shopify.server';
import { getShopConfig, saveShopConfig, listExports, deleteExport } from '../services/storage.server';
import { updateShopSchedule } from '../services/scheduler.server';
import type { SyncConfig } from '../types/journal-entry';
import type { Cin7Config } from '../types/cin7';
import { PrismaSessionStorage } from '@shopify/shopify-app-session-storage-prisma';
import prisma from '../db.server';
import { promises as fs } from 'fs';
import path from 'path';
import { getCin7Config, saveCin7Config, testCin7Connection } from '../services/cin7/cin7-credential-manager.server';
import { cin7Cache } from '../services/cin7/cin7-cache.server';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const config = await getShopConfig(shop);
  const cin7Config = await getCin7Config(shop);
  const cin7CacheStats = cin7Cache.getStats(shop);

  return Response.json({ shop, config, cin7Config, cin7CacheStats });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const actionType = formData.get('actionType') as string;

  // Handle Cin7 test connection
  if (actionType === 'testCin7Connection') {
    try {
      const accountId = formData.get('cin7AccountId') as string;
      const apiKey = formData.get('cin7ApiKey') as string;

      if (!accountId || !apiKey) {
        return Response.json(
          { success: false, error: 'Account ID and API Key are required' },
          { status: 400 }
        );
      }

      const testResult = await testCin7Connection(accountId, apiKey);

      return Response.json({
        success: testResult.success,
        message: testResult.message,
      });
    } catch (error) {
      return Response.json(
        { success: false, error: `Connection test failed: ${error instanceof Error ? error.message : String(error)}` },
        { status: 500 }
      );
    }
  }

  // Handle Cin7 clear cache
  if (actionType === 'clearCin7Cache') {
    try {
      cin7Cache.clearShop(shop);
      return Response.json({
        success: true,
        message: 'Cin7 cache cleared successfully',
      });
    } catch (error) {
      return Response.json(
        { success: false, error: `Failed to clear cache: ${error instanceof Error ? error.message : String(error)}` },
        { status: 500 }
      );
    }
  }

  // Handle Cin7 settings save
  if (actionType === 'saveCin7Settings') {
    try {
      const cin7Config: Cin7Config = {
        enabled: formData.get('cin7Enabled') === 'true',
        accountId: (formData.get('cin7AccountId') as string) || '',
        apiKey: (formData.get('cin7ApiKey') as string) || '',
        cacheEnabled: formData.get('cin7CacheEnabled') === 'true',
        cacheDurationHours: parseInt(formData.get('cin7CacheDuration') as string) || 24,
        useFallback: formData.get('cin7UseFallback') === 'true',
        fallbackCost: (formData.get('cin7FallbackCost') as string) || undefined,
        lastTested: new Date().toISOString(),
      };

      await saveCin7Config(shop, cin7Config);

      return Response.json({
        success: true,
        message: 'Cin7 settings saved successfully',
      });
    } catch (error) {
      return Response.json(
        { success: false, error: `Failed to save Cin7 settings: ${error instanceof Error ? error.message : String(error)}` },
        { status: 500 }
      );
    }
  }

  // Handle clear all exports
  if (actionType === 'clearAllExports') {
    try {
      const exportFiles = await listExports(shop);

      if (exportFiles.length === 0) {
        return Response.json({
          success: true,
          message: 'No exports to delete',
          deletedCount: 0,
        });
      }

      // Delete all export files
      let deletedCount = 0;
      const errors: string[] = [];

      for (const filename of exportFiles) {
        try {
          await deleteExport(shop, filename);
          deletedCount++;
        } catch (error) {
          errors.push(`Failed to delete ${filename}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (errors.length > 0) {
        return Response.json({
          success: false,
          error: `Deleted ${deletedCount} files, but ${errors.length} failed: ${errors.join(', ')}`,
          deletedCount,
        });
      }

      return Response.json({
        success: true,
        message: `Successfully deleted ${deletedCount} export file${deletedCount !== 1 ? 's' : ''}`,
        deletedCount,
      });
    } catch (error) {
      return Response.json(
        { success: false, error: `Failed to clear exports: ${error instanceof Error ? error.message : String(error)}` },
        { status: 500 }
      );
    }
  }

  // Handle order debug action
  if (actionType === 'debugOrder') {
    try {
      const orderNumber = formData.get('orderNumber') as string;

      if (!orderNumber) {
        return Response.json(
          { success: false, error: 'Order number is required' },
          { status: 400 }
        );
      }

      // Fetch order details from Shopify
      const url = `https://${shop}/admin/api/2024-10/orders.json?name=${encodeURIComponent(orderNumber)}&status=any`;

      const response = await fetch(url, {
        headers: {
          'X-Shopify-Access-Token': session.accessToken,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.orders || data.orders.length === 0) {
        return Response.json(
          { success: false, error: `Order ${orderNumber} not found` },
          { status: 404 }
        );
      }

      const order = data.orders[0];

      // Fetch transactions for this order
      const txnUrl = `https://${shop}/admin/api/2024-10/orders/${order.id}/transactions.json`;
      const txnResponse = await fetch(txnUrl, {
        headers: {
          'X-Shopify-Access-Token': session.accessToken,
          'Content-Type': 'application/json',
        },
      });

      if (txnResponse.ok) {
        const txnData = await txnResponse.json();
        order.transactions = txnData.transactions;
      }

      // Save to file
      const dataDir = path.join(process.cwd(), 'data', shop, 'debug');
      await fs.mkdir(dataDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `order-${orderNumber.replace('#', '')}-${timestamp}.json`;
      const filePath = path.join(dataDir, filename);

      const jsonString = JSON.stringify(order, null, 2);
      await fs.writeFile(filePath, jsonString);

      return Response.json({
        success: true,
        message: `Order ${orderNumber} data saved successfully`,
        filePath: filePath,
        filename: filename,
        orderId: order.id,
        createdAt: order.created_at,
        updatedAt: order.updated_at,
        financialStatus: order.financial_status,
        transactionCount: order.transactions?.length || 0,
        jsonData: jsonString, // Include JSON for client-side download
      });
    } catch (error) {
      console.error('Debug order error:', error);
      return Response.json(
        { success: false, error: `Failed to fetch order: ${error instanceof Error ? error.message : String(error)}` },
        { status: 500 }
      );
    }
  }

  // Handle settings save action (existing logic)
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
  const { shop, config, cin7Config, cin7CacheStats } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  const handleDownload = () => {
    if (!actionData?.jsonData || !actionData?.filename) return;

    const blob = new Blob([actionData.jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = actionData.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

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

      <s-section heading="Cin7 Integration (COGS)">
        <s-stack direction="block" gap="large">
          <s-paragraph>
            Connect to Cin7 Core (Dear Systems) to automatically fetch Cost of Goods Sold (COGS) data for products.
            Two files will be generated: detailed COGS breakdown and summary entries in journal file.
          </s-paragraph>

          <Form method="post">
            <input type="hidden" name="actionType" value="saveCin7Settings" />

            <s-stack direction="block" gap="base">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  name="cin7Enabled"
                  value="true"
                  defaultChecked={cin7Config.enabled}
                />
                <s-text>Enable Cin7 COGS integration</s-text>
              </label>

              <s-stack direction="block" gap="tight">
                <s-text variant="bodySm">Cin7 Account ID</s-text>
                <input
                  type="text"
                  name="cin7AccountId"
                  defaultValue={cin7Config.accountId}
                  placeholder="Your Cin7 Account ID"
                  style={{
                    width: '100%',
                    maxWidth: '400px',
                    padding: '10px',
                    border: '1px solid var(--p-color-border)',
                    borderRadius: 'var(--p-border-radius-200)',
                    fontSize: '14px',
                  }}
                />
                <s-text tone="subdued" variant="bodySm">
                  Found in Cin7 Settings → Integrations → API
                </s-text>
              </s-stack>

              <s-stack direction="block" gap="tight">
                <s-text variant="bodySm">Cin7 API Key</s-text>
                <input
                  type="password"
                  name="cin7ApiKey"
                  defaultValue={cin7Config.apiKey}
                  placeholder="Your Cin7 API Application Key"
                  style={{
                    width: '100%',
                    maxWidth: '400px',
                    padding: '10px',
                    border: '1px solid var(--p-color-border)',
                    borderRadius: 'var(--p-border-radius-200)',
                    fontSize: '14px',
                  }}
                />
                <s-text tone="subdued" variant="bodySm">
                  API key is encrypted at rest using AES-256
                </s-text>
              </s-stack>

              <div style={{ marginTop: '12px' }}>
                <s-button type="submit" variant="primary">
                  Save Cin7 Settings
                </s-button>
              </div>
            </s-stack>
          </Form>

          <s-divider />

          <s-text variant="headingSm">Test Connection</s-text>
          <Form method="post">
            <input type="hidden" name="actionType" value="testCin7Connection" />
            <input type="hidden" name="cin7AccountId" value={cin7Config.accountId} />
            <input type="hidden" name="cin7ApiKey" value={cin7Config.apiKey} />

            <s-stack direction="inline" gap="base" align="center">
              <s-button type="submit">Test Cin7 Connection</s-button>
              <s-text tone="subdued" variant="bodySm">
                Last tested: {cin7Config.lastTested ? new Date(cin7Config.lastTested).toLocaleString() : 'Never'}
              </s-text>
            </s-stack>
          </Form>

          <s-divider />

          <s-text variant="headingSm">Advanced Settings</s-text>
          <Form method="post">
            <input type="hidden" name="actionType" value="saveCin7Settings" />
            <input type="hidden" name="cin7Enabled" value={cin7Config.enabled ? 'true' : 'false'} />
            <input type="hidden" name="cin7AccountId" value={cin7Config.accountId} />
            <input type="hidden" name="cin7ApiKey" value={cin7Config.apiKey} />

            <s-stack direction="block" gap="base">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  name="cin7CacheEnabled"
                  value="true"
                  defaultChecked={cin7Config.cacheEnabled}
                />
                <s-text>Enable COGS caching (24 hours)</s-text>
              </label>

              <s-stack direction="block" gap="tight">
                <s-text variant="bodySm">Cache Duration (hours)</s-text>
                <input
                  type="number"
                  name="cin7CacheDuration"
                  defaultValue={cin7Config.cacheDurationHours}
                  min="1"
                  max="168"
                  style={{
                    width: '150px',
                    padding: '10px',
                    border: '1px solid var(--p-color-border)',
                    borderRadius: 'var(--p-border-radius-200)',
                    fontSize: '14px',
                  }}
                />
              </s-stack>

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  name="cin7UseFallback"
                  value="true"
                  defaultChecked={cin7Config.useFallback}
                />
                <s-text>Use fallback cost when product not found</s-text>
              </label>

              <s-stack direction="block" gap="tight">
                <s-text variant="bodySm">Fallback COGS (optional)</s-text>
                <input
                  type="number"
                  name="cin7FallbackCost"
                  defaultValue={cin7Config.fallbackCost || ''}
                  placeholder="0.00"
                  step="0.01"
                  style={{
                    width: '150px',
                    padding: '10px',
                    border: '1px solid var(--p-color-border)',
                    borderRadius: 'var(--p-border-radius-200)',
                    fontSize: '14px',
                  }}
                />
                <s-text tone="subdued" variant="bodySm">
                  Default cost to use when product not found in Cin7
                </s-text>
              </s-stack>

              <div style={{ marginTop: '12px' }}>
                <s-button type="submit">Save Advanced Settings</s-button>
              </div>
            </s-stack>
          </Form>

          <s-divider />

          <s-text variant="headingSm">Cache Statistics</s-text>
          <s-stack direction="block" gap="tight">
            <s-text variant="bodySm">
              Cache Hits: {cin7CacheStats.hits} | Misses: {cin7CacheStats.misses} | Hit Rate: {cin7CacheStats.hitRate}%
            </s-text>
            <s-text variant="bodySm">
              Cached Items: {cin7CacheStats.size}
            </s-text>
          </s-stack>

          <Form method="post">
            <input type="hidden" name="actionType" value="clearCin7Cache" />
            <s-button type="submit" variant="secondary">
              Clear COGS Cache
            </s-button>
          </Form>
        </s-stack>
      </s-section>

      <s-section heading="Developer Tools">
        <s-stack direction="block" gap="large">
          <s-paragraph>
            Debug individual orders by fetching their complete JSON payload from Shopify.
          </s-paragraph>

          <Form method="post">
            <input type="hidden" name="actionType" value="debugOrder" />
            <s-stack direction="block" gap="base">
              <s-stack direction="block" gap="tight">
                <s-text variant="bodySm">Order Number</s-text>
                <input
                  type="text"
                  name="orderNumber"
                  placeholder="#80819"
                  style={{
                    width: '100%',
                    maxWidth: '300px',
                    padding: '10px',
                    border: '1px solid var(--p-color-border)',
                    borderRadius: 'var(--p-border-radius-200)',
                    fontSize: '14px',
                  }}
                />
                <s-text tone="subdued" variant="bodySm">
                  Enter order number with or without # (e.g., 80819 or #80819)
                </s-text>
              </s-stack>

              <s-button type="submit">Fetch Order JSON</s-button>
            </s-stack>
          </Form>

          {actionData?.success && actionData.filePath && (
            <s-banner tone="success">
              <s-stack direction="block" gap="tight">
                <s-text>
                  <strong>Order data saved successfully!</strong>
                </s-text>
                <s-text variant="bodySm">
                  <strong>Server File:</strong> {actionData.filePath}
                </s-text>
                <s-text variant="bodySm">
                  <strong>Order ID:</strong> {actionData.orderId}
                </s-text>
                <s-text variant="bodySm">
                  <strong>Created:</strong> {actionData.createdAt}
                </s-text>
                <s-text variant="bodySm">
                  <strong>Updated:</strong> {actionData.updatedAt}
                </s-text>
                <s-text variant="bodySm">
                  <strong>Financial Status:</strong> {actionData.financialStatus}
                </s-text>
                <s-text variant="bodySm">
                  <strong>Transactions:</strong> {actionData.transactionCount}
                </s-text>

                <div style={{ marginTop: '12px' }}>
                  <s-button onClick={handleDownload}>
                    Download {actionData.filename}
                  </s-button>
                </div>
              </s-stack>
            </s-banner>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Danger Zone">
        <s-stack direction="block" gap="large">
          <s-banner tone="critical">
            <s-stack direction="block" gap="tight">
              <s-text variant="bodySm">
                <strong>⚠️ Warning:</strong> The actions below are permanent and cannot be undone.
              </s-text>
            </s-stack>
          </s-banner>

          <s-stack direction="block" gap="base">
            <s-text variant="headingSm">Clear All Export Files</s-text>
            <s-text variant="bodySm">
              Permanently delete all export files (CSV and TXT) from the server.
              This will remove all historical export data.
            </s-text>

            <Form
              method="post"
              onSubmit={(e) => {
                if (!confirm('⚠️ Are you sure you want to DELETE ALL export files? This action cannot be undone!')) {
                  e.preventDefault();
                }
              }}
            >
              <input type="hidden" name="actionType" value="clearAllExports" />
              <s-button
                type="submit"
                variant="primary"
                style={{
                  backgroundColor: 'var(--p-color-bg-critical)',
                  borderColor: 'var(--p-color-border-critical)',
                  color: 'white',
                }}
              >
                Delete All Exports
              </s-button>
            </Form>
          </s-stack>
        </s-stack>
      </s-section>

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
