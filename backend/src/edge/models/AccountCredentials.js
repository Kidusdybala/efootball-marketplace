import { createModel } from './base.js';
import { encrypt, decrypt } from '../crypto.js';

const AccountCredentials = createModel('accountCredentials', {
  populates: {
    listingId: { collection: 'listings', select: 'title price status' },
    verifiedBy: { collection: 'users', select: 'username' },
  },

  methods: {
    async setEmail(email) {
      this.email = await encrypt(email);
    },
    async getEmail() {
      if (!this.email || !this.email.content) return null;
      return await decrypt(this.email);
    },
    async setPassword(password) {
      this.password = await encrypt(password);
    },
    async getPassword() {
      if (!this.password || !this.password.content) return null;
      return await decrypt(this.password);
    },
    async setBackupCodes(codes = []) {
      this.backupCodes = await Promise.all(codes.map(encrypt));
    },
    async getBackupCodes() {
      if (!this.backupCodes || !this.backupCodes.length) return [];
      return await Promise.all(this.backupCodes.map(decrypt));
    },
    async setTwoFactorSecret(secret) {
      if (secret) this.twoFactorSecret = await encrypt(secret);
    },
    async getTwoFactorSecret() {
      if (!this.twoFactorSecret || !this.twoFactorSecret.content) return null;
      return await decrypt(this.twoFactorSecret);
    },
    async setAdditionalInfo(info) {
      if (info) this.additionalInfo = await encrypt(info);
    },
    async getAdditionalInfo() {
      if (!this.additionalInfo || !this.additionalInfo.content) return null;
      return await decrypt(this.additionalInfo);
    },
    async getAllDecrypted() {
      return {
        email: await this.getEmail(),
        password: await this.getPassword(),
        backupCodes: await this.getBackupCodes(),
        twoFactorSecret: await this.getTwoFactorSecret(),
        additionalInfo: await this.getAdditionalInfo(),
      };
    },
  },
});

export default AccountCredentials;
