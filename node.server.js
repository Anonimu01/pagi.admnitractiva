require("dotenv").config();
const express=require("express");
const cors=require("cors");
const http=require("http");
const rateLimit=require("express-rate-limit");
const {Server}=require("socket.io");
const connectDB=require("./config/db");


const app=express();
const server=http.createServer(app);


connectDB();


// aceptar cualquier ip
app.use(cors({origin:"*"}));


// anti spam ataques
app.use(rateLimit({
windowMs:1000,
max:40
}));


app.use(express.json());


const io=new Server(server,{cors:{origin:"*"}});
app.set("io",io);


app.use("/api/admin",require("./routes/admin.routes"));


server.listen(4000,"0.0.0.0",()=>{
console.log("ADMIN RUNNING GLOBAL PORT 4000");
});
