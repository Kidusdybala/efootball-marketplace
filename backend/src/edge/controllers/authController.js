import User from '../models/User.js';
import { generateToken } from '../auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { notifyUser } from '../services/notificationService.js';

async function register(c) {
  try {
    const body = await c.req.json();
    const { username, email, password, role = 'buyer', firstName, lastName } = body;
    if (!username || !password) {
      throw new AppError('Username and password are required', 400);
    }
    if (email) {
      const existingEmail = await User.findOne({ email });
      if (existingEmail) throw new AppError('Email already in use', 400);
    }
    const existingUsername = await User.findOne({ username });
    if (existingUsername) throw new AppError('Username already taken', 400);

    const user = await User.create({
      username, email, password, role, firstName, lastName,
    });
    const token = generateToken(user._id);

    await notifyUser({
      userId: user._id,
      type: 'welcome',
      title: 'Welcome to AuraShop!',
      message: `Hi ${username}! Welcome to the EFootball Marketplace. Complete your profile and start trading safely.`,
      viaTelegram: false,
    });

    return c.json({ success: true, token, data: user }, 201);
  } catch (err) {
    throw err;
  }
}

async function login(c) {
  try {
    const body = await c.req.json();
    const { username, email, password } = body;
    if ((!username && !email) || !password) {
      throw new AppError('Provide username/email and password', 400);
    }
    const query = {};
    if (username) query.username = username;
    if (email) query.email = email.toLowerCase();
    const user = await User.findOne(query);
    if (!user || !(await user.comparePassword(password))) {
      throw new AppError('Invalid credentials', 401);
    }
    if (user.status === 'banned') {
      throw new AppError('Account banned: ' + (user.banReason || ''), 403);
    }
    const token = generateToken(user._id);
    user.password = undefined;
    return c.json({ success: true, token, data: user });
  } catch (err) {
    throw err;
  }
}

async function telegramAuth(c) {
  try {
    const body = await c.req.json();
    const { telegramId, username, firstName, lastName, photoUrl, chatId } = body;
    if (!telegramId) throw new AppError('Telegram ID is required', 400);
    let user = await User.findOne({ telegramId });
    let isNew = false;
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
      isNew = true;
    } else {
      if (chatId) user.telegramChatId = chatId;
      if (username) user.username = username;
      if (firstName) user.firstName = firstName;
      if (lastName) user.lastName = lastName;
      if (photoUrl) user.avatar = photoUrl;
      await user.save();
    }
    const token = generateToken(user._id);
    return c.json({ success: true, token, data: user, isNew });
  } catch (err) {
    throw err;
  }
}

async function me(c) {
  try {
    const user = c.get('user');
    return c.json({ success: true, data: user });
  } catch (err) {
    throw err;
  }
}

async function updateMe(c) {
  try {
    const body = await c.req.json();
    const { role, status, isVerified, rating, completedSales, completedBuys, ...allowedFields } = body;
    const user = await User.findByIdAndUpdate(c.get('user')._id, allowedFields, {
      new: true,
      select: '-password',
    });
    return c.json({ success: true, data: user });
  } catch (err) {
    throw err;
  }
}

async function changePassword(c) {
  try {
    const body = await c.req.json();
    const { currentPassword, newPassword } = body;
    if (!currentPassword || !newPassword) {
      throw new AppError('Current and new password required', 400);
    }
    const user = await User.findById(c.get('user')._id);
    if (!(await user.comparePassword(currentPassword))) {
      throw new AppError('Current password is incorrect', 401);
    }
    user.password = newPassword;
    await user.save();
    return c.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    throw err;
  }
}

async function upgradeToSeller(c) {
  try {
    const user = c.get('user');
    if (user.role === 'admin') {
      throw new AppError('Admin cannot change role', 400);
    }
    user.role = 'seller';
    await user.save();
    return c.json({ success: true, data: user, message: 'Upgraded to seller successfully' });
  } catch (err) {
    throw err;
  }
}

export {
  register,
  login,
  telegramAuth,
  me,
  updateMe,
  changePassword,
  upgradeToSeller,
};
