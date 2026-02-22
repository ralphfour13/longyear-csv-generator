import type { LoaderFunctionArgs } from 'react-router';
import { authenticate } from '../shopify.server';
import { readExport, exportExists } from '../services/storage.server';

/**
 * API endpoint for downloading CSV files
 *
 * GET /app/api/download-csv?shop=example.myshopify.com&filename=journal-entries-2024-01-15.csv
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    // Get filename from query params
    const url = new URL(request.url);
    const filename = url.searchParams.get('filename');

    if (!filename) {
      return new Response('Missing filename parameter', { status: 400 });
    }

    // Validate filename (only allow CSV files, no path traversal)
    if (!filename.endsWith('.csv') || filename.includes('..') || filename.includes('/')) {
      return new Response('Invalid filename', { status: 400 });
    }

    // Check if file exists
    const exists = await exportExists(shop, filename);
    if (!exists) {
      return new Response('File not found', { status: 404 });
    }

    // Read file content
    const content = await readExport(shop, filename);

    // Return CSV file
    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Download CSV error:', error);

    return new Response('Failed to download file', { status: 500 });
  }
};
