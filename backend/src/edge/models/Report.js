import { createModel } from './base.js';

const Report = createModel('reports', {
  populates: {
    reporterId: { collection: 'users', select: 'username' },
    targetUserId: { collection: 'users', select: 'username' },
    targetListingId: { collection: 'listings', select: 'title' },
    targetTransactionId: { collection: 'transactions', select: 'status' },
    assignedTo: { collection: 'users', select: 'username' },
    resolvedBy: { collection: 'users', select: 'username' },
  },
});

export default Report;
