import type { LoaderFunctionArgs } from 'react-router';
import { useLoaderData } from 'react-router';
import { useState } from 'react';
import { authenticate } from '../shopify.server';
import {
  getRecentMetrics,
  getQualityTrend,
  getSummaryStats,
  type ReconciliationMetric,
  type QualityTrend,
} from '../services/reconciliation-metrics.server';
import { getSnapshotStats } from '../services/order-state-tracker.server';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Get URL parameters
  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get('days') || '30', 10);

  // Fetch metrics data
  const [recentMetrics, qualityTrend, summaryStats, snapshotStats] = await Promise.all([
    getRecentMetrics(shop, days),
    getQualityTrend(shop, days),
    getSummaryStats(shop, days),
    getSnapshotStats(shop),
  ]);

  return {
    shop,
    days,
    recentMetrics,
    qualityTrend,
    summaryStats,
    snapshotStats,
  };
};

export default function Reconciliation() {
  const { days, recentMetrics, qualityTrend, summaryStats, snapshotStats } =
    useLoaderData<typeof loader>();

  const [selectedDays, setSelectedDays] = useState(days.toString());

  // Handle time period change
  const handlePeriodChange = (newDays: string) => {
    setSelectedDays(newDays);
    window.location.href = `/app/reconciliation?days=${newDays}`;
  };

  // Calculate trend indicator
  const getTrendIndicator = (trend: 'improving' | 'declining' | 'stable') => {
    switch (trend) {
      case 'improving':
        return { icon: '📈', color: '#008060', text: 'Improving' };
      case 'declining':
        return { icon: '📉', color: '#D72C0D', text: 'Declining' };
      case 'stable':
        return { icon: '➡️', color: '#5C5F62', text: 'Stable' };
    }
  };

  const trendInfo = getTrendIndicator(summaryStats.trend);

  // Get error breakdown as array
  const errorBreakdown = recentMetrics.length > 0
    ? Object.entries(recentMetrics[recentMetrics.length - 1].errorBreakdown as Record<string, number>)
        .sort((a, b) => b[1] - a[1])
    : [];

  return (
    <s-page heading="Data Quality Dashboard">
      <s-button
        slot="primary-action"
        href="/app/exports"
        variant="primary"
      >
        Generate Export
      </s-button>

      {/* Time Period Selector */}
      <s-section >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <s-text>Time Period:</s-text>
          <select
            value={selectedDays}
            onChange={(e) => handlePeriodChange(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid #C9CCCF',
              fontSize: '14px',
            }}
          >
            <option value="7">Last 7 days</option>
            <option value="14">Last 14 days</option>
            <option value="30">Last 30 days</option>
            <option value="60">Last 60 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </div>
      </s-section>

      {/* Summary Stats Cards */}
      <s-section>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: '16px',
          marginBottom: '20px',
        }}>
          {/* Quality Score Card */}
          <div style={{
            padding: '20px',
            backgroundColor: '#F6F6F7',
            borderRadius: '12px',
            border: '1px solid #E1E3E5',
          }}>
            <s-stack direction="block" gap="base">
              <span style={{ color: '#6D7175', fontSize: '14px' }}>
                Average Quality Score
              </span>
              <span style={{ color: '#202223', fontSize: '14px' }}>
                {summaryStats.averageQualityScore.toFixed(1)}%
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' }}>
                <span style={{ fontSize: '20px' }}>{trendInfo.icon}</span>
                <span style={{ color: trendInfo.color, fontWeight: 600, fontSize: '14px' }}>
                  {trendInfo.text}
                </span>
              </div>
            </s-stack>
          </div>

          {/* Orders Processed Card */}
          <div style={{
            padding: '20px',
            backgroundColor: '#F6F6F7',
            borderRadius: '12px',
            border: '1px solid #E1E3E5',
          }}>
            <s-stack direction="block" gap="base">
              <span style={{ color: '#6D7175', fontSize: '14px' }}>
                Orders Processed
              </span>
              <span style={{ color: '#202223', fontSize: '14px' }}>
                {summaryStats.totalOrdersProcessed.toLocaleString()}
              </span>
              <span style={{ color: '#6D7175', marginTop: '8px', fontSize: '14px' }}>
                in last {days} days
              </span>
            </s-stack>
          </div>

          {/* Error Orders Card */}
          <div style={{
            padding: '20px',
            backgroundColor: '#F6F6F7',
            borderRadius: '12px',
            border: '1px solid #E1E3E5',
          }}>
            <s-stack direction="block" gap="base">
              <span style={{ color: '#6D7175', fontSize: '14px' }}>
                Orders with Errors
              </span>
              <span style={{ color: '#D72C0D', fontSize: '14px' }}>
                {summaryStats.totalErrorOrders.toLocaleString()}
              </span>
              <span style={{ color: '#6D7175', marginTop: '8px', fontSize: '14px' }}>
                {summaryStats.totalOrdersProcessed > 0
                  ? ((summaryStats.totalErrorOrders / summaryStats.totalOrdersProcessed) * 100).toFixed(1)
                  : '0.0'}% error rate
              </span>
            </s-stack>
          </div>

          {/* Most Common Error Card */}
          <div style={{
            padding: '20px',
            backgroundColor: '#F6F6F7',
            borderRadius: '12px',
            border: '1px solid #E1E3E5',
          }}>
            <s-stack direction="block" gap="base">
              <span style={{ color: '#6D7175', fontSize: '14px' }}>
                Most Common Issue
              </span>
              <span style={{ color: '#202223', fontSize: '14px' }}>
                {summaryStats.mostCommonError
                  ? summaryStats.mostCommonError.replace(/([A-Z])/g, ' $1').trim()
                  : 'None'}
              </span>
              <span style={{ color: '#6D7175', marginTop: '8px', fontSize: '14px' }}>
                {summaryStats.mostCommonError ? 'needs attention' : 'No errors detected'}
              </span>
            </s-stack>
          </div>
        </div>
      </s-section>

      {/* Quality Trend Chart */}
      <s-section>
        <s-stack direction="block" gap="base">
          <s-text>Quality Score Trend</s-text>

          {qualityTrend.length > 0 ? (
            <div style={{
              padding: '20px',
              backgroundColor: '#FFFFFF',
              borderRadius: '12px',
              border: '1px solid #E1E3E5',
            }}>
              {/* Simple text-based chart */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                maxHeight: '300px',
                overflowY: 'auto',
              }}>
                {qualityTrend.slice().reverse().map((point: QualityTrend, index: number) => {
                  const barWidth = `${point.qualityScore}%`;
                  const barColor = point.qualityScore >= 90 ? '#008060' :
                                  point.qualityScore >= 80 ? '#FFC453' :
                                  point.qualityScore >= 70 ? '#FFA500' : '#D72C0D';

                  return (
                    <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ minWidth: '80px', color: '#6D7175', fontSize: '14px' }}>
                        {point.date}
                      </span>
                      <div style={{
                        flex: 1,
                        height: '24px',
                        backgroundColor: '#F6F6F7',
                        borderRadius: '4px',
                        position: 'relative',
                        overflow: 'hidden',
                      }}>
                        <div style={{
                          width: barWidth,
                          height: '100%',
                          backgroundColor: barColor,
                          borderRadius: '4px',
                          transition: 'width 0.3s ease',
                        }} />
                      </div>
                      <span style={{ minWidth: '60px', textAlign: 'right', fontWeight: 600, fontSize: '14px' }}>
                        {point.qualityScore.toFixed(1)}%
                      </span>
                      <span style={{ minWidth: '100px', textAlign: 'right', color: '#6D7175', fontSize: '14px' }}>
                        {point.totalOrders} orders
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <s-banner tone="info">
              <s-text>No quality data available for the selected period. Generate exports to start tracking quality metrics.</s-text>
            </s-banner>
          )}
        </s-stack>
      </s-section>

      {/* Error Breakdown */}
      {errorBreakdown.length > 0 && (
        <s-section>
          <s-stack direction="block" gap="base">
            <s-text>Error Breakdown (Latest Export)</s-text>

            <div style={{
              padding: '20px',
              backgroundColor: '#FFFFFF',
              borderRadius: '12px',
              border: '1px solid #E1E3E5',
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {errorBreakdown.map(([errorType, count]) => (
                  <div key={errorType} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px',
                    backgroundColor: '#F6F6F7',
                    borderRadius: '8px',
                  }}>
                    <s-text>
                      {errorType.replace(/([A-Z])/g, ' $1').trim()}
                    </s-text>
                    <span style={{ fontWeight: 600, color: count > 0 ? '#D72C0D' : '#6D7175', fontSize: '14px' }}>
                      {count} {count === 1 ? 'order' : 'orders'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </s-stack>
        </s-section>
      )}

      {/* Order State Tracking Stats */}
      <s-section>
        <s-stack direction="block" gap="base">
          <s-text>Order State Tracking</s-text>

          <div style={{
            padding: '20px',
            backgroundColor: '#FFFFFF',
            borderRadius: '12px',
            border: '1px solid #E1E3E5',
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div>
                <span style={{ color: '#6D7175', display: 'block', marginBottom: '4px', fontSize: '14px' }}>
                  Total Snapshots
                </span>
                <span style={{ color: '#202223', fontSize: '14px' }}>
                  {snapshotStats.totalSnapshots.toLocaleString()}
                </span>
              </div>

              <div>
                <span style={{ color: '#6D7175', display: 'block', marginBottom: '4px', fontSize: '14px' }}>
                  Unique Orders
                </span>
                <span style={{ color: '#202223', fontSize: '14px' }}>
                  {snapshotStats.uniqueOrders.toLocaleString()}
                </span>
              </div>

              <div>
                <span style={{ color: '#6D7175', display: 'block', marginBottom: '4px', fontSize: '14px' }}>
                  Avg Versions per Order
                </span>
                <span style={{ color: '#202223', fontSize: '14px' }}>
                  {snapshotStats.versionsPerOrder.toFixed(2)}
                </span>
              </div>

              <div>
                <span style={{ color: '#6D7175', display: 'block', marginBottom: '4px', fontSize: '14px' }}>
                  Date Range
                </span>
                <span style={{ color: '#202223', fontSize: '14px' }}>
                  {snapshotStats.dateRange.earliest && snapshotStats.dateRange.latest
                    ? `${snapshotStats.dateRange.earliest} to ${snapshotStats.dateRange.latest}`
                    : 'No data'}
                </span>
              </div>
            </div>
          </div>
        </s-stack>
      </s-section>

      {/* Recent Metrics Table */}
      {recentMetrics.length > 0 && (
        <s-section>
          <s-stack direction="block" gap="base">
            <s-text>Recent Export History</s-text>

            <div style={{ overflowX: 'auto' }}>
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                backgroundColor: '#FFFFFF',
                borderRadius: '12px',
                overflow: 'hidden',
              }}>
                <thead>
                  <tr style={{ backgroundColor: '#F6F6F7', borderBottom: '1px solid #E1E3E5' }}>
                    <th style={{ padding: '12px', textAlign: 'left' }}>
                      <span style={{ fontWeight: 600, fontSize: '14px' }}>Date</span>
                    </th>
                    <th style={{ padding: '12px', textAlign: 'center' }}>
                      <span style={{ fontWeight: 600, fontSize: '14px' }}>Total Orders</span>
                    </th>
                    <th style={{ padding: '12px', textAlign: 'center' }}>
                      <span style={{ fontWeight: 600, fontSize: '14px' }}>Clean Orders</span>
                    </th>
                    <th style={{ padding: '12px', textAlign: 'center' }}>
                      <span style={{ fontWeight: 600, fontSize: '14px' }}>Error Orders</span>
                    </th>
                    <th style={{ padding: '12px', textAlign: 'center' }}>
                      <span style={{ fontWeight: 600, fontSize: '14px' }}>Warning Orders</span>
                    </th>
                    <th style={{ padding: '12px', textAlign: 'center' }}>
                      <span style={{ fontWeight: 600, fontSize: '14px' }}>Quality Score</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recentMetrics.slice().reverse().map((metric: ReconciliationMetric, index: number) => (
                    <tr
                      key={metric.id}
                      style={{
                        borderBottom: index < recentMetrics.length - 1 ? '1px solid #E1E3E5' : 'none',
                      }}
                    >
                      <td style={{ padding: '12px' }}>
                        <s-text>{metric.date}</s-text>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <s-text>{metric.totalOrders}</s-text>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <span style={{ color: '#008060', fontSize: '14px' }}>
                          {metric.cleanOrders}
                        </span>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <span style={{ color: metric.errorOrders > 0 ? '#D72C0D' : '#6D7175', fontSize: '14px' }}>
                          {metric.errorOrders}
                        </span>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <span style={{ color: metric.warningOrders > 0 ? '#FFA500' : '#6D7175', fontSize: '14px' }}>
                          {metric.warningOrders}
                        </span>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <span
                          style={{
                            fontWeight: 600,
                            fontSize: '14px',
                            color: metric.qualityScore >= 90 ? '#008060' :
                                   metric.qualityScore >= 80 ? '#FFC453' :
                                   metric.qualityScore >= 70 ? '#FFA500' : '#D72C0D',
                          }}
                        >
                          {metric.qualityScore.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </s-stack>
        </s-section>
      )}

      {/* Help Text */}
      <s-section>
        <s-banner tone="info">
          <s-text>
            This dashboard tracks data quality metrics over time. Quality scores are calculated as
            (clean orders / total orders) × 100. Orders with HIGH impact errors are counted as error orders,
            while MEDIUM/LOW impact issues are counted as warnings.
          </s-text>
        </s-banner>
      </s-section>
    </s-page>
  );
}
