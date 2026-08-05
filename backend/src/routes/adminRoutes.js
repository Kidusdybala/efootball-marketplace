const router = require('express').Router();
const adminController = require('../controllers/adminController');
const listingController = require('../controllers/listingController');
const { protect, isAdmin } = require('../middleware/auth');

router.use(protect, isAdmin);

router.get('/stats', adminController.getDashboardStats);
router.get('/growth', adminController.getGrowthStats);

router.get('/credentials/:listingId', adminController.getCredentials);
router.put('/credentials/:listingId/verify', adminController.markCredentialsVerified);

router.get('/pending-listings', listingController.getPendingListings);
router.post('/listings/:id/approve', listingController.approveListing);
router.post('/listings/:id/reject', listingController.rejectListing);

router.put('/users/:id/ban', adminController.banUser);
router.put('/users/:id/unban', adminController.unbanUser);
router.put('/users/:id/verify', adminController.verifyUser);
router.put('/users/:id/role', adminController.setUserRole);

router.post('/broadcast', adminController.sendBroadcast);

module.exports = router;
