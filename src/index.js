// src/index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: process.env.FRONTEND_URL || "*", credentials: true }));
app.use(express.json());
app.use("/media", express.static(path.join(__dirname, "../media")));

app.use("/api/auth",        require("./routes/auth"));
app.use("/api/inbox",       require("./routes/inbox"));
app.use("/api/bodegas",     require("./routes/bodegas"));
app.use("/api/comunidades", require("./routes/comunidades"));
app.use("/api/whatsapp",    require("./routes/whatsapp"));
app.use("/api/difundir",    require("./routes/difundir"));

app.get("/api/health", (req, res) => {
  const wpp = require("./services/wpp");
  res.json({ ok: true, whatsapp: wpp.getStatus() });
});

app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(500).json({ error: process.env.NODE_ENV === "production" ? "Error del servidor" : err.message });
});

async function start() {
  const db = require("./services/db");
  await db.query("SELECT 1");
  console.log("✅ BD conectada");

  app.listen(PORT, () => console.log(`🚀 Servidor en http://localhost:${PORT}`));

  const wpp = require("./services/wpp");
  wpp.initialize().catch(e => console.warn("⚠️  WPP no inició automáticamente:", e.message));
}

process.on("SIGTERM", async () => { await require("./services/wpp").close(); process.exit(0); });
process.on("SIGINT",  async () => { await require("./services/wpp").close(); process.exit(0); });

start().catch(e => { console.error(e); process.exit(1); });
