const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true
  },
  balance: {
    type: Number,
    default: 0
  },
  leverage: {
    type: Number,
    default: 1
  },
  isOnline: {
    type: Boolean,
    default: false
  },
  lastLogin: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

module.exports = mongoose.model("User", UserSchema);
