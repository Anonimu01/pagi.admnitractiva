const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI no definida en .env");
    }

    const conn = await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log("MongoDB conectado:", conn.connection.host);

  } catch (error) {
    console.error("Error conexión MongoDB:", error.message);
    process.exit(1);
  }
};

// reconexión automática
mongoose.connection.on("disconnected", () => {
  console.log("MongoDB desconectado. Reintentando...");
  connectDB();
});

module.exports = connectDB;
