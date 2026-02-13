const mongoose=require("mongoose");

module.exports=mongoose.model("User",new mongoose.Schema({
email:String,
password:String,
balance:{type:Number,default:0},
leverage:{type:Number,default:1}
}));
