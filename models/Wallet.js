const mongoose = require("mongoose");

const walletSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

  balanceOwn: { type: Number, default: 0 },
  balance: { type: Number, default: 0 },
  equity: { type: Number, default: 0 },

  credit: { type: Number, default: 0 },
  marginUsed: { type: Number, default: 0 },
  freeMargin: { type: Number, default: 0 },
  marginLevel: { type: Number, default: 0 },

  leverageFactor: { type: Number, default: 1 },
  currency: { type: String, default: "USD" }

}, {
  timestamps: true // Esto automáticamente crea createdAt y updatedAt
});

module.exports = mongoose.model("Wallet", walletSchema);
