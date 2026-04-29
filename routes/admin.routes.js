const router = require("express").Router();
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const User = require("../models/User");

// IMPORTANTE: usar mismos nombres que server principal
const Wallet = mongoose.model("Wallet");
const Transaction = mongoose.model("Transaction");

/* ================= VERIFY ADMIN ================= */
async function verifyAdmin(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.split(" ")[1] : null;

    if (!token) {
      return res.status(401).json({ msg: "No autorizado" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded || !decoded.admin) {
      return res.status(403).json({ msg: "Acceso denegado" });
    }

    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ msg: "Token inválido" });
  }
}

/* ================= LOGIN ================= */
router.post("/login", (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (email !== process.env.ADMIN_EMAIL || password !== process.env.ADMIN_PASS) {
      return res.status(401).json({ msg: "Credenciales inválidas" });
    }

    const token = jwt.sign({ admin: true }, process.env.JWT_SECRET, {
      expiresIn: "8h",
    });

    res.json({ token });
  } catch (err) {
    res.status(500).json({ msg: "Error del servidor" });
  }
});

/* ================= GET USERS ================= */
router.get("/users", verifyAdmin, async (req, res) => {
  try {
    const users = await User.find()
      .select("-password -__v")
      .sort({ createdAt: -1 });

    res.json(users);
  } catch (err) {
    res.status(500).json({ msg: "Error obteniendo usuarios" });
  }
});

/* ======================================================
   💰 DEPOSIT (COMPATIBLE CON SERVER CLIENTE)
====================================================== */
router.post("/deposit", verifyAdmin, async (req, res) => {
  try {
    const { userId, amount, leverage } = req.body || {};

    if (!userId || !amount) {
      return res.status(400).json({ msg: "Datos incompletos" });
    }

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
        leverageFactor: 1,
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

    await Transaction.create({
      user: user._id,
      userId: String(user._id),
      type: "deposit",
      amount: Number(amount),
      balanceBefore: before,
      balanceAfter: wallet.balanceOwn,
    });

    res.json({
      msg: "Depósito realizado",
      balance: wallet.balanceOwn,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Error en depósito" });
  }
});

/* ======================================================
   💸 WITHDRAW (COMPATIBLE)
====================================================== */
router.post("/withdraw", verifyAdmin, async (req, res) => {
  try {
    const { userId, amount } = req.body || {};

    if (!userId || !amount) {
      return res.status(400).json({ msg: "Datos incompletos" });
    }

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

    await Transaction.create({
      user: user._id,
      userId: String(user._id),
      type: "withdrawal",
      amount: -Math.abs(amount),
      balanceBefore: before,
      balanceAfter: wallet.balanceOwn,
    });

    res.json({
      msg: "Retiro realizado",
      balance: wallet.balanceOwn,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Error en retiro" });
  }
});

/* ================= UPDATE LEVERAGE ================= */
router.post("/update-leverage", verifyAdmin, async (req, res) => {
  try {
    const { userId, leverage } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ msg: "Usuario no encontrado" });

    const wallet = await Wallet.findOne({ user: user._id });

    if (wallet) {
      wallet.leverageFactor = Number(leverage);
      await wallet.save();
    }

    user.leverage = Number(leverage);
    await user.save();

    res.json({ msg: "Leverage actualizado" });
  } catch (err) {
    res.status(500).json({ msg: "Error actualizando leverage" });
  }
});

module.exports = router;
