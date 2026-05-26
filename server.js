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

async function sendEmail({ to, subject, html }) {
  try {
    // RESEND
    if (process.env.RESEND_API_KEY) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.SENDER_EMAIL,
          to,
          subject,
          html,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error("RESEND ERROR:", data);
        return { ok: false, error: data };
      }

      return {
        ok: true,
        provider: "resend",
        result: data,
      };
    }

    console.warn("⚠️ No email provider configured");

    return {
      ok: false,
      error: "No email provider configured",
    };
  } catch (err) {
    console.error("sendEmail error:", err);

    return {
      ok: false,
      error: err.message,
    };
  }
}

/* ======================================================
   EMAIL NOTIFICATIONS
====================================================== */
async function sendWithdrawEmailNotification({
  user,
  status,
  amount,
  adminNote = "",
}) {
  try {
    if (!user?.email) return;

    const statusText =
      status === "approved"
        ? "APROBADO"
        : status === "rejected"
          ? "RECHAZADO"
          : status === "counter"
            ? "CONTRAOFERTA"
            : "ACTUALIZADO";

    const color =
      status === "approved"
        ? "#16a34a"
        : status === "rejected"
          ? "#dc2626"
          : "#d4af37";

    await sendEmail({
      to: user.email,
      subject: `Estado de retiro: ${statusText}`,
      html: `
      <div style="font-family:Arial;padding:20px;background:#0b0b0b;color:#fff">
        <h2 style="color:${color}">
          Solicitud de retiro ${statusText}
        </h2>

        <p>Hola ${user.name || "cliente"},</p>

        <p>Tu solicitud de retiro fue actualizada.</p>

        <div style="padding:15px;background:#151515;border-radius:10px">
          <p><strong>Monto:</strong> US$${Number(amount || 0).toLocaleString()}</p>
          <p><strong>Estado:</strong> ${statusText}</p>
          <p><strong>Nota administrativa:</strong> ${adminNote || "Sin nota"}</p>
        </div>

        <p style="margin-top:20px">
          Gracias por utilizar Leones Broker.
        </p>
      </div>
      `,
    });

    console.log("✅ Email retiro enviado:", user.email);
  } catch (err) {
    console.error("❌ sendWithdrawEmailNotification:", err);
  }
}

async function sendDocumentEmailNotification({
  user,
  status,
  type,
  adminNote = "",
}) {
  try {
    if (!user?.email) return;

    const statusText =
      status === "approved"
        ? "APROBADO"
        : status === "rejected"
          ? "RECHAZADO"
          : "ACTUALIZADO";

    const color =
      status === "approved"
        ? "#16a34a"
        : status === "rejected"
          ? "#dc2626"
          : "#d4af37";

    await sendEmail({
      to: user.email,
      subject: `Documento ${statusText}`,
      html: `
      <div style="font-family:Arial;padding:20px;background:#0b0b0b;color:#fff">
        <h2 style="color:${color}">
          Documento ${statusText}
        </h2>

        <p>Hola ${user.name || "cliente"},</p>

        <p>Tu documento fue revisado por administración.</p>

        <div style="padding:15px;background:#151515;border-radius:10px">
          <p><strong>Tipo:</strong> ${type || "Documento"}</p>
          <p><strong>Estado:</strong> ${statusText}</p>
          <p><strong>Nota administrativa:</strong> ${adminNote || "Sin nota"}</p>
        </div>

        <p style="margin-top:20px">
          Gracias por utilizar Leones Broker.
        </p>
      </div>
      `,
    });

    console.log("✅ Email documento enviado:", user.email);
  } catch (err) {
    console.error("❌ sendDocumentEmailNotification:", err);
  }
}

async function sendClientMessageNotification({
  user,
  subject,
  message,
}) {
  try {
    if (!user?.email) return;

    await sendEmail({
      to: user.email,
      subject: subject || "Nuevo mensaje de administración",
      html: `
      <div style="font-family:Arial;padding:20px;background:#0b0b0b;color:#fff">
        <h2 style="color:#d4af37">
          Nuevo mensaje de administración
        </h2>

        <p>Hola ${user.name || "cliente"},</p>

        <div style="padding:15px;background:#151515;border-radius:10px">
          ${message || ""}
        </div>

        <p style="margin-top:20px">
          Leones Broker
        </p>
      </div>
      `,
    });

    console.log("✅ Email mensaje enviado:", user.email);
  } catch (err) {
    console.error("❌ sendClientMessageNotification:", err);
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

/* ======================================================
   INITIAL CORE SYNC
====================================================== */
async function ensureInitialCoreSync() {
  try {
    const result = await syncCoreUsersToLocalAndZoho();
    console.log("✅ Sync inicial core->local->zoho:", result);
  } catch (err) {
    console.warn("Sync inicial falló:", err?.message || err);
  }
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
   EMAIL NOTIFICATIONS
====================================================== */
async function sendWithdrawEmailNotification({ user, status, amount, adminNote = "" }) {
  try {
    if (typeof sendEmail !== "function") return;
    if (!user?.email) return;

    const statusText =
      status === "approved"
        ? "APROBADO"
        : status === "rejected"
          ? "RECHAZADO"
          : status === "counter"
            ? "CONTRAOFERTA"
            : "ACTUALIZADO";

    const color =
      status === "approved"
        ? "#16a34a"
        : status === "rejected"
          ? "#dc2626"
          : "#d4af37";

    await sendEmail({
      to: user.email,
      subject: `Estado de retiro: ${statusText}`,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
          <h2 style="color:${color}">Solicitud de retiro ${statusText}</h2>
          <p>Hola ${user.name || "cliente"},</p>
          <p>Tu solicitud de retiro fue actualizada.</p>
          <div style="padding:15px;background:#f6f6f6;border-radius:10px">
            <p><strong>Monto:</strong> US$${Number(amount || 0).toLocaleString()}</p>
            <p><strong>Estado:</strong> ${statusText}</p>
            <p><strong>Nota administrativa:</strong> ${adminNote || "Sin nota"}</p>
          </div>
        </div>
      `,
    });
  } catch (err) {
    console.error("sendWithdrawEmailNotification error:", err);
  }
}

async function sendDocumentEmailNotification({ user, status, type, adminNote = "" }) {
  try {
    if (typeof sendEmail !== "function") return;
    if (!user?.email) return;

    const statusText =
      status === "approved"
        ? "APROBADO"
        : status === "rejected"
          ? "RECHAZADO"
          : "ACTUALIZADO";

    const color =
      status === "approved"
        ? "#16a34a"
        : status === "rejected"
          ? "#dc2626"
          : "#d4af37";

    await sendEmail({
      to: user.email,
      subject: `Documento ${statusText}`,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
          <h2 style="color:${color}">Documento ${statusText}</h2>
          <p>Hola ${user.name || "cliente"},</p>
          <p>Tu documento fue revisado por administración.</p>
          <div style="padding:15px;background:#f6f6f6;border-radius:10px">
            <p><strong>Tipo:</strong> ${type || "Documento"}</p>
            <p><strong>Estado:</strong> ${statusText}</p>
            <p><strong>Nota administrativa:</strong> ${adminNote || "Sin nota"}</p>
          </div>
        </div>
      `,
    });
  } catch (err) {
    console.error("sendDocumentEmailNotification error:", err);
  }
}

async function sendClientMessageNotification({ user, subject, message }) {
  try {
    if (typeof sendEmail !== "function") return;
    if (!user?.email) return;

    await sendEmail({
      to: user.email,
      subject: subject || "Nuevo mensaje de administración",
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
          <h2 style="color:#d4af37">Nuevo mensaje de administración</h2>
          <p>Hola ${user.name || "cliente"},</p>
          <div style="padding:15px;background:#f6f6f6;border-radius:10px">
            ${message || ""}
          </div>
        </div>
      `,
    });
  } catch (err) {
    console.error("sendClientMessageNotification error:", err);
  }
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

    const user = await User.findById(userId).catch(() => null);

    if (!user) {
      return res.status(404).json({
        ok: false,
        msg: "Usuario no encontrado",
      });
    }

    const wallet = await getWalletDocForUser(user._id);

    /* =========================
       UPDATE WALLET
    ========================= */

    wallet.balance = amount;
    wallet.balanceOwn = amount;
    wallet.availableBalance = amount;
    wallet.equity = amount;
    wallet.freeMargin = amount;
    wallet.marginUsed = 0;
    wallet.updatedAt = new Date();

    await wallet.save();

    /* =========================
       UPDATE USER
    ========================= */

    user.balance = amount;
    user.updatedAt = new Date();

    await user.save();

    /* =========================
       BUILD UPDATED ACCOUNT
    ========================= */

    const payload = await buildAccountForUser(user);

    /* =========================
       REALTIME EMITS
    ========================= */

    io.emit(`balance:${userId}`, amount);

    io.emit("account:update", {
      userId: String(userId),
      account: payload.account,
      wallet: payload.wallet,
    });

    io.emit(`account:${userId}`, {
      userId: String(userId),
      account: payload.account,
      wallet: payload.wallet,
    });

    io.emit("admin:user:update", {
      userId: String(userId),
      account: payload.account,
      wallet: payload.wallet,
      balance: amount,
    });

    emitStateUpdates(
      String(userId),
      {
        account: payload.account,
        wallet: payload.wallet,
      },
      null,
      null
    );

    return res.json({
      ok: true,
      msg: "Saldo actualizado",
      balance: amount,
      account: payload.account,
      wallet: payload.wallet,
    });

  } catch (err) {
    console.error("/api/admin/update-balance error:", err);

    return res.status(500).json({
      ok: false,
      msg: "Error actualizando saldo",
      error: err?.message || String(err),
    });
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
    if (!Number.isFinite(lev) || lev <= 0) return res.status(400).json({ msg: "Leverage inválido" });

    const wallet = await getWalletDocForUser(user._id);
    wallet.leverageFactor = lev;
    wallet.updatedAt = new Date();
    await wallet.save();

    user.leverage = lev;
    user.updatedAt = new Date();
    await user.save();

    const account = await buildAccountForUser(user);
    emitStateUpdates(userId, account, null, null);

    return res.json({ ok: true, msg: "Leverage actualizado", leverage: lev, account: account.account, wallet: account.wallet });
  } catch (err) {
    console.error("/api/admin/update-leverage error:", err);
    return res.status(500).json({ msg: "Error actualizando leverage" });
  }
});

app.put("/api/admin/users/leverage/:id", ensureAdminAuth, async (req, res) => {
  try {
    const { leverage } = req.body || {};
    const user = await User.findById(req.params.id).catch(() => null);
    if (!user) return res.status(404).json({ msg: "Usuario no encontrado" });

    const lev = Number(leverage);
    if (!Number.isFinite(lev) || lev <= 0) return res.status(400).json({ msg: "Leverage inválido" });

    const wallet = await getWalletDocForUser(user._id);
    wallet.leverageFactor = lev;
    wallet.updatedAt = new Date();
    await wallet.save();

    user.leverage = lev;
    user.updatedAt = new Date();
    await user.save();

    const account = await buildAccountForUser(user);
    emitStateUpdates(String(user._id), account, null, null);

    return res.json({ ok: true, msg: "Leverage actualizado (PUT)", leverage: lev, account: account.account, wallet: account.wallet });
  } catch (err) {
    console.error("PUT /admin/users/leverage/:id error:", err);
    return res.status(500).json({ msg: "Error actualizando leverage" });
  }
});

    /* =========================
       UPDATE WALLET
    ========================= */

    wallet.balance = amount;
    wallet.balanceOwn = amount;
    wallet.availableBalance = amount;
    wallet.equity = amount;
    wallet.freeMargin = amount;
    wallet.marginUsed = 0;
    wallet.updatedAt = new Date();

    await wallet.save();

    /* =========================
       UPDATE USER
    ========================= */

    user.balance = amount;
    user.updatedAt = new Date();

    await user.save();

    /* =========================
       BUILD UPDATED ACCOUNT
    ========================= */

    const payload = await buildAccountForUser(user);

    /* =========================
       REALTIME EMITS
    ========================= */

    io.emit(`balance:${userId}`, amount);

    io.emit("account:update", {
      userId: String(userId),
      account: payload.account,
      wallet: payload.wallet,
    });

    io.emit(`account:${userId}`, {
      userId: String(userId),
      account: payload.account,
      wallet: payload.wallet,
    });

    io.emit("admin:user:update", {
      userId: String(userId),
      account: payload.account,
      wallet: payload.wallet,
      balance: amount,
    });

    emitStateUpdates(
      String(userId),
      {
        account: payload.account,
        wallet: payload.wallet,
      },
      null,
      null
    );

    return res.json({
      ok: true,
      msg: "Saldo actualizado",
      balance: amount,
      account: payload.account,
      wallet: payload.wallet,
    });

  } catch (err) {
    console.error("/api/admin/update-balance error:", err);

    return res.status(500).json({
      ok: false,
      msg: "Error actualizando saldo",
      error: err?.message || String(err),
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

      const user = await User.findById(userId).catch(() => null);

      await sendWithdrawEmailNotification({
        user,
        status: "approved",
        amount,
        adminNote,
      });

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

      const user = await User.findById(userId).catch(() => null);

      await sendWithdrawEmailNotification({
        user,
        status: "rejected",
        amount,
        adminNote,
      });

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

/* ======================================================
   WITHDRAW MESSAGES
====================================================== */
app.post(
  ["/api/admin/withdraw/message", "/api/admin/withdrawals/message"],
  ensureAdminAuth,
  async (req, res) => {
    try {
      const { id, adminMessage = "" } = req.body || {};
      if (!id) {
        return res.status(400).json({ ok: false, msg: "id requerido" });
      }
      if (!adminMessage) {
        return res.status(400).json({ ok: false, msg: "adminMessage requerido" });
      }

      const w = await Withdraw.findById(id).catch(() => null);
      if (!w) {
        return res.status(404).json({ ok: false, msg: "Retiro no encontrado" });
      }

      w.adminMessage = adminMessage;
      w.updatedAt = new Date();
      await w.save();

      const user = await User.findById(w.userId).catch(() => null);

      await sendClientMessageNotification({
        user,
        subject: "Nuevo mensaje sobre tu retiro",
        message: adminMessage,
      });

      const payload = {
        ok: true,
        id: String(w._id),
        userId: String(w.userId || ""),
        adminMessage,
        status: w.status || "pending",
        updatedAt: new Date(),
      };

      emitWithdrawRealtime(payload);
      return res.json(payload);
    } catch (err) {
      console.error("POST withdraw/message error:", err);
      return res.status(500).json({
        ok: false,
        msg: "Error enviando mensaje",
        error: err?.message || String(err),
      });
    }
  }
);

/* ======================================================
   WITHDRAW COUNTER OFFER
====================================================== */
app.post(
  ["/api/admin/withdraw/counter-offer", "/api/admin/withdrawals/counter-offer"],
  ensureAdminAuth,
  async (req, res) => {
    try {
      const { id, counterAmount, counterNote = "" } = req.body || {};
      if (!id) {
        return res.status(400).json({ ok: false, msg: "id requerido" });
      }

      const numericCounterAmount = Number(counterAmount);
      if (!Number.isFinite(numericCounterAmount) || numericCounterAmount <= 0) {
        return res.status(400).json({ ok: false, msg: "counterAmount inválido" });
      }

      const w = await Withdraw.findById(id).catch(() => null);
      if (!w) {
        return res.status(404).json({ ok: false, msg: "Retiro no encontrado" });
      }

      const user = await User.findById(w.userId).catch(() => null);

      w.status = "counter";
      w.counterAmount = numericCounterAmount;
      w.counterNote = counterNote;
      w.updatedAt = new Date();

      await w.save();

      await sendWithdrawEmailNotification({
        user,
        status: "counter",
        amount: numericCounterAmount,
        adminNote: counterNote,
      });

      const payload = {
        ok: true,
        id: String(w._id),
        userId: String(w.userId || ""),
        counterAmount: numericCounterAmount,
        counterNote,
        status: "counter",
        updatedAt: new Date(),
      };

      emitWithdrawRealtime(payload);
      return res.json(payload);
    } catch (err) {
      console.error("POST withdraw/counter-offer error:", err);
      return res.status(500).json({
        ok: false,
        msg: "Error enviando contraoferta",
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

      const user = await User.findById(doc.userId).catch(() => null);

      await sendDocumentEmailNotification({
        user,
        status: "approved",
        type: doc.type,
        adminNote,
      });

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

      const user = await User.findById(doc.userId).catch(() => null);

      await sendDocumentEmailNotification({
        user,
        status: "rejected",
        type: doc.type,
        adminNote,
      });

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


   app.use(cors({
  origin: true,
  credentials: true,
}));

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use(express.static(path.join(__dirname, "public")));
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

  /* =========================
     INITIAL CORE SYNC
  ========================= */
  setTimeout(() => {
    ensureInitialCoreSync();
  }, 3000);

  if (Number(process.env.ZOHO_SYNC_INTERVAL_MS || 300000) > 0) {
    setInterval(() => {
      syncCoreUsersToLocalAndZoho().catch((e) =>
        console.warn("sync interval error:", e?.message || e)
      );
    }, Number(process.env.ZOHO_SYNC_INTERVAL_MS || 300000)).unref();
  }
});

module.exports = app;
