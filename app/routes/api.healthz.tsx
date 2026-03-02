import type { Route } from './+types/api.healthz';
import prisma from '~/db.server';

export async function loader({ request }: Route.LoaderArgs) {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;

    // Check filesystem access
    const fs = await import('fs/promises');
    await fs.access('/app/data');

    return Response.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || 'unknown',
      checks: {
        database: 'connected',
        filesystem: 'accessible',
        prisma: 'ready'
      }
    });
  } catch (error) {
    return Response.json(
      {
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 503 }
    );
  }
}
