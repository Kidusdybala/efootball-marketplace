const { isAdminTelegramId } = require('./helpers');

const PLATFORMS = ['Android', 'iOS', 'Steam', 'PlayStation', 'Xbox', 'PC', 'Cross-Platform'];

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

module.exports = {
  PLATFORMS,
  mainMenuKeyboard,
  platformKeyboard,
  negotiableKeyboard,
  approveRejectKeyboard,
  escrowAdminKeyboard,
};
