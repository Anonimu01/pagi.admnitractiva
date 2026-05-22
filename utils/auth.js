// src/utils/auth.js

const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dummysecret";

// Middleware de ejemplo para admin
function ensureAdminAuth(req, res, next) {
  // Por ahora permite todo
  next();
}

// Función para firmar token de admin
function signAdminToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "8h" });
}

module.exports = {
  ensureAdminAuth,
  signAdminToken,
};
