// src/services/wpp.js
// - Escucha grupos de bodegas en segundo plano
// - Guarda cada foto+caption en la BD
// - Puede reenviar fotos a comunidades con caption personalizado

const wppconnect = require("@wppconnect-team/wppconnect");
const path = require("path");
const fs = require("fs");
const db = require("./db");
const ai = require("./ai");

let client = null;
let status = "disconnected"; // disconnected | connecting | qr_ready | connected
let currentQR = null;
let statusListeners = [];

// IDs de grupos bodega que vigilamos (se cargan desde BD)
let watchedGroupIds = new Set();

// Carpeta donde se guardan las imágenes
const MEDIA_DIR = path.join(__dirname, "../../media");
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

function notifyStatus(newStatus, extra = {}) {
  status = newStatus;
  statusListeners.forEach(cb => cb({ status: newStatus, ...extra }));
}

async function loadWatchedGroups() {
  try {
    const { rows } = await db.query("SELECT wa_group_id FROM bodegas WHERE active = true");
    watchedGroupIds = new Set(rows.map(r => r.wa_group_id));
    console.log(`📋 Vigilando ${watchedGroupIds.size} grupos de bodegas`);
  } catch (e) {
    console.error("Error cargando bodegas:", e.message);
  }
}

async function initialize() {
  if (client) return;
  notifyStatus("connecting");

  client = await wppconnect.create({
    session: "sebas-difusor",
    folderNameToken: process.env.WPP_SESSION_FOLDER || "./wpp_sessions",
    headless: true,
    logQR: false,

    catchQR: (base64QR) => {
      currentQR = base64QR;
      notifyStatus("qr_ready", { qr: base64QR });
      console.log("📱 QR generado. Esperando escaneo...");
    },

    statusFind: (sessionStatus) => {
      if (sessionStatus === "isLogged" || sessionStatus === "inChat") {
        currentQR = null;
        notifyStatus("connected");
        loadWatchedGroups();
      } else if (sessionStatus === "notLogged" || sessionStatus === "browserClose") {
        client = null;
        notifyStatus("disconnected");
      }
    },

    puppeteerOptions: {
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--no-zygote", "--disable-gpu"],
      executablePath: process.env.CHROMIUM_PATH || undefined,
    },
    autoClose: 0,
  });

  notifyStatus("connected");
  await loadWatchedGroups();

  // ── ESCUCHA DE MENSAJES ─────────────────────────────────────────────────────
  // Cada vez que llega un mensaje en un grupo de bodega, lo procesamos
  client.onMessage(async (message) => {
    const groupId = message.from || message.chatId;

    // Solo procesar mensajes de grupos de bodegas configurados
    if (!watchedGroupIds.has(groupId)) return;
    // Solo imágenes con caption (o texto solo)
    if (message.type !== "image" && message.type !== "chat") return;
    // Evitar duplicados
    const { rows: existing } = await db.query(
      "SELECT id FROM inbox WHERE wa_message_id = $1",
      [message.id]
    );
    if (existing.length > 0) return;

    console.log(`📩 Nuevo mensaje de bodega: ${groupId} — ${message.caption || message.body || "(sin texto)"}`);

    const captionRaw = message.caption || message.body || "";

    // Obtener info de la bodega
    const { rows: [bodega] } = await db.query(
      "SELECT * FROM bodegas WHERE wa_group_id = $1 AND active = true",
      [groupId]
    );

    // Guardar media si es imagen
    let mediaPath = null;
    if (message.type === "image") {
      try {
        const filename = `${Date.now()}_${message.id.replace(/[^a-z0-9]/gi, "")}.jpg`;
        const filepath = path.join(MEDIA_DIR, filename);
        const buffer = await client.decryptFile(message);
        fs.writeFileSync(filepath, buffer);
        mediaPath = `/media/${filename}`;
      } catch (e) {
        console.error("Error guardando imagen:", e.message);
      }
    }

    // Procesar con IA (asíncrono — no bloquea la recepción)
    let aiData = {};
    try {
      aiData = await ai.processCaption(captionRaw, bodega?.price_adjust || 5000);
    } catch (e) {
      console.error("Error procesando IA:", e.message);
      aiData = { nombre: captionRaw.split("\n")[0].toUpperCase() || "PRODUCTO", tallas: [], precio_bodega: 0, caption_final: captionRaw };
    }

    // Guardar en BD
    await db.query(`
      INSERT INTO inbox (
        bodega_id, bodega_name, wa_message_id, wa_group_id,
        caption_raw, nombre, genero, tallas,
        precio_bodega, precio_caja, tiene_caja, es_promo,
        caption_final, price_adjust, media_path, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'ready')
    `, [
      bodega?.id || null,
      bodega?.name || groupId,
      message.id,
      groupId,
      captionRaw,
      aiData.nombre,
      aiData.genero || "Hombre Y Dama",
      aiData.tallas || [],
      aiData.precio_bodega || 0,
      aiData.precio_caja || null,
      aiData.tiene_caja || false,
      aiData.es_promo || false,
      aiData.caption_final || "",
      bodega?.price_adjust || 5000,
      mediaPath,
    ]);

    // Notificar al frontend via SSE que hay nuevo mensaje
    notifyStatus("new_message", { group: bodega?.name || groupId });
  });
}

// ── REENVÍO A COMUNIDADES ──────────────────────────────────────────────────
// Reenvía la imagen original con el caption de SebasShoes
async function* sendToCommunities(inboxIds, communityWaIds) {
  if (!client || status !== "connected") throw new Error("WhatsApp no conectado");

  const delay = parseInt(process.env.WPP_SEND_DELAY) || 5000;

  for (const inboxId of inboxIds) {
    const { rows: [msg] } = await db.query("SELECT * FROM inbox WHERE id = $1", [inboxId]);
    if (!msg) continue;

    for (const communityId of communityWaIds) {
      try {
        if (msg.media_path) {
          const fullPath = path.join(__dirname, "../../", msg.media_path);
          if (fs.existsSync(fullPath)) {
            await client.sendImage(communityId, fullPath, "producto", msg.caption_final);
          } else {
            await client.sendText(communityId, msg.caption_final);
          }
        } else {
          await client.sendText(communityId, msg.caption_final);
        }

        yield { success: true, inboxId, communityId, name: msg.nombre };
      } catch (e) {
        yield { success: false, inboxId, communityId, error: e.message };
      }

      await new Promise(r => setTimeout(r, delay));
    }

    // Marcar como enviado
    await db.query("UPDATE inbox SET status = 'sent', sent_at = NOW() WHERE id = $1", [inboxId]);
  }
}

async function close() {
  if (client) { await client.close(); client = null; notifyStatus("disconnected"); }
}

async function logout() {
  if (client) { await client.logout(); client = null; currentQR = null; notifyStatus("disconnected"); }
}

function reloadBodegas() { return loadWatchedGroups(); }

module.exports = {
  initialize, close, logout, reloadBodegas, sendToCommunities,
  getStatus: () => ({ status, isConnected: status === "connected", hasQR: !!currentQR }),
  getQR: () => currentQR,
  onStatusChange: (cb) => {
    statusListeners.push(cb);
    return () => { statusListeners = statusListeners.filter(x => x !== cb); };
  },
  getGroups: async () => {
    if (!client || status !== "connected") throw new Error("No conectado");
    const chats = await client.listChats();
    return chats.filter(c => c.isGroup).map(c => ({
      wa_group_id: c.id._serialized || c.id,
      name: c.name,
      members: c.groupMetadata?.participants?.length || 0,
    }));
  },
};
