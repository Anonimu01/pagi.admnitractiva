// routes/wallet.routes.js
import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import { getMyWallet, revokeLeverage } from "../controllers/wallet.controller.js";
import { setCredit, setBalance, setLeverage } from "../controllers/admin.controller.js";

const router = express.Router();

/**
 * Helpers
 * - Admin routes are protected via header 'x-admin-key' === process.env.ADMIN_API_KEY
 */
function adminKeyMiddleware(req, res, next) {
  const k = req.headers["x-admin-key"] || req.headers["x-admin_key"] || req.headers["admin-key"];
  if (!process.env.ADMIN_API_KEY) {
    return res.status(500).json({ msg: "ADMIN_API_KEY not configured on server" });
  }
  if (!k || k !== process.env.ADMIN_API_KEY) {
    return res.status(403).json({ msg: "Admin key inválida" });
  }
  return next();
}

// ==========================
// USER ROUTES (PROTECTED)
// ==========================
router.get("/me", authMiddleware, getMyWallet);
router.post("/revoke-leverage", authMiddleware, revokeLeverage);

// ==========================
// ADMIN ROUTES (require x-admin-key header)
// ==========================
// POST /api/wallet/admin/set-credit { userId, credit }
router.post("/admin/set-credit", adminKeyMiddleware, async (req, res, next) => {
  try { await setCredit(req, res); } catch (e) { next(e); }
});
// POST /api/wallet/admin/set-balance { userId, balance }
router.post("/admin/set-balance", adminKeyMiddleware, async (req, res, next) => {
  try { await setBalance(req, res); } catch (e) { next(e); }
});
// POST /api/wallet/admin/set-leverage { userId, leverageFactor }
router.post("/admin/set-leverage", adminKeyMiddleware, async (req, res, next) => {
  try { await setLeverage(req, res); } catch (e) { next(e); }
});

export default router;
