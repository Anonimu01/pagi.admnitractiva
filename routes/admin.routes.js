// routes/admin.routes.js
const router = require("express").Router();
const jwt = require("jsonwebtoken");

const User = require("../models/User");
const Withdraw = require("../models/Withdraw");

/* ================= MIDDLEWARE: verifyAdmin ================= */
function verifyAdmin(req, res, next) {
  try {
    const auth = req.headers.authorization || req.headers.Authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      return res.status(401).json({ msg: "No autorizado" });
    }

    const token = auth.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded || !decoded.admin) {
      return res.status(403).json({ msg: "Acceso denegado" });
    }

    req.admin = decoded;
    next();
  } catch (err) {
    console.error("verifyAdmin error:", err);
    res.status(401).json({ msg: "Token inválido" });
  }
}

/* ================= LOGIN ================= */
router.post("/login", (req, res) => {
  try {
    const { email, password } = req.body;

    if (email !== process.env.ADMIN_EMAIL || password !== process.env.ADMIN_PASS) {
      return res.status(401).json({ msg: "Credenciales inválidas" });
    }

    const token = jwt.sign({ admin: true }, process.env.JWT_SECRET, { expiresIn: "8h" });

    res.json({ token });
  } catch (err) {
    res.status(500).json({ msg: "Error del servidor" });
  }
});

/* ================= GET USERS ================= */
router.get("/users", verifyAdmin, async (req, res) => {
  try {
    const users = await User.find().select("-password -__v").sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ msg: "Error al listar usuarios" });
  }
});

/* ================= UPDATE BALANCE ================= */
router.post("/update-balance", verifyAdmin, async (req, res) => {
  try {
    const { userId, balance } = req.body;

    if (!userId) {
      return res.status(400).json({ msg: "userId requerido" });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { balance: Number(balance) || 0 },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ msg: "Usuario no encontrado" });
    }

    // 🔥 EMITIR CAMBIO EN TIEMPO REAL
    const io = req.app.get("io");
    io.to(userId).emit("balanceUpdated", {
      userId,
      balance: user.balance
    });

    res.json({ msg: "Saldo actualizado", balance: user.balance });

  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Error actualizando saldo" });
  }
});

/* ================= UPDATE LEVERAGE ================= */
router.post("/update-leverage", verifyAdmin, async (req, res) => {
  try {
    const { userId, leverage } = req.body;

    const user = await User.findByIdAndUpdate(
      userId,
      { leverage: Number(leverage) || 1 },
      { new: true }
    );

    const io = req.app.get("io");

    io.to(userId).emit("leverageUpdated", {
      userId,
      leverage: user.leverage
    });

    res.json({ msg: "Leverage actualizado" });

  } catch (err) {
    res.status(500).json({ msg: "Error actualizando leverage" });
  }
});

/* ================= GET WITHDRAWS ================= */
router.get("/withdraws/:userId", verifyAdmin, async (req, res) => {
  try {
    const data = await Withdraw.find({
      userId: req.params.userId,
      status: "pending"
    }).sort({ createdAt: -1 });

    res.json(data);
  } catch (err) {
    res.status(500).json({ msg: "Error obteniendo retiros" });
  }
});

/* ================= APPROVE WITHDRAW ================= */
router.post("/withdraw/approve", verifyAdmin, async (req, res) => {
  try {
    const { id } = req.body;

    const withdraw = await Withdraw.findByIdAndUpdate(
      id,
      { status: "approved" },
      { new: true }
    );

    const io = req.app.get("io");

    io.to(withdraw.userId.toString()).emit("withdrawUpdate", {
      status: "approved",
      withdraw
    });

    res.json({ msg: "Retiro aprobado" });

  } catch (err) {
    res.status(500).json({ msg: "Error aprobando retiro" });
  }
});

/* ================= REJECT WITHDRAW ================= */
router.post("/withdraw/reject", verifyAdmin, async (req, res) => {
  try {
    const { id } = req.body;

    const withdraw = await Withdraw.findByIdAndUpdate(
      id,
      { status: "rejected" },
      { new: true }
    );

    const io = req.app.get("io");

    io.to(withdraw.userId.toString()).emit("withdrawUpdate", {
      status: "rejected",
      withdraw
    });

    res.json({ msg: "Retiro rechazado" });

  } catch (err) {
    res.status(500).json({ msg: "Error rechazando retiro" });
  }
});

module.exports = router;
