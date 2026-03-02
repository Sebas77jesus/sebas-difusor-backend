// src/routes/bodegas.js
const express = require("express");
const db = require("../services/db");
const wpp = require("../services/wpp");
const { requireAuth } = require("./auth");
const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    const { rows } = await db.query("SELECT * FROM bodegas ORDER BY name");
    res.json({ bodegas: rows });
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    const { name, wa_group_id, price_adjust = 5000 } = req.body;
    if (!name || !wa_group_id) return res.status(400).json({ error: "Nombre e ID requeridos" });
    const { rows: [b] } = await db.query(
      "INSERT INTO bodegas (name, wa_group_id, price_adjust) VALUES ($1,$2,$3) RETURNING *",
      [name, wa_group_id, price_adjust]
    );
    await wpp.reloadBodegas();
    res.status(201).json(b);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Ya existe esa bodega" });
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const { name, price_adjust, active } = req.body;
    const { rows: [b] } = await db.query(
      "UPDATE bodegas SET name=COALESCE($1,name), price_adjust=COALESCE($2,price_adjust), active=COALESCE($3,active) WHERE id=$4 RETURNING *",
      [name, price_adjust, active, req.params.id]
    );
    await wpp.reloadBodegas();
    res.json(b);
  } catch (e) { next(e); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await db.query("UPDATE bodegas SET active=false WHERE id=$1", [req.params.id]);
    await wpp.reloadBodegas();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Importar grupos desde WhatsApp
router.post("/sync", async (req, res, next) => {
  try {
    const groups = await wpp.getGroups();
    res.json({ groups });
  } catch (e) { next(e); }
});

module.exports = router;
