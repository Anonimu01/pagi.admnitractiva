// server.js
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

const connectDB = require("./config/db");

// ----------------- CONFIG -----------------
const CORE_API_URL = (process.env.CORE_API_URL || "").replace(/\/+$/, "");
const CORE_USERS_ENDPOINTS = (process.env.CORE_USERS_ENDPOINTS || "/api/users,/api/admin/users,/api/clients,/api/leads,/api/registers")
  .split(",").map(s => s.trim()).filter(Boolean);

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
const ADMIN_PASS = process.env.ADMIN_PASS || "";
const JWT_SECRET = process.env.JWT_SECRET || "admin-secret-dev";
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "";

const ZOHO_ENABLED = (process.env.ZOHO_ENABLED || "true").toLowerCase() !== "false";
const ZOHO_CLIENT_ID = process.env.ZOHO_CLIENT_ID || "";
const ZOHO_CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || "";
const ZOHO_REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN || "";
const ZOHO_ACCOUNTS_URL = (process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com").replace(/\/+$/, "");
const ZOHO_API_BASE_URL = (process.env.ZOHO_API_BASE_URL || "https://www.zohoapis.com").replace(/\/+$/, "");
const ZOHO_MODULE = process.env.ZOHO_MODULE || "Leads";
const ZOHO_FALLBACK_MODULE = process.env.ZOHO_FALLBACK_MODULE || "Contacts";
const ZOHO_FIRST_NAME_FIELD = process.env.ZOHO_FIRST_NAME_FIELD || "First_Name";
const ZOHO_LAST_NAME_FIELD = process.env.ZOHO_LAST_NAME_FIELD || "Last_Name";
const ZOHO_EMAIL_FIELD = process.env.ZOHO_EMAIL_FIELD || "Email";
const ZOHO_PHONE_FIELD = process.env.ZOHO_PHONE_FIELD || "Phone";
const ZOHO_ADDRESS_FIELD = process.env.ZOHO_ADDRESS_FIELD || "Street";
const ZOHO_COMPANY_FIELD = process.env.ZOHO_COMPANY_FIELD || "Company";
const ZOHO_SYNC_INTERVAL_MS = Number(process.env.ZOHO_SYNC_INTERVAL_MS || 300000);

if (!CORE_API_URL) console.warn("⚠️ CORE_API_URL no definido.");
if (ZOHO_ENABLED && (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN))
  console.warn("⚠️ Zoho habilitado pero faltan credenciales.");

// ----------------- DB -----------------
connectDB().catch(err => console.error("Error conectando DB:", err));

mongoose.connection.on("connected", () => console.log("✅ Mongo conectado"));
mongoose.connection.on("error", err => console.error("❌ Mongo error:", err));
mongoose.connection.on("disconnected", () => console.warn("⚠️ Mongo desconectado"));

// ----------------- MODELOS -----------------
const userSchema = new mongoose.Schema({
  sourceId: String,
  email: String,
  firstName: String,
  lastName: String,
  fullName: String,
  phone: String,
  address: String,
  password: { type: String, select: false },
  balance: { type: Number, default: 0 },
  leverage: { type: Number, default: 1 },
  currency: { type: String, default: "USD" },
  role: String,
  isAdmin: { type: Boolean, default: false },
  zohoLeadId: String,
  zohoContactId: String,
  zohoModule: String,
  zohoSyncStatus: String,
  zohoLastError: String,
  zohoSyncedAt: Date,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { minimize: false, strict: false });

const walletSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  balanceOwn: { type: Number, default: 0 },
  balance: { type: Number, default: 0 },
  credit: { type: Number, default: 0 },
  marginUsed: { type: Number, default: 0 },
  leverageFactor: { type: Number, default: 1 },
  equity: { type: Number, default: 0 },
  freeMargin: { type: Number, default: 0 },
  marginLevel: { type: Number, default: 0 },
  currency: { type: String, default: "USD" },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { minimize: false, strict: false });

const transactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  userId: String,
  type: String,
  amount: Number,
  status: { type: String, default: "completed" },
  note: String,
  balanceBefore: Number,
  balanceAfter: Number,
  meta: mongoose.Schema.Types.Mixed,
  source: { type: String, default: "admin-server.js" },
  createdAt: { type: Date, default: Date.now },
}, { minimize: false, strict: false });

const positionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  symbol: String,
  side: String,
  qty: Number,
  entryPrice: Number,
  currentPrice: Number,
  closePrice: Number,
  marginReserved: Number,
  leverage: Number,
  status: String,
  pnl: Number,
  realizedPnl: Number,
  closedAt: Date,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { minimize: false, strict: false });

const withdrawSchema = new mongoose.Schema({
  userId: String,
  amount: Number,
  status: { type: String, default: "pending" },
  note: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { minimize: false, strict: false });

const User = mongoose.models.User || mongoose.model("User", userSchema);
const Wallet = mongoose.models.Wallet || mongoose.model("Wallet", walletSchema);
const Transaction = mongoose.models.Transaction || mongoose.model("Transaction", transactionSchema);
const Position = mongoose.models.Position || mongoose.model("Position", positionSchema);
const Withdraw = mongoose.models.Withdraw || mongoose.model("Withdraw", withdrawSchema);

// ----------------- APP -----------------
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"], credentials: true } });
app.set("io", io);
app.use((req, res, next) => { req.io = io; next(); });

// ----------------- MIDDLEWARE -----------------
const CLIENT_ORIGIN_RAW = process.env.ADMIN_CLIENT_URL || process.env.CLIENT_URL || "*";
const ALLOWED_ORIGINS = CLIENT_ORIGIN_RAW === "*" ? "*" : CLIENT_ORIGIN_RAW.split(",").map(s => s.trim());

app.use(cors({ origin: (origin, cb) => {
  if (!origin || ALLOWED_ORIGINS === "*" || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
  return cb(new Error("Not allowed by CORS"));
}, credentials: true }));
app.use(rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
  max: Number(process.env.RATE_LIMIT_MAX || 200),
}));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// ----------------- HELPERS -----------------
// (Aquí irían todas tus funciones helper: normalizeNumber, emitStateUpdates, proxyToCore, Zoho, depositByDelta, localDeposit/localWithdraw, etc.)
// Para no alargar este snippet, puedes copiar exactamente todas las funciones que escribiste en tu último bloque desde "function getCookie" hasta "depositByDelta"

// ----------------- RUTAS -----------------
// Auth, Users, Account, Transactions, Withdraws, Balance/Leverage, Sync Core
// Usa exactamente las rutas que escribiste en tu último bloque (desde app.post("/api/admin/login") hasta app.post("/api/admin/withdraw"))

// ----------------- HEALTH & ROOT -----------------
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/healthz", (req, res) => res.json({
  ok: true,
  env: process.env.NODE_ENV || "development",
  dbReadyState: mongoose.connection.readyState,
  coreConfigured: !!CORE_API_URL,
  adminApiKeyConfigured: !!ADMIN_API_KEY,
  adminEmailConfigured: !!ADMIN_EMAIL,
  adminTokenSecretConfigured: !!JWT_SECRET,
  mongoConfigured: !!process.env.MONGO_URI,
  zohoConfigured: ZOHO_ENABLED,
}));

// ----------------- FALLBACKS -----------------
app.use("/api", (req, res) => res.status(404).json({ ok: false, msg: "API endpoint not found" }));
app.use((err, req, res, next) => res.status(err.status || 500).json({
  ok: false,
  msg: "Error servidor",
  detail: process.env.NODE_ENV === "development" ? err.message : undefined
}));

// ----------------- START SERVER -----------------
const PORT = Number(process.env.PORT || 4000);
server.listen(PORT, () => console.log(`🔥 ADMIN RUNNING EN: ${PORT}`));

// ----------------- GRACEFUL SHUTDOWN -----------------
let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`📴 ${signal} recibido. Cerrando servidor admin...`);
  const force = setTimeout(() => process.exit(1), 30_000); force.unref();
  try { await new Promise(r => server.close(r)); io.emit("server:shutdown"); await io.close(); await mongoose.disconnect(); clearTimeout(force); process.exit(0); } catch { clearTimeout(force); process.exit(1); }
}
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("unhandledRejection", r => gracefulShutdown("unhandledRejection"));
process.on("uncaughtException", e => gracefulShutdown("uncaughtException"));
