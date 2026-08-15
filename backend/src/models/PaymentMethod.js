const mongoose = require('mongoose');

const paymentMethodSchema = new mongoose.Schema({
  name: { type: String, required: true },
  callback_data: { type: String, required: true, unique: true },
  icon_custom_emoji_id: { type: String, required: false, default: null },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('PaymentMethod', paymentMethodSchema);
