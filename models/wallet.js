const mongoose = require("mongoose");

const walletSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

  balanceOwn: { type: Number, default: 0 },
  balance: { type: Number, default: 0 },

  credit: { type: Number, default: 0 },
  marginUsed: { type: Number, default: 0 },

  leverageFactor: { type: Number, default: 1 },

  currency: { type: String, default: "USD" },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Wallet", walletSchema);
