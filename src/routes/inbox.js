// src/routes/inbox.js
// GET  /api/inbox           — listar mensajes pendientes
// GET  /api/inbox/stream    — SSE: nuevos mensajes en tiempo real
// PUT  /api/inbox/:id       — editar caption_final, tallas, precio
// POST /api/inbox/:id/skip  — marcar como omitido
// POST /api/inbox/reprocess — reprocesar con IA (todos los pending)

const express = require("express");
const db = require("../services/db");
const ai = require("../services/ai");
const { requireAuth } = require("./auth");
const router = express.Router();
router.use(requireAuth);

// GET /api/inbox
router.get("/", async (req, res, next) => {
  try {
    const { status = "ready", limit = 100 } = req.query;
    const { rows } = await db.query(`
      SELECT * FROM inbox
      WHERE ($1 = 'all' OR status = $1)
      ORDER BY received_at DESC
      LIMIT $2
    `, [status, parseInt(limit)]);
    res.json({ messages: rows, total: rows.length });
  } catch (e) { next(e); }
});

// GET /api/inbox/stats
router.get("/stats", async (req, res, next) => {
  try {
    const { rows: [stats] } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'ready')   AS pendientes,
        COUNT(*) FILTER (WHERE status = 'sent')    AS enviados,
        COUNT(*) FILTER (WHERE status = 'skipped') AS omitidos,
        COUNT(*) FILTER (WHERE received_at > NOW() - INTERVAL '24h') AS hoy
      FROM inbox
    `);
    res.json(stats);
  } catch (e) { next(e); }
});

// GET /api/inbox/stream — SSE para notificaciones en tiempo real
router.get("/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.write(": connected\n\n");

  const wpp = require("../services/wpp");
  const unsub = wpp.onStatusChange((event) => {
    if (event.status === "new_message") {
      res.write(`event: new_message\ndata: ${JSON.stringify(event)}\n\n`);
    }
    res.write(`event: wpp_status\ndata: ${JSON.stringify({ status: event.status })}\n\n`);
  });

  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => { clearInterval(ping); unsub(); });
});

// PUT /api/inbox/:id — editar antes de difundir
router.put("/:id", async (req, res, next) => {
  try {
    const { caption_final, nombre, genero, tallas, precio_bodega, precio_caja, tiene_caja, es_promo, price_adjust } = req.body;

    // Si cambian datos, reconstruir caption_final automáticamente
    let finalCaption = caption_final;
    if (!caption_final && nombre) {
      finalCaption = ai.buildSebasCaption(
        { nombre, genero, tallas, precio_bodega, precio_caja, tiene_caja, es_promo },
        price_adjust || 5000
      );
    }

    await db.query(`
      UPDATE inbox SET
        caption_final = COALESCE($1, caption_final),
        nombre        = COALESCE($2, nombre),
        genero        = COALESCE($3, genero),
        tallas        = COALESCE($4, tallas),
        precio_bodega = COALESCE($5, precio_bodega),
        precio_caja   = COALESCE($6, precio_caja),
        tiene_caja    = COALESCE($7, tiene_caja),
        es_promo      = COALESCE($8, es_promo),
        price_adjust  = COALESCE($9, price_adjust)
      WHERE id = $10
    `, [finalCaption, nombre, genero, tallas, precio_bodega, precio_caja, tiene_caja, es_promo, price_adjust, req.params.id]);

    const { rows: [updated] } = await db.query("SELECT * FROM inbox WHERE id = $1", [req.params.id]);
    res.json(updated);
  } catch (e) { next(e); }
});

// POST /api/inbox/:id/skip
router.post("/:id/skip", async (req, res, next) => {
  try {
    await db.query("UPDATE inbox SET status = 'skipped' WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/inbox/reprocess — reprocesa todos los ready con IA
router.post("/reprocess", async (req, res, next) => {
  try {
    const { rows } = await db.query("SELECT * FROM inbox WHERE status = 'ready' ORDER BY received_at DESC LIMIT 50");
    let count = 0;
    for (const msg of rows) {
      if (!msg.caption_raw) continue;
      try {
        const aiData = await ai.processCaption(msg.caption_raw, msg.price_adjust || 5000);
        await db.query(`
          UPDATE inbox SET nombre=$1, genero=$2, tallas=$3, precio_bodega=$4,
          precio_caja=$5, tiene_caja=$6, es_promo=$7, caption_final=$8 WHERE id=$9
        `, [aiData.nombre, aiData.genero, aiData.tallas, aiData.precio_bodega,
            aiData.precio_caja, aiData.tiene_caja, aiData.es_promo, aiData.caption_final, msg.id]);
        count++;
      } catch {}
    }
    res.json({ processed: count });
  } catch (e) { next(e); }
});

module.exports = router;
