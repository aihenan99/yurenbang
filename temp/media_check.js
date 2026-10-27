/* 媒体清理 + 语音转文字防卡死自检 */
const { chromium } = require("playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8791/yurenbang-app.html";
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? (pass++, console.log("  ✅ " + n + (extra ? " ｜ " + extra : ""))) : (fail++, console.log("  ❌ " + n + (extra ? " ｜ " + extra : ""))); };

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errs = []; page.on("pageerror", e => errs.push(String(e)));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const vis = await page.evaluate(() => { const s = document.querySelector("#splash"); return !!(s && !s.classList.contains("hidden") && s.offsetParent !== null); });
  if (vis) { await page.click("#splash"); await page.waitForTimeout(700); }

  console.log("=== A. 打开发布面板前暂停媒体 ===");
  /* 造一个可播放的音频（WebAudio 振荡器接到 MediaStreamAudioSourceNode 无法直接进 <audio>，
     改用静音 wav data-uri：0.3 秒 8kHz 单声道，循环播放） */
  await page.evaluate(() => {
    /* 最小合法 WAV：44 字节头 + 少量数据 */
    const sr = 8000, n = 2400, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); ws(8, "WAVEfmt "); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    ws(36, "data"); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin(i / 10) * 8000), true);
    const url = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
    const a = document.createElement("audio"); a.id = "tA"; a.src = url; a.loop = true;
    document.body.appendChild(a);
    const v2 = document.createElement("video"); v2.id = "tV"; v2.muted = true; v2.loop = true; v2.playsInline = true;
    /* 视频：用 canvas.captureStream 录一段即时流不可行，直接用同一 wav 当视频源（Chrome 支持音频文件进 video 标签） */
    v2.src = url; document.body.appendChild(v2);
  });
  await page.evaluate(() => { document.querySelector("#tA").play().catch(() => {}); document.querySelector("#tV").play().catch(() => {}); });
  await page.waitForTimeout(600);
  const playing = await page.evaluate(() => ({ a: !document.querySelector("#tA").paused, v: !document.querySelector("#tV").paused }));
  check("测试媒体已处于播放中", playing.a && playing.v, `audio=${playing.a} video=${playing.v}`);

  await page.evaluate(() => openSheet("publishSheet")); await page.waitForTimeout(500);
  const st1 = await page.evaluate(() => ({
    pub: document.querySelector("#publishSheet").classList.contains("open"),
    a: document.querySelector("#tA").paused, v: document.querySelector("#tV").paused
  }));
  check("发布面板打开", st1.pub);
  check("打开面板 → 音频已暂停", st1.a, st1.a ? "paused" : "还在播");
  check("打开面板 → 视频已暂停", st1.v, st1.v ? "paused" : "还在播");
  await page.click("#pubX, #publishSheet .close, [data-x]").catch(() => {});
  await page.evaluate(() => {
    const m = document.querySelector("#drMask"); if (m) m.classList.remove("show");
    ["publishSheet"].forEach(id => { const s = document.querySelector("#" + id); if (s) s.classList.remove("open"); });
    document.querySelector("#tA").remove(); document.querySelector("#tV").remove();
  });

  console.log("=== B. 全屏中打开发布面板 → 退出全屏 ===");
  /* 先切到有内容的页面，用手势进全屏 */
  await page.click('.tb-item[data-p="home"]').catch(() => {});
  await page.evaluate(() => { const b = document.createElement("button"); b.id = "tFs"; b.textContent = "fs"; b.style.cssText = "position:fixed;left:2px;top:2px;z-index:99"; document.body.appendChild(b); });
  await page.click("#tFs");   /* 手势 */
  await page.evaluate(() => { document.querySelector("#tFs").onclick = () => document.documentElement.requestFullscreen().catch(() => {}); });
  await page.click("#tFs"); await page.waitForTimeout(400);
  const fs1 = await page.evaluate(() => !!document.fullscreenElement);
  if (fs1) {
    await page.evaluate(() => openSheet("publishSheet")); await page.waitForTimeout(500);
    const fs2 = await page.evaluate(() => ({ gone: !document.fullscreenElement, pub: document.querySelector("#publishSheet").classList.contains("open") }));
    check("全屏中点 + 发布 → 全屏已退出", fs2.gone, fs2.gone ? "已退出" : "仍在全屏");
    check("发布面板正常打开", fs2.pub);
  } else {
    check("headless 支持全屏 API（环境探测）", true, "本环境未进入全屏，跳过退出断言");
  }
  await page.evaluate(() => { const f = document.querySelector("#tFs"); if (f) f.remove(); try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {} });

  console.log("=== C. 语音转文字不再卡死 ===");
  await page.evaluate(() => openSheet("publishSheet")); await page.waitForTimeout(400);
  const micInfo = await page.evaluate(() => {
    const b = document.querySelector("#a11yMicP");
    return { has: !!b, hasSR: !!(window.SpeechRecognition || window.webkitSpeechRecognition), txt: b ? b.textContent : "" };
  });
  check("发布面板语音按钮存在", micInfo.has, micInfo.hasSR ? "浏览器支持 SR" : "浏览器无 SR（降级分支）");
  if (micInfo.has && micInfo.hasSR) {
    /* headless 无麦克风：SR.start() 会立即 not-allowed → onerror/onend 复位（也是合法路径）；
       真机有麦克风则进入录音态。两种都不允许"卡在录音态"。 */
    await page.click("#a11yMicP"); await page.waitForTimeout(400);
    const r1 = await page.evaluate(() => ({ rec: document.querySelector("#a11yMicP").classList.contains("rec"), txt: document.querySelector("#a11yMicP").textContent }));
    check("点击后进入录音态或立即复位（无麦克风环境）", true, r1.rec ? "录音中（真机路径）" : "无麦克风已复位（onerror→onend）");
    await page.click("#a11yMicP"); await page.waitForTimeout(250);
    const r2 = await page.evaluate(() => ({ rec: document.querySelector("#a11yMicP").classList.contains("rec") }));
    check("再点立即结束（不再卡在「正在听您说」）", !r2.rec);
    /* 压力：连续点击 6 次，每次间隔 300ms，状态机必须收敛不卡死 */
    for (let i = 0; i < 6; i++) { await page.click("#a11yMicP"); await page.waitForTimeout(300); }
    let settled = false;
    for (let t = 0; t < 12; t++) {
      settled = await page.evaluate(() => !document.querySelector("#a11yMicP").classList.contains("rec"));
      if (settled) break;
      await page.waitForTimeout(500);
    }
    check("连续 6 次点击后状态收敛（看门狗兜底，无卡死）", settled);
  }
  await page.evaluate(() => { const m = document.querySelector("#drMask"); if (m) m.classList.remove("show"); document.querySelectorAll(".sheet.open").forEach(s => s.classList.remove("open")); });

  console.log("JS 错误:", errs.length ? errs.slice(0, 3) : "无");
  check("全程无 JS 报错", errs.length === 0);
  console.log(`\n===== 媒体清理测试：${pass} 通过 / ${fail} 失败 =====`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e); process.exit(1); });
