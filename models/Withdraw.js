const mongoose = require("mongoose");

const WithdrawSchema = new mongoose.Schema(
{
userId: {
type: mongoose.Schema.Types.ObjectId,
ref: "User",
required: true
},

amount: {
type: Number,
required: true
},

wallet: {
type: String,
default: ""
},

network: {
type: String,
default: ""
},

method: {
type: String,
default: "crypto"
},

status: {
type: String,
enum: ["pending", "approved", "rejected"],
default: "pending"
},

adminNote: {
type: String,
default: ""
}

},
{
timestamps: true
});

module.exports = mongoose.model("Withdraw", WithdrawSchema);
