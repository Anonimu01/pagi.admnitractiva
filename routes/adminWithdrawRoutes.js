const express = require("express");
const router = express.Router();

const Withdraw = require("../models/Withdraw");
const User = require("../models/User");

const authAdmin = require("../middleware/authAdmin");

/* =========================================================
GET ALL WITHDRAWS (ADMIN VIEW)
========================================================= */
router.get("/withdraws", authAdmin, async (req, res) => {
  try {
    const withdraws = await Withdraw.find({})
      .sort({ createdAt: -1 })
      .lean();

    const result = withdraws.map((w) => ({
      ...w,
      proofUrl: w.proofUrl || null,
      amount: w.amount || 0,
      status: w.status || "pending",
      userId: w.userId,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
    }));

    return res.json({ ok: true, count: result.length, withdraws: result });
  } catch (err) {
    console.error("GET /withdraws error:", err);
    return res.status(500).json({ ok: false, msg: "Error obteniendo retiros", error: err?.message || String(err) });
  }
});

/* =========================================================
GET USER WITHDRAWS
========================================================= */
router.get("/withdraws/:id", authAdmin, async (req, res) => {
  try {
    const withdraws = await Withdraw.find({ userId: req.params.id })
      .sort({ createdAt: -1 })
      .lean();

    const result = withdraws.map((w) => ({
      ...w,
      proofUrl: w.proofUrl || null,
      amount: w.amount || 0,
      status: w.status || "pending",
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
    }));

    return res.json({ ok: true, count: result.length, withdraws: result });
  } catch (err) {
    console.error(`GET /withdraws/${req.params.id} error:`, err);
    return res.status(500).json({ ok: false, msg: "Error loading withdraws", error: err?.message || String(err) });
  }
});

/* =========================================================
APPROVE WITHDRAW
========================================================= */
router.post("/withdraw/approve", authAdmin, async (req, res) => {
  try {
    const { id } = req.body;

    const withdraw = await Withdraw.findById(id);

    if (!withdraw) {
      return res.status(404).json({ msg: "Withdraw not found" });
    }

    if (withdraw.status !== "pending") {
      return res.status(400).json({ msg: "Withdraw already processed" });
    }

    withdraw.status = "approved";
    await withdraw.save();

    return res.json({ success: true, msg: "Withdraw approved" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ msg: "Error approving withdraw" });
  }
});

/* =========================================================
REJECT WITHDRAW
========================================================= */
router.post("/withdraw/reject", authAdmin, async (req, res) => {
  try {
    const { id } = req.body;

    const withdraw = await Withdraw.findById(id);

    if (!withdraw) {
      return res.status(404).json({ msg: "Withdraw not found" });
    }

    if (withdraw.status !== "pending") {
      return res.status(400).json({ msg: "Withdraw already processed" });
    }

    withdraw.status = "rejected";
    await withdraw.save();

    return res.json({ success: true, msg: "Withdraw rejected" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ msg: "Error rejecting withdraw" });
  }
});

module.exports = router;
