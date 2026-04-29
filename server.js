require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const rateLimit = require("express-rate-limit");
const { Server } = require("socket.io");
const { io: ClientIO } = require("socket.io-client");
const axios = require("axios");
const path = require("path");

const app = express();
const server = http.createServer(app);

/* ======================================================
   CONFIG
   ====================================================== */
const CORE_API = process.env.CORE_API_URL;
const CLIENT_ORIGIN = process.env.ADMIN_CLIENT_URL || "*";

if (!CORE_API) {
  console.error("❌ ERROR: CORE_API_URL no está definido");
  process.exit(1);
}

/* ======================================================
   MIDDLEWARES
   ====================================================== */
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));

app.use(rateLimit({
  windowMs: 60_000,
  max: 300
}));

app.use(express.json());
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
   🔌 CONEXIÓN AL SERVER PRINCIPAL
   ====================================================== */
const coreSocket = ClientIO(CORE_API, {
  transports: ["websocket"],
  reconnection: true
});

coreSocket.on("connect", () => {
  console.log("🟢 Conectado al server principal");
});

coreSocket.on("disconnect", () => {
  console.warn("🔴 Desconectado del server principal");
});

/* 🔥 REENVIAR EVENTOS */
[
  "wallet_update",
  "account_update",
  "positions_update",
  "transactions_update"
].forEach(event => {
  coreSocket.on(event, (data) => {
    io.emit(event, data);
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
   PROXY REQUEST
   ====================================================== */
async function proxy(req, res, endpoint) {
  try {
    const r = await axios({
      method: req.method,
      url: `${CORE_API}${endpoint}`,
      data: req.body,
      headers: {
        "x-admin-api-key": process.env.ADMIN_API_KEY
      }
    });

    return res.json(r.data);
  } catch (err) {
    console.error("Proxy error:", err?.response?.data || err.message);
    return res.status(500).json({
      ok: false,
      error: err?.response?.data || err.message
    });
  }
}

/* ======================================================
   ENDPOINTS ADMIN
   ====================================================== */
app.post("/api/admin/deposit", ensureAdminKey, (req, res) => {
  proxy(req, res, "/api/admin/deposit");
});

app.post("/api/admin/withdraw", ensureAdminKey, (req, res) => {
  proxy(req, res, "/api/admin/withdraw");
});

app.get("/api/admin/transactions", ensureAdminKey, (req, res) => {
  const qs = req.url.split("?")[1] || "";
  proxy(req, res, `/api/admin/transactions?${qs}`);
});

/* ======================================================
   PANEL
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
    socket: coreSocket.connected
  });
});

/* ======================================================
   START
   ====================================================== */
const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
  console.log("🔥 ADMIN SERVER:", PORT);
  console.log("CORE:", CORE_API);
});

/* ======================================================
   SOCKET ADMIN CLIENT
   ====================================================== */
io.on("connection", (socket) => {
  console.log("🟢 Admin conectado:", socket.id);

  socket.on("disconnect", () => {
    console.log("🔴 Admin desconectado:", socket.id);
  });
});
