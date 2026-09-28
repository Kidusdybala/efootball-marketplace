/**
 * Auth module - JWT helpers and Hono-compatible middleware
 */

import jwt from 'jsonwebtoken';
import User from './models/User.js';

const JWT_SECRET = process.env.JWT_SECRET || 'aurashop-jwt-secret-change-me';
const JWT_EXPIRE = process.env.JWT_EXPIRE || '7d';

function generateToken(id) {
  return jwt.sign({ id }, JWT_SECRET, { expiresIn: JWT_EXPIRE });
}

function generateTelegramAuthToken(telegramId) {
  return jwt.sign({ telegramId, type: 'telegram' }, JWT_SECRET, { expiresIn: '1h' });
}

function verifyTelegramAuthToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function protect() {
  return async (c, next) => {
    const authHeader = c.req.header('authorization');
    let token;
    if (authHeader && authHeader.startsWith('Bearer')) {
      token = authHeader.split(' ')[1];
    }
    if (!token) {
      return c.json({ success: false, message: 'Not authorized - no token' }, 401);
    }
    try {
      const decoded = verifyToken(token);
      if (!decoded) {
        return c.json({ success: false, message: 'Not authorized - invalid token' }, 401);
      }
      const user = await User.findById(decoded.id).select('-password');
      if (!user) {
        return c.json({ success: false, message: 'User not found' }, 401);
      }
      if (user.status === 'banned') {
        return c.json({ success: false, message: 'Account banned', reason: user.banReason }, 403);
      }
      user.lastActive = new Date();
      await user.save();
      c.set('user', user);
      await next();
    } catch (err) {
      return c.json({ success: false, message: 'Not authorized - invalid token' }, 401);
    }
  };
}

function restrictTo(...roles) {
  return (c, next) => {
    const user = c.get('user');
    if (!user || !roles.includes(user.role)) {
      return c.json({ success: false, message: 'Insufficient permissions' }, 403);
    }
    return next();
  };
}

function isAdmin(c, next) {
  const user = c.get('user');
  if (!user || user.role !== 'admin') {
    return c.json({ success: false, message: 'Admin access required' }, 403);
  }
  return next();
}

function isSellerOrAdmin(c, next) {
  const user = c.get('user');
  if (!user || !['seller', 'admin'].includes(user.role)) {
    return c.json({ success: false, message: 'Seller or admin access required' }, 403);
  }
  return next();
}

function isNotBanned(c, next) {
  const user = c.get('user');
  if (user && (user.status === 'banned' || user.status === 'suspended')) {
    return c.json({ success: false, message: 'Account is ' + user.status, reason: user.banReason }, 403);
  }
  return next();
}

export {
  generateToken,
  generateTelegramAuthToken,
  verifyTelegramAuthToken,
  verifyToken,
  protect,
  restrictTo,
  isAdmin,
  isSellerOrAdmin,
  isNotBanned,
  JWT_SECRET,
};
