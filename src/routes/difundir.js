// src/routes/difundir.js
// POST /api/difundir/send — envía mensajes seleccionados a comunidades (SSE)
// GET  /api/difundir/preview — preview de lo que se va a enviar

const express = require("express");
const db = require("../services/db");
const wpp = require("../services/wpp");
const { requireAuth } = require("./auth");
const router = express.Router();
router.use(requireAuth);

// POST /api/difundir/send
// Body: { inbox_ids: [...], comunidad_ids: [...] }
// Respuesta: SSE con progreso en tiempo real
router.post("/send", async (req, res, next) => {
  const { inbox_ids, comunidad_ids } = req.body;

  if (!inbox_ids?.length || !comunidad_ids?.length) {
    return res.status(400).json({ error: "Debes seleccionar mensajes y comunidades" });
  }

  const waStatus = wpp.getStatus();
  if (!waStatus.isConnected) {
    return res.status(400).json({ error: "WhatsApp no está conectado" });
  }

  // Obtener wa_group_id de las comunidades seleccionadas
  const { rows: comunidades } = await db.query(
    "SELECT wa_group_id FROM comunidades WHERE id = ANY($1) AND active = true",
    [comunidad_ids]
  );
  const communityWaIds = comunidades.map(c => c.wa_group_id);

  if (!communityWaIds.length) {
    return res.status(400).json({ error: "No hay comunidades activas seleccionadas" });
  }

  // SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const total = inbox_ids.length * communityWaIds.length;
  res.write(`event: start\ndata: ${JSON.stringify({ total })}\n\n`);

  let sent = 0;
  let failed = 0;

  try {
    const generator = wpp.sendToCommunities(inbox_ids, communityWaIds);
    for await (const result of generator) {
      if (result.success) {
        sent++;
        res.write(`event: sent\ndata: ${JSON.stringify({ sent, failed, total, name: result.name })}\n\n`);
      } else {
        failed++;
        res.write(`event: failed\ndata: ${JSON.stringify({ sent, failed, total, error: result.error })}\n\n`);
      }
    }

    // Registrar en historial
    await db.query(
      "INSERT INTO difusiones (inbox_ids, comunidad_ids, total_msgs, sent_msgs) VALUES ($1, $2, $3, $4)",
      [inbox_ids, comunidad_ids, total, sent]
    );

    res.write(`event: complete\ndata: ${JSON.stringify({ sent, failed, total })}\n\n`);
  } catch (e) {
    res.write(`event: error\ndata: ${JSON.stringify({ message: e.message })}\n\n`);
  }
  res.end();
});

module.exports = router;
