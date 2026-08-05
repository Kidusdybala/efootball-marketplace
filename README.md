# AuraShop — EFootball Account Marketplace (MVP)

A **Telegram Bot + Channel** marketplace for buying/selling EFootball accounts.
Seller submits listing → Admin approves → Channel post → Buyer & Seller agree deal privately → Buyer submits payment proof → Seller submits credentials → Admin releases → **Credentials wiped from DB immediately.

Pure Telegram keyboards only. **No websites, no webhooks, no ngrok.**

---

## 🏗 Architecture

| Layer | Tech |
|---|---|
| **UI** | Telegram Bot (polling mode) + Telegram Channel |
| **Backend** | Node.js + Express REST API (optional, for future use) |
| **Database** | MongoDB (Mongoose ODM) |
| **Security** | AES-256-GCM credential encryption → **deleted on release** |
| **Contact** | Channel button deep-links **DIRECTLY to seller's Telegram DM (privacy handled by users) |

### User Roles
- **Buyer** — Browse channel, agrees deal privately, submits payment proof via bot
- **Seller** — Creates listing via bot, submits credentials via bot
- **Admin** (`@kidusdybala` + `ADMIN_CHAT_ID`):
  - Approves/rejects listings
  - Receives payment proofs + credentials relayed from both sides
  - Checks their own bank/mobile money for actual payment arrival
  - Taps **RELEASE** button → delivers credentials to buyer + confirms seller → **DB credentials DELETED**

---

## 🚀 Quick Start

### 1. Prerequisites
- Node.js **18+**
- MongoDB (local install, or MongoDB Atlas URI)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- A public Telegram Channel (for listings catalog) — **add the bot as ADMIN with "Edit messages of others" permission
- Your numeric Telegram user ID (get it from [@userinfobot](https://t.me/userinfobot))

### 2. Install
```powershell
# Backend dependencies
npm run install:backend
```

### 3. Configure
Copy `backend/.env.example` → `backend/.env` and fill in:

```env
PORT=5000
NODE_ENV=development

MONGO_URI=mongodb://localhost:27017/aurashop-marketplace
JWT_SECRET=change_this_to_a_long_random_string
JWT_EXPIRE=7d

# Telegram
TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRstUvWxYz12345678
TELEGRAM_BOT_USERNAME=AuraShopBot               # Bot username WITHOUT @
TELEGRAM_CHANNEL_ID=@AuraShopCatalog             # Channel username (or numeric ID
ADMIN_CHAT_ID=123456789                        # YOUR numeric Telegram ID

# Security: min 32 chars. BACK THIS UP.
ENCRYPTION_KEY=my32byteOrLongerEncryptionKeyForCreds!!!

APP_URL=http://localhost:3000
API_URL=http://localhost:5000/api
```

### 4. Seed Demo Data (optional)
```powershell
npm run seed
```

### 5. Run
```powershell
# Prod
npm start

# Dev (nodemon auto-reload)
npm run dev
```

---

## 📋 MVP Flow (step by step)

```
1️⃣ SELLER: Runs /sell
   │  ┌──────────────────────────────────────────────────────────┐
   │  │ Title → Price → Platform (inline kb) → Overall →       │
   │  │ Team name → Featured players → Description →     │
   │  │ Negotiable? (inline kb) → EMAIL → PASSWORD → Extra │
   │  └──────────────────────────────────────────────────────────┘
   ▼
   Listing created as PENDING_REVIEW → SENT TO ADMIN_CHAT_ID
   with ✅ APPROVE & POST / ❌ REJECT buttons

2️⃣ ADMIN: Taps ✅ APPROVE & POST
   ▼
   Bot posts to TELEGRAM_CHANNEL_ID:
   ┌────────────────────────────────────────────────────┐
   │ 🟢 AVAILABLE                                      │
   │ 🏷️ "5000 Overall Endgame Account                │
   │ 💸 $150 (Negotiable)                              │
   │ 📱 PlayStation | ⚡ 5000 | 🏟️ PSG              │
   │ 👤 Seller: @seller_username ✅                  │
   │                                          │
   │ [ 💬 CONTACT SELLER (DM) ]  ← deep-links to  │
   │                                      t.me/seller_username    │
   └────────────────────────────────────────────────────┘

3️⃣ BUYER: Taps "💬 CONTACT SELLER" → opens seller's Telegram DM
   │
   │  Buyer and Seller NEGOTIATE PRIVATELY and agree on a deal
   │  (Buyer pays ADMIN the agreed amount via bank/mobile money/PayPal)
   ▼

4️⃣ BUYER: Runs /paid <listing_id>
   │   Bot asks for receipt → Buyer sends PHOTO or DOCUMENT (screenshot/PDF)
   ▼
   Receipt RELAYED to ADMIN_CHAT_ID → Admin views receipt file

5️⃣ SELLER: Runs /deliver <listing_id>
   │   Bot asks: ① email ② password ③ extra (backup/2FA/etc)
   ▼
   Credentials RELAYED to ADMIN_CHAT_ID → Admin views decrypted preview

6️⃣ ADMIN:
   │  ┌──────────────────────────────────────────────┐
   │  │ 💳 PAID: YES | 🔐 CREDS: YES          │
   │  │ ⚠️ BOTH RECEIVED — ready to release!  │
   │  │                                            │
   │  │ [ 🎉 RELEASE TO BUYER & WIPE CREDS ]  │
   │  └──────────────────────────────────────────────┘
   │  (Admin also CHECKS THEIR OWN BANK first ← OUTSIDE BOT)
   ▼

7️⃣ ADMIN TAPS RELEASE:
   ├─► Credentials SENT TO BUYER in Telegram DM
   ├─► "PAYMENT BEING SENT" message TO SELLER
   ├─► AccountCredentials document DELETED from MongoDB 🔥
   └─► Channel post EDITED → 🔴 SOLD - No longer available
```

---

## 🤖 Bot Commands

| Command | Role | Description |
|---|---|---|
| `/start` | All | Welcome, intro, command list |
| `/menu` `/home` `/help` | All | Open the inline main menu |
| `/sell` | Seller | 8-step listing creation + 3-step credentials via Telegram keyboards + texts |
| `/browse` `/buy` | Buyer | Browse 5 most recent listings (with Contact Seller button) |
| `/search <keyword>` | Buyer | Search by title/team/players/description |
| `/paid <listing_id>` | Buyer | Submit payment proof (receipt photo/PDF) → relayed to ADMIN_CHAT_ID
| `/deliver <listing_id>` | Seller | Submit email + password + extra via → relayed to ADMIN_CHAT_ID
| `/admin` | Admin | Pending approvals count + active escrows with Release button |

Listing IDs: you can use the short **last 8 characters** from the `Listing ID: a3f21b90` shown on every listing card.

---

## 🔐 Security Guarantees

1. **Credentials encrypted at rest with AES-256-GCM via `AccountCredentials.setEmail()/.setPassword()` etc. Only admin preview decryption during escrow.
2. **WIPED IMMEDIATELY** after successful release via `AccountCredentials.deleteOne({ _id: creds._id })` at `backend/src/telegram/bot.js:452`
3. **Only your own verification**: Admin manually checks their own bank/mobile money/payment processor — the bot never talks to payment APIs, eliminating hacked-receipt attacks.
4. Channel Contact Seller button goes direct `t.me/seller_username` — no bot relay, no username inventories to leak usernames on error.

---

## 🛠️ Development

Reset DB:
- Wipe `aurashop-marketplace` collections + `npm run seed`

---

## ✅ Diagnostics

- Full syntax check on all source files passed (`node --check` x 31 files)
- VS Code diagnostics: 0 errors/warnings
- No websites required. No ngrok required. Polling mode only.

## 📁 Project Structure

```
aurashop-marketplace/
├── package.json          # Root scripts
├── README.md             # This file
└── backend/
    ├── package.json
    ├── .env.example
    └── src/
        ├── server.js                 # Entry: dotenv → DB → Express → initBot()
        ├── app.js                    # Express middleware + routes + error handler
        ├── config/db.js              # Mongoose connect
        ├── middleware/               # JWT auth + RBAC
        ├── models/                 # 7 Mongoose schemas
        │   ├── Listing.js           # (updated: added escrowBuyerId, paidReceiptFileId, etc.)
        │   ├── AccountCredentials.js   # (AES-256-GCM, deleted on release)
        │   └── User.js / Transaction.js / Report.js / Message.js / Notification.js
        ├── controllers/ + routes/      # REST API endpoints (optional)
        ├── services/notificationService.js
        ├── telegram/
        │   └── bot.js             # ⭐ MVP bot (polling mode; 975 lines)
        └── utils/encryption.js + seed.js
```

---

## 📜 License

MIT
