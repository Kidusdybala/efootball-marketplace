const TelegramBot = require('node-telegram-bot-api');
const User = require('../models/User');
const Listing = require('../models/Listing');
const AccountCredentials = require('../models/AccountCredentials');
const { formatMoney } = require('../utils/money');

let bot = null;
const userSessions = new Map();

const parseCsv = (v) => (v || '').split(',').map(s => s.trim()).filter(Boolean);
const uniq = (arr) => Array.from(new Set((arr || []).map(String).filter(Boolean)));
const getAdminIds = () => uniq([...parseCsv(process.env.ADMIN_TELEGRAM_IDS), process.env.ADMIN_CHAT_ID]);
const isAdminTelegramId = (id) => getAdminIds().includes(String(id));
const getAdminChatIds = () => getAdminIds();

const LEGACY_SERVICE_FEE_RATE = 0.1;

const calculateAdminFee = (sellerPrice) => {
  if (sellerPrice <= 2000) return 100;
  if (sellerPrice <= 10000) return 200;
  return 300;
};

const getOrCreateUser = async (tgUser, chatId) => {
  const admin = isAdminTelegramId(tgUser.id);
  
  const updateFields = async (user) => {
    if (tgUser.first_name) user.firstName = tgUser.first_name;
    if (tgUser.last_name) user.lastName = tgUser.last_name;
    if (tgUser.username) user.username = tgUser.username;
    user.telegramChatId = String(chatId);
    if (admin) { user.role = 'admin'; user.isVerified = true; }
    await user.save();
    return user;
  };

  try {
    let user = await User.findOne({ telegramId: String(tgUser.id) });
    if (!user) {
      user = await User.create({
        telegramId: String(tgUser.id),
        username: tgUser.username || `tg_${tgUser.id}`,
        firstName: tgUser.first_name,
        lastName: tgUser.last_name,
        telegramChatId: String(chatId),
        role: admin ? 'admin' : 'buyer',
        isVerified: admin,
        preferences: { notifyTelegram: true, notifyEmail: false },
      });
      return user;
    }
    return await updateFields(user);
  } catch (error) {
    if (error.code === 11000) {
      // Race condition: another concurrent request just created this user
      let user = await User.findOne({ telegramId: String(tgUser.id) });
      if (user) return await updateFields(user);
    }
    throw error;
  }
};

const setSession = (chatId, state, data = {}) =>
  userSessions.set(String(chatId), { state, data, timestamp: Date.now() });
const getSession = (chatId) => {
  const s = userSessions.get(String(chatId));
  if (!s) return null;
  if (Date.now() - s.timestamp > 2 * 3600 * 1000) { userSessions.delete(String(chatId)); return null; }
  return s;
};
const clearSession = (chatId) => userSessions.delete(String(chatId));

const { statusEmoji, escrowStatusBadge, formatListingCard, formatChannelListingCard } = require('./formatters');

const PLATFORMS = ['Android', 'iOS', 'Steam', 'PlayStation', 'Xbox', 'PC', 'Cross-Platform'];

const shortId = (id) => String(id).slice(-8);




const mainMenuKeyboard = (user) => {
  const rows = [
    [{ text: 'Browse Listings', callback_data: 'browse' }, { text: 'Search', callback_data: 'search' }],
    [{ text: 'My Listings', callback_data: 'my_listings' }, { text: 'Sell Account', callback_data: 'sell' }],
    [{ text: 'Help / Commands', callback_data: 'help' }],
  ];
  if (isAdminTelegramId(user?.telegramId)) {
    rows.push([{ text: 'Admin Panel', callback_data: 'admin_panel' }]);
  }
  return { inline_keyboard: rows };
};

const showMainMenu = (chatId, user) => {
  bot.sendMessage(chatId, '<tg-emoji emoji-id="5368324170671202286">✨</tg-emoji> <b>AuraShop Main Menu</b>\n\nChoose an option below or use a command:\n/menu /sell /browse /search /paid /admins /deliver', {
    parse_mode: 'HTML', reply_markup: mainMenuKeyboard(user),
  });
};

const platformKeyboard = () => ({
  inline_keyboard: PLATFORMS.map((p, i) =>
    i % 2 === 0 ? [
      { text: p, callback_data: `pf_${p}` },
      ...(PLATFORMS[i + 1] ? [{ text: PLATFORMS[i + 1], callback_data: `pf_${PLATFORMS[i + 1]}` }] : []),
    ] : null,
  ).filter(Boolean),
});

const negotiableKeyboard = () => ({
  inline_keyboard: [
    [{ text: 'Negotiable', callback_data: 'neg_yes' }, { text: 'Fixed Price', callback_data: 'neg_no' }],
  ],
});

const approveRejectKeyboard = (listingId) => ({
  inline_keyboard: [
    [
      { text: 'APPROVE & POST', callback_data: `approve_${listingId}` },
      { text: 'REJECT', callback_data: `reject_${listingId}` },
    ],
  ],
});

const escrowAdminKeyboard = (listing) => {
  const lid = listing._id;
  const rows = [];
  if (listing.paidAt && !listing.paymentVerifiedAt) {
    rows.push([{ text: 'VERIFY PAYMENT ✅', callback_data: `verify_payment_${lid}` }]);
  }
  if (listing.paidAt && listing.paymentVerifiedAt && listing.credentialsSubmittedAt && !listing.releasedAt) {
    rows.push([{ text: 'RELEASE TO BUYER & WIPE CREDS', callback_data: `release_${lid}` }]);
  }
  if (listing.releasedAt && !listing.sellerPaidAt) {
    rows.push([{ text: 'MARK SELLER PAID <tg-emoji emoji-id="5961054379350955385">🏦</tg-emoji>', callback_data: `mark_seller_paid_${lid}` }]);
  }
  if (!listing.releasedAt) {
    rows.push([{ text: 'Cancel Escrow', callback_data: `cancel_escrow_${lid}` }]);
  }
  if (!rows.length) rows.push([{ text: 'Waiting for updates...', callback_data: 'noop' }]);
  return { inline_keyboard: rows };
};

// ===================== CREATE LISTING FLOW =====================
// Simplified: Just price and image
const startCreateListingFlow = (chatId) => {
  setSession(chatId, 'create_price', {});
  bot.sendMessage(chatId, 'Create New Listing\n\nStep 1/4: Enter the price in ETB (number only):', {
    parse_mode: 'HTML',
  });
};

const handleCreateListingState = async (chatId, user, text) => {
  const session = getSession(chatId);
  if (!session) return false;
  const d = session.data;

  switch (session.state) {
    case 'create_price': {
      const price = Number(text);
      if (!Number.isFinite(price) || price < 0) { bot.sendMessage(chatId, 'ERROR: Invalid price. Enter a number (e.g. 150).'); return true; }
      d.price = price;
      setSession(chatId, 'create_creds_email', d);
      bot.sendMessage(chatId, 'Step 2/4: Send the account EMAIL (encrypted & admin-only):', { parse_mode: 'HTML' });
      return true;
    }

    case 'create_creds_email': {
      if (!text.includes('@')) { bot.sendMessage(chatId, 'ERROR: Invalid email. Try again:'); return true; }
      d.email = text.trim();
      setSession(chatId, 'create_creds_password', d);
      bot.sendMessage(chatId, 'Step 3/4: Send the account PASSWORD (encrypted & admin-only):', { parse_mode: 'HTML' });
      return true;
    }

    case 'create_creds_password': {
      if (text.length < 3) { bot.sendMessage(chatId, 'ERROR: Password too short. Try again:'); return true; }
      d.password = text;
      setSession(chatId, 'create_image', d);
      bot.sendMessage(chatId, 'Step 4/4: Now send a photo/screenshot of your team account:', { parse_mode: 'HTML' });
      return true;
    }

    case 'search_query':
      clearSession(chatId);
      await browseAndShow(chatId, { search: text });
      return true;
  }
  return false;
};

const finalizeCreateListingSimple = async (chatId, user, price, imageFileId, creds) => {
  const seller = user;
  const adminFee = calculateAdminFee(price);
  const totalPrice = price + adminFee;

  const listing = await Listing.create({
    sellerId: seller._id,
    title: 'EFootball Account',
    price: totalPrice,
    sellerPrice: price,
    adminFee: adminFee,
    platform: 'Cross-Platform',
    description: 'EFootball account listed via Telegram bot.',
    status: 'pending_review',
    images: imageFileId ? [imageFileId] : [],
    credentialsSubmittedAt: new Date(),
    credentialsWiped: false,
  });

  let accountCreds = await AccountCredentials.findOne({ listingId: listing._id });
  if (!accountCreds) accountCreds = await AccountCredentials.create({ listingId: listing._id });
  if (creds?.email) accountCreds.setEmail(creds.email);
  if (creds?.password) accountCreds.setPassword(creds.password);
  if (creds?.additionalInfo) accountCreds.setAdditionalInfo(creds.additionalInfo);
  await accountCreds.save();

  bot.sendMessage(chatId,
    `Listing Submitted!\n\n` +
    `Price: ${formatMoney(price)}\n` +
    `Your listing has been sent to admin for review.\n` +
    `Listing ID: <code>${shortId(listing._id)}</code>`,
    { parse_mode: 'HTML' },
  );

  const adminChatIds = getAdminChatIds();
  let caption = `NEW LISTING PENDING REVIEW\n\nFrom: @${seller.username}\nBuyer Pays: ${formatMoney(totalPrice)}\nSeller Gets: ${formatMoney(price)}\nCredentials: INCLUDED (encrypted)\nListing ID: ${shortId(listing._id)}`;
  for (const adminChatId of adminChatIds) {
    if (!adminChatId) continue;
    if (imageFileId) {
      try {
        await bot.sendPhoto(adminChatId, imageFileId, { caption: caption, parse_mode: 'HTML', reply_markup: approveRejectKeyboard(listing._id) });
      } catch (e) {
        bot.sendMessage(adminChatId, caption, { parse_mode: 'HTML', reply_markup: approveRejectKeyboard(listing._id) });
      }
    } else {
      bot.sendMessage(adminChatId, caption, { parse_mode: 'HTML', reply_markup: approveRejectKeyboard(listing._id) });
    }
  }
};

// ===================== CHANNEL PUBLISH =====================
const publishListingToChannel = async (listing, seller) => {
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  if (!channelId) return null;

  const botUsername = process.env.TELEGRAM_BOT_USERNAME;
  const buyUrl = botUsername ? `https://t.me/${botUsername}?start=buy_${listing._id}` : null;
  const contactAdminUrl = botUsername ? `https://t.me/${botUsername}?start=contact_${listing._id}` : null;

  const row = [
    ...(buyUrl ? [{ text: 'BUY', url: buyUrl }] : []),
  ];

  const reply_markup = { inline_keyboard: [row] };
  const card = formatChannelListingCard(listing);

  try {
    const imageFileId = listing.images?.[0];
    const sent = imageFileId
      ? await bot.sendPhoto(channelId, imageFileId, { caption: card, parse_mode: 'HTML', reply_markup })
      : await bot.sendMessage(channelId, card, { parse_mode: 'HTML', reply_markup });
    listing.channelMessageId = String(sent.message_id);
    listing.status = 'available';
    listing.approvedAt = new Date();
    await listing.save();
    return sent;
  } catch (err) {
    console.error('Failed to post to channel:', err.message);
    listing.status = 'available';
    listing.approvedAt = new Date();
    await listing.save();
    return null;
  }
};

const restoreChannelListingButtons = async (listing) => {
  if (!listing.channelMessageId) return;
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  if (!channelId) return;
  const botUsername = process.env.TELEGRAM_BOT_USERNAME;
  const buyUrl = botUsername ? `https://t.me/${botUsername}?start=buy_${listing._id}` : null;
  const contactAdminUrl = botUsername ? `https://t.me/${botUsername}?start=contact_${listing._id}` : null;
  const row = [
    ...(buyUrl ? [{ text: 'BUY', url: buyUrl }] : []),
    ...(contactAdminUrl ? [{ text: 'CONTACT ADMIN', url: contactAdminUrl }] : []),
  ];
  if (!row.length) return;
  try {
    await bot.editMessageReplyMarkup(
      { inline_keyboard: [row] },
      { chat_id: channelId, message_id: Number(listing.channelMessageId) },
    );
  } catch (e) { /* ignore */ }
};

const updateChannelListingStatus = async (listing, text) => {
  if (!listing.channelMessageId) return;
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  if (!channelId) return;
  try {
    await bot.editMessageReplyMarkup(
      { inline_keyboard: [[{ text: text || '🔴 NO LONGER AVAILABLE', callback_data: 'noop' }]] },
      { chat_id: channelId, message_id: Number(listing.channelMessageId) },
    );
  } catch (e) { /* ignore */ }
};

// ===================== BROWSE / SEARCH =====================
const browseAndShow = async (chatId, filters = {}, offset = 0) => {
  const listings = await Listing.searchListings(filters).sort({ createdAt: -1 }).skip(offset).limit(5);
  if (!listings.length) {
    bot.sendMessage(chatId, '😕 No listings found. Try different filters.');
    return;
  }
  for (const listing of listings) {
    const kbRows = [];
    const botUsername = process.env.TELEGRAM_BOT_USERNAME;
    const buyUrl = botUsername ? `https://t.me/${botUsername}?start=buy_${listing._id}` : null;
    const contactAdminUrl = botUsername ? `https://t.me/${botUsername}?start=contact_${listing._id}` : null;
    const row = [
      ...(buyUrl ? [{ text: 'BUY', url: buyUrl }] : []),
      ...(contactAdminUrl ? [{ text: 'CONTACT ADMIN', url: contactAdminUrl }] : []),
    ];
    if (row.length) kbRows.push(row);
    kbRows.push([{ text: '📌 Listing ID: ' + shortId(listing._id), callback_data: 'noop' }]);

    bot.sendMessage(chatId, formatListingCard(listing, null), {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: kbRows },
    });
  }
  if (listings.length >= 5) {
    bot.sendMessage(chatId, '<tg-emoji emoji-id="6100340203119971469">🔥</tg-emoji> Use <code>/browse</code> to see more or <code>/search &lt;keyword&gt;</code>', { parse_mode: 'HTML' });
  }
};

const showMyListings = async (chatId, user) => {
  const mine = await Listing.find({ sellerId: user._id }).sort({ createdAt: -1 }).limit(20);
  if (!mine.length) return bot.sendMessage(chatId, '📦 You have no listings yet. Use /sell to create one!');
  for (const l of mine) {
    const adminKb = [];
    if (['pending_review','approved','available','waiting_escrow','paid_submitted','creds_submitted'].includes(l.status)) {
      adminKb.push([{ text: '🗑️ Delete Listing', callback_data: `delete_listing_${l._id}` }]);
    }
    bot.sendMessage(chatId,
      `<b>${statusEmoji(l.status)}</b>\n<tg-emoji emoji-id="6102684181521763740">💠</tg-emoji> ${l.title}\n<tg-emoji emoji-id="5961054379350955385">🏦</tg-emoji> ${formatMoney(l.price, l.currency)} | <tg-emoji emoji-id="6102684181521763740">💠</tg-emoji> ${l.platform}\n\n` +
      `ID: <code>${shortId(l._id)}</code>\n${escrowStatusBadge(l)}`,
      { parse_mode: 'HTML', reply_markup: adminKb.length ? { inline_keyboard: adminKb } : undefined },
    );
  }
};

// ===================== ESCROW: /paid and /deliver =====================
const findListingByShortOrFullId = async (idArg) => {
  if (!idArg) return null;
  const s = idArg.trim();
  const mongoose = require('mongoose');
  if (mongoose.Types.ObjectId.isValid(s)) {
    const found = await Listing.findById(s).populate('sellerId escrowBuyerId');
    if (found) return found;
  }
  const all = await Listing.find({}).populate('sellerId escrowBuyerId');
  return all.find(l => String(l._id).slice(-s.length) === s) || null;
};

const notifyAdminEscrowUpdate = async (listing, actionNote) => {
  const adminChatIds = getAdminChatIds();
  if (!adminChatIds.length) return;
  const [seller, buyer] = await Promise.all([
    listing.sellerId ? User.findById(listing.sellerId) : null,
    listing.escrowBuyerId ? User.findById(listing.escrowBuyerId) : null,
  ]);

  const bothIn = Boolean(listing.paidAt && listing.credentialsSubmittedAt);

  const text =
    `🔔 <b>ESCROW UPDATE</b>\n\n` +
    `<tg-emoji emoji-id="6102684181521763740">💠</tg-emoji> ${listing.title}\n` +
    `<tg-emoji emoji-id="5961054379350955385">🏦</tg-emoji> Agreed Price: <b>${formatMoney(listing.price, listing.currency)}</b>\n` +
    `Listing ID: <code>${shortId(listing._id)}</code>\n\n` +
    `👤 Seller: @${seller?.username || 'N/A'} (ID: <code>${seller?.telegramId || '?'}</code>)\n` +
    `🛒 Buyer: @${buyer?.username || 'N/A'} (ID: <code>${buyer?.telegramId || '?'}</code>)\n\n` +
    `${escrowStatusBadge(listing)}\n\n` +
    `<i>${actionNote || ''}</i>\n\n` +
    (bothIn ? `<b>⚠️ BOTH RECEIVED — verify payment then release.</b>` : '⏳ Waiting for the other side...');

  if (listing.paidReceiptFileId) {
    for (const adminChatId of adminChatIds) {
      try {
        const opts = { caption: `<tg-emoji emoji-id="5960632377339285724">🏦</tg-emoji> PAYMENT RECEIPT for Listing #${shortId(listing._id)}`, parse_mode: 'HTML' };
        if (listing.paidReceiptType === 'photo') await bot.sendPhoto(adminChatId, listing.paidReceiptFileId, opts);
        else if (listing.paidReceiptType === 'document') await bot.sendDocument(adminChatId, listing.paidReceiptFileId, opts);
      } catch (e) { /* ignore */ }
    }
  }
  if (bothIn && listing.credentialsSubmittedAt) {
    for (const adminChatId of adminChatIds) {
      try {
        const creds = await AccountCredentials.findOne({ listingId: listing._id });
        if (creds && !listing.credentialsWiped) {
          const dec = creds.getAllDecrypted();
          const credsText =
            `<tg-emoji emoji-id="5963162821746233777">🏦</tg-emoji> ACCOUNT CREDENTIALS (Preview for Admin)\n\n` +
            `📧 Email: <code>${dec.email || 'N/A'}</code>\n` +
            `🔑 Password: <tg-spoiler>${dec.password || 'N/A'}</tg-spoiler>\n` +
            (dec.additionalInfo ? `📋 Extra: <tg-spoiler>${dec.additionalInfo}</tg-spoiler>\n` : '') +
            `\n<i>These will be WIPED from DB after release.</i>`;
          await bot.sendMessage(adminChatId, credsText, { parse_mode: 'HTML' });
        }
      } catch (e) { /* ignore */ }
    }
  }

  for (const adminChatId of adminChatIds) {
    bot.sendMessage(adminChatId, text, {
      parse_mode: 'HTML',
      reply_markup: escrowAdminKeyboard(listing),
    });
  }
};

// ===================== RELEASE & WIPE =====================
const releaseEscrow = async (adminTgId, listingId) => {
  const listing = await Listing.findById(listingId).populate('sellerId escrowBuyerId');
  if (!listing) return { ok: false, err: 'Listing not found' };
  if (!listing.paidAt) return { ok: false, err: 'Payment proof not yet submitted' };
  if (!listing.paymentVerifiedAt) return { ok: false, err: 'Payment not yet verified by admin' };
  if (!listing.credentialsSubmittedAt) return { ok: false, err: 'Credentials not yet submitted by seller' };
  if (listing.releasedAt) return { ok: false, err: 'Already released' };

  const creds = await AccountCredentials.findOne({ listingId: listing._id });
  if (!creds) return { ok: false, err: 'Credentials not found' };
  if (listing.credentialsWiped) return { ok: false, err: 'Credentials already wiped' };

  const decrypted = creds.getAllDecrypted();

  listing.status = 'released';
  listing.releasedAt = new Date();
  listing.credentialsWiped = true;
  listing.soldTo = listing.escrowBuyerId;
  await listing.save();

  try {
    await AccountCredentials.deleteOne({ _id: creds._id });
  } catch (e) { console.error('Wipe creds error:', e.message); }

  const buyerChatId = listing.escrowBuyerId?.telegramChatId;
  const sellerChatId = listing.sellerId?.telegramChatId;

  if (buyerChatId) {
    bot.sendMessage(buyerChatId,
      `🎉 <b>ESCROW RELEASED!</b>\n\n` +
      `<tg-emoji emoji-id="6102684181521763740">💠</tg-emoji> Listing: <b>${listing.title}</b>\n` +
      `Price paid: <b>${formatMoney(listing.price, listing.currency)}</b> (incl. fees)\n\n` +
      `Here are your account credentials (save them NOW — they've been WIPED from our database):\n\n` +
      `📧 Email: <code>${decrypted.email || 'N/A'}</code>\n` +
      `🔑 Password: <tg-spoiler>${decrypted.password || 'N/A'}</tg-spoiler>\n` +
      (decrypted.additionalInfo ? `📋 Extra info: <tg-spoiler>${decrypted.additionalInfo}</tg-spoiler>\n` : '') +
      `\n⚠️ <b>IMPORTANT:</b> Change the password, set up your own 2FA, and update recovery email immediately.\nEnjoy the account!`,
      { parse_mode: 'HTML' },
    );
  }
  if (sellerChatId) {
    const adminFee = listing.adminFee !== undefined ? listing.adminFee : listing.price * LEGACY_SERVICE_FEE_RATE;
    const sellerGets = listing.sellerPrice !== undefined ? listing.sellerPrice : listing.price - adminFee;

    bot.sendMessage(sellerChatId,
      `✅ <b>BUYER RECEIVED ACCOUNT — PAYOUT PENDING</b>\n\n` +
      `<tg-emoji emoji-id="6102684181521763740">💠</tg-emoji> Listing: <b>${listing.title}</b>\n` +
      `You will receive: <b>${formatMoney(sellerGets, listing.currency)}</b>\n\n` +
      `Admin verified payment and released the account to the buyer. Admin will now send your payout. You will get a confirmation here once admin marks you as PAID.`,
      { parse_mode: 'HTML' },
    );
  }

  try {
    await updateChannelListingStatus(listing, '🔴 SOLD');
  } catch (e) { /* ignore */ }

  return { ok: true, decrypted, listing };
};

// ===================== INIT BOT =====================
const initTelegramBot = () => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token.includes('your_telegram_bot_token')) {
    console.warn('⚠️ TELEGRAM_BOT_TOKEN not configured. Telegram bot disabled.');
    return null;
  }
  bot = new TelegramBot(token, { polling: true });
  console.log('🤖 Telegram bot running (MVP).');

  bot.on('polling_error', (error) => {
    if (error.code === 'ETELEGRAM' && error.message.includes('409 Conflict')) {
      console.warn('⚠️ Telegram Polling Conflict (409): Another instance is running. This is normal during deployments.');
    } else {
      console.error(`Telegram Polling Error: ${error.code} - ${error.message}`);
    }
  });

  process.once('SIGINT', () => bot.stopPolling());
  process.once('SIGTERM', () => bot.stopPolling());

  // -------- /start --------
  bot.onText(/\/start/, async (msg) => {
    const user = await getOrCreateUser(msg.from, msg.chat.id);
    const isAdmin = isAdminTelegramId(msg.from.id);

    let startPayload = '';
    const txt = msg.text || '';
    const spaceIdx = txt.indexOf(' ');
    if (spaceIdx !== -1) startPayload = txt.slice(spaceIdx + 1).trim();

    if (startPayload.startsWith('buy_')) {
      const listingId = startPayload.slice(4);
      const listing = await findListingByShortOrFullId(listingId);
      if (!listing) return bot.sendMessage(msg.chat.id, '❌ Listing not found (or already sold/deleted).');
      if (['sold', 'deleted', 'rejected'].includes(listing.status)) return bot.sendMessage(msg.chat.id, '❌ This listing is not available.');
      if (listing.escrowBuyerId && String(listing.escrowBuyerId) !== String(user._id) && !isAdminTelegramId(user.telegramId)) {
        return bot.sendMessage(msg.chat.id, '⏳ This listing is currently being processed by another buyer. Please contact admin.');
      }
      const priceStr = formatMoney(listing.price, listing.currency);
      const PaymentMethod = require('../models/PaymentMethod');
      let banks = [];
      try {
        banks = await PaymentMethod.find({ isActive: true }).sort({ createdAt: 1 });
      } catch (e) {
        console.error('Error fetching payment methods:', e);
        banks = [];
      }
      
      let summary = `You selected: <b>${listing.title}</b>\n\n<b>Please select your payment method:</b>\n\n`;
      
      if (!banks.length) {
        bot.sendMessage(msg.chat.id,
          summary +
          `<b>ሕጋዊ ማስጠንቀቂያ</b>\n` +
          `በክፍያ ይህን ያረጋግጡ፡ ከ18 አመት በላይ ነዎት እና የእኛን ውሎች እና መመሪያዎች ይቀበላሉ፡\n\n` +
          `ለክፍያ ዝርዝር ለማግኘት አስተዳዳሪውን ያነጋግሩ።`,
          { parse_mode: 'HTML' },
        );
        return;
      }
      
      const rows = [];
      for (let i = 0; i < banks.length; i++) {
        const btn = { text: banks[i].name, callback_data: banks[i].callback_data };
        if (banks[i].icon_custom_emoji_id && 
            banks[i].icon_custom_emoji_id !== 'ENTER_ID_HERE' && 
            banks[i].icon_custom_emoji_id.trim() !== '') {
          // Add custom emoji to text
          summary += `<tg-emoji emoji-id="${banks[i].icon_custom_emoji_id}">-</tg-emoji> <b>${banks[i].name}</b>\n`;
        } else {
          summary += `- <b>${banks[i].name}</b>\n`;
        }
        rows.push([btn]);
      }
      summary += `\n<i>Tap a button below to proceed ⬇️</i>`;
      
      rows.push([{ text: '🔙 Back', callback_data: `delete_msg` }]);
      setSession(msg.chat.id, 'buy_listing', { listingId: String(listing._id) });
      bot.sendMessage(msg.chat.id, summary, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: rows },
      });
      return;
    }

    if (startPayload.startsWith('contact_')) {
      const listingId = startPayload.slice(8);
      const listing = await findListingByShortOrFullId(listingId);
      if (!listing) return bot.sendMessage(msg.chat.id, '❌ Listing not found (or already sold/deleted).');
      setSession(msg.chat.id, 'contact_admin_message', { listingId: String(listing._id) });
      bot.sendMessage(msg.chat.id,
        `💬 <b>Contact Admin</b>\n\n` +
        `Listing: <b>${listing.title}</b>\n` +
        `Price: <b>${formatMoney(listing.price, listing.currency)}</b>\n` +
        `Listing ID: <code>${shortId(listing._id)}</code>\n\n` +
        `Send your message now. Admins will contact you directly.`,
        { parse_mode: 'HTML' },
      );
      return;
    }

    const adminBadge = isAdmin ? '\n<tg-emoji emoji-id="6102638354220716294">🛡️</tg-emoji> <b>ADMIN ACCOUNT</b>' : '';
    bot.sendMessage(msg.chat.id,
      `<tg-emoji emoji-id="6100651927551348857">👋</tg-emoji> Welcome <b>${user.firstName || user.username}</b> to <b>AuraShop EFootball Marketplace!</b>${adminBadge}\n\n` +
      `<tg-emoji emoji-id="6102756813713706029">🛡️</tg-emoji> The SAFEST way to buy/sell EFootball accounts with escrow protection.\n\n` +
      `<tg-emoji emoji-id="6100453551601881338">📣</tg-emoji> <b>Official Channel:</b> ${process.env.TELEGRAM_CHANNEL_ID || '(set TELEGRAM_CHANNEL_ID)'}\n\n` +
      `<tg-emoji emoji-id="6104818848987358154">📌</tg-emoji> <b>Main Commands:</b>\n` +
      `  /sell    — List a new account for sale\n` +
      `  /browse  — Browse active listings\n` +
      `  /search &lt;keyword&gt; — Search listings\n` +
      `  /paid &lt;id&gt;    — (Buyer) Submit payment proof\n` +
      `  /admins  — Show official admins list\n` +
      `  /menu    — Show menu`,
      { parse_mode: 'HTML' },
    );
    showMainMenu(msg.chat.id, user);
  });

  bot.onText(/\/(menu|home|help)/, async (msg) => {
    const user = await getOrCreateUser(msg.from, msg.chat.id);
    showMainMenu(msg.chat.id, user);
  });

  // -------- /sell --------
  bot.onText(/\/sell/, async (msg) => {
    const user = await getOrCreateUser(msg.from, msg.chat.id);
    if (user.status === 'banned') return bot.sendMessage(msg.chat.id, '❌ Your account is banned.');
    if (user.role === 'buyer') { user.role = 'seller'; await user.save(); }
    startCreateListingFlow(msg.chat.id);
  });

  // -------- /browse --------
  bot.onText(/\/(buy|browse)/, async (msg) => {
    const chatId = msg.chat.id;
    browseAndShow(chatId, {});
  });

  // -------- /admins --------
  bot.onText(/\/admins/, async (msg) => {
    const adminListText = 
      `<tg-emoji emoji-id="5368324170671202290">🛡️</tg-emoji> <b>[ADMIN]</b> @SARIK_CR7\n` +
      `<tg-emoji emoji-id="5368324170671202290">🛡️</tg-emoji> <b>[ADMIN]</b> @eFgarant\n` +
      `<tg-emoji emoji-id="5368324170671202290">🛡️</tg-emoji> <b>[ADMIN]</b> @Kamolxuja19\n` +
      `<tg-emoji emoji-id="5368324170671202290">🛡️</tg-emoji> <b>[ADMIN]</b> @cosmos19\n` +
      `<tg-emoji emoji-id="5368324170671202290">🛡️</tg-emoji> <b>[ADMIN]</b> @ef_rasulov\n` +
      `<tg-emoji emoji-id="5368324170671202290">🛡️</tg-emoji> <b>[ADMIN]</b> @eFadmin_uz\n` +
      `<tg-emoji emoji-id="5368324170671202290">🛡️</tg-emoji> <b>[ADMIN]</b> @CR7_ISLAM07\n` +
      `<tg-emoji emoji-id="5368324170671202290">🛡️</tg-emoji> <b>[ADMIN]</b> @Uz_efadmin\n\n` +
      `<tg-emoji emoji-id="5368324170671202289">🔖</tg-emoji> Save this channel and be careful not to be deceived by #CLON and #KID accounts. Be vigilant. <tg-emoji emoji-id="5368324170671202290">✅</tg-emoji> Original admins have more than one user.\n` +
      `<tg-emoji emoji-id="5368324170671202290">🛡️</tg-emoji> Save this post for yourself and check before trading with an admin. Don't realize it's a clone after you've been deceived (admins don't trade in groups!).\n` +
      `<tg-emoji emoji-id="5368324170671202289">🔔</tg-emoji> Write to all admins now and save their contacts to avoid being deceived. <tg-emoji emoji-id="5368324170671202290">✅</tg-emoji>`;

    bot.sendMessage(msg.chat.id, adminListText, { parse_mode: 'HTML' });
  });

  // -------- /search --------
  bot.onText(/\/search(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const q = match[1]?.trim();
    if (!q) {
      setSession(chatId, 'search_query', {});
      bot.sendMessage(chatId, '🔍 Enter search keyword (player, team, platform, price...):');
      return;
    }
    browseAndShow(chatId, { search: q });
  });

  // -------- /paid <listing_id> --------
  bot.onText(/\/paid(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const user = await getOrCreateUser(msg.from, chatId);
    const arg = match[1]?.trim();
    if (!arg) {
      setSession(chatId, 'paid_listing_id', {});
      bot.sendMessage(chatId, '<tg-emoji emoji-id="5961015849199342153">🏦</tg-emoji> <b>Submit Payment Proof</b>\n\nStep 1/2: Enter the <b>Listing ID</b> (the short code, e.g. <code>a3f21b90</code>):', { parse_mode: 'HTML' });
      return;
    }
    const listing = await findListingByShortOrFullId(arg);
    if (!listing) return bot.sendMessage(chatId, '❌ Listing not found. Check the ID and try again.');
    setSession(chatId, 'paid_receipt_upload', { listingId: String(listing._id) });
    listing.escrowBuyerId = user._id;
    if (listing.status === 'available') listing.status = 'waiting_escrow';
    await listing.save();
    try { await updateChannelListingStatus(listing, '🟡 RESERVED'); } catch (e) { /* ignore */ }
    bot.sendMessage(chatId,
      `<tg-emoji emoji-id="5961015849199342153">🏦</tg-emoji> <b>Payment Proof - Step 2/2</b>\n\n` +
      `Listing: <b>${listing.title}</b> (${formatMoney(listing.price, listing.currency)})\n\n` +
      `Now <b>send a photo or document</b> (screenshot/PDF) proving your payment to admin. Mobile money/Bank transfer/PayPal receipt — whatever works.`,
      { parse_mode: 'HTML' },
    );
  });

  // -------- /deliver <listing_id> --------
  bot.onText(/\/deliver(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const user = await getOrCreateUser(msg.from, chatId);
    const arg = match[1]?.trim();
    if (!arg) {
      setSession(chatId, 'deliver_listing_id', {});
      bot.sendMessage(chatId, '<tg-emoji emoji-id="5963162821746233777">🏦</tg-emoji> <b>Deliver Credentials</b>\n\nStep 1/4: Enter the <b>Listing ID</b>:', { parse_mode: 'HTML' });
      return;
    }
    const listing = await findListingByShortOrFullId(arg);
    if (!listing) return bot.sendMessage(chatId, '❌ Listing not found.');
    if (String(listing.sellerId) !== String(user._id) && !isAdminTelegramId(user.telegramId)) {
      return bot.sendMessage(chatId, '❌ Only the seller of this listing can deliver credentials.');
    }
    setSession(chatId, 'deliver_email', { listingId: String(listing._id) });
    bot.sendMessage(chatId, `<tg-emoji emoji-id="5963162821746233777">🏦</tg-emoji> <b>Deliver Credentials for "${listing.title}"</b> (2/4)\n\nSend the account <b>EMAIL</b>:`, { parse_mode: 'HTML' });
  });

  // -------- /admin --------
  bot.onText(/\/admin/, async (msg) => {
    if (!isAdminTelegramId(msg.from.id)) return bot.sendMessage(msg.chat.id, '❌ Admin only.');
    showAdminPanel(msg.chat.id);
  });

  const showAdminPanel = async (chatId) => {
    const pending = await Listing.countDocuments({ status: 'pending_review' });
    const waitingEscrow = await Listing.find({
      $or: [{ status: 'waiting_escrow' }, { status: 'paid_submitted' }, { status: 'creds_submitted' }],
    }).populate('sellerId escrowBuyerId');
    const active = waitingEscrow.length;

    const lines = [];
    lines.push('🛡️ <b>ADMIN PANEL</b>\n');
    lines.push(`⏳ Pending Review: <b>${pending}</b>`);
    lines.push(`🤝 Active Escrows: <b>${active}</b>`);
    bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'HTML' });

    if (pending > 0) {
      const pendings = await Listing.find({ status: 'pending_review' }).populate('sellerId').limit(10);
      for (const l of pendings) {
        bot.sendMessage(chatId,
          `⏳ PENDING: <b>${l.title}</b>\nFrom @${l.sellerId?.username || '?'}\n<tg-emoji emoji-id="5961054379350955385">🏦</tg-emoji> ${formatMoney(l.price, l.currency)} | ID: <code>${shortId(l._id)}</code>`,
          { parse_mode: 'HTML', reply_markup: approveRejectKeyboard(l._id) },
        );
      }
    }
    if (active > 0) {
      for (const l of waitingEscrow) {
        bot.sendMessage(chatId,
          `🤝 ESCROW #${shortId(l._id)} <b>${l.title}</b>\n` +
          `<tg-emoji emoji-id="5961054379350955385">🏦</tg-emoji> ${formatMoney(l.price, l.currency)} | ${escrowStatusBadge(l)}\n` +
          `@${l.sellerId?.username || '?'} → @${l.escrowBuyerId?.username || '?'}`,
          { parse_mode: 'HTML', reply_markup: escrowAdminKeyboard(l) },
        );
      }
    }
  };

  // -------- Photo handler for listing creation (create_image state) --------
  bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    const user = await getOrCreateUser(msg.from, chatId);
    const session = getSession(chatId);
    
    // Handle listing creation - user sends team image
    if (session && session.state === 'create_image' && session.data.price) {
      const photo = msg.photo?.[msg.photo.length - 1];
      if (!photo) return;
      const price = session.data.price;
      const creds = { email: session.data.email, password: session.data.password, additionalInfo: session.data.extra };
      const imageFileId = photo.file_id;
      clearSession(chatId);
      await finalizeCreateListingSimple(chatId, user, price, imageFileId, creds);
      return;
    }
    
    // Handle payment receipt upload
    if (session && session.state === 'paid_receipt_upload' && session.data.listingId) {
      const photo = msg.photo?.[msg.photo.length - 1];
      if (!photo) return;
      const listing = await Listing.findById(session.data.listingId).populate('sellerId escrowBuyerId');
      if (!listing) return bot.sendMessage(chatId, '❌ Listing not found.');
      listing.paidReceiptFileId = photo.file_id;
      listing.paidReceiptType = 'photo';
      listing.paidAt = new Date();
      listing.escrowBuyerId = user._id;
      listing.status = 'paid_submitted';
      await listing.save();
      clearSession(chatId);
      bot.sendMessage(chatId, '✅ Payment proof RECEIVED. Sent to admins for verification.\n\nOnce admin verifies payment, they will release the account details to you here in the bot.', { parse_mode: 'HTML' });
      notifyAdminEscrowUpdate(listing, `<tg-emoji emoji-id="5961015849199342153">🏦</tg-emoji> Buyer @${user.username || '?'} just uploaded payment proof (photo).`);
      return;
    }
  });

  bot.on('document', async (msg) => {
    const chatId = msg.chat.id;
    const user = await getOrCreateUser(msg.from, chatId);
    const session = getSession(chatId);
    if (session && session.state === 'paid_receipt_upload' && session.data.listingId) {
      const doc = msg.document;
      if (!doc) return;
      const listing = await Listing.findById(session.data.listingId).populate('sellerId escrowBuyerId');
      if (!listing) return bot.sendMessage(chatId, '❌ Listing not found.');
      listing.paidReceiptFileId = doc.file_id;
      listing.paidReceiptType = 'document';
      listing.paidAt = new Date();
      listing.escrowBuyerId = user._id;
      listing.status = 'paid_submitted';
      await listing.save();
      clearSession(chatId);
      bot.sendMessage(chatId, '✅ Payment proof RECEIVED. Sent to admins.\n\nOnce admin verifies payment, they will release the account details to you here in the bot.', { parse_mode: 'HTML' });
      notifyAdminEscrowUpdate(listing, `<tg-emoji emoji-id="5961015849199342153">🏦</tg-emoji> Buyer @${user.username || '?'} just uploaded payment proof (document: ${doc.file_name || 'receipt'}).`);
      return;
    }
  });

  // -------- Generic text handler --------
  bot.on('message', async (msg) => {
    if (msg.photo || msg.document) return;
    const chatId = msg.chat.id;

    if (isAdminTelegramId(msg.from.id) && msg.entities) {
      const customEmojis = msg.entities.filter(e => e.type === 'custom_emoji');
      if (customEmojis.length > 0) {
        const ids = customEmojis.map(e => e.custom_emoji_id).join('\n');
        bot.sendMessage(msg.chat.id, `Custom Emoji IDs:\n<code>${ids}</code>`, { parse_mode: 'HTML' });
      }
    }

    const text = msg.text;
    if (!text) return;
    if (text.startsWith('/')) return;

    const user = await getOrCreateUser(msg.from, chatId);
    const session = getSession(chatId);
    if (!session) return;

    const d = session.data;
    const handled = await handleCreateListingState(chatId, user, text);
    if (handled) return;

    switch (session.state) {
      case 'paid_listing_id': {
        clearSession(chatId);
        const listing = await findListingByShortOrFullId(text);
        if (!listing) return bot.sendMessage(chatId, '❌ Listing not found.');
        listing.escrowBuyerId = user._id;
        if (listing.status === 'available') listing.status = 'waiting_escrow';
        await listing.save();
        try { await updateChannelListingStatus(listing, '🟡 RESERVED'); } catch (e) { /* ignore */ }
        setSession(chatId, 'paid_receipt_upload', { listingId: String(listing._id) });
        bot.sendMessage(chatId,
          `<tg-emoji emoji-id="5961015849199342153">🏦</tg-emoji> <b>Payment Proof</b>\n\nListing: <b>${listing.title}</b> (${formatMoney(listing.price, listing.currency)})\n\n` +
          `Now send a photo or document of your payment receipt.`,
          { parse_mode: 'HTML' },
        );
        return;
      }
      case 'deliver_listing_id': {
        clearSession(chatId);
        const listing = await findListingByShortOrFullId(text);
        if (!listing) return bot.sendMessage(chatId, '❌ Listing not found.');
        if (String(listing.sellerId) !== String(user._id) && !isAdminTelegramId(user.telegramId)) {
          return bot.sendMessage(chatId, '❌ Only the seller can deliver credentials for this listing.');
        }
        setSession(chatId, 'deliver_email', { listingId: String(listing._id) });
        bot.sendMessage(chatId, `<tg-emoji emoji-id="5963162821746233777">🏦</tg-emoji> <b>Deliver Credentials for "${listing.title}"</b> (1/4)\n\nSend the account <b>EMAIL</b>:`, { parse_mode: 'HTML' });
        return;
      }
      case 'deliver_email':
        if (!text.includes('@')) return bot.sendMessage(chatId, '❌ Invalid email.');
        d.email = text;
        setSession(chatId, 'deliver_password', d);
        bot.sendMessage(chatId, '<tg-emoji emoji-id="5963162821746233777">🏦</tg-emoji> (2/4) Send the account <b>PASSWORD</b>: (encrypted & admin-only)', { parse_mode: 'HTML' });
        return;

      case 'deliver_password':
        if (text.length < 3) return bot.sendMessage(chatId, '❌ Password too short.');
        d.password = text;
        setSession(chatId, 'deliver_extra', d);
        bot.sendMessage(chatId, '<tg-emoji emoji-id="5963162821746233777">🏦</tg-emoji> (3/4) Send any extra info: backup codes / 2FA seed / recovery email, or type <code>done</code>:', { parse_mode: 'HTML' });
        return;

      case 'deliver_extra': {
        if (text && text.toLowerCase() !== 'done') d.extra = text;
        const listing = await Listing.findById(d.listingId).populate('sellerId escrowBuyerId');
        if (!listing) { clearSession(chatId); return; }
        let creds = await AccountCredentials.findOne({ listingId: listing._id });
        if (!creds) creds = await AccountCredentials.create({ listingId: listing._id });
        creds.setEmail(d.email);
        creds.setPassword(d.password);
        if (d.extra) creds.setAdditionalInfo(d.extra);
        await creds.save();

        listing.credentialsSubmittedAt = new Date();
        listing.credentialsWiped = false;
        if (listing.status === 'available' || listing.status === 'waiting_escrow' || listing.status === 'paid_submitted') {
          listing.status = listing.paidAt ? 'creds_submitted' : 'creds_submitted';
        }
        await listing.save();
        clearSession(chatId);

        bot.sendMessage(chatId,
          `✅ Credentials RECEIVED and encrypted. Sent to admin.\n\n` +
          `Once the buyer submits payment proof and admin verifies the payment actually arrived, admin will release the credentials to the buyer and confirm to you.`,
        );
        notifyAdminEscrowUpdate(listing, `<tg-emoji emoji-id="5963162821746233777">🏦</tg-emoji> Seller @${user.username || '?'} just submitted account credentials.`);
        return;
      }
      case 'contact_admin_message': {
        clearSession(chatId);
        const listing = await Listing.findById(d.listingId);
        if (!listing) return bot.sendMessage(chatId, '❌ Listing not found.');
        const adminChatIds = getAdminChatIds();
        for (const adminChatId of adminChatIds) {
          bot.sendMessage(adminChatId,
            `💬 <b>NEW MESSAGE TO ADMINS</b>\n\n` +
            `From: @${user.username || 'N/A'} (TG ID: <code>${user.telegramId}</code>)\n` +
            `Listing: <b>${listing.title}</b>\n` +
            `Price: <b>${formatMoney(listing.price, listing.currency)}</b>\n` +
            `Listing ID: <code>${shortId(listing._id)}</code>\n\n` +
            `Message:\n${text}`,
            { parse_mode: 'HTML' },
          );
        }
        bot.sendMessage(chatId, '✅ Message sent to admins. Please wait for their response here.');
        return;
      }
    }
  });

  // -------- Callback Query handler --------
  bot.on('callback_query', async (cb) => {
    const chatId = cb.message?.chat?.id;
    const msgId = cb.message?.message_id;
    if (!chatId) return;
    const user = await getOrCreateUser(cb.from, chatId);
    const raw = cb.data || '';
    const answer = (t, alert = false) => bot.answerCallbackQuery(cb.id, { text: t || '', show_alert: alert }).catch(() => {});
    const edit = (text, extra) => bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', ...extra }).catch(() => {});

    try {
      if (raw === 'noop') { answer(); return; }
      if (raw === 'delete_msg') {
        bot.deleteMessage(chatId, msgId).catch(() => {});
        return answer();
      }
      if (raw.startsWith('pf_')) {
        const session = getSession(chatId);
        if (!session || session.state !== 'create_platform') { answer('Session expired, start /sell again', true); return; }
        const platform = raw.slice(3);
        session.data.platform = platform;
        setSession(chatId, 'create_overall', session.data);
        answer();
        bot.sendMessage(chatId, '<tg-emoji emoji-id="6100340203119971469">🔥</tg-emoji> <b>Step 4/8</b>\n\nEnter team overall rating as a number (e.g. <code>4800</code>), or type <code>skip</code>:', { parse_mode: 'HTML' });
        return;
      }
      if (raw.startsWith('neg_')) {
        const session = getSession(chatId);
        if (!session || session.state !== 'create_negotiable') { answer('Session expired', true); return; }
        session.data.negotiable = raw === 'neg_yes';
        setSession(chatId, 'create_creds_email', session.data);
        answer();
        bot.sendMessage(chatId,
          `<tg-emoji emoji-id="5963162821746233777">🏦</tg-emoji> <b>Now enter the account credentials</b> (1/3)\n\n` +
          `These will be encrypted with AES-256-GCM in the database. Only admin can decrypt them. They will be permanently DELETED from the database after escrow release.\n\n` +
          `Step 1: Send the account <b>EMAIL</b>:`,
          { parse_mode: 'HTML' },
        );
        return;
      }
      if (raw.startsWith('paid_start_')) {
        const lid = raw.slice(11);
        const listing = await Listing.findById(lid);
        if (!listing) { answer('Not found', true); return; }
        if (['sold', 'deleted', 'rejected'].includes(listing.status)) { answer('Not available', true); return; }
        if (listing.escrowBuyerId && String(listing.escrowBuyerId) !== String(user._id) && !isAdminTelegramId(user.telegramId)) {
          answer('Already in escrow', true);
          return;
        }
        listing.escrowBuyerId = user._id;
        if (listing.status === 'available') listing.status = 'waiting_escrow';
        await listing.save();
        try { await updateChannelListingStatus(listing, '🟡 RESERVED'); } catch (e) { /* ignore */ }
        setSession(chatId, 'paid_receipt_upload', { listingId: String(listing._id) });
        answer('Upload your receipt now');
        bot.sendMessage(chatId,
          `<tg-emoji emoji-id="5961015849199342153">🏦</tg-emoji> <b>Upload Receipt</b>\n\n` +
          `Listing: <b>${listing.title}</b> (${formatMoney(listing.price, listing.currency)})\n` +
          `Listing ID: <code>${shortId(listing._id)}</code>\n\n` +
          `Now send a <b>photo</b> or <b>document</b> of your payment receipt.`,
          { parse_mode: 'HTML' },
        );
        return;
      }
      if (raw.startsWith('bank_')) {
        const session = getSession(chatId);
        if (!session || session.state !== 'buy_listing') { answer('Session expired, start over', true); return; }
        const listing = await Listing.findById(session.data.listingId);
        if (!listing) { answer('Not found', true); return; }
        const priceStr = formatMoney(listing.price, listing.currency);
        let banks = [];
        try {
          const rawEnv = (process.env.PAYMENT_INSTRUCTIONS || '').trim();
          banks = rawEnv ? JSON.parse(rawEnv) : [];
        } catch (e) {
          banks = [];
        }
        const idx = parseInt(raw.slice(5), 10);
        const bank = banks[idx];
        if (!bank) { answer('Bank not found', true); return; }
        answer();
        bot.sendMessage(chatId,
          `✅ Your Order Summary\n` +
          `Product: ${listing.title}\n` +
          `Price: ${priceStr}\n` +
          `Bank: ${bank.name}\n\n` +
          `Please send exactly ${priceStr} to:\n` +
          `• Name: ${bank.holder}\n` +
          `• Account: <code>${bank.account}</code>\n\n` +
          `⚠️ Legal Warning / የህግ ማሳሰቢያ:\n` +
          `By paying, you confirm you are 18+ and agree to our Terms.\n` +
          `ክፍያ ሲፈፅሙ ዕድሜዎ 18+ መሆኑን እና በደንቡ መስማማትዎን ያረጋግጣሉ፡፡\n\n` +
          `1. ከላይ ወደ ተቀመጠው አካውንት ትክክለኛውን ሂሳብ ያስገቡ።\n` +
          `2. ክፍያውን እንደፈጸሙ ከ ${bank.name} የሚደርስዎትን የ SMS መልእክት ይመልከቱ::\n` +
          `3. ⚠️ ማሳሰቢያ: ልክ ከላይ በምስሉ ላይ እንደተመለከተው፣ ክፍያውን ሲፈጽሙ ከ ${bank.name} የተላከሎትን መልእክት ሙሉውን (Copy) ያድርጉ::\n` +
          `4. ኮፒ ያደረጉትን ሙሉ መልእክት አሁን እዚህ ይላኩ!\n` +
          `(This order will expire in 30 minutes)`,
          {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: 'ከፍያ አድርጓል ✅', callback_data: `paid_start_${listing._id}` }]] },
          },
        );
        return;
      }
      if (raw.startsWith('verify_payment_')) {
        if (!isAdminTelegramId(cb.from.id)) { answer('Admin only', true); return; }
        const lid = raw.slice(15);
        const listing = await Listing.findById(lid).populate('sellerId escrowBuyerId');
        if (!listing) { answer('Not found', true); return; }
        if (!listing.paidAt) { answer('No receipt yet', true); return; }
        if (listing.paymentVerifiedAt) { answer('Already verified'); return; }
        listing.paymentVerifiedAt = new Date();
        listing.paymentVerifiedBy = user._id;
        await listing.save();
        answer('Payment verified');
        await notifyAdminEscrowUpdate(listing, `✅ Payment verified by admin @${user.username || '?'}`);
        return;
      }
      if (raw.startsWith('mark_seller_paid_')) {
        if (!isAdminTelegramId(cb.from.id)) { answer('Admin only', true); return; }
        const lid = raw.slice(17);
        const listing = await Listing.findById(lid).populate('sellerId escrowBuyerId');
        if (!listing) { answer('Not found', true); return; }
        if (!listing.releasedAt) { answer('Release first', true); return; }
        if (listing.sellerPaidAt) { answer('Already marked paid'); return; }
        listing.sellerPaidAt = new Date();
        listing.sellerPaidBy = user._id;
        listing.status = 'sold';
        if (!listing.soldTo && listing.escrowBuyerId) listing.soldTo = listing.escrowBuyerId;
        await listing.save();
        answer('Seller marked paid');
        const sellerChatId = listing.sellerId?.telegramChatId;
        const buyerChatId = listing.escrowBuyerId?.telegramChatId;
        if (sellerChatId) {
          const adminFee = listing.adminFee !== undefined ? listing.adminFee : listing.price * LEGACY_SERVICE_FEE_RATE;
          const sellerGets = listing.sellerPrice !== undefined ? listing.sellerPrice : listing.price - adminFee;
          bot.sendMessage(sellerChatId,
            `<tg-emoji emoji-id="5961054379350955385">🏦</tg-emoji> <b>PAYOUT SENT</b>\n\n` +
            `<tg-emoji emoji-id="6102684181521763740">💠</tg-emoji> Listing: <b>${listing.title}</b>\n` +
            `You received: <b>${formatMoney(sellerGets, listing.currency)}</b>\n\n` +
            `✅ Admin has marked your payout as completed. Thank you for using AuraShop.`,
            { parse_mode: 'HTML' },
          );
        }
        if (buyerChatId) {
          bot.sendMessage(buyerChatId, '✅ Deal completed. Thank you for buying on AuraShop!');
        }
        edit(
          `<tg-emoji emoji-id="5961054379350955385">🏦</tg-emoji> <b>SELLER PAID — DEAL CLOSED</b>\n\n` +
          `<tg-emoji emoji-id="6102684181521763740">💠</tg-emoji> ${listing.title} | <tg-emoji emoji-id="5961054379350955385">🏦</tg-emoji> ${formatMoney(listing.price, listing.currency)}\n` +
          `Buyer: @${listing.escrowBuyerId?.username || '?'}\n` +
          `Seller: @${listing.sellerId?.username || '?'}\n\n` +
          `✅ Seller payout marked complete.\n✅ Listing status set to SOLD.`,
          { reply_markup: undefined },
        );
        return;
      }
      if (raw.startsWith('approve_')) {
        if (!isAdminTelegramId(cb.from.id)) { answer('Admin only', true); return; }
        const lid = raw.slice(8);
        const listing = await Listing.findById(lid).populate('sellerId');
        if (!listing) { answer('Not found', true); return; }
        answer('✅ Approved, posting to channel...');
        await publishListingToChannel(listing, listing.sellerId);
        edit(
          `<s>${(cb.message?.text || '').split('🆕 <b>NEW LISTING PENDING REVIEW</b>')[0] || ''}</s>\n` +
          `✅ <b>LISTING APPROVED & POSTED TO CHANNEL</b>\n` +
          `<tg-emoji emoji-id="6102684181521763740">💠</tg-emoji> ${listing.title} | <tg-emoji emoji-id="5961054379350955385">🏦</tg-emoji> ${formatMoney(listing.price, listing.currency)} | <tg-emoji emoji-id="6102684181521763740">💠</tg-emoji> ${listing.platform}\n` +
          `Posted: ${process.env.TELEGRAM_CHANNEL_ID || 'Channel'} | ID: <code>${shortId(listing._id)}</code>`,
          { reply_markup: undefined, disable_web_page_preview: true },
        );
        const sellerChatId = listing.sellerId?.telegramChatId;
        if (sellerChatId) {
          bot.sendMessage(sellerChatId,
            `🎉 <b>YOUR LISTING IS LIVE!</b>\n\n` +
            `<tg-emoji emoji-id="6102684181521763740">💠</tg-emoji> <b>${listing.title}</b> | ${formatMoney(listing.price, listing.currency)} | ${listing.platform}\n\n` +
            `Posted to: ${process.env.TELEGRAM_CHANNEL_ID || 'Market Channel'}\n` +
            `Listing ID: <code>${shortId(listing._id)}</code>\n\n` +
            `Buyers will click BUY from the channel and get payment instructions in the bot.\n\n` +
            `If admin needs anything from you (extra info / recovery), you will be contacted here.`,
            { parse_mode: 'HTML' },
          );
        }
        return;
      }
      if (raw.startsWith('reject_')) {
        if (!isAdminTelegramId(cb.from.id)) { answer('Admin only', true); return; }
        const lid = raw.slice(7);
        const listing = await Listing.findById(lid).populate('sellerId');
        if (!listing) { answer('Not found', true); return; }
        listing.status = 'rejected';
        listing.rejectionReason = 'Rejected by admin';
        await listing.save();
        answer('❌ Rejected');
        edit(`❌ <b>LISTING REJECTED</b>\n${listing.title} — ID: <code>${shortId(listing._id)}</code>`, { reply_markup: undefined });
        const sellerChatId = listing.sellerId?.telegramChatId;
        if (sellerChatId) {
          bot.sendMessage(sellerChatId,
            `❌ Your listing <b>"${listing.title}"</b> was rejected by admin.\nContact admin if you believe this is an error.`,
            { parse_mode: 'HTML' },
          );
        }
        return;
      }
      if (raw.startsWith('release_')) {
        if (!isAdminTelegramId(cb.from.id)) { answer('Admin only', true); return; }
        const lid = raw.slice(8);
        answer('Releasing to buyer and wiping credentials...');
        const res = await releaseEscrow(cb.from.id, lid);
        if (!res.ok) { edit(`❌ Release failed: ${res.err}\n\nListing ID: <code>${shortId(lid)}</code>`, { reply_markup: undefined }); return; }
        edit(
          `🎉 <b>ESCROW RELEASED & CREDS WIPED FROM DB</b>\n\n` +
          `<tg-emoji emoji-id="6102684181521763740">💠</tg-emoji> ${res.listing.title} | <tg-emoji emoji-id="5961054379350955385">🏦</tg-emoji> ${formatMoney(res.listing.price, res.listing.currency)}\n` +
          `Buyer: @${res.listing.escrowBuyerId?.username || '?'}\n` +
          `Seller: @${res.listing.sellerId?.username || '?'}\n\n` +
          `✅ Credentials sent to buyer.\n✅ Seller notified of release.\n✅ Credentials document DELETED from MongoDB.\n✅ Channel post updated to SOLD.`,
          { reply_markup: undefined },
        );
        return;
      }
      if (raw.startsWith('cancel_escrow_')) {
        if (!isAdminTelegramId(cb.from.id)) { answer('Admin only', true); return; }
        const lid = raw.slice(14);
        const listing = await Listing.findById(lid);
        if (!listing) { answer('Not found', true); return; }
        listing.status = 'available';
        listing.paidReceiptFileId = undefined;
        listing.paidReceiptType = undefined;
        listing.paidAt = undefined;
        listing.paymentVerifiedAt = undefined;
        listing.paymentVerifiedBy = undefined;
        listing.escrowBuyerId = undefined;
        listing.releasedAt = undefined;
        listing.sellerPaidAt = undefined;
        listing.sellerPaidBy = undefined;
        listing.credentialsWiped = false;
        await listing.save();
        try { await restoreChannelListingButtons(listing); } catch (e) { /* ignore */ }
        answer('Escrow cancelled, listing reverted to AVAILABLE.');
        edit(`❌ <b>ESCROW CANCELLED</b> — listing ${shortId(lid)} reverted to AVAILABLE.`, { reply_markup: undefined });
        return;
      }
      if (raw.startsWith('delete_listing_')) {
        const lid = raw.slice(15);
        const listing = await Listing.findById(lid);
        if (!listing) { answer('Not found', true); return; }
        if (String(listing.sellerId) !== String(user._id) && !isAdminTelegramId(user.telegramId)) { answer('Not yours', true); return; }
        listing.status = 'deleted';
        await listing.save();
        try { await updateChannelListingStatus(listing, '🗑️ REMOVED'); } catch (e) { /* */ }
        answer('🗑️ Deleted');
        edit(`🗑️ <b>LISTING DELETED</b> — ID: <code>${shortId(lid)}</code>`, { reply_markup: undefined });
        return;
      }

      switch (raw) {
        case 'browse': answer(); await browseAndShow(chatId, {}); return;
        case 'search': answer(); setSession(chatId, 'search_query', {}); bot.sendMessage(chatId, '🔍 Enter search keyword:'); return;
        case 'sell':
          if (user.status === 'banned') { answer('Banned', true); return; }
          if (user.role === 'buyer') { user.role = 'seller'; await user.save(); }
          answer();
          startCreateListingFlow(chatId);
          return;
        case 'my_listings': answer(); await showMyListings(chatId, user); return;
        case 'help':
          answer();
          bot.sendMessage(chatId,
            `<tg-emoji emoji-id="6100340203119971469">🔥</tg-emoji> <b>AuraShop Commands</b>\n\n` +
            `<b>Everyone:</b>\n` +
            `  /start    — Welcome + menu\n` +
            `  /menu     — Main menu\n` +
            `  /sell     — Create a new listing\n` +
            `  /browse   — Browse market\n` +
            `  /search &lt;keyword&gt;\n\n` +
            `<b>During a deal:</b>\n` +
            `  /paid &lt;id&gt;    — (Buyer) Upload payment proof\n` +
            `  /deliver &lt;id&gt; — (Seller) Update creds (optional)\n\n` +
            `<b>Admin:</b>\n` +
            `  /admin    — Pending reviews + active escrows\n\n` +
            `<b>Escrow Flow:</b>\n` +
            `1️⃣ Seller lists (includes credentials) → Admin approves → Channel post with BUY button\n` +
            `2️⃣ Buyer clicks BUY → sees payment methods + precautions\n` +
            `3️⃣ Buyer uploads receipt (→ admin chat)\n` +
            `4️⃣ Admin verifies payment → taps RELEASE → creds sent to buyer, <b>creds WIPED from DB</b>\n` +
            `5️⃣ Admin sends payout to seller → taps MARK SELLER PAID → listing set to SOLD`,
            { parse_mode: 'HTML' },
          );
          return;
        case 'admin_panel':
          if (!isAdminTelegramId(cb.from.id)) { answer('Admin only', true); return; }
          answer();
          await showAdminPanel(chatId);
          return;
      }
    } catch (err) {
      console.error('callback_query error:', err);
      answer('❌ Something went wrong', true);
    }
  });

  return bot;
};

module.exports = { initTelegramBot };
