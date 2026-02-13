require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const rateLimit = require("express-rate-limit");
const { Server } = require("socket.io");
const path = require("path");
const connectDB = require("./config/db");

const app = express();
const server = http.createServer(app);

connectDB();

app.use(cors({ origin:"*" }));

app.use(rateLimit({
windowMs:60000,
max:120
}));

app.use(express.json());

/* STATIC FILES */
app.use(express.static("public"));

/* SOCKET */
const io = new Server(server,{cors:{origin:"*"}});
app.set("io",io);

/* ROUTES */
try{
app.use("/api/admin",require("./routes/admin.routes"));
}catch(err){
console.log("Error cargando rutas:",err.message);
}

/* ROOT PAGE */
app.get("/",(req,res)=>{
res.sendFile(path.join(__dirname,"public","admin.html"));
});

const PORT = process.env.PORT || 4000;
server.listen(PORT,"0.0.0.0",()=>{
console.log("SERVIDOR ADMIN ACTIVO PUERTO",PORT);
});
