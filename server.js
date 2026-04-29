require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const rateLimit = require("express-rate-limit");
const { Server } = require("socket.io");
const path = require("path");
const mongoose = require("mongoose");

const connectDB = require("./config/db");

const app = express();
const server = http.createServer(app);

// ================= CONFIG SEGURA =================
const CORE_API_URL = process.env.CORE_API_URL || null;
if (!CORE_API_URL) {
  console.warn("⚠️ CORE_API_URL no definido (modo local activo)");
}

// ================= DB =================
connectDB();

mongoose.connection.on("connected", () => {
  console.log("✅ Mongo conectado");
});

// ================= MIDDLEWARE =================
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

// ================= SOCKET.IO =================
const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    credentials: true
  }
});

app.set("io", io);

app.use((req, res, next) => {
  req.io = io;
  next();
});

// ================= LOGIN SIN BLOQUEO =================
function ensureAdminKey(req, res, next) {
  if (!process.env.ADMIN_API_KEY) return next();

  const key = req.headers["x-admin-key"];
  if (!key || key !== process.env.ADMIN_API_KEY) {
    return res.status(403).json({ msg: "Admin key inválida" });
  }
  next();
}

// ⚠️ IMPORTANTE: login queda SIN bloqueo
const adminRoutes = require("./routes/admin.routes");
app.use("/api/admin", adminRoutes);

// ================= EJEMPLOS TIEMPO REAL =================

// actualizar saldo
app.post("/api/admin/update-balance", async (req, res) => {
  try {
    const { userId, balance } = req.body;

    // aquí iría tu lógica de DB
    console.log("💰 saldo actualizado:", userId, balance);

    // emitir al cliente
    req.io.emit(`balance:${userId}`, balance);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

// retiro aprobado
app.post("/api/admin/withdraw-response", async (req, res) => {
  try {
    const { userId, status } = req.body;

    console.log("🏦 retiro:", userId, status);

    req.io.emit(`withdraw:${userId}`, status);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false });
  }
});

// ================= ROOT =================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// ================= HEALTH =================
app.get("/healthz", (req, res) => {
  res.json({
    ok: true,
    db: mongoose.connection.readyState
  });
});

// ================= ERROR =================
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ msg: "Error servidor" });
});

// ================= START =================
const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
  console.log("🔥 ADMIN RUNNING EN:", PORT);
});
