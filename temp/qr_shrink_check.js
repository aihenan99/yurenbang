const { chromium } = require("playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8791/yurenbang-app.html";
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  p.on("pageerror", e => console.log("PAGEERR:", String(e)));
  await p.goto(BASE, { waitUntil: "domcontentloaded" });
  await p.addScriptTag({ path: "E:/育人帮/temp/qr_shrink_fn.js" });
  await p.waitForTimeout(200);
  // 在页面里造 3 张测试图：大尺寸截图风 PNG（含噪点背景）、纯二维码 PNG、照片风 JPEG
  const res = await p.evaluate(async () => {
    const mkFile = async (w, h, kind) => {
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      const g = cv.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);
      // 伪二维码：黑块网格
      g.fillStyle = "#111";
      for (let y = 40; y < h - 40; y += 16) for (let x = 40; x < w - 40; x += 16)
        if ((x * 7 + y * 13) % 5 < 2) g.fillRect(x, y, 12, 12);
      g.fillRect(40, 40, 120, 120); g.fillStyle = "#fff"; g.fillRect(60, 60, 80, 80); g.fillStyle = "#111"; g.fillRect(75, 75, 50, 50);
      if (kind === "noise") {   // 截图背景噪点 → PNG 会很大
        for (let i = 0; i < 40000; i++) { g.fillStyle = `rgba(${i % 255},${i * 3 % 255},${i * 7 % 255},.06)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
      }
      const blob = await new Promise(r => cv.toBlob(r, kind === "photo" ? "image/jpeg" : "image/png", 0.9));
      return new File([blob], "t." + (kind === "photo" ? "jpg" : "png"), { type: kind === "photo" ? "image/jpeg" : "image/png" });
    };
    const out = [];
    for (const [w, h, kind, budget, png, label] of [
      [1080, 1920, "noise", 150, true, "大尺寸带噪截图 PNG→二维码预算"],
      [720, 720, "clean", 150, true, "纯二维码 PNG"],
      [2000, 1500, "photo", 200, false, "大照片 → 证照预算"]]) {
      const f = await mkFile(w, h, kind);
      const t0 = performance.now();
      const url = await shrinkToBudget(f, png ? 560 : 1000, budget, png);
      out.push({ label, inKB: Math.round(f.size / 1024), outKB: Math.round(url.length / 1365), ms: Math.round(performance.now() - t0) });
    }
    return out;
  });
  let ok = true;
  for (const r of res) {
    const pass = r.outKB <= (r.label.includes("证照") ? 200 : 150);
    ok = ok && pass;
    console.log((pass ? "✅" : "❌"), r.label, `输入 ${r.inKB}KB → 输出 ${r.outKB}KB，${r.ms}ms`);
  }
  await b.close();
  process.exit(ok ? 0 : 1);
})();
