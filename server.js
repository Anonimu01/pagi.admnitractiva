require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const rateLimit = require("express-rate-limit");
const { Server } = require("socket.io");
const path = require("path");
const mongoose = require("mongoose");

const connectDB = require("./config/db");

const app = express();
const server = http.createServer(app);

/* ================= CONFIG ================= */
const CORE_API_URL = process.env.CORE_API_URL || null;
if (!CORE_API_URL) {
  console.warn("⚠️ CORE_API_URL no definido (modo local activo)");
}

/* ================= DB ================= */
connectDB();

mongoose.connection.on("connected", () => {
  console.log("✅ Mongo conectado");
});

/* ================= MODELOS ================= */
// 🔥 IMPORTAR MODELOS (ESTA ES LA CLAVE DEL FIX)
const User = require("./models/User");
const Wallet = require("./models/Wallet");
const Transaction = require("./models/Transaction");

/* ================= MIDDLEWARE ================= */
const CLIENT_ORIGIN = process.env.ADMIN_CLIENT_URL || "*";

app.use(cors({
  origin: CLIENT_ORIGIN,
  credentials: true
}));

app.use(rateLimit({
  windowMs: 60_000,
  max: 200
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));

/* ================= SOCKET.IO ================= */
const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    credentials: true
  }
});

app.set("io", io);

app.use((req, res, next) => {
  req.io = io;
  next();
});

/* ================= ADMIN KEY (OPCIONAL) ================= */
function ensureAdminKey(req, res, next) {
  if (!process.env.ADMIN_API_KEY) return next();

  const key = req.headers["x-admin-key"];
  if (!key || key !== process.env.ADMIN_API_KEY) {
    return res.status(403).json({ msg: "Admin key inválida" });
  }
  next();
}

/* ================= ROUTES ================= */
const adminRoutes = require("./routes/admin.routes");
app.use("/api/admin", adminRoutes);

/* ======================================================
   💰 DEPOSIT (REAL + SOCKET + DB)
====================================================== */
app.post("/api/admin/deposit", ensureAdminKey, async (req, res) => {
  try {
    const { userId, amount, leverage } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ msg: "Usuario no encontrado" });

    let wallet = await Wallet.findOne({ user: user._id });

    if (!wallet) {
      wallet = new Wallet({
        user: user._id,
        balanceOwn: 0,
        balance: 0,
        credit: 0,
        marginUsed: 0,
        leverageFactor: 1
      });
    }

    const before = wallet.balanceOwn || 0;

    wallet.balanceOwn = before + Number(amount);
    wallet.balance = wallet.balanceOwn;

    if (leverage) {
      wallet.leverageFactor = Number(leverage);
      user.leverage = Number(leverage);
    }

    await wallet.save();

    user.balance = wallet.balanceOwn;
    await user.save();

    const tx = await Transaction.create({
      user: user._id,
      userId: String(user._id),
      type: "deposit",
      amount: Number(amount),
      balanceBefore: before,
      balanceAfter: wallet.balanceOwn
    });

    /* 🔥 REALTIME */
    io.emit(`balance:${userId}`, wallet.balanceOwn);
    io.emit("transaction:new", tx);

    res.json({
      ok: true,
      balance: wallet.balanceOwn
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Error depósito" });
  }
});

/* ======================================================
   💸 WITHDRAW (REAL)
====================================================== */
app.post("/api/admin/withdraw", ensureAdminKey, async (req, res) => {
  try {
    const { userId, amount } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ msg: "Usuario no encontrado" });

    const wallet = await Wallet.findOne({ user: user._id });
    if (!wallet) return res.status(400).json({ msg: "Wallet no existe" });

    if (wallet.balanceOwn < amount) {
      return res.status(400).json({ msg: "Saldo insuficiente" });
    }

    const before = wallet.balanceOwn;

    wallet.balanceOwn -= Number(amount);
    wallet.balance = wallet.balanceOwn;

    await wallet.save();

    user.balance = wallet.balanceOwn;
    await user.save();

    const tx = await Transaction.create({
      user: user._id,
      userId: String(user._id),
      type: "withdrawal",
      amount: -Math.abs(amount),
      balanceBefore: before,
      balanceAfter: wallet.balanceOwn
    });

    /* 🔥 REALTIME */
    io.emit(`balance:${userId}`, wallet.balanceOwn);
    io.emit(`withdraw:${userId}`, "approved");
    io.emit("transaction:new", tx);

    res.json({
      ok: true,
      balance: wallet.balanceOwn
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Error retiro" });
  }
});

/* ================= ROOT ================= */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

/* ================= HEALTH ================= */
app.get("/healthz", (req, res) => {
  res.json({
    ok: true,
    db: mongoose.connection.readyState
  });
});

/* ================= ERROR ================= */
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ msg: "Error servidor" });
});

/* ================= START ================= */
const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
  console.log("🔥 ADMIN RUNNING EN:", PORT);
});
