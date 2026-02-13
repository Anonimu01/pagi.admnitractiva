require("dotenv").config();

const express = require("express");
const cors = require("cors");
const http = require("http");
const rateLimit = require("express-rate-limit");
const { Server } = require("socket.io");
const connectDB = require("./config/db");

const app = express();
const server = http.createServer(app);

// ================= DB =================
connectDB().then(() => {
  console.log("MongoDB conectado");
}).catch(err => {
  console.error("Error MongoDB:", err.message);
});

// ================= CONFIG =================

// aceptar cualquier IP (panel global)
app.use(cors({ origin: "*" }));

// anti ataques / anti spam
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
}));

// parser JSON
app.use(express.json({ limit: "10mb" }));

// ================= SOCKET.IO =================
const io = new Server(server, {
  cors: { origin: "*" }
});
app.set("io", io);

// ================= ROUTES =================
try {
  app.use("/api/admin", require("./routes/admin.routes"));
} catch (err) {
  console.error("Error cargando rutas:", err.message);
}

// ================= HEALTH CHECK =================
app.get("/", (req, res) => {
  res.status(200).send("ADMIN BACKEND ONLINE");
});

// ================= ERROR HANDLER GLOBAL =================
app.use((err, req, res, next) => {
  console.error("ERROR GLOBAL:", err.stack);
  res.status(500).json({ error: "Error interno del servidor" });
});

// ================= PORT =================
const PORT = process.env.PORT || 4000;

server.listen(PORT, "0.0.0.0", () => {
  console.log("=================================");
  console.log("ADMIN SERVER RUNNING");
  console.log("PORT:", PORT);
  console.log("MODE:", process.env.NODE_ENV || "development");
  console.log("=================================");
});
