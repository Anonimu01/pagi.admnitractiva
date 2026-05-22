// src/utils/transactions.js

const Transaction = require("../models/Transaction"); // Asegúrate de tener el modelo

async function recordTransaction({ user, type, amount, status, note, balanceBefore, balanceAfter, meta, source }) {
  // Stub simple: guarda en MongoDB o devuelve objeto simulado
  const tx = {
    _id: "tx_" + Date.now(),
    userId: user._id,
    type,
    amount,
    status,
    note,
    balanceBefore,
    balanceAfter,
    meta,
    source,
    createdAt: new Date(),
  };

  try {
    if (Transaction) {
      const doc = new Transaction(tx);
      await doc.save();
    }
  } catch {}

  return tx;
}

async function loadTransactionsForUser(userId, limit = 100) {
  // Stub: devuelve array vacío
  return [];
}

module.exports = {
  recordTransaction,
  loadTransactionsForUser,
};
