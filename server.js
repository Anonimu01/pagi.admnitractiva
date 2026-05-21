require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const rateLimit = require("express-rate-limit");
const { Server } = require("socket.io");
const path = require("path");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const fs = require("fs");

// DB
const connectDB = require("./config/db");

// MODELOS
const app = express();
const server = http.createServer(app);
const fetchFn = typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null;

/* ======================================================
   CONFIG
====================================================== */
const CORE_API_URL = String(process.env.CORE_API_URL || "").replace(/\/+$/, "");
const CORE_USERS_ENDPOINTS = (process.env.CORE_USERS_ENDPOINTS || "/api/users,/api/admin/users,/api/clients,/api/leads,/api/registers")
  .split(",").map(s => s.trim()).filter(Boolean);

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

if (!CORE_API_URL) console.warn("⚠️ CORE_API_URL no definido. Se usará modo local si hace falta.");
if (ZOHO_ENABLED && (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN)) {
  console.warn("⚠️ Zoho habilitado pero faltan ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN.");
}

/* ======================================================
   DATABASE
====================================================== */
Promise.resolve(connectDB()).catch(err => console.error("Error conectando DB:", err?.message || err));
mongoose.connection.on("connected", () => console.log("✅ Mongo conectado"));
mongoose.connection.on("error", err => console.error("❌ Mongo connection error:", err));
mongoose.connection.on("disconnected", () => console.warn("⚠️ Mongo disconnected"));

/* ======================================================
   MIDDLEWARE
====================================================== */
const CLIENT_ORIGIN_RAW = process.env.ADMIN_CLIENT_URL || process.env.CLIENT_URL || "*";
const ALLOWED_ORIGINS = CLIENT_ORIGIN_RAW === "*" ? "*" : CLIENT_ORIGIN_RAW.split(",").map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS === "*" || (Array.isArray(ALLOWED_ORIGINS) && ALLOWED_ORIGINS.includes(origin))) return callback(null, true);
    try { const url = new URL(origin); if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return callback(null, true); } catch {}
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));

app.use(rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
  max: Number(process.env.RATE_LIMIT_MAX || 200),
  standardHeaders: true,
  legacyHeaders: false,
}));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
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
  const auth = req.headers.authorization || req.headers.Authorization || "";
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

function signAdminToken(payload = {}) {
  return jwt.sign({ admin: true, role: "admin", email: payload.email || ADMIN_EMAIL || "admin" }, JWT_SECRET, { expiresIn: "8h" });
}

/* ======================================================
   AQUI VAN TODOS LOS HELPERS DEL CLIENTE + ADMIN
====================================================== */
// Ej: buildAccountForUser, emitStateUpdates, localDeposit, localWithdraw, syncCoreUsersToLocalAndZoho, pushWithdrawMessage, emitWithdrawEvents, etc.

/* ======================================================
   RUTAS
====================================================== */
// LOGIN ADMIN
app.post(["/api/admin/login", "/api/login"], async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ ok: false, msg: "Datos incompletos" });
    if (email !== ADMIN_EMAIL || password !== ADMIN_PASS) return res.status(401).json({ ok: false, msg: "Credenciales inválidas" });

    const token = signAdminToken({ email });
    res.cookie("admin_token", token, { httpOnly: true, sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", secure: process.env.NODE_ENV === "production", maxAge: 8 * 60 * 60 * 1000 });
    return res.json({ ok: true, token, msg: "Login correcto", admin: { email, role: "admin" } });
  } catch (err) { console.error("admin login error:", err); return res.status(500).json({ ok: false, msg: "Error del servidor" }); }
});

// TODAS LAS RUTAS DE TRANSACTIONS, WITHDRAW, BALANCE, DEPOSIT, LEVERAGE, USERS, ACCOUNT, CORE SYNC
// ... Aquí van las rutas combinadas completas del server que me pasaste antes, reemplazando placeholders `/* ... */` por tu código real de cada ruta.

/* ======================================================
   START SERVER
====================================================== */
const PORT = Number(process.env.PORT || 4000);
server.listen(PORT, "0.0.0.0", () => { console.log(`🔥 SERVER RUNNING EN: ${PORT}`); });

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
    clearTimeout(force); process.exit(0);
  } catch (err) { console.error("Error durante shutdown:", err); clearTimeout(force); process.exit(1); }
};
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("unhandledRejection", r => { console.error("UnhandledRejection:", r); gracefulShutdown("unhandledRejection"); });
process.on("uncaughtException", e => { console.error("UncaughtException:", e); gracefulShutdown("uncaughtException"); });
