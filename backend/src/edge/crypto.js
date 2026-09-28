/**
 * Web Crypto API encryption module
 * Replaces Node.js crypto with browser-compatible Web Crypto API
 * Compatible with AES-256-GCM format used by the existing Node.js implementation
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'aurashop-32byte-encryption-key!!!';

async function deriveKey() {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(ENCRYPTION_KEY),
    { name: 'scrypt' },
    false,
    ['deriveKey']
  );

  const key = await crypto.subtle.deriveKey(
    { name: 'scrypt', salt: enc.encode('salt'), N: 16384, r: 8, p: 1 },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  return key;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string length');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

async function encrypt(text) {
  const key = await deriveKey();
  const iv = crypto.getRandomValues(new Uint8Array(16));

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    enc.encode(text)
  );

  const encryptedBytes = new Uint8Array(encrypted);
  const content = encryptedBytes.slice(0, -16);
  const authTag = encryptedBytes.slice(-16);

  return {
    iv: bytesToHex(iv),
    content: bytesToHex(content),
    authTag: bytesToHex(authTag),
  };
}

async function decrypt(encryptedObj) {
  try {
    const key = await deriveKey();
    const iv = hexToBytes(encryptedObj.iv);
    const content = hexToBytes(encryptedObj.content);
    const authTag = hexToBytes(encryptedObj.authTag);
    const data = new Uint8Array([...content, ...authTag]);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      data
    );

    return dec.decode(decrypted);
  } catch (err) {
    throw new Error('Decryption failed');
  }
}

export { encrypt, decrypt };
