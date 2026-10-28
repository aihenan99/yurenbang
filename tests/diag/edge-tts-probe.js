/* edge-tts-probe.js — 验证 Edge 神经语音 wss 直连与 Sec-MS-GEC 令牌算法（Worker 内将复用同逻辑）
   用法：node temp/edge-tts-probe.js [variant]   variant: 180 | 300 | both(默认) */
const TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WIN_EPOCH = 11644473600;
const S_TO_NS = 1e7;
const crypto = require("crypto");

function gec(roundSec) {
  let ticks = Math.floor((Date.now() / 1000 + WIN_EPOCH)) * S_TO_NS; /* 秒 → 100ns */
  ticks = ticks - (ticks % (roundSec * S_TO_NS));
  return crypto.createHash("sha256").update(String(ticks) + TOKEN).digest("hex").toUpperCase();
}

function synth(text, voice, rate, roundSec) {
  return new Promise((resolve, reject) => {
    const url = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1" +
      "?TrustedClientToken=" + TOKEN +
      "&Sec-MS-GEC=" + gec(roundSec) +
      "&Sec-MS-GEC-Version=1-131.0.2903.112";
    const ws = new WebSocket(url, { headers: {
      "Origin": "chrome-extension://jdiccldimpahbcfhbmnnjbclgnbnkgof",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
      "Accept-Encoding": "gzip, deflate",
    }});
    const t0 = Date.now();
    let audio = [];
    let opened = false;
    const to = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error("timeout 12s")); }, 12000);
    ws.onopen = () => {
      opened = true;
      const ts = new Date().toString();
      ws.send("X-Timestamp:" + ts + "\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n" +
        JSON.stringify({ context: { synthesis: { audio: {
          metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "false" },
          outputFormat: "audio-24khz-48kbitrate-mono-mp3" } } } }));
      const rid = crypto.randomUUID().replace(/-/g, "");
      const ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>" +
        "<voice name='" + voice + "'><prosody rate='" + rate + "'>" + text + "</prosody></voice></speak>";
      ws.send("X-RequestId:" + rid + "\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n" + ssml);
    };
    ws.onmessage = ev => {
      if (typeof ev.data === "string") {
        if (ev.data.includes("Path:turn.end")) {
          clearTimeout(to); ws.close();
          resolve({ bytes: audio.reduce((a, b) => a + b.length, 0), ms: Date.now() - t0 });
        }
        return;
      }
      ev.data.arrayBuffer().then(buf => {
        const u8 = new Uint8Array(buf);
        const hlen = (u8[0] << 8) | u8[1];
        const head = Buffer.from(u8.slice(2, 2 + hlen)).toString();
        if (head.includes("Path:audio")) audio.push(Buffer.from(u8.slice(2 + hlen)));
      });
    };
    ws.onerror = e => { clearTimeout(to); reject(new Error("ws error" + (e && e.message ? " " + e.message : ""))); };
    ws.onclose = () => { if (!opened) { clearTimeout(to); reject(new Error("closed before open")); } };
  });
}

(async () => {
  const variant = process.argv[2] || "both";
  const text = "各位家长晚上好，欢迎来到育人帮。";
  const voice = "zh-CN-YunyangNeural";
  const variants = variant === "both" ? [180, 300] : [+variant];
  for (const v of variants) {
    try {
      const r = await synth(text, voice, "+0%", v);
      console.log("round=" + v + "s → OK, mp3 bytes=" + r.bytes + ", " + r.ms + "ms");
    } catch (e) {
      console.log("round=" + v + "s → FAIL: " + e.message);
    }
  }
})();
