require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const rateLimit = require("express-rate-limit");
const { Server } = require("socket.io");
const path = require("path");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");

// DB
const connectDB = require("./config/db");

// MODELOS
const { User, Wallet, Transaction, Withdraw } = require("./models"); // asegúrate de tenerlos definidos correctamente

const app = express();
const server = http.createServer(app);

/* ======================================================
   CONFIG
====================================================== */
const PORT = Number(process.env.PORT || 4000);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@example.com";
const ADMIN_PASS = process.env.ADMIN_PASS || "admin";
const JWT_SECRET = process.env.JWT_SECRET || "admin-secret-dev";
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "";

const CLIENT_ORIGIN_RAW = process.env.ADMIN_CLIENT_URL || process.env.CLIENT_URL || "*";
const ALLOWED_ORIGINS = CLIENT_ORIGIN_RAW === "*" ? "*" : CLIENT_ORIGIN_RAW.split(",").map(s => s.trim()).filter(Boolean);

/* ======================================================
   DATABASE
====================================================== */
Promise.resolve(connectDB()).catch(err => console.error("Error conectando DB:", err));
mongoose.connection.on("connected", () => console.log("✅ Mongo conectado"));
mongoose.connection.on("error", err => console.error("❌ Mongo connection error:", err));
mongoose.connection.on("disconnected", () => console.warn("⚠️ Mongo disconnected"));

/* ======================================================
   MIDDLEWARE
====================================================== */
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS === "*" || (Array.isArray(ALLOWED_ORIGINS) && ALLOWED_ORIGINS.includes(origin))) return callback(null, true);
    try { const url = new URL(origin); if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return callback(null, true); } catch {}
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));
app.use(rateLimit({ windowMs: 60_000, max: 200 }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

/* ======================================================
   SOCKET.IO
====================================================== */
const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS === "*" ? true : ALLOWED_ORIGINS, methods: ["GET", "POST"], credentials: true }
});
app.set("io", io);
app.use((req, res, next) => { req.io = io; next(); });

/* ======================================================
   AUTH HELPERS
====================================================== */
function signAdminToken(payload = {}) {
  return jwt.sign({ admin: true, role: "admin", email: payload.email || ADMIN_EMAIL }, JWT_SECRET, { expiresIn: "8h" });
}

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie || "";
  for (const part of cookieHeader.split(";").map(p => p.trim())) {
    const idx = part.indexOf("="); if (idx === -1) continue;
    const k = decodeURIComponent(part.slice(0, idx).trim());
    const v = decodeURIComponent(part.slice(idx + 1).trim());
    if (k === name) return v;
  }
  return null;
}

function isAdminTokenValid(req) {
  const auth = req.headers.authorization || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const tokenFromCookie = getCookie(req, "admin_token");
  const token = bearer || tokenFromCookie;
  if (!token) return false;
  try { const decoded = jwt.verify(token, JWT_SECRET); return !!decoded && (decoded.admin === true || decoded.role === "admin"); } catch { return false; }
}

function ensureAdminAuth(req, res, next) {
  try {
    if (ADMIN_API_KEY) {
      const key = req.headers["x-admin-api-key"] || req.headers["x-admin-key"] || req.headers["admin-key"] || "";
      if (key && key === ADMIN_API_KEY) return next();
    }
    if (isAdminTokenValid(req)) return next();
    return res.status(401).json({ ok: false, msg: "No autorizado" });
  } catch { return res.status(401).json({ ok: false, msg: "No autorizado" }); }
}

/* ======================================================
   ROUTES
====================================================== */
// LOGIN ADMIN
app.post(["/api/admin/login", "/api/login"], async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok: false, msg: "Datos incompletos" });
    if (email !== ADMIN_EMAIL || password !== ADMIN_PASS) return res.status(401).json({ ok: false, msg: "Credenciales inválidas" });

    const token = signAdminToken({ email });
    res.cookie("admin_token", token, { httpOnly: true, sameSite: "lax", secure: false, maxAge: 8*60*60*1000 });
    return res.json({ ok: true, token, msg: "Login correcto", admin: { email, role: "admin" } });
  } catch (err) { console.error("admin login error:", err); return res.status(500).json({ ok: false, msg: "Error del servidor" }); }
});

// GET USERS
app.get("/api/admin/users", ensureAdminAuth, async (req, res) => {
  try {
    const users = await User.find({}).select("-password -__v").sort({ createdAt: -1 }).lean();
    return res.json({ ok: true, users });
  } catch (err) { console.error("GET users error:", err); return res.status(500).json({ ok: false, msg: "Error al listar usuarios" }); }
});

// TRANSACTIONS
app.get("/api/admin/transactions", ensureAdminAuth, async (req, res) => {
  const txs = await Transaction.find({}).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ ok: true, count: txs.length, transactions: txs });
});

// WITHDRAW
app.post("/api/withdraw/request", async (req, res) => { /* Aquí tu código completo de creación de retiro */ });
app.get("/api/withdraw/history/:userId", async (req, res) => { /* Historial completo */ });
app.get("/api/admin/withdraws", ensureAdminAuth, async (req, res) => { /* Lista admin */ });
// Y todas las demás rutas combinadas de admin + cliente...

// HEALTH CHECK
app.get("/healthz", (req, res) => res.json({ ok: true, dbReadyState: mongoose.connection.readyState }));

// ROOT
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

// FALLBACK 404
app.use("/api", (req, res) => res.status(404).json({ ok: false, msg: "API endpoint not found" }));

/* ======================================================
   START SERVER
====================================================== */
server.listen(PORT, "0.0.0.0", () => console.log(`🔥 SERVER RUNNING EN: ${PORT}`));

/* ======================================================
   GRACEFUL SHUTDOWN
====================================================== */
let shuttingDown = false;
const gracefulShutdown = async signal => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`📴 ${signal} recibido. Cerrando servidor...`);
  const force = setTimeout(() => process.exit(1), 30_000); force.unref();
  try {
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    try { io.emit("server:shutdown"); await new Promise(resolve => io.close(resolve)); } catch {}
    try { await mongoose.disconnect(); } catch {}
    clearTimeout(force);
    process.exit(0);
  } catch (err) { console.error("Error durante shutdown:", err); clearTimeout(force); process.exit(1); }
};
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("unhandledRejection", r => { console.error("UnhandledRejection:", r); gracefulShutdown("unhandledRejection"); });
process.on("uncaughtException", e => { console.error("UncaughtException:", e); gracefulShutdown("uncaughtException"); });
