const { formatMoney } = require('../utils/money');
const { shortId } = require('./helpers');

const statusEmoji = (s) => ({
  available: '<tg-emoji emoji-id="5368324170671202286">🟢</tg-emoji> AVAILABLE', reserved: '<tg-emoji emoji-id="5368324170671202289">🟡</tg-emoji> RESERVED', sold: '<tg-emoji emoji-id="5368324170671202288">🔴</tg-emoji> SOLD',
  pending_review: '<tg-emoji emoji-id="5368324170671202289">⏳</tg-emoji> PENDING REVIEW', rejected: '<tg-emoji emoji-id="5368324170671202289">❌</tg-emoji> REJECTED', deleted: '<tg-emoji emoji-id="5368324170671202289">🗑️</tg-emoji> DELETED',
  approved: '<tg-emoji emoji-id="5368324170671202290">✅</tg-emoji> APPROVED', waiting_escrow: '<tg-emoji emoji-id="5368324170671202290">🤝</tg-emoji> DEAL AGREED',
  paid_submitted: '<tg-emoji emoji-id="5368324170671202293">🧾</tg-emoji> PAID (PROOF)', creds_submitted: '<tg-emoji emoji-id="5368324170671202294">🔐</tg-emoji> CREDS IN',
  released: '<tg-emoji emoji-id="5368324170671202290">🎉</tg-emoji> RELEASED',
})[s] || String(s).toUpperCase();

const escrowStatusBadge = (l) => {
  const parts = [];
  if (l.paidAt || l.status === 'paid_submitted' || l.status === 'creds_submitted') parts.push('PAID: ' + (l.paidAt ? 'YES' : 'NO'));
  if (l.paymentVerifiedAt) parts.push('VERIFIED: YES');
  if (l.credentialsSubmittedAt || l.status === 'creds_submitted') parts.push('CREDS: ' + (l.credentialsSubmittedAt ? 'YES' : 'NO'));
  if (l.releasedAt) parts.push('RELEASED');
  if (l.sellerPaidAt) parts.push('SELLER PAID');
  return parts.length ? parts.join(' | ') : 'Waiting for buyer/seller...';
};

const formatListingCard = (listing, seller) => {
  const lines = [];
  lines.push(`${statusEmoji(listing.status)}`);
  lines.push(`<b>${listing.title}</b>`);
  lines.push(`<tg-emoji emoji-id="5368324170671202293">💰</tg-emoji> <b>Price:</b> ${formatMoney(listing.price, listing.currency)}${listing.negotiable ? ' <i>(Negotiable)</i>' : ''}`);
  lines.push(`<tg-emoji emoji-id="5368324170671202294">🎮</tg-emoji> <b>Platform:</b> ${listing.platform}`);
  if (listing.overall) lines.push(`<tg-emoji emoji-id="5368324170671202294">⭐️</tg-emoji> <b>Team Overall:</b> ${listing.overall}`);
  if (listing.teamName) lines.push(`<tg-emoji emoji-id="5368324170671202294">🛡️</tg-emoji> <b>Team:</b> ${listing.teamName}`);
  if (listing.featuredPlayers?.length) lines.push(`<tg-emoji emoji-id="5368324170671202294">🌟</tg-emoji> <b>Featured:</b> ${listing.featuredPlayers.slice(0, 3).join(', ')}`);
  if (seller) {
    const verified = seller.isVerified ? ' <tg-emoji emoji-id="5368324170671202290">✅</tg-emoji> <b>[VERIFIED]</b>' : '';
    lines.push(`\n<tg-emoji emoji-id="5368324170671202291">👤</tg-emoji> <b>Seller:</b> @${seller.username}${verified}`);
  }
  lines.push(`\n<tg-emoji emoji-id="5368324170671202289">📝</tg-emoji> <b>Description:</b>`);
  lines.push(`<i>${listing.description}</i>`);
  lines.push(`\n<tg-emoji emoji-id="5368324170671202289">📅</tg-emoji> <b>Listed:</b> ${new Date(listing.createdAt).toLocaleDateString()}`);
  lines.push(`<tg-emoji emoji-id="5368324170671202289">🆔</tg-emoji> <b>Listing ID:</b> <code>${shortId(listing._id)}</code>`);
  return lines.join('\n');
};

const formatChannelListingCard = (listing) => {
  return `<tg-emoji emoji-id="5368324170671202293">💰</tg-emoji> <b>Price:</b> ${formatMoney(listing.price, listing.currency)}`;
};

module.exports = {
  statusEmoji,
  escrowStatusBadge,
  formatListingCard,
  formatChannelListingCard,
};
