// src/models/setup.js — crea todas las tablas
// Ejecutar: npm run db:setup
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

async function setup() {
  console.log("🔄 Creando tablas...");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name          VARCHAR(100) NOT NULL,
      email         VARCHAR(150) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );

    -- Grupos de bodegas que vigilamos
    CREATE TABLE IF NOT EXISTS bodegas (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name          VARCHAR(200) NOT NULL,
      wa_group_id   VARCHAR(200) UNIQUE NOT NULL,
      price_adjust  INTEGER NOT NULL DEFAULT 5000,
      active        BOOLEAN DEFAULT true,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );

    -- Comunidades propias a las que difundimos
    CREATE TABLE IF NOT EXISTS comunidades (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name          VARCHAR(200) NOT NULL,
      wa_group_id   VARCHAR(200) UNIQUE NOT NULL,
      active        BOOLEAN DEFAULT true,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );

    -- Mensajes recibidos de bodegas (la bandeja de entrada)
    CREATE TABLE IF NOT EXISTS inbox (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bodega_id       UUID REFERENCES bodegas(id),
      bodega_name     VARCHAR(200),
      wa_message_id   VARCHAR(200) UNIQUE,
      wa_group_id     VARCHAR(200),

      -- Texto original de la bodega
      caption_raw     TEXT,

      -- Lo que extrajo la IA
      nombre          VARCHAR(300),
      genero          VARCHAR(30) DEFAULT 'Hombre Y Dama',
      tallas          TEXT[],
      precio_bodega   INTEGER,
      precio_caja     INTEGER,
      tiene_caja      BOOLEAN DEFAULT false,
      es_promo        BOOLEAN DEFAULT false,

      -- Caption final en formato SebasShoes (editable)
      caption_final   TEXT,

      -- Ajuste de precio aplicado
      price_adjust    INTEGER DEFAULT 5000,

      -- Ruta local de la imagen guardada
      media_path      TEXT,
      media_mimetype  VARCHAR(50) DEFAULT 'image/jpeg',

      status          VARCHAR(20) DEFAULT 'pending',
        -- pending | ready | sent | skipped

      received_at     TIMESTAMPTZ DEFAULT NOW(),
      sent_at         TIMESTAMPTZ
    );

    -- Historial de difusiones
    CREATE TABLE IF NOT EXISTS difusiones (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      inbox_ids       UUID[],
      comunidad_ids   UUID[],
      total_msgs      INTEGER DEFAULT 0,
      sent_msgs       INTEGER DEFAULT 0,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_inbox_status   ON inbox(status);
    CREATE INDEX IF NOT EXISTS idx_inbox_received ON inbox(received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_inbox_bodega   ON inbox(bodega_id);
  `);

  // Usuario admin por defecto
  const bcrypt = require("bcryptjs");
  const hash = await bcrypt.hash("Sebas2024!", 12);
  await pool.query(`
    INSERT INTO users (name, email, password_hash)
    VALUES ('Sebas Admin', 'admin@sebas.com', $1)
    ON CONFLICT (email) DO NOTHING
  `, [hash]);

  console.log("✅ Tablas creadas.");
  console.log("👤 Usuario: admin@sebas.com / Sebas2024!");
  console.log("⚠️  Cambia la contraseña después del primer login.");
  process.exit(0);
}

setup().catch(e => { console.error(e); process.exit(1); });
