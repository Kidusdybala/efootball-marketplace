const Listing = require('../../models/Listing');
const AccountCredentials = require('../../models/AccountCredentials');
const { formatMoney } = require('../../utils/money');
const { shortId, calculateAdminFee, getAdminChatIds } = require('../helpers');
const { approveRejectKeyboard } = require('../keyboards');
const { setSession, getSession } = require('../session');
const { getBot } = require('../botInstance');

const startCreateListingFlow = (chatId) => {
  const bot = getBot();
  setSession(chatId, 'create_price', {});
  bot.sendMessage(chatId, 'Create New Listing\n\nStep 1/4: Enter the price in ETB (number only):', {
    parse_mode: 'HTML',
  });
};

const finalizeCreateListingSimple = async (chatId, user, price, imageFileId, creds) => {
  const bot = getBot();
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
  ).catch(() => {});

  const adminChatIds = getAdminChatIds();
  let caption = `NEW LISTING PENDING REVIEW\n\nFrom: @${seller.username}\nBuyer Pays: ${formatMoney(totalPrice)}\nSeller Gets: ${formatMoney(price)}\nCredentials: INCLUDED (encrypted)\nListing ID: ${shortId(listing._id)}`;
  for (const adminChatId of adminChatIds) {
    if (!adminChatId) continue;
    if (imageFileId) {
      try {
        await bot.sendPhoto(adminChatId, imageFileId, { caption: caption, parse_mode: 'HTML', reply_markup: approveRejectKeyboard(listing._id) });
      } catch (e) {
        bot.sendMessage(adminChatId, caption, { parse_mode: 'HTML', reply_markup: approveRejectKeyboard(listing._id) }).catch(() => {});
      }
    } else {
      bot.sendMessage(adminChatId, caption, { parse_mode: 'HTML', reply_markup: approveRejectKeyboard(listing._id) }).catch(() => {});
    }
  }
};

const handleCreateListingState = async (chatId, user, text) => {
  const bot = getBot();
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
  }
  return false;
};

module.exports = {
  startCreateListingFlow,
  handleCreateListingState,
  finalizeCreateListingSimple,
};
