const router = require("express").Router();
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

// Intentar cargar el modelo real del admin; si no existe, usar fallback seguro.
let User;
try {
  User = require("../models/User");
} catch (e1) {
  try {
    User = require("../models/user");
  } catch (e2) {
    const userSchema =
      mongoose.models.User?.schema ||
      new mongoose.Schema(
        {
          email: String,
          password: String,
          balance: { type: Number, default: 0 },
          leverage: { type: Number, default: 1 },
          currency: { type: String, default: "USD" },
          role: { type: String, default: "user" },
          isAdmin: { type: Boolean, default: false },
          admin: { type: Boolean, default: false },
        },
        { minimize: false }
      );
    User = mongoose.models.User || mongoose.model("User", userSchema);
  }
}

const walletSchema =
  mongoose.models.Wallet?.schema ||
  new mongoose.Schema(
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
      updatedAt: { type: Date, default: Date.now },
    },
    { minimize: false }
  );

const transactionSchema =
  mongoose.models.Transaction?.schema ||
  new mongoose.Schema(
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
      source: { type: String, default: "admin.routes.js" },
      createdAt: { type: Date, default: Date.now },
    },
    { minimize: false }
  );

const withdrawSchema =
  mongoose.models.Withdraw?.schema ||
  new mongoose.Schema(
    {
      user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
      userId: { type: String, index: true },
      amount: { type: Number, default: 0 },
      status: { type: String, default: "pending", index: true }, // pending | approved | rejected
      reason: { type: String, default: "" },
      note: { type: String, default: "" },
      createdAt: { type: Date, default: Date.now },
      updatedAt: { type: Date, default: Date.now },
    },
    { minimize: false }
  );

const positionSchema =
  mongoose.models.Position?.schema ||
  new mongoose.Schema(
    {
      user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
      symbol: { type: String, default: "" },
      side: { type: String, default: "" },
      qty: { type: Number, default: 0 },
      entryPrice: { type: Number, default: 0 },
      currentPrice: { type: Number, default: 0 },
      closePrice: { type: Number, default: 0 },
      status: { type: String, default: "OPEN", index: true },
      pnl: { type: Number, default: 0 },
      realizedPnl: { type: Number, default: 0 },
      marginReserved: { type: Number, default: 0 },
      leverage: { type: Number, default: 1 },
      createdAt: { type: Date, default: Date.now },
      updatedAt: { type: Date, default: Date.now },
      closedAt: { type: Date, default: null },
    },
    { minimize: false }
  );

const Wallet = mongoose.models.Wallet || mongoose.model("Wallet", walletSchema);
const Transaction =
  mongoose.models.Transaction || mongoose.model("Transaction", transactionSchema);
const Withdraw =
  mongoose.models.Withdraw || mongoose.model("Withdraw", withdrawSchema);
const Position =
  mongoose.models.Position || mongoose.model("Position", positionSchema);

const CORE_API_URL = process.env.CORE_API_URL || "";
const hasFetch = typeof fetch === "function";

/* ================= HELPERS ================= */
function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getIo(req) {
  return req.io || req.app?.get?.("io") || null;
}

function emitAdminUpdate(req, userId, payload = {}) {
  try {
    const io = getIo(req);
    if (!io || !userId) return;

    if (payload.balance !== undefined) {
      io.emit(`balance:${userId}`, payload.balance);
    }
    if (payload.withdrawStatus !== undefined) {
      io.emit(`withdraw:${userId}`, payload.withdrawStatus);
    }
    if (payload.transaction) {
      io.emit("transaction:new", payload.transaction);
      io.emit("transactions_update", { userId, transaction: payload.transaction });
    }
    io.emit("wallet_update", { userId, account: payload.account || null });
    io.emit("account_update", { userId, account: payload.account || null });
  } catch (err) {
    console.warn("emitAdminUpdate error:", err?.message || err);
  }
}

function normalizeWalletSnapshot(wallet, user, openPnl = 0) {
  const balanceOwn = toNumber(wallet?.balanceOwn ?? wallet?.balance ?? user?.balance ?? 0);
  const credit = toNumber(wallet?.credit ?? 0);
  const marginUsed = Math.max(toNumber(wallet?.marginUsed ?? 0), 0);
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
    leverageFactor: toNumber(wallet?.leverageFactor ?? user?.leverage ?? 1, 1),
    currency: wallet?.currency || user?.currency || "USD",
    openPnl,
  };
}

function normalizePosition(p = {}) {
  const entryPrice = toNumber(p.entryPrice ?? p.price ?? p.openPrice ?? 0);
  const currentPrice = toNumber(p.currentPrice ?? entryPrice);
  const qty = toNumber(p.qty ?? p.quantity ?? p.amount ?? p.positionSize ?? 0);
  const side = String(p.side || p.direction || p.positionSide || "").toUpperCase().trim();
  const sign = side === "SELL" ? -1 : 1;
  const pnl =
    p.status && String(p.status).toLowerCase().includes("close")
      ? toNumber(p.realizedPnl ?? p.pnl ?? 0)
      : (currentPrice - entryPrice) * qty * sign;

  return {
    ...p,
    entryPrice,
    currentPrice,
    qty,
    pnl,
    unrealizedPnl: pnl,
    isOpen: !String(p.status || "").toLowerCase().includes("close"),
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
      updatedAt: new Date(),
    });
  }
  return wallet;
}

async function getPositionsForUser(userId) {
  try {
    const rows = await Position.find({ user: userId }).sort({ createdAt: -1 }).lean().exec().catch(() => []);
    return (rows || []).map(normalizePosition);
  } catch {
    return [];
  }
}

async function loadTransactionsForUser(userId, limit = 50) {
  try {
    return await Transaction.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()
      .exec()
      .catch(() => []);
  } catch {
    return [];
  }
}

async function buildAccountForUser(userDoc) {
  const wallet = await getWalletForUser(userDoc._id);
  const positions = await getPositionsForUser(userDoc._id);
  const recentTransactions = await loadTransactionsForUser(userDoc._id, 20);

  const openPnl = (positions || []).reduce((sum, p) => sum + (toNumber(p.pnl, 0) || 0), 0);
  const normalizedWallet = normalizeWalletSnapshot(wallet, userDoc, openPnl);

  return {
    account: {
      ...normalizedWallet,
      balance: normalizedWallet.balance,
      balanceOwn: normalizedWallet.balanceOwn,
      equity: normalizedWallet.equity,
      leverage: toNumber(userDoc.leverage ?? wallet?.leverageFactor ?? 100, 100),
      currency: userDoc.currency || wallet?.currency || "USD",
      positions: positions || [],
      openPositions: positions || [],
      recentTransactions,
      transactions: recentTransactions,
      openPnl,
    },
    user: userDoc.toObject ? userDoc.toObject() : userDoc,
    wallet: wallet?.toObject ? wallet.toObject() : wallet,
    positions,
    transactions: recentTransactions,
  };
}

async function proxyToCore(req, endpoint, options = {}) {
  if (!CORE_API_URL || !hasFetch) {
    return { proxied: false, status: 0, data: null };
  }

  const headers = {
    "Content-Type": "application/json",
    "x-admin-api-key": process.env.ADMIN_API_KEY || "",
    "x-admin-key": process.env.ADMIN_API_KEY || "",
    authorization: req.headers.authorization || "",
    cookie: req.headers.cookie || "",
    ...(options.headers || {}),
  };

  const response = await fetch(`${CORE_API_URL}${endpoint}`, {
    method: options.method || "GET",
    headers,
    body: options.body,
  });

  const raw = await response.text().catch(() => "");
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { ok: false, raw };
  }

  return {
    proxied: true,
    status: response.status,
    data,
    setCookie: response.headers.get("set-cookie"),
  };
}

async function respondWithCoreOrLocal(req, res, endpoint, localHandler, options = {}) {
  try {
    if (CORE_API_URL) {
      const result = await proxyToCore(req, endpoint, options);
      if (result.setCookie) {
        res.setHeader("set-cookie", result.setCookie);
      }
      if (result.status >= 200 && result.status < 600 && result.data !== null) {
        return res.status(result.status).json(result.data);
      }
    }
  } catch (err) {
    console.warn("Proxy falló, usando modo local:", err?.message || err);
  }

  return localHandler();
}

/* ================= VERIFY ADMIN ================= */
function verifyAdmin(req, res, next) {
  try {
    const headerKey =
      req.headers["x-admin-api-key"] ||
      req.headers["x-admin-key"] ||
      req.headers["admin-key"];

    if (process.env.ADMIN_API_KEY && headerKey && headerKey === process.env.ADMIN_API_KEY) {
      return next();
    }

    const auth = req.headers.authorization || req.headers.Authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.split(" ")[1] : null;

    if (!token) {
      return res.status(401).json({ msg: "No autorizado" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded || !decoded.admin) {
      return res.status(403).json({ msg: "Acceso denegado" });
    }

    req.admin = decoded;
    return next();
  } catch (err) {
    console.error("verifyAdmin error:", err?.message || err);
    return res.status(401).json({ msg: "Token inválido" });
  }
}

/* ================= LOGIN ADMIN ================= */
router.post("/login", (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASS || !process.env.JWT_SECRET) {
      return res.status(500).json({ msg: "Servidor admin mal configurado" });
    }

    if (email !== process.env.ADMIN_EMAIL || password !== process.env.ADMIN_PASS) {
      return res.status(401).json({ msg: "Credenciales inválidas" });
    }

    const token = jwt.sign(
      {
        admin: true,
        email,
      },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    return res.json({ token, ok: true });
  } catch (err) {
    console.error("admin login error:", err);
    return res.status(500).json({ msg: "Error del servidor" });
  }
});

/* ================= GET USERS ================= */
router.get("/users", verifyAdmin, async (req, res) => {
  try {
    const users = await User.find()
      .select("-password -verificationToken -__v")
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    return res.json(Array.isArray(users) ? users : []);
  } catch (err) {
    console.error("GET /admin/users error:", err);
    return res.status(500).json({ msg: "Error al listar usuarios" });
  }
});

/* ================= ACCOUNT BY USER ID ================= */
router.get("/account/:userId", verifyAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ msg: "userId requerido" });

    const user = await User.findById(userId).select("-password -verificationToken -__v").catch(() => null);
    if (!user) return res.status(404).json({ msg: "Usuario no encontrado" });

    const payload = await buildAccountForUser(user);
    return res.json({ ok: true, ...payload });
  } catch (err) {
    console.error("GET /admin/account/:userId error:", err);
    return res.status(500).json({ msg: "Error obteniendo cuenta" });
  }
});

/* ================= TRANSACTIONS ================= */
router.get("/transactions", verifyAdmin, async (req, res) => {
  try {
    const { userId, limit } = req.query || {};

    if (userId) {
      const txs = await loadTransactionsForUser(userId, Math.min(Number(limit) || 100, 500));
      return res.json({ ok: true, count: txs.length, transactions: txs, data: txs, items: txs });
    }

    const txs = await Transaction.find({})
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(limit) || 100, 500))
      .lean()
      .exec()
      .catch(() => []);

    return res.json({ ok: true, count: txs.length, transactions: txs, data: txs, items: txs });
  } catch (err) {
    console.error("GET /admin/transactions error:", err);
    return res.status(500).json({ msg: "Error obteniendo transacciones" });
  }
});

/* ================= WITHDRAW REQUESTS ================= */
router.get("/withdraws/:userId", verifyAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ msg: "userId requerido" });

    const data = await Withdraw.find({ userId }).sort({ createdAt: -1 }).lean().exec().catch(() => []);
    return res.json(Array.isArray(data) ? data : []);
  } catch (err) {
    console.error("GET /admin/withdraws/:userId error:", err);
    return res.status(500).json({ msg: "Error obteniendo retiros" });
  }
});

router.post("/withdraw/approve", verifyAdmin, async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ msg: "id requerido" });

    const withdraw = await Withdraw.findById(id).catch(() => null);
    if (!withdraw) return res.status(404).json({ msg: "Solicitud no encontrada" });

    withdraw.status = "approved";
    withdraw.updatedAt = new Date();
    await withdraw.save();

    emitAdminUpdate(req, withdraw.userId, {
      withdrawStatus: "approved",
    });

    return res.json({ ok: true, msg: "Retiro aprobado" });
  } catch (err) {
    console.error("POST /admin/withdraw/approve error:", err);
    return res.status(500).json({ msg: "Error aprobando retiro" });
  }
});

router.post("/withdraw/reject", verifyAdmin, async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ msg: "id requerido" });

    const withdraw = await Withdraw.findById(id).catch(() => null);
    if (!withdraw) return res.status(404).json({ msg: "Solicitud no encontrada" });

    withdraw.status = "rejected";
    withdraw.updatedAt = new Date();
    await withdraw.save();

    emitAdminUpdate(req, withdraw.userId, {
      withdrawStatus: "rejected",
    });

    return res.json({ ok: true, msg: "Retiro rechazado" });
  } catch (err) {
    console.error("POST /admin/withdraw/reject error:", err);
    return res.status(500).json({ msg: "Error rechazando retiro" });
  }
});

/* ================= LOCAL BALANCE HELPERS ================= */
async function localDeposit(userId, amount, leverage, req) {
  const user = await User.findById(userId).catch(() => null);
  if (!user) return { code: 404, body: { ok: false, msg: "Usuario no encontrado" } };

  const wallet = await getWalletDocForUser(user._id);
  const before = toNumber(wallet.balanceOwn ?? wallet.balance ?? user.balance ?? 0);

  wallet.balanceOwn = before + toNumber(amount);
  wallet.balance = wallet.balanceOwn;
  wallet.credit = toNumber(wallet.credit, 0);
  wallet.marginUsed = toNumber(wallet.marginUsed, 0);
  if (Number.isFinite(Number(leverage)) && Number(leverage) > 0) {
    wallet.leverageFactor = Number(leverage);
    user.leverage = Number(leverage);
  }
  wallet.equity = wallet.balanceOwn;
  wallet.freeMargin = Math.max(wallet.equity + wallet.credit - wallet.marginUsed, 0);
  wallet.marginLevel = wallet.marginUsed > 0 ? (wallet.equity / wallet.marginUsed) * 100 : 0;
  wallet.updatedAt = new Date();
  await wallet.save();

  user.balance = wallet.balanceOwn;
  user.currency = user.currency || "USD";
  await user.save();

  const tx = await Transaction.create({
    user: user._id,
    userId: String(user._id),
    type: "deposit",
    amount: toNumber(amount),
    status: "completed",
    balanceBefore: before,
    balanceAfter: wallet.balanceOwn,
    meta: {
      source: "admin-local",
      leverage: wallet.leverageFactor,
    },
    source: "admin.routes.js",
    createdAt: new Date(),
  });

  const account = await buildAccountForUser(user);
  emitAdminUpdate(req, userId, { balance: wallet.balanceOwn, transaction: tx, account });

  return {
    code: 200,
    body: {
      ok: true,
      msg: "Depósito realizado",
      balance: wallet.balanceOwn,
      account: account.account,
      wallet: account.wallet,
      transaction: tx,
    },
  };
}

async function localWithdraw(userId, amount, req) {
  const user = await User.findById(userId).catch(() => null);
  if (!user) return { code: 404, body: { ok: false, msg: "Usuario no encontrado" } };

  const wallet = await getWalletDocForUser(user._id);
  const before = toNumber(wallet.balanceOwn ?? wallet.balance ?? user.balance ?? 0);
  const withdrawal = toNumber(amount);

  if (before < withdrawal) {
    return { code: 400, body: { ok: false, msg: "Saldo insuficiente" } };
  }

  wallet.balanceOwn = before - withdrawal;
  wallet.balance = wallet.balanceOwn;
  wallet.equity = wallet.balanceOwn;
  wallet.marginUsed = toNumber(wallet.marginUsed, 0);
  wallet.freeMargin = Math.max(wallet.equity + toNumber(wallet.credit, 0) - wallet.marginUsed, 0);
  wallet.marginLevel = wallet.marginUsed > 0 ? (wallet.equity / wallet.marginUsed) * 100 : 0;
  wallet.updatedAt = new Date();
  await wallet.save();

  user.balance = wallet.balanceOwn;
  await user.save();

  const tx = await Transaction.create({
    user: user._id,
    userId: String(user._id),
    type: "withdrawal",
    amount: -Math.abs(withdrawal),
    status: "completed",
    balanceBefore: before,
    balanceAfter: wallet.balanceOwn,
    meta: {
      source: "admin-local",
    },
    source: "admin.routes.js",
    createdAt: new Date(),
  });

  const account = await buildAccountForUser(user);
  emitAdminUpdate(req, userId, { balance: wallet.balanceOwn, withdrawStatus: "approved", transaction: tx, account });

  return {
    code: 200,
    body: {
      ok: true,
      msg: "Retiro realizado",
      balance: wallet.balanceOwn,
      account: account.account,
      wallet: account.wallet,
      transaction: tx,
    },
  };
}

/* ================= DEPOSIT ================= */
router.post("/deposit", verifyAdmin, async (req, res) => {
  try {
    const { userId, amount, leverage, note, currency } = req.body || {};

    if (!userId || typeof amount === "undefined" || amount === null || amount === "") {
      return res.status(400).json({ ok: false, error: "userId y amount son requeridos" });
    }

    const numericAmount = toNumber(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ ok: false, error: "amount inválido" });
    }

    if (CORE_API_URL) {
      try {
        const result = await proxyToCore(req, "/api/admin/deposit", {
          method: "POST",
          body: JSON.stringify({
            userId,
            amount: numericAmount,
            leverage,
            note,
            currency,
          }),
        });

        if (result.status >= 200 && result.status < 600) {
          if (result.data && typeof result.data === "object") {
            // emitir también en admin para refrescar UI del panel
            const balance =
              result.data?.data?.balance ??
              result.data?.balance ??
              result.data?.account?.balance ??
              null;

            emitAdminUpdate(req, userId, {
              balance,
              transaction: result.data?.data?.transaction || result.data?.transaction || null,
              account: result.data?.data?.account || result.data?.account || null,
            });

            return res.status(result.status).json(result.data);
          }
        }
      } catch (err) {
        console.warn("proxy deposit falló, usando local:", err?.message || err);
      }
    }

    const local = await localDeposit(userId, numericAmount, leverage, req);
    return res.status(local.code).json(local.body);
  } catch (err) {
    console.error("POST /admin/deposit error:", err);
    return res.status(500).json({ ok: false, error: "server_error", message: err?.message || "Error en depósito" });
  }
});

/* ================= WITHDRAW ================= */
router.post("/withdraw", verifyAdmin, async (req, res) => {
  try {
    const { userId, amount } = req.body || {};

    if (!userId || typeof amount === "undefined" || amount === null || amount === "") {
      return res.status(400).json({ ok: false, error: "userId y amount son requeridos" });
    }

    const numericAmount = toNumber(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ ok: false, error: "amount inválido" });
    }

    if (CORE_API_URL) {
      try {
        const result = await proxyToCore(req, "/api/admin/withdraw", {
          method: "POST",
          body: JSON.stringify({
            userId,
            amount: numericAmount,
          }),
        });

        if (result.status >= 200 && result.status < 600) {
          if (result.data && typeof result.data === "object") {
            const balance =
              result.data?.data?.balance ??
              result.data?.balance ??
              result.data?.account?.balance ??
              null;

            emitAdminUpdate(req, userId, {
              balance,
              withdrawStatus: result.data?.msg?.toLowerCase?.().includes("aplic") ? "approved" : undefined,
              transaction: result.data?.data?.transaction || result.data?.transaction || null,
              account: result.data?.data?.account || result.data?.account || null,
            });

            return res.status(result.status).json(result.data);
          }
        }
      } catch (err) {
        console.warn("proxy withdraw falló, usando local:", err?.message || err);
      }
    }

    const local = await localWithdraw(userId, numericAmount, req);
    return res.status(local.code).json(local.body);
  } catch (err) {
    console.error("POST /admin/withdraw error:", err);
    return res.status(500).json({ ok: false, error: "server_error", message: err?.message || "Error en retiro" });
  }
});

/* ================= UPDATE LEVERAGE ================= */
router.post("/update-leverage", verifyAdmin, async (req, res) => {
  try {
    const { userId, leverage } = req.body || {};

    if (!userId || typeof leverage === "undefined" || leverage === null || leverage === "") {
      return res.status(400).json({ msg: "Datos incompletos" });
    }

    const user = await User.findById(userId).catch(() => null);
    if (!user) return res.status(404).json({ msg: "Usuario no encontrado" });

    const numericLeverage = Number(leverage);
    if (!Number.isFinite(numericLeverage) || numericLeverage <= 0) {
      return res.status(400).json({ msg: "Leverage inválido" });
    }

    const wallet = await getWalletDocForUser(user._id);

    wallet.leverageFactor = numericLeverage;
    wallet.updatedAt = new Date();
    await wallet.save();

    user.leverage = numericLeverage;
    await user.save();

    const account = await buildAccountForUser(user);
    emitAdminUpdate(req, userId, { account });

    return res.json({
      ok: true,
      msg: "Leverage actualizado",
      leverage: numericLeverage,
      account: account.account,
      wallet: account.wallet,
    });
  } catch (err) {
    console.error("POST /admin/update-leverage error:", err);
    return res.status(500).json({ msg: "Error actualizando leverage" });
  }
});

/* ================= UPDATE BALANCE (COMPATIBLE) ================= */
router.post("/update-balance", verifyAdmin, async (req, res) => {
  try {
    const { userId, balance, leverage } = req.body || {};

    if (!userId || typeof balance === "undefined" || balance === null || balance === "") {
      return res.status(400).json({ msg: "Datos incompletos" });
    }

    const user = await User.findById(userId).catch(() => null);
    if (!user) return res.status(404).json({ msg: "Usuario no encontrado" });

    const wallet = await getWalletDocForUser(user._id);
    const numericBalance = toNumber(balance);

    wallet.balanceOwn = numericBalance;
    wallet.balance = numericBalance;
    if (Number.isFinite(Number(leverage)) && Number(leverage) > 0) {
      wallet.leverageFactor = Number(leverage);
      user.leverage = Number(leverage);
    }

    wallet.equity = wallet.balanceOwn;
    wallet.freeMargin = Math.max(wallet.equity + toNumber(wallet.credit, 0) - toNumber(wallet.marginUsed, 0), 0);
    wallet.marginLevel = toNumber(wallet.marginUsed, 0) > 0 ? (wallet.equity / wallet.marginUsed) * 100 : 0;
    wallet.updatedAt = new Date();
    await wallet.save();

    user.balance = wallet.balanceOwn;
    await user.save();

    const tx = await Transaction.create({
      user: user._id,
      userId: String(user._id),
      type: "adjustment",
      amount: 0,
      status: "completed",
      note: "Balance actualizado manualmente",
      balanceBefore: null,
      balanceAfter: wallet.balanceOwn,
      meta: { source: "admin.update-balance" },
      source: "admin.routes.js",
      createdAt: new Date(),
    });

    const account = await buildAccountForUser(user);
    emitAdminUpdate(req, userId, { balance: wallet.balanceOwn, transaction: tx, account });

    return res.json({
      ok: true,
      msg: "Saldo actualizado",
      balance: wallet.balanceOwn,
      account: account.account,
      wallet: account.wallet,
    });
  } catch (err) {
    console.error("POST /admin/update-balance error:", err);
    return res.status(500).json({ msg: "Error actualizando saldo" });
  }
});

/* ================= VARIANTE RESTFUL LEVERAGE ================= */
router.put("/users/leverage/:id", verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { leverage } = req.body || {};

    if (!id) return res.status(400).json({ msg: "id requerido" });
    if (typeof leverage === "undefined" || leverage === null || leverage === "") {
      return res.status(400).json({ msg: "leverage requerido" });
    }

    const user = await User.findById(id).catch(() => null);
    if (!user) return res.status(404).json({ msg: "Usuario no encontrado" });

    const numericLeverage = Number(leverage);
    if (!Number.isFinite(numericLeverage) || numericLeverage <= 0) {
      return res.status(400).json({ msg: "Leverage inválido" });
    }

    const wallet = await getWalletDocForUser(user._id);
    wallet.leverageFactor = numericLeverage;
    wallet.updatedAt = new Date();
    await wallet.save();

    user.leverage = numericLeverage;
    await user.save();

    const account = await buildAccountForUser(user);
    emitAdminUpdate(req, String(user._id), { account });

    return res.json({
      ok: true,
      msg: "Leverage actualizado (PUT)",
      leverage: numericLeverage,
      account: account.account,
      wallet: account.wallet,
    });
  } catch (err) {
    console.error("PUT /admin/users/leverage/:id error:", err);
    return res.status(500).json({ msg: "Error actualizando leverage" });
  }
});

module.exports = router;
