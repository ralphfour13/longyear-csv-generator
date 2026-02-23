import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { authenticate } from '../shopify.server';
import { processExport } from '../services/batch-processor.server';

/**
 * API endpoint for manual CSV export
 *
 * POST or GET /api/manual-export?startDate=2024-01-15&endDate=2024-01-15
 */

// Handle both GET and POST
async function handleExport(request: Request) {
  try {
    const { session, admin } = await authenticate.admin(request);
    const shop = session.shop;

    // Get access token
    const accessToken = session.accessToken;

    // Get date parameters from URL
    const url = new URL(request.url);
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');

    if (!startDate || !endDate) {
      return Response.json(
        { error: 'Missing required parameters: startDate and endDate' },
        { status: 400 }
      );
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return Response.json(
        { error: 'Invalid date format. Use YYYY-MM-DD' },
        { status: 400 }
      );
    }

    console.log(`Manual export requested for ${shop} from ${startDate} to ${endDate}`);

    // Process export
    const result = await processExport(shop, accessToken, startDate, endDate);

    return Response.json({
      success: true,
      filename: result.filename,
      entryCount: result.entryCount,
      totalDebit: result.totalDebit.toFixed(2),
      totalCredit: result.totalCredit.toFixed(2),
      balanced: result.balanced,
      downloadUrl: result.downloadUrl,
    });
  } catch (error) {
    console.error('Manual export error:', error);

    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Export failed',
      },
      { status: 500 }
    );
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return handleExport(request);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  return handleExport(request);
};
