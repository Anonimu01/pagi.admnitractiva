// src/utils/users.js

const User = require("../models/User"); // Asegúrate de tener modelo
const Wallet = require("../models/Wallet"); // Asegúrate de tener modelo

async function getWalletDocForUser(userId) {
  // Stub simple: crea wallet si no existe
  return {
    _id: "wallet_" + userId,
    balanceOwn: 0,
    balance: 0,
    equity: 0,
    marginUsed: 0,
    freeMargin: 0,
    marginLevel: 0,
    leverageFactor: 1,
    currency: "USD",
    updatedAt: new Date(),
    save: async function () {},
  };
}

async function buildAccountForUser(user) {
  const wallet = await getWalletDocForUser(user._id);
  return {
    account: {
      id: user._id,
      balance: wallet.balanceOwn,
      leverage: wallet.leverageFactor,
    },
    wallet,
  };
}

function emitStateUpdates(userId, account, extra = null, tx = null) {
  // Stub: no hace nada
  console.log(`Emit state update for user ${userId}`);
}

module.exports = {
  getWalletDocForUser,
  buildAccountForUser,
  emitStateUpdates,
};
