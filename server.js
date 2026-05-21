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
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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
Promise.resolve(connectDB()).catch((err) => console.error("Error conectando DB:", err?.message || err));
mongoose.connection.on("connected", () => console.log("✅ Mongo conectado"));
mongoose.connection.on("error", (err) => console.error("❌ Mongo connection error:", err));
mongoose.connection.on("disconnected", () => console.warn("⚠️ Mongo disconnected"));

/* ======================================================
   MODELOS
====================================================== */
// User, Wallet, Transaction, Position, Withdraw
// [Usar el mismo schema del server cliente + admin]
// ... Define todos los schemas aquí como en tu código previo

// Por brevedad aquí asumimos que están definidos: User, Wallet, Transaction, Position, Withdraw

/* ======================================================
   MIDDLEWARE
====================================================== */
const CLIENT_ORIGIN_RAW = process.env.ADMIN_CLIENT_URL || process.env.CLIENT_URL || "*";
function parseAllowedOrigins(raw) {
  if (!raw || raw === "*") return "*";
  return String(raw).split(",").map((s) => s.trim()).filter(Boolean);
}
const ALLOWED_ORIGINS = parseAllowedOrigins(CLIENT_ORIGIN_RAW);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS === "*") return callback(null, true);
    if (Array.isArray(ALLOWED_ORIGINS) && ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
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
  cors: {
    origin: ALLOWED_ORIGINS === "*" ? true : ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
    credentials: true,
  },
});
app.set("io", io);
app.use((req, res, next) => { req.io = io; next(); });

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie || "";
  for (const part of cookieHeader.split(";").map(p => p.trim())) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
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
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return !!decoded && (decoded.admin === true || decoded.role === "admin");
  } catch {
    return false;
  }
}

function ensureAdminAuth(req, res, next) {
  try {
    if (ADMIN_API_KEY) {
      const key = req.headers["x-admin-api-key"] || req.headers["x-admin-key"] || req.headers["admin-key"] || "";
      if (key && key === ADMIN_API_KEY) return next();
    }
    if (isAdminTokenValid(req)) return next();
    return res.status(401).json({ ok: false, msg: "No autorizado" });
  } catch {
    return res.status(401).json({ ok: false, msg: "No autorizado" });
  }
}

// Aquí se deja igual que el server cliente: joinWithdrawRoom, conexión socket, etc.

/* ======================================================
   HELPERS, PROXY, CORE, ZOHO
====================================================== */
// Mantener todas tus funciones helpers, fetchCoreUsersOnce, syncCoreUsersToLocalAndZoho,
// depositByDelta, localDeposit, localWithdraw, buildAccountForUser, emitStateUpdates, etc.

/* ======================================================
   RUTAS
====================================================== */
// IMPORTANTE: se combinan rutas cliente + admin
// 1) TRANSACTIONS
app.get("/api/admin/transactions", ensureAdminAuth, async (req, res) => { /* ... */ });
app.get("/api/transactions", ensureAdminAuth, async (req, res) => { /* ... */ });

// 2) WITHDRAW
app.post("/api/withdraw/request", async (req, res) => { /* ... */ });
app.get("/api/withdraw/history/:userId", async (req, res) => { /* ... */ });
app.get("/api/withdraw/:id", async (req, res) => { /* ... */ });
app.post("/api/withdraw/message", async (req, res) => { /* ... */ });
app.get("/api/admin/withdraws", ensureAdminAuth, async (req, res) => { /* ... */ });
app.get("/api/admin/withdraws/:userId", ensureAdminAuth, async (req, res) => { /* ... */ });
app.get("/api/admin/withdraw/:id", ensureAdminAuth, async (req, res) => { /* ... */ });
app.post("/api/admin/withdraw/message", ensureAdminAuth, async (req, res) => { /* ... */ });
app.post("/api/admin/withdraw/counter", ensureAdminAuth, async (req, res) => { /* ... */ });
app.post("/api/withdraw/accept-offer", async (req, res) => { /* ... */ });
app.post("/api/admin/withdraw/approve", ensureAdminAuth, async (req, res) => { /* ... */ });
app.post("/api/admin/withdraw/reject", ensureAdminAuth, async (req, res) => { /* ... */ });

// 3) LEVERAGE
app.post(["/api/admin/update-leverage", "/api/update-leverage"], ensureAdminAuth, async (req, res) => { /* ... */ });
app.put("/api/admin/users/leverage/:id", ensureAdminAuth, async (req, res) => { /* ... */ });

// 4) BALANCE
app.post(["/api/admin/update-balance", "/api/update-balance"], ensureAdminAuth, async (req, res) => { /* ... */ });

// 5) DEPOSIT / WITHDRAW ADMIN
app.post(["/api/admin/deposit", "/api/deposit"], ensureAdminAuth, async (req, res) => { /* ... */ });
app.post(["/api/admin/withdraw", "/api/withdraw"], ensureAdminAuth, async (req, res) => { /* ... */ });

// 6) ACCOUNT / USERS
app.get(["/api/admin/account/:userId", "/api/account/:userId"], ensureAdminAuth, async (req, res) => { /* ... */ });
app.get(["/api/account", "/api/admin/account"], ensureAdminAuth, async (req, res) => { /* ... */ });
app.get(["/api/admin/users", "/api/users"], ensureAdminAuth, async (req, res) => { /* ... */ });
app.post("/api/admin/users/:id/sync-zoho", ensureAdminAuth, async (req, res) => { /* ... */ });

// 7) AUTH
app.post(["/api/admin/login", "/api/login"], async (req, res) => { /* ... */ });

// 8) SYNC CORE
app.post("/api/admin/sync-core", ensureAdminAuth, async (req, res) => { /* ... */ });
app.get("/api/admin/sync-core", ensureAdminAuth, async (req, res) => { /* ... */ });

// 9) ROOT / HEALTH
app.get("/", (req, res) => { res.sendFile(path.join(__dirname, "public", "admin.html")); });
app.get("/healthz", (req, res) => { /* ... */ });

// 10) FALLBACKS
app.use("/api", (req, res) => { res.status(404).json({ ok: false, msg: "API endpoint not found" }); });
app.use((err, req, res, next) => { console.error("Unhandled error:", err); res.status(err.status || 500).json({ ok: false, msg: "Error servidor", detail: process.env.NODE_ENV === "development" ? err.message || String(err) : undefined }); });

/* ======================================================
   START SERVER
====================================================== */
const PORT = Number(process.env.PORT || 4000);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🔥 SERVER RUNNING EN: ${PORT}`);
});

/* ======================================================
   GRACEFUL SHUTDOWN
====================================================== */
let shuttingDown = false;
const gracefulShutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`📴 ${signal} recibido. Cerrando servidor...`);
  const force = setTimeout(() => { process.exit(1); }, 30_000);
  force.unref();
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
process.on("unhandledRejection", (r) => { console.error("UnhandledRejection:", r); gracefulShutdown("unhandledRejection"); });
process.on("uncaughtException", (e) => { console.error("UncaughtException:", e); gracefulShutdown("uncaughtException"); });
