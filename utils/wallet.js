const Wallet = require("../models/Wallet");

async function getWalletDocForUser(userId) {
  let wallet = await Wallet.findOne({ user: userId }).exec();
  if (!wallet) {
    wallet = await Wallet.create({ user: userId });
  }
  return wallet;
}

module.exports = { getWalletDocForUser };
