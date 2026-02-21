// admin-server.js (actualizado y completo)
// Este archivo es CommonJS (como el original que enviaste).
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const rateLimit = require("express-rate-limit");
const { Server } = require("socket.io");
const path = require("path");
const mongoose = require("mongoose");

// connectDB debe exportar una función que retorne una Promise
const connectDB = require("./config/db");

const app = express();
const server = http.createServer(app);

// ================= CONNECT DB =================
connectDB()
  .then(() => {
    mongoose.connection.on("connected", () => {
      console.log("✅ Mongo conectado a DB:", mongoose.connection.name, "host:", mongoose.connection.host);
    });
    mongoose.connection.on("error", (err) => {
      console.error("❌ Mongo connection error:", err);
    });
    mongoose.connection.on("disconnected", () => {
      console.warn("⚠️ Mongo disconnected");
    });
  })
  .catch((err) => {
    console.error("Error iniciando DB (connectDB rejected):", err);
    // si no se conecta la DB probablemente el servicio no debería arrancar,
    // pero dejamos que el proceso intente continuar (depende de tu infra).
  });

// =========== MIDDLEWARES ===========
const CLIENT_ORIGIN = process.env.ADMIN_CLIENT_URL || process.env.CLIENT_URL || "*";

app.use(cors({
  origin: CLIENT_ORIGIN,
  credentials: true
}));

app.use(rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
  max: Number(process.env.RATE_LIMIT_MAX || 120),
  standardHeaders: true,
  legacyHeaders: false
}));

// body parsers
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

// static files (admin frontend)
app.use(express.static(path.join(__dirname, "public")));

// SOCKET.IO
const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"],
    credentials: true
  }
});
app.set("io", io);

// Simple middleware to expose io on req (conveniencia)
app.use((req, res, next) => {
  req.io = io;
  next();
});

// ================= ADMIN AUTH (HEADER) - opcional, proteje rutas /api/admin si quieres
function ensureAdminKey(req, res, next) {
  // Allow bypass if ADMIN_API_KEY is not set (development)
  if (!process.env.ADMIN_API_KEY) return next();
  const key = req.headers["x-admin-key"] || req.headers["x-admin_key"] || req.headers["admin-key"];
  if (!key || key !== process.env.ADMIN_API_KEY) {
    return res.status(403).json({ msg: "Admin key inválida" });
  }
  return next();
}

// =========== ROUTES ===========
try {
  // si tus rutas admin internamente ya validan adminKey, puedes quitar ensureAdminKey
  const adminRoutes = require("./routes/admin.routes");
  // montamos con el middleware que exige la clave (si está configurada)
  app.use("/api/admin", ensureAdminKey, adminRoutes);
  console.log("Rutas /api/admin cargadas correctamente.");
} catch (err) {
  console.error("Error cargando rutas /api/admin:", err && err.message ? err.message : err);
}

// Endpoint root (panel admin)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// Health / debug
app.get("/healthz", (req, res) => {
  res.json({
    ok: true,
    env: process.env.NODE_ENV || "development",
    dbReadyState: mongoose.connection.readyState,
    resendConfigured: !!process.env.RESEND_API_KEY,
    adminApiKeyConfigured: !!process.env.ADMIN_API_KEY
  });
});

// Basic API 404 catch for /api paths not matched
app.use("/api", (req, res, next) => {
  // if request made to /api and not matched above
  res.status(404).json({ ok: false, msg: "API endpoint not found" });
});

// Error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error (admin):", err);
  res.status(err.status || 500).json({
    ok: false,
    msg: "Error servidor",
    detail: process.env.NODE_ENV === "development" ? (err.message || String(err)) : undefined
  });
});

// =========== START SERVER ===========
const PORT = Number(process.env.ADMIN_PORT || process.env.PORT || 4000);
server.listen(PORT, "0.0.0.0", () => {
  console.log(`SERVIDOR ADMIN ACTIVO PUERTO ${PORT}`);
  console.log("ENV:");
  console.log("  NODE_ENV:", process.env.NODE_ENV || "development");
  console.log("  RESEND_API_KEY:", !!process.env.RESEND_API_KEY);
  console.log("  ADMIN_API_KEY:", !!process.env.ADMIN_API_KEY);
  console.log("  CLIENT_ORIGIN:", CLIENT_ORIGIN);
});

// Graceful shutdown
let shuttingDown = false;
const gracefulShutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`📴 ${signal} recibido. Cerrando servidor admin...`);

  const force = setTimeout(() => {
    console.warn("Forzando cierre admin...");
    process.exit(1);
  }, 30_000);
  force.unref();

  try {
    // close http server
    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) {
          console.error("Error cerrando HTTP server:", err);
          return reject(err);
        }
        console.log("HTTP server admin cerrado.");
        resolve();
      });
    });

    // close socket.io
    try {
      io.emit("server:shutdown");
      await new Promise((resolve) => io.close(resolve));
      console.log("Socket.io cerrado.");
    } catch (e) {
      console.warn("Error cerrando socket.io:", e);
    }

    // disconnect mongoose
    try {
      await mongoose.disconnect();
      console.log("Mongo desconectado.");
    } catch (e) {
      console.warn("Error desconectando Mongo:", e);
    }

    clearTimeout(force);
    process.exit(0);
  } catch (err) {
    console.error("Error durante shutdown admin:", err);
    clearTimeout(force);
    process.exit(1);
  }
};

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("unhandledRejection", (r) => {
  console.error("UnhandledRejection (admin):", r);
  // no forzamos exit inmediato; intentamos graceful shutdown
  gracefulShutdown("unhandledRejection");
});
process.on("uncaughtException", (e) => {
  console.error("UncaughtException (admin):", e);
  gracefulShutdown("uncaughtException");
});
