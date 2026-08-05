require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Listing = require('../models/Listing');
const AccountCredentials = require('../models/AccountCredentials');
const Transaction = require('../models/Transaction');
const Report = require('../models/Report');

const ADMIN_TELEGRAM_IDS = (process.env.ADMIN_TELEGRAM_IDS || '').split(',').filter(Boolean);

connectDB();

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('DB connected for seeding');
    await seed();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

async function seed() {
  console.log('Clearing existing data...');
  await Promise.all([
    User.deleteMany({}),
    Listing.deleteMany({}),
    AccountCredentials.deleteMany({}),
    Transaction.deleteMany({}),
    Report.deleteMany({}),
  ]);

  console.log('Creating admin...');
  const admin = await User.create({
    username: 'kidusdybala',
    firstName: 'Kidus',
    lastName: 'Admin',
    email: 'admin@aurashop.com',
    password: 'admin123',
    role: 'admin',
    isVerified: true,
    telegramId: ADMIN_TELEGRAM_IDS[0] || '100000000',
    status: 'active',
    rating: 50,
    ratingCount: 10,
    completedSales: 50,
    completedBuys: 5,
  });

  console.log('Creating test sellers...');
  const sellers = await Promise.all([
    User.create({
      username: 'top_seller',
      firstName: 'Alex',
      lastName: 'Pro',
      email: 'seller1@test.com',
      password: 'pass123',
      role: 'seller',
      isVerified: true,
      status: 'active',
      rating: 245,
      ratingCount: 50,
      completedSales: 245,
      telegramId: '100000001',
    }),
    User.create({
      username: 'efootball_king',
      firstName: 'Chris',
      lastName: 'Gamer',
      email: 'seller2@test.com',
      password: 'pass123',
      role: 'seller',
      isVerified: false,
      status: 'active',
      rating: 45,
      ratingCount: 10,
      completedSales: 45,
      telegramId: '100000002',
    }),
    User.create({
      username: 'mr_messi',
      firstName: 'Lionel',
      lastName: 'Scaloni',
      email: 'seller3@test.com',
      password: 'pass123',
      role: 'seller',
      isVerified: true,
      status: 'active',
      rating: 120,
      ratingCount: 25,
      completedSales: 120,
      telegramId: '100000003',
    }),
  ]);

  console.log('Creating test buyers...');
  const buyers = await Promise.all([
    User.create({
      username: 'casual_buyer',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'buyer1@test.com',
      password: 'pass123',
      role: 'buyer',
      status: 'active',
      rating: 20,
      ratingCount: 5,
      completedBuys: 20,
      telegramId: '200000001',
    }),
    User.create({
      username: 'whale_collector',
      firstName: 'John',
      lastName: 'Collector',
      email: 'buyer2@test.com',
      password: 'pass123',
      role: 'buyer',
      status: 'active',
      rating: 30,
      ratingCount: 8,
      completedBuys: 30,
      telegramId: '200000002',
    }),
  ]);

  console.log('Creating listings...');
  const titles = [
    { t: '2850 OVR | Endgame Full Epic + BT Team | Messi BT, Ronaldo BT', p: 350, plat: 'Android', ov: 2850, team: 'Real Madrid', players: ['Messi BT', 'Ronaldo BT', 'Neymar Epic', 'Zidane BT'] },
    { t: '2900 OVR | GOD Squad | Mbappe BT, Haaland Epic, Vini Jr', p: 500, plat: 'iOS', ov: 2900, team: 'Brazil', players: ['Mbappe BT', 'Haaland', 'Vinicius Jr', 'Rodrygo'] },
    { t: '2700 OVR | All Time Greats | Maradona, Pele, Cruyff', p: 220, plat: 'Steam', ov: 2700, team: 'Argentina', players: ['Maradona', 'Pele', 'Cruyff'] },
    { t: '2600 OVR | Starter Beast Team | 500K coins | Cheap!', p: 75, plat: 'PlayStation', ov: 2600, team: 'PSG', players: ['Mbappe', 'Neymar', 'Di Maria'] },
    { t: '2800 OVR | Full Icon Team | 20+ BT & Epic Cards', p: 280, plat: 'Xbox', ov: 2800, team: 'Man Utd', players: ['Rooney BT', 'Scholes Epic', 'Giggs BT', 'Cantona'] },
    { t: '2950 OVR | #1 Global Rank Account | ALL TOP CARDS', p: 1500, plat: 'PC', ov: 2950, team: 'Global XI', players: ['Messi BT 104', 'Ronaldo BT 104', 'Mbappe BT 103', 'Haaland 103'] },
    { t: '2750 OVR | Untradeable God Squad | 1M+ GP', p: 180, plat: 'Android', ov: 2750, team: 'Barcelona', players: ['Messi', 'Ronaldinho', 'Iniesta BT'] },
    { t: '2650 OVR | La Liga Special | Full Real Madrid Squad', p: 120, plat: 'iOS', ov: 2650, team: 'Real Madrid', players: ['Bellingham', 'Vinicius', 'Rodrygo', 'Modric'] },
    { t: '2820 OVR | Bundesliga Giants | Dortmund + Bayern', p: 320, plat: 'Steam', ov: 2820, team: 'Dortmund', players: ['Reus BT', 'Haaland BT', 'Musiala Epic'] },
    { t: '2500 OVR | Perfect Starter | Great Value!', p: 45, plat: 'Android', ov: 2500, team: 'Liverpool', players: ['Salah', 'Mane', 'Van Dijk'] },
  ];

  const listings = [];
  for (let i = 0; i < titles.length; i++) {
    const l = titles[i];
    const seller = sellers[i % sellers.length];
    const status = i < 8 ? 'available' : (i === 8 ? 'pending_review' : 'reserved');
    const listing = await Listing.create({
      sellerId: seller._id,
      title: l.t,
      slug: l.t.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 100) + '-' + Date.now() + i,
      price: l.p,
      platform: l.plat,
      overall: l.ov,
      teamName: l.team,
      featuredPlayers: l.players,
      description: `🔥 PREMIUM EFOOTBALL ACCOUNT 🔥\n\n✅ ${l.t}\n\n🏟️ Team: ${l.team}\n⚡ Overall: ${l.ov}\n⭐ Featured Players:\n• ${l.players.join('\n• ')}\n\n💯 Everything is UNLOCKED!\n💎 100% SAFE & VERIFIED BY ADMIN\n🔑 Full account credentials provided\n🛡️ Escrow protection by AuraShop\n📞 24/7 Support via Telegram bot\n\n🔄 Instant delivery after payment!\n⚖️ Negotiable price - make an offer!`,
      status,
      views: Math.floor(Math.random() * 200),
      favoriteCount: Math.floor(Math.random() * 30),
      negotiable: true,
      approvedAt: status !== 'pending_review' ? new Date() : undefined,
      approvedBy: status !== 'pending_review' ? admin._id : undefined,
      reservedBy: status === 'reserved' ? buyers[0]._id : undefined,
      reservedAt: status === 'reserved' ? new Date() : undefined,
      tags: l.players.slice(0, 3),
    });
    listings.push(listing);

    const creds = new AccountCredentials({ listingId: listing._id });
    creds.setEmail(`account_${i}@efootball.com`);
    creds.setPassword(`SecurePass!2024${i}`);
    creds.setBackupCodes([`AA${i}BB${i}CC`, `DD${i}EE${i}FF`, `GG${i}HH${i}II`]);
    creds.setAdditionalInfo(`Account #${i} - Platform: ${l.plat} - Linked phone: +1-555-000${String(i).padStart(2, '0')}`);
    creds.verificationStatus = 'verified';
    creds.verifiedBy = admin._id;
    creds.verifiedAt = new Date();
    await creds.save();
  }

  console.log('Creating sample transactions...');
  await Transaction.create({
    listingId: listings[0]._id,
    buyerId: buyers[0]._id,
    sellerId: sellers[0]._id,
    agreedPrice: 340,
    status: 'completed',
    paidAt: new Date(Date.now() - 86400000 * 5),
    releasedAt: new Date(Date.now() - 86400000 * 3),
    buyerRating: 5,
    sellerRating: 5,
    statusHistory: [
      { status: 'pending', timestamp: new Date(Date.now() - 86400000 * 7) },
      { status: 'waiting_payment', timestamp: new Date(Date.now() - 86400000 * 6) },
      { status: 'paid', timestamp: new Date(Date.now() - 86400000 * 5) },
      { status: 'credentials_submitted', timestamp: new Date(Date.now() - 86400000 * 4) },
      { status: 'verified', timestamp: new Date(Date.now() - 86400000 * 4) },
      { status: 'credentials_sent', timestamp: new Date(Date.now() - 86400000 * 3.5) },
      { status: 'buyer_confirmed', timestamp: new Date(Date.now() - 86400000 * 3) },
      { status: 'completed', timestamp: new Date(Date.now() - 86400000 * 3) },
    ],
  });

  await Transaction.create({
    listingId: listings[1]._id,
    buyerId: buyers[1]._id,
    sellerId: sellers[1]._id,
    agreedPrice: 480,
    status: 'paid',
    paidAt: new Date(Date.now() - 3600000 * 24),
  });

  await Transaction.create({
    listingId: listings[3]._id,
    buyerId: buyers[0]._id,
    sellerId: sellers[0]._id,
    agreedPrice: 75,
    status: 'waiting_payment',
  });

  console.log('Creating sample reports...');
  await Report.create({
    reporterId: buyers[0]._id,
    targetType: 'user',
    targetUserId: sellers[1]._id,
    reason: 'scam',
    description: 'Seller tried to get me to pay outside escrow. Very suspicious behavior. Please investigate.',
    priority: 'high',
    status: 'open',
  });

  console.log('✅ Seed complete!');
  console.log('\n📋 Test Accounts:');
  console.log(`  Admin:    admin@aurashop.com / admin123    (role: admin)`);
  console.log(`  Seller:   seller1@test.com / pass123       (role: seller, verified)`);
  console.log(`  Buyer:    buyer1@test.com  / pass123       (role: buyer)`);
  console.log(`\n🏪 Created: ${listings.length} listings, 3 transactions, 1 report`);

  process.exit(0);
}
