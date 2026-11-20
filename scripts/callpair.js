"use strict";

/**
 * Call session link cheyyaan (QR illaathe, pairing code vazhi).
 *   node scripts/callpair.js <bot number with country code>
 * Varunna code: WhatsApp -> Linked devices -> Link with phone number.
 * Session ./call-session-il save aakum (CALL_AUTH_DIR maattaam). Ith bot-inte main session-il ninnu vere aanu.
 */

const path = require("path");
const baileys = require("baileys");

const makeWASocket = baileys.default || baileys.makeWASocket;
const { useMultiFileAuthState, fetchLatestBaileysVersion } = baileys;

const number = String(process.argv[2] || process.env.BOT_NUMBER || "").replace(/\D/g, "");
const authDir = process.env.CALL_AUTH_DIR || path.join(__dirname, "..", "call-session");

if (number.length < 8) {
  console.error("Usage: node scripts/callpair.js <number with country code>");
  process.exit(1);
}

async function start(isRestart = false) {
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  if (state.creds.registered && !isRestart) {
    console.log("Already linked:", authDir);
    process.exit(0);
  }

  let version;
  try { version = (await fetchLatestBaileysVersion()).version; } catch {}

  const sock = makeWASocket({ auth: state, printQRInTerminal: false, ...(version ? { version } : {}) });
  sock.ev.on("creds.update", saveCreds);

  if (!state.creds.registered) setTimeout(async () => {
    try {
      const code = await sock.requestPairingCode(number);
      console.log("\nCALL SESSION PAIRING CODE:", code);
      console.log("WhatsApp -> Linked devices -> Link with phone number.\n");
    } catch (error) {
      console.error("Pairing code request failed:", error?.message || error);
      process.exit(1);
    }
  }, 2000);

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      console.log("Linked! Session saved in", authDir);
      setTimeout(() => process.exit(0), 3000);
    } else if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === 515 || code === 428) {
        start(true).catch((e) => { console.error(e); process.exit(1); });
      } else if (state.creds.registered) {
        console.log("Linked (reconnect needed). Session saved in", authDir);
        process.exit(0);
      }
    }
  });
}

start().catch((e) => { console.error(e); process.exit(1); });
