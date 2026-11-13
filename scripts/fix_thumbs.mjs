/* 存量帖子补缩略图（2026-11-06）
   背景：2026-11-03 那批帖的 media 里 thumb 全缺，上传时缩略图生成失败被静默降级，
         前端 m.thumbUrl||m.url 回退 1280px 原图（单张 261KB，一屏 3 张 780KB）。
   做法：下载原图 → 浏览器 canvas 缩到 720px/q0.74（720px/q0.74：单图卡片全宽约 700 物理像素，400 会发虚）→
         上传为 …/t-<原名>.jpg → 回写 yb_posts.media
   用法：
     SB_SERVICE_KEY=<service_role> node scripts/fix_thumbs.mjs --dry-run   # 只看会处理哪些
     SB_SERVICE_KEY=<service_role> node scripts/fix_thumbs.mjs             # 真写
   注意：service_role 绕过全部 RLS，用完立刻在控制台 Rotate。 */
import path from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(process.cwd(), "temp/pw/node_modules/playwright-core"));
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";

const PROJ = "nyqpovygnwinjsjoiadw";
const BASE = `https://${PROJ}.supabase.co`;
const PROXY = "https://xn--gmqq09al6z.cn/sbapi";
const UA =
  "Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
/* 本机到 *.supabase.co 常被 ECONNRESET（代理抖动）：先直连，一旦失败就整体切同源 /sbapi。
   /sbapi 的 STRIP 不含 authorization，service_role 头能原样透传（_worker.js:242 已核对）。 */
let useProxy = false;
async function req(p, init = {}) {
  const mk = (base, extra) =>
    fetch(base + p, { ...init, headers: { ...(init.headers || {}), ...extra } });
  if (!useProxy) {
    try {
      return await mk(BASE, {});
    } catch (e) {
      console.log("  [直连 supabase 失败：" + ((e.cause && e.cause.code) || e.message) + "，改走 /sbapi]");
      useProxy = true;
    }
  }
  return mk(PROXY, { referer: "https://xn--gmqq09al6z.cn/", "user-agent": UA });
}
const BUCKET = "media";
const KEY = process.env.SB_SERVICE_KEY || "";
const DRY = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force"); /* 已有 thumb 也重做（改尺寸时用） */
const MAX_SIDE = 720, Q = 0.74;

if (!KEY) { console.error("缺少环境变量 SB_SERVICE_KEY"); process.exit(1); }
const H = { apikey: KEY, authorization: "Bearer " + KEY };

const thumbPathOf = (p) => {
  const i = p.lastIndexOf("/");
  const dir = i >= 0 ? p.slice(0, i + 1) : "";
  const file = i >= 0 ? p.slice(i + 1) : p;
  if (file.startsWith("t-")) return null; // 已经是缩略图
  const noExt = file.replace(/\.[^.]+$/, "");
  return `${dir}t-${noExt}.jpg`;
};

(async () => {
  const r = await req(`/rest/v1/yb_posts?select=id,owner_id,type,media&order=id.asc`, { headers: H });
  if (!r.ok) { console.error("读 yb_posts 失败", r.status, (await r.text()).slice(0, 200)); process.exit(1); }
  const posts = await r.json();
  console.log(`共 ${posts.length} 条帖子`);

  const jobs = [];
  for (const p of posts) {
    const ms = Array.isArray(p.media) ? p.media : [];
    ms.forEach((m, idx) => {
      if (!m || !m.path) return;
      if (m.thumb && !FORCE) return;
      if (m.kind && m.kind !== "img" && m.kind !== "image") return;
      const tp = thumbPathOf(m.path);
      if (tp) jobs.push({ post: p, idx, media: m, tpath: tp });
    });
  }
  console.log(`待补缩略图：${jobs.length} 张`);
  jobs.forEach((j) => console.log(`  #${j.post.id} [${j.idx}] ${j.media.path}\n        → ${j.tpath}`));
  if (!jobs.length) return console.log("没有需要补的，收工");
  if (DRY) return console.log("\n[dry-run] 未写入任何数据");

  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage();
  await page.goto("about:blank");

  /* 在浏览器里缩图：输入/输出都用 base64，避免 Node 侧装 sharp */
  const shrink = (b64) =>
    page.evaluate(async ({ b64, maxSide, q }) => {
      const img = new Image();
      img.src = "data:image/jpeg;base64," + b64;
      await img.decode();
      const s = Math.min(1, maxSide / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(img.width * s));
      cv.height = Math.max(1, Math.round(img.height * s));
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      const blob = await new Promise((res) => cv.toBlob(res, "image/jpeg", q));
      const u = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
      return { b64: btoa(bin), w: cv.width, h: cv.height, srcW: img.width, srcH: img.height };
    }, { b64, maxSide: MAX_SIDE, q: Q });

  let okCount = 0, failCount = 0;
  const perPost = new Map(); // postId -> 新 media 数组

  for (const j of jobs) {
    const label = `#${j.post.id} ${j.media.path.slice(-40)}`;
    try {
      const dr = await req(`/storage/v1/object/${BUCKET}/${j.media.path}`, { headers: H });
      if (!dr.ok) throw new Error(`下载 ${dr.status}`);
      const buf = Buffer.from(await dr.arrayBuffer());
      const b64in = buf.toString("base64");

      const out = await shrink(b64in);
      const tb = Buffer.from(out.b64, "base64");

      const up = await req(`/storage/v1/object/${BUCKET}/${j.tpath}`, {
        method: "POST",
        headers: { ...H, "content-type": "image/jpeg", "x-upsert": "true", "cache-control": "max-age=31536000" },
        body: tb,
      });
      if (!up.ok) throw new Error(`上传 ${up.status} ${(await up.text()).slice(0, 120)}`);

      if (!perPost.has(j.post.id)) perPost.set(j.post.id, j.post.media.map((x) => ({ ...x })));
      perPost.get(j.post.id)[j.idx].thumb = j.tpath;

      okCount++;
      const ratio = ((1 - tb.length / buf.length) * 100).toFixed(0);
      console.log(`  ✓ ${label}  ${(buf.length / 1024).toFixed(0)}KB → ${(tb.length / 1024).toFixed(1)}KB (-${ratio}%)  ${out.srcW}px→${out.w}px`);
    } catch (e) {
      failCount++;
      console.log(`  ✗ ${label}  ${e.message}`);
    }
  }

  for (const [id, media] of perPost) {
    const pr = await req(`/rest/v1/yb_posts?id=eq.${id}`, {
      method: "PATCH",
      headers: { ...H, "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify({ media }),
    });
    console.log(pr.ok ? `  回写 #${id} 成功` : `  回写 #${id} 失败 ${pr.status}`);
  }

  await browser.close();
  console.log(`\n完成：成功 ${okCount} 张，失败 ${failCount} 张，涉及 ${perPost.size} 条帖子`);
})();
