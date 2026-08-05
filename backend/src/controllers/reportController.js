const Report = require('../models/Report');
const { AppError } = require('../middleware/errorHandler');
const { notifyAdmins, notifyUser } = require('../services/notificationService');

exports.createReport = async (req, res, next) => {
  try {
    const { targetType, targetUserId, targetListingId, targetTransactionId, reason, description, evidence, priority } = req.body;
    if (!targetType || !reason || !description) {
      return next(new AppError('Target type, reason, and description are required', 400));
    }
    if (!['user', 'listing', 'transaction'].includes(targetType)) {
      return next(new AppError('Invalid target type', 400));
    }
    const report = await Report.create({
      reporterId: req.user._id,
      targetType,
      targetUserId,
      targetListingId,
      targetTransactionId,
      reason,
      description,
      evidence: evidence || [],
      priority: priority || 'medium',
      status: 'open',
    });
    await notifyAdmins('report_received', '🚨 New Report Filed',
      `Report #${report._id?.toString().slice(-6)}\nType: ${targetType} | Reason: ${reason}\n${description.slice(0, 200)}`);
    res.status(201).json({ success: true, data: report, message: 'Report submitted. Admin will review shortly.' });
  } catch (err) {
    next(err);
  }
};

exports.getMyReports = async (req, res, next) => {
  try {
    const reports = await Report.find({ reporterId: req.user._id }).sort({ createdAt: -1 });
    res.json({ success: true, data: reports });
  } catch (err) {
    next(err);
  }
};

exports.getAllReports = async (req, res, next) => {
  try {
    const { status, priority, targetType, page = 1, limit = 20 } = req.query;
    const query = {};
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (targetType) query.targetType = targetType;
    const skip = (page - 1) * limit;
    const reports = await Report.find(query)
      .populate('reporterId', 'username telegramId')
      .populate('targetUserId', 'username telegramId')
      .populate('targetListingId', 'title price')
      .populate('assignedTo', 'username')
      .populate('resolvedBy', 'username')
      .sort({ priority: -1, createdAt: -1 })
      .skip(skip).limit(limit);
    const total = await Report.countDocuments(query);
    res.json({ success: true, data: reports, total, page, limit });
  } catch (err) {
    next(err);
  }
};

exports.getReport = async (req, res, next) => {
  try {
    const report = await Report.findById(req.params.id)
      .populate('reporterId', 'username telegramId')
      .populate('targetUserId', 'username telegramId rating completedSales completedBuys')
      .populate('targetListingId', 'title price status')
      .populate('targetTransactionId', 'status agreedPrice')
      .populate('assignedTo', 'username')
      .populate('resolvedBy', 'username');
    if (!report) return next(new AppError('Report not found', 404));
    if (String(report.reporterId._id) !== String(req.user._id) && req.user.role !== 'admin') {
      return next(new AppError('Not authorized', 403));
    }
    res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
};

exports.assignReport = async (req, res, next) => {
  try {
    const { assignedTo = req.user._id } = req.body;
    const report = await Report.findByIdAndUpdate(req.params.id, { assignedTo }, { new: true });
    if (!report) return next(new AppError('Report not found', 404));
    res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
};

exports.updateReportStatus = async (req, res, next) => {
  try {
    const { status, resolution, actionTaken, adminNotes } = req.body;
    const report = await Report.findById(req.params.id);
    if (!report) return next(new AppError('Report not found', 404));
    report.status = status;
    report.resolution = resolution;
    report.actionTaken = actionTaken;
    report.adminNotes = adminNotes;
    if (['resolved', 'dismissed'].includes(status)) {
      report.resolvedAt = new Date();
      report.resolvedBy = req.user._id;
    }
    await report.save();
    if (['resolved', 'dismissed'].includes(status)) {
      await notifyUser({
        userId: report.reporterId,
        type: 'report_resolved',
        title: status === 'resolved' ? '✅ Report Resolved' : 'ℹ️ Report Update',
        message: `Your report #${report._id?.toString().slice(-6)} has been ${status}.\n${resolution || ''}\nAction: ${actionTaken || 'None'}`,
        reportId: report._id,
        viaTelegram: true,
      });
    }
    res.json({ success: true, data: report });
  } catch (err) {
    next(err);
  }
};
