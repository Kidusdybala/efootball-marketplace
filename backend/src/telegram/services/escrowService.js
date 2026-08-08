const User = require('../../models/User');
const Listing = require('../../models/Listing');
const AccountCredentials = require('../../models/AccountCredentials');
const { formatMoney } = require('../../utils/money');
const { shortId, getAdminChatIds, LEGACY_SERVICE_FEE_RATE } = require('../helpers');
const { escrowStatusBadge } = require('../formatters');
const { escrowAdminKeyboard } = require('../keyboards');
const { updateChannelListingStatus } = require('./channelService');
const { getBot } = require('../botInstance');

const notifyAdminEscrowUpdate = async (listing, actionNote) => {
  const bot = getBot();
  const adminChatIds = getAdminChatIds();
  if (!adminChatIds.length) return;
  const [seller, buyer] = await Promise.all([
    listing.sellerId ? User.findById(listing.sellerId) : null,
    listing.escrowBuyerId ? User.findById(listing.escrowBuyerId) : null,
  ]);

  const bothIn = Boolean(listing.paidAt && listing.credentialsSubmittedAt);

  const text =
    `🔔 <b>ESCROW UPDATE</b>\n\n` +
    `🏷️ ${listing.title}\n` +
    `💸 Agreed Price: <b>${formatMoney(listing.price, listing.currency)}</b>\n` +
    `Listing ID: <code>${shortId(listing._id)}</code>\n\n` +
    `👤 Seller: @${seller?.username || 'N/A'} (ID: <code>${seller?.telegramId || '?'}</code>)\n` +
    `🛒 Buyer: @${buyer?.username || 'N/A'} (ID: <code>${buyer?.telegramId || '?'}</code>)\n\n` +
    `${escrowStatusBadge(listing)}\n\n` +
    `<i>${actionNote || ''}</i>\n\n` +
    (bothIn ? `<b>⚠️ BOTH RECEIVED — verify payment then release.</b>` : '⏳ Waiting for the other side...');

  if (listing.paidReceiptFileId) {
    for (const adminChatId of adminChatIds) {
      try {
        const opts = { caption: `🧾 PAYMENT RECEIPT for Listing #${shortId(listing._id)}`, parse_mode: 'HTML' };
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
            `🔐 ACCOUNT CREDENTIALS (Preview for Admin)\n\n` +
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

const releaseEscrow = async (adminTgId, listingId) => {
  const bot = getBot();
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
      `🏷️ Listing: <b>${listing.title}</b>\n` +
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
      `🏷️ Listing: <b>${listing.title}</b>\n` +
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

module.exports = {
  notifyAdminEscrowUpdate,
  releaseEscrow,
};
