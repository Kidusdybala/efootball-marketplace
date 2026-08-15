require('dotenv').config();
const mongoose = require('mongoose');
const PaymentMethod = require('./src/models/PaymentMethod');

const banks = [
  { name: 'Apply Store Credit', callback_data: 'pay_credit', emoji_id: '6100453551601881338' }, // green check or credit card placeholder? Let's not touch credit.
  { name: 'Pay With Chapa', callback_data: 'pay_chapa', emoji_id: '6104818848987358154' }, // just a placeholder arrow? 
  { name: 'Telebirr', callback_data: 'pay_telebirr', emoji_id: '5960632377339285724' },
  { name: 'M-Pesa', callback_data: 'pay_mpesa', emoji_id: '5963162821746233777' },
  { name: 'Abyssinia Bank', callback_data: 'pay_abyssinia', emoji_id: '5960764365979259236' },
  { name: 'Awash Bank', callback_data: 'pay_awash', emoji_id: '5960773097647771692' },
  { name: 'E-BIRR', callback_data: 'pay_ebirr', emoji_id: '5960523624472385611' },
  { name: 'Commercial Bank of Ethiopia', callback_data: 'pay_cbe', emoji_id: '5961050926197248588' }
];

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to DB');
  
  for (const b of banks) {
    const existing = await PaymentMethod.findOne({ callback_data: b.callback_data });
    if (existing) {
      existing.icon_custom_emoji_id = b.emoji_id;
      existing.name = b.name;
      await existing.save();
      console.log(`Updated ${b.name}`);
    } else {
      await PaymentMethod.create({
        name: b.name,
        callback_data: b.callback_data,
        icon_custom_emoji_id: b.emoji_id,
        isActive: true
      });
      console.log(`Created ${b.name}`);
    }
  }
  process.exit(0);
}
run();
