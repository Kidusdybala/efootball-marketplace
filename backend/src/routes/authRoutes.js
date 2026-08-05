const router = require('express').Router();
const authController = require('../controllers/authController');
const { protect } = require('../middleware/auth');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/telegram', authController.telegramAuth);
router.get('/me', protect, authController.me);
router.put('/update-me', protect, authController.updateMe);
router.put('/change-password', protect, authController.changePassword);
router.put('/upgrade-seller', protect, authController.upgradeToSeller);

module.exports = router;
