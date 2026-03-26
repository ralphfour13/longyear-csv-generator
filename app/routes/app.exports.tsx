import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Form, useActionData, useNavigation } from 'react-router';
import { useState } from 'react';
import { authenticate } from '../shopify.server';
import { getShopConfig } from '../services/storage.server';
import { format } from 'date-fns';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const action = formData.get('action');

  if (action === 'export') {
    const useRange = formData.get('useRange') === 'true';

    // Read file generation options from saved config
    const config = await getShopConfig(shop);
    const fileOptions = {
      generateDailySales: config.generateDailySales !== false,
      generatePayoutsOrders: config.generatePayoutsOrders !== false,
      generateJournalDetails: config.generateJournalDetails !== false,
      generateJournalSummary: config.generateJournalSummary !== false,
      generateCogsDetails: config.generateCogsDetails !== false,
      generateReconciliation: config.generateReconciliation !== false,
    };

    try {
      const { createExportJob } = await import('../services/background-jobs.server');
      const { processPendingJobs } = await import('../services/job-processor.server');

      if (useRange) {
        const startDateParam = formData.get('startDate');
        const endDateParam = formData.get('endDate');

        if (!startDateParam || typeof startDateParam !== 'string' ||
            !endDateParam || typeof endDateParam !== 'string') {
          return { success: false, error: 'Start and end dates are required', status: 400 };
        }

        const startDate = new Date(startDateParam);
        const endDate = new Date(endDateParam);

        if (startDate > endDate) {
          return { success: false, error: 'Start date must be before end date', status: 400 };
        }

        console.log(
          `[Export] Creating date range export for ${shop}`,
          `\n  Range: ${startDateParam} to ${endDateParam}`,
          `\n  Files: ${Object.entries(fileOptions).filter(([, v]) => v).map(([k]) => k).join(', ')}`
        );

        const jobIds: string[] = [];
        const currentDate = new Date(startDate);

        while (currentDate <= endDate) {
          const dateStr = format(currentDate, 'yyyy-MM-dd');

          const jobId = await createExportJob(
            shop,
            dateStr,
            undefined,
            fileOptions
          );

          jobIds.push(jobId);
          console.log(`[Export] Created job ${jobId} for ${dateStr}`);
          currentDate.setDate(currentDate.getDate() + 1);
        }

        const dayCount = jobIds.length;
        console.log(
          `[Export] ✓ Created ${dayCount} jobs for date range`,
          `\n  Job IDs: ${jobIds.map(id => id.split('_')[2]).join(', ')}`
        );

        const accessToken = session.accessToken || '';
        console.log(`[Export] Starting background processing for ${dayCount} jobs`);
        processPendingJobs(shop, accessToken).catch((error) => {
          console.error('[Export] Background job processing error:', error);
        });

        return {
          success: true,
          processing: true,
          message: `Created ${dayCount} export jobs (${format(startDate, 'MMM d')} - ${format(endDate, 'MMM d, yyyy')}). Processing in background...`,
        };
      } else {
        const dateParam = formData.get('date');

        if (!dateParam || typeof dateParam !== 'string') {
          return { success: false, error: 'Export date is required', status: 400 };
        }

        console.log(
          `[Export] Creating single date export for ${shop}`,
          `\n  Date: ${dateParam}`,
          `\n  Files: ${Object.entries(fileOptions).filter(([, v]) => v).map(([k]) => k).join(', ')}`
        );

        const jobId = await createExportJob(
          shop,
          dateParam,
          undefined,
          fileOptions
        );

        console.log(`[Export] Created job ${jobId} for ${dateParam}`);

        const accessToken = session.accessToken || '';
        console.log(`[Export] Starting background processing for job ${jobId}`);
        processPendingJobs(shop, accessToken).catch((error) => {
          console.error('Background job processing error:', error);
        });

        return {
          success: true,
          processing: true,
          message: `Export started for ${dateParam}. Processing in background...`,
        };
      }
    } catch (error) {
      console.error('Export error:', error);
      return {
        success: false,
        error: `Export failed: ${error instanceof Error ? error.message : String(error)}`,
        status: 500,
      };
    }
  }

  return { success: false, error: 'Invalid action', status: 400 };
};

export default function Exports() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  const isExporting = navigation.state === 'submitting';
  const [useRange, setUseRange] = useState(false);

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const defaultDate = format(yesterday, 'yyyy-MM-dd');

  return (
    <s-page heading="Export Center">
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

      <s-section heading="Generate New Export">
        <s-stack direction="block" gap="large">
          <s-paragraph>
            Select a date {useRange ? 'range' : ''} to export journal entries for charges captured on {useRange ? 'those days' : 'that day'}.
          </s-paragraph>

          <Form method="post">
            <input type="hidden" name="action" value="export" />
            <input type="hidden" name="useRange" value={useRange ? 'true' : 'false'} />

            <s-stack direction="block" gap="base">
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={useRange}
                    onChange={(e) => setUseRange(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <s-text>Use date range (generate exports for multiple days)</s-text>
                </label>
              </div>

              <div style={{ maxWidth: '300px' }}>
                <s-stack direction="block" gap="base">
                  <s-text>{useRange ? 'Start Date' : 'Export Date'}</s-text>
                  <input
                    type="date"
                    name={useRange ? 'startDate' : 'date'}
                    defaultValue={defaultDate}
                    required
                    style={{
                      width: '100%',
                      padding: '10px',
                      border: '1px solid var(--p-color-border)',
                      borderRadius: 'var(--p-border-radius-200)',
                      fontSize: '14px',
                    }}
                  />
                </s-stack>
              </div>

              {useRange && (
                <div style={{ maxWidth: '300px' }}>
                  <s-stack direction="block" gap="base">
                    <s-text>End Date</s-text>
                    <input
                      type="date"
                      name="endDate"
                      defaultValue={defaultDate}
                      required
                      style={{
                        width: '100%',
                        padding: '10px',
                        border: '1px solid var(--p-color-border)',
                        borderRadius: 'var(--p-border-radius-200)',
                        fontSize: '14px',
                      }}
                    />
                  </s-stack>
                </div>
              )}

              <div>
                <s-button type="submit" variant="primary" loading={isExporting ? true : undefined}>
                  {isExporting ? 'Generating Export...' : 'Generate CSV'}
                </s-button>
              </div>
            </s-stack>
          </Form>
        </s-stack>
      </s-section>
    </s-page>
  );
}
