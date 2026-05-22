require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const path = require("path");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const multer = require("multer"); // <-- Para manejar uploads
const { Server } = require("socket.io");

// Helpers / utils
const { signAdminToken, ensureAdminAuth } = require("./utils/auth");
const {
  User,
  Withdraw,
  Document,
  Transaction,
  getWalletDocForUser,
  buildAccountForUser,
  recordTransaction,
  emitStateUpdates,
  normalizeNumber,
  proxyToCore,
  relaySetCookies,
  loadWithdrawsForUser,
  loadTransactionsForUser,
  getEffectiveBalance,
  syncCoreUsersToLocalAndZoho,
  syncUserToZohoAndMark,
  getTargetUserForAdmin,
  zohoReady,
} = require("./utils/core");

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASS = process.env.ADMIN_PASS;
const JWT_SECRET = process.env.JWT_SECRET;
const CORE_API_URL = process.env.CORE_API_URL;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", credentials: true } });

// Multer upload config
const upload = multer({ dest: "uploads/" });

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

/* ======================================================
   LOCAL BALANCE / WITHDRAW HELPERS
====================================================== */
async function localDeposit({ userId, amount, leverage, note, currency = "USD" }) {
  const user = await User.findById(userId).catch(() => null);
  if (!user) return { ok: false, status: 404, data: { ok: false, msg: "Usuario no encontrado" } };

  const numericAmount = Math.abs(normalizeNumber(amount, 0));
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return { ok: false, status: 400, data: { ok: false, msg: "amount inválido" } };
  }

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
      data: { balance: wallet.balanceOwn, leverage: wallet.leverageFactor, transaction: tx, account: account.account, wallet: account.wallet },
    },
  };
}

async function localWithdraw({ userId, amount, note, force = false }) {
  const user = await User.findById(userId).catch(() => null);
  if (!user) return { ok: false, status: 404, data: { ok: false, msg: "Usuario no encontrado" } };

  const numericAmount = Math.abs(normalizeNumber(amount, 0));
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return { ok: false, status: 400, data: { ok: false, msg: "amount inválido" } };
  }

  const wallet = await getWalletDocForUser(user._id);
  const before = Number(wallet.balanceOwn ?? wallet.balance ?? user.balance ?? 0) || 0;

  if (!force && before < numericAmount) {
    return { ok: false, status: 400, data: { ok: false, msg: "Saldo insuficiente" } };
  }

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
      data: { balance: wallet.balanceOwn, transaction: tx, account: account.account, wallet: account.wallet },
    },
  };
}

/* ======================================================
   WITHDRAW / DOCUMENT ROUTES (ADMIN VIEW)
====================================================== */
// List all withdraws
app.get("/api/admin/withdraws", ensureAdminAuth, async (req, res) => {
  try {
    const withdraws = await Withdraw.find({}).sort({ createdAt: -1 }).lean().exec();
    const result = withdraws.map((w) => ({ ...w, proofUrl: w.proofUrl || null, amount: w.amount || 0, status: w.status || "pending", userId: w.userId, createdAt: w.createdAt, updatedAt: w.updatedAt }));
    return res.json({ ok: true, count: result.length, withdraws: result });
  } catch (err) {
    console.error("GET /api/admin/withdraws error:", err);
    return res.status(500).json({ ok: false, msg: "Error obteniendo retiros", error: err?.message || String(err) });
  }
});

// Get user documents
app.get("/api/admin/documents/:userId", ensureAdminAuth, async (req, res) => {
  try {
    const userId = req.params.userId;
    const docs = await Document.find({ userId }).sort({ createdAt: -1 }).lean().exec();
    const result = docs.map((d) => ({ _id: d._id, userId: d.userId, type: d.type || "Desconocido", documentUrl: d.documentUrl || d.proofUrl || null, status: d.status || "pendiente", adminNote: d.adminNote || "", createdAt: d.createdAt, updatedAt: d.updatedAt }));
    return res.json({ ok: true, count: result.length, documents: result });
  } catch (err) {
    console.error(`GET /api/admin/documents/${req.params.userId} error:`, err);
    return res.status(500).json({ ok: false, msg: "Error obteniendo documentos", error: err?.message || String(err) });
  }
});

// Upload document
app.post("/api/admin/verification/upload", ensureAdminAuth, upload.single("file"), async (req, res) => {
  try {
    const { userId, type } = req.body;
    if (!req.file || !userId) return res.status(400).json({ ok: false, msg: "Archivo o userId faltante" });
    const doc = new Document({ userId, type, documentUrl: `/uploads/${req.file.filename}`, status: "pendiente", createdAt: new Date(), updatedAt: new Date() });
    await doc.save();
    io.emit(`document:${userId}`, { status: "pending", type, documentUrl: doc.documentUrl });
    return res.json({ ok: true, msg: "Documento subido", document: doc });
  } catch (err) {
    console.error("/api/admin/verification/upload error:", err);
    return res.status(500).json({ ok: false, msg: "Error subiendo documento" });
  }
});
