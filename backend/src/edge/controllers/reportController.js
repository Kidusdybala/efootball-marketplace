import Report from '../models/Report.js';
import { AppError } from '../middleware/errorHandler.js';
import { notifyAdmins, notifyUser } from '../services/notificationService.js';

async function createReport(c) {
  try {
    const body = await c.req.json();
    const { targetType, targetUserId, targetListingId, targetTransactionId, reason, description, evidence, priority } = body;
    if (!targetType || !reason || !description) {
      throw new AppError('Target type, reason, and description are required', 400);
    }
    if (!['user', 'listing', 'transaction'].includes(targetType)) {
      throw new AppError('Invalid target type', 400);
    }
    const report = await Report.create({
      reporterId: c.get('user')._id,
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
    await notifyAdmins('report_received', 'New Report Filed',
      `Report #${String(report._id).slice(-6)}\nType: ${targetType} | Reason: ${reason}\n${description.slice(0, 200)}`);
    return c.json({ success: true, data: report, message: 'Report submitted. Admin will review shortly.' }, 201);
  } catch (err) {
    throw err;
  }
}

async function getMyReports(c) {
  try {
    const qb = Report.find({ reporterId: c.get('user')._id });
    qb.sort({ createdAt: -1 });
    const reports = await qb.exec();
    return c.json({ success: true, data: reports });
  } catch (err) {
    throw err;
  }
}

async function getAllReports(c) {
  try {
    const { status, priority, targetType, page = 1, limit = 20 } = c.req.query();
    const query = {};
    if (status) query.status = status;
    if (priority) query.priority = priority;
    if (targetType) query.targetType = targetType;
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;
    const qb = Report.find(query);
    qb.populate('reporterId', 'username telegramId');
    qb.populate('targetUserId', 'username telegramId');
    qb.populate('targetListingId', 'title price');
    qb.populate('assignedTo', 'username');
    qb.populate('resolvedBy', 'username');
    qb.sort({ priority: -1, createdAt: -1 });
    qb.skip(skip);
    qb.limit(limitNum);
    const reports = await qb.exec();
    const total = await Report.countDocuments(query);
    return c.json({ success: true, data: reports, total, page: pageNum, limit: limitNum });
  } catch (err) {
    throw err;
  }
}

async function getReport(c) {
  try {
    const qb = Report.findById(c.req.param('id'));
    qb.populate('reporterId', 'username telegramId');
    qb.populate('targetUserId', 'username telegramId rating completedSales completedBuys');
    qb.populate('targetListingId', 'title price status');
    qb.populate('targetTransactionId', 'status agreedPrice');
    qb.populate('assignedTo', 'username');
    qb.populate('resolvedBy', 'username');
    const report = await qb;
    if (!report) throw new AppError('Report not found', 404);
    const user = c.get('user');
    if (String(report.reporterId._id) !== String(user._id) && user.role !== 'admin') {
      throw new AppError('Not authorized', 403);
    }
    return c.json({ success: true, data: report });
  } catch (err) {
    throw err;
  }
}

async function assignReport(c) {
  try {
    const body = await c.req.json();
    const { assignedTo = c.get('user')._id } = body;
    const report = await Report.findByIdAndUpdate(c.req.param('id'), { $set: { assignedTo } }, { new: true });
    if (!report) throw new AppError('Report not found', 404);
    return c.json({ success: true, data: report });
  } catch (err) {
    throw err;
  }
}

async function updateReportStatus(c) {
  try {
    const body = await c.req.json();
    const { status, resolution, actionTaken, adminNotes } = body;
    const report = await Report.findById(c.req.param('id'));
    if (!report) throw new AppError('Report not found', 404);
    report.status = status;
    report.resolution = resolution;
    report.actionTaken = actionTaken;
    report.adminNotes = adminNotes;
    if (['resolved', 'dismissed'].includes(status)) {
      report.resolvedAt = new Date();
      report.resolvedBy = c.get('user')._id;
    }
    await report.save();
    if (['resolved', 'dismissed'].includes(status)) {
      await notifyUser({
        userId: report.reporterId,
        type: 'report_resolved',
        title: status === 'resolved' ? 'Report Resolved' : 'Report Update',
        message: `Your report #${String(report._id).slice(-6)} has been ${status}.\n${resolution || ''}\nAction: ${actionTaken || 'None'}`,
        reportId: report._id,
        viaTelegram: true,
      });
    }
    return c.json({ success: true, data: report });
  } catch (err) {
    throw err;
  }
}

export {
  createReport,
  getMyReports,
  getAllReports,
  getReport,
  assignReport,
  updateReportStatus,
};
