require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const rateLimit = require("express-rate-limit");
const { Server } = require("socket.io");
const { io: ClientIO } = require("socket.io-client");
const axios = require("axios");
const path = require("path");
const mongoose = require("mongoose");

const connectDB = require("./config/db");

const app = express();
const server = http.createServer(app);

/* ======================================================
   CONFIG
   ====================================================== */
const CORE_API = process.env.CORE_API_URL || "http://localhost:3000";
const CLIENT_ORIGIN = process.env.ADMIN_CLIENT_URL || process.env.CLIENT_URL || "*";

/* ======================================================
   CONNECT DB (solo para lectura si quieres logs/admin data)
   ====================================================== */
connectDB().catch((err) => {
  console.error("DB error:", err);
});

/* ======================================================
   MIDDLEWARES
   ====================================================== */
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));

app.use(rateLimit({
  windowMs: 60_000,
  max: 300,
}));

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));

/* ======================================================
   SOCKET.IO (ADMIN CLIENTES)
   ====================================================== */
const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    credentials: true
  }
});

/* ======================================================
   🔌 CONEXIÓN AL SERVER PRINCIPAL (REALTIME BRIDGE)
   ====================================================== */
const coreSocket = ClientIO(CORE_API, {
  transports: ["websocket"],
  reconnection: true,
});

coreSocket.on("connect", () => {
  console.log("🟢 Conectado al server principal (realtime)");
});

coreSocket.on("disconnect", () => {
  console.warn("🔴 Desconectado del server principal");
});

/* 🔥 REENVIAR EVENTOS AL PANEL ADMIN */
[
  "wallet_update",
  "account_update",
  "positions_update",
  "transactions_update"
].forEach(event => {
  coreSocket.on(event, (data) => {
    io.emit(event, data); // 👈 lo manda al panel admin en tiempo real
  });
});

/* ======================================================
   ADMIN AUTH
   ====================================================== */
function ensureAdminKey(req, res, next) {
  if (!process.env.ADMIN_API_KEY) return next();
  const key = req.headers["x-admin-key"];
  if (key !== process.env.ADMIN_API_KEY) {
    return res.status(403).json({ msg: "Admin key inválida" });
  }
  next();
}

/* ======================================================
   🔥 PROXY: DEPÓSITO
   ====================================================== */
app.post("/api/admin/deposit", ensureAdminKey, async (req, res) => {
  try {
    const r = await axios.post(`${CORE_API}/api/admin/deposit`, req.body, {
      headers: { "x-admin-api-key": process.env.ADMIN_API_KEY }
    });

    return res.json(r.data);
  } catch (err) {
    console.error("deposit error:", err?.response?.data || err.message);
    return res.status(500).json({
      ok: false,
      error: err?.response?.data || err.message
    });
  }
});

/* ======================================================
   🔥 PROXY: RETIRO
   ====================================================== */
app.post("/api/admin/withdraw", ensureAdminKey, async (req, res) => {
  try {
    const r = await axios.post(`${CORE_API}/api/admin/withdraw`, req.body, {
      headers: { "x-admin-api-key": process.env.ADMIN_API_KEY }
    });

    return res.json(r.data);
  } catch (err) {
    console.error("withdraw error:", err?.response?.data || err.message);
    return res.status(500).json({
      ok: false,
      error: err?.response?.data || err.message
    });
  }
});

/* ======================================================
   🔥 PROXY: VER USUARIOS / CUENTA
   ====================================================== */
app.get("/api/admin/account/:userId", ensureAdminKey, async (req, res) => {
  try {
    const r = await axios.get(`${CORE_API}/api/admin/transactions?userId=${req.params.userId}`, {
      headers: { "x-admin-api-key": process.env.ADMIN_API_KEY }
    });

    return res.json(r.data);
  } catch (err) {
    console.error("account error:", err?.response?.data || err.message);
    return res.status(500).json({
      ok: false,
      error: err?.response?.data || err.message
    });
  }
});

/* ======================================================
   PANEL ADMIN
   ====================================================== */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

/* ======================================================
   HEALTH
   ====================================================== */
app.get("/healthz", (req, res) => {
  res.json({
    ok: true,
    core: CORE_API,
    socketConnected: coreSocket.connected
  });
});

/* ======================================================
   START
   ====================================================== */
const PORT = process.env.ADMIN_PORT || 4000;

server.listen(PORT, () => {
  console.log("🔥 ADMIN SERVER RUNNING:", PORT);
  console.log("CORE API:", CORE_API);
});

/* ======================================================
   SOCKET ADMIN CLIENT CONNECTION
   ====================================================== */
io.on("connection", (socket) => {
  console.log("🟢 Admin conectado:", socket.id);

  socket.on("disconnect", () => {
    console.log("🔴 Admin desconectado:", socket.id);
  });
});
