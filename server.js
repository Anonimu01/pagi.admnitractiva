require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const rateLimit = require("express-rate-limit");
const { Server } = require("socket.io");
const path = require("path");

// añadimos mongoose aquí para escuchar la conexión y loguearla
const mongoose = require("mongoose");

const connectDB = require("./config/db");

const app = express();
const server = http.createServer(app);

/* ================= CONNECT DB ================= */
connectDB()
  .then(() => {
    // si connectDB resolvió, igual escuchamos el estado de mongoose
    mongoose.connection.on("connected", () => {
      console.log("✅ Mongo conectado a DB:", mongoose.connection.name, "host:", mongoose.connection.host);
    });
    mongoose.connection.on("error", (err) => {
      console.error("❌ Mongo connection error:", err);
    });
  })
  .catch((err) => {
    console.error("Error iniciando DB (connectDB rejected):", err);
  });

/* =========== MIDDLEWARES =========== */
app.use(cors({ origin: "*" }));

app.use(rateLimit({
  windowMs: 60000,
  max: 120
}));

// body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* STATIC FILES (admin frontend) */
app.use(express.static(path.join(__dirname, "public")));

/* SOCKET */
const io = new Server(server, { cors: { origin: "*" } });
app.set("io", io);

/* ROUTES */
/* Log para saber si cargó rutas correctamente */
try {
  const adminRoutes = require("./routes/admin.routes");
  app.use("/api/admin", adminRoutes);
  console.log("Rutas /api/admin cargadas correctamente.");
} catch (err) {
  console.log("Error cargando rutas /api/admin:", err && err.message ? err.message : err);
}

/* ROOT PAGE - servir panel admin */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

/* RUTA DE SALUD/DEBUG (útil para probar desde browser/curl) */
app.get("/healthz", (req, res) => {
  res.json({ ok: true, env: process.env.NODE_ENV || "development", db: mongoose.connection.readyState });
});

/* Manejador de errores básico */
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ msg: "Error servidor", error: err?.message || String(err) });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, "0.0.0.0", () => {
  console.log("SERVIDOR ADMIN ACTIVO PUERTO", PORT);
});
