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

  return Response.json({
    shop,
    days,
    recentMetrics,
    qualityTrend,
    summaryStats,
    snapshotStats,
  });
};

export default function Reconciliation() {
  const { shop, days, recentMetrics, qualityTrend, summaryStats, snapshotStats } =
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
      <s-section style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <s-text variant="bodyMd">Time Period:</s-text>
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
            <s-stack direction="block" gap="tight">
              <s-text variant="bodyMd" style={{ color: '#6D7175' }}>
                Average Quality Score
              </s-text>
              <s-text variant="heading2xl" style={{ color: '#202223' }}>
                {summaryStats.averageQualityScore.toFixed(1)}%
              </s-text>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' }}>
                <span style={{ fontSize: '20px' }}>{trendInfo.icon}</span>
                <s-text variant="bodySm" style={{ color: trendInfo.color, fontWeight: 600 }}>
                  {trendInfo.text}
                </s-text>
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
            <s-stack direction="block" gap="tight">
              <s-text variant="bodyMd" style={{ color: '#6D7175' }}>
                Orders Processed
              </s-text>
              <s-text variant="heading2xl" style={{ color: '#202223' }}>
                {summaryStats.totalOrdersProcessed.toLocaleString()}
              </s-text>
              <s-text variant="bodySm" style={{ color: '#6D7175', marginTop: '8px' }}>
                in last {days} days
              </s-text>
            </s-stack>
          </div>

          {/* Error Orders Card */}
          <div style={{
            padding: '20px',
            backgroundColor: '#F6F6F7',
            borderRadius: '12px',
            border: '1px solid #E1E3E5',
          }}>
            <s-stack direction="block" gap="tight">
              <s-text variant="bodyMd" style={{ color: '#6D7175' }}>
                Orders with Errors
              </s-text>
              <s-text variant="heading2xl" style={{ color: '#D72C0D' }}>
                {summaryStats.totalErrorOrders.toLocaleString()}
              </s-text>
              <s-text variant="bodySm" style={{ color: '#6D7175', marginTop: '8px' }}>
                {summaryStats.totalOrdersProcessed > 0
                  ? ((summaryStats.totalErrorOrders / summaryStats.totalOrdersProcessed) * 100).toFixed(1)
                  : '0.0'}% error rate
              </s-text>
            </s-stack>
          </div>

          {/* Most Common Error Card */}
          <div style={{
            padding: '20px',
            backgroundColor: '#F6F6F7',
            borderRadius: '12px',
            border: '1px solid #E1E3E5',
          }}>
            <s-stack direction="block" gap="tight">
              <s-text variant="bodyMd" style={{ color: '#6D7175' }}>
                Most Common Issue
              </s-text>
              <s-text variant="headingLg" style={{ color: '#202223' }}>
                {summaryStats.mostCommonError
                  ? summaryStats.mostCommonError.replace(/([A-Z])/g, ' $1').trim()
                  : 'None'}
              </s-text>
              <s-text variant="bodySm" style={{ color: '#6D7175', marginTop: '8px' }}>
                {summaryStats.mostCommonError ? 'needs attention' : 'No errors detected'}
              </s-text>
            </s-stack>
          </div>
        </div>
      </s-section>

      {/* Quality Trend Chart */}
      <s-section>
        <s-stack direction="block" gap="base">
          <s-text variant="headingLg">Quality Score Trend</s-text>

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
                {qualityTrend.slice().reverse().map((point, index) => {
                  const barWidth = `${point.qualityScore}%`;
                  const barColor = point.qualityScore >= 90 ? '#008060' :
                                  point.qualityScore >= 80 ? '#FFC453' :
                                  point.qualityScore >= 70 ? '#FFA500' : '#D72C0D';

                  return (
                    <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <s-text variant="bodySm" style={{ minWidth: '80px', color: '#6D7175' }}>
                        {point.date}
                      </s-text>
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
                      <s-text variant="bodySm" style={{ minWidth: '60px', textAlign: 'right', fontWeight: 600 }}>
                        {point.qualityScore.toFixed(1)}%
                      </s-text>
                      <s-text variant="bodySm" style={{ minWidth: '100px', textAlign: 'right', color: '#6D7175' }}>
                        {point.totalOrders} orders
                      </s-text>
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
            <s-text variant="headingLg">Error Breakdown (Latest Export)</s-text>

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
                    <s-text variant="bodyMd">
                      {errorType.replace(/([A-Z])/g, ' $1').trim()}
                    </s-text>
                    <s-text variant="bodyMd" style={{ fontWeight: 600, color: count > 0 ? '#D72C0D' : '#6D7175' }}>
                      {count} {count === 1 ? 'order' : 'orders'}
                    </s-text>
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
          <s-text variant="headingLg">Order State Tracking</s-text>

          <div style={{
            padding: '20px',
            backgroundColor: '#FFFFFF',
            borderRadius: '12px',
            border: '1px solid #E1E3E5',
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div>
                <s-text variant="bodySm" style={{ color: '#6D7175', display: 'block', marginBottom: '4px' }}>
                  Total Snapshots
                </s-text>
                <s-text variant="headingMd" style={{ color: '#202223' }}>
                  {snapshotStats.totalSnapshots.toLocaleString()}
                </s-text>
              </div>

              <div>
                <s-text variant="bodySm" style={{ color: '#6D7175', display: 'block', marginBottom: '4px' }}>
                  Unique Orders
                </s-text>
                <s-text variant="headingMd" style={{ color: '#202223' }}>
                  {snapshotStats.uniqueOrders.toLocaleString()}
                </s-text>
              </div>

              <div>
                <s-text variant="bodySm" style={{ color: '#6D7175', display: 'block', marginBottom: '4px' }}>
                  Avg Versions per Order
                </s-text>
                <s-text variant="headingMd" style={{ color: '#202223' }}>
                  {snapshotStats.versionsPerOrder.toFixed(2)}
                </s-text>
              </div>

              <div>
                <s-text variant="bodySm" style={{ color: '#6D7175', display: 'block', marginBottom: '4px' }}>
                  Date Range
                </s-text>
                <s-text variant="headingMd" style={{ color: '#202223' }}>
                  {snapshotStats.dateRange.earliest && snapshotStats.dateRange.latest
                    ? `${snapshotStats.dateRange.earliest} to ${snapshotStats.dateRange.latest}`
                    : 'No data'}
                </s-text>
              </div>
            </div>
          </div>
        </s-stack>
      </s-section>

      {/* Recent Metrics Table */}
      {recentMetrics.length > 0 && (
        <s-section>
          <s-stack direction="block" gap="base">
            <s-text variant="headingLg">Recent Export History</s-text>

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
                      <s-text variant="bodyMd" style={{ fontWeight: 600 }}>Date</s-text>
                    </th>
                    <th style={{ padding: '12px', textAlign: 'center' }}>
                      <s-text variant="bodyMd" style={{ fontWeight: 600 }}>Total Orders</s-text>
                    </th>
                    <th style={{ padding: '12px', textAlign: 'center' }}>
                      <s-text variant="bodyMd" style={{ fontWeight: 600 }}>Clean Orders</s-text>
                    </th>
                    <th style={{ padding: '12px', textAlign: 'center' }}>
                      <s-text variant="bodyMd" style={{ fontWeight: 600 }}>Error Orders</s-text>
                    </th>
                    <th style={{ padding: '12px', textAlign: 'center' }}>
                      <s-text variant="bodyMd" style={{ fontWeight: 600 }}>Warning Orders</s-text>
                    </th>
                    <th style={{ padding: '12px', textAlign: 'center' }}>
                      <s-text variant="bodyMd" style={{ fontWeight: 600 }}>Quality Score</s-text>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recentMetrics.slice().reverse().map((metric, index) => (
                    <tr
                      key={metric.id}
                      style={{
                        borderBottom: index < recentMetrics.length - 1 ? '1px solid #E1E3E5' : 'none',
                      }}
                    >
                      <td style={{ padding: '12px' }}>
                        <s-text variant="bodyMd">{metric.date}</s-text>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <s-text variant="bodyMd">{metric.totalOrders}</s-text>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <s-text variant="bodyMd" style={{ color: '#008060' }}>
                          {metric.cleanOrders}
                        </s-text>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <s-text variant="bodyMd" style={{ color: metric.errorOrders > 0 ? '#D72C0D' : '#6D7175' }}>
                          {metric.errorOrders}
                        </s-text>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <s-text variant="bodyMd" style={{ color: metric.warningOrders > 0 ? '#FFA500' : '#6D7175' }}>
                          {metric.warningOrders}
                        </s-text>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <s-text
                          variant="bodyMd"
                          style={{
                            fontWeight: 600,
                            color: metric.qualityScore >= 90 ? '#008060' :
                                   metric.qualityScore >= 80 ? '#FFC453' :
                                   metric.qualityScore >= 70 ? '#FFA500' : '#D72C0D',
                          }}
                        >
                          {metric.qualityScore.toFixed(1)}%
                        </s-text>
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
