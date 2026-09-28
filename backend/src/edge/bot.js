/**
 * Telegram Bot Webhook Handler
 * Converted from polling-based bot.js (1277 lines) to webhook-based for Cloudflare Workers
 * Uses fetch() for Telegram API calls instead of node-telegram-bot-api
 * Uses Workers KV for session storage instead of in-memory Map
 */

import * as Telegram from '../telegram.js';
import { setSession, getSession, clearSession } from '../session.js';
import { encrypt, decrypt } from '../crypto.js';
import { formatMoney } from '../utils/money.js';
import User from '../models/User.js';
import Listing from '../models/Listing.js';
import AccountCredentials from '../models/AccountCredentials.js';
import Transaction from '../models/Transaction.js';
import Notification from '../models/Notification.js';
import Message from '../models/Message.js';
import PaymentMethod from '../models/PaymentMethod.js';

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

const escapeHtml = (text) => {
  if (!text) return '';
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

const shortId = (id) => String(id).slice(-8);

const PLATFORMS = ['Android', 'iOS', 'Steam', 'PlayStation', 'Xbox', 'PC', 'Cross-Platform'];

function statusEmoji(s) {
  const map = {
    available: '<tg-emoji emoji-id="6100340203119971469">🔥</tg-emoji> AVAILABLE',
    reserved: '<tg-emoji emoji-id="5368324170671202289">🟡</tg-emoji> RESERVED',
    sold: '<tg-emoji emoji-id="5368324170671202288">🔴</tg-emoji> SOLD',
    pending_review: '<tg-emoji emoji-id="5368324170671202289">⏳</tg-emoji> PENDING REVIEW',
    rejected: '<tg-emoji emoji-id="6100670215522094562">❌</tg-emoji> REJECTED',
    deleted: '<tg-emoji emoji-id="5368324170671202289">🗑️</tg-emoji> DELETED',
    approved: '<tg-emoji emoji-id="5472100166909577091">✅</tg-emoji> APPROVED',
    waiting_escrow: '<tg-emoji emoji-id="5368324170671202290">🤝</tg-emoji> DEAL AGREED',
    paid_submitted: '<tg-emoji emoji-id="5368324170671202293">🧾</tg-emoji> PAID (PROOF)',
    creds_submitted: '<tg-emoji emoji-id="5368324170671202294">🔐</tg-emoji> CREDS IN',
    released: '<tg-emoji emoji-id="5368324170671202290">🎉</tg-emoji> RELEASED',
  };
  return map[s] || String(s).toUpperCase();
}

function escrowStatusBadge(l) {
  const parts = [];
  if (l.paidAt || l.status === 'paid_submitted' || l.status === 'creds_submitted') parts.push('PAID: ' + (l.paidAt ? 'YES' : 'NO'));
  if (l.paymentVerifiedAt) parts.push('VERIFIED: YES');
  if (l.credentialsSubmittedAt || l.status === 'creds_submitted') parts.push('CREDS: ' + (l.credentialsSubmittedAt ? 'YES' : 'NO'));
  if (l.releasedAt) parts.push('RELEASED');
  if (l.sellerPaidAt) parts.push('SELLER PAID');
  return parts.length ? parts.join(' | ') : 'Waiting for buyer/seller...';
}

function formatListingCard(listing, seller) {
  const lines = [];
  lines.push(`${statusEmoji(listing.status)}`);
  lines.push(`<b>${listing.title}</b>`);
  lines.push(`<tg-emoji emoji-id="6100340203119971469">🏦</tg-emoji> <b>Price:</b> ${formatMoney(listing.price, listing.currency)}${listing.negotiable ? ' <i>(Negotiable)</i>' : ''}`);
  lines.push(`<tg-emoji emoji-id="6102684181521763740">💠</tg-emoji> <b>Platform:</b> ${listing.platform}`);
  if (listing.overall) lines.push(`<tg-emoji emoji-id="5368324170671202294">⭐️</tg-emoji> <b>Team Overall:</b> ${listing.overall}`);
  if (listing.teamName) lines.push(`<tg-emoji emoji-id="5368324170671202294">🛡️</tg-emoji> <b>Team:</b> ${listing.teamName}`);
  if (listing.featuredPlayers?.length) lines.push(`<tg-emoji emoji-id="5368324170671202294">🌟</tg-emoji> <b>Featured:</b> ${listing.featuredPlayers.slice(0, 3).join(', ')}`);
  if (seller) {
    const verified = seller.isVerified ? ' <tg-emoji emoji-id="5472100166909577091">✅</tg-emoji> <b>[VERIFIED]</b>' : '';
    lines.push(`\n<tg-emoji emoji-id="6100651927551348857">😎</tg-emoji> <b>Seller:</b> @${seller.username}${verified}`);
  }
  lines.push(`\n<tg-emoji emoji-id="5368324170671202289">📝</tg-emoji> <b>Description:</b>`);
  lines.push(`<i>${listing.description}</i>`);
  lines.push(`\n<tg-emoji emoji-id="5368324170671202289">📅</tg-emoji> <b>Listed:</b> ${new Date(listing.createdAt).toLocaleDateString()}`);
  lines.push(`<tg-emoji emoji-id="6102684181521763740">💠</tg-emoji> <b>Listing ID:</b> <code>${shortId(listing._id)}</code>`);
  return lines.join('\n');
}

function formatChannelListingCard(listing) {
  return `<tg-emoji emoji-id="6100340203119971469">🏦</tg-emoji> <b>Price:</b> ${formatMoney(listing.price, listing.currency)}`;
}

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
    rows.push([{ text: 'MARK SELLER PAID 💸', callback_data: `mark_seller_paid_${lid}` }]);
  }
  if (!listing.releasedAt) {
    rows.push([{ text: 'Cancel Escrow', callback_data: `cancel_escrow_${lid}` }]);
  }
  if (!rows.length) rows.push([{ text: 'Waiting for updates...', callback_data: 'noop' }]);
  return { inline_keyboard: rows };
};

async function getOrCreateUser(tgUser, chatId) {
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
      let user = await User.findOne({ telegramId: String(tgUser.id) });
      if (user) return await updateFields(user);
    }
    throw error;
  }
}

async function findListingByShortOrFullId(idArg) {
  if (!idArg) return null;
  const s = idArg.trim();
  if (/^[0-9a-fA-F]{24}$/.test(s)) {
    const found = await Listing.findById(s, { populate: 'sellerId escrowBuyerId' });
    if (found) return found;
  }
  const all = await Listing.find({}, { populate: 'sellerId escrowBuyerId' });
  return all.find(l => String(l._id).slice(-s.length) === s) || null;
}

async function showMainMenu(env, chatId, user) {
  await Telegram.sendMessage(chatId,
    '<tg-emoji emoji-id="5368324170671202286">✨</tg-emoji> <b>AuraShop Main Menu</b>\n\nChoose an option below or use a command:\n/menu /sell /browse /search /paid /admins /deliver',
    { parse_mode: 'HTML', reply_markup: mainMenuKeyboard(user) },
  );
}

async function startCreateListingFlow(env, chatId) {
  await setSession(env, chatId, 'create_price', {});
  await Telegram.sendMessage(chatId, 'Create New Listing\n\nStep 1/4: Enter the price in ETB (number only):', {
    parse_mode: 'HTML',
  });
}

async function handleCreateListingState(env, chatId, user, text) {
  const session = await getSession(env, chatId);
  if (!session) return false;
  const d = session.data;

  switch (session.state) {
    case 'create_price': {
      const price = Number(text);
      if (!Number.isFinite(price) || price < 0) {
        await Telegram.sendMessage(chatId, 'ERROR: Invalid price. Enter a number (e.g. 150).');
        return true;
      }
      d.price = price;
      await setSession(env, chatId, 'create_creds_email', d);
      await Telegram.sendMessage(chatId, 'Step 2/4: Send the account EMAIL (encrypted & admin-only):', { parse_mode: 'HTML' });
      return true;
    }

    case 'create_creds_email': {
      if (!text.includes('@')) { await Telegram.sendMessage(chatId, 'ERROR: Invalid email. Try again:'); return true; }
      d.email = text.trim();
      await setSession(env, chatId, 'create_creds_password', d);
      await Telegram.sendMessage(chatId, 'Step 3/4: Send the account PASSWORD (encrypted & admin-only):', { parse_mode: 'HTML' });
      return true;
    }

    case 'create_creds_password': {
      if (text.length < 3) { await Telegram.sendMessage(chatId, 'ERROR: Password too short. Try again:'); return true; }
      d.password = text;
      await setSession(env, chatId, 'create_image', d);
      await Telegram.sendMessage(chatId, 'Step 4/4: Now send a photo/screenshot of your team account:', { parse_mode: 'HTML' });
      return true;
    }

    case 'search_query':
      await clearSession(env, chatId);
      await browseAndShow(env, chatId, { search: text });
      return true;
  }
  return false;
}

async function finalizeCreateListingSimple(env, chatId, user, price, imageFileId, creds) {
  const adminFee = calculateAdminFee(price);
  const totalPrice = price + adminFee;

  const listing = await Listing.create({
    sellerId: user._id,
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
  if (creds?.email) { await accountCreds.setEmail(creds.email); }
  if (creds?.password) { await accountCreds.setPassword(creds.password); }
  if (creds?.additionalInfo) { await accountCreds.setAdditionalInfo(creds.additionalInfo); }
  await accountCreds.save();

  await Telegram.sendMessage(chatId,
    `Listing Submitted!\n\nPrice: ${formatMoney(price)}\nYour listing has been sent to admin for review.\nListing ID: <code>${shortId(listing._id)}</code>`,
    { parse_mode: 'HTML' },
  );

  const adminChatIds = getAdminChatIds();
  let caption = `NEW LISTING PENDING REVIEW\n\nFrom: @${user.username}\nBuyer Pays: ${formatMoney(totalPrice)}\nSeller Gets: ${formatMoney(price)}\nCredentials: INCLUDED (encrypted)\nListing ID: ${shortId(listing._id)}`;
  for (const adminChatId of adminChatIds) {
    if (!adminChatId) continue;
    if (imageFileId) {
      try {
        await Telegram.sendPhoto(adminChatId, imageFileId, { caption: caption, parse_mode: 'HTML', reply_markup: approveRejectKeyboard(listing._id) });
      } catch (e) {
        await Telegram.sendMessage(adminChatId, caption, { parse_mode: 'HTML', reply_markup: approveRejectKeyboard(listing._id) });
      }
    } else {
      await Telegram.sendMessage(adminChatId, caption, { parse_mode: 'HTML', reply_markup: approveRejectKeyboard(listing._id) });
    }
  }
}

async function publishListingToChannel(listing, seller) {
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  if (!channelId) return null;

  const botUsername = process.env.TELEGRAM_BOT_USERNAME;
  const buyUrl = botUsername ? `https://t.me/${botUsername}?start=buy_${listing._id}` : null;

  const row = [...(buyUrl ? [{ text: 'BUY', url: buyUrl }] : [])];
  const reply_markup = { inline_keyboard: [row] };

  try {
    const imageFileId = listing.images?.[0];
    const sent = imageFileId
      ? await Telegram.sendPhoto(channelId, imageFileId, { caption: formatChannelListingCard(listing), parse_mode: 'HTML', reply_markup })
      : await Telegram.sendMessage(channelId, formatChannelListingCard(listing), { parse_mode: 'HTML', reply_markup });

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
}

async function restoreChannelListingButtons(listing) {
  if (!listing.channelMessageId) return;
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  if (!channelId) return;
  const botUsername = process.env.TELEGRAM_BOT_USERNAME;
  const buyUrl = botUsername ? `https://t.me/${botUsername}?start=buy_${listing._id}` : null;
  const contactAdminUrl = botUsername ? `https://t.me/${botUsername}?start=contact_${listing._id}` : null;
  const row = [...(buyUrl ? [{ text: 'BUY', url: buyUrl }] : []), ...(contactAdminUrl ? [{ text: 'CONTACT ADMIN', url: contactAdminUrl }] : [])];
  if (!row.length) return;
  try {
    await Telegram.editMessageReplyMarkup(
      { inline_keyboard: [row] },
      { chat_id: channelId, message_id: Number(listing.channelMessageId) },
    );
  } catch (e) { /* ignore */ }
}

async function updateChannelListingStatus(listing, text) {
  if (!listing.channelMessageId) return;
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  if (!channelId) return;
  try {
    await Telegram.editMessageReplyMarkup(
      { inline_keyboard: [[{ text: text || '🔴 NO LONGER AVAILABLE', callback_data: 'noop' }]] },
      { chat_id: channelId, message_id: Number(listing.channelMessageId) },
    );
  } catch (e) { /* ignore */ }
}

async function browseAndShow(env, chatId, filters = {}, offset = 0) {
  const filter = { ...filters };
  const sort = { createdAt: -1 };
  let listings;
  try {
    const all = await Listing.searchListings(filter);
    all.sort((a, b) => (new Date(b.createdAt)) - (new Date(a.createdAt)));
    listings = all.slice(offset, offset + 5);
  } catch (e) {
    console.error('browseAndShow error:', e);
    await Telegram.sendMessage(chatId, '😕 Error browsing listings.');
    return;
  }
  if (!listings.length) {
    await Telegram.sendMessage(chatId, '😕 No listings found. Try different filters.');
    return;
  }
  for (const listing of listings) {
    const kbRows = [];
    const botUsername = process.env.TELEGRAM_BOT_USERNAME;
    const buyUrl = botUsername ? `https://t.me/${botUsername}?start=buy_${listing._id}` : null;
    const contactAdminUrl = botUsername ? `https://t.me/${botUsername}?start=contact_${listing._id}` : null;
    const row = [...(buyUrl ? [{ text: 'BUY', url: buyUrl }] : []), ...(contactAdminUrl ? [{ text: 'CONTACT ADMIN', url: contactAdminUrl }] : [])];
    if (row.length) kbRows.push(row);
    kbRows.push([{ text: '📌 Listing ID: ' + shortId(listing._id), callback_data: 'noop' }]);

    await Telegram.sendMessage(chatId, formatListingCard(listing, null), {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: kbRows },
    });
  }
  if (listings.length >= 5) {
    await Telegram.sendMessage(chatId, '<tg-emoji emoji-id="6100340203119971469">🔥</tg-emoji> Use <code>/browse</code> to see more or <code>/search &lt;keyword&gt</code>', { parse_mode: 'HTML' });
  }
}

async function showMyListings(env, chatId, user) {
  const mine = await Listing.find({ sellerId: user._id }).sort({ createdAt: -1 }).limit(20);
  if (!mine.length) {
    await Telegram.sendMessage(chatId, '📦 You have no listings yet. Use /sell to create one!');
    return;
  }
  for (const l of mine) {
    const adminKb = [];
    if (['pending_review', 'approved', 'available', 'waiting_escrow', 'paid_submitted', 'creds_submitted'].includes(l.status)) {
      adminKb.push([{ text: '🗑️ Delete Listing', callback_data: `delete_listing_${l._id}` }]);
    }
    await Telegram.sendMessage(chatId,
      `<b>${statusEmoji(l.status)}</b>\n<tg-emoji emoji-id="6102684181521763740">💠</tg-emoji> ${l.title}\n<tg-emoji emoji-id="5961054379350955385">🏦</tg-emoji> ${formatMoney(l.price, l.currency)} | <tg-emoji emoji-id="6102684181521763740">💠</tg-emoji> ${l.platform}\n\n` +
      `ID: <code>${shortId(l._id)}</code>\n${escrowStatusBadge(l)}`,
      { parse_mode: 'HTML', reply_markup: adminKb.length ? { inline_keyboard: adminKb } : undefined },
    );
  }
}

async function notifyAdminEscrowUpdate(env, listing, actionNote) {
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
        const opts = { caption: `<tg-emoji emoji-id="5961015849199342153">🏦</tg-emoji> PAYMENT RECEIPT for Listing #${shortId(listing._id)}`, parse_mode: 'HTML' };
        if (listing.paidReceiptType === 'photo') await Telegram.sendPhoto(adminChatId, listing.paidReceiptFileId, opts);
        else if (listing.paidReceiptType === 'document') await Telegram.sendDocument(adminChatId, listing.paidReceiptFileId, opts);
      } catch (e) { /* ignore */ }
    }
  }
  if (bothIn && listing.credentialsSubmittedAt) {
    for (const adminChatId of adminChatIds) {
      try {
        const creds = await AccountCredentials.findOne({ listingId: listing._id });
        if (creds && !listing.credentialsWiped) {
          const dec = await creds.getAllDecrypted();
          const credsText =
            `<tg-emoji emoji-id="5963162821746233777">🏦</tg-emoji> ACCOUNT CREDENTIALS (Preview for Admin)\n\n` +
            `📧 Email: <code>${dec.email || 'N/A'}</code>\n` +
            `🔑 Password: <tg-spoiler>${dec.password || 'N/A'}</tg-spoiler>\n` +
            (dec.additionalInfo ? `📋 Extra: <tg-spoiler>${dec.additionalInfo}</tg-spoiler>\n` : '') +
            `\n<i>These will be WIPED from DB after release.</i>`;
          await Telegram.sendMessage(adminChatId, credsText, { parse_mode: 'HTML' });
        }
      } catch (e) { /* ignore */ }
    }
  }

  for (const adminChatId of adminChatIds) {
    await Telegram.sendMessage(adminChatId, text, {
      parse_mode: 'HTML',
      reply_markup: escrowAdminKeyboard(listing),
    });
  }
}

async function releaseEscrow(env, adminTgId, listingId) {
  const listing = await Listing.findById(listingId, { populate: 'sellerId escrowBuyerId' });
  if (!listing) return { ok: false, err: 'Listing not found' };
  if (!listing.paidAt) return { ok: false, err: 'Payment proof not yet submitted' };
  if (!listing.paymentVerifiedAt) return { ok: false, err: 'Payment not yet verified by admin' };
  if (!listing.credentialsSubmittedAt) return { ok: false, err: 'Credentials not yet submitted by seller' };
  if (listing.releasedAt) return { ok: false, err: 'Already released' };

  const creds = await AccountCredentials.findOne({ listingId: listing._id });
  if (!creds) return { ok: false, err: 'Credentials not found' };
  if (listing.credentialsWiped) return { ok: false, err: 'Credentials already wiped' };

  const decrypted = await creds.getAllDecrypted();

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
    await Telegram.sendMessage(buyerChatId,
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
    await Telegram.sendMessage(sellerChatId,
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
}

async function markSellerPaid(env, listingId) {
  const listing = await Listing.findById(listingId).populate('sellerId escrowBuyerId');
  if (!listing) return;
  listing.sellerPaidAt = new Date();
  listing.sellerPaidBy = null;
  listing.status = 'sold';
  if (!listing.soldTo && listing.escrowBuyerId) listing.soldTo = listing.escrowBuyerId;
  await listing.save();
  const sellerChatId = listing.sellerId?.telegramChatId;
  const buyerChatId = listing.escrowBuyerId?.telegramChatId;
  if (sellerChatId) {
    const adminFee = listing.adminFee !== undefined ? listing.adminFee : listing.price * LEGACY_SERVICE_FEE_RATE;
    const sellerGets = listing.sellerPrice !== undefined ? listing.sellerPrice : listing.price - adminFee;
    await Telegram.sendMessage(sellerChatId,
      `<tg-emoji emoji-id="5961054379350955385">🏦</tg-emoji> <b>PAYOUT SENT</b>\n\n` +
      `<tg-emoji emoji-id="6102684181521763740">💠</tg-emoji> Listing: <b>${listing.title}</b>\n` +
      `You received: <b>${formatMoney(sellerGets, listing.currency)}</b>\n\n` +
      `✅ Admin has marked your payout as completed. Thank you for using AuraShop.`,
      { parse_mode: 'HTML' },
    );
  }
  if (buyerChatId) {
    await Telegram.sendMessage(buyerChatId, '✅ Deal completed. Thank you for buying on AuraShop!');
  }
  return listing;
}

async function showAdminPanel(env, chatId) {
  const pending = await Listing.countDocuments({ status: 'pending_review' });
  const waitingEscrow = await Listing.find({
    status: { $in: ['waiting_escrow', 'paid_submitted', 'creds_submitted'] },
  });
  const activeCount = waitingEscrow.length;

  const lines = [];
  lines.push('🛡️ <b>ADMIN PANEL</b>\n');
  lines.push(`⏳ Pending Review: <b>${pending}</b>`);
  lines.push(`🤝 Active Escrows: <b>${activeCount}</b>`);
  await Telegram.sendMessage(chatId, lines.join('\n'), { parse_mode: 'HTML' });

  if (pending > 0) {
    const pendings = await Listing.find({ status: 'pending_review' }, {}).limit(10);
    for (const l of pendings) {
      let seller = null;
      if (l.sellerId) {
        try { seller = await User.findById(l.sellerId); } catch { /* */ }
      }
      await Telegram.sendMessage(chatId,
        `⏳ PENDING: <b>${l.title}</b>\nFrom @${seller?.username || '?'}\n<tg-emoji emoji-id="5961054379350955385">🏦</tg-emoji> ${formatMoney(l.price, l.currency)} | ID: <code>${shortId(l._id)}</code>`,
        { parse_mode: 'HTML', reply_markup: approveRejectKeyboard(l._id) },
      );
    }
  }
  if (activeCount > 0) {
    for (const l of waitingEscrow) {
      let seller = null;
      let buyer = null;
      if (l.sellerId) { try { seller = await User.findById(l.sellerId); } catch { /* */ } }
      if (l.escrowBuyerId) { try { buyer = await User.findById(l.escrowBuyerId); } catch { /* */ } }
      await Telegram.sendMessage(chatId,
        `🤝 ESCROW #${shortId(l._id)} <b>${l.title}</b>\n` +
        `<tg-emoji emoji-id="5961054379350955385">🏦</tg-emoji> ${formatMoney(l.price, l.currency)} | ${escrowStatusBadge(l)}\n` +
        `@${seller?.username || '?'} → @${buyer?.username || 'N/A'}`,
        { parse_mode: 'HTML', reply_markup: escrowAdminKeyboard(l) },
      );
    }
  }
}

async function sendNotificationToUser(userId, notification) {
  const user = await User.findById(userId);
  if (!user) return;
  if (user.telegramChatId) {
    const text = `${notification.title}\n\n${notification.message}`;
    try {
      await Telegram.sendMessage(user.telegramChatId, text, { parse_mode: 'HTML' });
      notification.telegramSent = true;
    } catch (err) {
      console.error('Telegram notification failed:', err.message);
    }
  }
  await notification.save();
}

// ===================== MAIN WEBHOOK HANDLER =====================

async function handleWebhook(env, update) {
  if (!update) return new Response('OK', { status: 200 });

  try {
    if (update.message) {
      await handleMessage(env, update.message);
    } else if (update.callback_query) {
      await handleCallbackQuery(env, update.callback_query);
    } else if (update.channel_post) {
      // Channel post handling (optional)
    }
    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('Webhook handler error:', err);
    return new Response('OK', { status: 200 });
  }
}

async function handleMessage(env, msg) {
  const chatId = msg.chat?.id;
  if (!chatId) return;

  const user = await getOrCreateUser(msg.from, chatId);

  if (msg.photo) {
    await handlePhoto(env, msg, user);
    return;
  }
  if (msg.document) {
    await handleDocument(env, msg, user);
    return;
  }

  if (msg.entities) {
    const customEmojis = msg.entities.filter(e => e.type === 'custom_emoji');
    if (customEmojis.length > 0 && isAdminTelegramId(msg.from.id)) {
      const ids = customEmojis.map(e => e.custom_emoji_id).join('\n');
      await Telegram.sendMessage(chatId, `Custom Emoji IDs:\n<code>${ids}</code>`, { parse_mode: 'HTML' });
      return;
    }
  }

  const text = msg.text;
  if (!text) return;
  if (text.startsWith('/')) {
    await handleCommand(env, msg, user, text);
    return;
  }

  const session = await getSession(env, chatId);
  if (!session) return;

  const handled = await handleCreateListingState(env, chatId, user, text);
  if (handled) return;

  const d = session.data;

  switch (session.state) {
    case 'paid_listing_id': {
      await clearSession(env, chatId);
      const listing = await findListingByShortOrFullId(text);
      if (!listing) { await Telegram.sendMessage(chatId, '❌ Listing not found.'); return; }
      listing.escrowBuyerId = user._id;
      if (listing.status === 'available') listing.status = 'waiting_escrow';
      await listing.save();
      try { await updateChannelListingStatus(listing, '🟡 RESERVED'); } catch (e) { /* ignore */ }
      await setSession(env, chatId, 'paid_receipt_upload', { listingId: String(listing._id) });
      await Telegram.sendMessage(chatId,
        `<tg-emoji emoji-id="5961015849199342153">🏦</tg-emoji> <b>Payment Proof</b>\n\nListing: <b>${listing.title}</b> (${formatMoney(listing.price, listing.currency)})\n\nNow send a photo or document of your payment receipt.`,
        { parse_mode: 'HTML' },
      );
      return;
    }
    case 'deliver_listing_id': {
      await clearSession(env, chatId);
      const listing = await findListingByShortOrFullId(text);
      if (!listing) { await Telegram.sendMessage(chatId, '❌ Listing not found.'); return; }
      if (String(listing.sellerId) !== String(user._id) && !isAdminTelegramId(user.telegramId)) {
        await Telegram.sendMessage(chatId, '❌ Only the seller can deliver credentials for this listing.');
        return;
      }
      await setSession(env, chatId, 'deliver_email', { listingId: String(listing._id) });
      await Telegram.sendMessage(chatId, `<tg-emoji emoji-id="5963162821746233777">🏦</tg-emoji> <b>Deliver Credentials for "${listing.title}"</b> (1/4)\n\nSend the account <b>EMAIL</b>:`, { parse_mode: 'HTML' });
      return;
    }
    case 'deliver_email': {
      if (!text.includes('@')) { await Telegram.sendMessage(chatId, '❌ Invalid email.'); return; }
      d.email = text;
      await setSession(env, chatId, 'deliver_password', d);
      await Telegram.sendMessage(chatId, '<tg-emoji emoji-id="5963162821746233777">🏦</tg-emoji> (2/4) Send the account <b>PASSWORD</b>: (encrypted & admin-only)', { parse_mode: 'HTML' });
      return;
    }
    case 'deliver_password': {
      if (text.length < 3) { await Telegram.sendMessage(chatId, '❌ Password too short.'); return; }
      d.password = text;
      await setSession(env, chatId, 'deliver_extra', d);
      await Telegram.sendMessage(chatId, '<tg-emoji emoji-id="5963162821746233777">🏦</tg-emoji> (3/4) Send any extra info: backup codes / 2FA seed / recovery email, or type <code>done</code>:', { parse_mode: 'HTML' });
      return;
    }
    case 'deliver_extra': {
      if (text && text.toLowerCase() !== 'done') d.extra = text;
      const listing = await Listing.findById(d.listingId);
      if (!listing) { await clearSession(env, chatId); return; }
      let creds = await AccountCredentials.findOne({ listingId: listing._id });
      if (!creds) creds = await AccountCredentials.create({ listingId: listing._id });
      await creds.setEmail(d.email);
      await creds.setPassword(d.password);
      if (d.extra) await creds.setAdditionalInfo(d.extra);
      await creds.save();

      listing.credentialsSubmittedAt = new Date();
      listing.credentialsWiped = false;
      if (['available', 'waiting_escrow', 'paid_submitted'].includes(listing.status)) {
        listing.status = 'creds_submitted';
      }
      await listing.save();
      await clearSession(env, chatId);

      await Telegram.sendMessage(chatId,
        `✅ Credentials RECEIVED and encrypted. Sent to admin.\n\nOnce the buyer submits payment proof and admin verifies the payment actually arrived, admin will release the credentials to the buyer and confirm to you.`,
      );
      await notifyAdminEscrowUpdate(env, listing, `<tg-emoji emoji-id="5963162821746233777">🏦</tg-emoji> Seller @${user.username || '?'} just submitted account credentials.`);
      return;
    }
    case 'contact_admin_message': {
      await clearSession(env, chatId);
      const listing = await Listing.findById(d.listingId);
      if (!listing) { await Telegram.sendMessage(chatId, '❌ Listing not found.'); return; }
      const adminChatIds = getAdminChatIds();
      for (const adminChatId of adminChatIds) {
        await Telegram.sendMessage(adminChatId,
          `💬 <b>NEW MESSAGE TO ADMINS</b>\n\nFrom: @${user.username || 'N/A'} (TG ID: <code>${user.telegramId}</code>)\nListing: <b>${listing.title}</b>\nPrice: <b>${formatMoney(listing.price, listing.currency)}</b>\nListing ID: <code>${shortId(listing._id)}</code>\n\nMessage:\n${text}`,
          { parse_mode: 'HTML' },
        );
      }
      await Telegram.sendMessage(chatId, '✅ Message sent to admins. Please wait for their response here.');
      return;
    }
    case 'buy_listing': {
      const listing = await findListingByShortOrFullId(d.listingId);
      if (!listing) { await Telegram.sendMessage(chatId, '❌ Listing not found.'); return; }
      const paymentMethod = String(text).trim().replace('pm_', '');
      let paymentMethodSelected = null;
      try {
        paymentMethodSelected = await PaymentMethod.findOne({ callback_data: paymentMethod });
      } catch (e) { /* */ }

      if (!paymentMethodSelected) {
        await Telegram.sendMessage(chatId, '❌ Invalid payment method.');
        return;
      }

      const buyer = user;
      const buyerPrice = listing.price;
      const serviceFee = Math.round(buyerPrice * 0.05 * 100) / 100;
      const totalAmount = buyerPrice + serviceFee;

      await setSession(env, chatId, 'paid_payment_confirm', {
        listingId: String(listing._id),
        paymentMethodId: String(paymentMethodSelected._id),
      });

      let summary = `You selected: <b>${listing.title}</b>\n\n<b>Payment Summary:</b>\nItem price: ${formatMoney(listing.price, listing.currency)}\nService fee (5%): ${formatMoney(serviceFee, listing.currency)}\n<b>Total: ${formatMoney(totalAmount, listing.currency)}</b>\n\n<b>Payment Method:</b> ${paymentMethodSelected.name}\n`;

      let account = paymentMethodSelected.account || '';
      if (account) {
        summary += `\n<b>Account:</b> <code>${account}</code>\n`;
      }
      let holder = paymentMethodSelected.holder || '';
      if (holder) {
        summary += `<b>Holder (account name on file):</b> <code>${holder}</code>\n`;
      }
      summary += `\n⚠️ <b>IMPORTANT:</b> After sending payment, send the receipt here (photo or document).\n`;

      await Telegram.sendMessage(chatId, summary, { parse_mode: 'HTML' });
      return;
    }
    case 'paid_payment_confirm': {
      const listingId = d.listingId;
      const listing = await Listing.findById(listingId);
      if (!listing) { await Telegram.sendMessage(chatId, '❌ Listing not found.'); return; }
      const userObj = await User.findById(user._id);
      if (!userObj) return;
      listing.escrowBuyerId = userObj._id;
      if (listing.status === 'available') listing.status = 'waiting_escrow';
      await listing.save();
      await setSession(env, chatId, 'paid_receipt_upload', { listingId: String(listing._id) });
      await Telegram.sendMessage(chatId,
        `<tg-emoji emoji-id="5961015849199342153">🏦</tg-emoji> <b>Payment Proof</b>\n\nListing: <b>${listing.title}</b> (${formatMoney(listing.price, listing.currency)})\n\nNow send a photo or document of your payment receipt.`,
        { parse_mode: 'HTML' },
      );
      return;
    }
  }
}

async function handleCommand(env, msg, user, text) {
  const chatId = msg.chat.id;
  const cmdMatch = text.match(/^\/(\w+)(.*)/);
  if (!cmdMatch) return;
  const cmd = cmdMatch[1].toLowerCase();
  const args = cmdMatch[2]?.trim() || '';

  switch (cmd) {
    case 'start': {
      const startPayload = args;
      if (startPayload.startsWith('buy_')) {
        const listingId = startPayload.slice(4);
        const listing = await findListingByShortOrFullId(listingId);
        if (!listing) { await Telegram.sendMessage(chatId, '❌ Listing not found (or already sold/deleted).'); return; }
        if (['sold', 'deleted', 'rejected'].includes(listing.status)) { await Telegram.sendMessage(chatId, '❌ This listing is not available.'); return; }
        if (listing.escrowBuyerId && String(listing.escrowBuyerId) !== String(user._id) && !isAdminTelegramId(user.telegramId)) {
          await Telegram.sendMessage(chatId, '⏳ This listing is currently being processed by another buyer. Please contact admin.');
          return;
        }
        let banks = [];
        try {
          banks = await PaymentMethod.find({ isActive: true }).sort({ createdAt: 1 });
        } catch (e) { banks = []; }

        let summary = `You selected: <b>${listing.title}</b>\n\n<b>Please select your payment method:</b>\n\n`;
        if (!banks.length) {
          await Telegram.sendMessage(chatId,
            summary +
            `<b>ሕጋዊ ማስጠንቀቂያ</b>\n` +
            `በክፍያ ይህን ያረጋግጡ፡ ከ18 አመት በላይ ነዎት እና የእኛን ውሎች እና መመሪያዎች ይቀበላሉ፡\n\nለክፍያ ዝርዝር ለማግኘት አስተዳዳሪውን ያነጋግሩ።`,
            { parse_mode: 'HTML' },
          );
          return;
        }

        const rows = [];
        for (let i = 0; i < banks.length; i++) {
          const btn = { text: banks[i].name, callback_data: `buy_pm_${banks[i].callback_data}` };
          if (banks[i].icon_custom_emoji_id && banks[i].icon_custom_emoji_id !== 'ENTER_ID_HERE' && banks[i].icon_custom_emoji_id.trim() !== '') {
            summary += `<tg-emoji emoji-id="${banks[i].icon_custom_emoji_id}">-</tg-emoji> <b>${banks[i].name}</b>\n`;
          } else {
            summary += `- <b>${banks[i].name}</b>\n`;
          }
          rows.push([btn]);
        }
        summary += `\n<i>Tap a button below to proceed ⬇️</i>`;
        rows.push([{ text: '🔙 Back', callback_data: `delete_msg` }]);
        await setSession(env, chatId, 'buy_listing', { listingId: String(listing._id) });
        await Telegram.sendMessage(chatId, summary, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: rows },
        });
        return;
      }

      if (startPayload.startsWith('contact_')) {
        const listingId = startPayload.slice(8);
        const listing = await findListingByShortOrFullId(listingId);
        if (!listing) { await Telegram.sendMessage(chatId, '❌ Listing not found (or already sold/deleted).'); return; }
        await setSession(env, chatId, 'contact_admin_message', { listingId: String(listing._id) });
        await Telegram.sendMessage(chatId,
          `💬 <b>Contact Admin</b>\n\nListing: <b>${listing.title}</b>\nPrice: <b>${formatMoney(listing.price, listing.currency)}</b>\nListing ID: <code>${shortId(listing._id)}</code>\n\nSend your message now. Admins will contact you directly.`,
          { parse_mode: 'HTML' },
        );
        return;
      }

      const adminBadge = isAdminTelegramId(msg.from.id) ? '\n<tg-emoji emoji-id="6102638354220716294">🛡️</tg-emoji> <b>ADMIN ACCOUNT</b>' : '';
      await Telegram.sendMessage(chatId,
        `<tg-emoji emoji-id="6100651927551348857">👋</tg-emoji> Welcome <b>${escapeHtml(user.firstName || user.username)}</b> to <b>AuraShop EFootball Marketplace!</b>${adminBadge}\n\n` +
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
      await showMainMenu(env, chatId, user);
      break;
    }
    case 'menu':
    case 'home':
    case 'help':
      await showMainMenu(chatId, user);
      break;
    case 'browse':
    case 'buy':
      await browseAndShow(env, chatId, {});
      break;
    case 'admins':
      await Telegram.sendMessage(chatId,
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
        `<tg-emoji emoji-id="5368324170671202289">🔔</tg-emoji> Write to all admins now and save their contacts to avoid being deceived. <tg-emoji emoji-id="5368324170671202290">✅</tg-emoji>`,
        { parse_mode: 'HTML' },
      );
      break;
    case 'search':
      if (args) {
        await browseAndShow(env, chatId, { search: args });
      } else {
        await setSession(env, chatId, 'search_query', {});
        await Telegram.sendMessage(chatId, '🔍 Enter search keyword (player, team, platform, price...):');
      }
      break;
    case 'sell':
      if (user.status === 'banned') { await Telegram.sendMessage(chatId, '❌ Your account is banned.'); return; }
      if (user.role === 'buyer') { user.role = 'seller'; await user.save(); }
      await startCreateListingFlow(env, chatId);
      break;
    case 'paid':
      if (!args) {
        await setSession(env, chatId, 'paid_listing_id', {});
        await Telegram.sendMessage(chatId, '<tg-emoji emoji-id="5961015849199342153">🏦</tg-emoji> <b>Submit Payment Proof</b>\n\nStep 1/2: Enter the <b>Listing ID</b> (the short code, e.g. <code>a3f21b90</code>):', { parse_mode: 'HTML' });
        return;
      }
      const paidListing = await findListingByShortOrFullId(args);
      if (!paidListing) { await Telegram.sendMessage(chatId, '❌ Listing not found. Check the ID and try again.'); return; }
      await setSession(env, chatId, 'paid_receipt_upload', { listingId: String(paidListing._id) });
      paidListing.escrowBuyerId = user._id;
      if (paidListing.status === 'available') paidListing.status = 'waiting_escrow';
      await paidListing.save();
      try { await updateChannelListingStatus(paidListing, '🟡 RESERVED'); } catch (e) { /* ignore */ }
      await Telegram.sendMessage(chatId,
        `<tg-emoji emoji-id="5961015849199342153">🏦</tg-emoji> <b>Payment Proof - Step 2/2</b>\n\n` +
        `Listing: <b>${paidListing.title}</b> (${formatMoney(paidListing.price, paidListing.currency)})\n\n` +
        `Now <b>send a photo or document</b> (screenshot/PDF) proving your payment to admin. Mobile money/Bank transfer/PayPal receipt — whatever works.`,
        { parse_mode: 'HTML' },
      );
      break;
    case 'deliver':
      if (!args) {
        await setSession(env, chatId, 'deliver_listing_id', {});
        await Telegram.sendMessage(chatId, '<tg-emoji emoji-id="5963162821746233777">🏦</tg-emoji> <b>Deliver Credentials</b>\n\nStep 1/4: Enter the <b>Listing ID</b>:', { parse_mode: 'HTML' });
        return;
      }
      const deliverListing = await findListingByShortOrFullId(args);
      if (!deliverListing) { await Telegram.sendMessage(chatId, '❌ Listing not found.'); return; }
      if (String(deliverListing.sellerId) !== String(user._id) && !isAdminTelegramId(user.telegramId)) {
        await Telegram.sendMessage(chatId, '❌ Only the seller of this listing can deliver credentials.');
        return;
      }
      await setSession(env, chatId, 'deliver_email', { listingId: String(deliverListing._id) });
      await Telegram.sendMessage(chatId, `<tg-emoji emoji-id="5963162821746233777">🏦</tg-emoji> <b>Deliver Credentials for "${deliverListing.title}"</b> (2/4)\n\nSend the account <b>EMAIL</b>:`, { parse_mode: 'HTML' });
      break;
    case 'admin':
      if (!isAdminTelegramId(msg.from.id)) { await Telegram.sendMessage(chatId, '❌ Admin only.'); return; }
      await showAdminPanel(env, chatId);
      break;
  }
}

async function handlePhoto(env, msg, user) {
  const chatId = msg.chat.id;
  const session = await getSession(env, chatId);

  if (session && session.state === 'create_image' && session.data.price) {
    const photo = msg.photo?.[msg.photo.length - 1];
    if (!photo) return;
    const price = session.data.price;
    const creds = { email: session.data.email, password: session.data.password, additionalInfo: session.data.extra };
    const imageFileId = photo.file_id;
    await clearSession(env, chatId);
    await finalizeCreateListingSimple(env, chatId, user, price, imageFileId, creds);
    return;
  }

  if (session && session.state === 'paid_receipt_upload' && session.data.listingId) {
    const photo = msg.photo?.[msg.photo.length - 1];
    if (!photo) return;
    const listing = await Listing.findById(session.data.listingId);
    if (!listing) { await Telegram.sendMessage(chatId, '❌ Listing not found.'); return; }
    listing.paidReceiptFileId = photo.file_id;
    listing.paidReceiptType = 'photo';
    listing.paidAt = new Date();
    listing.escrowBuyerId = user._id;
    listing.status = 'paid_submitted';
    await listing.save();
    await clearSession(env, chatId);
    await Telegram.sendMessage(chatId, '✅ Payment proof RECEIVED. Sent to admins for verification.\n\nOnce admin verifies payment, they will release the account details to you here in the bot.');
    await notifyAdminEscrowUpdate(env, listing, `<tg-emoji emoji-id="5961015849199342153">🏦</tg-emoji> Buyer @${user.username || '?'} just uploaded payment proof (photo).`);
    return;
  }
}

async function handleDocument(env, msg, user) {
  const chatId = msg.chat.id;
  const session = await getSession(env, chatId);
  if (session && session.state === 'paid_receipt_upload' && session.data.listingId) {
    const doc = msg.document;
    if (!doc) return;
    const listing = await Listing.findById(session.data.listingId);
    if (!listing) { await Telegram.sendMessage(chatId, '❌ Listing not found.'); return; }
    listing.paidReceiptFileId = doc.file_id;
    listing.paidReceiptType = 'document';
    listing.paidAt = new Date();
    listing.escrowBuyerId = user._id;
    listing.status = 'paid_submitted';
    await listing.save();
    await clearSession(env, chatId);
    await Telegram.sendMessage(chatId, '✅ Payment proof RECEIVED. Sent to admins.\n\nOnce admin verifies payment, they will release the account details to you here in the bot.');
    await notifyAdminEscrowUpdate(env, listing, `<tg-emoji emoji-id="5961015849199342153">🏦</tg-emoji> Buyer @${user.username || '?'} just uploaded payment proof (document: ${doc.file_name || 'receipt'}).`);
    return;
  }
}

async function handleCallbackQuery(env, cb) {
  const chatId = cb.message?.chat?.id;
  const msgId = cb.message?.message_id;
  if (!chatId) return;

  const raw = cb.data || '';
  const answerCb = (t, alert = false) => Telegram.answerCallbackQuery(cb.id, { text: t || '', show_alert: alert });
  const editMsg = (text, extra) => {
    return Telegram.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', ...extra }).catch(() => {});
  };

  if (raw !== 'noop') await answerCb();

  let user = null;
  const getUser = async () => {
    if (!user) user = await getOrCreateUser(cb.from, chatId);
    return user;
  };

  try {
    if (raw === 'noop') { await answerCb(); return; }
    if (raw === 'delete_msg') {
      await Telegram.deleteMessage(chatId, msgId).catch(() => {});
      return;
    }
    if (raw.startsWith('pf_')) {
      const session = await getSession(env, chatId);
      if (!session || session.state !== 'create_platform') return;
      const platform = raw.slice(3);
      session.data.platform = platform;
      await setSession(env, chatId, 'create_overall', session.data);
      await Telegram.sendMessage(chatId, '<tg-emoji emoji-id="6100340203119971469">🔥</tg-emoji> <b>Step 4/8</b>\n\nEnter team overall rating as a number (e.g. <code>4800</code>), or type <code>skip</code>:', { parse_mode: 'HTML' });
      return;
    }
    if (raw.startsWith('neg_')) {
      const session = await getSession(env, chatId);
      if (!session || session.state !== 'create_negotiable') return;
      session.data.negotiable = raw === 'neg_yes';
      await setSession(env, chatId, 'create_creds_email', session.data);
      await Telegram.sendMessage(chatId,
        `<tg-emoji emoji-id="5963162821746233777">🏦</tg-emoji> <b>Now enter the account credentials</b> (1/3)\n\nThese will be encrypted with AES-256-GCM in the database. Only admin can decrypt them. They will be permanently DELETED from the database after escrow release.\n\nStep 1: Send the account <b>EMAIL</b>:`,
        { parse_mode: 'HTML' },
      );
      return;
    }

    if (raw.startsWith('verify_payment_')) {
      if (!isAdminTelegramId(cb.from.id)) return;
      const lid = raw.slice('verify_payment_'.length);
      const listing = await Listing.findById(lid).populate('sellerId escrowBuyerId');
      if (!listing) { await Telegram.sendMessage(chatId, '❌ Listing not found.'); return; }
      if (!listing.paidAt) { await Telegram.sendMessage(chatId, '❌ No payment proof submitted.'); return; }
      listing.paymentVerifiedAt = new Date();
      listing.paymentVerifiedBy = (await getUser())._id;
      await listing.save();
      await editMsg(
        `<tg-emoji emoji-id="5368324170671202289">✅</tg-emoji> Payment VERIFIED for listing <b>${listing.title}</b> (ID: <code>${shortId(listing._id)}</code>).`,
        { reply_markup: undefined },
      );
      await notifyAdminEscrowUpdate(env, listing, `<tg-emoji emoji-id="5961015849199342153">🏦</tg-emoji> Admin verified payment.`);
      return;
    }

    if (raw.startsWith('buy_pm_')) {
      const pm = raw.slice('buy_pm_'.length);
      const session = await getSession(env, chatId);
      if (!session || session.state !== 'buy_listing') return;
      const paymentMethod = await PaymentMethod.findOne({ callback_data: pm });
      if (!paymentMethod) { await Telegram.sendMessage(chatId, '❌ Payment method not found.'); return; }
      const listing = await Listing.findById(session.data.listingId);
      if (!listing) { await Telegram.sendMessage(chatId, '❌ Listing not found.'); return; }

      const buyerPrice = listing.price;
      const serviceFee = Math.round(buyerPrice * 0.05 * 100) / 100;
      const totalAmount = buyerPrice + serviceFee;

      await Telegram.sendMessage(chatId,
        `<tg-emoji emoji-id="5961015849199342153">🏦</T> <b>Payment Instructions</b>\n\n` +
        `<tg-emoji emoji-id="6102684181521763740">💠</tg-emoji> Listing: <b>${listing.title}</b>\n` +
        `Item price: <b>${formatMoney(listing.price, listing.currency)}</b>\n` +
        `Service fee (5%): <b>${formatMoney(serviceFee, listing.currency)}</b>\n` +
        `<b>Total to pay: ${formatMoney(totalAmount, listing.currency)}</b>\n\n` +
        `<b>Payment Method:</b> ${paymentMethod.name}\n` +
        (paymentMethod.account ? `<b>Account:</b> <code>${paymentMethod.account}</code>\n` : '') +
        (paymentMethod.holder ? `<b>Account holder name:</b> <code>${paymentMethod.holder}</code>\n` : '') +
        `\n⚠️ <b>IMPORTANT:</b> After sending payment, upload the receipt here.\n\n` +
        `Step 1: Send payment\nStep 2: Upload receipt (photo or document)\nStep 3: Admin verifies and releases account`,
        { parse_mode: 'HTML' },
      );

      listing.escrowBuyerId = (await getUser())._id;
      if (listing.status === 'available') listing.status = 'waiting_escrow';
      await listing.save();
      await setSession(env, chatId, 'paid_receipt_upload', { listingId: String(listing._id) });
      return;
    }

    if (raw.startsWith('settle_')) {
      if (!isAdminTelegramId(cb.from.id)) return;
      const lid = raw.slice(7);
      const listing = await Listing.findById(lid).populate('sellerId escrowBuyerId');
      if (!listing) { await Telegram.sendMessage(chatId, '❌ Listing not found.'); return; }
      const agreedPrice = Number(raw.data?.agreedPrice);
      const adminFee = Math.round(agreedPrice * 0.05 * 100) / 100;
      const sellerGets = Math.round((agreedPrice - adminFee) * 100) / 100;
      await Telegram.sendMessage(chatId,
        `<tg-emoji emoji-id="5961015849199342153">🏦</tg-emoji> Enter the <b>agreed price</b> in ETB:\n\nListing: <b>${listing.title}</b>\nBuyer pays: <b>${formatMoney(listing.price, listing.currency)}</b>\n\nFormat: <code>/settle ${listing._id} &lt;agreed_price&gt;</code>`,
        { parse_mode: 'HTML' },
      );
      return;
    }

    if (raw.startsWith('approve_')) {
      if (!isAdminTelegramId(cb.from.id)) return;
      const lid = raw.slice(8);
      const listing = await Listing.findById(lid).populate('sellerId');
      if (!listing) { await Telegram.sendMessage(chatId, '❌ Listing not found.'); return; }
      await publishListingToChannel(listing, listing.sellerId);
      await editMsg(
        `✅ <b>LISTING APPROVED &amp; POSTED TO CHANNEL</b>\n` +
        `<tg-emoji emoji-id="6102684181521763740">💠</tg-emoji> ${listing.title} | <tg-emoji emoji-id="5961054379350955385">🏦</tg-emoji> ${formatMoney(listing.price, listing.currency)} | <tg-emoji emoji-id="6102684181521763740">💠</tg-emoji> ${listing.platform}\n` +
        `Posted: ${process.env.TELEGRAM_CHANNEL_ID || 'Channel'} | ID: <code>${shortId(listing._id)}</code>`,
        { reply_markup: undefined, disable_web_page_preview: true },
      );
      const sellerChatId = listing.sellerId?.telegramChatId;
      if (sellerChatId) {
        await Telegram.sendMessage(sellerChatId,
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
      if (!isAdminTelegramId(cb.from.id)) return;
      const lid = raw.slice(7);
      const listing = await Listing.findById(lid).populate('sellerId');
      if (!listing) { await Telegram.sendMessage(chatId, '❌ Listing not found.'); return; }
      listing.status = 'rejected';
      listing.rejectionReason = 'Rejected by admin';
      await listing.save();
      await editMsg(`❌ <b>LISTING REJECTED</b>\n${listing.title} — ID: <code>${shortId(listing._id)}</code>`, { reply_markup: undefined });
      const sellerChatId = listing.sellerId?.telegramChatId;
      if (sellerChatId) {
        await Telegram.sendMessage(sellerChatId,
          `❌ Your listing <b>"${listing.title}"</b> was rejected by admin.\nContact admin if you believe this is an error.`,
          { parse_mode: 'HTML' },
        );
      }
      return;
    }

    if (raw.startsWith('release_')) {
      if (!isAdminTelegramId(cb.from.id)) return;
      const lid = raw.slice(8);
      const res = await releaseEscrow(env, cb.from.id, lid);
      if (!res.ok) {
        await editMsg(`❌ Release failed: ${res.err}\n\nListing ID: <code>${shortId(lid)}</code>`, { reply_markup: undefined });
        return;
      }
      await editMsg(
        `🎉 <b>ESCROW RELEASED &amp; CREDS WIPED FROM DB</b>\n\n` +
        `<tg-emoji emoji-id="6102684181521763740">💠</tg-emoji> ${res.listing.title} | <tg-emoji emoji-id="5961054379350955385">🏦</tg-emoji> ${formatMoney(res.listing.price, res.listing.currency)}\n` +
        `Buyer: @${res.listing.escrowBuyerId?.username || '?'}\n` +
        `Seller: @${res.listing.sellerId?.username || '?'}\n\n` +
        `✅ Credentials sent to buyer.\n✅ Seller notified of release.\n✅ Credentials document DELETED from MongoDB.\n✅ Channel post updated to SOLD.`,
        { reply_markup: undefined },
      );
      return;
    }

    if (raw.startsWith('cancel_escrow_')) {
      if (!isAdminTelegramId(cb.from.id)) return;
      const lid = raw.slice(14);
      const listing = await Listing.findById(lid);
      if (!listing) { await Telegram.sendMessage(chatId, '❌ Listing not found.'); return; }
      listing.status = 'available';
      listing.paidReceiptFileId = undefined;
      listing.paidReceiptType = undefined;
      listing.paidAt = undefined;
      listing.paymentVerifiedAt = undefined;
      listing.paymentVerifiedBy = undefined;
      listing.credentialsSubmittedAt = undefined;
      listing.releasedAt = undefined;
      listing.escrowBuyerId = undefined;
      listing.sellerPaidAt = undefined;
      listing.sellerPaidBy = undefined;
      listing.credentialsWiped = false;
      await listing.save();
      try { await restoreChannelListingButtons(listing); } catch (e) { /* ignore */ }
      await editMsg(`❌ <b>ESCROW CANCELLED</b> — listing ${shortId(lid)} reverted to AVAILABLE.`, { reply_markup: undefined });
      return;
    }

    if (raw.startsWith('delete_listing_')) {
      const user = await getUser();
      const lid = raw.slice(15);
      const listing = await Listing.findById(lid);
      if (!listing) { await Telegram.sendMessage(chatId, '❌ Listing not found.'); return; }
      if (String(listing.sellerId) !== String(user._id) && !isAdminTelegramId(user.telegramId)) { await Telegram.sendMessage(chatId, '❌ Not your listing.'); return; }
      listing.status = 'deleted';
      await listing.save();
      try { await updateChannelListingStatus(listing, '🗑️ REMOVED'); } catch (e) { /* */ }
      await editMsg(`🗑️ <b>LISTING DELETED</b> — ID: <code>${shortId(lid)}</code>`, { reply_markup: undefined });
      return;
    }

    switch (raw) {
      case 'browse':
        await browseAndShow(env, chatId, {});
        return;
      case 'search':
        await setSession(env, chatId, 'search_query', {});
        await Telegram.sendMessage(chatId, '🔍 Enter search keyword:');
        return;
      case 'sell': {
        const user = await getUser();
        if (user.status === 'banned') { await Telegram.sendMessage(chatId, '❌ Your account is banned.'); return; }
        if (user.role === 'buyer') { user.role = 'seller'; await user.save(); }
        await startCreateListingFlow(env, chatId);
        return;
      }
      case 'my_listings': {
        const user = await getUser();
        await showMyListings(env, chatId, user);
        return;
      }
      case 'admin_panel':
        if (!isAdminTelegramId(cb.from.id)) return;
        await showAdminPanel(env, chatId);
        return;
    }
  } catch (err) {
    console.error('callback_query error:', err);
    await answerCb('❌ Something went wrong', true);
  }
}

async function sendTelegramNotification(chatId, text) {
  try {
    return await Telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('sendTelegramNotification error:', err.message);
    return null;
  }
}

async function relayMessageToTelegram(message) {
  if (!message) return false;
  try {
    const receiverTelegramId = message.receiverTelegramId;
    if (!receiverTelegramId) return false;
    const senderTelegramId = message.senderTelegramId;
    const prefix = senderTelegramId ? `@${senderTelegramId}: ` : '';
    await Telegram.sendMessage(receiverTelegramId, `${prefix}${message.content}`, { parse_mode: 'HTML' });
    return true;
  } catch (err) {
    console.error('relayMessageToTelegram error:', err.message);
    return false;
  }
}

export {
  handleWebhook,
  sendTelegramNotification,
  publishListingToChannel,
  restoreChannelListingButtons,
  updateChannelListingStatus,
  relayMessageToTelegram,
};
