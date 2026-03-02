import type { LoaderFunctionArgs } from 'react-router';
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

    // Validate filename (only allow CSV and TXT files, no path traversal)
    const validExtensions = ['.csv', '.txt'];
    const hasValidExtension = validExtensions.some(ext => filename.endsWith(ext));

    if (!hasValidExtension || filename.includes('..') || filename.includes('/')) {
      return new Response('Invalid filename', { status: 400 });
    }

    console.log(`Attempting to download: shop=${shop}, filename=${filename}`);

    // Check if file exists
    const exists = await exportExists(shop, filename);
    console.log(`File exists check: ${exists}`);

    if (!exists) {
      console.error(`File not found: ${shop} / ${filename}`);

      // Log available files for debugging
      const { listExports } = await import('../services/storage.server');
      const availableFiles = await listExports(shop);
      console.error(`Available files for ${shop}:`, availableFiles);

      return new Response(`File not found: ${filename}. Available files: ${availableFiles.join(', ')}`, { status: 404 });
    }

    // Read file content
    console.log(`Reading file content...`);
    const content = await readExport(shop, filename);
    console.log(`File content length: ${content.length} bytes`);

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
