const router = require('express').Router();
const reportController = require('../controllers/reportController');
const { protect, isAdmin } = require('../middleware/auth');

router.get('/mine', protect, reportController.getMyReports);
router.get('/', protect, isAdmin, reportController.getAllReports);
router.get('/:id', protect, reportController.getReport);

router.post('/', protect, reportController.createReport);
router.put('/:id/assign', protect, isAdmin, reportController.assignReport);
router.put('/:id/status', protect, isAdmin, reportController.updateReportStatus);

module.exports = router;
