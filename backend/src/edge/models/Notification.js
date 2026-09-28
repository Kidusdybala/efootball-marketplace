import { createModel } from './base.js';

const NOTIFICATION_TYPES = [
  'listing_approved', 'listing_rejected', 'listing_sold', 'listing_reserved',
  'new_listing_favorite', 'new_message', 'transaction_created', 'transaction_paid',
  'transaction_verified', 'transaction_completed', 'transaction_disputed',
  'transaction_cancelled', 'buyer_paid_admin', 'credentials_request',
  'credentials_verified', 'credentials_released', 'payment_released',
  'rating_received', 'report_received', 'report_resolved',
  'user_banned', 'user_verified', 'welcome', 'password_reset',
];

const Notification = createModel('notifications', {
  populates: {
    userId: { collection: 'users', select: 'username' },
    listingId: { collection: 'listings', select: 'title price' },
    transactionId: { collection: 'transactions', select: 'status' },
    reportId: { collection: 'reports', select: 'status' },
    senderId: { collection: 'users', select: 'username' },
  },
});

export { NOTIFICATION_TYPES };
export default Notification;
