// src/routes/whatsapp.js
const express = require("express");
const wpp = require("../services/wpp");
const { requireAuth } = require("./auth");
const router = express.Router();

router.get("/status", (req, res) => res.json(wpp.getStatus()));
router.get("/qr",     requireAuth, (req, res) => {
  const qr = wpp.getQR();
  if (!qr) return res.status(404).json({ error: "Sin QR disponible" });
  res.json({ qr });
});

router.post("/connect",    requireAuth, async (req, res, next) => {
  try { await wpp.initialize(); res.json({ ok: true }); } catch (e) { next(e); }
});
router.post("/disconnect", requireAuth, async (req, res, next) => {
  try { await wpp.logout(); res.json({ ok: true }); } catch (e) { next(e); }
});

// SSE de estado
router.get("/events", requireAuth, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const current = wpp.getStatus();
  res.write(`event: status\ndata: ${JSON.stringify(current)}\n\n`);
  const qr = wpp.getQR();
  if (qr) res.write(`event: qr\ndata: ${JSON.stringify({ qr })}\n\n`);

  const unsub = wpp.onStatusChange(e => {
    if (e.qr) res.write(`event: qr\ndata: ${JSON.stringify({ qr: e.qr })}\n\n`);
    res.write(`event: status\ndata: ${JSON.stringify({ status: e.status, isConnected: e.status === "connected" })}\n\n`);
  });
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => { clearInterval(ping); unsub(); });
});

module.exports = router;
