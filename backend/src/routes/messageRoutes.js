const router = require('express').Router();
const messageController = require('../controllers/messageController');
const { protect } = require('../middleware/auth');

router.get('/conversations', protect, messageController.getConversationsList);
router.get('/unread-count', protect, messageController.getUnreadCount);
router.get('/conversation/:otherUserId/:listingId?', protect, messageController.getConversation);
router.get('/conversation/:otherUserId', protect, messageController.getConversation);
router.post('/', protect, messageController.sendMessage);
router.post('/mark-read/:conversationId', protect, messageController.markConversationRead);

module.exports = router;
