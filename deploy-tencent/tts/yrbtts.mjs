#!/usr/bin/env node
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
const TTS_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const TTS_WSS = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=" + TTS_TOKEN;
const TTS_GEC_VERSION = "2-143.0.3650.75";
const TTS_ORIGIN = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";
const TTS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";
const TTS_VOICE = "zh-CN-XiaoxiaoNeural";
/* 2026-11-13：TTS_REV = 音频配方版本。音色/音高/语速任何一项变化都必须 +1。
   原因：caches.default 与浏览器缓存都按 URL 存音频（cache-control 24h），
   换音色而不换 URL 时，老文本会继续返回旧音色的缓存——用户听到「还是男声」。
   客户端把本值作为 &v= 带在 URL 上，本地/边缘缓存键随之改变，一次全破。
   改这里的同时必须改 assets/mediafull.js 的 TTS_REV，两边同值。 */
const TTS_REV = "2";
/* 音高 -4%：晓晓原始基频约 267Hz 偏年轻亲和，压低后约 254Hz，
   更接近央视新闻女播音的中低音区（庄重、不飘）。 */
const TTS_PITCH = "-4%";

const U32 = 0xFFFFFFFF;
const u32 = x => x >>> 0;
const rol16 = v => u32((u32(v) << 16) | (u32(v) >>> 16));
const rotr = (v, n) => u32((u32(v) >>> n) | (u32(v) << (32 - n)));
const T_RC = [0x428A2F98,0x71374491,0xB5C0FBCF,0xE9B5DBA5,0x3956C25B,0x59F111F1,0x923F82A4,0xAB1C5ED5,0xD807AA98,0x12835B01,0x243185BE,0x550C7DC3,0x72BE5D74,0x80DEB1FE,0x9BDC06A7,0xC19BF174,0xE49B69C1,0xEFBE4786,0x0FC19DC6,0x240CA1CC,0x2DE92C6F,0x4A7484AA,0x5CB0A9DC,0x76F988DA,0x983E5152,0xA831C66D,0xB00327C8,0xBF597FC7,0xC6E00BF3,0xD5A79147,0x06CA6351,0x14292967,0x27B70A85,0x2E1B2138,0x4D2C6DFC,0x53380D13,0x650A7354,0x766A0ABB,0x81C2C92E,0x92722C85,0xA2BFE8A1,0xA81A664B,0xC24B8B70,0xC76C51A3,0xD192E819,0xD6990624,0xF40E3585,0x106AA070,0x19A4C116,0x1E376C08,0x2748774C,0x34B0BCB5,0x391C0CB3,0x4ED8AA4A,0x5B9CCA4F,0x682E6FF3,0x748F82EE,0x78A5636F,0x84C87814,0x8CC70208,0x90BEFFFA,0xA4506CEB,0xBEF9A3F7,0xC67178F2];
const T_RC_BLOCK = T_RC.slice(0, 14).concat([0xC9DC06A7], T_RC.slice(15));
const T_INIT = [0x6A09E667,0xBB67AE85,0x3C6EF372,0xA54FF53A,0x510E527F,0x9B05688C,0x1F83D9AB,0x5BE0CD19];
const T_STATE = [0xFD9FBEA2,0x91243CE7,0xBE499094,0xCD2E1E0A,0x6C006F49,0x04BD35AB,0xFEB0A7E4,0x03EFFBD2];
const T_SCHED14 = [0xEB24BF9E,0x1558691F,0xA0C09EE2,0x0CFA32BA,0xA622EE8C,0xD1DD9491,0xC0DD25A0,0xF9E70AB6,0xF0C31573,0x7058CE4E,0x7188E606,0x00E5AB33,0xD258B060,0x72766564];
const T_ADJ = 0xC9DC06A7, T_S0A = 0x059C0B80, T_S1A = 0x000B92C0;
const T_COEFFS = [[0xE82E91B1,0xB32700D0],[0x44DE24C6,0x88DFF51D],[0x3BEB65BC,0x29514038],[0xC89C5933,0xB328CBDF],[0x8D1EC211,0xD405B4D5],[0x314EF5D5,0x26E55F3C],[0xE92491B1,0x607801C6],[0xF0A5B9D5,0x82B2C1FB],[0x06064CF3,0xFA51A3DA],[0xDA79FA60,0x207CC464],[0xBED20560,0x3C3C74F3],[0x89F9C9F8,0xD2D14B61],[0x35FA38C6,0xBB04A2C1],[0xCB49E3C6,0xC5626167]];

function tSigma0(v){ return u32(u32(v)>>>7 ^ u32(v)<<25 ^ u32(v)>>>18 ^ u32(v)<<14 ^ u32(v)>>>3); }
function tSigma1(v){ return u32(u32(v)>>>17 ^ u32(v)<<15 ^ u32(v)>>>19 ^ u32(v)<<13 ^ u32(v)>>>10); }
function tExpand(words, first){ for(let i=first;i<64;i++){ const x=words[i-2], y=words[i-15]; words[i]=u32(tSigma1(x)+words[i-7]+tSigma0(y)+words[i-16]); } }
function tRounds(state, words, K, start){
  let a=state[0],b=state[1],c=state[2],d=state[3],e=state[4],f=state[5],g=state[6],h=state[7];
  for(let i=start||0;i<64;i++){
    const S1=rotr(e,6)^rotr(e,11)^rotr(e,25);
    const t1=u32(u32(h+S1+(g^(e&(f^g)))+K[i])+words[i]);
    const S0=rotr(a,2)^rotr(a,13)^rotr(a,22);
    const t2=u32(S0+((a&b)|(c&(a|b))));
    h=g;g=f;f=e;e=u32(d+t1);d=c;c=b;b=a;a=u32(t1+t2);
  }
  return [a,b,c,d,e,f,g,h];
}
function tShaInit(salt){
  const words=[0,0,0,0,0,0,0,0,0,0,0,0,0,0];
  words.push((salt[0]<<16)|(salt[1]<<8)|salt[2]);
  words.push((salt[3]<<24)|(salt[4]<<16)|(salt[5]<<8)|salt[6]);
  for(let index=16;index<30;index++){
    let value=T_SCHED14[index-16];
    if(index-2>=14) value=u32(value+(index===16?(tSigma1(words[14])^T_S1A):tSigma1(words[index-2])));
    if(index-7>=14) value=u32(value+words[index-7]);
    if(index-15>=14) value=u32(value+(index===29?(tSigma0(words[index-15])^T_S0A):tSigma0(words[index-15])));
    words.push(u32(value));
  }
  words.push(u32(tSigma1(words[28])+words[23]+tSigma0(words[15])+words[14]+u32(T_ADJ-T_RC[14])));
  tExpand(words,31);
  const w=tRounds(T_STATE,words,T_RC_BLOCK,14);   /* init 从第 14 轮恢复 */
  return T_INIT.map((x,i)=>u32(x+w[i]));
}
function tShaDigest(data){
  const length=57+data.length;
  const z=((55-length)%64+64)%64;
  const lenBuf=new ArrayBuffer(8); new DataView(lenBuf).setBigUint64(0,BigInt(length*8));
  const parts=[data.slice(7),new Uint8Array([0x80]),new Uint8Array(z),new Uint8Array(lenBuf)];
  let total=0; parts.forEach(p=>total+=p.length);
  const padded=new Uint8Array(total); let off=0; parts.forEach(p=>{padded.set(p,off);off+=p.length;});
  let state=tShaInit(data.slice(0,7));
  for(let o=0;o<padded.length;o+=64){
    const words=[];
    for(let i=0;i<16;i++) words.push((padded[o+i*4]<<24)|(padded[o+i*4+1]<<16)|(padded[o+i*4+2]<<8)|padded[o+i*4+3]);
    tExpand(words,16);
    const w=tRounds(state,words,T_RC,0);
    state=state.map((x,i)=>u32(x+w[i]));
  }
  const out=new Uint8Array(32);
  state.forEach((x,i)=>{out[i*4]=x>>>24&255;out[i*4+1]=x>>>16&255;out[i*4+2]=x>>>8&255;out[i*4+3]=x&255;});
  return out;
}
function tCs64(data, digest){
  const dv=new DataView(digest.buffer,digest.byteOffset,8);
  const keyA=u32(dv.getUint32(0,true)|1), keyB=u32(dv.getUint32(4,true)|1);
  const fA=u32(Math.imul(keyA,0x82893933)), fB=u32(Math.imul(keyB,0x82893933));
  const factors=[fA,fB];
  const terms=T_COEFFS.map((c,i)=>u32(Math.imul(c[0],factors[i%2])));
  const offsets=T_COEFFS.map(c=>c[1]);
  const d=new Uint8Array(data.length+1); d.set(data,1);        /* b"\0"+data */
  const pad=(4-(d.length%4))%4;
  const full=new Uint8Array(d.length+pad); full.set(d);
  const words=[];
  const wdv=new DataView(full.buffer);
  for(let i=0;i<full.length;i+=4) words.push(wdv.getUint32(i,true));
  if(words.length%2) words.push(0);
  words.forEach((word,index)=>{
    let term=u32(Math.imul(word, index%2===0?keyA:keyB));
    let offset=u32(Math.imul(rol16(word), index%2===0?0xEF0569FB:0xC31713DB));
    if(index===0){ term=u32(term+u32(Math.imul(0xF2F90B1A,fA))); offset=u32(offset+0x0B1A0000); }
    terms.push(term); offsets.push(offset);
  });
  let swapAcc=0,swapLast=0,state=0,acc=0;
  for(let index=0;index<terms.length;index+=2){
    const x=terms[index], y=terms[index+1];
    let t=rol16(u32(offsets[index]+x));
    let q=u32(Math.imul(t,0x76F50F34));
    swapAcc=u32(swapAcc+u32(Math.imul(rol16(q),0xC3EFEA97)+q));
    t=rol16(u32(offsets[index+1]+y));
    q=u32(Math.imul(t,0x1881CE3C));
    swapLast=u32(Math.imul(rol16(q),0x35BD1EC9)+q);
    swapAcc=u32(swapAcc+swapLast);
    state=u32(Math.imul(state,keyA)+x);
    state=u32(Math.imul(rol16(state),0xCF98B111));
    state=u32(Math.imul(rol16(state),0x87085B9F));
    state=u32(Math.imul(rol16(state),0x12CEB96D));
    state=u32(Math.imul(rol16(state),0x257E1D83));
    acc=u32(acc+state);
    t=u32(Math.imul(state,keyB)+y);
    t=u32(Math.imul(rol16(t),0xA27416F5));
    t=u32(Math.imul(rol16(t),0xD38396FF));
    state=u32(Math.imul(rol16(u32(Math.imul(rol16(t),0x7C932B89))),0xBFA49F69));
    acc=u32(acc+state);
  }
  return [u32(swapLast^state), u32(swapAcc^acc)];
}
function ttsSecMsGec(){
  let t=Math.floor(Date.now()/1000)+11644473600;
  t-=t%300;
  const str=BigInt(t*1e7).toString()+TTS_TOKEN;   /* 与参考实现同精度浮点乘法 */
  const data=new TextEncoder().encode(str);
  const digest=tShaDigest(data);
  const [w1,w2]=tCs64(data,digest);
  const b=new Uint8Array(8); new DataView(b.buffer).setUint32(0,w1,true); new DataView(b.buffer).setUint32(4,w2,true);
  const hex=Array.from(b).map(x=>x.toString(16).padStart(2,"0")).join("").toUpperCase();
  const dhex=Array.from(digest).map(x=>x.toString(16).padStart(2,"0")).join("").toUpperCase();
  return hex+"-"+dhex;
}
function xmlEsc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;"); }

/* ============ 算法段结束 ============ */

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
    "\r\nContent-Type:" + contentType +
    "\r\nPath:" + path + "\r\n\r\n" + body;
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
      const rate = slow ? "-15%" : "+0%";
      ws.send(frame("ssml", "application/ssml+xml",
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>" +
        "<voice name='" + TTS_VOICE + "'><prosody rate='" + rate + "' pitch='" + TTS_PITCH + "'>" + xmlEsc(text) +
        "</prosody></voice></speak>"));
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
