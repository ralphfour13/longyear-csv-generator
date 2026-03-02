/**
 * Order State Tracking Service
 *
 * Tracks order snapshots at export time and detects changes to flag orders
 * needing re-export. Maintains version history for audit purposes.
 */

import { PrismaClient } from '@prisma/client';
import type { Order } from '../types/journal-entry';

const prisma = new PrismaClient();

/**
 * Order Snapshot (stored in database)
 */
export interface OrderSnapshot {
  id: string;
  shop: string;
  orderId: string;
  orderNumber: string;
  exportDate: string; // YYYY-MM-DD
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  snapshotData: any; // Full order data at export time
  totalPrice: number;
  financialStatus: string;
  fulfillmentStatus: string | null;
  version: number;
  createdAt: Date;
}

/**
 * Order Change Detection Result
 */
export interface OrderChangeResult {
  hasChanged: boolean;
  changes: string[];
  previousSnapshot: OrderSnapshot | null;
  needsReexport: boolean;
}

/**
 * Save order snapshot at export time
 *
 * @param shop - Shop domain
 * @param order - Order to snapshot
 * @param exportDate - Export date (YYYY-MM-DD)
 * @param version - Version number (default: 1)
 * @returns Saved snapshot
 */
export async function saveOrderSnapshot(
  shop: string,
  order: Order,
  exportDate: string,
  version: number = 1
): Promise<OrderSnapshot> {
  const snapshot = await prisma.orderSnapshot.create({
    data: {
      shop,
      orderId: order.id,
      orderNumber: order.name,
      exportDate,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
      snapshotData: order as any, // Store full order JSON
      totalPrice: parseFloat(order.totalPrice.toString()),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
      financialStatus: order.financialStatus,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fulfillmentStatus: (order as any).fulfillmentStatus || null,
      version,
    },
  });

  return snapshot as unknown as OrderSnapshot;
}

/**
 * Get the latest snapshot for an order on a specific date
 *
 * @param shop - Shop domain
 * @param orderId - Order ID
 * @param exportDate - Export date (YYYY-MM-DD)
 * @returns Latest snapshot or null if not found
 */
export async function getOrderSnapshot(
  shop: string,
  orderId: string,
  exportDate: string
): Promise<OrderSnapshot | null> {
  const snapshot = await prisma.orderSnapshot.findFirst({
    where: {
      shop,
      orderId,
      exportDate,
    },
    orderBy: {
      version: 'desc',
    },
  });

  return snapshot as OrderSnapshot | null;
}

/**
 * Get all snapshots for an order
 *
 * @param shop - Shop domain
 * @param orderId - Order ID
 * @returns Array of snapshots ordered by date and version
 */
export async function getOrderSnapshots(
  shop: string,
  orderId: string
): Promise<OrderSnapshot[]> {
  const snapshots = await prisma.orderSnapshot.findMany({
    where: {
      shop,
      orderId,
    },
    orderBy: [
      { exportDate: 'desc' },
      { version: 'desc' },
    ],
  });

  return snapshots as unknown as OrderSnapshot[];
}

/**
 * Compare current order state vs previous snapshot
 *
 * @param currentOrder - Current order state
 * @param previousSnapshot - Previous snapshot data
 * @returns Array of detected changes
 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
function compareOrderStates(
  currentOrder: Order,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  previousSnapshot: any
): string[] {
  const changes: string[] = [];

  // Check financial status
  if (currentOrder.financialStatus !== previousSnapshot.financialStatus) {
    changes.push(
      `Financial status changed: ${previousSnapshot.financialStatus} → ${currentOrder.financialStatus}`
    );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }

  // Check fulfillment status
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currentFulfillmentStatus = (currentOrder as any).fulfillmentStatus;
  if (currentFulfillmentStatus !== previousSnapshot.fulfillmentStatus) {
    changes.push(
      `Fulfillment status changed: ${previousSnapshot.fulfillmentStatus || 'null'} → ${currentFulfillmentStatus || 'null'}`
    );
  }

  // Check total price
  const currentTotal = parseFloat(currentOrder.totalPrice.toString());
  const previousTotal = parseFloat(previousSnapshot.totalPrice?.toString() || '0');
  if (Math.abs(currentTotal - previousTotal) > 0.01) {
    changes.push(
      `Total price changed: $${previousTotal.toFixed(2)} → $${currentTotal.toFixed(2)}`
    );
  }

  // Check line items count
  const currentLineItemCount = currentOrder.lineItems?.length || 0;
  const previousLineItemCount = previousSnapshot.lineItems?.length || 0;
  if (currentLineItemCount !== previousLineItemCount) {
    changes.push(
      `Line items changed: ${previousLineItemCount} → ${currentLineItemCount}`
    );
  }

  // Check refunds
  const currentRefundCount = currentOrder.refunds?.length || 0;
  const previousRefundCount = previousSnapshot.refunds?.length || 0;
  if (currentRefundCount !== previousRefundCount) {
    changes.push(
      `Refunds changed: ${previousRefundCount} → ${currentRefundCount}`
    );
  }

  // Check transactions
  const currentTxnCount = currentOrder.transactions?.length || 0;
  const previousTxnCount = previousSnapshot.transactions?.length || 0;
  if (currentTxnCount !== previousTxnCount) {
    changes.push(
      `Transactions changed: ${previousTxnCount} → ${currentTxnCount}`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
    );
  }

  // Check fulfillments
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currentFulfillmentCount = (currentOrder as any).fulfillments?.length || 0;
  const previousFulfillmentCount = previousSnapshot.fulfillments?.length || 0;
  if (currentFulfillmentCount !== previousFulfillmentCount) {
    changes.push(
      `Fulfillments changed: ${previousFulfillmentCount} → ${currentFulfillmentCount}`
    );
  }

  return changes;
}

/**
 * Check if order has changed since last export
 *
 * @param shop - Shop domain
 * @param order - Current order
 * @param exportDate - Export date (YYYY-MM-DD)
 * @returns Change detection result
 */
export async function checkOrderChanges(
  shop: string,
  order: Order,
  exportDate: string
): Promise<OrderChangeResult> {
  // Get previous snapshot for this date
  const previousSnapshot = await getOrderSnapshot(shop, order.id, exportDate);

  if (!previousSnapshot) {
    // No previous snapshot - this is the first export
    return {
      hasChanged: false,
      changes: [],
      previousSnapshot: null,
      needsReexport: false,
    };
  }

  // Compare current state vs snapshot
  const changes = compareOrderStates(order, previousSnapshot.snapshotData);

  const hasChanged = changes.length > 0;

  // Determine if re-export is needed
  // Re-export if financial status, total, refunds, or transactions changed
  const criticalChanges = changes.filter(
    (change) =>
      change.includes('Financial status') ||
      change.includes('Total price') ||
      change.includes('Refunds') ||
      change.includes('Transactions')
  );
  const needsReexport = criticalChanges.length > 0;

  return {
    hasChanged,
    changes,
    previousSnapshot,
    needsReexport,
  };
}

/**
 * Get orders that need re-export for a given date
 *
 * @param shop - Shop domain
 * @param exportDate - Export date (YYYY-MM-DD)
 * @param currentOrders - Current order data
 * @returns Array of order IDs needing re-export
 */
export async function getOrdersNeedingReexport(
  shop: string,
  exportDate: string,
  currentOrders: Order[]
): Promise<string[]> {
  const ordersNeedingReexport: string[] = [];

  for (const order of currentOrders) {
    const changeResult = await checkOrderChanges(shop, order, exportDate);

    if (changeResult.needsReexport) {
      ordersNeedingReexport.push(order.id);
    }
  }

  return ordersNeedingReexport;
}

/**
 * Delete old snapshots (cleanup)
 *
 * @param shop - Shop domain
 * @param daysToKeep - Number of days to keep (default: 90)
 * @returns Number of deleted records
 */
export async function cleanupOldSnapshots(
  shop: string,
  daysToKeep: number = 90
): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

  const result = await prisma.orderSnapshot.deleteMany({
    where: {
      shop,
      exportDate: {
        lt: cutoffDateStr,
      },
    },
  });

  return result.count;
}

/**
 * Get snapshot statistics for a shop
 *
 * @param shop - Shop domain
 * @returns Snapshot statistics
 */
export async function getSnapshotStats(shop: string): Promise<{
  totalSnapshots: number;
  uniqueOrders: number;
  dateRange: { earliest: string | null; latest: string | null };
  versionsPerOrder: number;
}> {
  const snapshots = await prisma.orderSnapshot.findMany({
    where: { shop },
    select: {
      orderId: true,
      exportDate: true,
      version: true,
    },
  });

  if (snapshots.length === 0) {
    return {
      totalSnapshots: 0,
      uniqueOrders: 0,
      dateRange: { earliest: null, latest: null },
      versionsPerOrder: 0,
    };
  }

  const uniqueOrderIds = new Set(snapshots.map((s) => s.orderId));
  const dates = snapshots.map((s) => s.exportDate).sort();

  return {
    totalSnapshots: snapshots.length,
    uniqueOrders: uniqueOrderIds.size,
    dateRange: {
      earliest: dates[0],
      latest: dates[dates.length - 1],
    },
    versionsPerOrder:
      uniqueOrderIds.size > 0
        ? parseFloat((snapshots.length / uniqueOrderIds.size).toFixed(2))
        : 0,
  };
}
