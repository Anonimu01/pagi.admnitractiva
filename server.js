require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const rateLimit = require("express-rate-limit");
const { Server } = require("socket.io");
const path = require("path");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const connectDB = require("./config/db");

const app = express();
const server = http.createServer(app);

const fetchFn = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null;

/* ======================================================
   CONFIG
====================================================== */
const CORE_API_URL = String(process.env.CORE_API_URL || "").replace(/\/+$/, "");
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || process.env.ADMIN_USER || "";
const ADMIN_PASS = process.env.ADMIN_PASS || process.env.ADMIN_PASSWORD || "";
const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_JWT_SECRET || "admin-secret-dev";
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "";

if (!CORE_API_URL) {
  console.warn("⚠️ CORE_API_URL no definido. Se usará modo local si hace falta.");
}

/* ======================================================
   DB
====================================================== */
Promise.resolve(connectDB()).catch((err) => {
  console.error("Error conectando DB:", err?.message || err);
});

mongoose.connection.on("connected", () => {
  console.log("✅ Mongo conectado");
});

mongoose.connection.on("error", (err) => {
  console.error("❌ Mongo connection error:", err);
});

mongoose.connection.on("disconnected", () => {
  console.warn("⚠️ Mongo disconnected");
});

/* ======================================================
   MODELOS
   Se definen aquí para no depender de archivos faltantes.
====================================================== */
const userSchema = new mongoose.Schema(
  {
    email: { type: String, index: true },
    password: String,
    balance: { type: Number, default: 0 },
    leverage: { type: Number, default: 1 },
    currency: { type: String, default: "USD" },
    role: { type: String, default: "" },
    isAdmin: { type: Boolean, default: false },
    admin: { type: Boolean, default: false },
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
    type: { type: String, index: true }, // deposit | withdrawal | trade_open | trade_close | adjustment
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
    status: { type: String, default: "pending", index: true }, // pending | approved | rejected
    note: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { minimize: false, strict: false }
);

const User = mongoose.models.User || mongoose.model("User", userSchema);
const Wallet = mongoose.models.Wallet || mongoose.model("Wallet", walletSchema);
const Transaction =
  mongoose.models.Transaction || mongoose.model("Transaction", transactionSchema);
const Position = mongoose.models.Position || mongoose.model("Position", positionSchema);
const Withdraw = mongoose.models.Withdraw || mongoose.model("Withdraw", withdrawSchema);

/* ======================================================
   MIDDLEWARE
====================================================== */
const CLIENT_ORIGIN_RAW = process.env.ADMIN_CLIENT_URL || process.env.CLIENT_URL || "*";

function parseAllowedOrigins(raw) {
  if (!raw || raw === "*") return "*";
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const ALLOWED_ORIGINS = parseAllowedOrigins(CLIENT_ORIGIN_RAW);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS === "*") return callback(null, true);
      if (Array.isArray(ALLOWED_ORIGINS) && ALLOWED_ORIGINS.includes(origin)) {
        return callback(null, true);
      }
      try {
        const url = new URL(origin);
        if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
          return callback(null, true);
        }
      } catch {}
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(
  rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
    max: Number(process.env.RATE_LIMIT_MAX || 200),
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

/* ======================================================
   SOCKET.IO
====================================================== */
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS === "*" ? true : ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.set("io", io);

app.use((req, res, next) => {
  req.io = io;
  next();
});

/* ======================================================
   HELPERS
====================================================== */
function getCookie(req, name) {
  const cookieHeader = req.headers.cookie || "";
  const parts = cookieHeader.split(";").map((p) => p.trim());
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = decodeURIComponent(part.slice(0, idx).trim());
    const v = decodeURIComponent(part.slice(idx + 1).trim());
    if (k === name) return v;
  }
  return null;
}

function normalizeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function compactSymbol(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
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

function getCurrentPriceForSymbol(symbol) {
  const target = compactSymbol(symbol);
  if (!target) return null;
  return null;
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

    const user = await User.findById(userId).catch(() => null);
    return user || null;
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
      const key =
        req.headers["x-admin-api-key"] ||
        req.headers["x-admin-key"] ||
        req.headers["admin-key"] ||
        "";
      if (key && key === ADMIN_API_KEY) return next();
    }

    if (isAdminTokenValid(req)) return next();

    return res.status(401).json({ ok: false, msg: "No autorizado" });
  } catch {
    return res.status(401).json({ ok: false, msg: "No autorizado" });
  }
}

function rewriteSetCookie(cookie) {
  return String(cookie || "")
    .replace(/;\s*Domain=[^;]+/gi, "")
    .replace(/;\s*domain=[^;]+/gi, "");
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

  if (cookies.length) {
    toRes.setHeader("set-cookie", cookies.map(rewriteSetCookie));
  }
}

function getIo(req) {
  return req.io || req.app?.get?.("io") || io;
}

function emitStateUpdates(userId, accountPayload = null, positions = null, transaction = null) {
  try {
    const socket = io;
    socket.emit("wallet_update", { userId, account: accountPayload?.account || accountPayload });
    socket.emit("account_update", { userId, account: accountPayload?.account || accountPayload });

    if (Array.isArray(positions)) socket.emit("positions_update", { userId, positions });
    if (transaction) socket.emit("transactions_update", { userId, transaction });

    socket.emit("admin:balance-updated", { userId, account: accountPayload?.account || accountPayload });
    if (transaction) socket.emit("admin:transaction-created", { userId, transaction });

    if (accountPayload?.account?.balance !== undefined) {
      socket.emit(`balance:${userId}`, accountPayload.account.balance);
    }
  } catch (e) {
    console.warn("emitStateUpdates error:", e?.message || e);
  }
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
  try {
    return await Wallet.findOne({ user: userId }).lean().exec().catch(() => null);
  } catch {
    return null;
  }
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
  try {
    return await Position.find({ user: userId }).sort({ createdAt: -1 }).lean().exec().catch(() => []);
  } catch {
    return [];
  }
}

async function loadOpenPositionsForUser(userId) {
  const rows = await Position.find({
    user: userId,
    status: { $in: ["OPEN", "open", "Open"] },
  })
    .sort({ createdAt: -1 })
    .lean()
    .exec()
    .catch(() => []);

  return (rows || []).map(annotatePosition);
}

async function loadAllPositionsForUser(userId) {
  const rows = await Position.find({ user: userId })
    .sort({ createdAt: -1 })
    .lean()
    .exec()
    .catch(() => []);

  return (rows || []).map(annotatePosition);
}

async function loadTransactionsForUser(userId, limit = 50) {
  return await Transaction.find({ user: userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean()
    .exec()
    .catch(() => []);
}

async function loadWithdrawsForUser(userId, status = "pending") {
  const query = { userId: String(userId) };
  if (status) query.status = status;
  return await Withdraw.find(query)
    .sort({ createdAt: -1 })
    .lean()
    .exec()
    .catch(() => []);
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
    walletSnapshot
      ? { ...walletSnapshot, balanceOwn: balance, balance }
      : { balanceOwn: balance, balance },
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

function buildCoreUrl(endpoint) {
  const base = CORE_API_URL.replace(/\/+$/, "");
  const route = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return `${base}${route}`;
}

async function proxyToCore(req, endpoint, options = {}) {
  if (!CORE_API_URL || !fetchFn) {
    return {
      ok: false,
      status: 503,
      data: { ok: false, error: "core_api_not_configured" },
      headers: null,
    };
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

    return {
      ok: response.ok,
      status: response.status,
      data,
      headers: response.headers,
    };
  } catch (err) {
    console.error("❌ Proxy error:", err?.message || err);
    return {
      ok: false,
      status: 500,
      data: { ok: false, error: "proxy_error", message: err?.message || String(err) },
      headers: null,
    };
  }
}

async function localDeposit({ userId, amount, leverage, note, currency = "USD" }) {
  const user = await User.findById(userId).catch(() => null);
  if (!user) {
    return { ok: false, status: 404, data: { ok: false, msg: "Usuario no encontrado" } };
  }

  const wallet = await getWalletDocForUser(user._id);
  const before = Number(wallet.balanceOwn ?? wallet.balance ?? user.balance ?? 0) || 0;

  wallet.balanceOwn = before + amount;
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
    amount,
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

async function localWithdraw({ userId, amount, note }) {
  const user = await User.findById(userId).catch(() => null);
  if (!user) {
    return { ok: false, status: 404, data: { ok: false, msg: "Usuario no encontrado" } };
  }

  const wallet = await getWalletDocForUser(user._id);
  const before = Number(wallet.balanceOwn ?? wallet.balance ?? user.balance ?? 0) || 0;

  if (before < amount) {
    return {
      ok: false,
      status: 400,
      data: { ok: false, msg: "Saldo insuficiente" },
    };
  }

  wallet.balanceOwn = before - amount;
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
    type: "withdrawal",
    amount: -Math.abs(amount),
    status: "completed",
    note,
    balanceBefore: before,
    balanceAfter: wallet.balanceOwn,
    meta: { source: "local-fallback" },
    source: "admin-server.js/localWithdraw",
  });

  const account = await buildAccountForUser(user);
  emitStateUpdates(user._id, account, null, tx);

  return {
    ok: true,
    status: 200,
    data: {
      ok: true,
      msg: "Retiro aplicado",
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
  if (!user) return res.status(404).json({ ok: false, msg: "Usuario no encontrado" });

  const wallet = await getWalletDocForUser(user._id);
  const currentBalance = getEffectiveBalance(user, wallet.toObject ? wallet.toObject() : wallet);
  const delta = normalizeNumber(desiredBalance, 0) - currentBalance;

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
      return {
        ok: true,
        status: remote.status,
        data: remote.data,
      };
    }

    const local = await localDeposit({
      userId,
      amount: delta,
      leverage: leverage !== undefined ? Number(leverage) : undefined,
      note: note || "Update balance",
    });
    return local;
  }

  if (delta < 0) {
    const remote = await proxyToCore(req, "/api/admin/withdraw", {
      method: "POST",
      body: {
        userId,
        amount: Math.abs(delta),
        note: note || "Update balance",
      },
    });

    if (remote.ok) {
      if (remote.headers) relaySetCookies(remote.headers, res);
      return {
        ok: true,
        status: remote.status,
        data: remote.data,
      };
    }

    const local = await localWithdraw({
      userId,
      amount: Math.abs(delta),
      note: note || "Update balance",
    });
    return local;
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
      data: {
        balance: payload.account.balance,
        account: payload.account,
        wallet: payload.wallet,
      },
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
   USERS
====================================================== */
app.get(["/api/admin/users", "/api/users"], ensureAdminAuth, async (req, res) => {
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

/* ======================================================
   ACCOUNT
====================================================== */
app.get(["/api/admin/account/:userId", "/api/account/:userId"], ensureAdminAuth, async (req, res) => {
  try {
    const user = await getTargetUserForAdmin(req, res);
    if (!user) return;

    const payload = await buildAccountForUser(user);
    return res.json({ ok: true, ...payload });
  } catch (err) {
    console.error("GET account error:", err);
    return res.status(500).json({ ok: false, msg: "Error obteniendo cuenta" });
  }
});

app.get(["/api/account", "/api/admin/account"], ensureAdminAuth, async (req, res) => {
  try {
    const user = await getTargetUserForAdmin(req, res);
    if (!user) return;

    const payload = await buildAccountForUser(user);
    return res.json({ ok: true, ...payload });
  } catch (err) {
    console.error("GET account error:", err);
    return res.status(500).json({ ok: false, msg: "Error obteniendo cuenta" });
  }
});

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

    return res.json({ ok: true, count: txs.length, transactions: txs, data: txs, items: txs });
  } catch (err) {
    console.error("/api/admin/transactions error:", err);
    return res.status(500).json({ ok: false, msg: "Error obteniendo transacciones" });
  }
});

app.get("/api/transactions", ensureAdminAuth, async (req, res) => {
  try {
    const userId = req.query.userId || null;
    const limit = Math.min(Number(req.query.limit || 50) || 50, 200);

    const txs = userId
      ? await loadTransactionsForUser(userId, limit)
      : await Transaction.find({})
          .sort({ createdAt: -1 })
          .limit(limit)
          .lean()
          .exec()
          .catch(() => []);

    return res.json({ ok: true, count: txs.length, transactions: txs, data: txs, items: txs });
  } catch (err) {
    console.error("/api/transactions error:", err);
    return res.status(500).json({ ok: false, msg: "Error obteniendo transacciones" });
  }
});

/* ======================================================
   WITHDRAW REQUESTS
====================================================== */
app.get("/api/admin/withdraws/:userId", ensureAdminAuth, async (req, res) => {
  try {
    const userId = req.params.userId;
    const data = await loadWithdrawsForUser(userId, "pending");
    return res.json(data);
  } catch (err) {
    console.error("GET withdraws error:", err);
    return res.status(500).json({ ok: false, msg: "Error obteniendo retiros" });
  }
});

app.post("/api/admin/withdraw/approve", ensureAdminAuth, async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ ok: false, msg: "id requerido" });

    const w = await Withdraw.findById(id).catch(() => null);
    if (!w) return res.status(404).json({ ok: false, msg: "Retiro no encontrado" });

    const userId = w.userId;
    const amount = Number(w.amount || 0);

    const remote = await proxyToCore(req, "/api/admin/withdraw", {
      method: "POST",
      body: {
        userId,
        amount,
        note: `Aprobación de retiro #${id}`,
      },
    });

    if (!remote.ok) {
      const local = await localWithdraw({
        userId,
        amount,
        note: `Aprobación de retiro #${id}`,
      });
      if (!local.ok) return res.status(local.status).json(local.data);
    } else if (remote.headers) {
      relaySetCookies(remote.headers, res);
    }

    w.status = "approved";
    w.updatedAt = new Date();
    await w.save();

    io.emit("admin:withdraw-response", { userId, status: "approved", id });
    io.emit(`withdraw:${userId}`, "approved");

    return res.json({ ok: true, msg: "Retiro aprobado" });
  } catch (err) {
    console.error("POST withdraw/approve error:", err);
    return res.status(500).json({ ok: false, msg: "Error aprobando retiro" });
  }
});

app.post("/api/admin/withdraw/reject", ensureAdminAuth, async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ ok: false, msg: "id requerido" });

    const w = await Withdraw.findById(id).catch(() => null);
    if (!w) return res.status(404).json({ ok: false, msg: "Retiro no encontrado" });

    w.status = "rejected";
    w.updatedAt = new Date();
    await w.save();

    io.emit("admin:withdraw-response", { userId: w.userId, status: "rejected", id });
    io.emit(`withdraw:${w.userId}`, "rejected");

    return res.json({ ok: true, msg: "Retiro rechazado" });
  } catch (err) {
    console.error("POST withdraw/reject error:", err);
    return res.status(500).json({ ok: false, msg: "Error rechazando retiro" });
  }
});

/* ======================================================
   UPDATE LEVERAGE
====================================================== */
app.post(["/api/admin/update-leverage", "/api/update-leverage"], ensureAdminAuth, async (req, res) => {
  try {
    const { userId, leverage } = req.body || {};

    if (!userId || typeof leverage === "undefined" || leverage === null || leverage === "") {
      return res.status(400).json({ msg: "Datos incompletos" });
    }

    const user = await User.findById(userId).catch(() => null);
    if (!user) return res.status(404).json({ msg: "Usuario no encontrado" });

    const lev = Number(leverage);
    if (!Number.isFinite(lev) || lev <= 0) {
      return res.status(400).json({ msg: "Leverage inválido" });
    }

    const wallet = await getWalletDocForUser(user._id);
    wallet.leverageFactor = lev;
    wallet.updatedAt = new Date();
    await wallet.save();

    user.leverage = lev;
    user.updatedAt = new Date();
    await user.save();

    const account = await buildAccountForUser(user);
    emitStateUpdates(userId, account, null, null);

    return res.json({
      ok: true,
      msg: "Leverage actualizado",
      leverage: lev,
      account: account.account,
      wallet: account.wallet,
    });
  } catch (err) {
    console.error("/api/admin/update-leverage error:", err);
    return res.status(500).json({ msg: "Error actualizando leverage" });
  }
});

app.put("/api/admin/users/leverage/:id", ensureAdminAuth, async (req, res) => {
  try {
    const id = req.params.id;
    const { leverage } = req.body || {};

    if (!id) return res.status(400).json({ msg: "id requerido" });
    if (typeof leverage === "undefined" || leverage === null || leverage === "") {
      return res.status(400).json({ msg: "leverage requerido" });
    }

    const user = await User.findById(id).catch(() => null);
    if (!user) return res.status(404).json({ msg: "Usuario no encontrado" });

    const lev = Number(leverage);
    if (!Number.isFinite(lev) || lev <= 0) {
      return res.status(400).json({ msg: "Leverage inválido" });
    }

    const wallet = await getWalletDocForUser(user._id);
    wallet.leverageFactor = lev;
    wallet.updatedAt = new Date();
    await wallet.save();

    user.leverage = lev;
    user.updatedAt = new Date();
    await user.save();

    const account = await buildAccountForUser(user);
    emitStateUpdates(String(user._id), account, null, null);

    return res.json({
      ok: true,
      msg: "Leverage actualizado (PUT)",
      leverage: lev,
      account: account.account,
      wallet: account.wallet,
    });
  } catch (err) {
    console.error("PUT /admin/users/leverage/:id error:", err);
    return res.status(500).json({ msg: "Error actualizando leverage" });
  }
});

/* ======================================================
   UPDATE BALANCE
   Si el panel manda un saldo exacto, aquí se convierte en delta
   y se aplica deposit/withdraw real para que el cliente quede
   sincronizado correctamente.
====================================================== */
app.post(["/api/admin/update-balance", "/api/update-balance"], ensureAdminAuth, async (req, res) => {
  try {
    const { userId, balance, leverage, note } = req.body || {};

    if (!userId) {
      return res.status(400).json({ ok: false, msg: "userId requerido" });
    }

    const result = await depositByDelta(req, res, userId, balance, leverage, note || "Update balance");
    if (result?.headers) relaySetCookies(result.headers, res);

    if (result && result.ok) {
      return res.status(result.status).json(result.data);
    }

    return res.status(result?.status || 500).json(result?.data || { ok: false, msg: "Error actualizando saldo" });
  } catch (err) {
    console.error("/api/admin/update-balance error:", err);
    return res.status(500).json({ ok: false, msg: "Error actualizando saldo" });
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
   ROOT / HEALTH
====================================================== */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/healthz", (req, res) => {
  res.json({
    ok: true,
    env: process.env.NODE_ENV || "development",
    dbReadyState: mongoose.connection.readyState,
    coreConfigured: !!CORE_API_URL,
    adminApiKeyConfigured: !!ADMIN_API_KEY,
    adminEmailConfigured: !!ADMIN_EMAIL,
    adminTokenSecretConfigured: !!JWT_SECRET,
    mongoConfigured: !!process.env.MONGO_URI,
  });
});

/* ======================================================
   FALLBACKS
====================================================== */
app.use("/api", (req, res) => {
  res.status(404).json({ ok: false, msg: "API endpoint not found" });
});

app.use((err, req, res, next) => {
  console.error("Unhandled error (admin):", err);
  res.status(err.status || 500).json({
    ok: false,
    msg: "Error servidor",
    detail: process.env.NODE_ENV === "development" ? err.message || String(err) : undefined,
  });
});

/* ======================================================
   START SERVER
====================================================== */
const PORT = Number(process.env.PORT || 4000);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🔥 ADMIN RUNNING EN: ${PORT}`);
  console.log("ENV:");
  console.log("  CORE_API_URL:", CORE_API_URL || "(none)");
  console.log("  ADMIN_API_KEY:", !!ADMIN_API_KEY);
  console.log("  ADMIN_EMAIL:", !!ADMIN_EMAIL);
  console.log("  JWT_SECRET:", !!JWT_SECRET);
  console.log("  MONGO:", !!process.env.MONGO_URI);
});

/* ======================================================
   GRACEFUL SHUTDOWN
====================================================== */
let shuttingDown = false;

const gracefulShutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`📴 ${signal} recibido. Cerrando servidor admin...`);

  const force = setTimeout(() => {
    console.warn("Forzando cierre admin...");
    process.exit(1);
  }, 30_000);
  force.unref();

  try {
    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) {
          console.error("Error cerrando HTTP server:", err);
          return reject(err);
        }
        console.log("HTTP server admin cerrado.");
        resolve();
      });
    });

    try {
      io.emit("server:shutdown");
      await new Promise((resolve) => io.close(resolve));
      console.log("Socket.io cerrado.");
    } catch (e) {
      console.warn("Error cerrando socket.io:", e);
    }

    try {
      await mongoose.disconnect();
      console.log("Mongo desconectado.");
    } catch (e) {
      console.warn("Error desconectando Mongo:", e);
    }

    clearTimeout(force);
    process.exit(0);
  } catch (err) {
    console.error("Error durante shutdown admin:", err);
    clearTimeout(force);
    process.exit(1);
  }
};

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("unhandledRejection", (r) => {
  console.error("UnhandledRejection (admin):", r);
  gracefulShutdown("unhandledRejection");
});
process.on("uncaughtException", (e) => {
  console.error("UncaughtException (admin):", e);
  gracefulShutdown("uncaughtException");
});
