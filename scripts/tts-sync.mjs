#!/usr/bin/env node
/* tts-sync.mjs —— 校验本机语音服务的算法段与 Worker 版是否还一致
 *
 * 为什么要有这个脚本：
 *   deploy-tencent/tts/yrbtts.mjs 里的 Sec-MS-GEC v2 令牌算法是从
 *   deploy-cn/_worker.js **切出来复制**的（那段是定制哈希，手抄一个常量错位就 403，
 *   所以只能原样搬）。复制就有漂移风险：改了 Worker、忘了重跑生成脚本，
 *   两边的令牌算法就会悄悄不一致——线上表现是「境内站读不出声，CF 站点正常」，
 *   排查时极难想到是复制漂移。
 *
 *   这个脚本把两边的算法段切出来逐字比，不一致直接红，并给出修复命令。
 *
 * 用法：node scripts/tts-sync.mjs        （verify 已包含）
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKER = join(ROOT, "deploy-cn", "_worker.js");
const SERVICE = join(ROOT, "deploy-tencent", "tts", "yrbtts.mjs");

const C = { r: "\x1b[31m", g: "\x1b[32m", y: "\x1b[33m", d: "\x1b[2m", x: "\x1b[0m" };
const fail = [];

function die(msg) {
  console.log(C.r + "✗ " + msg + C.x);
  process.exit(1);
}

if (!existsSync(WORKER)) die("找不到 " + WORKER);
if (!existsSync(SERVICE)) die("找不到 " + SERVICE + "（先跑 temp/gen_yrbtts.py 生成）");

const workerSrc = readFileSync(WORKER, "utf8");
const serviceSrc = readFileSync(SERVICE, "utf8");

/* ---------- 1. 切出 Worker 的算法段 ---------- */
const W_START = "const TTS_TOKEN";
const W_END = "function xmlEsc(s){";
const wLines = workerSrc.split("\n");
const wStart = wLines.findIndex((l) => l.startsWith(W_START));
const wEnd = wLines.findIndex((l) => l.startsWith(W_END));
if (wStart < 0 || wEnd < 0 || wEnd <= wStart) {
  die("_worker.js 里找不到算法段边界（" + W_START + " … " + W_END + "），生成脚本也要跟着改");
}
const workerCore = wLines.slice(wStart, wEnd + 1).join("\n").trimEnd();

/* ---------- 2. 切出服务文件里的算法段 ---------- */
const S_HEAD = "算法段（自动生成，勿手改）";
const S_TAIL = "算法段结束";
const sLines = serviceSrc.split("\n");
const sStart = sLines.findIndex((l) => l.includes(S_HEAD));
const sEnd = sLines.findIndex((l) => l.includes(S_TAIL));
if (sStart < 0 || sEnd < 0 || sEnd <= sStart) {
  die("yrbtts.mjs 里找不到算法段标记，文件被手工改过了？");
}
const serviceCore = sLines.slice(sStart + 1, sEnd).join("\n").trimEnd();

/* ---------- 3. 逐字比对 ---------- */
if (workerCore !== serviceCore) {
  /* 只指出第一个分歧行，看行号比看全文有效 */
  const a = workerCore.split("\n");
  const b = serviceCore.split("\n");
  let at = -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) { at = i; break; }
  }
  console.log(C.r + "✗ 算法段漂移：Worker 与 yrbtts.mjs 不一致" + C.x);
  if (at >= 0) {
    console.log(C.d + "  两边第 " + (at + 1) + " 行开始不同：" + C.x);
    console.log(C.d + "  worker  : " + String(a[at] ?? "(缺行)").slice(0, 110) + C.x);
    console.log(C.d + "  yrbtts  : " + String(b[at] ?? "(缺行)").slice(0, 110) + C.x);
  }
  console.log(C.y + "  修复：.venv/Scripts/python.exe temp/gen_yrbtts.py 然后重启服务器上的 yrbtts 服务" + C.x);
  process.exit(1);
}

/* ---------- 4. 几个接口约定，缺一条前端就会退化 ---------- */
const musts = [
  ["/yrbtts", "少了 /yrbtts 路由，前端朗读直接 404"],
  ["/healthz", "少了健康检查，巡检脚本看不出服务死没死"],
  ["audio/mpeg", "返回类型不是 audio/mpeg，<audio> 播不了"],
  ["Path:turn.end", "少了结束帧判断，合成会一直等到超时"],
  ["Path:audio", "少了音频帧解析，拿不到音频体"],
  ["text/clip", "只用于提示，不需要"],
];
for (const [needle, why] of musts) {
  if (needle === "text/clip") continue;
  if (!serviceSrc.includes(needle)) fail.push("缺 `" + needle + "`： " + why);
}

/* 令牌常量必须与 Worker 同值（这两个是握手能否通过的关键） */
const grab = (src, re) => (src.match(re) || [])[1];
for (const name of ["TTS_TOKEN", "TTS_GEC_VERSION", "TTS_VOICE"]) {
  const re = new RegExp("const\\s+" + name + '\\s*=\\s*"([^"]+)"');
  const w = grab(workerSrc, re);
  const s = grab(serviceSrc, re);
  if (!w || !s) fail.push("两边都要有常量 " + name);
  else if (w !== s) fail.push(name + " 不一致：worker=" + w + " yrbtts=" + s);
}

if (fail.length) {
  console.log(C.r + "✗ 语音服务接口约定被动过：" + C.x);
  for (const f of fail) console.log("   · " + f);
  process.exit(1);
}

const nLines = workerCore.split("\n").length;
console.log(
  C.g + "✓ 语音服务与 Worker 同源" + C.x +
  C.d + "（算法段 " + nLines + " 行逐字一致，令牌常量 3 个同值）" + C.x
);
