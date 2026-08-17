import type { LoaderFunctionArgs } from 'react-router';
import AdmZip from 'adm-zip';
import { getJobStatus } from '../services/background-jobs.server';
import { exportExists, readExport } from '../services/storage-adapter.server';

/**
 * API endpoint for downloading all job result files as a zip
 *
 * GET /app/api/download-job-zip?shop=example.myshopify.com&jobId=export_1234567890_abc123
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    // Get parameters from query string
    const url = new URL(request.url);
    const shop = url.searchParams.get('shop');
    const jobId = url.searchParams.get('jobId');

    if (!shop || !jobId) {
      return new Response('Missing shop or jobId parameter', { status: 400 });
    }

    console.log(`Attempting to download job results: shop=${shop}, jobId=${jobId}`);

    // Get job details
    const job = await getJobStatus(jobId);
    if (!job) {
      return new Response(`Job not found: ${jobId}`, { status: 404 });
    }

    // Verify job belongs to the shop
    if (job.shop !== shop) {
      return new Response('Unauthorized', { status: 403 });
    }

    // Check if job has results
    if (!job.result?.files || job.result.files.length === 0) {
      return new Response('No files available for this job', { status: 404 });
    }

    // Create zip file
    const zip = new AdmZip();
    let filesAdded = 0;

    // The zip should contain ONLY the two order-level reports.
    const ZIP_FILE_TYPES = new Set(['payouts-orders', 'products-orders', 'receipts']);

    for (const file of job.result.files) {
      const filename = file.filename;

      // Only bundle the allowed report types into the zip.
      if (!ZIP_FILE_TYPES.has(file.type)) {
        console.log(`Excluding from zip (type=${file.type}): ${filename}`);
        continue;
      }

      // Validate filename
      const validExtensions = ['.csv', '.txt', '.json'];
      const hasValidExtension = validExtensions.some(ext => filename.endsWith(ext));

      if (!hasValidExtension || filename.includes('..') || filename.includes('/')) {
        console.warn(`Skipping invalid filename: ${filename}`);
        continue;
      }

      // Check if file exists
      const exists = await exportExists(shop, filename);
      if (!exists) {
        console.warn(`File not found: ${filename}`);
        continue;
      }

      // Read file content and add to zip
      const content = await readExport(shop, filename);
      zip.addFile(filename, Buffer.from(content, 'utf-8'));
      filesAdded++;
      console.log(`Added to zip: ${filename} (${content.length} bytes)`);
    }

    if (filesAdded === 0) {
      return new Response('No valid files found for this job', { status: 404 });
    }

    // Generate zip buffer
    const zipBuffer = zip.toBuffer();
    console.log(`Created zip file with ${filesAdded} files (${zipBuffer.length} bytes)`);

    // Create a descriptive filename: export-[date-range]-[jobId-last-5].zip
    const dateRange = job.endDate
      ? `${job.startDate}-to-${job.endDate}`
      : job.startDate;
    const jobIdShort = jobId.split('_').slice(-1)[0];
    const zipFilename = `export-${dateRange}-${jobIdShort}.zip`;

    // Return zip file
    return new Response(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipFilename}"`,
        'Content-Length': zipBuffer.length.toString(),
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('Download job zip error:', error);

    return new Response(
      `Failed to create zip file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { status: 500 }
    );
  }
};
