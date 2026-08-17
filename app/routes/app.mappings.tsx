import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Form, useActionData, useLoaderData } from 'react-router';
import { authenticate } from '../shopify.server';
import {
  getAccountMappings,
  saveAccountMappings,
} from '../services/storage-adapter.server';
import type { AccountMappings } from '../types/journal-entry';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const mappings = await getAccountMappings(shop);

  return ({ shop, mappings });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const action = formData.get('action');

  if (action === 'save') {
    const mappingsJson = formData.get('mappings');
    if (typeof mappingsJson === 'string') {
      try {
        const mappings = JSON.parse(mappingsJson) as AccountMappings;
        await saveAccountMappings(shop, mappings);

        return { success: true, message: 'Account mappings saved successfully' };
      } catch {
        return { success: false, error: 'Invalid mappings format', status: 400 };
      }
    }
  }

  if (action === 'reset') {
    const defaultMappings = await getAccountMappings(shop);
    await saveAccountMappings(shop, defaultMappings);

    return { success: true, message: 'Account mappings reset to defaults' };
  }

  return { success: false, error: 'Invalid action', status: 400 };
};

export default function AccountMappings() {
  const { mappings } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <s-page heading="Account Mappings">
      {actionData?.success && (
        <s-banner tone="success">
          <s-text>{actionData.message}</s-text>
        </s-banner>
      )}

      {actionData && 'error' in actionData && actionData.error && (
        <s-banner tone="critical">
          <s-text>{actionData.error}</s-text>
        </s-banner>
      )}

      <Form method="post" id="mappingsForm">
        <input type="hidden" name="action" value="save" />
        <input
          type="hidden"
          name="mappings"
          id="mappingsData"
          value={JSON.stringify(mappings)}
        />

        <s-section heading="Revenue Accounts">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Configure Sage 50 account codes for revenue transactions
            </s-paragraph>

            <MappingRow
              label="Sales Revenue"
              mappingKey="sales_revenue"
              mapping={mappings.sales_revenue}
            />
            <MappingRow
              label="Shipping Revenue"
              mappingKey="shipping_revenue"
              mapping={mappings.shipping_revenue}
            />
            <MappingRow
              label="Discounts Given"
              mappingKey="discounts"
              mapping={mappings.discounts}
            />
          </s-stack>
        </s-section>

        <s-section heading="Asset Accounts">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Configure Sage 50 account codes for asset accounts
            </s-paragraph>

            <MappingRow
              label="Cash Account (Shopify Payouts)"
              mappingKey="cash_account"
              mapping={mappings.cash_account}
            />
            <MappingRow
              label="Clearing Account"
              mappingKey="clearing_account"
              mapping={mappings.clearing_account}
            />
            <MappingRow
              label="Accounts Receivable"
              mappingKey="accounts_receivable"
              mapping={mappings.accounts_receivable}
            />
            <MappingRow
              label="Inventory Asset"
              mappingKey="inventory"
              mapping={mappings.inventory}
            />
          </s-stack>
        </s-section>

        <s-section heading="Liability Accounts">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Configure Sage 50 account codes for liability accounts
            </s-paragraph>

            <MappingRow
              label="Sales Tax Payable"
              mappingKey="sales_tax"
              mapping={mappings.sales_tax}
            />
          </s-stack>
        </s-section>

        <s-section heading="Expense Accounts">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Configure Sage 50 account codes for expense accounts
            </s-paragraph>

            <MappingRow
              label="Payment Processing Fees"
              mappingKey="payment_processing_fees"
              mapping={mappings.payment_processing_fees}
            />
            <MappingRow
              label="Shopify Transaction Fees"
              mappingKey="shopify_fees"
              mapping={mappings.shopify_fees}
            />
            <MappingRow
              label="Cost of Goods Sold"
              mappingKey="cogs"
              mapping={mappings.cogs}
            />
            <MappingRow
              label="Sales Returns & Refunds"
              mappingKey="refunds_given"
              mapping={mappings.refunds_given}
            />
          </s-stack>
        </s-section>

        <div style={{ marginTop: '24px', display: 'flex', gap: '12px' }}>
          <s-button type="submit" variant="primary">
            Save Mappings
          </s-button>

          <s-button
            variant="secondary"
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onClick={(e: any) => {
              e.preventDefault();
              const form = document.getElementById('mappingsForm') as HTMLFormElement;
              const actionInput = form.querySelector('[name="action"]') as HTMLInputElement;
              actionInput.value = 'reset';
              form.submit();
            }}
          >
            Reset to Defaults
          </s-button>
        </div>
      </Form>

      <s-section heading="About Account Codes" slot="aside">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Account codes should match your Sage 50 chart of accounts. Use the format XXXX-XX (e.g., 4000-00).
          </s-paragraph>
          <s-paragraph>
            Changes take effect immediately on the next export.
          </s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}

interface MappingRowProps {
  label: string;
  mappingKey: string;
  mapping: { accountCode: string; accountName: string; description?: string };
}

function MappingRow({ label, mappingKey, mapping }: MappingRowProps) {
  const handleChange = (field: 'accountCode' | 'accountName' | 'description', value: string) => {
    const mappingsInput = document.getElementById('mappingsData') as HTMLInputElement;
    const currentMappings = JSON.parse(mappingsInput.value);

    currentMappings[mappingKey] = {
      ...currentMappings[mappingKey],
      [field]: value,
    };

    mappingsInput.value = JSON.stringify(currentMappings);
  };

  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack direction="block" gap="base">
        <s-text><strong>{label}</strong></s-text>

        <div style={{ width: '100%' }}>
        <s-stack direction="inline" gap="base">
          <div style={{ flex: '0 0 150px' }}>
            <s-stack direction="block" gap="base">
              <s-text>Account Code</s-text>
              <input
                type="text"
                defaultValue={mapping.accountCode}
                onChange={(e) => handleChange('accountCode', e.target.value)}
                placeholder="4000-00"
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid var(--p-color-border)',
                  borderRadius: 'var(--p-border-radius-200)',
                  fontSize: '14px',
                  fontFamily: 'monospace',
                }}
              />
            </s-stack>
          </div>

          <div style={{ flex: '1 1 200px' }}>
            <s-stack direction="block" gap="base">
              <s-text>Account Name</s-text>
              <input
                type="text"
                defaultValue={mapping.accountName}
                onChange={(e) => handleChange('accountName', e.target.value)}
                placeholder="Account Name"
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid var(--p-color-border)',
                  borderRadius: 'var(--p-border-radius-200)',
                  fontSize: '14px',
                }}
              />
            </s-stack>
          </div>

          <div style={{ flex: '1 1 300px' }}>
            <s-stack direction="block" gap="base">
              <s-text>Description</s-text>
              <input
                type="text"
                defaultValue={mapping.description || ''}
                onChange={(e) => handleChange('description', e.target.value)}
                placeholder="Optional description"
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid var(--p-color-border)',
                  borderRadius: 'var(--p-border-radius-200)',
                  fontSize: '14px',
                }}
              />
            </s-stack>
          </div>
        </s-stack>
        </div>
      </s-stack>
    </s-box>
  );
}
