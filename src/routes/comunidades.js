// src/routes/comunidades.js
const express = require("express");
const db = require("../services/db");
const { requireAuth } = require("./auth");
const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    const { rows } = await db.query("SELECT * FROM comunidades WHERE active=true ORDER BY name");
    res.json({ comunidades: rows });
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    const { name, wa_group_id } = req.body;
    if (!name || !wa_group_id) return res.status(400).json({ error: "Nombre e ID requeridos" });
    const { rows: [c] } = await db.query(
      "INSERT INTO comunidades (name, wa_group_id) VALUES ($1,$2) RETURNING *",
      [name, wa_group_id]
    );
    res.status(201).json(c);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Ya existe esa comunidad" });
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await db.query("UPDATE comunidades SET active=false WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
