import type { EnrichedTransaction } from '../types/journal-entry';
import type { SalesTaxReportRequest, ShopAddress } from '../types/sales-tax';
import { reconcileOrdersByDate } from './order-centric-reconciler.server';
import { generateSalesTaxReport } from './sales-tax-report-generator.server';
import { writeExport } from './storage.server';
import { updateJobProgress } from './background-jobs.server';

/**
 * Fetch the shop's physical address from Shopify for POS order location
 */
export async function fetchShopAddress(
  shop: string,
  accessToken: string,
): Promise<ShopAddress> {
  const url = `https://${shop}/admin/api/2024-10/shop.json`;

  const response = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to fetch shop info: ${response.status} ${response.statusText} - ${errorText}`,
    );
  }

  const data = await response.json();
  const shopData = data.shop;

  return {
    city: shopData.city || '',
    province: shopData.province || '',
    provinceCode: shopData.province_code || '',
  };
}

/**
 * Calculate the date range for a sales tax report request
 */
function getDateRange(request: SalesTaxReportRequest): { startDate: string; endDate: string; label: string } {
  if (request.periodType === 'month' && request.month) {
    const year = request.year;
    const month = request.month;
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;

    // Last day of month
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    const label = `${monthNames[month - 1]} ${year}`;

    return { startDate, endDate, label };
  }

  if (request.periodType === 'quarter' && request.quarter) {
    const year = request.year;
    const quarter = request.quarter;
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;

    const startDate = `${year}-${String(startMonth).padStart(2, '0')}-01`;
    const lastDay = new Date(year, endMonth, 0).getDate();
    const endDate = `${year}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    const label = `Q${quarter} ${year}`;

    return { startDate, endDate, label };
  }

  throw new Error('Invalid sales tax report request: must specify month or quarter');
}

/**
 * Get all dates between start and end (inclusive) as YYYY-MM-DD strings
 */
function getDatesInRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = new Date(startDate + 'T12:00:00Z'); // noon UTC to avoid DST issues
  const end = new Date(endDate + 'T12:00:00Z');

  while (current <= end) {
    const year = current.getUTCFullYear();
    const month = String(current.getUTCMonth() + 1).padStart(2, '0');
    const day = String(current.getUTCDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

/**
 * Process a sales tax report request
 *
 * Iterates day-by-day through the period, calling the existing reconciliation
 * pipeline for each day. This guarantees orders land on the exact same days
 * as the daily export files.
 */
export async function processSalesTaxReport(
  shop: string,
  accessToken: string,
  request: SalesTaxReportRequest,
  jobId?: string,
): Promise<{ filename: string; orderCount: number; filteredCount: number }> {
  const { startDate, endDate, label } = getDateRange(request);
  const dates = getDatesInRange(startDate, endDate);

  console.log(`[SalesTax] Starting report for ${label}: ${startDate} to ${endDate} (${dates.length} days)`);

  // Step 1: Fetch shop address for POS orders
  if (jobId) {
    await updateJobProgress(jobId, {
      phase: 'fetching',
      phaseLabel: 'Fetching Shop Info',
      currentActivity: 'Getting store address for POS orders...',
      startTime: Date.now(),
    });
  }

  const shopAddress = await fetchShopAddress(shop, accessToken);
  console.log(`[SalesTax] Shop address: ${shopAddress.city}, ${shopAddress.provinceCode}`);

  // Step 2: Iterate day-by-day, collecting enriched transactions
  const allEnrichedTransactions: EnrichedTransaction[] = [];
  let totalOrdersProcessed = 0;

  for (let i = 0; i < dates.length; i++) {
    const dayStr = dates[i];

    if (jobId) {
      await updateJobProgress(jobId, {
        phase: 'reconciling',
        phaseLabel: 'Processing Orders',
        currentActivity: `Processing day ${i + 1}/${dates.length}: ${dayStr}`,
        ordersProcessed: totalOrdersProcessed,
      });
    }

    try {
      // Skip COGS/Cin7 — sales tax report doesn't need cost data
      const result = await reconcileOrdersByDate(shop, accessToken, dayStr, undefined, undefined, true);

      if (result.enrichedTransactions.length > 0) {
        allEnrichedTransactions.push(...result.enrichedTransactions);
        totalOrdersProcessed += result.orderCount;
        console.log(
          `[SalesTax] ${dayStr}: ${result.enrichedTransactions.length} transactions ` +
          `(${result.orderCount} orders, ${result.captureCount} captures)`,
        );
      }
    } catch (error) {
      console.error(`[SalesTax] Error processing ${dayStr}:`, error);
      // Continue with other days — don't fail the whole report for one bad day
    }
  }

  console.log(
    `[SalesTax] Collected ${allEnrichedTransactions.length} total enriched transactions ` +
    `across ${dates.length} days`,
  );

  // Step 3: Generate the report (filtering happens inside the generator)
  if (jobId) {
    await updateJobProgress(jobId, {
      phase: 'generating',
      phaseLabel: 'Generating Report',
      currentActivity: 'Building sales tax report CSV...',
      ordersProcessed: totalOrdersProcessed,
    });
  }

  const csvContent = generateSalesTaxReport(
    allEnrichedTransactions,
    shopAddress,
  );

  // Count filtered orders (non-header, non-totals, non-blank lines)
  const csvLines = csvContent.split('\n');
  // Lines: title, blank, header, data rows..., totals
  const filteredCount = Math.max(0, csvLines.length - 4); // subtract title, blank, header, totals

  // Step 4: Save the file
  const sanitizedLabel = label.replace(/\s+/g, '-');
  const filename = `sales-tax-report-${sanitizedLabel}.csv`;

  await writeExport(shop, filename, csvContent);

  console.log(
    `[SalesTax] Report complete: ${filename}`,
    `\n  Period: ${label}`,
    `\n  Total transactions: ${allEnrichedTransactions.length}`,
    `\n  Filtered orders in report: ${filteredCount}`,
  );

  if (jobId) {
    await updateJobProgress(jobId, {
      phase: 'generating',
      phaseLabel: 'Complete',
      currentActivity: `Report generated: ${filteredCount} orders`,
      ordersProcessed: totalOrdersProcessed,
    });
  }

  return {
    filename,
    orderCount: totalOrdersProcessed,
    filteredCount,
  };
}
