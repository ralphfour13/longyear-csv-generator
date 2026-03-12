import prisma from '../db.server';

// Get version info from environment or version file
async function getVersionInfo() {
  const commit = process.env.APP_VERSION || 'dev';
  let buildTime = 'unknown';

  try {
    const fs = await import('fs/promises');
    const versionData = await fs.readFile('/app/version.json', 'utf-8');
    const parsed = JSON.parse(versionData);
    buildTime = parsed.buildTime || 'unknown';
  } catch {
    // Version file not found, using defaults
  }

  return { commit: commit.substring(0, 7), buildTime };
}

export async function loader() {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;

    // Check filesystem access
    const fs = await import('fs/promises');
    await fs.access('/app/data');

    // Get version info
    const version = await getVersionInfo();

    // Log version on health check (useful for confirming deployments)
    console.log(`[Health Check] Version: ${version.commit} | Built: ${version.buildTime}`);

    return Response.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: version.commit,
      buildTime: version.buildTime,
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
