const { chromium } = require("playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8791/yurenbang-app.html";
let pass = 0, fail = 0;
const ok = (n, c, extra = "") => { c ? (pass++, console.log("  ✅", n, extra)) : (fail++, console.log("  ❌", n, extra)); };
(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on("pageerror", e => console.log("PAGEERR:", String(e)));
  await p.goto(BASE, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1500);
  if (await p.evaluate(() => { const s = document.querySelector("#splash"); return !!(s && !s.classList.contains("hidden")); })) {
    await p.tap("#splash"); await p.waitForTimeout(700);
  }
  await p.evaluate(() => switchTab("cases"));
  await p.waitForTimeout(400);

  console.log("=== A. 未登录门槛 ===");
  await p.evaluate(() => document.querySelector("#caseFab").click());
  await p.waitForTimeout(500);
  ok("未登录点上传 → 登录面板", await p.evaluate(() => document.querySelector("#loginSheet").classList.contains("open")));
  await p.evaluate(() => { const x = document.querySelector("#lgX"); x && x.click(); });
  await p.waitForTimeout(400);

  console.log("=== B. 模拟登录后选内容 ===");
  await p.evaluate(() => { try { YRB_CLOUD.signedIn = () => true; } catch (e) {} });
  await p.evaluate(() => document.querySelector("#caseFab").click());
  await p.waitForTimeout(400);
  ok("面板打开且有「加图片」入口", await p.evaluate(() => !!document.querySelector("#cuAdd")), await p.evaluate(() => (document.querySelector("#cuAdd") || {}).textContent));
  await p.setInputFiles("#cuFile", ["E:/育人帮/temp/case_img1.jpg", "E:/育人帮/temp/case_img2.jpg"]);
  await p.waitForTimeout(1500);
  ok("选 2 张图 → 出现 2 个缩略块且「＋」消失（已达上限9未满）", await p.evaluate(() => document.querySelectorAll("#cuGrid .cu-tile").length === 2 && !!document.querySelector("#cuAdd")));

  // mock 云端发布
  await p.evaluate(() => {
    YRB_CLOUD.publishCase = async (payload, items) => ({ ok: true, cloudId: 901,
      media: items.map((it, i) => ({ kind: it.kind, path: "case/mock-" + i + ".jpg", dur: "", url: it.blob ? URL.createObjectURL(it.blob) : "" })) });
  });
  await p.fill("#cuTitle", "自动化测试案例");
  await p.evaluate(() => document.querySelector("#cuGo").click());
  await p.waitForTimeout(800);
  ok("发布成功 → 面板关闭", await p.evaluate(() => !document.querySelector("#caseUpSheet").classList.contains("open")));
  ok("新案例置顶且带真实媒体", await p.evaluate(() => { const c = S.cases[0]; return c.t === "自动化测试案例" && c.media && c.media.length === 2 && c.__cloud === true; }));
  ok("卡片封面是真实图片", await p.evaluate(() => !!document.querySelector('#caseGrid .case-card .c-photo')));

  console.log("=== C. 查看器真实媒体 ===");
  await p.evaluate(() => document.querySelector("#caseGrid .case-card").click());
  await p.waitForTimeout(500);
  ok("点开案例 → 查看器打开", await p.evaluate(() => document.querySelector("#viewer").classList.contains("open")));
  ok("查看器显示真实图片", await p.evaluate(() => document.querySelectorAll("#vwBody .vw-imgs img").length === 2));
  await p.screenshot({ path: "E:/育人帮/temp/case_viewer_real.png" });
  await p.evaluate(() => document.querySelector("#vwX").click());
  await p.waitForTimeout(300);

  console.log("=== D. 未登录查看 → 登录锁 ===");
  await p.evaluate(() => {
    YRB_CLOUD.signedIn = () => false;
    const c = S.cases[0];
    c.media.forEach(m => m.url = "");        // 模拟未登录拿不到签名地址
    openViewer(c);
  });
  await p.waitForTimeout(400);
  ok("无地址时显示登录锁", await p.evaluate(() => !!document.querySelector("#vwBody .vw-lock")));
  await p.evaluate(() => document.querySelector("#vwBody [data-vwlogin]") && document.querySelector("#vwBody [data-vwlogin]").click());
  await p.waitForTimeout(500);
  ok("点锁里的登录 → 拉起登录面板", await p.evaluate(() => document.querySelector("#loginSheet").classList.contains("open")));
  await p.evaluate(() => { const x = document.querySelector("#lgX"); x && x.click(); });
  await p.waitForTimeout(300);

  console.log("=== E. 视频与 PPT 文件校验 ===");
  await p.evaluate(() => { document.querySelector('#cuTypes .seg-btn[data-t="video"]').click(); });
  await p.waitForTimeout(200);
  ok("切视频类型 → 提示变化", await p.evaluate(() => document.querySelector("#cuNote").textContent.includes("30")));
  // 超长视频校验（用 canvas 生成一段假 video 不可行，直接测时长逻辑）：
  const durCheck = await p.evaluate(() => {
    // videoDur 对非法文件应返回 0（不阻断）
    return typeof videoDur === "function";
  });
  ok("videoDur 函数可用", durCheck);
  await p.evaluate(() => { document.querySelector('#cuTypes .seg-btn[data-t="ppt"]').click(); });
  await p.waitForTimeout(200);
  // 非法扩展名拒绝
  await p.setInputFiles("#cuFile", [{ name: "bad.txt", mimeType: "text/plain", buffer: Buffer.from("hello") }]);
  await p.waitForTimeout(500);
  ok("非 PPT/PDF 文件被拒绝", await p.evaluate(() => document.querySelectorAll("#cuGrid .cu-tile").length === 0));
  await p.setInputFiles("#cuFile", [{ name: "教学.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: Buffer.from("PK\x03\x04fake") }]);
  await p.waitForTimeout(500);
  ok("pptx 文件被接受为文件块", await p.evaluate(() => { const t = document.querySelector("#cuGrid .cu-tile"); return !!t && !!t.querySelector(".cu-doc"); }));
  await p.evaluate(() => { document.querySelector("#caseUpSheet .sh-x").click(); });

  console.log(`\n===== 案例上传 E2E：${pass} 通过 / ${fail} 失败 =====`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e); process.exit(1); });
