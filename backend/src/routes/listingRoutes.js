const router = require('express').Router();
const listingController = require('../controllers/listingController');
const { protect, isAdmin, isSellerOrAdmin, isNotBanned } = require('../middleware/auth');

router.get('/', listingController.getListings);
router.get('/pending', protect, isAdmin, listingController.getPendingListings);
router.get('/mine', protect, listingController.getMyListings);
router.get('/favorites', protect, listingController.getFavorites);
router.get('/:id', listingController.getListingById);

router.post('/', protect, isNotBanned, isSellerOrAdmin, listingController.createListing);
router.post('/:id/reserve', protect, listingController.reserveListing);
router.post('/:id/favorite', protect, listingController.toggleFavorite);
router.post('/:id/sold', protect, listingController.markAsSold);
router.put('/:id', protect, listingController.updateListing);
router.delete('/:id', protect, listingController.deleteListing);

router.post('/:id/approve', protect, isAdmin, listingController.approveListing);
router.post('/:id/reject', protect, isAdmin, listingController.rejectListing);

module.exports = router;
