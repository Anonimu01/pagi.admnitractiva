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

const app = express();
const server = http.createServer(app);
const fetchFn = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null;

const CORE_API_URL = String(process.env.CORE_API_URL || "").replace(/\/+$/, "");
const CORE_USERS_ENDPOINTS = (process.env.CORE_USERS_ENDPOINTS || "/api/users,/api/admin/users,/api/clients,/api/leads,/api/registers").split(",").map((s) => s.trim()).filter(Boolean);
const CORE_WITHDRAW_ENDPOINTS = (process.env.CORE_WITHDRAW_ENDPOINTS || "/api/admin/withdraws,/api/withdraw-requests,/api/withdrawals,/api/admin/withdraw-requests,/api/requests/withdraw").split(",").map((s) => s.trim()).filter(Boolean);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || process.env.ADMIN_USER || "";
const ADMIN_PASS = process.env.ADMIN_PASS || process.env.ADMIN_PASSWORD || "";
const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_JWT_SECRET || "admin-secret-dev";
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "";
const UPLOAD_DIR = path.join(__dirname, "uploads", "kyc");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const ALLOWED_KYC_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "application/pdf"]);
const ALLOWED_KYC_EXT = new Set([".jpg", ".jpeg", ".png", ".pdf"]);

Promise.resolve(connectDB()).catch((err) => console.error("Error conectando DB:", err?.message || err));
mongoose.connection.on("connected", () => console.log("✅ Mongo conectado"));
mongoose.connection.on("error", (err) => console.error("❌ Mongo connection error:", err));
mongoose.connection.on("disconnected", () => console.warn("⚠️ Mongo disconnected"));

const userSchema = new mongoose.Schema(
  {
    sourceId: { type: String, index: true },
    email: { type: String, index: true },
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    fullName: { type: String, default: "" },
    phone: { type: String, default: "" },
    address: { type: String, default: "" },
    registrationIp: { type: String, default: "" },
    lastLoginIp: { type: String, default: "" },
    registrationUserAgent: { type: String, default: "" },
    password: { type: String, select: false },
    balance: { type: Number, default: 0 },
    leverage: { type: Number, default: 1 },
    currency: { type: String, default: "USD" },
    role: { type: String, default: "" },
    isAdmin: { type: Boolean, default: false },
    admin: { type: Boolean, default: false },
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
    status: { type: String, default: "completed", index: true },
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
    sourceId: { type: String, index: true },
    userId: { type: String, index: true },
    userRef: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    userEmail: { type: String, default: "" },
    userName: { type: String, default: "" },
    amount: { type: Number, default: 0 },
    requestedAmount: { type: Number, default: 0 },
    counterOfferAmount: { type: Number, default: null },
    status: { type: String, default: "pending", index: true },
    note: { type: String, default: "" },
    adminNote: { type: String, default: "" },
    adminAction: { type: String, default: "" },
    reviewedBy: { type: String, default: "" },
    reviewedAt: { type: Date, default: null },
    ipAddress: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    reviewHistory: { type: Array, default: [] },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { minimize: false, strict: false }
);

const kycDocumentSchema = new mongoose.Schema(
  {
    userId: { type: String, index: true },
    userRef: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    userEmail: { type: String, default: "" },
    userName: { type: String, default: "" },
    type: { type: String, default: "identificacion", index: true },
    originalName: { type: String, default: "" },
    filename: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    size: { type: Number, default: 0 },
    path: { type: String, default: "" },
    status: { type: String, default: "pending", index: true },
    adminNote: { type: String, default: "" },
    reviewedBy: { type: String, default: "" },
    reviewedAt: { type: Date, default: null },
    ipAddress: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { minimize: false, strict: false }
);

const User = mongoose.models.User || mongoose.model("User", userSchema);
const Wallet = mongoose.models.Wallet || mongoose.model("Wallet", walletSchema);
const Transaction = mongoose.models.Transaction || mongoose.model("Transaction", transactionSchema);
const Position = mongoose.models.Position || mongoose.model("Position", positionSchema);
const Withdraw = mongoose.models.Withdraw || mongoose.model("Withdraw", withdrawSchema);
const KycDocument = mongoose.models.KycDocument || mongoose.model("KycDocument", kycDocumentSchema);

const CLIENT_ORIGIN_RAW = process.env.ADMIN_CLIENT_URL || process.env.CLIENT_URL || "*";
const ALLOWED_ORIGINS = !CLIENT_ORIGIN_RAW || CLIENT_ORIGIN_RAW === "*" ? "*" : CLIENT_ORIGIN_RAW.split(",").map((s) => s.trim()).filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS === "*") return callback(null, true);
      if (Array.isArray(ALLOWED_ORIGINS) && ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      try {
        const url = new URL(origin);
        if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return callback(null, true);
      } catch {}
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(rateLimit({ windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000), max: Number(process.env.RATE_LIMIT_MAX || 200), standardHeaders: true, legacyHeaders: false }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

const io = new Server(server, { cors: { origin: ALLOWED_ORIGINS === "*" ? true : ALLOWED_ORIGINS, methods: ["GET", "POST"], credentials: true } });
app.set("io", io);
app.use((req, res, next) => { req.io = io; next(); });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".bin";
    const safeBase = path.basename(file.originalname, ext).replace(/[^a-z0-9_-]+/gi, "_").slice(0, 40) || "doc";
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeBase}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: Number(process.env.KYC_MAX_FILE_SIZE || 5 * 1024 * 1024) },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_KYC_MIME.has(file.mimetype) || ALLOWED_KYC_EXT.has(ext)) return cb(null, true);
    cb(new Error("Archivo no permitido"));
  },
});

const kycUploadMiddleware = upload.fields([
  { name: "documento", maxCount: 1 },
  { name: "file", maxCount: 1 },
  { name: "archivo", maxCount: 1 },
  { name: "document", maxCount: 1 },
]);

function getUploadedFile(req) {
  const fields = req.files || {};
  return fields.documento?.[0] || fields.file?.[0] || fields.archivo?.[0] || fields.document?.[0] || req.file || null;
}

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
function normalizeNumber(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function normalizeNameParts(name = "") { const raw = String(name || "").trim().replace(/\s+/g, " "); if (!raw) return { firstName: "", lastName: "" }; const parts = raw.split(" "); if (parts.length === 1) return { firstName: "", lastName: parts[0] }; return { firstName: parts.slice(0, -1).join(" "), lastName: parts.slice(-1)[0] }; }
function normalizeSide(value) { const s = String(value || "").trim().toUpperCase(); if (["BUY", "LONG", "BULL"].includes(s)) return "BUY"; if (["SELL", "SHORT", "BEAR"].includes(s)) return "SELL"; return ""; }
function computePositionPnl(position = {}, currentPrice = null) { const entry = Number(position.entryPrice ?? position.price ?? position.openPrice ?? 0) || 0; const qty = Number(position.qty ?? position.quantity ?? position.amount ?? position.positionSize ?? 0) || 0; const side = normalizeSide(position.side || position.direction || position.positionSide); const px = Number(currentPrice ?? position.currentPrice ?? entry) || entry; const sign = side === "SELL" ? -1 : 1; return (px - entry) * qty * sign; }
function getEffectiveBalance(userDoc, walletDoc) { const walletBalance = Number(walletDoc?.balanceOwn ?? walletDoc?.balance); const userBalance = Number(userDoc?.balance ?? 0); if (Number.isFinite(walletBalance) && walletBalance >= 0) return walletBalance; if (Number.isFinite(userBalance) && userBalance >= 0) return userBalance; return 0; }
function getClientIp(req) { const xff = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim(); return xff || req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || ""; }

async function getUserDocFromBearer(req) { try { const auth = req.headers.authorization || req.headers.Authorization || null; if (!auth || !auth.toLowerCase().startsWith("bearer ")) return null; const token = String(auth).split(" ")[1]; if (!token) return null; let payload; try { payload = jwt.verify(token, JWT_SECRET); } catch { return null; } const userId = payload && (payload.id || payload.sub || payload.userId || payload._id); if (!userId) return null; return await User.findById(userId).catch(() => null); } catch { return null; } }
function isAdminTokenValid(req) { const auth = req.headers.authorization || req.headers.Authorization || ""; const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : ""; const tokenFromCookie = getCookie(req, "admin_token"); const token = bearer || tokenFromCookie; if (!token) return false; try { const decoded = jwt.verify(token, JWT_SECRET); return !!decoded && (decoded.admin === true || decoded.role === "admin"); } catch { return false; } }
function ensureAdminAuth(req, res, next) { try { if (ADMIN_API_KEY) { const key = req.headers["x-admin-api-key"] || req.headers["x-admin-key"] || req.headers["admin-key"] || ""; if (key && key === ADMIN_API_KEY) return next(); } if (isAdminTokenValid(req)) return next(); return res.status(401).json({ ok: false, msg: "No autorizado" }); } catch { return res.status(401).json({ ok: false, msg: "No autorizado" }); } }
function ensureUserAuth(req, res, next) { getUserDocFromBearer(req).then((doc) => { if (!doc) return res.status(401).json({ ok: false, msg: "No autorizado" }); req.currentUser = doc; next(); }).catch(() => res.status(401).json({ ok: false, msg: "No autorizado" })); }
function rewriteSetCookie(cookie) { return String(cookie || "").replace(/;\s*Domain=[^;]+/gi, "").replace(/;\s*domain=[^;]+/gi, ""); }
function relaySetCookies(fromHeaders, toRes) { const cookies = []; try { if (fromHeaders && typeof fromHeaders.getSetCookie === "function") { const arr = fromHeaders.getSetCookie(); if (Array.isArray(arr) && arr.length) cookies.push(...arr); } } catch {} try { const single = fromHeaders?.get?.("set-cookie"); if (single) cookies.push(single); } catch {} if (cookies.length) toRes.setHeader("set-cookie", cookies.map(rewriteSetCookie)); }
function buildCoreUrl(endpoint) { const base = CORE_API_URL.replace(/\/+$/, ""); const route = endpoint.startsWith("/") ? endpoint : `/${endpoint}`; return `${base}${route}`; }
async function proxyToCore(req, endpoint, options = {}) { if (!CORE_API_URL || !fetchFn) return { ok: false, status: 503, data: { ok: false, error: "core_api_not_configured" }, headers: null }; try { const response = await fetchFn(buildCoreUrl(endpoint), { method: options.method || "GET", headers: { "Content-Type": "application/json", "x-admin-api-key": ADMIN_API_KEY || req.headers["x-admin-api-key"] || "", "x-admin-key": ADMIN_API_KEY || req.headers["x-admin-key"] || "", authorization: req.headers.authorization || req.headers.Authorization || "", cookie: req.headers.cookie || "", ...(options.headers || {}) }, body: options.body === undefined || options.body === null ? undefined : typeof options.body === "string" ? options.body : JSON.stringify(options.body) }); const text = await response.text(); let data = {}; try { data = text ? JSON.parse(text) : {}; } catch { data = { ok: false, raw: text }; } return { ok: response.ok, status: response.status, data, headers: response.headers }; } catch (err) { console.error("❌ Proxy error:", err?.message || err); return { ok: false, status: 500, data: { ok: false, error: "proxy_error", message: err?.message || String(err) }, headers: null }; } }
function emitStateUpdates(userId, payload = {}) { try { const socket = io; socket.emit("wallet_update", { userId, account: payload?.account || payload }); socket.emit("account_update", { userId, account: payload?.account || payload }); socket.emit("transactions_update", { userId, transaction: payload?.transaction || null }); socket.emit("admin:balance-updated", { userId, account: payload?.account || payload }); if (payload?.transaction) socket.emit("admin:transaction-created", { userId, transaction: payload.transaction }); if (payload?.withdraw) socket.emit(`withdraw:${userId}`, payload.withdraw); if (payload?.kyc) socket.emit(`kyc:${userId}`, payload.kyc); if (payload?.account?.balance !== undefined) socket.emit(`balance:${userId}`, payload.account.balance); } catch (e) { console.warn("emitStateUpdates error:", e?.message || e); } }
function signAdminToken(payload = {}) { return jwt.sign({ admin: true, role: "admin", email: payload.email || ADMIN_EMAIL || "admin" }, JWT_SECRET, { expiresIn: "8h" }); }
function normalizeWalletSnapshot(wallet, openPnl = 0) { const balanceOwn = Number(wallet?.balanceOwn ?? wallet?.balance ?? 0) || 0; const credit = Number(wallet?.credit ?? 0) || 0; const marginUsed = Math.max(Number(wallet?.marginUsed ?? 0) || 0, 0); const equity = balanceOwn + openPnl; const freeMargin = Math.max(equity + credit - marginUsed, 0); const marginLevel = marginUsed > 0 ? (equity / marginUsed) * 100 : 0; return { balance: balanceOwn, balanceOwn, credit, equity, marginUsed, freeMargin, marginLevel, leverageFactor: Number(wallet?.leverageFactor ?? 1) || 1, currency: wallet?.currency || "USD", openPnl }; }
async function getWalletForUser(userId) { return await Wallet.findOne({ user: userId }).lean().exec().catch(() => null); }
async function getWalletDocForUser(userId) { let wallet = await Wallet.findOne({ user: userId }).catch(() => null); if (!wallet) wallet = new Wallet({ user: userId, balanceOwn: 0, balance: 0, credit: 0, marginUsed: 0, leverageFactor: 1, equity: 0, freeMargin: 0, marginLevel: 0, currency: "USD" }); return wallet; }
async function getPositionsForUser(userId) { return await Position.find({ user: userId }).sort({ createdAt: -1 }).lean().exec().catch(() => []); }
async function loadTransactionsForUser(userId, limit = 50) { return await Transaction.find({ user: userId }).sort({ createdAt: -1 }).limit(limit).lean().exec().catch(() => []); }
async function loadWithdrawsForUser(userId, status = null) { const query = { userId: String(userId) }; if (status && status !== "all") query.status = status; return await Withdraw.find(query).sort({ createdAt: -1 }).lean().exec().catch(() => []); }
async function loadKycForUser(userId) { return await KycDocument.find({ userId: String(userId) }).sort({ createdAt: -1 }).lean().exec().catch(() => []); }
async function recordTransaction({ user, type, amount = 0, status = "completed", note = "", balanceBefore = 0, balanceAfter = 0, meta = {}, source = "admin-server.js" }) { try { const payload = { user: user?._id || null, userId: String(user?._id || ""), type, amount: Number(amount) || 0, status, note, balanceBefore: Number(balanceBefore) || 0, balanceAfter: Number(balanceAfter) || 0, meta, source, createdAt: new Date() }; const tx = await Transaction.create(payload); return tx.toObject ? tx.toObject() : tx; } catch (err) { console.warn("recordTransaction fallback:", err?.message || err); return { userId: String(user?._id || ""), type, amount: Number(amount) || 0, status, note, balanceBefore: Number(balanceBefore) || 0, balanceAfter: Number(balanceAfter) || 0, meta, source, createdAt: new Date().toISOString() }; } }
async function buildProfileForUser(userDoc) { const wallet = await getWalletForUser(userDoc._id); const positions = await getPositionsForUser(userDoc._id); const recentTransactions = await loadTransactionsForUser(userDoc._id, 40); const withdrawRequests = await loadWithdrawsForUser(userDoc._id); const kycDocuments = await loadKycForUser(userDoc._id); const walletSnapshot = wallet?.toObject ? wallet.toObject() : wallet; const balance = getEffectiveBalance(userDoc, walletSnapshot); const openPnl = (positions || []).reduce((sum, p) => sum + (Number(p.pnl ?? 0) || 0), 0); const normalizedWallet = normalizeWalletSnapshot(walletSnapshot ? { ...walletSnapshot, balanceOwn: balance, balance } : { balanceOwn: balance, balance }, openPnl); return { account: { ...normalizedWallet, balance, balanceOwn: balance, equity: balance, leverage: Number(userDoc.leverage ?? walletSnapshot?.leverageFactor ?? 100) || 100, currency: userDoc.currency || walletSnapshot?.currency || "USD", positions: positions || [], openPositions: positions || [], recentTransactions, transactions: recentTransactions, withdrawRequests, kycDocuments, openPnl }, user: userDoc.toObject ? userDoc.toObject() : userDoc, wallet: walletSnapshot, positions, transactions: recentTransactions, withdrawRequests, kycDocuments }; }
async function getTargetUserForAdmin(req, res) { const userId = req.params?.userId || req.query?.userId || req.body?.userId || null; if (userId) { const user = await User.findById(userId).catch(() => null); if (!user) { res.status(404).json({ ok: false, msg: "Usuario no encontrado" }); return null; } return user; } const bearerUser = await getUserDocFromBearer(req); if (bearerUser) return bearerUser; res.status(401).json({ ok: false, msg: "No autorizado" }); return null; }
function safeFilePath(absolutePath) { const resolved = path.resolve(absolutePath); const base = path.resolve(UPLOAD_DIR); if (!resolved.startsWith(base)) return null; return resolved; }

async function createWithdrawRequest({ user, amount, note = "", req }) { const numericAmount = Math.abs(normalizeNumber(amount, 0)); if (!user) throw new Error("Usuario requerido"); if (!Number.isFinite(numericAmount) || numericAmount <= 0) throw new Error("amount inválido"); const wallet = await getWalletDocForUser(user._id); const before = Number(wallet.balanceOwn ?? wallet.balance ?? user.balance ?? 0) || 0; if (before < numericAmount) throw new Error("Saldo insuficiente"); const withdraw = await Withdraw.create({ sourceId: String(user.sourceId || user._id || ""), userId: String(user._id), userRef: user._id, userEmail: user.email || "", userName: user.fullName || [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "", amount: numericAmount, requestedAmount: numericAmount, status: "pending", note, adminNote: "", adminAction: "request", reviewedBy: "", reviewedAt: null, ipAddress: getClientIp(req), userAgent: String(req.headers["user-agent"] || ""), reviewHistory: [{ action: "request", amount: numericAmount, note, at: new Date().toISOString() }] }); const tx = await recordTransaction({ user, type: "withdraw_request", amount: -numericAmount, status: "pending", note: note || "Solicitud de retiro", balanceBefore: before, balanceAfter: before, meta: { withdrawId: String(withdraw._id), requestStatus: "pending" }, source: "withdraw-request" }); emitStateUpdates(String(user._id), { withdraw: withdraw.toObject ? withdraw.toObject() : withdraw, transaction: tx }); io.emit("admin:withdraw-request-created", { userId: String(user._id), withdraw: withdraw.toObject ? withdraw.toObject() : withdraw }); io.emit(`withdraw:${String(user._id)}`, { id: String(withdraw._id), status: "pending", amount: numericAmount, note }); return { withdraw, transaction: tx }; }

async function reviewWithdrawRequest({ id, action, amount = null, note = "", reviewedBy = "" }) { const w = await Withdraw.findById(id).catch(() => null); if (!w) return { ok: false, status: 404, msg: "Solicitud no encontrada" }; const user = await User.findById(w.userId).catch(() => null); const wallet = user ? await getWalletDocForUser(user._id) : null; const history = Array.isArray(w.reviewHistory) ? w.reviewHistory : []; const actionAmount = amount !== null && amount !== "" ? normalizeNumber(amount, w.amount || 0) : w.amount || 0; history.push({ action, amount: actionAmount, note, reviewedBy, at: new Date().toISOString() }); w.reviewHistory = history; w.adminNote = note || w.adminNote || ""; w.reviewedBy = reviewedBy || w.reviewedBy || ""; w.reviewedAt = new Date(); w.updatedAt = new Date(); if (action === "approve") { if (!user) return { ok: false, status: 404, msg: "Usuario no encontrado" }; const before = Number(wallet.balanceOwn ?? wallet.balance ?? user.balance ?? 0) || 0; const finalAmount = actionAmount; if (before < finalAmount) return { ok: false, status: 400, msg: "Saldo insuficiente" }; wallet.balanceOwn = before - finalAmount; wallet.balance = wallet.balanceOwn; wallet.equity = wallet.balanceOwn; wallet.freeMargin = Math.max(wallet.equity - (Number(wallet.marginUsed ?? 0) || 0), 0); wallet.marginLevel = Number(wallet.marginUsed ?? 0) > 0 ? (wallet.equity / wallet.marginUsed) * 100 : 0; wallet.updatedAt = new Date(); await wallet.save(); user.balance = wallet.balanceOwn; user.updatedAt = new Date(); await user.save(); w.status = "approved"; w.adminAction = "approve"; w.amount = finalAmount; w.requestedAmount = w.requestedAmount || finalAmount; await w.save(); const tx = await recordTransaction({ user, type: "withdrawal", amount: -finalAmount, status: "completed", note: note || `Retiro aprobado #${w._id}`, balanceBefore: before, balanceAfter: wallet.balanceOwn, meta: { withdrawId: String(w._id), status: "approved" }, source: "withdraw-review" }); emitStateUpdates(String(user._id), { account: { balance: wallet.balanceOwn }, transaction: tx, withdraw: { id: String(w._id), status: "approved", amount: finalAmount, note } }); io.emit("admin:withdraw-response", { userId: String(user._id), status: "approved", id: String(w._id), amount: finalAmount, note }); io.emit(`withdraw:${String(user._id)}`, { id: String(w._id), status: "approved", amount: finalAmount, note }); return { ok: true, withdraw: w.toObject ? w.toObject() : w, transaction: tx }; } if (action === "reject") { w.status = "rejected"; w.adminAction = "reject"; await w.save(); const tx = user ? await recordTransaction({ user, type: "withdraw_rejected", amount: 0, status: "rejected", note: note || `Retiro rechazado #${w._id}`, balanceBefore: Number(wallet?.balanceOwn ?? wallet?.balance ?? user.balance ?? 0) || 0, balanceAfter: Number(wallet?.balanceOwn ?? wallet?.balance ?? user.balance ?? 0) || 0, meta: { withdrawId: String(w._id), status: "rejected" }, source: "withdraw-review" }) : null; emitStateUpdates(String(w.userId), { transaction: tx, withdraw: { id: String(w._id), status: "rejected", amount: w.amount, note } }); io.emit("admin:withdraw-response", { userId: String(w.userId), status: "rejected", id: String(w._id), note }); io.emit(`withdraw:${String(w.userId)}`, { id: String(w._id), status: "rejected", amount: w.amount, note }); return { ok: true, withdraw: w.toObject ? w.toObject() : w, transaction: tx }; } if (action === "counteroffer") { w.status = "countered"; w.adminAction = "counteroffer"; w.counterOfferAmount = actionAmount; await w.save(); const tx = user ? await recordTransaction({ user, type: "withdraw_counteroffer", amount: 0, status: "countered", note: note || `Contraoferta de retiro #${w._id}`, balanceBefore: Number(wallet?.balanceOwn ?? wallet?.balance ?? user.balance ?? 0) || 0, balanceAfter: Number(wallet?.balanceOwn ?? wallet?.balance ?? user.balance ?? 0) || 0, meta: { withdrawId: String(w._id), counterOfferAmount: actionAmount, status: "countered" }, source: "withdraw-review" }) : null; emitStateUpdates(String(w.userId), { transaction: tx, withdraw: { id: String(w._id), status: "countered", amount: w.amount, counterOfferAmount: actionAmount, note } }); io.emit("admin:withdraw-response", { userId: String(w.userId), status: "countered", id: String(w._id), counterOfferAmount: actionAmount, note }); io.emit(`withdraw:${String(w.userId)}`, { id: String(w._id), status: "countered", amount: w.amount, counterOfferAmount: actionAmount, note }); return { ok: true, withdraw: w.toObject ? w.toObject() : w, transaction: tx }; } if (action === "update") { if (amount !== null && amount !== "") w.amount = actionAmount; if (note) w.adminNote = note; w.adminAction = "update"; w.status = String(w.status || "pending").toLowerCase(); await w.save(); io.emit("admin:withdraw-response", { userId: String(w.userId), status: w.status, id: String(w._id), amount: w.amount, note }); io.emit(`withdraw:${String(w.userId)}`, { id: String(w._id), status: w.status, amount: w.amount, note }); return { ok: true, withdraw: w.toObject ? w.toObject() : w }; } return { ok: false, status: 400, msg: "Acción inválida" }; }
async function reviewKycDocument({ id, status, note = "", reviewedBy = "" }) { const doc = await KycDocument.findById(id).catch(() => null); if (!doc) return { ok: false, status: 404, msg: "Documento no encontrado" }; doc.status = status; doc.adminNote = note || doc.adminNote || ""; doc.reviewedBy = reviewedBy || doc.reviewedBy || ""; doc.reviewedAt = new Date(); doc.updatedAt = new Date(); await doc.save(); io.emit("admin:kyc-response", { userId: String(doc.userId), id: String(doc._id), status, note }); io.emit(`kyc:${String(doc.userId)}`, { id: String(doc._id), status, note }); return { ok: true, document: doc.toObject ? doc.toObject() : doc }; }

async function upsertLocalUserFromCore(rawUser) { const u = (() => { const email = String(rawUser.email || rawUser.emailAddress || rawUser.correo || "").trim().toLowerCase(); const phone = String(rawUser.phone || rawUser.telefono || rawUser.mobile || "").trim(); const address = String(rawUser.address || rawUser.direccion || rawUser.street || "").trim(); const fullName = String(rawUser.fullName || rawUser.nombre || rawUser.name || "").trim(); const parts = normalizeNameParts(fullName); const firstName = String(rawUser.firstName || rawUser.nombre1 || parts.firstName || "").trim(); const lastName = String(rawUser.lastName || rawUser.apellido || parts.lastName || "").trim(); const balance = normalizeNumber(rawUser.balance, 0); const leverage = normalizeNumber(rawUser.leverage, 1); const sourceId = String(rawUser.id || rawUser._id || rawUser.userId || rawUser.sourceId || "").trim(); return { sourceId, email, firstName, lastName, fullName: fullName || [firstName, lastName].filter(Boolean).join(" ").trim() || email, phone, address, registrationIp: String(rawUser.registrationIp || rawUser.ipAddress || rawUser.ip || rawUser.registerIp || "").trim(), lastLoginIp: String(rawUser.lastLoginIp || rawUser.loginIp || "").trim(), registrationUserAgent: String(rawUser.registrationUserAgent || rawUser.userAgent || rawUser.ua || "").trim(), balance, leverage, currency: String(rawUser.currency || "USD").toUpperCase(), source: String(rawUser.source || rawUser.origin || "core"), raw: rawUser }; })(); if (!u.email && !u.sourceId) return null; const query = u.email ? { email: u.email } : { sourceId: u.sourceId }; let doc = await User.findOne(query).catch(() => null); if (!doc) { doc = new User({ sourceId: u.sourceId || undefined, email: u.email || undefined, firstName: u.firstName, lastName: u.lastName, fullName: u.fullName, phone: u.phone, address: u.address, registrationIp: u.registrationIp, lastLoginIp: u.lastLoginIp, registrationUserAgent: u.registrationUserAgent, balance: u.balance, leverage: u.leverage, currency: u.currency, source: u.source, createdAt: new Date(), updatedAt: new Date() }); } else { if (u.sourceId) doc.sourceId = u.sourceId; if (u.email) doc.email = u.email; doc.firstName = u.firstName || doc.firstName || ""; doc.lastName = u.lastName || doc.lastName || ""; doc.fullName = u.fullName || doc.fullName || ""; doc.phone = u.phone || doc.phone || ""; doc.address = u.address || doc.address || ""; if (u.registrationIp) doc.registrationIp = u.registrationIp; if (u.lastLoginIp) doc.lastLoginIp = u.lastLoginIp; if (u.registrationUserAgent) doc.registrationUserAgent = u.registrationUserAgent; if (Number.isFinite(u.balance)) doc.balance = u.balance; if (Number.isFinite(u.leverage)) doc.leverage = u.leverage; doc.currency = u.currency || doc.currency || "USD"; doc.source = u.source || doc.source || "core"; doc.updatedAt = new Date(); } await doc.save(); return doc; }
async function fetchCoreUsersOnce() { if (!CORE_API_URL || !fetchFn) return []; for (const endpoint of CORE_USERS_ENDPOINTS) { try { const response = await fetchFn(buildCoreUrl(endpoint), { method: "GET", headers: { "Content-Type": "application/json", "x-admin-api-key": ADMIN_API_KEY, "x-admin-key": ADMIN_API_KEY, authorization: `Bearer ${JWT_SECRET}` } }); if (!response.ok) continue; const data = await response.json().catch(() => null); const arr = Array.isArray(data) ? data : Array.isArray(data?.users) ? data.users : Array.isArray(data?.data) ? data.data : Array.isArray(data?.result) ? data.result : []; if (arr.length) return arr; } catch (err) { console.warn(`fetchCoreUsersOnce fail ${endpoint}:`, err?.message || err); } } return []; }

let coreSyncLock = false;
let withdrawSyncLock = false;
async function syncCoreUsersToLocal() { if (coreSyncLock) return { ok: false, skipped: true, reason: "sync_locked" }; coreSyncLock = true; try { const coreUsers = await fetchCoreUsersOnce(); let created = 0; let updated = 0; for (const raw of coreUsers) { const before = await User.findOne(raw?.email ? { email: String(raw.email).trim().toLowerCase() } : raw?.id || raw?._id ? { sourceId: String(raw.id || raw._id) } : null).catch(() => null); const doc = await upsertLocalUserFromCore(raw); if (!doc) continue; if (!before) created += 1; else updated += 1; } return { ok: true, synced: coreUsers.length, created, updated }; } finally { coreSyncLock = false; } }
async function fetchCoreWithdrawsOnce() { if (!CORE_API_URL || !fetchFn) return []; for (const endpoint of CORE_WITHDRAW_ENDPOINTS) { try { const response = await fetchFn(buildCoreUrl(endpoint), { method: "GET", headers: { "Content-Type": "application/json", "x-admin-api-key": ADMIN_API_KEY, "x-admin-key": ADMIN_API_KEY, authorization: `Bearer ${JWT_SECRET}` } }); if (!response.ok) continue; const data = await response.json().catch(() => null); const arr = Array.isArray(data) ? data : Array.isArray(data?.withdraws) ? data.withdraws : Array.isArray(data?.data) ? data.data : Array.isArray(data?.result) ? data.result : []; if (arr.length) return arr; } catch (err) { console.warn(`fetchCoreWithdrawsOnce fail ${endpoint}:`, err?.message || err); } } return []; }
async function upsertLocalWithdrawFromCore(raw) { const amount = normalizeNumber(raw.amount ?? raw.requestedAmount ?? raw.withdrawAmount ?? 0, 0); const w = { sourceId: String(raw.id || raw._id || raw.sourceId || raw.withdrawId || "").trim(), userId: String(raw.userId || raw.user || raw.clientId || "").trim(), userEmail: String(raw.email || raw.userEmail || raw.correo || "").trim().toLowerCase(), userName: String(raw.fullName || raw.name || raw.nombre || "").trim(), amount, requestedAmount: amount, counterOfferAmount: raw.counterOfferAmount !== undefined && raw.counterOfferAmount !== null && raw.counterOfferAmount !== "" ? normalizeNumber(raw.counterOfferAmount, null) : null, status: String(raw.status || "pending").trim().toLowerCase(), note: String(raw.note || raw.message || "").trim(), adminNote: String(raw.adminNote || "").trim(), adminAction: String(raw.adminAction || "").trim(), reviewedBy: String(raw.reviewedBy || "").trim(), reviewedAt: raw.reviewedAt ? new Date(raw.reviewedAt) : null, ipAddress: String(raw.ipAddress || raw.ip || raw.registrationIp || "").trim(), userAgent: String(raw.userAgent || raw.ua || "").trim(), createdAt: raw.createdAt ? new Date(raw.createdAt) : new Date(), updatedAt: raw.updatedAt ? new Date(raw.updatedAt) : new Date(), raw }; if (!w.sourceId && !w.userId) return null; const query = w.sourceId ? { sourceId: w.sourceId } : { userId: w.userId, amount: w.amount, createdAt: w.createdAt }; let doc = await Withdraw.findOne(query).catch(() => null); if (!doc) { doc = new Withdraw({ sourceId: w.sourceId || undefined, userId: w.userId, userEmail: w.userEmail, userName: w.userName, amount: w.amount, requestedAmount: w.requestedAmount, counterOfferAmount: w.counterOfferAmount, status: w.status || "pending", note: w.note, adminNote: w.adminNote, adminAction: w.adminAction, reviewedBy: w.reviewedBy, reviewedAt: w.reviewedAt, ipAddress: w.ipAddress, userAgent: w.userAgent, reviewHistory: Array.isArray(w.raw?.reviewHistory) ? w.raw.reviewHistory : [], createdAt: w.createdAt, updatedAt: w.updatedAt }); } else { if (w.sourceId) doc.sourceId = w.sourceId; if (w.userId) doc.userId = w.userId; if (w.userEmail) doc.userEmail = w.userEmail; if (w.userName) doc.userName = w.userName; if (Number.isFinite(w.amount)) doc.amount = w.amount; if (Number.isFinite(w.requestedAmount)) doc.requestedAmount = w.requestedAmount; if (w.counterOfferAmount !== null) doc.counterOfferAmount = w.counterOfferAmount; if (w.status) doc.status = w.status; if (w.note) doc.note = w.note; if (w.adminNote) doc.adminNote = w.adminNote; if (w.adminAction) doc.adminAction = w.adminAction; if (w.reviewedBy) doc.reviewedBy = w.reviewedBy; if (w.reviewedAt) doc.reviewedAt = w.reviewedAt; if (w.ipAddress) doc.ipAddress = w.ipAddress; if (w.userAgent) doc.userAgent = w.userAgent; if (Array.isArray(w.raw?.reviewHistory)) doc.reviewHistory = w.raw.reviewHistory; doc.updatedAt = new Date(); } await doc.save(); return doc; }
async function syncCoreWithdrawsToLocal() { if (withdrawSyncLock) return { ok: false, skipped: true, reason: "sync_locked" }; withdrawSyncLock = true; try { const rows = await fetchCoreWithdrawsOnce(); let created = 0; let updated = 0; for (const raw of rows) { const before = await Withdraw.findOne(raw?.id || raw?._id || raw?.sourceId ? { sourceId: String(raw.id || raw._id || raw.sourceId) } : raw?.userId ? { userId: String(raw.userId), amount: normalizeNumber(raw.amount || raw.requestedAmount || 0) } : null).catch(() => null); const doc = await upsertLocalWithdrawFromCore(raw); if (!doc) continue; if (!before) created += 1; else updated += 1; } return { ok: true, synced: rows.length, created, updated }; } finally { withdrawSyncLock = false; } }

app.post(["/api/admin/login", "/api/login"], async (req, res) => { try { const { email, password } = req.body || {}; if (!email || !password) return res.status(400).json({ ok: false, msg: "Datos incompletos" }); if (!ADMIN_EMAIL || !ADMIN_PASS || !JWT_SECRET) return res.status(500).json({ ok: false, msg: "Servidor admin mal configurado" }); if (email !== ADMIN_EMAIL || password !== ADMIN_PASS) return res.status(401).json({ ok: false, msg: "Credenciales inválidas" }); const token = signAdminToken({ email }); res.cookie("admin_token", token, { httpOnly: true, sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", secure: process.env.NODE_ENV === "production", maxAge: 8 * 60 * 60 * 1000 }); return res.json({ ok: true, token, msg: "Login correcto", admin: { email, role: "admin" } }); } catch (err) { console.error("admin login error:", err); return res.status(500).json({ ok: false, msg: "Error del servidor" }); } });

app.post("/api/admin/sync-core", ensureAdminAuth, async (req, res) => { try { const result = await syncCoreUsersToLocal(); return res.json({ ok: true, ...result }); } catch (err) { console.error("sync-core error:", err); return res.status(500).json({ ok: false, msg: "Error sincronizando core", error: err?.message || String(err) }); } });
app.post("/api/admin/sync-withdraws", ensureAdminAuth, async (req, res) => { try { const result = await syncCoreWithdrawsToLocal(); return res.json({ ok: true, ...result }); } catch (err) { console.error("sync-withdraws error:", err); return res.status(500).json({ ok: false, msg: "Error sincronizando retiros", error: err?.message || String(err) }); } });

app.get(["/api/admin/users", "/api/users"], ensureAdminAuth, async (req, res) => { try { const users = await User.find({}).select("-password -verificationToken -__v").sort({ createdAt: -1 }).lean().exec().catch(() => []); return res.json(users); } catch (err) { console.error("GET users error:", err); return res.status(500).json({ ok: false, msg: "Error al listar usuarios" }); } });
app.post("/api/admin/users/:id/sync-core", ensureAdminAuth, async (req, res) => { try { const user = await User.findById(req.params.id).catch(() => null); if (!user) return res.status(404).json({ ok: false, msg: "Usuario no encontrado" }); const result = await upsertLocalUserFromCore(user.toObject ? user.toObject() : user); return res.json({ ok: true, result }); } catch (err) { console.error("sync single user error:", err); return res.status(500).json({ ok: false, msg: "Error sincronizando usuario", error: err?.message || String(err) }); } });

app.get(["/api/admin/account/:userId", "/api/account/:userId", "/api/admin/users/:userId/profile"], ensureAdminAuth, async (req, res) => { try { const user = await getTargetUserForAdmin(req, res); if (!user) return; const payload = await buildProfileForUser(user); return res.json({ ok: true, ...payload }); } catch (err) { console.error("GET account error:", err); return res.status(500).json({ ok: false, msg: "Error obteniendo cuenta" }); } });
app.get(["/api/account", "/api/admin/account"], ensureAdminAuth, async (req, res) => { try { const user = await getTargetUserForAdmin(req, res); if (!user) return; const payload = await buildProfileForUser(user); return res.json({ ok: true, ...payload }); } catch (err) { console.error("GET account error:", err); return res.status(500).json({ ok: false, msg: "Error obteniendo cuenta" }); } });
app.get("/api/profile/me", async (req, res) => { try { const user = await getUserDocFromBearer(req); if (!user) return res.status(401).json({ ok: false, msg: "No autorizado" }); const payload = await buildProfileForUser(user); return res.json({ ok: true, ...payload }); } catch (err) { console.error("GET profile me error:", err); return res.status(500).json({ ok: false, msg: "Error obteniendo perfil" }); } });

app.get("/api/admin/transactions", ensureAdminAuth, async (req, res) => { try { const userId = req.query.userId || null; const limit = Math.min(Number(req.query.limit || 100) || 100, 500); const txs = userId ? await loadTransactionsForUser(userId, limit) : await Transaction.find({}).sort({ createdAt: -1 }).limit(limit).lean().exec().catch(() => []); return res.json({ ok: true, count: txs.length, transactions: txs, data: txs, items: txs }); } catch (err) { console.error("/api/admin/transactions error:", err); return res.status(500).json({ ok: false, msg: "Error obteniendo transacciones" }); } });
app.get("/api/transactions", async (req, res) => { try { const user = await getUserDocFromBearer(req); const userId = req.query.userId || user?._id || null; if (!userId) return res.status(401).json({ ok: false, msg: "No autorizado" }); const limit = Math.min(Number(req.query.limit || 50) || 50, 200); const txs = await loadTransactionsForUser(userId, limit); return res.json({ ok: true, count: txs.length, transactions: txs, data: txs, items: txs }); } catch (err) { console.error("/api/transactions error:", err); return res.status(500).json({ ok: false, msg: "Error obteniendo transacciones" }); } });

app.post("/api/withdraw/request", async (req, res) => { try { const user = await getUserDocFromBearer(req); if (!user) return res.status(401).json({ ok: false, msg: "No autorizado" }); const { amount, note } = req.body || {}; const result = await createWithdrawRequest({ user, amount, note: note || "Solicitud de retiro", req }); return res.status(201).json({ ok: true, withdraw: result.withdraw, transaction: result.transaction, msg: "Solicitud creada" }); } catch (err) { console.error("withdraw request error:", err); return res.status(400).json({ ok: false, msg: err?.message || "Error creando solicitud" }); } });
app.get("/api/withdraw/requests/me", async (req, res) => { try { const user = await getUserDocFromBearer(req); if (!user) return res.status(401).json({ ok: false, msg: "No autorizado" }); const rows = await loadWithdrawsForUser(user._id, req.query.status || null); return res.json({ ok: true, count: rows.length, withdraws: rows, data: rows }); } catch (err) { console.error("my withdraws error:", err); return res.status(500).json({ ok: false, msg: "Error obteniendo solicitudes" }); } });
app.get("/api/admin/withdraws/:userId", ensureAdminAuth, async (req, res) => { try { const data = await loadWithdrawsForUser(req.params.userId, req.query.status || "pending"); return res.json({ ok: true, withdraws: data, data }); } catch (err) { console.error("GET withdraws error:", err); return res.status(500).json({ ok: false, msg: "Error obteniendo retiros" }); } });
app.get("/api/admin/withdraw-requests", ensureAdminAuth, async (req, res) => { try { const status = String(req.query.status || "pending").trim().toLowerCase(); const limit = Math.min(Number(req.query.limit || 200) || 200, 500); const query = {}; if (status && status !== "all") query.status = status; const rows = await Withdraw.find(query).sort({ createdAt: -1 }).limit(limit).lean().exec().catch(() => []); return res.json({ ok: true, count: rows.length, withdraws: rows, data: rows }); } catch (err) { console.error("GET withdraw-requests error:", err); return res.status(500).json({ ok: false, msg: "Error obteniendo solicitudes" }); } });
app.get("/api/admin/withdraw-requests/:id", ensureAdminAuth, async (req, res) => { try { const row = await Withdraw.findById(req.params.id).lean().exec().catch(() => null); if (!row) return res.status(404).json({ ok: false, msg: "Solicitud no encontrada" }); return res.json({ ok: true, withdraw: row }); } catch (err) { console.error("GET withdraw request error:", err); return res.status(500).json({ ok: false, msg: "Error obteniendo solicitud" }); } });
app.post("/api/admin/withdraw/review", ensureAdminAuth, async (req, res) => { try { const { id, action, amount, note } = req.body || {}; if (!id || !action) return res.status(400).json({ ok: false, msg: "id y action requeridos" }); const result = await reviewWithdrawRequest({ id, action, amount, note: note || "", reviewedBy: req.body?.reviewedBy || req.user?.email || "admin" }); if (!result.ok) return res.status(result.status || 400).json({ ok: false, msg: result.msg || "Error" }); return res.json({ ok: true, withdraw: result.withdraw, transaction: result.transaction, msg: "Solicitud actualizada" }); } catch (err) { console.error("withdraw review error:", err); return res.status(500).json({ ok: false, msg: "Error revisando solicitud" }); } });
app.put("/api/admin/withdraws/:id", ensureAdminAuth, async (req, res) => { try { const { amount, status, note, counterOfferAmount } = req.body || {}; const w = await Withdraw.findById(req.params.id).catch(() => null); if (!w) return res.status(404).json({ ok: false, msg: "Solicitud no encontrada" }); if (typeof amount !== "undefined" && amount !== null && amount !== "") { w.amount = normalizeNumber(amount, w.amount || 0); w.requestedAmount = w.amount; } if (typeof counterOfferAmount !== "undefined" && counterOfferAmount !== null && counterOfferAmount !== "") { w.counterOfferAmount = normalizeNumber(counterOfferAmount, w.counterOfferAmount || 0); } if (status) w.status = String(status).trim().toLowerCase(); if (note) w.adminNote = note; w.adminAction = "update"; w.reviewedAt = new Date(); w.updatedAt = new Date(); w.reviewHistory = Array.isArray(w.reviewHistory) ? w.reviewHistory : []; w.reviewHistory.push({ action: "update", amount: w.amount, counterOfferAmount: w.counterOfferAmount, note: note || "", at: new Date().toISOString() }); await w.save(); io.emit("admin:withdraw-response", { userId: w.userId, status: w.status, id: w.id, amount: w.amount, counterOfferAmount: w.counterOfferAmount, note }); io.emit(`withdraw:${w.userId}`, { id: w.id, status: w.status, amount: w.amount, counterOfferAmount: w.counterOfferAmount, note }); return res.json({ ok: true, msg: "Solicitud actualizada", withdraw: w }); } catch (err) { console.error("PUT withdraw error:", err); return res.status(500).json({ ok: false, msg: "Error actualizando solicitud" }); } });
app.post("/api/admin/withdraw/approve", ensureAdminAuth, async (req, res) => { try { const { id, note } = req.body || {}; if (!id) return res.status(400).json({ ok: false, msg: "id requerido" }); const result = await reviewWithdrawRequest({ id, action: "approve", amount: null, note: note || `Aprobación de retiro #${id}`, reviewedBy: req.body?.reviewedBy || req.user?.email || "admin" }); if (!result.ok) return res.status(result.status || 400).json({ ok: false, msg: result.msg || "Error" }); return res.json({ ok: true, msg: "Retiro aprobado", withdraw: result.withdraw, transaction: result.transaction }); } catch (err) { console.error("POST withdraw/approve error:", err); return res.status(500).json({ ok: false, msg: "Error aprobando retiro" }); } });
app.post("/api/admin/withdraw/reject", ensureAdminAuth, async (req, res) => { try { const { id, note } = req.body || {}; if (!id) return res.status(400).json({ ok: false, msg: "id requerido" }); const result = await reviewWithdrawRequest({ id, action: "reject", note: note || `Retiro rechazado #${id}`, reviewedBy: req.body?.reviewedBy || req.user?.email || "admin" }); if (!result.ok) return res.status(result.status || 400).json({ ok: false, msg: result.msg || "Error" }); return res.json({ ok: true, msg: "Retiro rechazado", withdraw: result.withdraw, transaction: result.transaction }); } catch (err) { console.error("POST withdraw/reject error:", err); return res.status(500).json({ ok: false, msg: "Error rechazando retiro" }); } });
app.post("/api/admin/withdraw/counteroffer", ensureAdminAuth, async (req, res) => { try { const { id, amount, note } = req.body || {}; if (!id || typeof amount === "undefined" || amount === null || amount === "") return res.status(400).json({ ok: false, msg: "id y amount requeridos" }); const result = await reviewWithdrawRequest({ id, action: "counteroffer", amount, note: note || "Contraoferta del admin", reviewedBy: req.body?.reviewedBy || req.user?.email || "admin" }); if (!result.ok) return res.status(result.status || 400).json({ ok: false, msg: result.msg || "Error" }); return res.json({ ok: true, msg: "Contraoferta enviada", withdraw: result.withdraw, transaction: result.transaction }); } catch (err) { console.error("withdraw counteroffer error:", err); return res.status(500).json({ ok: false, msg: "Error enviando contraoferta" }); } });

app.post("/api/kyc/upload", ensureUserAuth, kycUploadMiddleware, async (req, res) => { try { const user = req.currentUser; const file = getUploadedFile(req); const type = String(req.body?.type || req.body?.tipo || "identificacion").toLowerCase(); if (!file) return res.status(400).json({ ok: false, msg: "Archivo requerido" }); if (!["identificacion", "identification", "proof_of_address", "comprobante_domicilio", "domicilio"].includes(type)) return res.status(400).json({ ok: false, msg: "Tipo de documento inválido" }); const normalizedType = type === "proof_of_address" || type === "comprobante_domicilio" || type === "domicilio" ? "proof_of_address" : "identification"; const doc = await KycDocument.create({ userId: String(user._id), userRef: user._id, userEmail: user.email || "", userName: user.fullName || [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "", type: normalizedType, originalName: file.originalname, filename: file.filename, mimeType: file.mimetype, size: file.size, path: file.path, status: "pending", adminNote: "", reviewedBy: "", reviewedAt: null, ipAddress: getClientIp(req), userAgent: String(req.headers["user-agent"] || "") }); io.emit("admin:kyc-request-created", { userId: String(user._id), document: doc.toObject ? doc.toObject() : doc }); io.emit(`kyc:${String(user._id)}`, { id: String(doc._id), status: "pending", type: doc.type }); emitStateUpdates(String(user._id), { kyc: doc.toObject ? doc.toObject() : doc }); return res.status(201).json({ ok: true, document: doc, msg: "Documento subido" }); } catch (err) { console.error("KYC upload error:", err); return res.status(400).json({ ok: false, msg: err?.message || "Error subiendo documento" }); } });
app.put("/api/kyc/upload/:id", ensureUserAuth, kycUploadMiddleware, async (req, res) => { try { const user = req.currentUser; const doc = await KycDocument.findById(req.params.id).catch(() => null); if (!doc) return res.status(404).json({ ok: false, msg: "Documento no encontrado" }); if (String(doc.userId) !== String(user._id)) return res.status(403).json({ ok: false, msg: "No autorizado" }); if (!["pending", "rejected"].includes(String(doc.status))) return res.status(400).json({ ok: false, msg: "No se puede reemplazar este documento" }); const file = getUploadedFile(req); if (!file) return res.status(400).json({ ok: false, msg: "Archivo requerido" }); if (doc.path && fs.existsSync(doc.path)) { try { fs.unlinkSync(doc.path); } catch {} } doc.originalName = file.originalname; doc.filename = file.filename; doc.mimeType = file.mimetype; doc.size = file.size; doc.path = file.path; doc.status = "pending"; doc.adminNote = ""; doc.reviewedBy = ""; doc.reviewedAt = null; doc.updatedAt = new Date(); await doc.save(); io.emit("admin:kyc-request-updated", { userId: String(user._id), document: doc.toObject ? doc.toObject() : doc }); io.emit(`kyc:${String(user._id)}`, { id: String(doc._id), status: "pending", type: doc.type }); return res.json({ ok: true, document: doc, msg: "Documento actualizado" }); } catch (err) { console.error("KYC replace error:", err); return res.status(400).json({ ok: false, msg: err?.message || "Error actualizando documento" }); } });
app.get("/api/kyc/my-documents", async (req, res) => { try { const user = await getUserDocFromBearer(req); if (!user) return res.status(401).json({ ok: false, msg: "No autorizado" }); const rows = await KycDocument.find({ userId: String(user._id) }).sort({ createdAt: -1 }).lean().exec().catch(() => []); return res.json({ ok: true, count: rows.length, documents: rows, data: rows }); } catch (err) { console.error("my kyc documents error:", err); return res.status(500).json({ ok: false, msg: "Error obteniendo documentos" }); } });
app.get("/api/admin/kyc-documents", ensureAdminAuth, async (req, res) => { try { const userId = req.query.userId || null; const status = String(req.query.status || "").trim().toLowerCase(); const limit = Math.min(Number(req.query.limit || 200) || 200, 500); const query = {}; if (userId) query.userId = String(userId); if (status && status !== "all") query.status = status; const rows = await KycDocument.find(query).sort({ createdAt: -1 }).limit(limit).lean().exec().catch(() => []); return res.json({ ok: true, count: rows.length, documents: rows, data: rows }); } catch (err) { console.error("admin kyc list error:", err); return res.status(500).json({ ok: false, msg: "Error obteniendo documentos" }); } });
app.get("/api/admin/kyc-documents/:userId", ensureAdminAuth, async (req, res) => { try { const rows = await KycDocument.find({ userId: String(req.params.userId) }).sort({ createdAt: -1 }).lean().exec().catch(() => []); return res.json({ ok: true, count: rows.length, documents: rows, data: rows }); } catch (err) { console.error("admin kyc user error:", err); return res.status(500).json({ ok: false, msg: "Error obteniendo documentos" }); } });
app.get("/api/admin/kyc-documents/:id/file", ensureAdminAuth, async (req, res) => { try { const doc = await KycDocument.findById(req.params.id).catch(() => null); if (!doc) return res.status(404).json({ ok: false, msg: "Documento no encontrado" }); const filePath = safeFilePath(doc.path); if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ ok: false, msg: "Archivo no disponible" }); return res.sendFile(filePath); } catch (err) { console.error("admin kyc file error:", err); return res.status(500).json({ ok: false, msg: "Error abriendo archivo" }); } });
app.post("/api/admin/kyc-documents/:id/review", ensureAdminAuth, async (req, res) => { try { const { status, note } = req.body || {}; if (!status) return res.status(400).json({ ok: false, msg: "status requerido" }); const normalized = String(status).toLowerCase(); if (!["approved", "rejected", "pending"].includes(normalized)) return res.status(400).json({ ok: false, msg: "status inválido" }); const result = await reviewKycDocument({ id: req.params.id, status: normalized, note: note || "", reviewedBy: req.body?.reviewedBy || req.user?.email || "admin" }); return res.json({ ok: true, msg: "Documento actualizado", document: result.document }); } catch (err) { console.error("kyc review error:", err); return res.status(500).json({ ok: false, msg: "Error revisando documento" }); } });

app.post(["/api/admin/update-leverage", "/api/update-leverage"], ensureAdminAuth, async (req, res) => { try { const { userId, leverage } = req.body || {}; if (!userId || typeof leverage === "undefined" || leverage === null || leverage === "") return res.status(400).json({ msg: "Datos incompletos" }); const user = await User.findById(userId).catch(() => null); if (!user) return res.status(404).json({ msg: "Usuario no encontrado" }); const lev = Number(leverage); if (!Number.isFinite(lev) || lev <= 0) return res.status(400).json({ msg: "Leverage inválido" }); const wallet = await getWalletDocForUser(user._id); wallet.leverageFactor = lev; wallet.updatedAt = new Date(); await wallet.save(); user.leverage = lev; user.updatedAt = new Date(); await user.save(); const account = await buildProfileForUser(user); emitStateUpdates(userId, { account: account.account }); return res.json({ ok: true, msg: "Leverage actualizado", leverage: lev, account: account.account, wallet: account.wallet }); } catch (err) { console.error("/api/admin/update-leverage error:", err); return res.status(500).json({ msg: "Error actualizando leverage" }); } });
app.put("/api/admin/users/leverage/:id", ensureAdminAuth, async (req, res) => { try { const { leverage } = req.body || {}; const user = await User.findById(req.params.id).catch(() => null); if (!user) return res.status(404).json({ msg: "Usuario no encontrado" }); const lev = Number(leverage); if (!Number.isFinite(lev) || lev <= 0) return res.status(400).json({ msg: "Leverage inválido" }); const wallet = await getWalletDocForUser(user._id); wallet.leverageFactor = lev; wallet.updatedAt = new Date(); await wallet.save(); user.leverage = lev; user.updatedAt = new Date(); await user.save(); const account = await buildProfileForUser(user); emitStateUpdates(String(user._id), { account: account.account }); return res.json({ ok: true, msg: "Leverage actualizado (PUT)", leverage: lev, account: account.account, wallet: account.wallet }); } catch (err) { console.error("PUT /admin/users/leverage/:id error:", err); return res.status(500).json({ msg: "Error actualizando leverage" }); } });
app.post(["/api/admin/update-balance", "/api/update-balance"], ensureAdminAuth, async (req, res) => { try { const { userId, balance, leverage, note } = req.body || {}; if (!userId) return res.status(400).json({ ok: false, msg: "userId requerido" }); const user = await User.findById(userId).catch(() => null); if (!user) return res.status(404).json({ ok: false, msg: "Usuario no encontrado" }); const wallet = await getWalletDocForUser(user._id); const targetBalance = Math.max(0, normalizeNumber(balance, getEffectiveBalance(user, wallet))); const before = getEffectiveBalance(user, wallet); wallet.balanceOwn = targetBalance; wallet.balance = targetBalance; wallet.equity = targetBalance; wallet.freeMargin = Math.max(targetBalance - (Number(wallet.marginUsed ?? 0) || 0), 0); wallet.marginLevel = Number(wallet.marginUsed ?? 0) > 0 ? (wallet.equity / wallet.marginUsed) * 100 : 0; if (leverage !== undefined && leverage !== null && leverage !== "") { wallet.leverageFactor = Number(leverage) || 1; user.leverage = Number(leverage) || 1; } wallet.updatedAt = new Date(); user.balance = targetBalance; user.updatedAt = new Date(); await wallet.save(); await user.save(); const tx = await recordTransaction({ user, type: "adjustment", amount: targetBalance - before, status: "completed", note: note || "Update balance", balanceBefore: before, balanceAfter: targetBalance, meta: { source: "admin-update-balance", action: "set_balance" }, source: "admin-server.js/update-balance" }); const account = await buildProfileForUser(user); emitStateUpdates(String(user._id), { account: account.account, transaction: tx }); return res.json({ ok: true, msg: "Saldo actualizado", data: { balance: targetBalance, account: account.account, wallet: account.wallet, transaction: tx } }); } catch (err) { console.error("/api/admin/update-balance error:", err); return res.status(500).json({ ok: false, msg: "Error actualizando saldo" }); } });
app.post(["/api/admin/deposit", "/api/deposit"], ensureAdminAuth, async (req, res) => { try { const { userId, amount, leverage, note, currency } = req.body || {}; if (!userId || typeof amount === "undefined" || amount === null || amount === "") return res.status(400).json({ ok: false, error: "userId y amount son requeridos" }); const numericAmount = normalizeNumber(amount); if (!Number.isFinite(numericAmount) || numericAmount <= 0) return res.status(400).json({ ok: false, error: "amount inválido" }); const remote = await proxyToCore(req, "/api/admin/deposit", { method: "POST", body: { userId, amount: numericAmount, leverage: leverage !== undefined ? Number(leverage) : undefined, note: note || "Admin deposit", currency: currency || "USD" } }); if (remote.ok) { if (remote.headers) relaySetCookies(remote.headers, res); const tx = remote.data?.data?.transaction || remote.data?.transaction || null; const account = remote.data?.data?.account || remote.data?.account || null; const wallet = remote.data?.data?.wallet || remote.data?.wallet || null; const balance = remote.data?.data?.balance ?? remote.data?.balance ?? account?.balance ?? null; emitStateUpdates(userId, { account, wallet, transaction: tx }); if (balance !== null) io.emit(`balance:${userId}`, balance); return res.status(remote.status).json(remote.data); } const local = await localDeposit({ userId, amount: numericAmount, leverage: leverage !== undefined ? Number(leverage) : undefined, note: note || "Admin deposit", currency: currency || "USD" }); return res.status(local.status).json(local.data); } catch (err) { console.error("/api/admin/deposit error:", err); return res.status(500).json({ ok: false, msg: "Error depósito" }); } });
app.post(["/api/admin/withdraw", "/api/withdraw"], ensureAdminAuth, async (req, res) => { try { const { userId, amount, note } = req.body || {}; if (!userId || typeof amount === "undefined" || amount === null || amount === "") return res.status(400).json({ ok: false, error: "userId y amount son requeridos" }); const numericAmount = normalizeNumber(amount); if (!Number.isFinite(numericAmount) || numericAmount <= 0) return res.status(400).json({ ok: false, error: "amount inválido" }); const remote = await proxyToCore(req, "/api/admin/withdraw", { method: "POST", body: { userId, amount: numericAmount, note: note || "Admin withdrawal" } }); if (remote.ok) { if (remote.headers) relaySetCookies(remote.headers, res); const tx = remote.data?.data?.transaction || remote.data?.transaction || null; const account = remote.data?.data?.account || remote.data?.account || null; const wallet = remote.data?.data?.wallet || remote.data?.wallet || null; const balance = remote.data?.data?.balance ?? remote.data?.balance ?? account?.balance ?? null; emitStateUpdates(userId, { account, wallet, transaction: tx }); if (balance !== null) io.emit(`balance:${userId}`, balance); io.emit(`withdraw:${userId}`, { status: "approved" }); return res.status(remote.status).json(remote.data); } const local = await localWithdraw({ userId, amount: numericAmount, note: note || "Admin withdrawal" }); return res.status(local.status).json(local.data); } catch (err) { console.error("/api/admin/withdraw error:", err); return res.status(500).json({ ok: false, msg: "Error retiro" }); } });

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/healthz", (req, res) => res.json({ ok: true, env: process.env.NODE_ENV || "development", dbReadyState: mongoose.connection.readyState, coreConfigured: !!CORE_API_URL, adminApiKeyConfigured: !!ADMIN_API_KEY, adminEmailConfigured: !!ADMIN_EMAIL, adminTokenSecretConfigured: !!JWT_SECRET, mongoConfigured: !!process.env.MONGO_URI, kycUploadDir: UPLOAD_DIR }));
app.use("/api", (req, res) => res.status(404).json({ ok: false, msg: "API endpoint not found" }));
app.use((err, req, res, next) => { console.error("Unhandled error (admin):", err); res.status(err.status || 500).json({ ok: false, msg: "Error servidor", detail: process.env.NODE_ENV === "development" ? err.message || String(err) : undefined }); });

const PORT = Number(process.env.PORT || 4000);
server.listen(PORT, "0.0.0.0", () => { console.log(`🔥 ADMIN RUNNING EN: ${PORT}`); console.log("ENV:"); console.log("  CORE_API_URL:", CORE_API_URL || "(none)"); console.log("  ADMIN_API_KEY:", !!ADMIN_API_KEY); console.log("  ADMIN_EMAIL:", !!ADMIN_EMAIL); console.log("  JWT_SECRET:", !!JWT_SECRET); console.log("  MONGO:", !!process.env.MONGO_URI); console.log("  KYC UPLOAD DIR:", UPLOAD_DIR); });

let shuttingDown = false;
const gracefulShutdown = async (signal) => { if (shuttingDown) return; shuttingDown = true; console.log(`📴 ${signal} recibido. Cerrando servidor admin...`); const force = setTimeout(() => { console.warn("Forzando cierre admin..."); process.exit(1); }, 30_000); force.unref(); try { await new Promise((resolve, reject) => { server.close((err) => { if (err) return reject(err); resolve(); }); }); try { io.emit("server:shutdown"); await new Promise((resolve) => io.close(resolve)); } catch {} try { await mongoose.disconnect(); } catch {} clearTimeout(force); process.exit(0); } catch (err) { console.error("Error durante shutdown admin:", err); clearTimeout(force); process.exit(1); } };
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("unhandledRejection", (r) => { console.error("UnhandledRejection (admin):", r); gracefulShutdown("unhandledRejection"); });
process.on("uncaughtException", (e) => { console.error("UncaughtException (admin):", e); gracefulShutdown("uncaughtException"); });
