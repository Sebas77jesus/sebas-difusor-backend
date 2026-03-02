// src/services/ai.js
// Usa Claude para extraer info de cualquier caption de bodega
// y generar el caption en formato SebasShoes

const Anthropic = require("@anthropic-ai/sdk");
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Eres un asistente que extrae información de mensajes de bodegas de zapatillas colombianas.

Hay varios formatos de bodegas:

FORMATO DINASTÍA:
  NOMBRE CABALLERO/DAMA
  CUADRE 90
  PUBLICÓ 100
  → precio_bodega = PUBLICÓ (no CUADRE). Sin tallas, sin código.

FORMATO D'MERO / FYM:
  NOMBRE
  PRECIO: $80.000
  CODIGO: 2944
  TALLAS: ( 40 al 44 euro) o (40 41 42 euro)
  DISPONIBLE POR CAJA $70.000

FORMATO SEBAS / ESTÁNDAR:
  NOMBRE 💣🔥
  Numeración Hombre 🧔 (40 AL 44 EUR)
  Precio: $ 95.000
  DISPONIBLE POR CAJA 📦 $ 85.000

REGLAS:
1. precio_bodega en números sin puntos ni signos. Ej: "$ 80.000" → 80000
2. precio_caja igual, sin puntos. 
3. tallas: si dice "36 al 44" expande a ["36","37","38","39","40","41","42","43","44"]. Si dice "40 41 42" solo esas. Si dice "SOLO 40-41-42" solo esas.
4. genero: Caballero/Hombre → "Hombre". Dama/Mujer → "Dama". Ambos o no especifica → "Hombre Y Dama".
5. nombre: en MAYÚSCULAS sin emojis, limpio.
6. es_promo: true si dice PROMO, promoción, NO CAMBIO, NO GARANTÍA.
7. Si no hay tallas en el mensaje, tallas = [] (vacío).

Responde SOLO con JSON válido, sin markdown:
{
  "nombre": "NOMBRE LIMPIO EN MAYÚSCULAS",
  "genero": "Hombre" | "Dama" | "Hombre Y Dama",
  "tallas": ["40","41","42"],
  "precio_bodega": 80000,
  "precio_caja": 70000,
  "tiene_caja": true,
  "es_promo": false,
  "codigo": null
}`;

/**
 * Procesa el caption de una bodega y retorna los datos estructurados
 * + el caption final en formato SebasShoes
 */
async function processCaption(captionRaw, priceAdjust = 5000) {
  if (!captionRaw || !captionRaw.trim()) {
    return {
      nombre: "PRODUCTO SIN DESCRIPCIÓN",
      genero: "Hombre Y Dama",
      tallas: [],
      precio_bodega: 0,
      precio_caja: null,
      tiene_caja: false,
      es_promo: false,
      caption_final: "",
    };
  }

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001", // Haiku: rápido y barato para procesar en masa
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: captionRaw }],
  });

  const text = response.content[0]?.text || "{}";
  const clean = text.replace(/```json|```/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch {
    parsed = { nombre: captionRaw.split("\n")[0].toUpperCase(), tallas: [], precio_bodega: 0 };
  }

  // Construir caption final en formato SebasShoes
  const caption_final = buildSebasCaption(parsed, priceAdjust);

  return { ...parsed, caption_final };
}

/**
 * Procesa múltiples captions en paralelo (hasta 10 a la vez)
 */
async function processBatch(items) {
  // Lotes de 10 para no saturar la API
  const results = [];
  for (let i = 0; i < items.length; i += 10) {
    const batch = items.slice(i, i + 10);
    const batchResults = await Promise.all(
      batch.map(item => processCaption(item.caption_raw, item.price_adjust || 5000))
    );
    results.push(...batchResults);
  }
  return results;
}

/**
 * Construye el caption en formato SebasShoes
 */
function buildSebasCaption(data, priceAdjust = 5000) {
  const nombre = data.nombre || "PRODUCTO";
  const genero = data.genero || "Hombre Y Dama";
  const tallas = data.tallas || [];
  const precioBodega = data.precio_bodega || 0;
  const precioCaja = data.precio_caja || 0;

  const precioFinal = precioBodega + priceAdjust;
  const cajafinal = precioCaja > 0 ? precioCaja + priceAdjust : 0;

  const genderIcon = genero === "Hombre" ? "🧔" : genero === "Dama" ? "👱‍♀️" : "🧔 👱‍♀️";
  const fmt = (n) => `$ ${Number(n).toLocaleString("es-CO")}`;

  // Construir rango de tallas
  let tallaStr = "";
  if (tallas.length === 0) {
    tallaStr = "CONSULTAR TALLAS";
  } else if (tallas.length === 1) {
    tallaStr = `SOLO ${tallas[0]} EUR`;
  } else {
    const nums = tallas.map(Number).sort((a, b) => a - b);
    const min = nums[0];
    const max = nums[nums.length - 1];
    // Si es rango continuo: "36 AL 44"
    const isContinuous = nums.every((v, i) => i === 0 || v === nums[i - 1] + 1);
    tallaStr = isContinuous ? `${min} AL ${max} EUR` : tallas.join("-") + " EUR";
  }

  let msg = "";

  if (data.es_promo) {
    msg += `🚨 *PROMO PROMO PROMO* 🚨\n*SEBAS SHOES* 👟\n⚠️ *NO CAMBIO - NO GARANTÍA*\n\n`;
  }

  msg += `*${nombre}* 💣🔥\n\n`;
  msg += `Numeración ${genero} ${genderIcon} *(${tallaStr})*\n\n`;
  msg += `*Precio:  ${fmt(precioFinal)}*`;

  if (data.tiene_caja && cajafinal > 0) {
    msg += `\n\n*DISPONIBLE POR CAJA* 📦 ${fmt(cajafinal)}`;
  }

  return msg;
}

module.exports = { processCaption, processBatch, buildSebasCaption };
