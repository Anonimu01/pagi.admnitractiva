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
connectDB();

// ================= CONFIG =================

// aceptar cualquier IP (global admin panel)
app.use(cors({ origin: "*" }));

// anti spam / anti ataques
app.use(
  rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 120, // requests por IP
    message: "Demasiadas peticiones, intenta luego"
  })
);

// parser json
app.use(express.json());

// ================= SOCKET.IO =================
const io = new Server(server, {
  cors: { origin: "*" }
});
app.set("io", io);

// ================= ROUTES =================
app.use("/api/admin", require("./routes/admin.routes"));

// ================= HEALTH CHECK =================
app.get("/", (req, res) => {
  res.send("ADMIN BACKEND ONLINE");
});

// ================= PORT =================
const PORT = process.env.PORT || 4000;

server.listen(PORT, "0.0.0.0", () => {
  console.log("ADMIN RUNNING ON PORT " + PORT);
});
