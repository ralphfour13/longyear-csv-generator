import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Form, useActionData, useLoaderData } from 'react-router';
import { authenticate } from '../shopify.server';
import {
  getAccountMappings,
  saveAccountMappings,
} from '../services/storage.server';
import type { AccountMappings } from '../types/journal-entry';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const mappings = await getAccountMappings(shop);

  return Response.json({ shop, mappings });
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

        return Response.json({ success: true, message: 'Account mappings saved successfully' });
      } catch (error) {
        return Response.json(
          { success: false, error: 'Invalid mappings format' },
          { status: 400 }
        );
      }
    }
  }

  if (action === 'reset') {
    // Reset to defaults by deleting and re-initializing
    const defaultMappings = await getAccountMappings(shop);
    await saveAccountMappings(shop, defaultMappings);

    return Response.json({ success: true, message: 'Account mappings reset to defaults' });
  }

  return Response.json({ success: false, error: 'Invalid action' }, { status: 400 });
};

export default function AccountMappings() {
  const { shop, mappings } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <div style={{ padding: '20px' }}>
      <h1>Account Mappings</h1>
      <p>Configure Sage 50 account codes for different transaction types.</p>

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

      <Form method="post" id="mappingsForm">
        <input type="hidden" name="action" value="save" />
        <input
          type="hidden"
          name="mappings"
          id="mappingsData"
          value={JSON.stringify(mappings)}
        />

        <div style={{ marginBottom: '24px' }}>
          <h2>Revenue Accounts</h2>
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
        </div>

        <div style={{ marginBottom: '24px' }}>
          <h2>Asset Accounts</h2>
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
        </div>

        <div style={{ marginBottom: '24px' }}>
          <h2>Liability Accounts</h2>
          <MappingRow
            label="Sales Tax Payable"
            mappingKey="sales_tax"
            mapping={mappings.sales_tax}
          />
        </div>

        <div style={{ marginBottom: '24px' }}>
          <h2>Expense Accounts</h2>
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
        </div>

        <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
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
            Save Mappings
          </button>

          <button
            type="button"
            onClick={() => {
              const form = document.getElementById('mappingsForm') as HTMLFormElement;
              const actionInput = form.querySelector('[name="action"]') as HTMLInputElement;
              actionInput.value = 'reset';
              form.submit();
            }}
            style={{
              padding: '12px 24px',
              backgroundColor: '#f6f6f7',
              color: '#202223',
              border: '1px solid #c9cccf',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500',
            }}
          >
            Reset to Defaults
          </button>
        </div>
      </Form>
    </div>
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
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '200px 150px 250px 1fr',
        gap: '12px',
        marginBottom: '12px',
        padding: '12px',
        backgroundColor: '#f6f6f7',
        borderRadius: '4px',
      }}
    >
      <div>
        <strong>{label}</strong>
      </div>
      <div>
        <input
          type="text"
          defaultValue={mapping.accountCode}
          onChange={(e) => handleChange('accountCode', e.target.value)}
          placeholder="4000-00"
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
        <input
          type="text"
          defaultValue={mapping.accountName}
          onChange={(e) => handleChange('accountName', e.target.value)}
          placeholder="Account Name"
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
        <input
          type="text"
          defaultValue={mapping.description || ''}
          onChange={(e) => handleChange('description', e.target.value)}
          placeholder="Description (optional)"
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
  );
}
