// routes/admin.routes.js
const router = require("express").Router();
const jwt = require("jsonwebtoken");

// Requerir modelos según tu estructura real
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
    return next();
  } catch (err) {
    console.error("verifyAdmin error:", err && err.message ? err.message : err);
    return res.status(401).json({ msg: "Token inválido" });
  }
}

/* ================= LOGIN ADMIN ================= */
router.post("/login", (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ msg: "Datos incompletos" });

    if (email !== process.env.ADMIN_EMAIL || password !== process.env.ADMIN_PASS) {
      return res.status(401).json({ msg: "Credenciales inválidas" });
    }

    const token = jwt.sign({ admin: true }, process.env.JWT_SECRET, { expiresIn: "8h" });
    return res.json({ token });
  } catch (err) {
    console.error("admin login error:", err);
    return res.status(500).json({ msg: "Error del servidor" });
  }
});

/* ================= GET USERS ================= */
/* Devuelve directamente un array (compatibilidad con frontend original) */
router.get("/users", verifyAdmin, async (req, res) => {
  try {
    const users = await User.find().select("-password -verificationToken -__v").sort({ createdAt: -1 });
    return res.json(users);
  } catch (err) {
    console.error("GET /admin/users error:", err);
    return res.status(500).json({ msg: "Error al listar usuarios" });
  }
});

/* ================= UPDATE BALANCE ================= */
router.post("/update-balance", verifyAdmin, async (req, res) => {
  try {
    const { userId, balance } = req.body || {};
    if (!userId) return res.status(400).json({ msg: "userId requerido" });

    await User.findByIdAndUpdate(userId, { balance: Number(balance) || 0 });
    return res.json({ msg: "Saldo actualizado" });
  } catch (err) {
    console.error("POST /admin/update-balance error:", err);
    return res.status(500).json({ msg: "Error actualizando saldo" });
  }
});

/* ================= UPDATE LEVERAGE ================= */
/* Soporta POST /update-leverage (compatible con frontend) */
router.post("/update-leverage", verifyAdmin, async (req, res) => {
  try {
    const { userId, leverage } = req.body || {};
    if (!userId) return res.status(400).json({ msg: "userId requerido" });
    if (typeof leverage === "undefined") return res.status(400).json({ msg: "leverage requerido" });

    await User.findByIdAndUpdate(userId, { leverage: Number(leverage) || 1 });
    return res.json({ msg: "Leverage actualizado" });
  } catch (err) {
    console.error("POST /admin/update-leverage error:", err);
    return res.status(500).json({ msg: "Error actualizando leverage" });
  }
});

/* Variante RESTful (opcional) */
router.put("/users/leverage/:id", verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { leverage } = req.body || {};
    if (!id) return res.status(400).json({ msg: "id requerido" });
    if (typeof leverage === "undefined") return res.status(400).json({ msg: "leverage requerido" });

    await User.findByIdAndUpdate(id, { leverage: Number(leverage) || 1 });
    return res.json({ msg: "Leverage actualizado (PUT)" });
  } catch (err) {
    console.error("PUT /admin/users/leverage/:id error:", err);
    return res.status(500).json({ msg: "Error actualizando leverage" });
  }
});

/* ================= GET WITHDRAWS ================= */
/* Devuelve array de retiros (compatibilidad frontend) */
router.get("/withdraws/:userId", verifyAdmin, async (req, res) => {
  try {
    const userId = req.params.userId;
    if (!userId) return res.status(400).json({ msg: "userId requerido" });

    const data = await Withdraw.find({ userId, status: "pending" }).sort({ createdAt: -1 });
    return res.json(data);
  } catch (err) {
    console.error("GET /admin/withdraws/:userId error:", err);
    return res.status(500).json({ msg: "Error obteniendo retiros" });
  }
});

/* ================= APPROVE ================= */
router.post("/withdraw/approve", verifyAdmin, async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ msg: "id requerido" });

    await Withdraw.findByIdAndUpdate(id, { status: "approved" });
    return res.json({ msg: "Retiro aprobado" });
  } catch (err) {
    console.error("POST /admin/withdraw/approve error:", err);
    return res.status(500).json({ msg: "Error aprobando retiro" });
  }
});

/* ================= REJECT ================= */
router.post("/withdraw/reject", verifyAdmin, async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ msg: "id requerido" });

    await Withdraw.findByIdAndUpdate(id, { status: "rejected" });
    return res.json({ msg: "Retiro rechazado" });
  } catch (err) {
    console.error("POST /admin/withdraw/reject error:", err);
    return res.status(500).json({ msg: "Error rechazando retiro" });
  }
});

module.exports = router;
