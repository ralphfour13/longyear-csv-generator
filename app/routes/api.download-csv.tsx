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
    // Get parameters from query string
    const url = new URL(request.url);
    const shop = url.searchParams.get('shop');
    const filename = url.searchParams.get('filename');

    if (!shop || !filename) {
      return new Response('Missing shop or filename parameter', { status: 400 });
    }

    // Validate filename (only allow CSV files, no path traversal)
    if (!filename.endsWith('.csv') || filename.includes('..') || filename.includes('/')) {
      return new Response('Invalid filename', { status: 400 });
    }

    // Check if file exists
    const exists = await exportExists(shop, filename);
    if (!exists) {
      console.error(`File not found: ${shop} / ${filename}`);
      return new Response(`File not found: ${filename}`, { status: 404 });
    }

    // Read file content
    const content = await readExport(shop, filename);

    console.log(`Downloaded ${filename} for ${shop} (${content.length} bytes)`);

    // Return CSV file
    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('Download CSV error:', error);

    return new Response(
      `Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { status: 500 }
    );
  }
};
