/* edge-tts-probe2.js — 经本地 HTTP 代理 CONNECT 隧道验证 Edge TTS（gfw 网络下 wss 直连不通）
   用法：node temp/edge-tts-probe2.js  */
const TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WIN_EPOCH = 11644473600;
const S_TO_NS = 1e7;
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const tls = require("tls");
const { WebSocket } = require("C:/Users/a/.workbuddy/binaries/node/workspace/node_modules/ws");

const PROXY = { host: "127.0.0.1", port: 54257 };

/* 最小 CONNECT 隧道 agent：ws 内部 http.request 会调 agent.createConnection */
class TunnelAgent extends https.Agent {
  createConnection(opts, cb) {
    const req = http.request({
      host: PROXY.host, port: PROXY.port, method: "CONNECT",
      path: opts.host + ":" + opts.port,
      headers: { Host: opts.host + ":" + opts.port },
    });
    req.on("connect", (res, sock) => {
      if (res.statusCode !== 200) return cb(new Error("CONNECT " + res.statusCode));
      cb(null, tls.connect({ socket: sock, servername: opts.host }));
    });
    req.on("error", cb);
    req.end();
  }
}

function gec(roundSec) {
  let ticks = Math.floor(Date.now() / 1000 + WIN_EPOCH) * S_TO_NS;
  ticks = ticks - (ticks % (roundSec * S_TO_NS));
  return crypto.createHash("sha256").update(String(ticks) + TOKEN).digest("hex").toUpperCase();
}

function synth(text, voice, rate, roundSec, host, extra) {
  return new Promise((resolve, reject) => {
    let url = "wss://" + host + "/tts/cognitiveservices/websocket/v1?TrustedClientToken=" + TOKEN;
    if (host.indexOf("speech.platform.bing.com") >= 0)
      url = "wss://" + host + "/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=" + TOKEN;
    if (roundSec) url += "&Sec-MS-GEC=" + gec(roundSec) + "&Sec-MS-GEC-Version=1-131.0.2903.112";
    const ws = new WebSocket(url, {
      agent: new TunnelAgent(),
      headers: Object.assign({
        "Origin": "chrome-extension://jdiccldimpahbcfhbmnnjbclgnbnkgof",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
        "Accept-Encoding": "gzip, deflate",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
      }, extra || {}),
    });
    const t0 = Date.now();
    let audio = [];
    const to = setTimeout(() => { try { ws.terminate(); } catch (e) {} reject(new Error("timeout 15s")); }, 15000);
    ws.on("open", () => {
      ws.send("X-Timestamp:" + new Date().toString() + "\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n" +
        JSON.stringify({ context: { synthesis: { audio: {
          metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "false" },
          outputFormat: "audio-24khz-48kbitrate-mono-mp3" } } } }));
      const ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>" +
        "<voice name='" + voice + "'><prosody rate='" + rate + "'>" + text + "</prosody></voice></speak>";
      ws.send("X-RequestId:" + crypto.randomUUID().replace(/-/g, "") +
        "\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n" + ssml);
    });
    ws.on("message", (data, isBin) => {
      if (!isBin) {
        const s = data.toString();
        if (s.includes("Path:turn.end")) {
          clearTimeout(to); ws.close();
          const all = Buffer.concat(audio);
          require("fs").writeFileSync("E:/育人帮/temp/edge-tts-sample.mp3", all);
          resolve({ bytes: all.length, ms: Date.now() - t0 });
        }
        return;
      }
      const u8 = new Uint8Array(data);
      const hlen = (u8[0] << 8) | u8[1];
      const head = Buffer.from(u8.slice(2, 2 + hlen)).toString();
      if (head.includes("Path:audio")) audio.push(Buffer.from(u8.slice(2 + hlen)));
    });
    ws.on("error", e => { clearTimeout(to); reject(new Error("ws: " + e.message)); });
  });
}

(async () => {
  const text = "各位家长晚上好，欢迎来到育人帮。";
  const cases = [
    ["speech.platform.bing.com", 300],
    ["speech.platform.bing.com", 180],
    ["speech.platform.bing.com", 0],          /* 不带 GEC */
    ["api.msedgeservices.com", 300],
    ["api.msedgeservices.com", 180],
    ["api.msedgeservices.com", 0],
  ];
  for (const [host, rnd] of cases) {
    try {
      const r = await synth(text, "zh-CN-YunyangNeural", "+0%", rnd, host);
      console.log(host + " round=" + rnd + "s → OK mp3 " + r.bytes + " bytes, " + r.ms + "ms");
      return;                                   /* 拿到一个成功即止 */
    } catch (e) {
      console.log(host + " round=" + rnd + "s → FAIL " + e.message);
    }
  }
})();
