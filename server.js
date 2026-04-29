require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();
const server = http.createServer(app);

/* ================= CONFIG ================= */
const CORE_API_URL = process.env.CORE_API_URL;

if (!CORE_API_URL) {
  console.error("❌ ERROR: CORE_API_URL no está definido");
  process.exit(1);
}

console.log("🌐 Conectando a backend real:", CORE_API_URL);

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

/* ================= ADMIN KEY ================= */
function ensureAdminKey(req, res, next) {
  if (!process.env.ADMIN_API_KEY) return next();

  const key = req.headers["x-admin-api-key"] || req.headers["x-admin-key"];

  if (!key || key !== process.env.ADMIN_API_KEY) {
    return res.status(403).json({ msg: "Admin key inválida" });
  }

  next();
}

/* ======================================================
   🔥 PROXY HELPER (REUTILIZABLE)
====================================================== */
async function proxyToCore(path, options = {}) {
  try {
    const response = await fetch(`${CORE_API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "x-admin-api-key": process.env.ADMIN_API_KEY,
        ...(options.headers || {})
      }
    });

    const data = await response.json();

    return {
      status: response.status,
      data
    };
  } catch (err) {
    console.error("❌ Proxy error:", err);
    return {
      status: 500,
      data: { ok: false, error: "proxy_error" }
    };
  }
}

/* ======================================================
   💰 DEPOSIT (REAL BACKEND)
====================================================== */
app.post("/api/admin/deposit", ensureAdminKey, async (req, res) => {
  const { userId, amount, leverage } = req.body;

  if (!userId || !amount) {
    return res.status(400).json({
      ok: false,
      error: "userId y amount son requeridos"
    });
  }

  const result = await proxyToCore("/api/admin/deposit", {
    method: "POST",
    body: JSON.stringify({
      userId,
      amount,
      leverage
    })
  });

  return res.status(result.status).json(result.data);
});

/* ======================================================
   💸 WITHDRAW (REAL BACKEND)
====================================================== */
app.post("/api/admin/withdraw", ensureAdminKey, async (req, res) => {
  const { userId, amount } = req.body;

  if (!userId || !amount) {
    return res.status(400).json({
      ok: false,
      error: "userId y amount son requeridos"
    });
  }

  const result = await proxyToCore("/api/admin/withdraw", {
    method: "POST",
    body: JSON.stringify({
      userId,
      amount
    })
  });

  return res.status(result.status).json(result.data);
});

/* ======================================================
   📊 GET ACCOUNT (VER SALDO REAL DEL CLIENTE)
====================================================== */
app.get("/api/admin/account/:userId", ensureAdminKey, async (req, res) => {
  const { userId } = req.params;

  const result = await proxyToCore(`/api/admin/account/${userId}`, {
    method: "GET"
  });

  return res.status(result.status).json(result.data);
});

/* ======================================================
   📜 HISTORIAL DE TRANSACCIONES
====================================================== */
app.get("/api/admin/transactions", ensureAdminKey, async (req, res) => {
  const { userId } = req.query;

  const query = userId ? `?userId=${userId}` : "";

  const result = await proxyToCore(`/api/admin/transactions${query}`, {
    method: "GET"
  });

  return res.status(result.status).json(result.data);
});

/* ================= ROOT ================= */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

/* ================= HEALTH ================= */
app.get("/healthz", (req, res) => {
  res.json({
    ok: true,
    core: CORE_API_URL
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
