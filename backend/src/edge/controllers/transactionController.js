import Transaction from '../models/Transaction.js';
import Listing from '../models/Listing.js';
import AccountCredentials from '../models/AccountCredentials.js';
import User from '../models/User.js';
import { AppError } from '../middleware/errorHandler.js';
import { notifyUser, notifyAdmins } from '../services/notificationService.js';
import { formatMoney } from '../utils/money.js';
import { TRANSACTION_STATUS } from '../models/Transaction.js';

const VALID_TRANSITIONS = {
  pending: ['negotiating', 'waiting_payment', 'cancelled'],
  negotiating: ['waiting_payment', 'cancelled'],
  waiting_payment: ['paid', 'cancelled'],
  paid: ['credentials_submitted', 'disputed'],
  credentials_submitted: ['verified', 'disputed'],
  verified: ['credentials_sent', 'disputed'],
  credentials_sent: ['buyer_confirmed', 'disputed'],
  buyer_confirmed: ['completed'],
  completed: [],
  disputed: ['resolved', 'refunded', 'completed'],
  cancelled: [],
  refunded: [],
};

const STATUS_TITLES = {
  negotiating: 'Negotiating',
  waiting_payment: 'Payment Pending',
  paid: 'Payment Confirmed',
  credentials_submitted: 'Credentials Submitted',
  verified: 'Credentials Verified',
  credentials_sent: 'Credentials Sent',
  buyer_confirmed: 'Buyer Confirmed',
  completed: 'Transaction Completed',
  cancelled: 'Transaction Cancelled',
  disputed: 'Dispute Opened',
  refunded: 'Refund Processed',
};

function getStatusTitle(s) {
  return STATUS_TITLES[s] || 'Status Updated';
}

function getStatusMessage(s, tx, by) {
  return `Transaction #${String(tx._id).slice(-6)} status: ${s.toUpperCase()}.\nUpdated by @${by}.`;
}

async function createTransaction(c) {
  try {
    const body = await c.req.json();
    const { listingId, agreedPrice } = body;
    const listing = await Listing.findById(listingId);
    if (!listing) throw new AppError('Listing not found', 404);
    if (listing.status === 'sold') throw new AppError('Listing already sold', 400);
    if (listing.status === 'reserved' && String(listing.reservedBy) !== String(c.get('user')._id)) {
      throw new AppError('Listing reserved for another buyer', 400);
    }
    if (String(listing.sellerId) === String(c.get('user')._id)) {
      throw new AppError('Cannot buy your own listing', 400);
    }
    const price = Number(agreedPrice || listing.price);
    const transaction = await Transaction.create({
      listingId,
      buyerId: c.get('user')._id,
      sellerId: listing.sellerId,
      agreedPrice: price,
      status: 'pending',
      statusHistory: [{ status: 'pending', timestamp: new Date(), note: 'Transaction initiated' }],
    });
    listing.status = 'reserved';
    listing.reservedBy = c.get('user')._id;
    listing.reservedAt = new Date();
    await listing.save();
    await Promise.all([
      notifyUser({
        userId: listing.sellerId,
        type: 'transaction_created',
        title: 'New Purchase Request',
        message: `Buyer @${c.get('user').username} wants to buy "${listing.title}" for ${formatMoney(price)}. Review and negotiate.`,
        listingId,
        transactionId: transaction._id,
        senderId: c.get('user')._id,
        viaTelegram: true,
      }),
      notifyUser({
        userId: c.get('user')._id,
        type: 'transaction_created',
        title: 'Purchase Request Sent',
        message: `Your request for "${listing.title}" (${formatMoney(price)}) has been sent. Waiting for seller response.`,
        listingId,
        transactionId: transaction._id,
        viaTelegram: true,
      }),
    ]);
    return c.json({ success: true, data: transaction }, 201);
  } catch (err) {
    throw err;
  }
}

async function getMyTransactions(c) {
  try {
    const { status, role } = c.req.query();
    const userId = c.get('user')._id;
    const query = { $or: [{ buyerId: userId }, { sellerId: userId }] };
    if (status) query.status = status;
    if (role === 'buyer') query.buyerId = userId;
    if (role === 'seller') query.sellerId = userId;
    const qb = Transaction.find(query);
    qb.populate('listingId', 'title images price platform overall status');
    qb.populate('buyerId', 'username rating avatar isVerified');
    qb.populate('sellerId', 'username rating avatar isVerified');
    qb.sort({ createdAt: -1 });
    const transactions = await qb.exec();
    return c.json({ success: true, data: transactions });
  } catch (err) {
    throw err;
  }
}

async function getTransaction(c) {
  try {
    const qb = Transaction.findById(c.req.param('id'));
    qb.populate('listingId', 'title images price platform overall status');
    qb.populate('buyerId', 'username rating avatar isVerified telegramId');
    qb.populate('sellerId', 'username rating avatar isVerified telegramId');
    const tx = await qb;
    if (!tx) throw new AppError('Transaction not found', 404);
    const user = c.get('user');
    const isParticipant = String(tx.buyerId._id) === String(user._id) || String(tx.sellerId._id) === String(user._id);
    if (!isParticipant && user.role !== 'admin') {
      throw new AppError('Not authorized to view this transaction', 403);
    }
    const txObj = { ...tx.toObject() };
    if (user.role === 'admin' || String(tx.buyerId._id) === String(user._id)) {
      if (['verified', 'credentials_sent', 'buyer_confirmed', 'completed'].includes(tx.status)) {
        const creds = await AccountCredentials.findOne({ listingId: tx.listingId._id });
        if (creds) txObj.credentials = await creds.getAllDecrypted();
      }
    }
    if (user.role === 'admin' && !['completed', 'cancelled'].includes(tx.status)) {
      const creds = await AccountCredentials.findOne({ listingId: tx.listingId._id });
      if (creds) txObj.adminCredentials = await creds.getAllDecrypted();
    }
    return c.json({ success: true, data: txObj });
  } catch (err) {
    throw err;
  }
}

async function updateStatus(c) {
  try {
    const body = await c.req.json();
    const { status, note } = body;
    const qb = Transaction.findById(c.req.param('id'));
    qb.populate('listingId');
    const tx = await qb;
    if (!tx) throw new AppError('Transaction not found', 404);
    if (!VALID_TRANSITIONS[tx.status]?.includes(status)) {
      throw new AppError(`Invalid status transition from ${tx.status} to ${status}`, 400);
    }
    const user = c.get('user');
    const isBuyer = String(tx.buyerId) === String(user._id);
    const isSeller = String(tx.sellerId) === String(user._id);
    const isAdmin = user.role === 'admin';
    const isParticipantOrAdmin = isBuyer || isSeller || isAdmin;

    if (status === 'waiting_payment' && !isSeller && !isAdmin) throw new AppError('Only seller can confirm agreement', 403);
    if (status === 'paid' && !isBuyer && !isAdmin) throw new AppError('Only buyer can mark as paid', 403);
    if (status === 'credentials_submitted' && !isSeller && !isAdmin) throw new AppError('Only seller can submit credentials', 403);
    if (status === 'verified' && !isAdmin) throw new AppError('Only admin can verify credentials', 403);
    if (status === 'credentials_sent' && !isAdmin) throw new AppError('Only admin can send credentials', 403);
    if (status === 'buyer_confirmed' && !isBuyer && !isAdmin) throw new AppError('Only buyer can confirm receipt', 403);
    if (status === 'completed' && !isAdmin && !isBuyer) throw new AppError('Only admin or buyer can complete', 403);
    if ((status === 'cancelled' || status === 'disputed') && !isParticipantOrAdmin) throw new AppError('Not authorized', 403);

    tx.status = status;
    if (note) tx.notes = (tx.notes ? tx.notes + '\n' : '') + note;
    if (status === 'paid') tx.paidAt = new Date();
    if (status === 'completed') {
      tx.releasedAt = new Date();
      tx.releasedBy = user._id;
      if (tx.listingId) {
        await Listing.findByIdAndUpdate(tx.listingId._id, { $set: { status: 'sold', soldAt: new Date(), soldTo: tx.buyerId } });
      }
    }
    if (status === 'cancelled') {
      tx.cancelledAt = new Date();
      tx.cancelledBy = user._id;
      tx.cancellationReason = note || '';
      if (tx.listingId) {
        const listing = await Listing.findById(tx.listingId._id);
        if (listing && listing.status === 'reserved') {
          listing.status = 'available';
          listing.reservedBy = null;
          listing.reservedAt = null;
          await listing.save();
        }
      }
    }
    await tx.save();
    const title = getStatusTitle(status);
    const msg = getStatusMessage(status, tx, user.username);
    await Promise.all([
      notifyUser({ userId: tx.buyerId, type: `transaction_${status}`, title, message: msg, transactionId: tx._id, listingId: tx.listingId?._id, senderId: user._id, viaTelegram: true }),
      notifyUser({ userId: tx.sellerId, type: `transaction_${status}`, title, message: msg, transactionId: tx._id, listingId: tx.listingId?._id, senderId: user._id, viaTelegram: true }),
    ]);
    if (status === 'paid') await notifyAdmins('buyer_paid_admin', 'Payment Received', `Buyer @${user.username} has paid for transaction #${tx._id}`);
    if (status === 'disputed') await notifyAdmins('transaction_disputed', 'Dispute Opened', `Dispute on transaction #${tx._id}\n${note || 'No details'}`);
    return c.json({ success: true, data: tx });
  } catch (err) {
    throw err;
  }
}

async function submitPaymentProof(c) {
  try {
    const body = await c.req.json();
    const { paymentProof, paymentRef, paymentMethod } = body;
    const tx = await Transaction.findById(c.req.param('id'));
    if (!tx) throw new AppError('Transaction not found', 404);
    if (String(tx.buyerId) !== String(c.get('user')._id) && c.get('user').role !== 'admin') {
      throw new AppError('Not authorized', 403);
    }
    if (paymentProof) tx.paymentProof = paymentProof;
    if (paymentRef) tx.paymentRef = paymentRef;
    if (paymentMethod) tx.paymentMethod = paymentMethod;
    await tx.save();
    return c.json({ success: true, data: tx });
  } catch (err) {
    throw err;
  }
}

async function submitCredentials(c) {
  try {
    const body = await c.req.json();
    const { email, password, backupCodes, twoFactorSecret, additionalInfo } = body;
    const tx = await Transaction.findById(c.req.param('id'));
    if (!tx) throw new AppError('Transaction not found', 404);
    const user = c.get('user');
    if (String(tx.sellerId) !== String(user._id) && user.role !== 'admin') {
      throw new AppError('Only seller can submit credentials', 403);
    }
    if (!['paid', 'credentials_submitted'].includes(tx.status)) {
      throw new AppError('Cannot submit credentials at this stage', 400);
    }
    if (!email || !password) throw new AppError('Email and password required', 400);
    let creds = await AccountCredentials.findOne({ listingId: tx.listingId });
    if (!creds) creds = await AccountCredentials.create({ listingId: tx.listingId });
    await creds.setEmail(email);
    await creds.setPassword(password);
    if (backupCodes) await creds.setBackupCodes(backupCodes);
    if (twoFactorSecret) await creds.setTwoFactorSecret(twoFactorSecret);
    if (additionalInfo) await creds.setAdditionalInfo(additionalInfo);
    await creds.save();
    tx.status = 'credentials_submitted';
    await tx.save();
    await notifyAdmins('credentials_request', 'Credentials Submitted',
      `Seller submitted credentials for transaction #${tx._id}. Ready for admin verification.`);
    return c.json({ success: true, data: tx });
  } catch (err) {
    throw err;
  }
}

async function getAllTransactions(c) {
  try {
    const { status, page = 1, limit = 20 } = c.req.query();
    const query = {};
    if (status) query.status = status;
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;
    const qb = Transaction.find(query);
    qb.populate('listingId', 'title price');
    qb.populate('buyerId', 'username telegramId');
    qb.populate('sellerId', 'username telegramId');
    qb.sort({ createdAt: -1 });
    qb.skip(skip);
    qb.limit(limitNum);
    const txs = await qb.exec();
    const total = await Transaction.countDocuments(query);
    return c.json({ success: true, data: txs, total, page: pageNum, limit: limitNum });
  } catch (err) {
    throw err;
  }
}

async function openDispute(c) {
  try {
    const body = await c.req.json();
    const { reason, evidence } = body;
    const tx = await Transaction.findById(c.req.param('id'));
    if (!tx) throw new AppError('Transaction not found', 404);
    const userId = c.get('user')._id;
    const userRole = c.get('user').role;
    if (String(tx.buyerId) !== String(userId) && String(tx.sellerId) !== String(userId) && userRole !== 'admin') {
      throw new AppError('Not authorized', 403);
    }
    if (['completed', 'cancelled', 'refunded', 'disputed'].includes(tx.status)) {
      throw new AppError('Cannot open dispute for this status', 400);
    }
    tx.status = 'disputed';
    tx.disputeReason = reason;
    tx.disputeEvidence = evidence || [];
    await tx.save();
    await notifyAdmins('transaction_disputed', 'Dispute Opened', `Dispute on transaction #${tx._id}\nReason: ${reason}`);
    return c.json({ success: true, data: tx });
  } catch (err) {
    throw err;
  }
}

async function resolveDispute(c) {
  try {
    const body = await c.req.json();
    const { resolution, action } = body;
    const tx = await Transaction.findById(c.req.param('id'));
    if (!tx) throw new AppError('Transaction not found', 404);
    if (tx.status !== 'disputed') throw new AppError('No open dispute', 400);
    tx.resolution = resolution;
    tx.resolvedBy = c.get('user')._id;
    tx.resolvedAt = new Date();
    if (action === 'complete') tx.status = 'completed';
    else if (action === 'refund') tx.status = 'refunded';
    else tx.status = 'resolved';
    await tx.save();
    return c.json({ success: true, data: tx });
  } catch (err) {
    throw err;
  }
}

export {
  createTransaction,
  getMyTransactions,
  getTransaction,
  updateStatus,
  submitPaymentProof,
  submitCredentials,
  getAllTransactions,
  openDispute,
  resolveDispute,
};
