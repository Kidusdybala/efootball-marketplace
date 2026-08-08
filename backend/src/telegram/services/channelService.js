const { getBot } = require('../botInstance');
const { formatChannelListingCard } = require('../formatters');

const publishListingToChannel = async (listing, seller) => {
  const bot = getBot();
  const channelId = process.env.TELEGRAM_CHANNEL_ID;
  if (!channelId) return null;

  const botUsername = process.env.TELEGRAM_BOT_USERNAME;
  const buyUrl = botUsername ? `https://t.me/${botUsername}?start=buy_${listing._id}` : null;

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
  const bot = getBot();
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
  const bot = getBot();
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

module.exports = {
  publishListingToChannel,
  restoreChannelListingButtons,
  updateChannelListingStatus,
};
