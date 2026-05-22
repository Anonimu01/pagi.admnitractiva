const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  userId: { type: String }, // opcional, por compatibilidad

  type: { 
    type: String, 
    enum: ["deposit", "withdrawal", "adjustment"], 
    required: true 
  },

  amount: { type: Number, required: true },

  balanceBefore: { type: Number, required: true },
  balanceAfter: { type: Number, required: true },

  note: { type: String, default: "" }, // para notas como "Admin deposit" o "Aprobación retiro"
  status: { type: String, enum: ["pending", "completed", "failed"], default: "completed" },
  meta: { type: Object, default: {} }, // para guardar información extra (source, currency, leverage, etc.)

}, {
  timestamps: true // crea createdAt y updatedAt automáticamente
});

module.exports = mongoose.model("Transaction", transactionSchema);
