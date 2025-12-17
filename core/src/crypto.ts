/**
 * Optional Client-Side Encryption
 * AES-256-GCM encryption for note content
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Derive encryption key from password
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LENGTH);
}

/**
 * Encrypt content using AES-256-GCM
 * @param plaintext - Content to encrypt
 * @param password - Encryption password
 * @returns Base64-encoded encrypted data (salt:iv:tag:ciphertext)
 */
export function encrypt(plaintext: string, password: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(password, salt);
  const iv = randomBytes(IV_LENGTH);
  
  const cipher = createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  
  const tag = cipher.getAuthTag();
  
  // Format: base64(salt):base64(iv):base64(tag):base64(ciphertext)
  return [
    salt.toString('base64'),
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted,
  ].join(':');
}

/**
 * Decrypt content encrypted with AES-256-GCM
 * @param encrypted - Encrypted data from encrypt()
 * @param password - Decryption password
 * @returns Decrypted plaintext
 * @throws Error if decryption fails (wrong password or corrupted data)
 */
export function decrypt(encrypted: string, password: string): string {
  const parts = encrypted.split(':');
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted data format');
  }
  
  const [saltB64, ivB64, tagB64, ciphertext] = parts;
  
  const salt = Buffer.from(saltB64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const key = deriveKey(password, salt);
  
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  
  let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Check if content appears to be encrypted
 * (Simple heuristic based on format)
 */
export function isEncrypted(content: string): boolean {
  const parts = content.split(':');
  if (parts.length !== 4) return false;
  
  // Check if parts look like base64
  const base64Regex = /^[A-Za-z0-9+/]+=*$/;
  return parts.every(part => base64Regex.test(part));
}

/**
 * Encrypt a note's content while preserving metadata
 * Only encrypts the content, not the frontmatter
 */
export function encryptNoteContent(content: string, password: string): string {
  return encrypt(content, password);
}

/**
 * Decrypt a note's content
 */
export function decryptNoteContent(encryptedContent: string, password: string): string {
  return decrypt(encryptedContent, password);
}

/**
 * Validate that a password can decrypt the content
 */
export function validatePassword(encrypted: string, password: string): boolean {
  try {
    decrypt(encrypted, password);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a random encryption key (for key files)
 */
export function generateRandomKey(): string {
  return randomBytes(32).toString('base64');
}
