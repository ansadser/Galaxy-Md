"use strict";

/**
 * .callplay <song name>
 * Bot ninakku WhatsApp voice call cheythu song play cheyyum (1:1 mathram).
 * Needs: baileys-caller (unofficial) + separate linked session (scripts/callpair.js).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const { execFile } = require("child_process");
const { promisify } = require("util");

const run = promisify(execFile);

// Env values call time-il vaayikkum (restart-inu shesham maarum)
const cfg = () => ({
  authDir: process.env.CALL_AUTH_DIR || path.join(__dirname, "..", "call-session"),
  publicUse: String(process.env.CALL_PLAY_PUBLIC || "").toLowerCase() === "true",
  maxMs: Number(process.env.CALL_MAX_MS) || 10 * 60 * 1000,
  ringTimeoutMs: Number(process.env.CALL_RING_TIMEOUT_MS) || 45 * 1000,
  cooldownMs: Number(process.env.CALL_COOLDOWN_MS) || 2 * 60 * 1000,
  ffprobe: process.env.FFPROBE_PATH || "ffprobe",
});

const MAX_FILE = 80 * 1024 * 1024;
const digits = (v) => String(v || "").split("@")[0].split(":")[0].replace(/\D/g, "");

// Song APIs (same order as .play): fast & powerful first
const APIS = [
  {
    name: "ZellRayyV2",
    build: (q) => "https://zellrayy.com/download/ytplaymusic/v2?q=" + encodeURIComponent(q),
    parse: (j) => ({ ok: j?.status === true, url: j?.result?.download || j?.result?.stream, title: j?.result?.title }),
  },
  {
    name: "ZellRayy",
    build: (q) => "https://zellrayy.com/download/ytplaymusic?q=" + encodeURIComponent(q),
    parse: (j) => ({ ok: j?.status === true, url: j?.result?.download || j?.result?.stream, title: j?.result?.title }),
  },
  {
    name: "Nexray",
    build: (q) => "https://api.nexray.eu.cc/downloader/ytplay?q=" + encodeURIComponent(q),
    parse: (j) => ({ ok: j?.status === true, url: j?.result?.download_url, title: j?.result?.title }),
  },
  {
    name: "NexaDev",
    build: (q) => "https://api.nexadev.my.id/api/ytplay?q=" + encodeURIComponent(q),
    parse: (j) => ({ ok: j?.status === true, url: j?.data?.url, title: j?.title }),
  },
];

async function getJson(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

async function downloadTo(url, file) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.8" },
    redirect: "follow",
    signal: AbortSignal.timeout(300000),
  });
  if (!res.ok || !res.body) throw new Error("download HTTP " + res.status);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
  const size = fs.statSync(file).size;
  if (!size) throw new Error("empty file");
  if (size > MAX_FILE) throw new Error("file too large");
}

async function fetchSong(query, file) {
  const errors = [];
  for (const api of APIS) {
    try {
      const json = await getJson(api.build(query));
      const { ok, url, title } = api.parse(json);
      if (!ok || typeof url !== "string" || !/^https?:\/\//i.test(url)) throw new Error("no valid link");
      await downloadTo(url, file);
      return { title: String(title || query).trim() };
    } catch (err) {
      errors.push(api.name + ": " + (err?.message || "failed"));
      try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
    }
  }
  throw new Error("All song APIs failed\n" + errors.join("\n"));
}

// Song theernnaal call nirthaan duration ariyanam
async function probeSeconds(file) {
  try {
    const { stdout } = await run(cfg().ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { timeout: 15000 });
    const n = Number(String(stdout).trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

// Message ayacha aalude phone number (LID aanenkil Alt-il ninnu)
function callerNumber(message) {
  const key = message?.key || {};
  const candidates = [key.participantAlt, key.remoteJidAlt, key.participant, key.remoteJid];
  const phone = candidates.find((j) => typeof j === "string" && /@s\.whatsapp\.net$/.test(j));
  return phone ? digits(phone) : "";
}

function coded(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// baileys-caller client: onnu mathram undaakki connected aayi nirthum
let clientPromise = null;
async function getClient() {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    let mod;
    try {
      mod = await import("baileys-caller");
    } catch {
      throw coded("NOT_INSTALLED", "baileys-caller install cheythittilla.");
    }
    const VoipClient = mod.VoipClient || mod.default?.VoipClient;
    if (typeof VoipClient !== "function") throw coded("NOT_INSTALLED", "baileys-caller-il VoipClient kandilla.");

    const { authDir } = cfg();
    if (!fs.existsSync(path.join(authDir, "creds.json"))) {
      throw coded("NO_SESSION", "Call session link cheythittilla.");
    }
    const client = new VoipClient({ authDir });
    await client.connect();
    return client;
  })().catch((e) => {
    clientPromise = null;
    throw e;
  });
  return clientPromise;
}

let active = null;            // { number, call }
const lastCall = new Map();   // number -> time

const USAGE =
  "*Call Play* 📞\nBot ninakku call cheythu song play cheyyum.\n\n" +
  "`.callplay <song name>`\n`.callplay stop` - call nirthaan";

const NOT_INSTALLED_HELP =
  "❌ Call library illa.\nServer-il:\n`npm i github:SheIITear/baileys-caller @whiskeysockets/baileys@npm:baileys@7.0.0-rc14`\nPinne bot restart cheyyuka.";

const NO_SESSION_HELP =
  "❌ Call-inulla WhatsApp session link cheythittilla.\nServer-il:\n`node scripts/callpair.js <bot number>`\nVarunna pairing code WhatsApp → Linked devices → Link with phone number-il kodukkuka. Pinne bot restart cheyyuka.";

module.exports = {
  name: "callplay",
  aliases: ["callsong", "cplay"],
  description: "Bot calls you on WhatsApp and plays a song (1:1, experimental)",
  category: "Media",

  async execute({ sock, jid, message, query, args, isPrivileged }) {
    const send = (text) => sock.sendMessage(jid, { text }, { quoted: message });
    const input = String(query ?? args?.join(" ") ?? "").trim();
    const settings = cfg();

    const number = callerNumber(message);

    // ---- stop ----
    if (/^stop$/i.test(input)) {
      if (!active?.call) return send("Ippo call onnum nadakkunnilla.");
      if (!isPrivileged && active.number !== number) return send("❌ Ith ninte call alla.");
      try { active.call.end(); } catch {}
      return send("📴 Call nirthi.");
    }

    if (!settings.publicUse && !isPrivileged) return send("❌ Ith owner / sudo-kku mathram aanu.");
    if (!input) return send(USAGE);
    if (!number) return send("❌ Ninte phone number kandupidikkaan pattiyilla. Private chat-il ayakkuka.");
    if (number === digits(sock?.user?.id)) return send("❌ Bot-inte thanne number-il ninnu pattilla. Vere number-il ninnu ayakkuka.");
    if (active) return send("📞 Oru call already nadakkunnu. `.callplay stop` ayakkuka, allenkil kurachu kazhinju try cheyyuka.");

    if (!isPrivileged) {
      const wait = (lastCall.get(number) || 0) + settings.cooldownMs - Date.now();
      if (wait > 0) return send("⏳ " + Math.ceil(wait / 1000) + " second kazhinju try cheyyuka.");
    }

    active = { number, call: null }; // lock
    const file = path.join(os.tmpdir(), "galaxy-callplay-" + Date.now() + "-" + Math.random().toString(16).slice(2) + ".mp3");
    let statusMessage;
    const editStatus = async (status) => {
      try {
        if (statusMessage?.key) await sock.sendMessage(jid, { text: status, edit: statusMessage.key });
      } catch {}
    };

    try {
      statusMessage = await sock.sendMessage(jid, { text: "🔎 Searching..." }, { quoted: message });

      const client = await getClient(); // library / session illenkil ivide thanne error varum

      const { title } = await fetchSong(input, file);
      const seconds = await probeSeconds(file);
      const durationMs = seconds ? Math.min(settings.maxMs, Math.round(seconds * 1000) + 3000) : settings.maxMs;

      await editStatus("📞 Calling +" + number + "...");
      lastCall.set(number, Date.now());

      const call = await client.call(number, { audioSource: file, durationMs });
      active.call = call;

      let connected = false;
      let timedOut = false;
      call.on("ringing", () => editStatus("🔔 Ringing..."));
      call.on("connected", () => {
        connected = true;
        editStatus("🎵 Playing: " + title.slice(0, 120));
      });
      call.on("error", (e) => console.error("[GALAXY-MD] callplay call error:", e?.message || e));

      const ringTimer = setTimeout(() => {
        if (!connected) {
          timedOut = true;
          try { call.end(); } catch {}
        }
      }, settings.ringTimeoutMs);

      // Safety: ethenkilum kaaranathaal call theerillenkil force end
      const hardTimer = setTimeout(() => { try { call.end(); } catch {} }, durationMs + 30000);

      let reason = "ended";
      try {
        reason = await call.waitForEnd();
      } finally {
        clearTimeout(ringTimer);
        clearTimeout(hardTimer);
      }

      if (timedOut && !connected) {
        await editStatus("❌ Call edukkaathathu kondu nirthi (" + Math.round(settings.ringTimeoutMs / 1000) + "s).");
      } else if (String(reason) === "rejected") {
        await editStatus("❌ Call reject cheythu.");
      } else {
        await editStatus("✅ Call theernnu: " + title.slice(0, 120));
      }
    } catch (error) {
      console.error("[GALAXY-MD] callplay failed:", error?.message || error);
      if (error?.code === "NOT_INSTALLED") await editStatus(NOT_INSTALLED_HELP);
      else if (error?.code === "NO_SESSION") await editStatus(NO_SESSION_HELP);
      else await editStatus("❌ Call failed!\n" + String(error?.message || error).slice(0, 250));
    } finally {
      active = null;
      try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
    }
  },
};
