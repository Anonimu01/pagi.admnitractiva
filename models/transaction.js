const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  userId: String,

  type: String, // deposit | withdrawal

  amount: Number,

  balanceBefore: Number,
  balanceAfter: Number,

  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Transaction", transactionSchema);
