import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Form, useActionData, useNavigation } from 'react-router';
import { useState } from 'react';
import { authenticate } from '../shopify.server';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const action = formData.get('action');

  if (action === 'generate') {
    const periodType = formData.get('periodType') as string;
    const year = parseInt(formData.get('year') as string, 10);

    if (!periodType || !year || isNaN(year)) {
      return { success: false, error: 'Period type and year are required' };
    }

    let salesTaxRequest: {
      periodType: 'month' | 'quarter';
      year: number;
      month?: number;
      quarter?: number;
    };

    if (periodType === 'month') {
      const month = parseInt(formData.get('month') as string, 10);
      if (!month || isNaN(month) || month < 1 || month > 12) {
        return { success: false, error: 'Valid month is required' };
      }
      salesTaxRequest = { periodType: 'month', year, month };
    } else if (periodType === 'quarter') {
      const quarter = parseInt(formData.get('quarter') as string, 10);
      if (!quarter || isNaN(quarter) || quarter < 1 || quarter > 4) {
        return { success: false, error: 'Valid quarter is required' };
      }
      salesTaxRequest = { periodType: 'quarter', year, quarter };
    } else {
      return { success: false, error: 'Invalid period type' };
    }

    try {
      const { createSalesTaxJob } = await import('../services/background-jobs.server');
      const { processPendingJobs } = await import('../services/job-processor.server');

      const jobId = await createSalesTaxJob(shop, salesTaxRequest);

      const accessToken = session.accessToken || '';
      processPendingJobs(shop, accessToken).catch((error) => {
        console.error('[SalesTax] Background job processing error:', error);
      });

      const periodLabel = periodType === 'month'
        ? `${getMonthName(salesTaxRequest.month!)} ${year}`
        : `Q${salesTaxRequest.quarter} ${year}`;

      return {
        success: true,
        processing: true,
        message: `Sales tax report started for ${periodLabel}. This may take several minutes. Check the Job Queue for progress.`,
        jobId,
      };
    } catch (error) {
      console.error('Sales tax report error:', error);
      return {
        success: false,
        error: `Report failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return { success: false, error: 'Invalid action' };
};

function getMonthName(month: number): string {
  const names = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return names[month - 1] || '';
}

export default function SalesTaxReport() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  const isGenerating = navigation.state === 'submitting';

  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const defaultYear = prevMonth.getFullYear();
  const defaultMonth = prevMonth.getMonth() + 1; // 1-indexed

  const [periodType, setPeriodType] = useState<'month' | 'quarter'>('month');
  const [year, setYear] = useState(defaultYear);

  // Generate year options (current year and 2 years back)
  const currentYear = now.getFullYear();
  const yearOptions = [currentYear, currentYear - 1, currentYear - 2];

  return (
    <s-page heading="Sales Tax Report">
      {actionData?.success && actionData?.message && (
        <s-banner tone="success">
          <s-text>{actionData.message}</s-text>
        </s-banner>
      )}

      {actionData?.error && (
        <s-banner tone="critical">
          <s-text>{actionData.error}</s-text>
        </s-banner>
      )}

      <s-section heading="Generate Sales Tax Report">
        <s-stack direction="block" gap="large">
          <s-paragraph>
            Generate a CSV report of sales tax data for California CDTFA filing.
            Includes POS transactions and online orders shipped to California.
            Orders are matched to the same dates as the daily export files.
          </s-paragraph>

          <Form method="post">
            <input type="hidden" name="action" value="generate" />

            <s-stack direction="block" gap="base">
              {/* Period Type Selection */}
              <div style={{ marginBottom: '12px' }}>
                <s-text><strong>Report Period</strong></s-text>
                <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="periodType"
                      value="month"
                      checked={periodType === 'month'}
                      onChange={() => setPeriodType('month')}
                    />
                    <s-text>Monthly</s-text>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="periodType"
                      value="quarter"
                      checked={periodType === 'quarter'}
                      onChange={() => setPeriodType('quarter')}
                    />
                    <s-text>Quarterly</s-text>
                  </label>
                </div>
              </div>

              {/* Year Selection */}
              <div style={{ maxWidth: '200px' }}>
                <s-text><strong>Year</strong></s-text>
                <select
                  name="year"
                  value={year}
                  onChange={(e) => setYear(parseInt((e.target as HTMLSelectElement).value, 10))}
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid var(--p-color-border)',
                    borderRadius: 'var(--p-border-radius-200)',
                    fontSize: '14px',
                    marginTop: '4px',
                  }}
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>

              {/* Month Selection (when monthly) */}
              {periodType === 'month' && (
                <div style={{ maxWidth: '200px' }}>
                  <s-text><strong>Month</strong></s-text>
                  <select
                    name="month"
                    defaultValue={defaultMonth}
                    style={{
                      width: '100%',
                      padding: '10px',
                      border: '1px solid var(--p-color-border)',
                      borderRadius: 'var(--p-border-radius-200)',
                      fontSize: '14px',
                      marginTop: '4px',
                    }}
                  >
                    {[
                      'January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December',
                    ].map((name, i) => (
                      <option key={i + 1} value={i + 1}>{name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Quarter Selection (when quarterly) */}
              {periodType === 'quarter' && (
                <div style={{ maxWidth: '200px' }}>
                  <s-text><strong>Quarter</strong></s-text>
                  <select
                    name="quarter"
                    defaultValue="1"
                    style={{
                      width: '100%',
                      padding: '10px',
                      border: '1px solid var(--p-color-border)',
                      borderRadius: 'var(--p-border-radius-200)',
                      fontSize: '14px',
                      marginTop: '4px',
                    }}
                  >
                    <option value="1">Q1 (Jan - Mar)</option>
                    <option value="2">Q2 (Apr - Jun)</option>
                    <option value="3">Q3 (Jul - Sep)</option>
                    <option value="4">Q4 (Oct - Dec)</option>
                  </select>
                </div>
              )}

              <div style={{ marginTop: '8px' }}>
                <s-button type="submit" variant="primary" loading={isGenerating ? true : undefined}>
                  {isGenerating ? 'Generating Report...' : 'Generate Sales Tax Report'}
                </s-button>
              </div>
            </s-stack>
          </Form>
        </s-stack>
      </s-section>

      <s-section heading="About This Report">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            This report includes:
          </s-paragraph>
          <ul style={{ paddingLeft: '20px', margin: '0' }}>
            <li><s-text>All POS (point of sale) transactions</s-text></li>
            <li><s-text>Online orders shipped to California</s-text></li>
          </ul>
          <s-paragraph>
            Each order shows taxable vs non-taxable amounts, tax jurisdiction breakdowns
            (up to 5), shipping charges, discounts, and refunds. Orders tagged
            &quot;licenses&quot; are flagged as exempt.
          </s-paragraph>
          <s-paragraph>
            Orders are assigned to capture dates matching the daily export files.
            A summary totals row is included at the bottom.
          </s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}
