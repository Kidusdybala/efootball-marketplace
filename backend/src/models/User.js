const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    telegramId: { type: String, unique: true, sparse: true, index: true },
    username: { type: String, trim: true, index: true },
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    password: { type: String },
    role: {
      type: String,
      enum: ['buyer', 'seller', 'admin'],
      default: 'buyer',
      required: true,
    },
    avatar: String,
    rating: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    completedSales: { type: Number, default: 0 },
    completedBuys: { type: Number, default: 0 },
    isVerified: { type: Boolean, default: false },
    verificationDocs: [String],
    status: {
      type: String,
      enum: ['active', 'banned', 'suspended', 'pending'],
      default: 'active',
    },
    banReason: String,
    telegramChatId: String,
    lastActive: { type: Date, default: Date.now },
    preferences: {
      notifyTelegram: { type: Boolean, default: true },
      notifyEmail: { type: Boolean, default: false },
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

userSchema.virtual('averageRating').get(function () {
  return this.ratingCount > 0 ? (this.rating / this.ratingCount).toFixed(1) : 0;
});

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = async function (candidate) {
  if (!this.password) return false;
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.addRating = async function (score, role) {
  this.rating += score;
  this.ratingCount += 1;
  if (role === 'seller') this.completedSales += 1;
  if (role === 'buyer') this.completedBuys += 1;
  await this.save();
};

userSchema.index({ role: 1, status: 1 });

module.exports = mongoose.model('User', userSchema);
