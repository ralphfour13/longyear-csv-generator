/**
 * Reconciliation Metrics Service
 *
 * Stores and retrieves quality metrics over time for trend analysis and monitoring.
 * Enables historical tracking of data quality improvements.
 */

import prisma from '../db.server';
import type { ConsistencyCheckResult } from './consistency-checker.server';

/**
 * Reconciliation Metric (stored in database)
 */
export interface ReconciliationMetric {
  id: string;
  shop: string;
  date: string; // YYYY-MM-DD
  totalOrders: number;
  cleanOrders: number;
  errorOrders: number;
  warningOrders: number;
  qualityScore: number;
  errorBreakdown: Record<string, number>;
  createdAt: Date;
}

/**
 * Quality Trend Data (for charting)
 */
export interface QualityTrend {
  date: string;
  qualityScore: number;
  totalOrders: number;
  errorOrders: number;
}

/**
 * Save reconciliation metrics to database
 *
 * @param shop - Shop domain
 * @param date - Export date (YYYY-MM-DD)
 * @param consistencyReport - Consistency check result
 * @returns Saved metric
 */
export async function saveReconciliationMetric(
  shop: string,
  date: string,
  consistencyReport: ConsistencyCheckResult
): Promise<ReconciliationMetric> {
  const qualityScore =
    consistencyReport.totalOrders > 0
      ? (consistencyReport.cleanOrders / consistencyReport.totalOrders) * 100
      : 0;

  const errorBreakdown = {
    imbalanced: consistencyReport.imbalancedEntries.length,
    cogsMismatch: consistencyReport.cogsMismatches.length,
  };

  // Upsert (update if exists, create if not)
  const metric = await prisma.reconciliationMetric.upsert({
    where: {
      shop_date: {
        shop,
        date,
      },
    },
    update: {
      totalOrders: consistencyReport.totalOrders,
      cleanOrders: consistencyReport.cleanOrders,
      errorOrders: consistencyReport.errorOrders,
      warningOrders: consistencyReport.warningOrders,
      qualityScore,
      errorBreakdown,
    },
    create: {
      shop,
      date,
      totalOrders: consistencyReport.totalOrders,
      cleanOrders: consistencyReport.cleanOrders,
      errorOrders: consistencyReport.errorOrders,
      warningOrders: consistencyReport.warningOrders,
      qualityScore,
      errorBreakdown,
    },
  });

  return metric as ReconciliationMetric;
}

/**
 * Get metrics for a specific date
 *
 * @param shop - Shop domain
 * @param date - Date to retrieve (YYYY-MM-DD)
 * @returns Metric or null if not found
 */
export async function getMetricByDate(
  shop: string,
  date: string
): Promise<ReconciliationMetric | null> {
  const metric = await prisma.reconciliationMetric.findUnique({
    where: {
      shop_date: {
        shop,
        date,
      },
    },
  });

  return metric as ReconciliationMetric | null;
}

/**
 * Get metrics for a date range
 *
 * @param shop - Shop domain
 * @param startDate - Start date (YYYY-MM-DD)
 * @param endDate - End date (YYYY-MM-DD)
 * @returns Array of metrics
 */
export async function getMetricsByDateRange(
  shop: string,
  startDate: string,
  endDate: string
): Promise<ReconciliationMetric[]> {
  const metrics = await prisma.reconciliationMetric.findMany({
    where: {
      shop,
      date: {
        gte: startDate,
        lte: endDate,
      },
    },
    orderBy: {
      date: 'asc',
    },
  });

  return metrics as ReconciliationMetric[];
}

/**
 * Get recent metrics (last N days)
 *
 * @param shop - Shop domain
 * @param days - Number of days to retrieve (default: 30)
 * @returns Array of metrics
 */
export async function getRecentMetrics(
  shop: string,
  days: number = 30
): Promise<ReconciliationMetric[]> {
  const metrics = await prisma.reconciliationMetric.findMany({
    where: {
      shop,
    },
    orderBy: {
      date: 'desc',
    },
    take: days,
  });

  return metrics.reverse() as ReconciliationMetric[];
}

/**
 * Get quality trend data for charting
 *
 * @param shop - Shop domain
 * @param days - Number of days to retrieve (default: 30)
 * @returns Array of trend data points
 */
export async function getQualityTrend(
  shop: string,
  days: number = 30
): Promise<QualityTrend[]> {
  const metrics = await getRecentMetrics(shop, days);

  return metrics.map((m) => ({
    date: m.date,
    qualityScore: m.qualityScore,
    totalOrders: m.totalOrders,
    errorOrders: m.errorOrders,
  }));
}

/**
 * Get average quality score for a period
 *
 * @param shop - Shop domain
 * @param days - Number of days to calculate (default: 30)
 * @returns Average quality score
 */
export async function getAverageQualityScore(
  shop: string,
  days: number = 30
): Promise<number> {
  const metrics = await getRecentMetrics(shop, days);

  if (metrics.length === 0) {
    return 0;
  }

  const totalScore = metrics.reduce((sum, m) => sum + m.qualityScore, 0);
  return totalScore / metrics.length;
}

/**
 * Get summary statistics
 *
 * @param shop - Shop domain
 * @param days - Number of days to analyze (default: 30)
 * @returns Summary statistics
 */
export async function getSummaryStats(
  shop: string,
  days: number = 30
): Promise<{
  averageQualityScore: number;
  totalOrdersProcessed: number;
  totalErrorOrders: number;
  mostCommonError: string | null;
  trend: 'improving' | 'declining' | 'stable';
}> {
  const metrics = await getRecentMetrics(shop, days);

  if (metrics.length === 0) {
    return {
      averageQualityScore: 0,
      totalOrdersProcessed: 0,
      totalErrorOrders: 0,
      mostCommonError: null,
      trend: 'stable',
    };
  }

  // Calculate averages
  const averageQualityScore =
    metrics.reduce((sum, m) => sum + m.qualityScore, 0) / metrics.length;

  const totalOrdersProcessed = metrics.reduce((sum, m) => sum + m.totalOrders, 0);
  const totalErrorOrders = metrics.reduce((sum, m) => sum + m.errorOrders, 0);

  // Find most common error type
  const errorCounts: Record<string, number> = {};
  for (const metric of metrics) {
    const breakdown = metric.errorBreakdown as Record<string, number>;
    for (const [errorType, count] of Object.entries(breakdown)) {
      errorCounts[errorType] = (errorCounts[errorType] || 0) + count;
    }
  }

  const mostCommonError =
    Object.keys(errorCounts).length > 0
      ? Object.entries(errorCounts).sort((a, b) => b[1] - a[1])[0][0]
      : null;

  // Calculate trend (compare first half vs second half)
  const midpoint = Math.floor(metrics.length / 2);
  const firstHalfAvg =
    metrics
      .slice(0, midpoint)
      .reduce((sum, m) => sum + m.qualityScore, 0) / midpoint;
  const secondHalfAvg =
    metrics
      .slice(midpoint)
      .reduce((sum, m) => sum + m.qualityScore, 0) / (metrics.length - midpoint);

  const difference = secondHalfAvg - firstHalfAvg;
  const trend =
    Math.abs(difference) < 2 // Less than 2% change = stable
      ? 'stable'
      : difference > 0
      ? 'improving'
      : 'declining';

  return {
    averageQualityScore,
    totalOrdersProcessed,
    totalErrorOrders,
    mostCommonError,
    trend,
  };
}

/**
 * Delete old metrics (cleanup)
 *
 * @param shop - Shop domain
 * @param daysToKeep - Number of days to keep (default: 90)
 * @returns Number of deleted records
 */
export async function cleanupOldMetrics(
  shop: string,
  daysToKeep: number = 90
): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

  const result = await prisma.reconciliationMetric.deleteMany({
    where: {
      shop,
      date: {
        lt: cutoffDateStr,
      },
    },
  });

  return result.count;
}
