require("dotenv").config();

const express = require("express");
const cors = require("cors");
const http = require("http");
const rateLimit = require("express-rate-limit");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const connectDB = require("./config/db");
const cookieParser = require("cookie-parser");


/* ======================================================
   APP
====================================================== */

const app = express();

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/* ======================================================
   CONFIG
====================================================== */
const CORE_API_URL = String(process.env.CORE_API_URL || "").replace(/\/+$/, "");
const CORE_USERS_ENDPOINTS = (process.env.CORE_USERS_ENDPOINTS || "/api/users,/api/admin/users,/api/clients,/api/leads,/api/registers")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || process.env.ADMIN_USER || "";
const ADMIN_PASS = process.env.ADMIN_PASS || process.env.ADMIN_PASSWORD || "";
const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_JWT_SECRET || "admin-secret-dev";
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "";

const ZOHO_ENABLED = String(process.env.ZOHO_ENABLED || "true").toLowerCase() !== "false";
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || "";
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || "";
const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || "";
const ZOHO_ACCOUNTS_URL = (process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com").replace(/\/+$/, "");
const ZOHO_API_BASE_URL = (process.env.ZOHO_API_BASE_URL || "https://www.zohoapis.com").replace(/\/+$/, "");
const ZOHO_MODULE = process.env.ZOHO_MODULE || "Leads";
const ZOHO_FALLBACK_MODULE = process.env.ZOHO_FALLBACK_MODULE || "Contacts";
const ZOHO_LAST_NAME_FIELD = process.env.ZOHO_LAST_NAME_FIELD || "Last_Name";
const ZOHO_EMAIL_FIELD = process.env.ZOHO_EMAIL_FIELD || "Email";
const ZOHO_PHONE_FIELD = process.env.ZOHO_PHONE_FIELD || "Phone";
const ZOHO_ADDRESS_FIELD = process.env.ZOHO_ADDRESS_FIELD || "Street";
const ZOHO_FIRST_NAME_FIELD = process.env.ZOHO_FIRST_NAME_FIELD || "First_Name";
const ZOHO_COMPANY_FIELD = process.env.ZOHO_COMPANY_FIELD || "Company";
const ZOHO_SYNC_INTERVAL_MS = Number(process.env.ZOHO_SYNC_INTERVAL_MS || 300000);

if (!CORE_API_URL) {
  console.warn("⚠️ CORE_API_URL no definido. Se usará modo local si hace falta.");
}

if (ZOHO_ENABLED && (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN)) {
  console.warn("⚠️ Zoho habilitado pero faltan ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN.");
}

/* ======================================================
   DB
====================================================== */
Promise.resolve(connectDB()).catch((err) => {
  console.error("Error conectando DB:", err?.message || err);
});

mongoose.connection.on("connected", () => {
  console.log("✅ Mongo conectado");
  startAdminRealtimeFeed();
});

mongoose.connection.on("error", (err) => {
  console.error("❌ Mongo connection error:", err);
});

mongoose.connection.on("disconnected", () => {
  console.warn("⚠️ Mongo disconnected");
});
/* ======================================================
   MODELOS
====================================================== */
const userSchema = new mongoose.Schema(
  {
    sourceId: { type: String, index: true },
    email: { type: String, index: true },
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    fullName: { type: String, default: "" },
    phone: { type: String, default: "" },
    address: { type: String, default: "" },
    password: { type: String, select: false },
    balance: { type: Number, default: 0 },
    leverage: { type: Number, default: 1 },
    currency: { type: String, default: "USD" },
    role: { type: String, default: "" },
    isAdmin: { type: Boolean, default: false },
    admin: { type: Boolean, default: false },
    zohoLeadId: { type: String, default: "" },
    zohoContactId: { type: String, default: "" },
    zohoModule: { type: String, default: "" },
    zohoSyncStatus: { type: String, default: "" },
    zohoLastError: { type: String, default: "" },
    zohoSyncedAt: { type: Date, default: null },
    source: { type: String, default: "core" },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { minimize: false, strict: false }
);

const walletSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    balanceOwn: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    credit: { type: Number, default: 0 },
    marginUsed: { type: Number, default: 0 },
    leverageFactor: { type: Number, default: 1 },
    equity: { type: Number, default: 0 },
    freeMargin: { type: Number, default: 0 },
    marginLevel: { type: Number, default: 0 },
    currency: { type: String, default: "USD" },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { minimize: false, strict: false }
);

const transactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    userId: { type: String, index: true },
    type: { type: String, index: true },
    amount: { type: Number, default: 0 },
    status: { type: String, default: "completed" },
    note: { type: String, default: "" },
    balanceBefore: { type: Number, default: 0 },
    balanceAfter: { type: Number, default: 0 },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    source: { type: String, default: "admin-server.js" },
    createdAt: { type: Date, default: Date.now },
  },
  { minimize: false, strict: false }
);

const positionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    symbol: { type: String, index: true },
    side: { type: String, default: "BUY" },
    qty: { type: Number, default: 0 },
    entryPrice: { type: Number, default: 0 },
    currentPrice: { type: Number, default: 0 },
    closePrice: { type: Number, default: 0 },
    marginReserved: { type: Number, default: 0 },
    leverage: { type: Number, default: 1 },
    status: { type: String, default: "OPEN", index: true },
    pnl: { type: Number, default: 0 },
    realizedPnl: { type: Number, default: 0 },
    closedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { minimize: false, strict: false }
);

const withdrawSchema = new mongoose.Schema(
  {
    userId: { type: String, index: true },
    amount: { type: Number, default: 0 },
    method: { type: String, default: "" },
    walletAddress: { type: String, default: "" },
    status: { type: String, default: "pending", index: true },
    note: { type: String, default: "" },
    adminNote: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { minimize: false, strict: false }
);

const documentSchema = new mongoose.Schema(
  {
    userId: { type: String, index: true },
    type: { type: String, default: "identity" },
    documentUrl: { type: String, default: "" },
    fileName: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    status: { type: String, default: "pending", index: true },
    adminNote: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { minimize: false, strict: false }
);

const Document = mongoose.models.Document || mongoose.model("Document", documentSchema);
const User = mongoose.models.User || mongoose.model("User", userSchema);
const Wallet = mongoose.models.Wallet || mongoose.model("Wallet", walletSchema);
const Transaction = mongoose.models.Transaction || mongoose.model("Transaction", transactionSchema);
const Position = mongoose.models.Position || mongoose.model("Position", positionSchema);
const Withdraw = mongoose.models.Withdraw || mongoose.model("Withdraw", withdrawSchema);

/* ======================================================
   HELPERS
====================================================== */
function getCookie(req, name) {
  const cookieHeader = req.headers.cookie || "";
  for (const part of cookieHeader.split(";").map((p) => p.trim())) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = decodeURIComponent(part.slice(0, idx).trim());
    const v = decodeURIComponent(part.slice(idx + 1).trim());
    if (k === name) return v;
  }
  return null;
}

async function openUser(userId) {
  if (adminRealtimeTimer) {
    clearInterval(adminRealtimeTimer);
    adminRealtimeTimer = null;
  }

  currentAdminUserId = userId;

  await loadDocuments(userId);
  await loadWithdraws(userId);

  adminRealtimeTimer = setInterval(async () => {
    await loadDocuments(userId);
    await loadWithdraws(userId);
  }, 5000);
}

function normalizeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function escapeLike(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeNameParts(name = "") {
  const raw = String(name || "").trim().replace(/\s+/g, " ");
  if (!raw) return { firstName: "", lastName: "" };
  const parts = raw.split(" ");
  if (parts.length === 1) return { firstName: "", lastName: parts[0] };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.slice(-1)[0] };
}

function compactSymbol(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeSide(value) {
  const s = String(value || "").trim().toUpperCase();
  if (["BUY", "LONG", "BULL"].includes(s)) return "BUY";
  if (["SELL", "SHORT", "BEAR"].includes(s)) return "SELL";
  return "";
}

function computePositionPnl(position = {}, currentPrice = null) {
  const entry = Number(position.entryPrice ?? position.price ?? position.openPrice ?? 0) || 0;
  const qty = Number(position.qty ?? position.quantity ?? position.amount ?? position.positionSize ?? 0) || 0;
  const side = normalizeSide(position.side || position.direction || position.positionSide);
  const px = Number(currentPrice ?? position.currentPrice ?? entry) || entry;
  const sign = side === "SELL" ? -1 : 1;
  return (px - entry) * qty * sign;
}

function annotatePosition(position = {}) {
  const entryPrice = Number(position.entryPrice ?? position.price ?? position.openPrice ?? 0) || 0;
  const currentPrice = Number(position.currentPrice ?? entryPrice) || entryPrice;
  const qty = Number(position.qty ?? position.quantity ?? position.amount ?? position.positionSize ?? 0) || 0;
  const pnl =
    String(position.status || "").toUpperCase() === "CLOSED"
      ? Number(position.realizedPnl ?? position.pnl ?? 0) || 0
      : computePositionPnl({ ...position, entryPrice, qty }, currentPrice);

  return {
    ...position,
    entryPrice,
    currentPrice,
    qty,
    pnl,
    unrealizedPnl: pnl,
    isOpen: String(position.status || "").toUpperCase() !== "CLOSED",
  };
}

function getEffectiveBalance(userDoc, walletDoc) {
  const walletBalance = Number(walletDoc?.balanceOwn ?? walletDoc?.balance);
  const userBalance = Number(userDoc?.balance ?? 0);
  if (Number.isFinite(walletBalance) && walletBalance >= 0) return walletBalance;
  if (Number.isFinite(userBalance) && userBalance >= 0) return userBalance;
  return 0;
}

async function getUserDocFromBearer(req) {
  try {
    const auth = req.headers.authorization || req.headers.Authorization || null;
    if (!auth || !auth.toLowerCase().startsWith("bearer ")) return null;
    const token = String(auth).split(" ")[1];
    if (!token) return null;
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      return null;
    }
    const userId = payload && (payload.id || payload.sub || payload.userId || payload._id);
    if (!userId) return null;
    return await User.findById(userId).catch(() => null);
  } catch {
    return null;
  }
}

function isAdminTokenValid(req) {
  const auth = req.headers.authorization || req.headers.Authorization || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const tokenFromCookie = getCookie(req, "admin_token");
  const token = bearer || tokenFromCookie;
  if (!token) return false;

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return !!decoded && (decoded.admin === true || decoded.role === "admin");
  } catch {
    return false;
  }
}

function ensureAdminAuth(req, res, next) {
  try {
    if (ADMIN_API_KEY) {
      const key = req.headers["x-admin-api-key"] || req.headers["x-admin-key"] || req.headers["admin-key"] || "";
      if (key && key === ADMIN_API_KEY) return next();
    }
    if (isAdminTokenValid(req)) return next();
    return res.status(401).json({ ok: false, msg: "No autorizado" });
  } catch {
    return res.status(401).json({ ok: false, msg: "No autorizado" });
  }
}

function rewriteSetCookie(cookie) {
  return String(cookie || "").replace(/;\s*Domain=[^;]+/gi, "").replace(/;\s*domain=[^;]+/gi, "");
}

function relaySetCookies(fromHeaders, toRes) {
  const cookies = [];
  try {
    if (fromHeaders && typeof fromHeaders.getSetCookie === "function") {
      const arr = fromHeaders.getSetCookie();
      if (Array.isArray(arr) && arr.length) cookies.push(...arr);
    }
  } catch {}
  try {
    const single = fromHeaders?.get?.("set-cookie");
    if (single) cookies.push(single);
  } catch {}
  if (cookies.length) toRes.setHeader("set-cookie", cookies.map(rewriteSetCookie));
}

function buildCoreUrl(endpoint) {
  const base = CORE_API_URL.replace(/\/+$/, "");
  const route = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return `${base}${route}`;
}

async function proxyToCore(req, endpoint, options = {}) {
  if (!CORE_API_URL || !fetchFn) {
    return { ok: false, status: 503, data: { ok: false, error: "core_api_not_configured" }, headers: null };
  }

  try {
    const response = await fetchFn(buildCoreUrl(endpoint), {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        "x-admin-api-key": ADMIN_API_KEY || req.headers["x-admin-api-key"] || "",
        "x-admin-key": ADMIN_API_KEY || req.headers["x-admin-key"] || "",
        authorization: req.headers.authorization || req.headers.Authorization || "",
        cookie: req.headers.cookie || "",
        ...(options.headers || {}),
      },
      body:
        options.body === undefined || options.body === null
          ? undefined
          : typeof options.body === "string"
          ? options.body
          : JSON.stringify(options.body),
    });

    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { ok: false, raw: text };
    }

    return { ok: response.ok, status: response.status, data, headers: response.headers };
  } catch (err) {
    console.error("❌ Proxy error:", err?.message || err);
    return { ok: false, status: 500, data: { ok: false, error: "proxy_error", message: err?.message || String(err) }, headers: null };
  }
}

function getIo() {
  return io;
}

function emitStateUpdates(userId, accountPayload = null, positions = null, transaction = null) {
  try {
    const socket = getIo();
    socket.emit("wallet_update", { userId, account: accountPayload?.account || accountPayload });
    socket.emit("account_update", { userId, account: accountPayload?.account || accountPayload });
    if (Array.isArray(positions)) socket.emit("positions_update", { userId, positions });
    if (transaction) socket.emit("transactions_update", { userId, transaction });
    socket.emit("admin:balance-updated", { userId, account: accountPayload?.account || accountPayload });
    if (transaction) socket.emit("admin:transaction-created", { userId, transaction });
    if (accountPayload?.account?.balance !== undefined) socket.emit(`balance:${userId}`, accountPayload.account.balance);
  } catch (e) {
    console.warn("emitStateUpdates error:", e?.message || e);
  }
}

const ADMIN_REALTIME_SEED_LIMIT = Number(process.env.ADMIN_REALTIME_SEED_LIMIT || 200);
const ADMIN_REALTIME_POLL_MS = Number(process.env.ADMIN_REALTIME_POLL_MS || 5000);

let adminRealtimeStarted = false;
let adminRealtimeTimer = null;
const seenWithdrawIds = new Set();
const seenDocumentIds = new Set();

function trimSeenSet(set, maxSize = 1000) {
  if (set.size <= maxSize) return;
  const arr = Array.from(set);
  const removeCount = set.size - maxSize;
  for (let i = 0; i < removeCount; i++) {
    set.delete(arr[i]);
  }
}

/* ======================================================
   LOAD WITHDRAWS
====================================================== */
async function loadWithdraws({
  userId = null,
  status = "all",
  limit = 100,
}) {
  try {
    const query = {};

    if (userId) {
      query.userId = String(userId);
    }

    const withdraws = await Withdraw.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec()
      .catch(() => []);

    const normalized = withdraws.map((w) => {
      const normalizedStatus = (
        w.status ||
        w.Estado ||
        "pending"
      ).toString().toLowerCase();

      return {
        _id: String(w._id),

        userId:
          String(w.userId || ""),

        amount:
          Number(
            w.amount ??
            w.Amount ??
            w.Cantidad ??
            0
          ),

        account:
          w.account ||
          w.Account ||
          w.Cuenta ||
          "",

        proofUrl:
          w.proofUrl ||
          "",

        status: normalizedStatus,

        Estado: normalizedStatus,

        adminNote:
          w.adminNote ||
          "",

        createdAt:
          w.createdAt ||
          w.actualizadoAt ||
          new Date(),
      };
    });

    if (status !== "all") {
      return normalized.filter(
        (w) => w.status === status.toLowerCase()
      );
    }

    return normalized;
  } catch (err) {
    console.error("loadWithdraws error:", err);
    return [];
  }
}


/* ======================================================
   LOAD DOCUMENTS
====================================================== */
async function loadDocuments({
  userId = null,
  status = "all",
  limit = 100,
}) {
  try {
    const query = {};

    if (userId) {
      query.userId = String(userId);
    }

    const documents = await Document.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec()
      .catch(() => []);

    const normalized = documents.map((doc) => {
      const normalizedStatus = (
        doc.status ||
        doc.Estado ||
        "pending"
      ).toString().toLowerCase();

      return {
        _id: String(doc._id),

        userId: String(doc.userId || ""),

        type:
          doc.type ||
          doc.Tipo ||
          "Documento",

        documentUrl:
          doc.documentUrl ||
          doc.url ||
          "",

        status: normalizedStatus,

        Estado: normalizedStatus,

        adminNote:
          doc.adminNote ||
          "",

        createdAt:
          doc.createdAt ||
          doc.actualizadoAt ||
          new Date(),
      };
    });

    if (status !== "all") {
      return normalized.filter(
        (d) => d.status === status.toLowerCase()
      );
    }

    return normalized;
  } catch (err) {
    console.error("loadDocuments error:", err);
    return [];
  }
}
async function seedAdminRealtimeCache() {
  const [withdraws, documents] = await Promise.all([
    Withdraw.find({}).sort({ createdAt: -1 }).limit(ADMIN_REALTIME_SEED_LIMIT).lean().exec().catch(() => []),
    Document.find({}).sort({ createdAt: -1 }).limit(ADMIN_REALTIME_SEED_LIMIT).lean().exec().catch(() => []),
  ]);

  for (const w of withdraws) {
    if (w?._id) seenWithdrawIds.add(String(w._id));
  }

  for (const d of documents) {
    if (d?._id) seenDocumentIds.add(String(d._id));
  }

  trimSeenSet(seenWithdrawIds);
  trimSeenSet(seenDocumentIds);
}

async function broadcastNewAdminItems() {
  const [withdraws, documents] = await Promise.all([
    Withdraw.find({}).sort({ createdAt: -1 }).limit(50).lean().exec().catch(() => []),
    Document.find({}).sort({ createdAt: -1 }).limit(50).lean().exec().catch(() => []),
  ]);

  for (const w of [...withdraws].reverse()) {
    const id = String(w?._id || "");
    if (!id || seenWithdrawIds.has(id)) continue;
    seenWithdrawIds.add(id);

    io.emit("withdraw:new", { withdraw: w });
    io.emit("admin:withdraw:new", { withdraw: w });

    if (w.userId) {
      io.emit(`withdraw:${w.userId}`, { withdraw: w });
    }
  }

  for (const d of [...documents].reverse()) {
    const id = String(d?._id || "");
    if (!id || seenDocumentIds.has(id)) continue;
    seenDocumentIds.add(id);

    io.emit("document:new", { document: d });
    io.emit("admin:document:new", { document: d });

    if (d.userId) {
      io.emit(`document:${d.userId}`, { document: d });
    }
  }

  trimSeenSet(seenWithdrawIds);
  trimSeenSet(seenDocumentIds);
}

function startAdminRealtimeFeed() {
  if (adminRealtimeStarted) return;
  adminRealtimeStarted = true;

  seedAdminRealtimeCache()
    .then(() => {
      broadcastNewAdminItems().catch(() => {});
      adminRealtimeTimer = setInterval(() => {
        broadcastNewAdminItems().catch((err) => {
          console.warn("admin realtime poll error:", err?.message || err);
        });
      }, ADMIN_REALTIME_POLL_MS);

      if (adminRealtimeTimer && typeof adminRealtimeTimer.unref === "function") {
        adminRealtimeTimer.unref();
      }

      console.log("✅ Realtime admin de retiros/documentos iniciado");
    })
    .catch((err) => {
      console.warn("No se pudo iniciar cache realtime admin:", err?.message || err);
    });
}

function signAdminToken(payload = {}) {
  return jwt.sign(
    {
      admin: true,
      role: "admin",
      email: payload.email || ADMIN_EMAIL || "admin",
    },
    JWT_SECRET,
    { expiresIn: "8h" }
  );
}

function normalizeWalletSnapshot(wallet, openPnl = 0) {
  const balanceOwn = Number(wallet?.balanceOwn ?? wallet?.balance ?? 0) || 0;
  const credit = Number(wallet?.credit ?? 0) || 0;
  const marginUsed = Math.max(Number(wallet?.marginUsed ?? 0) || 0, 0);
  const equity = balanceOwn + openPnl;
  const freeMargin = Math.max(equity + credit - marginUsed, 0);
  const marginLevel = marginUsed > 0 ? (equity / marginUsed) * 100 : 0;

  return {
    balance: balanceOwn,
    balanceOwn,
    credit,
    equity,
    marginUsed,
    freeMargin,
    marginLevel,
    leverageFactor: Number(wallet?.leverageFactor ?? 1) || 1,
    currency: wallet?.currency || "USD",
    openPnl,
  };
}

async function getWalletForUser(userId) {
  return await Wallet.findOne({ user: userId }).lean().exec().catch(() => null);
}

async function getWalletDocForUser(userId) {
  let wallet = await Wallet.findOne({ user: userId }).catch(() => null);
  if (!wallet) {
    wallet = new Wallet({
      user: userId,
      balanceOwn: 0,
      balance: 0,
      credit: 0,
      marginUsed: 0,
      leverageFactor: 1,
      equity: 0,
      freeMargin: 0,
      marginLevel: 0,
      currency: "USD",
    });
  }
  return wallet;
}

async function getPositionsForUser(userId) {
  return await Position.find({ user: userId }).sort({ createdAt: -1 }).lean().exec().catch(() => []);
}

async function loadTransactionsForUser(userId, limit = 50) {
  return await Transaction.find({ user: userId }).sort({ createdAt: -1 }).limit(limit).lean().exec().catch(() => []);
}

/* ======================================================
   LOAD WITHDRAWS FOR USER
====================================================== */
async function loadWithdrawsForUser(userId, status = "all") {
  return await loadWithdraws({
    userId,
    status,
    limit: 500,
  });
}
async function recordTransaction({
  user,
  type,
  amount = 0,
  status = "completed",
  note = "",
  balanceBefore = 0,
  balanceAfter = 0,
  meta = {},
  source = "admin-server.js",
}) {
  try {
    const payload = {
      user: user?._id || null,
      userId: String(user?._id || ""),
      type,
      amount: Number(amount) || 0,
      status,
      note,
      balanceBefore: Number(balanceBefore) || 0,
      balanceAfter: Number(balanceAfter) || 0,
      meta,
      source,
      createdAt: new Date(),
    };
    const tx = await Transaction.create(payload);
    return tx.toObject ? tx.toObject() : tx;
  } catch (err) {
    console.warn("recordTransaction fallback:", err?.message || err);
    return {
      userId: String(user?._id || ""),
      type,
      amount: Number(amount) || 0,
      status,
      note,
      balanceBefore: Number(balanceBefore) || 0,
      balanceAfter: Number(balanceAfter) || 0,
      meta,
      source,
      createdAt: new Date().toISOString(),
    };
  }
}

async function buildAccountForUser(userDoc) {
  const wallet = await getWalletForUser(userDoc._id);
  const positions = await getPositionsForUser(userDoc._id);
  const recentTransactions = await loadTransactionsForUser(userDoc._id, 20);

  const walletSnapshot = wallet?.toObject ? wallet.toObject() : wallet;
  const balance = getEffectiveBalance(userDoc, walletSnapshot);
  const openPnl = (positions || []).reduce((sum, p) => sum + (Number(p.pnl ?? 0) || 0), 0);

  const normalizedWallet = normalizeWalletSnapshot(
    walletSnapshot ? { ...walletSnapshot, balanceOwn: balance, balance } : { balanceOwn: balance, balance },
    openPnl
  );

  return {
    account: {
      ...normalizedWallet,
      balance,
      balanceOwn: balance,
      equity: balance,
      leverage: Number(userDoc.leverage ?? walletSnapshot?.leverageFactor ?? 100) || 100,
      currency: userDoc.currency || walletSnapshot?.currency || "USD",
      positions: positions || [],
      openPositions: positions || [],
      recentTransactions,
      transactions: recentTransactions,
      openPnl,
    },
    user: userDoc.toObject ? userDoc.toObject() : userDoc,
    wallet: walletSnapshot,
    positions,
    transactions: recentTransactions,
  };
}

async function getTargetUserForAdmin(req, res) {
  const userId = req.params?.userId || req.query?.userId || req.body?.userId || null;

  if (userId) {
    const user = await User.findById(userId).catch(() => null);
    if (!user) {
      res.status(404).json({ ok: false, msg: "Usuario no encontrado" });
      return null;
    }
    return user;
  }

  const bearerUser = await getUserDocFromBearer(req);
  if (bearerUser) return bearerUser;

  res.status(401).json({ ok: false, msg: "No autorizado" });
  return null;
}

/* ======================================================
   ZOHO
====================================================== */
let zohoAccessTokenCache = null;
let zohoAccessTokenExpiresAt = 0;
let zohoSyncLock = false;
const zohoQueue = new Set();

function zohoReady() {
  return !!(process.env.ZOHO_ENABLED !== "false" && process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET && process.env.ZOHO_REFRESH_TOKEN);
}

async function getZohoAccessToken() {
  if (!zohoReady() || !fetchFn) return null;
  const now = Date.now();
  if (zohoAccessTokenCache && now < zohoAccessTokenExpiresAt - 30_000) return zohoAccessTokenCache;

  const url = `${(process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com").replace(/\/+$/, "")}/oauth/v2/token?refresh_token=${encodeURIComponent(process.env.ZOHO_REFRESH_TOKEN)}&client_id=${encodeURIComponent(process.env.ZOHO_CLIENT_ID)}&client_secret=${encodeURIComponent(process.env.ZOHO_CLIENT_SECRET)}&grant_type=refresh_token`;
  const response = await fetchFn(url, { method: "POST" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.access_token) throw new Error(`Zoho token error: ${data?.error || data?.error_description || response.statusText}`);

  zohoAccessTokenCache = data.access_token;
  const expiresInSec = Number(data.expires_in || 3600);
  zohoAccessTokenExpiresAt = Date.now() + expiresInSec * 1000;
  return zohoAccessTokenCache;
}

async function zohoRequest(pathname, options = {}) {
  const token = await getZohoAccessToken();
  if (!token) throw new Error("Zoho no configurado");
  const res = await fetchFn(`${(process.env.ZOHO_API_BASE_URL || "https://www.zohoapis.com").replace(/\/+$/, "")}/crm/v8${pathname}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

function normalizeCoreUser(raw = {}) {
  const email = String(raw.email || raw.emailAddress || raw.correo || "").trim().toLowerCase();
  const phone = String(raw.phone || raw.telefono || raw.mobile || "").trim();
  const address = String(raw.address || raw.direccion || raw.street || "").trim();
  const fullName = String(raw.fullName || raw.nombre || raw.name || "").trim();
  const parts = normalizeNameParts(fullName);
  const firstName = String(raw.firstName || raw.nombre1 || parts.firstName || "").trim();
  const lastName = String(raw.lastName || raw.apellido || parts.lastName || "").trim();
  const balance = normalizeNumber(raw.balance, 0);
  const leverage = normalizeNumber(raw.leverage, 1);
  const sourceId = String(raw.id || raw._id || raw.userId || raw.sourceId || "").trim();

  return {
    sourceId,
    email,
    firstName,
    lastName,
    fullName: fullName || [firstName, lastName].filter(Boolean).join(" ").trim() || email,
    phone,
    address,
    balance,
    leverage,
    currency: String(raw.currency || "USD").toUpperCase(),
    source: String(raw.source || raw.origin || "core"),
    raw,
  };
}

async function upsertLocalUserFromCore(rawUser) {
  const u = normalizeCoreUser(rawUser);
  if (!u.email && !u.sourceId) return null;

  const query = u.email ? { email: u.email } : { sourceId: u.sourceId };
  let doc = await User.findOne(query).catch(() => null);

  if (!doc) {
    doc = new User({
      sourceId: u.sourceId || undefined,
      email: u.email || undefined,
      firstName: u.firstName,
      lastName: u.lastName,
      fullName: u.fullName,
      phone: u.phone,
      address: u.address,
      balance: u.balance,
      leverage: u.leverage,
      currency: u.currency,
      source: u.source,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  } else {
    if (u.sourceId) doc.sourceId = u.sourceId;
    if (u.email) doc.email = u.email;
    doc.firstName = u.firstName || doc.firstName || "";
    doc.lastName = u.lastName || doc.lastName || "";
    doc.fullName = u.fullName || doc.fullName || "";
    doc.phone = u.phone || doc.phone || "";
    doc.address = u.address || doc.address || "";
    if (Number.isFinite(u.balance)) doc.balance = u.balance;
    if (Number.isFinite(u.leverage)) doc.leverage = u.leverage;
    doc.currency = u.currency || doc.currency || "USD";
    doc.source = u.source || doc.source || "core";
    doc.updatedAt = new Date();
  }

  await doc.save();
  return doc;
}

async function getExistingZohoIdForUser(userDoc) {
  if (userDoc?.zohoLeadId) return { module: "Leads", id: userDoc.zohoLeadId };
  if (userDoc?.zohoContactId) return { module: "Contacts", id: userDoc.zohoContactId };

  if (userDoc?.email && zohoReady()) {
    try {
      const crit = encodeURIComponent(`(${process.env.ZOHO_EMAIL_FIELD || "Email"}:equals:${userDoc.email})`);
      const leadSearch = await zohoRequest(`/Leads/search?criteria=${crit}`);
      const leadId = leadSearch?.data?.data?.[0]?.id;
      if (leadId) return { module: "Leads", id: leadId };
      const contactSearch = await zohoRequest(`/Contacts/search?criteria=${crit}`);
      const contactId = contactSearch?.data?.data?.[0]?.id;
      if (contactId) return { module: "Contacts", id: contactId };
    } catch {}
  }

  return null;
}

function buildZohoPayload(userDoc) {
  const fullName = String(userDoc.fullName || [userDoc.firstName, userDoc.lastName].filter(Boolean).join(" ") || userDoc.email || "Cliente").trim();
  const firstName = String(userDoc.firstName || "").trim();
  const lastName = String(userDoc.lastName || fullName || userDoc.email || "Cliente").trim();
  const address = String(userDoc.address || "").trim();
  const phone = String(userDoc.phone || "").trim();
  const email = String(userDoc.email || "").trim().toLowerCase();
  return {
    [process.env.ZOHO_FIRST_NAME_FIELD || "First_Name"]: firstName || "Cliente",
    [process.env.ZOHO_LAST_NAME_FIELD || "Last_Name"]: lastName || fullName || "Cliente",
    [process.env.ZOHO_EMAIL_FIELD || "Email"]: email || undefined,
    [process.env.ZOHO_PHONE_FIELD || "Phone"]: phone || undefined,
    [process.env.ZOHO_ADDRESS_FIELD || "Street"]: address || undefined,
    [process.env.ZOHO_COMPANY_FIELD || "Company"]: "Leones Broker",
    Description: `Sincronizado desde Leones Broker. Balance: ${userDoc.balance ?? 0}. Leverage: ${userDoc.leverage ?? 1}.`,
  };
}

async function createOrUpdateZohoRecord(userDoc) {
  if (!zohoReady()) return { ok: false, skipped: true, reason: "zoho_not_configured" };
  const payload = buildZohoPayload(userDoc);
  const existing = await getExistingZohoIdForUser(userDoc);
  if (existing?.id) {
    const update = await zohoRequest(`/${existing.module}/${existing.id}`, { method: "PUT", body: { data: [payload] } });
    if (update.ok) return { ok: true, action: "updated", module: existing.module, data: update.data };
  }

  let moduleToUse = process.env.ZOHO_MODULE || "Leads";
  let create = await zohoRequest(`/${moduleToUse}`, { method: "POST", body: { data: [payload] } });
  if (!create.ok && moduleToUse !== (process.env.ZOHO_FALLBACK_MODULE || "Contacts")) {
    moduleToUse = process.env.ZOHO_FALLBACK_MODULE || "Contacts";
    create = await zohoRequest(`/${moduleToUse}`, { method: "POST", body: { data: [payload] } });
  }
  if (!create.ok) throw new Error(JSON.stringify(create.data || { msg: "Zoho create failed" }));
  const record = create.data?.data?.[0];
  const zohoId = record?.details?.id || record?.id || "";
  return { ok: true, action: "created", module: moduleToUse, zohoId, data: create.data };
}

async function syncUserToZohoAndMark(userDoc) {
  if (!userDoc) return null;
  try {
    const zoho = await createOrUpdateZohoRecord(userDoc);
    if (zoho?.ok) {
      userDoc.zohoModule = zoho.module || userDoc.zohoModule || "";
      if (zoho.module === "Leads" && zoho.zohoId) userDoc.zohoLeadId = zoho.zohoId;
      if (zoho.module === "Contacts" && zoho.zohoId) userDoc.zohoContactId = zoho.zohoId;
      userDoc.zohoSyncStatus = "synced";
      userDoc.zohoLastError = "";
      userDoc.zohoSyncedAt = new Date();
      userDoc.updatedAt = new Date();
      await userDoc.save().catch(() => null);
      return zoho;
    }
    return zoho;
  } catch (err) {
    userDoc.zohoSyncStatus = "error";
    userDoc.zohoLastError = err?.message || String(err);
    userDoc.zohoSyncedAt = new Date();
    userDoc.updatedAt = new Date();
    await userDoc.save().catch(() => null);
    return { ok: false, error: err?.message || String(err) };
  }
}

async function fetchCoreUsersOnce() {
  if (!CORE_API_URL || !fetchFn) return [];
  const endpoints = (process.env.CORE_USERS_ENDPOINTS || "/api/users,/api/admin/users,/api/clients,/api/leads,/api/registers").split(",").map((s) => s.trim()).filter(Boolean);
  for (const endpoint of endpoints) {
    try {
      const response = await fetchFn(buildCoreUrl(endpoint), {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "x-admin-api-key": ADMIN_API_KEY,
          "x-admin-key": ADMIN_API_KEY,
          authorization: `Bearer ${JWT_SECRET}`,
        },
      });
      if (!response.ok) continue;
      const data = await response.json().catch(() => null);
      const arr = Array.isArray(data) ? data : Array.isArray(data?.users) ? data.users : Array.isArray(data?.data) ? data.data : Array.isArray(data?.result) ? data.result : [];
      if (arr.length) return arr;
    } catch (err) {
      console.warn(`fetchCoreUsersOnce fail ${endpoint}:`, err?.message || err);
    }
  }
  return [];
}

async function syncCoreUsersToLocalAndZoho() {
  if (zohoSyncLock) return { ok: false, skipped: true, reason: "sync_locked" };
  zohoSyncLock = true;
  try {
    const coreUsers = await fetchCoreUsersOnce();
    if (!Array.isArray(coreUsers) || coreUsers.length === 0) return { ok: true, synced: 0, created: 0, updated: 0, zoho: 0 };
    let created = 0;
    let updated = 0;
    let zohoCount = 0;
    const errors = [];
    for (const raw of coreUsers) {
      const before = await User.findOne(
        raw?.email ? { email: String(raw.email).trim().toLowerCase() } : raw?.id || raw?._id ? { sourceId: String(raw.id || raw._id) } : null
      ).catch(() => null);
      const doc = await upsertLocalUserFromCore(raw);
      if (!doc) continue;
      if (!before) created += 1;
      else updated += 1;
      const z = await syncUserToZohoAndMark(doc);
      if (z?.ok) zohoCount += 1;
      if (z?.error) errors.push({ email: doc.email, error: z.error });
    }
    return { ok: true, synced: coreUsers.length, created, updated, zoho: zohoCount, errors };
  } finally {
    zohoSyncLock = false;
  }
}

async function syncSingleUserToZohoById(userId) {
  const doc = await User.findById(userId).catch(() => null);
  if (!doc) return { ok: false, msg: "Usuario no encontrado" };
  return await syncUserToZohoAndMark(doc);
}

async function ensureInitialCoreSync() {
  try {
    const result = await syncCoreUsersToLocalAndZoho();
    console.log("✅ Sync inicial core->local->zoho:", result);
  } catch (err) {
    console.warn("Sync inicial falló:", err?.message || err);
  }
}

setTimeout(() => { ensureInitialCoreSync(); }, 3000);
if (Number(process.env.ZOHO_SYNC_INTERVAL_MS || 300000) > 0) {
  setInterval(() => {
    syncCoreUsersToLocalAndZoho().catch((e) => console.warn("sync interval error:", e?.message || e));
  }, Number(process.env.ZOHO_SYNC_INTERVAL_MS || 300000)).unref();
}

/* ======================================================
   LOCAL BALANCE / WITHDRAW HELPERS
====================================================== */
async function localDeposit({ userId, amount, leverage, note, currency = "USD" }) {
  const user = await User.findById(userId).catch(() => null);
  if (!user) return { ok: false, status: 404, data: { ok: false, msg: "Usuario no encontrado" } };
  const numericAmount = Math.abs(normalizeNumber(amount, 0));
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) return { ok: false, status: 400, data: { ok: false, msg: "amount inválido" } };

  const wallet = await getWalletDocForUser(user._id);
  const before = Number(wallet.balanceOwn ?? wallet.balance ?? user.balance ?? 0) || 0;
  const after = before + numericAmount;

  wallet.balanceOwn = after;
  wallet.balance = wallet.balanceOwn;
  wallet.currency = currency || wallet.currency || "USD";

  if (Number.isFinite(leverage) && leverage > 0) {
    wallet.leverageFactor = leverage;
    user.leverage = leverage;
  }

  wallet.equity = wallet.balanceOwn;
  wallet.marginUsed = Number(wallet.marginUsed ?? 0) || 0;
  wallet.freeMargin = Math.max(wallet.equity - wallet.marginUsed, 0);
  wallet.marginLevel = wallet.marginUsed > 0 ? (wallet.equity / wallet.marginUsed) * 100 : 0;
  wallet.updatedAt = new Date();
  await wallet.save();

  user.balance = wallet.balanceOwn;
  user.currency = currency || user.currency || "USD";
  if (Number.isFinite(leverage) && leverage > 0) user.leverage = leverage;
  user.updatedAt = new Date();
  await user.save();

  const tx = await recordTransaction({
    user,
    type: "deposit",
    amount: numericAmount,
    status: "completed",
    note,
    balanceBefore: before,
    balanceAfter: wallet.balanceOwn,
    meta: { source: "local-fallback", currency, leverage: wallet.leverageFactor },
    source: "admin-server.js/localDeposit",
  });

  const account = await buildAccountForUser(user);
  emitStateUpdates(user._id, account, null, tx);
  return {
    ok: true,
    status: 200,
    data: {
      ok: true,
      msg: "Depósito aplicado",
      data: {
        balance: wallet.balanceOwn,
        leverage: wallet.leverageFactor,
        transaction: tx,
        account: account.account,
        wallet: account.wallet,
      },
    },
  };
}

async function localWithdraw({ userId, amount, note, force = false }) {
  const user = await User.findById(userId).catch(() => null);
  if (!user) return { ok: false, status: 404, data: { ok: false, msg: "Usuario no encontrado" } };
  const numericAmount = Math.abs(normalizeNumber(amount, 0));
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) return { ok: false, status: 400, data: { ok: false, msg: "amount inválido" } };

  const wallet = await getWalletDocForUser(user._id);
  const before = Number(wallet.balanceOwn ?? wallet.balance ?? user.balance ?? 0) || 0;
  if (!force && before < numericAmount) return { ok: false, status: 400, data: { ok: false, msg: "Saldo insuficiente" } };

  const after = force ? Math.max(0, before - numericAmount) : before - numericAmount;
  wallet.balanceOwn = after;
  wallet.balance = wallet.balanceOwn;
  wallet.equity = wallet.balanceOwn;
  wallet.freeMargin = Math.max(wallet.equity - (Number(wallet.marginUsed ?? 0) || 0), 0);
  wallet.marginLevel = Number(wallet.marginUsed ?? 0) > 0 ? (wallet.equity / wallet.marginUsed) * 100 : 0;
  wallet.updatedAt = new Date();
  await wallet.save();

  user.balance = wallet.balanceOwn;
  user.updatedAt = new Date();
  await user.save();

  const tx = await recordTransaction({
    user,
    type: force ? "adjustment" : "withdrawal",
    amount: -numericAmount,
    status: "completed",
    note,
    balanceBefore: before,
    balanceAfter: wallet.balanceOwn,
    meta: { source: force ? "forced-local-fallback" : "local-fallback" },
    source: "admin-server.js/localWithdraw",
  });

  const account = await buildAccountForUser(user);
  emitStateUpdates(user._id, account, null, tx);
  return {
    ok: true,
    status: 200,
    data: {
      ok: true,
      msg: force ? "Saldo ajustado" : "Retiro aplicado",
      data: {
        balance: wallet.balanceOwn,
        transaction: tx,
        account: account.account,
        wallet: account.wallet,
      },
    },
  };
}

async function depositByDelta(req, res, userId, desiredBalance, leverage, note) {
  const user = await User.findById(userId).catch(() => null);
  if (!user) return { ok: false, status: 404, data: { ok: false, msg: "Usuario no encontrado" } };
  const wallet = await getWalletDocForUser(user._id);
  const currentBalance = getEffectiveBalance(user, wallet.toObject ? wallet.toObject() : wallet);
  const targetBalance = Math.max(0, normalizeNumber(desiredBalance, currentBalance));
  const delta = targetBalance - currentBalance;

  if (delta > 0) {
    const remote = await proxyToCore(req, "/api/admin/deposit", {
      method: "POST",
      body: {
        userId,
        amount: delta,
        leverage: leverage !== undefined ? Number(leverage) : undefined,
        note: note || "Update balance",
      },
    });

    if (remote.ok) {
      if (remote.headers) relaySetCookies(remote.headers, res);
      return { ok: true, status: remote.status, data: remote.data };
    }

    return await localDeposit({
      userId,
      amount: delta,
      leverage: leverage !== undefined ? Number(leverage) : undefined,
      note: note || "Update balance",
    });
  }

  if (delta < 0) {
    const before = currentBalance;
    wallet.balanceOwn = targetBalance;
    wallet.balance = targetBalance;
    wallet.equity = targetBalance;
    wallet.freeMargin = Math.max(targetBalance - (Number(wallet.marginUsed ?? 0) || 0), 0);
    wallet.marginLevel = Number(wallet.marginUsed ?? 0) > 0 ? (wallet.equity / wallet.marginUsed) * 100 : 0;
    wallet.updatedAt = new Date();
    await wallet.save();
    user.balance = targetBalance;
    user.updatedAt = new Date();
    await user.save();

    if (leverage !== undefined && leverage !== null && leverage !== "") {
      const lev = Number(leverage) || 1;
      wallet.leverageFactor = lev;
      user.leverage = lev;
      wallet.updatedAt = new Date();
      user.updatedAt = new Date();
      await wallet.save();
      await user.save();
    }

    const tx = await recordTransaction({
      user,
      type: "adjustment",
      amount: delta,
      status: "completed",
      note: note || "Update balance",
      balanceBefore: before,
      balanceAfter: targetBalance,
      meta: { source: "admin-update-balance", action: "set_balance" },
      source: "admin-server.js/depositByDelta",
    });

    const account = await buildAccountForUser(user);
    emitStateUpdates(userId, account, null, tx);

    return {
      ok: true,
      status: 200,
      data: {
        ok: true,
        msg: "Saldo actualizado",
        data: { balance: targetBalance, account: account.account, wallet: account.wallet, transaction: tx },
      },
    };
  }

  if (leverage !== undefined && leverage !== null && leverage !== "") {
    const lev = Number(leverage) || 1;
    wallet.leverageFactor = lev;
    wallet.updatedAt = new Date();
    await wallet.save();
    user.leverage = lev;
    user.updatedAt = new Date();
    await user.save();
  }

  const payload = await buildAccountForUser(user);
  emitStateUpdates(userId, payload, null, null);

  return {
    ok: true,
    status: 200,
    data: {
      ok: true,
      msg: "Saldo actualizado",
      data: { balance: payload.account.balance, account: payload.account, wallet: payload.wallet },
    },
  };
}

/* ======================================================
   AUTH
====================================================== */
app.post(["/api/admin/login", "/api/login"], async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, msg: "Datos incompletos" });
    }

    if (!ADMIN_EMAIL || !ADMIN_PASS || !JWT_SECRET) {
      return res.status(500).json({ ok: false, msg: "Servidor admin mal configurado" });
    }

    if (email !== ADMIN_EMAIL || password !== ADMIN_PASS) {
      return res.status(401).json({ ok: false, msg: "Credenciales inválidas" });
    }

    const token = signAdminToken({ email });

    res.cookie("admin_token", token, {
      httpOnly: true,
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 8 * 60 * 60 * 1000,
    });

    return res.json({
      ok: true,
      token,
      msg: "Login correcto",
      admin: { email, role: "admin" },
    });
  } catch (err) {
    console.error("admin login error:", err);
    return res.status(500).json({ ok: false, msg: "Error del servidor" });
  }
});



       /* ======================================================
   UPDATE BALANCE COMPATIBILITY
====================================================== */
app.post("/api/admin/update-balance", ensureAdminAuth, async (req, res) => {
  try {
    const { userId, balance } = req.body || {};

    if (!userId || balance === undefined || balance === null) {
      return res.status(400).json({
        ok: false,
        msg: "Datos incompletos",
      });
    }

    const amount = Number(balance);

    if (!Number.isFinite(amount)) {
      return res.status(400).json({
        ok: false,
        msg: "Balance inválido",
      });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        ok: false,
        msg: "Usuario no encontrado",
      });
    }

    const wallet = await getWalletDocForUser(user._id);

    wallet.balance = amount;
    wallet.balanceOwn = amount;
    wallet.updatedAt = new Date();

    await wallet.save();

    io.emit(`balance:${userId}`, amount);

    return res.json({
      ok: true,
      msg: "Saldo actualizado",
      balance: amount,
    });

  } catch (err) {
    console.error("/api/admin/update-balance error:", err);

    return res.status(500).json({
      ok: false,
      msg: "Error actualizando saldo",
      error: err.message,
    });
  }
});

/* ======================================================
   SYNC CORE
====================================================== */
app.post("/api/admin/sync-core", ensureAdminAuth, async (_req, res) => {
  try {
    const result = await syncCoreUsersToLocalAndZoho();
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error("sync-core error:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error sincronizando core",
      error: err?.message || String(err),
    });
  }
});

app.get("/api/admin/sync-core", ensureAdminAuth, async (_req, res) => {
  try {
    const result = await syncCoreUsersToLocalAndZoho();
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error("sync-core error:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error sincronizando core",
      error: err?.message || String(err),
    });
  }
});

/* ======================================================
   USERS
====================================================== */
app.get("/api/admin/users", ensureAdminAuth, async (_req, res) => {
  try {
    const users = await User.find({})
      .select("-password -verificationToken -__v")
      .sort({ createdAt: -1 })
      .lean()
      .exec()
      .catch(() => []);

    return res.json(users);
  } catch (err) {
    console.error("GET users error:", err);
    return res.status(500).json({ ok: false, msg: "Error al listar usuarios" });
  }
});

app.post("/api/admin/users/:id/sync-zoho", ensureAdminAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).catch(() => null);
    if (!user) {
      return res.status(404).json({ ok: false, msg: "Usuario no encontrado" });
    }

    const result = await syncUserToZohoAndMark(user);
    return res.json({ ok: true, result });
  } catch (err) {
    console.error("sync single zoho error:", err);
    return res.status(500).json({
      ok: false,
      msg: "Error sincronizando con Zoho",
      error: err?.message || String(err),
    });
  }
});

/* ======================================================
   ACCOUNT
====================================================== */
app.get("/api/admin/account/:userId", ensureAdminAuth, async (req, res) => {
  try {
    const user = await getTargetUserForAdmin(req, res);
    if (!user) return;

    const payload = await buildAccountForUser(user);
    return res.json({ ok: true, ...payload });
  } catch (err) {
    console.error("GET admin account error:", err);
    return res.status(500).json({ ok: false, msg: "Error obteniendo cuenta" });
  }
});

app.get("/api/admin/account", ensureAdminAuth, async (req, res) => {
  try {
    const user = await getTargetUserForAdmin(req, res);
    if (!user) return;

    const payload = await buildAccountForUser(user);
    return res.json({ ok: true, ...payload });
  } catch (err) {
    console.error("GET admin account error:", err);
    return res.status(500).json({ ok: false, msg: "Error obteniendo cuenta" });
  }
});

       app.get("/api/admin/withdrawals/:userId", ensureAdminAuth, async (req, res) => {
  try {
    const withdraws = await loadWithdraws({
      userId: req.params.userId,
      status: req.query.status || "all",
      limit: 500,
    });

    return res.json({
      ok: true,
      count: withdraws.length,
      withdraws,
      withdrawals: withdraws,
      data: withdraws,
      items: withdraws,
    });
  } catch (err) {
    console.error("/api/admin/withdrawals/:userId error:", err);

    return res.status(500).json({
      ok: false,
      msg: "Error obteniendo retiros",
    });
  }
});

app.get("/api/account", async (req, res) => {
  try {
    const user = await getUserDocFromBearer(req);
    if (!user) return res.status(401).json({ ok: false, error: "Unauthorized" });

    return res.json(await buildAccountForUser(user));
  } catch (e) {
    console.error("account error", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.get("/api/me", async (req, res) => {
  try {
    const user = await getUserDocFromBearer(req);
    if (!user) return res.status(401).json({ ok: false, error: "Unauthorized" });

    return res.status(200).json(await buildAccountForUser(user));
  } catch (e) {
    console.error("/api/me error", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.get("/api/profile", async (req, res) => {
  try {
    const user = await getUserDocFromBearer(req);
    if (!user) return res.status(401).json({ ok: false, error: "Unauthorized" });

    return res.json(await buildAccountForUser(user));
  } catch (e) {
    console.error("profile error", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.get("/api/cuenta", (req, res) => res.redirect(307, "/api/account"));

/* ======================================================
   TRANSACTIONS
====================================================== */
app.get("/api/admin/transactions", ensureAdminAuth, async (req, res) => {
  try {
    const userId = req.query.userId || null;
    const limit = Math.min(Number(req.query.limit || 100) || 100, 500);

    const txs = userId
      ? await loadTransactionsForUser(userId, limit)
      : await Transaction.find({})
          .sort({ createdAt: -1 })
          .limit(limit)
          .lean()
          .exec()
          .catch(() => []);

    return res.json({
      ok: true,
      count: txs.length,
      transactions: txs,
      data: txs,
      items: txs,
    });
  } catch (err) {
    console.error("/api/admin/transactions error:", err);
    return res.status(500).json({ ok: false, msg: "Error obteniendo transacciones" });
  }
});

app.get("/api/transactions", async (req, res) => {
  try {
    const user = await getUserDocFromBearer(req);
    if (!user) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const limit = Math.min(Number(req.query.limit || 50) || 50, 200);
    const transactions = await loadTransactionsForUser(user._id, limit);

    return res.json({
      ok: true,
      count: transactions.length,
      transactions,
      data: transactions,
      items: transactions,
    });
  } catch (e) {
    console.error("/api/transactions error", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/* ======================================================
   WITHDRAW HELPERS
====================================================== */
function emitWithdrawRealtime(payload) {
  io.emit("withdraw:update", payload);
  io.emit("admin:withdraw-response", payload);
  io.emit("admin:withdraw-update", payload);
  io.emit(`withdraw:${payload.userId}`, payload);
}

/* ======================================================
   WITHDRAW REQUESTS
====================================================== */
app.get("/api/admin/withdraws/:userId", ensureAdminAuth, async (req, res) => {
  try {
    const withdraws = await loadWithdraws({
      userId: req.params.userId,
      status: req.query.status || "all",
      limit: 500,
    });

    return res.json({
      ok: true,
      count: withdraws.length,
      withdraws,
      withdrawals: withdraws,
      data: withdraws,
      items: withdraws,
    });
  } catch (err) {
    console.error("/api/admin/withdraws/:userId error:", err);
    return res.status(500).json({ ok: false, msg: "Error obteniendo retiros" });
  }
});

app.get(["/api/admin/withdraws", "/api/admin/withdrawals"], ensureAdminAuth, async (req, res) => {
  try {
    const withdraws = await loadWithdraws({
      userId: req.query.userId || null,
      status: req.query.status || "all",
      limit: 500,
    });

    return res.json({
      ok: true,
      count: withdraws.length,
      withdraws,
      withdrawals: withdraws,
      data: withdraws,
      items: withdraws,
    });
  } catch (err) {
    console.error("/api/admin/withdraws error:", err);
    return res.status(500).json({ ok: false, msg: "Error obteniendo retiros" });
  }
});

/* ======================================================
   WITHDRAW APPROVE / REJECT
====================================================== */
app.post(
  ["/api/admin/withdraw/approve", "/api/admin/withdrawals/approve"],
  ensureAdminAuth,
  async (req, res) => {
    try {
      const { id, adminNote = "" } = req.body || {};

      if (!id) {
        return res.status(400).json({ ok: false, msg: "id requerido" });
      }

      const w = await Withdraw.findById(id).catch(() => null);
      if (!w) {
        return res.status(404).json({ ok: false, msg: "Retiro no encontrado" });
      }

      const userId = String(w.userId || "");
      const amount = Number(w.amount ?? w.Amount ?? w.Cantidad ?? 0);

      w.status = "approved";
      w.Estado = "approved";
      w.adminNote = adminNote;
      w.updatedAt = new Date();

      await w.save();

      const payload = {
        ok: true,
        id: String(w._id),
        userId,
        amount,
        status: "approved",
        message: "Retiro aprobado",
        updatedAt: new Date(),
      };

      emitWithdrawRealtime(payload);
      return res.json(payload);
    } catch (err) {
      console.error("POST withdraw/approve error:", err);
      return res.status(500).json({
        ok: false,
        msg: "Error aprobando retiro",
        error: err?.message || String(err),
      });
    }
  }
);

app.post(
  ["/api/admin/withdraw/reject", "/api/admin/withdrawals/reject"],
  ensureAdminAuth,
  async (req, res) => {
    try {
      const { id, adminNote = "" } = req.body || {};

      if (!id) {
        return res.status(400).json({ ok: false, msg: "id requerido" });
      }

      const w = await Withdraw.findById(id).catch(() => null);
      if (!w) {
        return res.status(404).json({ ok: false, msg: "Retiro no encontrado" });
      }

      const userId = String(w.userId || "");
      const amount = Number(w.amount ?? w.Amount ?? w.Cantidad ?? 0);

      w.status = "rejected";
      w.Estado = "rejected";
      w.adminNote = adminNote;
      w.updatedAt = new Date();

      await w.save();

      const payload = {
        ok: true,
        id: String(w._id),
        userId,
        amount,
        status: "rejected",
        message: "Retiro rechazado",
        updatedAt: new Date(),
      };

      emitWithdrawRealtime(payload);
      return res.json(payload);
    } catch (err) {
      console.error("POST withdraw/reject error:", err);
      return res.status(500).json({
        ok: false,
        msg: "Error rechazando retiro",
        error: err?.message || String(err),
      });
    }
  }
);

app.post(["/api/admin/withdraw", "/api/withdraw"], ensureAdminAuth, async (req, res) => {
  try {
    const { userId, amount, note } = req.body || {};
    if (!userId || amount === undefined || amount === null || amount === "") {
      return res.status(400).json({ ok: false, error: "userId y amount son requeridos" });
    }

    const numericAmount = normalizeNumber(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ ok: false, error: "amount inválido" });
    }

    const remote = await proxyToCore(req, "/api/admin/withdraw", {
      method: "POST",
      body: {
        userId,
        amount: numericAmount,
        note: note || "Admin withdrawal",
      },
    });

    if (remote.ok) {
      if (remote.headers) relaySetCookies(remote.headers, res);

      const tx = remote.data?.data?.transaction || remote.data?.transaction || null;
      const account = remote.data?.data?.account || remote.data?.account || null;
      const wallet = remote.data?.data?.wallet || remote.data?.wallet || null;
      const balance =
        remote.data?.data?.balance ??
        remote.data?.balance ??
        account?.balance ??
        null;

      emitStateUpdates(userId, { account, wallet }, null, tx);
      if (balance !== null) io.emit(`balance:${userId}`, balance);

      const payload = {
        ok: true,
        userId: String(userId),
        amount: numericAmount,
        status: "approved",
        message: "Retiro aprobado",
        updatedAt: new Date(),
      };

      emitWithdrawRealtime(payload);
      return res.status(remote.status).json(remote.data);
    }

    const local = await localWithdraw({
      userId,
      amount: numericAmount,
      note: note || "Admin withdrawal",
    });

    return res.status(local.status).json(local.data);
  } catch (err) {
    console.error("/api/admin/withdraw error:", err);
    return res.status(500).json({ ok: false, msg: "Error retiro" });
  }
});

/* ======================================================
   CLIENT WITHDRAW REQUEST
====================================================== */
app.post("/api/withdraw/request", async (req, res) => {
  try {
    const user = await getUserDocFromBearer(req);
    if (!user) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const body = req.body || {};
    const amount = Number(body.amount || 0);
    const method = String(body.method || body.withdrawMethod || "USDT").trim();
    const walletAddress = String(body.walletAddress || body.address || "").trim();
    const note = String(body.note || "").trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, error: "invalid_amount" });
    }
    if (!walletAddress) {
      return res.status(400).json({ ok: false, error: "wallet_required" });
    }

    const wallet = await getWalletDocForUser(user._id);
    const balance = Number(wallet.balanceOwn ?? wallet.balance ?? 0);
    if (amount > balance) {
      return res.status(400).json({ ok: false, error: "insufficient_balance" });
    }

    const withdraw = await Withdraw.create({
      userId: String(user._id),
      amount,
      method,
      walletAddress,
      note,
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log("✅ WITHDRAW CREATED:", withdraw._id);
    io.emit("withdraw:new", {
      withdraw: withdraw.toObject ? withdraw.toObject() : withdraw,
    });

    return res.json({ ok: true, message: "Retiro enviado", withdraw });
  } catch (err) {
    console.error("❌ /api/withdraw/request:", err);
    return res.status(500).json({
      ok: false,
      error: "server_error",
      message: err?.message || "Error interno",
    });
  }
});

   /* ======================================================
   DEPOSIT / WITHDRAW
====================================================== */
app.post(["/api/admin/deposit", "/api/deposit"], ensureAdminAuth, async (req, res) => {
  try {
    const { userId, amount, leverage, note, currency } = req.body || {};
    if (!userId || typeof amount === "undefined" || amount === null || amount === "") {
      return res.status(400).json({ ok: false, error: "userId y amount son requeridos" });
    }

    const numericAmount = normalizeNumber(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ ok: false, error: "amount inválido" });
    }

    const remote = await proxyToCore(req, "/api/admin/deposit", {
      method: "POST",
      body: {
        userId,
        amount: numericAmount,
        leverage: leverage !== undefined ? Number(leverage) : undefined,
        note: note || "Admin deposit",
        currency: currency || "USD",
      },
    });

    if (remote.ok) {
      if (remote.headers) relaySetCookies(remote.headers, res);
      const tx = remote.data?.data?.transaction || remote.data?.transaction || null;
      const account = remote.data?.data?.account || remote.data?.account || null;
      const wallet = remote.data?.data?.wallet || remote.data?.wallet || null;
      const balance = remote.data?.data?.balance ?? remote.data?.balance ?? account?.balance ?? null;
      emitStateUpdates(userId, { account, wallet }, null, tx);
      if (balance !== null) io.emit(`balance:${userId}`, balance);
      return res.status(remote.status).json(remote.data);
    }

    const local = await localDeposit({
      userId,
      amount: numericAmount,
      leverage: leverage !== undefined ? Number(leverage) : undefined,
      note: note || "Admin deposit",
      currency: currency || "USD",
    });

    return res.status(local.status).json(local.data);
  } catch (err) {
    console.error("/api/admin/deposit error:", err);
    return res.status(500).json({ ok: false, msg: "Error depósito" });
  }
});

app.post(["/api/admin/withdraw", "/api/withdraw"], ensureAdminAuth, async (req, res) => {
  try {
    const { userId, amount, note } = req.body || {};
    if (!userId || typeof amount === "undefined" || amount === null || amount === "") {
      return res.status(400).json({ ok: false, error: "userId y amount son requeridos" });
    }

    const numericAmount = normalizeNumber(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ ok: false, error: "amount inválido" });
    }

    const remote = await proxyToCore(req, "/api/admin/withdraw", {
      method: "POST",
      body: { userId, amount: numericAmount, note: note || "Admin withdrawal" },
    });

    if (remote.ok) {
      if (remote.headers) relaySetCookies(remote.headers, res);
      const tx = remote.data?.data?.transaction || remote.data?.transaction || null;
      const account = remote.data?.data?.account || remote.data?.account || null;
      const wallet = remote.data?.data?.wallet || remote.data?.wallet || null;
      const balance = remote.data?.data?.balance ?? remote.data?.balance ?? account?.balance ?? null;
      emitStateUpdates(userId, { account, wallet }, null, tx);
      if (balance !== null) io.emit(`balance:${userId}`, balance);
      io.emit(`withdraw:${userId}`, "approved");
      return res.status(remote.status).json(remote.data);
    }

    const local = await localWithdraw({
      userId,
      amount: numericAmount,
      note: note || "Admin withdrawal",
    });

    return res.status(local.status).json(local.data);
  } catch (err) {
    console.error("/api/admin/withdraw error:", err);
    return res.status(500).json({ ok: false, msg: "Error retiro" });
  }
});

/* ======================================================
   DOCUMENTS
====================================================== */
const storageDocuments = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "uploads", "documents");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + file.originalname.replace(/\s+/g, "_");
    cb(null, uniqueName);
  },
});

const uploadDocument = multer({
  storage: storageDocuments,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/jpg",
    ];

    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Formato de archivo no permitido"));
    }
  },
});

app.get("/api/admin/documents", ensureAdminAuth, async (req, res) => {
  try {
    const userId = req.query.userId || null;
    const status = req.query.status || "all";

    const documents = await loadDocuments({
      userId,
      status,
      limit: 500,
    });

    return res.json({
      ok: true,
      count: documents.length,
      documents,
      data: documents,
      items: documents,
    });
  } catch (err) {
    console.error("/api/admin/documents error:", err);
    return res.status(500).json({ ok: false, msg: "Error obteniendo documentos" });
  }
});

app.get("/api/admin/documents/:userId", ensureAdminAuth, async (req, res) => {
  try {
    const documents = await loadDocuments({
      userId: req.params.userId,
      status: req.query.status || "all",
      limit: 500,
    });

    return res.json({
      ok: true,
      count: documents.length,
      documents,
      data: documents,
      items: documents,
    });
  } catch (err) {
    console.error("/api/admin/documents/:userId error:", err);
    return res.status(500).json({ ok: false, msg: "Error obteniendo documentos" });
  }
});

app.post(
  ["/api/admin/document/approve", "/api/admin/documents/approve"],
  ensureAdminAuth,
  async (req, res) => {
    try {
      const { id, adminNote = "" } = req.body || {};
      if (!id) return res.status(400).json({ ok: false, msg: "id requerido" });

      const doc = await Document.findById(id).catch(() => null);
      if (!doc) return res.status(404).json({ ok: false, msg: "Documento no encontrado" });

      doc.status = "approved";
      doc.adminNote = adminNote;
      doc.updatedAt = new Date();
      await doc.save();

      return res.json({ ok: true, msg: "Documento aprobado", id: String(doc._id) });
    } catch (err) {
      console.error("document approve error:", err);
      return res.status(500).json({ ok: false, msg: "Error aprobando documento" });
    }
  }
);

app.post(
  ["/api/admin/document/reject", "/api/admin/documents/reject"],
  ensureAdminAuth,
  async (req, res) => {
    try {
      const { id, adminNote = "" } = req.body || {};
      if (!id) return res.status(400).json({ ok: false, msg: "id requerido" });

      const doc = await Document.findById(id).catch(() => null);
      if (!doc) return res.status(404).json({ ok: false, msg: "Documento no encontrado" });

      doc.status = "rejected";
      doc.adminNote = adminNote;
      doc.updatedAt = new Date();
      await doc.save();

      return res.json({ ok: true, msg: "Documento rechazado", id: String(doc._id) });
    } catch (err) {
      console.error("document reject error:", err);
      return res.status(500).json({ ok: false, msg: "Error rechazando documento" });
    }
  }
);

app.post("/api/documents", uploadDocument.single("document"), async (req, res) => {
  try {
    const user = await getUserDocFromBearer(req);
    if (!user) return res.status(401).json({ ok: false, error: "Unauthorized" });
    if (!req.file) return res.status(400).json({ ok: false, error: "Documento requerido" });

    const document = await Document.create({
      userId: String(user._id),
      type: req.body.type || "identity",
      documentUrl: "/uploads/documents/" + req.file.filename,
      fileName: req.file.originalname || req.file.filename,
      mimeType: req.file.mimetype || "",
      status: "pending",
      adminNote: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    io.emit("document:new", {
      document: document.toObject ? document.toObject() : document,
    });

    return res.json({ ok: true, document });
  } catch (err) {
    console.error("DOCUMENT UPLOAD ERROR:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/documents/upload", async (req, res) => {
  try {
    const user = await getUserDocFromBearer(req);
    if (!user) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const { type, documentUrl } = req.body || {};
    if (!documentUrl || typeof documentUrl !== "string") {
      return res.status(400).json({ ok: false, error: "documentUrl_required" });
    }

    const doc = await Document.create({
      userId: String(user._id),
      type: type || "identity",
      documentUrl,
      status: "pending",
      adminNote: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    io.emit("document:new", { document: doc.toObject ? doc.toObject() : doc });
    return res.json({ ok: true, msg: "Documento subido", document: doc });
  } catch (err) {
    console.error("/api/documents/upload error:", err);
    return res.status(500).json({
      ok: false,
      error: "server_error",
      message: err?.message || "Error interno",
    });
  }
});

/* ======================================================
   MARKET / ACCOUNT / POSITIONS / TRADE / PRICE
====================================================== */
const simulatedPrices = new Map();

function generateBasePrice(symbol = "") {
  const s = String(symbol).toUpperCase();
  if (s.includes("BTC")) return 65000 + Math.random() * 5000;
  if (s.includes("ETH")) return 3000 + Math.random() * 300;
  if (s.includes("XAU")) return 2300 + Math.random() * 50;
  if (s.includes("NVDA")) return 900 + Math.random() * 100;
  if (s.includes("AAPL")) return 180 + Math.random() * 20;
  if (s.includes("TSLA")) return 200 + Math.random() * 50;
  return 50 + Math.random() * 500;
}

function getSimulatedPrice(symbol) {
  symbol = String(symbol || "").toUpperCase().trim();
  if (!simulatedPrices.has(symbol)) simulatedPrices.set(symbol, generateBasePrice(symbol));

  let current = simulatedPrices.get(symbol);
  const movement = (Math.random() - 0.5) * (current * 0.01);
  current += movement;
  if (current <= 0) current = generateBasePrice(symbol);

  simulatedPrices.set(symbol, current);
  return Number(current.toFixed(2));
}

app.get("/api/price", async (req, res) => {
  try {
    const rawSymbol = String(req.query.symbol || req.query.tvSymbol || req.query.selectedSymbol || "");
    const symbol = String(rawSymbol || "").trim().toUpperCase();
    if (!symbol) return res.status(400).json({ ok: false, error: "Símbolo requerido" });

    const price = getSimulatedPrice(symbol);
    return res.json({ ok: true, simulated: true, symbol, price });
  } catch (err) {
    console.error("❌ PRICE ERROR:", err);
    return res.json({ ok: true, simulated: true, symbol: "FALLBACK", price: 100 });
  }
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    env: process.env.NODE_ENV || "dev",
    emailProvider: process.env.RESEND_API_KEY
      ? "resend"
      : process.env.EMAIL_USER || process.env.SMTP_USER
        ? "smtp"
        : "none",
    db: mongoose.connection.name || null,
    adminApiKeyConfigured: !!process.env.ADMIN_API_KEY,
  });
});

app.locals.sendVerificationEmail = async ({ user, verificationLink }) => {
  try {
    const to = user?.email || user?.address || user;
    if (!to) return { ok: false, error: "missing_recipient" };
    if (!verificationLink) return { ok: false, error: "missing_verification_link" };

    const name = user?.name || "usuario";

    return await sendEmail({
      to,
      subject: "Verifica tu cuenta - Leones Broker",
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111"><h2>Hola ${name}, verifica tu cuenta</h2><p>Haz clic en el botón de abajo para activar tu cuenta:</p><p><a href="${verificationLink}" style="display:inline-block;background:#d4af37;color:#000;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold">Verificar cuenta</a></p><p>Si el botón no funciona, copia y pega este enlace en tu navegador:</p><p>${verificationLink}</p></div>`,
    });
  } catch (err) {
    console.error("[MAIL] sendVerificationEmail error:", err?.message || err);
    return { ok: false, error: err?.message || String(err) };
  }
};

app.post("/api/_send_test_email", async (req, res) => {
  const to = (req.body && req.body.to) || process.env.SENDER_EMAIL;
  if (!to) {
    return res.status(400).json({
      ok: false,
      message: "Necesitas enviar 'to' en el body o configurar SENDER_EMAIL",
    });
  }

  const subject = req.body.subject || "Prueba de correo - Leones Broker";
  const html =
    req.body.html ||
    `<p>Esto es una prueba desde el servidor de Leones Broker. Si recibes este correo, Resend/SMTP está funcionando.</p>`;

  try {
    const r = await sendEmail({ to, subject, html });
    if (r.ok) {
      return res.json({
        ok: true,
        message: "Correo enviado",
        provider: r.provider,
        result: r.result || r.info || r.resp,
      });
    }

    return res.status(500).json({
      ok: false,
      message: "No se pudo enviar correo",
      error: r.error,
    });
  } catch (err) {
    console.error("test email error:", err);
    return res.status(500).json({
      ok: false,
      message: "Error interno enviando correo",
      error: err && err.message ? err.message : String(err),
    });
  }
});

app.get("/api/markets", (req, res) => res.json({ markets: ["Crypto", "Stocks", "Forex", "Indices", "Futures", "Bonds"] }));
app.get("/api/market/list", (req, res) => res.json([{ symbol: "BINANCE:BTCUSDT", label: "BTC/USDT", market: "Crypto" }]));
app.get("/api/market/symbols", (req, res) => res.json([{ symbol: "BINANCE:BTCUSDT", label: "BTC/USDT", market: "Crypto" }]));
app.get("/api/markets/symbols", (req, res) => res.json([{ symbol: "BINANCE:BTCUSDT", label: "BTC/USDT", market: "Crypto" }]));
app.get("/api/api/symbols", (req, res) => res.json([{ symbol: "BINANCE:BTCUSDT", label: "BTC/USDT", market: "Crypto" }]));
app.get("/api/api/markets", (req, res) => res.json({ markets: ["Crypto", "Stocks", "Forex", "Indices"] }));

app.get("/api/quotes", async (req, res) =>
  res.json([{ symbol: "BINANCE:BTCUSDT", price: getSimulatedPrice("BTCUSDT") }])
);

app.get("/api/latest", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || req.query.tvSymbol || req.query.selectedSymbol || "").trim().toUpperCase();
    if (!symbol) {
      return res.json({
        ok: true,
        symbol: null,
        price: null,
        currentPrice: null,
        close: null,
        last: null,
        updatedAt: new Date().toISOString(),
        message: "symbol_missing",
      });
    }

    const price = getSimulatedPrice(symbol);
    return res.json({
      ok: true,
      symbol,
      price,
      currentPrice: price,
      close: price,
      last: price,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("/api/latest error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

app.get("/api/market/quotes", async (req, res) =>
  res.json({ ok: true, quotes: [{ symbol: "BINANCE:BTCUSDT", price: getSimulatedPrice("BTCUSDT") }] })
);

app.get("/api/market/latest", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || req.query.tvSymbol || req.query.selectedSymbol || "").trim().toUpperCase();
    if (!symbol) {
      return res.json({
        ok: true,
        symbol: null,
        price: null,
        currentPrice: null,
        close: null,
        last: null,
        updatedAt: new Date().toISOString(),
        message: "symbol_missing",
      });
    }

    const price = getSimulatedPrice(symbol);
    return res.json({
      ok: true,
      symbol,
      price,
      currentPrice: price,
      close: price,
      last: price,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("/api/market/latest error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

app.get("/api/market/polygon/quotes", async (req, res) =>
  res.json({ ok: true, quotes: [{ symbol: "BINANCE:BTCUSDT", price: getSimulatedPrice("BTCUSDT") }] })
);

app.get("/api/market/polygon/symbols", (req, res) =>
  res.json([{ symbol: "BINANCE:BTCUSDT", label: "BTC/USDT", market: "Crypto" }])
);

app.get("/api/symbols", (req, res) =>
  res.json([{ symbol: "BINANCE:BTCUSDT", label: "BTC/USDT", market: "Crypto" }])
);

/* ======================================================
   CLIENT ACCOUNT / WALLET / POSITIONS
====================================================== */
app.get("/api/wallet", async (req, res) => {
  try {
    const user = await getUserDocFromBearer(req);
    if (!user) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const payload = await buildAccountForUser(user);
    return res.json({
      ok: true,
      wallet: payload.wallet,
      account: payload.account,
      balance: payload.account.balance,
      balanceOwn: payload.account.balanceOwn,
      availableBalance: payload.account.availableBalance,
      equity: payload.account.equity,
      marginUsed: payload.account.marginUsed,
      freeMargin: payload.account.freeMargin,
      marginLevel: payload.account.marginLevel,
      leverageFactor: payload.account.leverageFactor,
      currency: payload.account.currency,
      transactions: payload.transactions,
    });
  } catch (e) {
    console.error("/api/wallet error", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.get("/api/billetera", (req, res) => res.redirect(307, "/api/wallet"));

app.get("/api/positions", async (req, res) => {
  try {
    const user = await getUserDocFromBearer(req);
    if (!user) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const positions = await safeLoadOpenPositionsForUser(user._id);
    return res.json({ ok: true, positions, data: positions, items: positions, count: positions.length });
  } catch (e) {
    console.error("/api/positions error", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.get("/api/posiciones", async (req, res) => {
  try {
    const user = await getUserDocFromBearer(req);
    if (!user) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const positions = await safeLoadOpenPositionsForUser(user._id);
    return res.json({ ok: true, positions, data: positions, items: positions, count: positions.length });
  } catch (e) {
    console.error("/api/posiciones error", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.get("/api/positions/all", async (req, res) => {
  try {
    const user = await getUserDocFromBearer(req);
    if (!user) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const positions = await safeLoadAllPositionsForUser(user._id);
    return res.json({ ok: true, positions, data: positions, items: positions, count: positions.length });
  } catch (e) {
    console.error("/api/positions/all error", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.get("/api/posiciones/all", async (req, res) => {
  try {
    const user = await getUserDocFromBearer(req);
    if (!user) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const positions = await safeLoadAllPositionsForUser(user._id);
    return res.json({ ok: true, positions, data: positions, items: positions, count: positions.length });
  } catch (e) {
    console.error("/api/posiciones/all error", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.get("/api/trade/positions", async (req, res) => {
  try {
    const user = await getUserDocFromBearer(req);
    if (!user) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const positions = await safeLoadOpenPositionsForUser(user._id);
    return res.json({ ok: true, positions, data: positions, items: positions, count: positions.length });
  } catch (e) {
    console.error("/api/trade/positions error", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/* ======================================================
   SOCKET.IO
====================================================== */
io.on("connection", (socket) => {
  console.log("✅ socket connected", socket.id);

  try {
    socket.emit("prices_snapshot", { BTCUSDT: { price: getSimulatedPrice("BTCUSDT") } });
  } catch {
    socket.emit("prices_snapshot", {});
  }

  socket.on("request_withdraws", async (filters = {}) => {
    try {
      const withdraws = await loadWithdraws({
        userId: filters.userId || null,
        status: filters.status || "all",
        limit: Math.min(Number(filters.limit || 100) || 100, 500),
      });

      socket.emit("withdraws_snapshot", {
        ok: true,
        count: withdraws.length,
        withdraws,
        data: withdraws,
        items: withdraws,
      });

      console.log("📤 withdraws_snapshot enviado");
    } catch (err) {
      console.error("request_withdraws error:", err);
      socket.emit("withdraws_snapshot", { ok: false, error: err?.message || "error" });
    }
  });

  socket.on("request_documents", async (filters = {}) => {
    try {
      const documents = await loadDocuments({
        userId: filters.userId || null,
        status: filters.status || "all",
        limit: Math.min(Number(filters.limit || 100) || 100, 500),
      });

      socket.emit("documents_snapshot", {
        ok: true,
        count: documents.length,
        documents,
        data: documents,
        items: documents,
      });

      console.log("📤 documents_snapshot enviado");
    } catch (err) {
      console.error("request_documents error:", err);
      socket.emit("documents_snapshot", { ok: false, error: err?.message || "error" });
    }
  });

  socket.on("join_user_room", (userId) => {
    if (!userId) return;
    socket.join(`user:${userId}`);
    console.log(`👤 socket ${socket.id} joined user:${userId}`);
  });

  socket.on("join_admin", () => {
    socket.join("admins");
    console.log(`🛡️ admin joined: ${socket.id}`);
  });

  socket.on("disconnect", () => {
    console.log("❌ socket disconnected", socket.id);
  });
});

/* ======================================================
   REALTIME HELPERS
====================================================== */
async function emitWithdrawUpdateById(withdrawId) {
  try {
    const withdraw = await Withdraw.findById(withdrawId).lean().catch(() => null);
    if (!withdraw) return;

    io.emit("withdraw:update", withdraw);
    io.to("admins").emit("admin:withdraw:update", withdraw);
    io.to(`user:${withdraw.userId}`).emit("user:withdraw:update", withdraw);

    console.log("🚀 withdraw:update emitido", withdrawId);
  } catch (err) {
    console.error("emitWithdrawUpdateById error:", err);
  }
}

async function emitDocumentUpdate(documentId) {
  try {
    const document = await Document.findById(documentId).lean().catch(() => null);
    if (!document) return;

    io.emit("document:update", document);
    io.to("admins").emit("admin:document:update", document);
    io.to(`user:${document.userId}`).emit("user:document:update", document);

    console.log("🚀 document:update emitido", documentId);
  } catch (err) {
    console.error("emitDocumentUpdate error:", err);
  }
}

/* ======================================================
   STATIC
====================================================== */
const staticCandidates = ["public", "publico", "público", "Public", "Publico"];
let staticDirName = null;

for (const cand of staticCandidates) {
  const p = path.join(__dirname, cand);
  try {
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      staticDirName = cand;
      break;
    }
  } catch {}
}

if (!staticDirName) {
  staticDirName = "public";
  console.warn(`WARN: No se encontró carpeta estática entre ${staticCandidates.join(", ")}. Usando fallback '${staticDirName}'.`);
} else {
  console.log(`Static folder detected: '${staticDirName}'`);
}

const staticPath = path.join(__dirname, staticDirName);
const jsDirPath = path.join(staticPath, "js");

function stripScriptWrappers(source) {
  let text = String(source ?? "");
  text = text.replace(/^\uFEFF/, "");
  const trimmed = text.trim();
  const startsWithScript = /^<script\b[^>]*>/i.test(trimmed);
  const endsWithScript = /<\/script>\s*$/.test(trimmed);

  if (startsWithScript && endsWithScript) {
    text = trimmed.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>\s*$/, "");
  }

  return text;
}

function resolveJsCandidate(requestPath) {
  const clean = String(requestPath || "").split("?")[0];
  const normalized = clean.replace(/\\/g, "/");
  const base = path.basename(normalized);
  const candidates = [];

  if (normalized.startsWith("/public/js/")) {
    candidates.push(path.join(staticPath, normalized.replace(/^\/public\//, "")));
  }

  if (normalized.startsWith("/js/")) {
    candidates.push(path.join(jsDirPath, normalized.slice("/js/".length)));
    candidates.push(path.join(staticPath, normalized.replace(/^\/+/, "")));
  }

  if (normalized.startsWith("/public/")) {
    candidates.push(path.join(staticPath, normalized.replace(/^\/public\//, "")));
  }

  if (base) {
    candidates.push(path.join(staticPath, base));
    candidates.push(path.join(jsDirPath, base));
  }

  const uniqueCandidates = [...new Set(candidates)];
  return uniqueCandidates.find((p) => {
    try {
      return fs.existsSync(p) && fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
}

app.use(async (req, res, next) => {
  const pathname = req.path || "";
  if (!pathname.endsWith(".js")) return next();

  try {
    const candidate = resolveJsCandidate(pathname);
    if (candidate) {
      const raw = await fs.promises.readFile(candidate, "utf8");
      const cleaned = stripScriptWrappers(raw);
      res.status(200).type("application/javascript; charset=utf-8").send(cleaned);
      return;
    }

    res.status(404).type("application/javascript; charset=utf-8").send(`console.error("JS missing: ${pathname}");`);
  } catch (err) {
    console.error("Error sirviendo JS:", err);
    res.status(500).type("application/javascript; charset=utf-8").send(`console.error("JS server error");`);
  }
});

app.use("/public", express.static(staticPath));
app.use("/js", express.static(jsDirPath));
app.use(express.static(staticPath));

app.use("/api/api", (req, res) => {
  const newUrl = req.originalUrl.replace(/^\/api\/api/, "/api");
  return res.redirect(307, newUrl);
});

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/") || req.path === "/api") {
    return res.status(404).json({ error: "API endpoint not found" });
  }

  const indexPath = path.join(staticPath, "admin.html");
  res.sendFile(indexPath, (err) => {
    if (err) {
      console.error("Error sirviendo admin.html:", err);
      res.status(err.status || 500).send("Error loading app");
    }
  });
});

/* =========================
   START / SHUTDOWN
========================= */
const PORT = process.env.PORT || 3000;

const serverInstance = server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on ${PORT}`);
  console.log("ENV STATUS:");
  console.log("RESEND:", !!process.env.RESEND_API_KEY);
  console.log("SENDER:", !!process.env.SENDER_EMAIL);
  console.log("MONGO:", !!process.env.MONGO_URI);
  console.log("ADMIN_API_KEY:", !!process.env.ADMIN_API_KEY);
  console.log("POLYGON:", !!process.env.POLYGON_API_KEY);

  if (!process.env.POLYGON_API_KEY) {
    console.warn("⚠️ POLYGON_API_KEY no configurado — realtime limitado");
  }

  if (!process.env.RESEND_API_KEY) {
    console.warn("⚠️ Resend no configurado — emails pueden usar SMTP o simulación");
  }
});

let shuttingDown = false;

const safeClosePolygonSocket = async () => {
  if (!PolygonSocket) return;
};

const gracefulShutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`📴 ${signal} recibido. Cerrando...`);

  const timeout = setTimeout(() => {
    console.warn("Forzando cierre...");
    process.exit(1);
  }, 30000);
  timeout.unref();

  try {
    for (const t of liveSyncTimers?.values?.() || []) clearTimeout(t);
    if (liveSyncTimers?.clear) liveSyncTimers.clear();
    if (openTradeLocks?.clear) openTradeLocks.clear();
    if (activeOrders?.clear) activeOrders.clear();

    await new Promise((resolve, reject) => {
      serverInstance.close((err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    if (typeof global?.stopRiskWatcher === "function") {
      try {
        global.stopRiskWatcher();
      } catch (e) {
        console.warn("stopRiskWatcher threw:", e);
      }
    }

    await mongoose.disconnect();
    clearTimeout(timeout);
    process.exit(0);
  } catch (err) {
    console.error("Shutdown error:", err);
    clearTimeout(timeout);
    process.exit(1);
  }
};

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("unhandledRejection", (r) => {
  console.error("UnhandledRejection:", r);
  gracefulShutdown("unhandledRejection").catch(() => {});
});
process.on("uncaughtException", (e) => {
  console.error("UncaughtException:", e);
  gracefulShutdown("uncaughtException").catch(() => {});
});

module.exports = app;
