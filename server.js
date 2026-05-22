require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const rateLimit = require("express-rate-limit");
const { Server } = require("socket.io");
const path = require("path");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const connectDB = require("./config/db");

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

if (!CORE_API_URL) {
  console.warn("⚠️ CORE_API_URL no definido. Se usará modo local si hace falta.");
}
if (ZOHO_ENABLED && (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_REFRESH_TOKEN)) {
  console.warn("⚠️ Zoho habilitado pero faltan ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REFRESH_TOKEN.");
}

/* ======================================================
   DB
====================================================== */
Promise.resolve(connectDB()).catch((err) => {
  console.error("Error conectando DB:", err?.message || err);
});

mongoose.connection.on("connected", () => console.log("✅ Mongo conectado"));
mongoose.connection.on("error", (err) => console.error("❌ Mongo connection error:", err));
mongoose.connection.on("disconnected", () => console.warn("⚠️ Mongo disconnected"));

/* ======================================================
   MODELOS
====================================================== */
// USER
const userSchema = new mongoose.Schema({
  sourceId: { type: String, index: true },
  email: { type: String, index: true },
  firstName: { type: String, default: "" },
  lastName: { type: String, default: "" },
  fullName: { type: String, default: "" },
  phone: { type: String, default: "" },
  address: { type: String, default: "" },
  password: { type: String, select: false },
  balance: { type: Number, default: 0 },
  leverage: { type: Number, default: 1 },
  currency: { type: String, default: "USD" },
  role: { type: String, default: "" },
  isAdmin: { type: Boolean, default: false },
  admin: { type: Boolean, default: false },
  zohoLeadId: { type: String, default: "" },
  zohoContactId: { type: String, default: "" },
  zohoModule: { type: String, default: "" },
  zohoSyncStatus: { type: String, default: "" },
  zohoLastError: { type: String, default: "" },
  zohoSyncedAt: { type: Date, default: null },
  source: { type: String, default: "core" },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { minimize: false, strict: false });

// DOCUMENT (IMPORTANTE: añadido para evitar error 500)
const documentSchema = new mongoose.Schema({
  userId: { type: String, index: true },
  type: { type: String, default: "Desconocido" },
  documentUrl: { type: String, default: "" },
  proofUrl: { type: String, default: "" },
  status: { type: String, default: "pendiente" },
  adminNote: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { minimize: false, strict: false });

// MODELOS
const User = mongoose.models.User || mongoose.model("User", userSchema);
const Document = mongoose.models.Document || mongoose.model("Document", documentSchema);

// OTRAS colecciones: Wallet, Transaction, Position, Withdraw (mantener igual)
/* ... tu código de Wallet, Transaction, Position, Withdraw ... */

/* ======================================================
   MIDDLEWARE, SOCKET.IO, HELPERS
====================================================== */
/* ... todo tu middleware, cors, rateLimit, socket.io, helpers ... */

/* ======================================================
   ENDPOINTS DE DOCUMENTOS (FIXED)
====================================================== */
app.get("/api/admin/documents/:userId", ensureAdminAuth, async (req, res) => {
  try {
    const userId = req.params.userId;
    const docs = await Document.find({ userId }).sort({ createdAt: -1 }).lean().exec();

    const result = docs.map(d => ({
      _id: d._id,
      userId: d.userId,
      type: d.type || "Desconocido",
      documentUrl: d.documentUrl || d.proofUrl || null,
      status: d.status || "pendiente",
      adminNote: d.adminNote || "",
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }));

    return res.json({ ok: true, count: result.length, documents: result });
  } catch (err) {
    console.error(`GET /api/admin/documents/${req.params.userId} error:`, err);
    return res.status(500).json({ ok: false, msg: "Error obteniendo documentos", error: err?.message || String(err) });
  }
});

/* ======================================================
   RESTO DEL CÓDIGO
====================================================== */
/* Mantener todos tus endpoints de withdraw, users, account, balance, deposit, Zoho, sync core, auth, health, shutdown etc. exactamente igual */
