const router = require('express').Router();
const userController = require('../controllers/userController');
const { protect, isAdmin } = require('../middleware/auth');

router.get('/', protect, isAdmin, userController.getAllUsers);
router.get('/stats/me', protect, userController.getUserStats);
router.get('/stats/:id', protect, userController.getUserStats);
router.get('/username/:username', userController.getUserByUsername);
router.get('/:id', protect, userController.getUserById);
router.post('/rate', protect, userController.rateUser);
router.post('/submit-verification', protect, userController.submitVerification);

module.exports = router;
