/**
 * Server initialization
 *
 * This file runs once when the server starts and initializes:
 * - Scheduler for automated nightly exports
 * - Cleanup handlers for graceful shutdown
 */

import { initializeScheduler, stopAllScheduledExports } from './services/scheduler.server';
import { shopifyApi } from '@shopify/shopify-api';
import { PrismaSessionStorage } from '@shopify/shopify-app-session-storage-prisma';
import prisma from './db.server';

// Flag to ensure initialization happens only once
let initialized = false;

/**
 * Get access token for a shop from session storage
 */
async function getAccessToken(shop: string): Promise<string> {
  try {
    // Create session storage instance
    const sessionStorage = new PrismaSessionStorage(prisma);

    // Find active session for shop
    // Note: This is a simplified approach - in production, you may need
    // to handle multiple sessions or implement a more robust token retrieval
    const sessions = await sessionStorage.findSessionsByShop(shop);

    if (sessions.length === 0) {
      throw new Error(`No active session found for shop: ${shop}`);
    }

    // Get the most recent session
    const session = sessions[0];

    if (!session.accessToken) {
      throw new Error(`No access token found for shop: ${shop}`);
    }

    return session.accessToken;
  } catch (error) {
    console.error(`Failed to get access token for ${shop}:`, error);
    throw error;
  }
}

/**
 * Initialize server components
 */
export async function initializeServer(): Promise<void> {
  if (initialized) {
    console.log('Server already initialized, skipping...');
    return;
  }

  console.log('Initializing server components...');

  try {
    // Initialize scheduler
    await initializeScheduler(getAccessToken);

    // Set up graceful shutdown handlers
    setupShutdownHandlers();

    initialized = true;
    console.log('Server initialization complete');
  } catch (error) {
    console.error('Server initialization failed:', error);
    // Don't throw - allow server to start even if scheduler fails
  }
}

/**
 * Set up handlers for graceful shutdown
 */
function setupShutdownHandlers(): void {
  const shutdown = () => {
    console.log('Shutting down server...');
    stopAllScheduledExports();
    process.exit(0);
  };

  // Handle different shutdown signals
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    stopAllScheduledExports();
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
    // Don't exit on unhandled rejection, just log
  });
}

// Auto-initialize when module is imported
// This runs once when the server starts
if (typeof window === 'undefined') {
  // Only run on server side
  initializeServer().catch((error) => {
    console.error('Auto-initialization failed:', error);
  });
}
