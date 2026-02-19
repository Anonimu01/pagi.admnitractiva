// routes/admin.routes.js
const router = require("express").Router();
const jwt = require("jsonwebtoken");

// Helper to require a model with several possible filenames (case-insensitive)
function tryRequire(paths) {
  for (const p of paths) {
    try {
      return require(p);
    } catch (err) {
      // ignore and try next
    }
  }
  return null;
}

// Intentar requerir modelos con distintos nombres posibles
const User = tryRequire([
  "../models/User",
  "../models/user.model",
  "../models/user",
  "../models/user.model.js",
  "../models/User.js"
]);

const Withdraw = tryRequire([
  "../models/Withdraw",
  "../models/withdraw",
  "../models/withdraw.model",
  "../models/Withdraw.js",
  "../models/withdraw.model.js"
]);

if (!User) {
  console.warn("⚠️ Warning: User model no encontrado. Comprueba la ruta en /models.");
}
if (!Withdraw) {
  console.warn("⚠️ Warning: Withdraw model no encontrado. Comprueba la ruta en /models.");
}

/* ================= Middleware: verifyAdmin ================= */
/* Verifica header Authorization: Bearer <token> y que el token tenga { admin:true } */
function verifyAdmin(req, res, next) {
  try {
    const auth = req.headers.authorization || req.headers.Authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      return res.status(401).json({ ok: false, msg: "No autorizado" });
    }
    const token = auth.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded || !decoded.admin) {
      return res.status(403).json({ ok: false, msg: "Acceso denegado" });
    }
    // opcional: adjuntar info admin al req
    req.admin = decoded;
    return next();
  } catch (err) {
    console.error("verifyAdmin error:", err && err.message ? err.message : err);
    return res.status(401).json({ ok: false, msg: "Token inválido" });
  }
}

/* ================= LOGIN ADMIN ================= */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok: false, msg: "Datos incompletos" });

    // comparacion simple contra vars de entorno
    if (email !== process.env.ADMIN_EMAIL || password !== process.env.ADMIN_PASS) {
      return res.status(401).json({ ok: false, msg: "Credenciales inválidas" });
    }

    const token = jwt.sign({ admin: true }, process.env.JWT_SECRET, { expiresIn: "8h" });
    return res.json({ ok: true, token });
  } catch (err) {
    console.error("admin login error:", err);
    return res.status(500).json({ ok: false, msg: "Error del servidor" });
  }
});

/* ================= GET USERS ================= */
/* Protegida por verifyAdmin */
router.get("/users", verifyAdmin, async (req, res) => {
  try {
    if (!User) return res.status(500).json({ ok: false, msg: "User model no disponible en el servidor" });

    // obtener todos los usuarios sin password ni verificationToken
    const users = await User.find().select("-password -verificationToken -__v").sort({ createdAt: -1 });
    return res.json({ ok: true, users });
  } catch (err) {
    console.error("GET /admin/users error:", err);
    return res.status(500).json({ ok: false, msg: "Error al listar usuarios" });
  }
});

/* ================= UPDATE BALANCE ================= */
/* Endpoint compatible con frontend: POST /api/admin/update-balance */
router.post("/update-balance", verifyAdmin, async (req, res) => {
  try {
    const { userId, balance } = req.body || {};
    if (!userId) return res.status(400).json({ ok: false, msg: "userId requerido" });

    if (!User) return res.status(500).json({ ok: false, msg: "User model no disponible" });

    await User.findByIdAndUpdate(userId, { balance: Number(balance) || 0 });
    return res.json({ ok: true, msg: "Saldo actualizado" });
  } catch (err) {
    console.error("POST /admin/update-balance error:", err);
    return res.status(500).json({ ok: false, msg: "Error actualizando saldo" });
  }
});

/* ================= UPDATE LEVERAGE ================= */
/* Mantengo la ruta RESTful PUT /users/leverage/:id y además agrego POST /update-leverage
   para compatibilidad con el frontend actual que envía POST /admin/update-leverage */
router.post("/update-leverage", verifyAdmin, async (req, res) => {
  try {
    const { userId, leverage } = req.body || {};
    if (!userId) return res.status(400).json({ ok: false, msg: "userId requerido" });
    if (typeof leverage === "undefined") return res.status(400).json({ ok: false, msg: "leverage requerido" });

    if (!User) return res.status(500).json({ ok: false, msg: "User model no disponible" });

    await User.findByIdAndUpdate(userId, { leverage: Number(leverage) || 1 });
    return res.json({ ok: true, msg: "Leverage actualizado" });
  } catch (err) {
    console.error("POST /admin/update-leverage error:", err);
    return res.status(500).json({ ok: false, msg: "Error actualizando leverage" });
  }
});

// Ruta RESTful original (por compatibilidad/retro)
router.put("/users/leverage/:id", verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { leverage } = req.body || {};
    if (!id) return res.status(400).json({ ok: false, msg: "id requerido" });
    if (typeof leverage === "undefined") return res.status(400).json({ ok: false, msg: "leverage requerido" });

    if (!User) return res.status(500).json({ ok: false, msg: "User model no disponible" });

    await User.findByIdAndUpdate(id, { leverage: Number(leverage) || 1 });
    return res.json({ ok: true, msg: "Leverage actualizado (PUT)" });
  } catch (err) {
    console.error("PUT /admin/users/leverage/:id error:", err);
    return res.status(500).json({ ok: false, msg: "Error actualizando leverage" });
  }
});

/* ================= GET WITHDRAWS ================= */
router.get("/withdraws/:userId", verifyAdmin, async (req, res) => {
  try {
    const userId = req.params.userId;
    if (!userId) return res.status(400).json({ ok: false, msg: "userId requerido" });
    if (!Withdraw) return res.status(500).json({ ok: false, msg: "Withdraw model no disponible" });

    const data = await Withdraw.find({ userId, status: "pending" }).sort({ createdAt: -1 });
    return res.json({ ok: true, withdraws: data });
  } catch (err) {
    console.error("GET /admin/withdraws/:userId error:", err);
    return res.status(500).json({ ok: false, msg: "Error obteniendo retiros" });
  }
});

/* ================= APPROVE ================= */
router.post("/withdraw/approve", verifyAdmin, async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ ok: false, msg: "id requerido" });
    if (!Withdraw) return res.status(500).json({ ok: false, msg: "Withdraw model no disponible" });

    await Withdraw.findByIdAndUpdate(id, { status: "approved" });
    return res.json({ ok: true, msg: "Retiro aprobado" });
  } catch (err) {
    console.error("POST /admin/withdraw/approve error:", err);
    return res.status(500).json({ ok: false, msg: "Error aprobando retiro" });
  }
});

/* ================= REJECT ================= */
router.post("/withdraw/reject", verifyAdmin, async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ ok: false, msg: "id requerido" });
    if (!Withdraw) return res.status(500).json({ ok: false, msg: "Withdraw model no disponible" });

    await Withdraw.findByIdAndUpdate(id, { status: "rejected" });
    return res.json({ ok: true, msg: "Retiro rechazado" });
  } catch (err) {
    console.error("POST /admin/withdraw/reject error:", err);
    return res.status(500).json({ ok: false, msg: "Error rechazando retiro" });
  }
});

module.exports = router;
