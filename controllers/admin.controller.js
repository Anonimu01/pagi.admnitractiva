// controllers/admin.controller.js
import Wallet from "../models/wallet.model.js";
import User from "../models/user.model.js";

/**
 * NOTE:
 * These endpoints are protected by a simple admin key middleware (x-admin-key).
 * You can later expand to role-based checks (user.isAdmin).
 */

/**
 * Body: { userId, credit }
 */
export const setCredit = async (req, res) => {
  try {
    const { userId, credit } = req.body;
    if (!userId || typeof credit === "undefined") return res.status(400).json({ msg: "userId y credit son requeridos" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ msg: "Usuario no encontrado" });

    let wallet = await Wallet.findOne({ user: userId });
    if (!wallet) {
      wallet = await Wallet.create({ user: userId, balanceOwn: 0, credit: Number(credit || 0), marginUsed: 0, leverageFactor: 1 });
    } else {
      wallet.credit = Number(credit || 0);
      await wallet.save();
    }

    return res.json({ msg: "Crédito asignado", wallet });
  } catch (err) {
    console.error("setCredit error:", err);
    return res.status(500).json({ msg: "Error asignando crédito" });
  }
};

/**
 * Body: { userId, balance }
 * Nota: ajusta balanceOwn directamente (útil para depositos manuales desde admin)
 */
export const setBalance = async (req, res) => {
  try {
    const { userId, balance } = req.body;
    if (!userId || typeof balance === "undefined") return res.status(400).json({ msg: "userId y balance son requeridos" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ msg: "Usuario no encontrado" });

    let wallet = await Wallet.findOne({ user: userId });
    if (!wallet) {
      wallet = await Wallet.create({ user: userId, balanceOwn: Number(balance || 0), credit: 0, marginUsed: 0, leverageFactor: 1 });
    } else {
      wallet.balanceOwn = Number(balance || 0);
      await wallet.save();
    }

    return res.json({ msg: "Balance actualizado", wallet });
  } catch (err) {
    console.error("setBalance error:", err);
    return res.status(500).json({ msg: "Error actualizando balance" });
  }
};

/**
 * Body: { userId, leverageFactor }
 */
export const setLeverage = async (req, res) => {
  try {
    const { userId, leverageFactor } = req.body;
    if (!userId || typeof leverageFactor === "undefined") return res.status(400).json({ msg: "userId y leverageFactor son requeridos" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ msg: "Usuario no encontrado" });

    let wallet = await Wallet.findOne({ user: userId });
    if (!wallet) {
      wallet = await Wallet.create({ user: userId, balanceOwn: 0, credit: 0, marginUsed: 0, leverageFactor: Number(leverageFactor || 1) });
    } else {
      wallet.leverageFactor = Number(leverageFactor || 1);
      await wallet.save();
    }

    return res.json({ msg: "Apalancamiento actualizado", wallet });
  } catch (err) {
    console.error("setLeverage error:", err);
    return res.status(500).json({ msg: "Error actualizando apalancamiento" });
  }
};
