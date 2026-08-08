const User = require('../models/User');

const parseCsv = (v) => (v || '').split(',').map(s => s.trim()).filter(Boolean);
const uniq = (arr) => Array.from(new Set((arr || []).map(String).filter(Boolean)));
const getAdminIds = () => uniq([...parseCsv(process.env.ADMIN_TELEGRAM_IDS), process.env.ADMIN_CHAT_ID]);
const isAdminTelegramId = (id) => getAdminIds().includes(String(id));
const getAdminChatIds = () => getAdminIds();

const LEGACY_SERVICE_FEE_RATE = 0.1;

const calculateAdminFee = (sellerPrice) => {
  if (sellerPrice <= 2000) return 100;
  if (sellerPrice <= 10000) return 200;
  return 300;
};

const getOrCreateUser = async (tgUser, chatId) => {
  let user = await User.findOne({ telegramId: String(tgUser.id) });
  const admin = isAdminTelegramId(tgUser.id);
  if (!user) {
    user = await User.create({
      telegramId: String(tgUser.id),
      username: tgUser.username || `tg_${tgUser.id}`,
      firstName: tgUser.first_name,
      lastName: tgUser.last_name,
      telegramChatId: String(chatId),
      role: admin ? 'admin' : 'buyer',
      isVerified: admin,
      preferences: { notifyTelegram: true, notifyEmail: false },
    });
  } else {
    if (tgUser.first_name) user.firstName = tgUser.first_name;
    if (tgUser.last_name) user.lastName = tgUser.last_name;
    if (tgUser.username) user.username = tgUser.username;
    user.telegramChatId = String(chatId);
    if (admin) { user.role = 'admin'; user.isVerified = true; }
    await user.save();
  }
  return user;
};

const shortId = (id) => String(id).slice(-8);

module.exports = {
  parseCsv,
  uniq,
  getAdminIds,
  isAdminTelegramId,
  getAdminChatIds,
  LEGACY_SERVICE_FEE_RATE,
  calculateAdminFee,
  getOrCreateUser,
  shortId,
};
