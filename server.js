import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import { createServer } from "http";
import { Server as IOServer } from "socket.io";
import fs from "fs";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import mongoSanitize from "express-mongo-sanitize";
import xss from "xss-clean";
import jwt from "jsonwebtoken";

import { connectDB } from "./config/db.js";
import authRoutes from "./routes/auth.routes.js";
import userRoutes from "./routes/user.routes.js";
import verificationRoutes from "./routes/verification.routes.js";
import walletRoutes from "./routes/wallet.routes.js";
import positionsRoutes from "./routes/positions.routes.js";
import tradeRoutes from "./routes/trade.routes.js";
import accountRoutes from "./routes/account.routes.js";
import passwordRoutes from "./routes/password.routes.js";
import { startRiskWatcher } from "./jobs/risk.job.js";
import PolygonSocket from "./sockets/polygonSocket.js";
import PriceHandler from "./utils/priceHandler.js";
import marketRoutesFactory from "./routes/market.routes.js";
import sendEmail from "./utils/sendEmail.js";
import adminWithdrawRoutes from "./routes/adminWithdrawRoutes.js";

// Models
import User from "./models/user.model.js";
import Wallet from "./models/wallet.model.js";
import Position from "./models/position.model.js";

// Document model
const documentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  type: String,
  status: String,
  file: String,
  createdAt: { type: Date, default: Date.now },
});
const Document = mongoose.models.Document || mongoose.model("Document", documentSchema);

// Withdraw schema (already in admin server)
const withdrawSchema = new mongoose.Schema({
  userId: { type: String, index: true },
  amount: { type: Number, default: 0 },
  method: { type: String, default: "" },
  walletAddress: { type: String, default: "" },
  bankName: { type: String, default: "" },
  accountNumber: { type: String, default: "" },
  note: { type: String, default: "" },
  adminNote: { type: String, default: "" },
  status: { type: String, default: "pending", index: true },
  offerAmount: { type: Number, default: 0 },
  messages: [
    {
      sender: { type: String, default: "" },
      message: { type: String, default: "" },
      createdAt: { type: Date, default: Date.now },
    },
  ],
  processedBy: { type: String, default: "" },
  processedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});
withdrawSchema.index({ userId: 1, createdAt: -1 });
const Withdraw = mongoose.models.Withdraw || mongoose.model("Withdraw", withdrawSchema);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path:
    process.env.NODE_ENV === "production"
      ? undefined
      : path.resolve(__dirname, ".env"),
});

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

connectDB();

mongoose.connection.on("connected", () => {
  console.log("✅ MongoDB conectado. DB:", mongoose.connection.name);
  try {
    const intervalMs = Number(process.env.RISK_JOB_INTERVAL_MS) || 30000;
    const alertThreshold = Number(process.env.RISK_ALERT_THRESHOLD) || 30;
    const closeThreshold = Number(process.env.RISK_CLOSE_THRESHOLD) || 15;
    const stopFn = startRiskWatcher({ intervalMs, alertThreshold, closeThreshold });
    if (typeof stopFn === "function") global.stopRiskWatcher = stopFn;
  } catch (e) {
    console.error("Error iniciando risk watcher:", e);
  }
});

mongoose.connection.on("error", (err) => console.error("❌ Mongo error:", err));
mongoose.connection.on("disconnected", () => console.warn("⚠️ Mongo desconectado"));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(mongoSanitize());
app.use(xss());

const allowedOrigins = new Set(
  [
    process.env.CLIENT_URL,
    process.env.BASE_URL,
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:4000",
    "http://127.0.0.1:4000",
    "https://leones-broker.onrender.com",
  ].filter(Boolean)
);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.has(origin)) return callback(null, true);
    try {
      const url = new URL(origin);
      if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return callback(null, true);
    } catch {}
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} › ${req.method} ${req.originalUrl}`);
  next();
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/api/password", passwordRoutes);
app.use("/api/admin", adminWithdrawRoutes);

// Rate limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", limiter);

// Socket.io
const httpServer = createServer(app);
const io = new IOServer(httpServer, {
  cors: { origin: Array.from(allowedOrigins), methods: ["GET", "POST"], credentials: true },
});
app.set("io", io);
app.use((req, res, next) => { req.io = io; next(); });

// ======================
// DOCUMENTS ROUTES
// ======================
// Admin
app.get("/api/admin/documents", ensureAdminAuth, async (req,res)=>{
  const docs = await Document.find().sort({createdAt:-1});
  res.json({ok:true, count: docs.length, documents: docs});
});
// Cliente
app.get("/api/documents", async (req,res)=>{
  const user = await getUserDocFromBearer(req);
  if(!user) return res.status(401).json({ok:false,error:"Unauthorized"});
  const docs = await Document.find({user:user._id}).sort({createdAt:-1});
  res.json({ok:true,count:docs.length,documents:docs});
});

// ======================
// ADMIN SERVER ROUTES
// ======================
// Aquí se incluyen todas las rutas de transacciones, retiros y administración
// (copiadas tal como me enviaste en tu segunda parte)
// ... todas las rutas /api/admin/transactions, /api/withdraw, /api/admin/withdraws, approve/reject, deposit, withdraw, etc.
// Las funciones helpers como localWithdraw, emitWithdrawEvents, pushWithdrawMessage, buildAccountForUser ya están definidas arriba.

// ======================
// START SERVER
// ======================
const PORT = Number(process.env.PORT || 4000);
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`🔥 SERVER RUNNING ON PORT: ${PORT}`);
});
