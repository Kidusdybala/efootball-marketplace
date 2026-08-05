const jwt = require('jsonwebtoken');
const User = require('../models/User');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d',
  });
};

const generateTelegramAuthToken = (telegramId) => {
  return jwt.sign({ telegramId, type: 'telegram' }, process.env.JWT_SECRET, {
    expiresIn: '1h',
  });
};

const verifyTelegramAuthToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
};

const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized - no token' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }
    if (user.status === 'banned') {
      return res.status(403).json({ success: false, message: 'Account banned', reason: user.banReason });
    }
    user.lastActive = new Date();
    await user.save({ validateBeforeSave: false });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Not authorized - invalid token' });
  }
};

const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions',
      });
    }
    next();
  };
};

const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  next();
};

const isSellerOrAdmin = (req, res, next) => {
  if (!['seller', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Seller or admin access required' });
  }
  next();
};

const isNotBanned = (req, res, next) => {
  if (req.user.status === 'banned' || req.user.status === 'suspended') {
    return res.status(403).json({
      success: false,
      message: 'Account is ' + req.user.status,
      reason: req.user.banReason,
    });
  }
  next();
};

module.exports = {
  generateToken,
  generateTelegramAuthToken,
  verifyTelegramAuthToken,
  protect,
  restrictTo,
  isAdmin,
  isSellerOrAdmin,
  isNotBanned,
};
