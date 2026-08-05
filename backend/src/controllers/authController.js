const User = require('../models/User');
const { generateToken } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const { notifyUser } = require('../services/notificationService');

exports.register = async (req, res, next) => {
  try {
    const { username, email, password, role = 'buyer', firstName, lastName } = req.body;
    if (!username || !password) {
      return next(new AppError('Username and password are required', 400));
    }
    if (email) {
      const existingEmail = await User.findOne({ email });
      if (existingEmail) return next(new AppError('Email already in use', 400));
    }
    const existingUsername = await User.findOne({ username });
    if (existingUsername) return next(new AppError('Username already taken', 400));

    const user = await User.create({
      username,
      email,
      password,
      role,
      firstName,
      lastName,
    });
    user.password = undefined;
    const token = generateToken(user._id);

    await notifyUser({
      userId: user._id,
      type: 'welcome',
      title: 'Welcome to AuraShop!',
      message: `Hi ${username}! Welcome to the EFootball Marketplace. Complete your profile and start trading safely.`,
      viaTelegram: false,
    });

    res.status(201).json({
      success: true,
      token,
      data: user,
    });
  } catch (err) {
    next(err);
  }
};

exports.login = async (req, res, next) => {
  try {
    const { username, email, password } = req.body;
    if ((!username && !email) || !password) {
      return next(new AppError('Provide username/email and password', 400));
    }
    const query = {};
    if (username) query.username = username;
    if (email) query.email = email.toLowerCase();
    const user = await User.findOne(query).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      return next(new AppError('Invalid credentials', 401));
    }
    if (user.status === 'banned') {
      return next(new AppError('Account banned: ' + (user.banReason || ''), 403));
    }
    user.password = undefined;
    const token = generateToken(user._id);
    res.json({ success: true, token, data: user });
  } catch (err) {
    next(err);
  }
};

exports.telegramAuth = async (req, res, next) => {
  try {
    const { telegramId, username, firstName, lastName, photoUrl, chatId } = req.body;
    if (!telegramId) return next(new AppError('Telegram ID is required', 400));
    let user = await User.findOne({ telegramId });
    if (!user) {
      user = await User.create({
        telegramId,
        username: username || `tg_${telegramId}`,
        firstName,
        lastName,
        avatar: photoUrl,
        telegramChatId: chatId,
        role: 'buyer',
      });
    } else {
      if (chatId) user.telegramChatId = chatId;
      if (username) user.username = username;
      if (firstName) user.firstName = firstName;
      if (lastName) user.lastName = lastName;
      if (photoUrl) user.avatar = photoUrl;
      await user.save();
    }
    const token = generateToken(user._id);
    res.json({ success: true, token, data: user, isNew: !user });
  } catch (err) {
    next(err);
  }
};

exports.me = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
};

exports.updateMe = async (req, res, next) => {
  try {
    const { role, status, isVerified, rating, completedSales, completedBuys, ...allowedFields } = req.body;
    const user = await User.findByIdAndUpdate(req.user._id, allowedFields, {
      new: true,
      runValidators: true,
    });
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
};

exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return next(new AppError('Current and new password required', 400));
    }
    const user = await User.findById(req.user._id).select('+password');
    if (!(await user.comparePassword(currentPassword))) {
      return next(new AppError('Current password is incorrect', 401));
    }
    user.password = newPassword;
    await user.save();
    user.password = undefined;
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    next(err);
  }
};

exports.upgradeToSeller = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (user.role === 'admin') {
      return next(new AppError('Admin cannot change role', 400));
    }
    user.role = 'seller';
    await user.save();
    res.json({ success: true, data: user, message: 'Upgraded to seller successfully' });
  } catch (err) {
    next(err);
  }
};
