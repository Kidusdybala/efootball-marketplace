const mongoose = require('mongoose');
const { encrypt, decrypt } = require('../utils/encryption');

const accountCredentialsSchema = new mongoose.Schema(
  {
    listingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Listing',
      required: true,
      unique: true,
      index: true,
    },
    email: {
      iv: String,
      content: String,
      authTag: String,
    },
    password: {
      iv: String,
      content: String,
      authTag: String,
    },
    backupCodes: [
      {
        iv: String,
        content: String,
        authTag: String,
      },
    ],
    twoFactorSecret: {
      iv: String,
      content: String,
      authTag: String,
    },
    additionalInfo: {
      iv: String,
      content: String,
      authTag: String,
    },
    verificationStatus: {
      type: String,
      enum: ['unverified', 'verified', 'failed'],
      default: 'unverified',
    },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    verifiedAt: Date,
    notes: String,
  },
  { timestamps: true }
);

accountCredentialsSchema.methods.setEmail = function (email) {
  this.email = encrypt(email);
};

accountCredentialsSchema.methods.getEmail = function () {
  if (!this.email || !this.email.content) return null;
  return decrypt(this.email);
};

accountCredentialsSchema.methods.setPassword = function (password) {
  this.password = encrypt(password);
};

accountCredentialsSchema.methods.getPassword = function () {
  if (!this.password || !this.password.content) return null;
  return decrypt(this.password);
};

accountCredentialsSchema.methods.setBackupCodes = function (codes = []) {
  this.backupCodes = codes.map((code) => encrypt(code));
};

accountCredentialsSchema.methods.getBackupCodes = function () {
  return (this.backupCodes || []).map((code) => decrypt(code));
};

accountCredentialsSchema.methods.setTwoFactorSecret = function (secret) {
  if (secret) this.twoFactorSecret = encrypt(secret);
};

accountCredentialsSchema.methods.getTwoFactorSecret = function () {
  if (!this.twoFactorSecret || !this.twoFactorSecret.content) return null;
  return decrypt(this.twoFactorSecret);
};

accountCredentialsSchema.methods.setAdditionalInfo = function (info) {
  if (info) this.additionalInfo = encrypt(info);
};

accountCredentialsSchema.methods.getAdditionalInfo = function () {
  if (!this.additionalInfo || !this.additionalInfo.content) return null;
  return decrypt(this.additionalInfo);
};

accountCredentialsSchema.methods.getAllDecrypted = function () {
  return {
    email: this.getEmail(),
    password: this.getPassword(),
    backupCodes: this.getBackupCodes(),
    twoFactorSecret: this.getTwoFactorSecret(),
    additionalInfo: this.getAdditionalInfo(),
  };
};

module.exports = mongoose.model('AccountCredentials', accountCredentialsSchema);
