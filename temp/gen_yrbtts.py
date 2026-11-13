#!/usr/bin/env python3
"""从 deploy-cn/_worker.js 原样切出语音合成算法段，拼装成境内站独立 TTS 服务。

为什么要生成而不是手写：
  这段 Sec-MS-GEC v2 令牌算法是踩了很多次才对齐的定制哈希（与 rany2/edge-tts
  对拍一致），手抄一个常量错一位就是 403。所以只维护 Worker 一份源，
  这里按行号区间原样搬运，改 Worker 后重跑本脚本即可同步。
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "deploy-cn", "_worker.js")
OUT = os.path.join(ROOT, "deploy-tencent", "tts", "yrbtts.mjs")

# _worker.js 里的算法段：const TTS_TOKEN ... 到 xmlEsc 函数结束
START_MARK = "const TTS_TOKEN"
END_MARK = 'function xmlEsc(s){'

lines = open(SRC, encoding="utf-8").read().split("\n")
start = next(i for i, l in enumerate(lines) if l.startswith(START_MARK))
end = next(i for i, l in enumerate(lines) if l.startswith(END_MARK))
core = "\n".join(lines[start:end + 1]).rstrip()

HEADER = '''#!/usr/bin/env node
/* yrbtts.mjs —— 境内站自主语音合成服务（2026-11-04）
 *
 * 为什么有这个文件：
 *   境内轻量云的 /yrbtts 一直是 proxy_pass 回源 Cloudflare 的 Worker。
 *   能用，但意味着「CF 那边一动手，境内站的朗读立刻哑」——境内机器看似的
 *   独立性其实是假的。本服务把同一套合成逻辑搬到本机，回源依赖彻底去掉。
 *
 * 接口与 Worker 版逐字对齐（前端无需改动）：
 *   GET /yrbtts?t=<文本>&r=norm|slow  → audio/mpeg
 *   GET /healthz                      → 运行状态 JSON（给巡检脚本用）
 *
 * ⚠️ 下面「算法段」由 temp/gen_yrbtts.py 从 deploy-cn/_worker.js 原样切出，
 *    请勿在此手改。要改算法先改 Worker，再重跑：
 *        .venv/Scripts/python.exe temp/gen_yrbtts.py
 *    verify 有守卫比对两边的常量表，漂移会直接红。
 */

import { createServer } from "node:http";

/* ============ 算法段（自动生成，勿手改） ============ */
'''

BODY = '''/* ============ 算法段结束 ============ */

const PORT = Number(process.env.YRB_TTS_PORT || 8791);
const HOST = process.env.YRB_TTS_HOST || "127.0.0.1";
const MAX_TEXT = 400;          /* 与 Worker 一致：超长截断而非报错 */
const WS_TIMEOUT = 12000;
const CACHE_MAX_ITEMS = 240;   /* 长辈反复听同一段话是常态，缓存命中率高 */
const CACHE_MAX_BYTES = 32 * 1024 * 1024;
const MAX_INFLIGHT = 3;        /* 2C2G 机器，别把内存和出口带宽打满 */

/* ---------- 帧封装：与 Worker 的 send() 同格式 ---------- */
function frame(path, contentType, body) {
  return "X-RequestId:" + crypto.randomUUID().replace(/-/g, "") +
    "\\r\\nContent-Type:" + contentType +
    "\\r\\nPath:" + path + "\\r\\n\\r\\n" + body;
}

/* ---------- 单次合成 ---------- */
function ttsSynthesize(text, slow) {
  const gec = ttsSecMsGec();
  const url = TTS_WSS + "&Sec-MS-GEC=" + gec + "&Sec-MS-GEC-Version=" + TTS_GEC_VERSION;
  return new Promise((resolve, reject) => {
    let settled = false;
    const chunks = [];
    let ws;
    const fin = (ok, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(to);
      try { ws && ws.close(1000); } catch (e) { /* 已关闭 */ }
      ok ? resolve(val) : reject(val);
    };
    const to = setTimeout(() => fin(false, new Error("tts timeout")), WS_TIMEOUT);

    try {
      /* Node 22 原生 WebSocket（undici），自定义头走第二个参数的 headers */
      ws = new WebSocket(url, { headers: {
        "Origin": TTS_ORIGIN,
        "User-Agent": TTS_UA,
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
      } });
    } catch (e) {
      return fin(false, new Error("ws construct: " + e.message));
    }
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      ws.send(frame("speech.config", "application/json; charset=utf-8", JSON.stringify({
        context: { synthesis: { audio: {
          metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "false" },
          outputFormat: "audio-24khz-48kbitrate-mono-mp3",
        } } },
      })));
      const rate = slow ? "-15%" : "-4%";
      ws.send(frame("ssml", "application/ssml+xml",
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='zh-CN'>" +
        "<voice name='" + TTS_VOICE + "'><mstts:express-as style='" + TTS_STYLE + "' styledegree='1.5'><prosody rate='" + rate + "' pitch='" + TTS_PITCH + "'>" + xmlEsc(text) +
        "</prosody></mstts:express-as></voice></speak>"));
    };

    ws.onmessage = (ev) => {
      const d = ev.data;
      if (typeof d === "string") {
        if (d.indexOf("Path:turn.end") >= 0) {
          const total = chunks.reduce((a, b) => a + b.byteLength, 0);
          if (!total) return fin(false, new Error("empty audio"));
          const out = new Uint8Array(total);
          let off = 0;
          for (const c of chunks) { out.set(new Uint8Array(c), off); off += c.byteLength; }
          fin(true, out);
        }
        return;
      }
      /* 二进制帧：2 字节大端头长 + 头文本 + 音频体 */
      if (!d || !d.byteLength) return;
      const u8 = new Uint8Array(d);
      if (u8.byteLength < 2) return;
      const hlen = (u8[0] << 8) | u8[1];
      const head = new TextDecoder().decode(u8.subarray(2, 2 + hlen));
      if (head.indexOf("Path:audio") >= 0) chunks.push(u8.subarray(2 + hlen));
    };

    ws.onerror = () => fin(false, new Error("tts ws error"));
    ws.onclose = () => fin(false, new Error("tts closed early"));
  });
}

/* ---------- 简单的 LRU（Map 的插入序天然就是 LRU 序） ---------- */
const cache = new Map();
let cacheBytes = 0;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  cache.delete(key);
  cache.set(key, hit);
  return hit.buf;
}
function cachePut(key, buf) {
  if (buf.byteLength > CACHE_MAX_BYTES / 4) return;   /* 单条过大不入缓存 */
  const old = cache.get(key);
  if (old) { cacheBytes -= old.buf.byteLength; cache.delete(key); }
  cache.set(key, { buf });
  cacheBytes += buf.byteLength;
  while ((cache.size > CACHE_MAX_ITEMS || cacheBytes > CACHE_MAX_BYTES) && cache.size > 1) {
    const k = cache.keys().next().value;
    cacheBytes -= cache.get(k).buf.byteLength;
    cache.delete(k);
  }
}

/* ---------- 并发闸门：排队而不是直接拒绝（长辈点了就该出声） ---------- */
let inflight = 0;
const waiting = [];
function acquire() {
  if (inflight < MAX_INFLIGHT) { inflight++; return Promise.resolve(); }
  if (waiting.length >= 24) return Promise.reject(new Error("busy"));
  return new Promise((res) => waiting.push(res));
}
function release() {
  const next = waiting.shift();
  if (next) next();
  else inflight--;
}

/* ---------- 响应助手 ---------- */
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

const startedAt = Date.now();
let served = 0, failed = 0;

async function handleTts(req, res, url) {
  const q = url.searchParams;
  const text = (q.get("t") || "").slice(0, MAX_TEXT);
  const slow = q.get("r") === "slow";
  if (!text.trim()) return sendJson(res, 400, { error: "no text" });

  /* 缓存键带配方版本与音色：换音色/音高后旧音频自动失效，不会又播回老声音 */
  const key = TTS_REV + "|" + TTS_VOICE + "|" + (slow ? "s|" : "n|") + text;
  const hit = cacheGet(key);
  if (hit) {
    res.writeHead(200, {
      "content-type": "audio/mpeg",
      "content-length": hit.byteLength,
      "cache-control": "public, max-age=86400",
      "x-yrb-tts": "hit",
      "x-yrb-voice": TTS_VOICE,
      "x-yrb-tts-rev": TTS_REV,
    });
    served++;
    return res.end(Buffer.from(hit.buffer, hit.byteOffset, hit.byteLength));
  }

  try {
    await acquire();
  } catch (e) {
    return sendJson(res, 503, { error: "busy", message: "语音合成排队已满，请稍后重试" });
  }

  try {
    const mp3 = await ttsSynthesize(text, slow);
    if (!mp3 || !mp3.byteLength) throw new Error("empty audio");
    cachePut(key, mp3);
    res.writeHead(200, {
      "content-type": "audio/mpeg",
      "content-length": mp3.byteLength,
      "cache-control": "public, max-age=86400",
      "x-yrb-tts": "miss",
      "x-yrb-voice": TTS_VOICE,
      "x-yrb-tts-rev": TTS_REV,
    });
    served++;
    res.end(Buffer.from(mp3.buffer, mp3.byteOffset, mp3.byteLength));
  } catch (err) {
    failed++;
    console.error("[yrbtts]", String((err && err.message) || err).slice(0, 200));
    sendJson(res, 502, { error: "tts_failed", message: "语音合成暂时不可用，将改用本机朗读" });
  } finally {
    release();
  }
}

const server = createServer((req, res) => {
  let url;
  try { url = new URL(req.url, "http://localhost"); }
  catch (e) { return sendJson(res, 400, { error: "bad url" }); }

  if (url.pathname === "/healthz") {
    return sendJson(res, 200, {
      ok: true,
      uptime_s: Math.round((Date.now() - startedAt) / 1000),
      cache_items: cache.size,
      cache_bytes: cacheBytes,
      inflight, waiting: waiting.length,
      served, failed,
    });
  }
  if (url.pathname !== "/yrbtts") return sendJson(res, 404, { error: "not found" });
  if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "method" });
  handleTts(req, res, url);
});

server.headersTimeout = 15000;
server.requestTimeout = 30000;
server.keepAliveTimeout = 20000;

server.listen(PORT, HOST, () => {
  console.log("[yrbtts] listening on " + HOST + ":" + PORT +
    " voice=" + TTS_VOICE + " bing_direct=1");
});

function shutdown(sig) {
  console.log("[yrbtts] " + sig + " received, closing");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
'''

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8", newline="\n") as f:
    f.write(HEADER)
    f.write(core)
    f.write("\n\n")
    f.write(BODY)

print("已生成", os.path.relpath(OUT, ROOT), "算法段", end - start + 1, "行")
