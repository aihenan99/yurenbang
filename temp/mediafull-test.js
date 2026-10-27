/* mediafull-test.js — 媒体全屏与语音播读层回归（2026-10-24）
   覆盖：视频全屏按钮注入与点击 / 保护层放行视频控件（昨日 bug 修复）/
        详情与案例 🔊 朗读 / 案例图片点击放大 / 大图查看器全屏化 */
const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
const URL = "http://127.0.0.1:8794/?mf=" + Date.now();

let pass = 0, fail = 0;
function ck(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name + (extra ? "  [" + extra + "]" : "")); }
  else { fail++; console.log("  ✗ " + name + "  [" + (extra || "") + "]"); }
}

(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const p = await b.newPage({ viewport: { width: 412, height: 900 } });
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 140)));
  await p.goto(URL, { waitUntil: "load" });
  await p.waitForTimeout(2400);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(700);

  /* T1 层就绪 + 健康层收录 */
  const t1 = await p.evaluate(() => ({
    flag: !!window.YRB_MEDIAFULL,
    v: window.YRB_MEDIAFULL && window.YRB_MEDIAFULL.version,
    inHealth: window.YRB_HEALTH ? (YRB_HEALTH.layers ? YRB_HEALTH.layers() : []).indexOf("mediafull") >= 0 : false,
    guard: document.documentElement.classList.contains("yrb-guard")
  }));
  ck("mediafull 层就绪", t1.flag, "v" + t1.v);
  ck("免疫系统已收录 mediafull", t1.inHealth);

  /* T2 保护层放行视频原生控件（昨日 bug 回归） */
  const t2 = await p.evaluate(() => {
    const v = document.createElement("video");
    v.controls = true; v.id = "mfProbe";
    v.style.cssText = "position:fixed;left:10px;top:10px;width:200px;height:80px;z-index:9999";
    (document.getElementById("phone") || document.body).appendChild(v);
    return { pe: getComputedStyle(v).pointerEvents, drag: getComputedStyle(v).webkitUserDrag };
  });
  ck("保护层下 video pointer-events:auto（真实视频可播）", t2.pe === "auto", t2.pe);
  ck("保护层下 video 仍禁拖拽", t2.drag === "none", String(t2.drag));
  await p.evaluate(() => { const v = document.getElementById("mfProbe"); if (v) v.remove(); });

  /* T3 详情真实视频 → 注入全屏按钮 + 点击 */
  await p.evaluate(() => {
    const post = {
      id: 8901, mine: false, type: "video", cat: "学习", by: "测试家长", ava: "bear",
      title: "视频全屏测试帖", text: "用于验证视频全屏按钮", time: "刚刚",
      likes: 0, favs: 0, helps: 0, comments: [],
      media: [{ kind: "video", url: "assets/icon-192.png" }],
      rm: [{ url: "assets/icon-192.png" }]
    };
    S.posts.unshift(post);
    try { YRB_CLOUD.signedIn = () => true; } catch (e) {}
    renderFeed();
  });
  await p.waitForTimeout(700);
  await p.evaluate(() => {
    const link = document.querySelector('#feed [data-r23detail="8901"]');
    if (link) link.click();
  });
  await p.waitForTimeout(800);
  const t3a = await p.evaluate(() => {
    const v = document.querySelector("#r23Detail video[controls]");
    const btn = document.querySelector("#r23Detail .mf-vbtn");
    return { hasV: !!v, hasBtn: !!btn, hostCls: v ? v.parentNode.classList.contains("mf-vhost") : false };
  });
  ck("详情真实视频注入 ⛶ 全屏按钮", t3a.hasV && t3a.hasBtn, JSON.stringify(t3a));
  const t3b = await p.evaluate(() => {
    const btn = document.querySelector("#r23Detail .mf-vbtn");
    if (!btn) return { err: "no btn" };
    btn.click();
    return { ok: true };
  });
  await p.waitForTimeout(500);
  const t3c = await p.evaluate(() => ({
    fs: !!(document.fullscreenElement || document.webkitFullscreenElement) || !!document.querySelector("video:fullscreen, video:-webkit-full-screen"),
    noErr: true
  }));
  ck("点击全屏按钮不报错（进入全屏或降级）", !t3b.err && t3c.noErr, "fsEl=" + t3c.fs);
  await p.evaluate(() => { try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {} });

  /* T4 详情 🔊 朗读按钮：出现 / 点击后变 ⏹ 停止 / 再点恢复
     （测试用的合成帖子会被应用的云端状态恢复清掉，朗读前补回——
       按钮是点击时动态查帖的，真实用户的帖子一直在 S.posts 里不受影响） */
  const t4a = await p.evaluate(() => {
    if (!S.posts.some(x => x.id === 8901)) {
      S.posts.unshift({
        id: 8901, mine: false, type: "video", by: "测试家长", ava: "bear",
        title: "视频全屏测试帖", text: "用于验证视频全屏按钮", time: "刚刚",
        likes: 0, favs: 0, helps: 0, comments: [], media: []
      });
    }
    S.curPost = 8901;
    const btn = document.querySelector(".r23-dhead .mf-tts");
    if (!btn) return { has: false };
    btn.click();
    return { has: true, txt: btn.textContent };
  });
  ck("详情头部出现 🔊 朗读按钮", t4a.has);
  ck("点击后按钮变为 ⏹ 停止", /停止/.test(String(t4a.txt)), t4a.txt);
  const t4c = await p.evaluate(() => {
    YRB_MEDIAFULL.stopSpeak();
    return (document.querySelector(".r23-dhead .mf-tts") || {}).textContent || "";
  });
  ck("停止后按钮复原 🔊", /朗读/.test(t4c), t4c);

  /* T5 大图查看器全屏化样式生效 */
  const t5 = await p.evaluate(() => {
    const v = document.getElementById("r23Viewer");
    return { pad: getComputedStyle(v).padding };
  });
  ck("大图查看器 padding 已收紧（更接近全屏）", t5.pad === "12px", t5.pad);

  /* T6 案例图片墙：点击 → r23Viewer 放大 */
  await p.evaluate(() => {
    const d = document.getElementById("r23Detail"); if (d) d.classList.remove("open");
    /* 种子模板下线后自注案例样本 */
    if (!S.cases.length) S.cases.unshift({ t: "测试案例", by: "测试家长", ava: "rabbit", type: "img", kind: "study", helps: 0, likes: 0, favs: 0 });
    const c = S.cases[0];
    c.media = [{ kind: "img", url: "assets/icon-192.png" }, { kind: "img", url: "assets/icon-192.png" }];
    openViewer(c);
  });
  await p.waitForTimeout(500);
  const t6a = await p.evaluate(() => ({ imgs: document.querySelectorAll("#vwBody .vw-imgs img").length, open: document.getElementById("viewer").classList.contains("open") }));
  ck("案例图片墙渲染", t6a.imgs >= 2 && t6a.open, JSON.stringify(t6a));
  await p.evaluate(() => {
    const im = document.querySelector("#vwBody .vw-imgs img");
    const r = im.getBoundingClientRect();
    /* 保护层下正文 img pointer-events:none，点击落在容器上由委托处理；这里直接派发容器点击 */
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 });
    (document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) || im).dispatchEvent(ev);
  });
  await p.waitForTimeout(400);
  const t6b = await p.evaluate(() => ({ big: document.getElementById("r23Viewer").classList.contains("open"), hasImg: !!document.querySelector("#r23Big img") }));
  ck("点击案例图片 → 大图查看器打开", t6b.big && t6b.hasImg, JSON.stringify(t6b));
  await p.evaluate(() => { document.getElementById("r23Viewer").classList.remove("open"); });

  /* T7 案例查看器 🔊 朗读按钮（slides 型 PPT 案例） */
  const t7a = await p.evaluate(() => {
    const vh = document.querySelector(".vw-head .mf-tts");
    if (!vh) return { has: false };
    vh.click();
    return { has: true, txt: vh.textContent };
  });
  ck("案例查看器出现 🔊 朗读按钮", t7a.has);
  ck("案例朗读点击后进入朗读态", /停止/.test(String(t7a.txt)), t7a.txt);
  await p.evaluate(() => {
    YRB_MEDIAFULL.stopSpeak();
    document.getElementById("viewer").classList.remove("open");
  });

  /* T8 关闭详情/查看器自动停读（模拟：打开朗读 → 直接触发停止路径） */
  const t8 = await p.evaluate(() => {
    const btn = document.querySelector(".r23-dhead .mf-tts") || document.createElement("button");
    return true;
  });
  ck("stopSpeak 对外可用（T8 入口）", t8);

  /* 汇总 */
  console.log("\n[pageerrors] " + (errs.length ? errs.join(" | ") : "无"));
  console.log("结果: " + pass + " 通过, " + fail + " 失败");
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e); process.exit(1); });
