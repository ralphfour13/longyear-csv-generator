import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Form, useActionData, useLoaderData } from 'react-router';
import { useState } from 'react';
import { authenticate } from '../shopify.server';
import { listExports, getExportStats, getExportPath } from '../services/storage.server';
import { format } from 'date-fns';
import { promises as fs } from 'fs';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const exportFiles = await listExports(shop);

  const exports = await Promise.all(
    exportFiles.map(async (filename) => {
      const stats = await getExportStats(shop, filename);

      // Extract report type and date from filename
      const reportType = extractReportType(filename);
      const reportDate = extractReportDate(filename);

      return {
        ...stats,
        reportType,
        reportDate,
      };
    })
  );

  return { shop, exports };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const action = formData.get('action');

  if (action === 'delete') {
    const filename = formData.get('filename') as string;

    if (!filename) {
      return { success: false, error: 'Filename required', status: 400 };
    }

    try {
      const filePath = getExportPath(shop, filename);
      await fs.unlink(filePath);

      return {
        success: true,
        message: `File "${filename}" deleted successfully`,
      };
    } catch (error) {
      console.error('Delete error:', error);
      return {
        success: false,
        error: `Failed to delete file: ${error instanceof Error ? error.message : String(error)}`,
        status: 500,
      };
    }
  }

  return { success: false, error: 'Invalid action', status: 400 };
};

export default function ExportHistory() {
  const { shop, exports } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  const [searchTerm, setSearchTerm] = useState('');
  const [reportTypeFilter, setReportTypeFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<'filename' | 'reportType' | 'reportDate' | 'created' | 'size'>('created');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Download handler.
  // Use the app's own origin (the deployment serving this page) instead of a hardcoded
  // host, so downloads work on any deployment/store (e.g. Longyear), not just one.
  const handleDownload = (filename: string) => {
    const url = `${window.location.origin}/api/download-csv?shop=${encodeURIComponent(shop)}&filename=${encodeURIComponent(filename)}`;
    window.open(url, '_blank');
  };

  // Extract unique report types
  const reportTypes = Array.from(new Set(exports.map(exp => exp.reportType)));

  // Filter exports
  let filteredExports = exports.filter(exp => {
    // Search filter
    if (searchTerm && !exp.filename.toLowerCase().includes(searchTerm.toLowerCase())) {
      return false;
    }

    // Report type filter
    if (reportTypeFilter !== 'all' && exp.reportType !== reportTypeFilter) {
      return false;
    }

    return true;
  });

  // Sort exports
  filteredExports = [...filteredExports].sort((a, b) => {
    let comparison = 0;

    switch (sortField) {
      case 'filename':
        comparison = a.filename.localeCompare(b.filename);
        break;
      case 'reportType':
        comparison = a.reportType.localeCompare(b.reportType);
        break;
      case 'reportDate':
        comparison = (a.reportDate || '').localeCompare(b.reportDate || '');
        break;
      case 'created':
        comparison = new Date(a.created).getTime() - new Date(b.created).getTime();
        break;
      case 'size':
        comparison = a.size - b.size;
        break;
    }

    return sortDirection === 'asc' ? comparison : -comparison;
  });

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const getSortIcon = (field: typeof sortField) => {
    if (sortField !== field) return '⇅';
    return sortDirection === 'asc' ? '↑' : '↓';
  };

  return (
    <s-page heading="Export History">
      <s-button
        slot="primary-action"
        href="/app/exports"
        variant="primary"
      >
        Generate New Export
      </s-button>

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

      {/* Filters */}
      <s-section>
        <s-stack direction="block" gap="base">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', maxWidth: '800px' }}>
            <div>
              <div style={{ marginBottom: '8px' }}>
                <s-text>Search</s-text>
              </div>
              <input
                type="text"
                placeholder="Search filenames..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid var(--p-color-border)',
                  borderRadius: 'var(--p-border-radius-200)',
                  fontSize: '14px',
                }}
              />
            </div>

            <div>
              <div style={{ marginBottom: '8px' }}>
                <s-text>Report Type</s-text>
              </div>
              <select
                value={reportTypeFilter}
                onChange={(e) => setReportTypeFilter(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid var(--p-color-border)',
                  borderRadius: 'var(--p-border-radius-200)',
                  fontSize: '14px',
                }}
              >
                <option value="all">All Types</option>
                {reportTypes.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
          </div>

          <s-text tone="neutral">
            Showing {filteredExports.length} of {exports.length} exports
          </s-text>
        </s-stack>
      </s-section>

      {/* Export Table */}
      <s-section>
        {filteredExports.length === 0 ? (
          <s-paragraph>
            {exports.length === 0
              ? 'No exports yet. Generate your first export to get started.'
              : 'No exports match your filters.'
            }
          </s-paragraph>
        ) : (
          <s-box borderWidth="base" borderRadius="base">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--p-color-border)' }}>
                  <th
                    style={{ padding: '16px', textAlign: 'left', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => toggleSort('reportType')}
                  >
                    <s-text><strong>
                      Report Type {getSortIcon('reportType')}
                    </strong></s-text>
                  </th>
                  <th
                    style={{ padding: '16px', textAlign: 'left', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => toggleSort('reportDate')}
                  >
                    <s-text><strong>
                      Report Date {getSortIcon('reportDate')}
                    </strong></s-text>
                  </th>
                  <th
                    style={{ padding: '16px', textAlign: 'left', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => toggleSort('created')}
                  >
                    <s-text><strong>
                      Created {getSortIcon('created')}
                    </strong></s-text>
                  </th>
                  <th
                    style={{ padding: '16px', textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => toggleSort('size')}
                  >
                    <s-text><strong>
                      Size {getSortIcon('size')}
                    </strong></s-text>
                  </th>
                  <th style={{ padding: '16px', textAlign: 'center' }}>
                    <s-text><strong>Actions</strong></s-text>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredExports.map((exp, index) => (
                  <tr
                    key={exp.filename}
                    style={{
                      borderBottom: index < filteredExports.length - 1 ? '1px solid var(--p-color-border-subdued)' : 'none',
                    }}
                  >
                    <td style={{ padding: '16px' }}>
                      <div>
                        <s-text>{exp.reportType}</s-text>
                        <div style={{ marginTop: '4px' }}>
                          <code style={{ fontSize: '12px', color: 'var(--p-color-text-subdued)' }}>
                            {exp.filename}
                          </code>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '16px' }}>
                      <s-text>{exp.reportDate || '-'}</s-text>
                    </td>
                    <td style={{ padding: '16px' }}>
                      <s-text>{format(new Date(exp.created), 'MMM d, yyyy h:mm a')}</s-text>
                    </td>
                    <td style={{ padding: '16px', textAlign: 'right' }}>
                      <s-text>{formatFileSize(exp.size)}</s-text>
                    </td>
                    <td style={{ padding: '16px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                        <button
                          onClick={() => handleDownload(exp.filename)}
                          style={{
                            padding: '6px 12px',
                            backgroundColor: 'var(--p-color-bg-surface-secondary)',
                            color: 'var(--p-color-text)',
                            border: '1px solid var(--p-color-border)',
                            borderRadius: 'var(--p-border-radius-200)',
                            cursor: 'pointer',
                            fontSize: '13px',
                            fontWeight: 500,
                          }}
                        >
                          Download
                        </button>

                        <Form method="post" style={{ display: 'inline' }} onSubmit={(e) => {
                          if (!confirm(`Are you sure you want to delete "${exp.filename}"?`)) {
                            e.preventDefault();
                          }
                        }}>
                          <input type="hidden" name="action" value="delete" />
                          <input type="hidden" name="filename" value={exp.filename} />
                          <button
                            type="submit"
                            style={{
                              padding: '6px 12px',
                              backgroundColor: 'var(--p-color-bg-critical)',
                              color: 'white',
                              border: '1px solid var(--p-color-border-critical)',
                              borderRadius: 'var(--p-border-radius-200)',
                              cursor: 'pointer',
                              fontSize: '13px',
                              fontWeight: 500,
                            }}
                          >
                            Delete
                          </button>
                        </Form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </s-box>
        )}
      </s-section>
    </s-page>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extractReportType(filename: string): string {
  if (filename.includes('detailed-sales-report')) return 'Detailed Sales Report';
  if (filename.includes('payouts-with-orders')) return 'Payouts with Orders';
  if (filename.includes('journal-entry-details')) return 'Journal Entry Details';
  if (filename.includes('journal-entry_') || filename.startsWith('journal-entry-summary')) return 'Journal Entry Summary';
  if (filename.includes('cogs-details')) return 'COGS Details';
  if (filename.includes('daily-reconciliation')) return 'Daily Reconciliation';
  return 'Unknown';
}

function extractReportDate(filename: string): string | null {
  // Extract date from filename patterns like: filename_2026-01-31.csv
  const match = filename.match(/(\d{4}-\d{2}-\d{2})/);
  if (match) {
    try {
      return format(new Date(match[1]), 'MMM d, yyyy');
    } catch {
      return match[1];
    }
  }
  return null;
}
