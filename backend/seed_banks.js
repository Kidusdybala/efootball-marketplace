require('dotenv').config();
const mongoose = require('mongoose');
const PaymentMethod = require('./src/models/PaymentMethod');

const MONGO_URI = process.env.MONGO_URI;

const seedBanks = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    // Clear existing payment methods first to avoid duplicates
    await PaymentMethod.deleteMany({});
    console.log('Cleared existing payment methods.');

    const banks = [
      { name: ' Apply Store Credit (0.00 ETB)', callback_data: 'pay_store_credit', isActive: true, icon_custom_emoji_id: '5368324170671202286' },
      { name: 'Pay With Chapa', callback_data: 'pay_chapa', isActive: true, icon_custom_emoji_id: '5368324170671202294' },
      { name: 'Commercial Bank of Ethiopia', callback_data: 'pay_cbe', isActive: true, icon_custom_emoji_id: '5961054379350955385' },
      { name: 'Telebirr', callback_data: 'pay_telebirr', isActive: true, icon_custom_emoji_id: '6100340203119971469' },
      { name: 'E-BIRR', callback_data: 'pay_ebirr', isActive: true, icon_custom_emoji_id: '6102684181521763740' },
      { name: 'M-Pesa', callback_data: 'pay_mpesa', isActive: true, icon_custom_emoji_id: '5963162821746233777' },
      { name: 'Abyssinia Bank', callback_data: 'pay_abyssinia', isActive: true, icon_custom_emoji_id: '5960632377339285724' }
    ];

    await PaymentMethod.insertMany(banks);
    console.log('Successfully seeded payment methods!');
    
    console.log('\n--- NOTE ---');
    console.log('Payment methods seeded with custom emoji icons for inline keyboard buttons.');
    console.log('icon_custom_emoji_id requires the bot owner to have Telegram Premium (or Fragment username).');
    console.log('------------------\n');

  } catch (error) {
    console.error('Error seeding data:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
};

seedBanks();
