/**
 * Telegram Bot API client using fetch
 * Replaces node-telegram-bot-api for Cloudflare Workers
 */

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

function telegramRequest(method, params = {}) {
  const url = `${API_URL}/${method}`;
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      body.append(key, String(value));
    }
  }

  return fetch(url, {
    method: 'POST',
    body,
  })
    .then(async res => {
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err = new Error(`Telegram API error: ${data.error_code || res.status} ${data.description || res.statusText}`);
        err.code = data.error_code || res.status;
        err.response = data;
        throw err;
      }
      return res.json();
    });
}

async function sendMessage(chatId, text, extra = {}) {
  const params = { chat_id: chatId, text };
  if (extra.parse_mode) params.parse_mode = extra.parse_mode;
  if (extra.reply_markup) params.reply_markup = JSON.stringify(extra.reply_markup);
  if (extra.reply_to_message_id) params.reply_to_message_id = extra.reply_to_message_id;
  return telegramRequest('sendMessage', params);
}

async function sendPhoto(chatId, photo, extra = {}) {
  const params = { chat_id: chatId, photo };
  if (extra.caption) params.caption = extra.caption;
  if (extra.parse_mode) params.parse_mode = extra.parse_mode;
  if (extra.reply_markup) params.reply_markup = JSON.stringify(extra.reply_markup);
  return telegramRequest('sendPhoto', params);
}

async function sendDocument(chatId, document, extra = {}) {
  const params = { chat_id: chatId, document };
  if (extra.caption) params.caption = extra.caption;
  if (extra.parse_mode) params.parse_mode = extra.parse_mode;
  if (extra.reply_markup) params.reply_markup = JSON.stringify(extra.reply_markup);
  return telegramRequest('sendDocument', params);
}

async function editMessageText(text, params = {}) {
  const p = { ...params, text };
  if (p.reply_markup) p.reply_markup = JSON.stringify(p.reply_markup);
  if (p.parse_mode) p.parse_mode = p.parse_mode;
  return telegramRequest('editMessageText', p);
}

async function editMessageReplyMarkup(reply_markup, params = {}) {
  const p = { ...params, reply_markup: JSON.stringify(reply_markup) };
  return telegramRequest('editMessageReplyMarkup', p);
}

async function deleteMessage(chatId, messageId) {
  return telegramRequest('deleteMessage', { chat_id: chatId, message_id: messageId });
}

async function answerCallbackQuery(callbackId, params = {}) {
  const p = { callback_query_id: callbackId };
  if (params.text) p.text = params.text;
  if (params.show_alert) p.show_alert = params.show_alert;
  return telegramRequest('answerCallbackQuery', p);
}

async function getFile(fileId) {
  return fetch(`${API_URL}/getFile?file_id=${encodeURIComponent(fileId)}`)
    .then(async res => {
      if (!res.ok) throw new Error(`getFile failed: ${res.status}`);
      return res.json();
    });
}

async function downloadFile(fileId) {
  const fileInfo = await getFile(fileId);
  const filePath = fileInfo.result.file_path;
  if (!filePath) throw new Error('No file path returned');
  const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
  const response = await fetch(fileUrl);
  if (!response.ok) throw new Error(`File download failed: ${response.status}`);
  return response.arrayBuffer();
}

async function setWebhook(url, allowedUpdates = null) {
  const params = { url };
  if (allowedUpdates) params.allowed_updates = JSON.stringify(allowedUpdates);
  return telegramRequest('setWebhook', params);
}

async function deleteWebhook(dropPendingUpdates = false) {
  const params = { drop_pending_updates: dropPendingUpdates };
  return telegramRequest('deleteWebhook', params);
}

async function getWebhookInfo() {
  return telegramRequest('getWebhookInfo', {});
}

async function getMe() {
  return telegramRequest('getMe', {});
}

export {
  sendMessage,
  sendPhoto,
  sendDocument,
  editMessageText,
  editMessageReplyMarkup,
  deleteMessage,
  answerCallbackQuery,
  getFile,
  downloadFile,
  setWebhook,
  deleteWebhook,
  getWebhookInfo,
  getMe,
  telegramRequest,
};
