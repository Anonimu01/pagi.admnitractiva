const router = require("express").Router();
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Withdraw = require("../models/Withdraw");

// ================= LOGIN ADMIN =================
router.post("/login", async (req,res)=>{
  const {email,password}=req.body;

  if(email!==process.env.ADMIN_EMAIL || password!==process.env.ADMIN_PASS){
    return res.status(401).json({msg:"Credenciales inválidas"});
  }

  const token = jwt.sign({admin:true}, process.env.JWT_SECRET,{expiresIn:"8h"});
  res.json({token});
});

// ================= GET USERS =================
router.get("/users", async(req,res)=>{
  const users = await User.find().select("-password");
  res.json(users);
});

// ================= UPDATE BALANCE =================
router.post("/update-balance", async(req,res)=>{
  const {userId,balance}=req.body;
  await User.findByIdAndUpdate(userId,{balance});
  res.json({msg:"Saldo actualizado"});
});

// ================= UPDATE LEVERAGE =================
router.put("/users/leverage/:id", async(req,res)=>{
  await User.findByIdAndUpdate(req.params.id,{
    leverage:req.body.leverage
  });
  res.json({msg:"Leverage actualizado"});
});

// ================= GET WITHDRAWS =================
router.get("/withdraws/:userId", async(req,res)=>{
  const data = await Withdraw.find({userId,status:"pending"});
  res.json(data);
});

// ================= APPROVE =================
router.post("/withdraw/approve", async(req,res)=>{
  await Withdraw.findByIdAndUpdate(req.body.id,{status:"approved"});
  res.json({msg:"Retiro aprobado"});
});

// ================= REJECT =================
router.post("/withdraw/reject", async(req,res)=>{
  await Withdraw.findByIdAndUpdate(req.body.id,{status:"rejected"});
  res.json({msg:"Retiro rechazado"});
});

module.exports = router;
