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
import { testEmailConnection } from '../services/email.server';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const config = await getShopConfig(shop);
  const cin7Config = await getCin7Config(shop);
  const cin7CacheStats = cin7Cache.getStats(shop);

  return { shop, config, cin7Config, cin7CacheStats };
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
        return {
          success: false,
          error: 'Account ID and API Key are required',
        };
      }

      const testResult = await testCin7Connection(accountId, apiKey);

      return {
        success: testResult.success,
        message: testResult.message,
      };
    } catch (error) {
      return {
        success: false,
        error: `Connection test failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // Handle Cin7 clear cache
  if (actionType === 'clearCin7Cache') {
    try {
      cin7Cache.clearShop(shop);
      return {
        success: true,
        message: 'Cin7 cache cleared successfully',
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to clear cache: ${error instanceof Error ? error.message : String(error)}`,
      };
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

      return {
        success: true,
        message: 'Cin7 settings saved successfully',
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to save Cin7 settings: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // Handle test email
  if (actionType === 'testEmail') {
    try {
      const testRecipient = formData.get('testEmailRecipient') as string;

      if (!testRecipient) {
        return {
          success: false,
          error: 'Email address is required',
        };
      }

      const result = await testEmailConnection(testRecipient);

      return {
        success: result.success,
        message: result.success
          ? `Test email sent successfully to ${testRecipient}`
          : result.error,
        messageId: result.messageId,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to send test email: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // Handle clear all exports
  if (actionType === 'clearAllExports') {
    try {
      const exportFiles = await listExports(shop);

      if (exportFiles.length === 0) {
        return {
          success: true,
          message: 'No exports to delete',
          deletedCount: 0,
        };
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
        return {
          success: false,
          error: `Deleted ${deletedCount} files, but ${errors.length} failed: ${errors.join(', ')}`,
          deletedCount,
        };
      }

      return {
        success: true,
        message: `Successfully deleted ${deletedCount} export file${deletedCount !== 1 ? 's' : ''}`,
        deletedCount,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to clear exports: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // Handle order debug action
  if (actionType === 'debugOrder') {
    try {
      const orderNumber = formData.get('orderNumber') as string;
      console.log('🔍 DEBUG ORDER: Fetching order:', orderNumber);

      if (!orderNumber) {
        console.log('❌ DEBUG ORDER: No order number provided');
        return {
          success: false,
          error: 'Order number is required',
        };
      }

      const accessToken = session.accessToken || '';
      let order = null;

      // Normalize order number for later use
      const normalizedOrderNumber = orderNumber.startsWith('#') ? orderNumber : `#${orderNumber}`;

      // Check if this looks like an order ID (long numeric value)
      const isOrderId = /^\d{10,}$/.test(orderNumber.trim());

      if (isOrderId) {
        // Strategy 0: Direct fetch by ID (most reliable)
        console.log('🔍 DEBUG ORDER: Detected order ID format, fetching directly...');
        const idUrl = `https://${shop}/admin/api/2024-10/orders/${orderNumber}.json`;
        console.log('🔍 DEBUG ORDER: Strategy 0 - Direct ID fetch:', idUrl.replace(accessToken, 'REDACTED'));

        try {
          const idResponse = await fetch(idUrl, {
            headers: {
              'X-Shopify-Access-Token': accessToken,
              'Content-Type': 'application/json',
            },
          });

          if (idResponse.ok) {
            const idData = await idResponse.json();
            order = idData.order;
            console.log('✅ DEBUG ORDER: Found via Strategy 0 - Direct ID fetch');
            console.log('🔍 DEBUG ORDER: Order name:', order.name, 'order_number:', order.order_number);
          } else {
            console.log('⚠️ DEBUG ORDER: Strategy 0 failed, trying other strategies...');
          }
        } catch (error) {
          console.log('⚠️ DEBUG ORDER: Strategy 0 error:', error);
        }
      }

      // If not found by ID, try other strategies
      if (!order) {
        console.log('🔍 DEBUG ORDER: Using normalized order number:', normalizedOrderNumber);

        // Try multiple search strategies
        // Strategy 1: Search by name parameter
        let url = `https://${shop}/admin/api/2024-10/orders.json?name=${encodeURIComponent(normalizedOrderNumber)}&status=any&limit=1`;
        console.log('🔍 DEBUG ORDER: Strategy 1 - Search by name:', url.replace(accessToken, 'REDACTED'));

        const response = await fetch(url, {
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log('🔍 DEBUG ORDER: Strategy 1 found orders:', data.orders?.length || 0);

        // Strategy 1 succeeded
        if (data.orders && data.orders.length > 0) {
          order = data.orders[0];
          console.log('✅ DEBUG ORDER: Found via Strategy 1');
        }

        // Strategy 2: Fetch recent orders and search client-side
        if (!order) {
          console.log('🔍 DEBUG ORDER: Strategy 2 - Fetch recent orders and filter client-side');
          const recentUrl = `https://${shop}/admin/api/2024-10/orders.json?status=any&limit=250`;
          console.log('🔍 DEBUG ORDER: Strategy 2 URL:', recentUrl.replace(accessToken, 'REDACTED'));

          const recentResponse = await fetch(recentUrl, {
            headers: {
              'X-Shopify-Access-Token': accessToken,
              'Content-Type': 'application/json',
            },
          });

          if (recentResponse.ok) {
            const recentData = await recentResponse.json();
            console.log('🔍 DEBUG ORDER: Strategy 2 fetched:', recentData.orders?.length || 0, 'orders');

            // Log first 5 order names to see format
            if (recentData.orders && recentData.orders.length > 0) {
              const sampleNames = recentData.orders.slice(0, 5).map((o: any) =>
                `name="${o.name}" order_number=${o.order_number}`
              );
              console.log('🔍 DEBUG ORDER: Sample order formats:', sampleNames);
            }

            // Search for matching order name
            const numericOrderNumber = normalizedOrderNumber.replace('#', '');
            order = recentData.orders?.find((o: any) =>
              o.name === normalizedOrderNumber ||
              o.name === numericOrderNumber ||
              o.order_number?.toString() === numericOrderNumber
            );

            if (order) {
              console.log('✅ DEBUG ORDER: Found via Strategy 2 - client-side filter');
            }
          }
        }

        // Strategy 3: Search by date range (Dec 22-23, 2025 based on screenshot)
        if (!order) {
          console.log('🔍 DEBUG ORDER: Strategy 3 - Search by date range (Dec 22-23, 2025)');
          const dateUrl = `https://${shop}/admin/api/2024-10/orders.json?created_at_min=2025-12-22T00:00:00Z&created_at_max=2025-12-24T00:00:00Z&status=any&limit=250`;
          console.log('🔍 DEBUG ORDER: Strategy 3 URL:', dateUrl.replace(accessToken, 'REDACTED'));

          const dateResponse = await fetch(dateUrl, {
            headers: {
              'X-Shopify-Access-Token': accessToken,
              'Content-Type': 'application/json',
            },
          });

          if (dateResponse.ok) {
            const dateData = await dateResponse.json();
            console.log('🔍 DEBUG ORDER: Strategy 3 fetched:', dateData.orders?.length || 0, 'orders from Dec 22-23');

            const numericOrderNumber = normalizedOrderNumber.replace('#', '');
            order = dateData.orders?.find((o: any) =>
              o.name === normalizedOrderNumber ||
              o.name === numericOrderNumber ||
              o.order_number?.toString() === numericOrderNumber
            );

            if (order) {
              console.log('✅ DEBUG ORDER: Found via Strategy 3 - date range search');
            }
          }
        }

        // Strategy 4: Search ARCHIVED orders by date range
        if (!order) {
          console.log('🔍 DEBUG ORDER: Strategy 4 - Search archived orders (Dec 22-23, 2025)');
          const archivedUrl = `https://${shop}/admin/api/2024-10/orders.json?created_at_min=2025-12-22T00:00:00Z&created_at_max=2025-12-24T00:00:00Z&status=archived&limit=250`;
          console.log('🔍 DEBUG ORDER: Strategy 4 URL:', archivedUrl.replace(accessToken, 'REDACTED'));

          const archivedResponse = await fetch(archivedUrl, {
            headers: {
              'X-Shopify-Access-Token': accessToken,
              'Content-Type': 'application/json',
            },
          });

          if (archivedResponse.ok) {
            const archivedData = await archivedResponse.json();
            console.log('🔍 DEBUG ORDER: Strategy 4 fetched:', archivedData.orders?.length || 0, 'archived orders from Dec 22-23');

            const numericOrderNumber = normalizedOrderNumber.replace('#', '');
            order = archivedData.orders?.find((o: any) =>
              o.name === normalizedOrderNumber ||
              o.name === numericOrderNumber ||
              o.order_number?.toString() === numericOrderNumber
            );

            if (order) {
              console.log('✅ DEBUG ORDER: Found via Strategy 4 - archived orders search');
            }
          }
        }
      } // End of if (!order) - all strategies

      if (!order) {
        console.log('❌ DEBUG ORDER: Order not found after all strategies');
        return {
          success: false,
          error: `Order not found. Tried: (0) Direct ID fetch, (1) name search, (2) recent 250 orders, (3) Dec 22-23 date range, (4) archived orders Dec 22-23.`,
        };
      }

      console.log('🔍 DEBUG ORDER: Order ID:', order.id, 'Name:', order.name, 'Created:', order.created_at);

      // Fetch transactions for this order
      const txnUrl = `https://${shop}/admin/api/2024-10/orders/${order.id}/transactions.json`;
      const txnResponse = await fetch(txnUrl, {
        headers: {
          'X-Shopify-Access-Token': accessToken,
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
      const filename = `order-${normalizedOrderNumber.replace('#', '')}-${timestamp}.json`;
      const filePath = path.join(dataDir, filename);

      const jsonString = JSON.stringify(order, null, 2);
      await fs.writeFile(filePath, jsonString);
      console.log('✅ DEBUG ORDER: Saved to:', filePath);

      return {
        success: true,
        message: `Order ${normalizedOrderNumber} data saved successfully`,
        filePath: filePath,
        filename: filename,
        orderId: order.id,
        createdAt: order.created_at,
        updatedAt: order.updated_at,
        financialStatus: order.financial_status,
        transactionCount: order.transactions?.length || 0,
        jsonData: jsonString, // Include JSON for client-side download
      };
    } catch (error) {
      console.error('❌ DEBUG ORDER ERROR:', error);
      return {
        success: false,
        error: `Failed to fetch order: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // Handle bulk tag orders
  if (actionType === 'bulkTagOrders') {
    const debugInfo: string[] = [];
    try {
      const accessToken = session.accessToken || '';
      const targetDates = ['2025-12-22', '2025-12-23'];
      let totalOrders = 0;
      let taggedOrders = 0;
      const errors: string[] = [];

      for (const date of targetDates) {
        // Fetch orders for this date - use UTC format
        // Convert PST date to UTC (PST is UTC-8)
        // Example: Dec 22 00:00:00 PST = Dec 22 08:00:00 UTC
        //          Dec 22 23:59:59 PST = Dec 23 07:59:59 UTC (next day!)
        const startDate = `${date}T08:00:00Z`; // Midnight PST = 8am UTC

        // Calculate next day for end date
        const dateParts = date.split('-');
        const year = parseInt(dateParts[0]);
        const month = parseInt(dateParts[1]);
        const day = parseInt(dateParts[2]);
        const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
        const nextDateStr = nextDay.toISOString().split('T')[0]; // YYYY-MM-DD

        const endDate = `${nextDateStr}T07:59:59Z`; // Just before midnight next day in PST

        const url = `https://${shop}/admin/api/2024-10/orders.json?status=any&created_at_min=${encodeURIComponent(startDate)}&created_at_max=${encodeURIComponent(endDate)}&limit=250`;
        debugInfo.push(`Querying: ${url.replace(accessToken, 'REDACTED')}`);

        const response = await fetch(url, {
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          debugInfo.push(`API Error ${response.status}: ${errorText}`);
          throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const orders = data.orders || [];
        debugInfo.push(`Found ${orders.length} orders for ${date}`);
        totalOrders += orders.length;

        // Tag each order
        for (const order of orders) {
          try {
            // Check if order already has "Imported" tag
            const existingTags = order.tags ? order.tags.split(',').map((t: string) => t.trim()) : [];

            if (existingTags.includes('Imported')) {
              taggedOrders++; // Already tagged
              continue;
            }

            // Add "Imported" tag
            const newTags = [...existingTags, 'Imported'].join(', ');

            const updateUrl = `https://${shop}/admin/api/2024-10/orders/${order.id}.json`;
            const updateResponse = await fetch(updateUrl, {
              method: 'PUT',
              headers: {
                'X-Shopify-Access-Token': accessToken,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                order: {
                  id: order.id,
                  tags: newTags,
                },
              }),
            });

            if (updateResponse.ok) {
              taggedOrders++;
            } else {
              errors.push(`Failed to tag order ${order.name}: ${updateResponse.status}`);
            }
          } catch (error) {
            errors.push(`Error tagging order ${order.name}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }

      if (errors.length > 0) {
        return {
          success: false,
          error: `Tagged ${taggedOrders}/${totalOrders} orders. Errors: ${errors.slice(0, 5).join(', ')}${errors.length > 5 ? '...' : ''}`,
          taggedOrders,
          totalOrders,
          debugInfo,
        };
      }

      return {
        success: true,
        message: `Successfully tagged ${taggedOrders} orders from 12/22/2025 and 12/23/2025 as "Imported"`,
        taggedOrders,
        totalOrders,
        debugInfo,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to bulk tag orders: ${error instanceof Error ? error.message : String(error)}`,
        debugInfo: debugInfo || [],
      };
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
      emailEnabled: formData.get('emailEnabled') === 'true',
      emailRecipients: (formData.get('emailRecipients') as string) || '',
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

    return { success: true, message: 'Settings saved successfully' };
  } catch (error) {
    return { success: false, error: 'Failed to save settings' };
  }
};

export default function Settings() {
  const { config, cin7Config, cin7CacheStats } = useLoaderData<typeof loader>();
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
        <s-banner tone="success">
          <s-text>{actionData.message}</s-text>
        </s-banner>
      )}

      {actionData?.error && (
        <s-banner tone="critical">
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

              <s-stack direction="block" gap="base">
                <s-text>Schedule Type</s-text>
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

              <s-stack direction="block" gap="base">
                <s-text>Scheduled Time (24-hour format)</s-text>
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
                <s-text tone="neutral">
                  Time when automatic exports will run (e.g., 02:00 for 2:00 AM)
                </s-text>
              </s-stack>

              <s-stack direction="block" gap="base">
                <s-text>Auto-Export Date Range</s-text>
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
                <s-text tone="neutral">
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
                <s-text tone="neutral">Inventory Adjustments (Coming Soon)</s-text>
              </label>
            </s-stack>
          </s-stack>
        </s-section>

        <s-section heading="CSV Format">
          <s-stack direction="block" gap="large">
            <s-stack direction="block" gap="base">
              <s-text>Format Type</s-text>
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

        <s-section heading="Email Notifications">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Automatically send export files via email when scheduled exports complete.
              Multiple recipients can be specified (comma-separated).
            </s-paragraph>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                name="emailEnabled"
                defaultChecked={config.emailEnabled}
              />
              <s-text>Enable email notifications for scheduled exports</s-text>
            </label>

            <s-stack direction="block" gap="base">
              <s-text>Email Recipients</s-text>
              <input
                type="text"
                name="emailRecipients"
                defaultValue={config.emailRecipients || ''}
                placeholder="accounting@example.com, manager@example.com"
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid var(--p-color-border)',
                  borderRadius: 'var(--p-border-radius-200)',
                  fontSize: '14px',
                }}
              />
              <s-text tone="neutral">
                Comma-separated email addresses. Files will be attached to the email.
              </s-text>
            </s-stack>

            <s-divider />

            <s-stack direction="block" gap="base">
              <s-text><strong>Test Email Configuration</strong></s-text>
              <s-text tone="neutral">
                Send a test email to verify your configuration is working.
              </s-text>
            </s-stack>
          </s-stack>
        </s-section>

        <Form method="post" style={{ marginTop: '16px' }}>
          <input type="hidden" name="actionType" value="testEmail" />
          <s-stack direction="block" gap="base">
            <input
              type="email"
              name="testEmailRecipient"
              placeholder="test@example.com"
              required
              style={{
                width: '100%',
                maxWidth: '400px',
                padding: '10px',
                border: '1px solid var(--p-color-border)',
                borderRadius: 'var(--p-border-radius-200)',
                fontSize: '14px',
              }}
            />
            <s-button type="submit" variant="secondary">
              Send Test Email
            </s-button>
          </s-stack>
        </Form>

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

              <s-stack direction="block" gap="base">
                <s-text>Cin7 Account ID</s-text>
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
                <s-text tone="neutral">
                  Found in Cin7 Settings → Integrations → API
                </s-text>
              </s-stack>

              <s-stack direction="block" gap="base">
                <s-text>Cin7 API Key</s-text>
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
                <s-text tone="neutral">
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

          <s-text>Test Connection</s-text>
          <Form method="post">
            <input type="hidden" name="actionType" value="testCin7Connection" />
            <input type="hidden" name="cin7AccountId" value={cin7Config.accountId} />
            <input type="hidden" name="cin7ApiKey" value={cin7Config.apiKey} />

            <s-stack direction="inline" gap="base">
              <s-button type="submit">Test Cin7 Connection</s-button>
              <s-text tone="neutral">
                Last tested: {cin7Config.lastTested ? new Date(cin7Config.lastTested).toLocaleString() : 'Never'}
              </s-text>
            </s-stack>
          </Form>

          <s-divider />

          <s-text>Advanced Settings</s-text>
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

              <s-stack direction="block" gap="base">
                <s-text>Cache Duration (hours)</s-text>
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

              <s-stack direction="block" gap="base">
                <s-text>Fallback COGS (optional)</s-text>
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
                <s-text tone="neutral">
                  Default cost to use when product not found in Cin7
                </s-text>
              </s-stack>

              <div style={{ marginTop: '12px' }}>
                <s-button type="submit">Save Advanced Settings</s-button>
              </div>
            </s-stack>
          </Form>

          <s-divider />

          <s-text>Cache Statistics</s-text>
          <s-stack direction="block" gap="base">
            <s-text>
              Cache Hits: {cin7CacheStats.hits} | Misses: {cin7CacheStats.misses} | Hit Rate: {cin7CacheStats.hitRate}%
            </s-text>
            <s-text>
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
              <s-stack direction="block" gap="base">
                <s-text>Order Number</s-text>
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
                <s-text tone="neutral">
                  Enter order number with or without # (e.g., 80819 or #80819)
                </s-text>
              </s-stack>

              <s-button type="submit">Fetch Order JSON</s-button>
            </s-stack>
          </Form>

          {actionData?.success && actionData.filePath && (
            <s-banner tone="success">
              <s-stack direction="block" gap="base">
                <s-text>
                  <strong>Order data saved successfully!</strong>
                </s-text>
                <s-text>
                  <strong>Server File:</strong> {actionData.filePath}
                </s-text>
                <s-text>
                  <strong>Order ID:</strong> {actionData.orderId}
                </s-text>
                <s-text>
                  <strong>Created:</strong> {actionData.createdAt}
                </s-text>
                <s-text>
                  <strong>Updated:</strong> {actionData.updatedAt}
                </s-text>
                <s-text>
                  <strong>Financial Status:</strong> {actionData.financialStatus}
                </s-text>
                <s-text>
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

          <div style={{ marginTop: '32px', paddingTop: '32px', borderTop: '1px solid var(--p-color-border)' }}>
            <s-stack direction="block" gap="large">
              <s-stack direction="block" gap="base">
                <s-text><strong>Bulk Tag Orders</strong></s-text>
                <s-paragraph>
                  Tag all orders from December 22-23, 2025 as "Imported" for tracking purposes.
                </s-paragraph>
              </s-stack>

              <Form method="post">
                <input type="hidden" name="actionType" value="bulkTagOrders" />
                <s-button type="submit" variant="primary">
                  Tag 12/22-23/2025 Orders as "Imported"
                </s-button>
              </Form>

              {actionData?.success && actionData.taggedOrders !== undefined && (
                <s-banner tone="success">
                  <s-stack direction="block" gap="base">
                    <s-text>
                      <strong>Successfully tagged {actionData.taggedOrders} orders!</strong>
                    </s-text>
                    <s-text>
                      Total orders found: {actionData.totalOrders}
                    </s-text>
                    {actionData.debugInfo && actionData.debugInfo.length > 0 && (
                      <div style={{ marginTop: '12px', padding: '12px', backgroundColor: '#f6f6f7', borderRadius: '4px', fontSize: '12px', fontFamily: 'monospace' }}>
                        <s-text><strong>Debug Info:</strong></s-text>
                        {actionData.debugInfo.map((info: string, idx: number) => (
                          <div key={idx} style={{ marginTop: '4px' }}>{info}</div>
                        ))}
                      </div>
                    )}
                  </s-stack>
                </s-banner>
              )}
            </s-stack>
          </div>
        </s-stack>
      </s-section>

      <s-section heading="Danger Zone">
        <s-stack direction="block" gap="large">
          <s-banner tone="critical">
            <s-stack direction="block" gap="base">
              <s-text>
                <strong>⚠️ Warning:</strong> The actions below are permanent and cannot be undone.
              </s-text>
            </s-stack>
          </s-banner>

          <s-stack direction="block" gap="base">
            <s-text>Clear All Export Files</s-text>
            <s-text>
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
                tone="critical"
              >
                Delete All Exports
              </s-button>
            </Form>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="How It Works" slot="aside">
        <s-stack direction="block" gap="base">
          <s-text>
            <strong>Manual Export:</strong> Go to Export Center and select specific dates to generate CSV on-demand.
          </s-text>
          <s-text>
            <strong>Automatic Export:</strong> Enable nightly sync to generate CSV files at scheduled time.
          </s-text>
          <s-text>
            <strong>Payout-First:</strong> Starts with bank deposits and works backwards for perfect reconciliation.
          </s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}
