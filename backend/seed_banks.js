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
      {
        name: 'CBE (Commercial Bank of Ethiopia)',
        callback_data: 'pay_cbe',
        account: '1000648228736',
        holder: 'MURAD GENA',
        isActive: true,
        icon_custom_emoji_id: '5961054379350955385'
      },
      {
        name: 'BOA (Bank of Abyssinia)',
        callback_data: 'pay_boa',
        account: '',
        holder: 'GENA AMAN',
        isActive: true,
        icon_custom_emoji_id: '5960632377339285724'
      },
      {
        name: 'Awash Bank',
        callback_data: 'pay_awash',
        account: '013100169502500',
        holder: 'GENA AMAN',
        isActive: true,
        icon_custom_emoji_id: null
      },
      {
        name: 'TeleBirr',
        callback_data: 'pay_telebirr',
        account: '0909844959',
        holder: 'MURAD GENA',
        isActive: true,
        icon_custom_emoji_id: '6100340203119971469'
      },
      {
        name: 'Mpesa',
        callback_data: 'pay_mpesa',
        account: '0707844959',
        holder: 'MURAD GENA',
        isActive: true,
        icon_custom_emoji_id: '5963162821746233777'
      },
      {
        name: 'Dashen Bank',
        callback_data: 'pay_dashen',
        account: '',
        holder: 'GENA AMAN',
        isActive: true,
        icon_custom_emoji_id: null
      },
      {
        name: 'eBirr',
        callback_data: 'pay_ebirr',
        account: '0909844959',
        holder: 'MURAD GENA',
        isActive: true,
        icon_custom_emoji_id: '6102684181521763740'
      },
      {
        name: 'CbeBirr',
        callback_data: 'pay_cbebirr',
        account: '0909844959',
        holder: 'MURAD GENA',
        isActive: true,
        icon_custom_emoji_id: null
      },
    ];

    await PaymentMethod.insertMany(banks);
    console.log('✅ Successfully seeded payment methods!');
    banks.forEach(b => console.log(`  - ${b.name} → ${b.callback_data} | ${b.account || 'no account'} | ${b.holder}`));

  } catch (error) {
    console.error('Error seeding data:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
};

seedBanks();
