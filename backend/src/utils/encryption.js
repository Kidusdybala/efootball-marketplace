const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'aurashop-32byte-encryption-key!!!';
const KEY = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    content: encrypted.toString('hex'),
    authTag: authTag.toString('hex'),
  };
}

function decrypt(encryptedObj) {
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, Buffer.from(encryptedObj.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(encryptedObj.authTag, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedObj.content, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch (err) {
    throw new Error('Decryption failed');
  }
}

module.exports = { encrypt, decrypt };
