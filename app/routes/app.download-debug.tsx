import type { LoaderFunctionArgs } from 'react-router';
import { authenticate } from '../shopify.server';
import { promises as fs } from 'fs';
import path from 'path';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const filename = url.searchParams.get('filename');

  if (!filename) {
    return new Response('Filename is required', { status: 400 });
  }

  // Validate filename to prevent path traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return new Response('Invalid filename', { status: 400 });
  }

  try {
    const debugDir = path.join(process.cwd(), 'data', shop, 'debug');
    const filePath = path.join(debugDir, filename);

    // Check if file exists
    await fs.access(filePath);

    // Read file content
    const content = await fs.readFile(filePath, 'utf-8');

    // Return JSON file as download
    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Error downloading debug file:', error);
    return new Response('File not found', { status: 404 });
  }
};
