import crypto from 'crypto';

/**
 * Encryption Utility
 *
 * Provides AES-256-GCM encryption/decryption for sensitive data.
 * Requires CIN7_ENCRYPTION_KEY environment variable (32 characters).
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const SALT_LENGTH = 64; // 512 bits
const TAG_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits

/**
 * Get encryption key from environment
 */
function getEncryptionKey(): Buffer {
  const keyString = process.env.CIN7_ENCRYPTION_KEY;

  if (!keyString) {
    throw new Error(
      'CIN7_ENCRYPTION_KEY environment variable is not set. ' +
      'Generate one with: openssl rand -hex 32'
    );
  }

  if (keyString.length !== 64) {
    throw new Error(
      'CIN7_ENCRYPTION_KEY must be 64 characters (32 bytes in hex). ' +
      'Generate one with: openssl rand -hex 32'
    );
  }

  return Buffer.from(keyString, 'hex');
}

/**
 * Encrypt a string using AES-256-GCM
 *
 * @param plaintext - Text to encrypt
 * @returns Encrypted string in format: salt:iv:ciphertext:tag (all hex-encoded)
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) {
    return '';
  }

  const key = getEncryptionKey();

  // Generate random IV and salt
  const iv = crypto.randomBytes(IV_LENGTH);
  const salt = crypto.randomBytes(SALT_LENGTH);

  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  // Encrypt
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  // Get auth tag
  const tag = cipher.getAuthTag();

  // Return format: salt:iv:ciphertext:tag
  return [
    salt.toString('hex'),
    iv.toString('hex'),
    encrypted,
    tag.toString('hex'),
  ].join(':');
}

/**
 * Decrypt a string encrypted with encrypt()
 *
 * @param ciphertext - Encrypted string in format: salt:iv:ciphertext:tag
 * @returns Decrypted plaintext string
 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext) {
    return '';
  }

  const key = getEncryptionKey();

  // Parse format: salt:iv:ciphertext:tag
  const parts = ciphertext.split(':');
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted format');
  }

  const [saltHex, ivHex, encryptedHex, tagHex] = parts;

  // Convert from hex
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');

  // Create decipher
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  // Decrypt
  let decrypted = decipher.update(encrypted, undefined, 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Test if encryption is configured correctly
 */
export function testEncryption(): boolean {
  try {
    const testString = 'test-encryption-12345';
    const encrypted = encrypt(testString);
    const decrypted = decrypt(encrypted);
    return decrypted === testString;
  } catch (error) {
    console.error('Encryption test failed:', error);
    return false;
  }
}
