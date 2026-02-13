const mongoose=require("mongoose");

module.exports=mongoose.model("Withdraw",new mongoose.Schema({
userId:String,
amount:Number,
status:{type:String,default:"pending"}
}));
