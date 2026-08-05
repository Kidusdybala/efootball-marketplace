const router = require('express').Router();
const notificationController = require('../controllers/notificationController');
const { protect } = require('../middleware/auth');

router.get('/', protect, notificationController.getMyNotifications);
router.put('/:id/read', protect, notificationController.markNotificationRead);
router.put('/read-all', protect, notificationController.markAllRead);
router.post('/test', protect, notificationController.createTestNotification);

module.exports = router;
