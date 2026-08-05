const router = require('express').Router();
const transactionController = require('../controllers/transactionController');
const { protect, isAdmin } = require('../middleware/auth');

router.get('/', protect, transactionController.getMyTransactions);
router.get('/all', protect, isAdmin, transactionController.getAllTransactions);
router.get('/:id', protect, transactionController.getTransaction);

router.post('/', protect, transactionController.createTransaction);
router.put('/:id/status', protect, transactionController.updateStatus);
router.put('/:id/payment-proof', protect, transactionController.submitPaymentProof);
router.put('/:id/submit-credentials', protect, transactionController.submitCredentials);
router.post('/:id/dispute', protect, transactionController.openDispute);
router.post('/:id/resolve', protect, isAdmin, transactionController.resolveDispute);

module.exports = router;
