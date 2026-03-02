import fs from 'fs/promises';
import path from 'path';
import type { Cin7Config } from '../../types/cin7';
import { encrypt, decrypt } from '../../utils/encryption.server';

/**
 * Cin7 Credential Manager
 *
 * Manages secure storage and retrieval of Cin7 API credentials.
 * Credentials are encrypted at rest using AES-256-GCM.
 *
 * Storage location: data/{shop}/cin7-config.json
 */

const DATA_DIR = 'data';

/**
 * Get Cin7 configuration for a shop
 *
 * Priority:
 * 1. Shop-specific config file (if exists)
 * 2. Environment variables (global defaults)
 * 3. Default disabled config
 *
 * @param shop - Shop domain
 * @returns Decrypted Cin7 configuration
 */
export async function getCin7Config(shop: string): Promise<Cin7Config> {
  const configPath = getConfigPath(shop);

  try {
    const fileContent = await fs.readFile(configPath, 'utf-8');
    const encryptedConfig = JSON.parse(fileContent) as Cin7Config;

    // Decrypt sensitive fields from shop-specific config
    return {
      ...encryptedConfig,
      accountId: encryptedConfig.accountId ? decrypt(encryptedConfig.accountId) : '',
      apiKey: encryptedConfig.apiKey ? decrypt(encryptedConfig.apiKey) : '',
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // File doesn't exist - use environment variables or defaults
      return getConfigFromEnv();
    }
    throw new Error(
      `Failed to read Cin7 config: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get Cin7 configuration from environment variables
 *
 * @returns Configuration from environment, or default disabled config
 */
function getConfigFromEnv(): Cin7Config {
  const accountId = process.env.CIN7_API_AUTH_ACCOUNT_ID || '';
  const apiKey = process.env.CIN7_API_AUTH_APPLICATION_KEY || '';

  // If both credentials are set in environment, enable by default
  const enabled = !!(accountId && apiKey);

  return {
    enabled,
    accountId,
    apiKey,
    cacheEnabled: true,
    cacheDurationHours: 24,
    useFallback: false,
  };
}

/**
 * Save Cin7 configuration for a shop
 *
 * @param shop - Shop domain
 * @param config - Cin7 configuration (plaintext)
 */
export async function saveCin7Config(shop: string, config: Cin7Config): Promise<void> {
  const configPath = getConfigPath(shop);

  // Ensure directory exists
  const dirPath = path.dirname(configPath);
  await fs.mkdir(dirPath, { recursive: true });

  // Encrypt sensitive fields
  const encryptedConfig: Cin7Config = {
    ...config,
    accountId: config.accountId ? encrypt(config.accountId) : '',
    apiKey: config.apiKey ? encrypt(config.apiKey) : '',
  };

  // Write to file
  await fs.writeFile(configPath, JSON.stringify(encryptedConfig, null, 2), 'utf-8');
}

/**
 * Test Cin7 connection with provided credentials
 *
 * @param accountId - Cin7 account ID
 * @param apiKey - Cin7 API key
 * @returns True if connection successful, false otherwise
 */
export async function testCin7Connection(
  accountId: string,
  apiKey: string
): Promise<{ success: boolean; message: string }> {
  try {
    const testUrl = 'https://inventory.dearsystems.com/ExternalApi/v2/product?sku=TEST-NONEXISTENT';

    const response = await fetch(testUrl, {
      headers: {
        'api-auth-accountid': accountId,
        'api-auth-applicationkey': apiKey,
      },
    });

    // 404 = valid auth but product not found (expected)
    // 401/403 = invalid credentials
    // 200 = valid auth (test SKU happened to exist)
    if (response.status === 404 || response.status === 200) {
      return {
        success: true,
        message: 'Connection successful',
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        message: 'Invalid credentials - please check Account ID and API Key',
      };
    }

    return {
      success: false,
      message: `Connection failed with status ${response.status}: ${response.statusText}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Connection test failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Check if Cin7 is enabled and configured for a shop
 *
 * @param shop - Shop domain
 * @returns True if enabled and configured
 */
export async function isCin7Enabled(shop: string): Promise<boolean> {
  try {
    const config = await getCin7Config(shop);
    return config.enabled && !!config.accountId && !!config.apiKey;
  } catch (error) {
    return false;
  }
}

/**
 * Get file path for Cin7 config
 */
function getConfigPath(shop: string): string {
  return path.join(DATA_DIR, shop, 'cin7-config.json');
}

