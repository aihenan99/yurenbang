/* tapfs-test：信息流卡片视频一点即全屏（抖音式） */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
let pass=0,fail=0;
const ck=(n,c,d)=>{ if(c){pass++;console.log("  ✅",n);} else {fail++;console.log("  ✗",n,d||"");} };
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 120)));
  await p.goto("http://127.0.0.1:8793/deploy-cn/?tapfs=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(2200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(700);

  /* 注入一张带真实视频的卡片（m-realvideo 结构与 cardHTML 一致） */
  await p.evaluate(() => {
    const feed = document.getElementById("feed");
    feed.insertAdjacentHTML("afterbegin", `
      <div class="card" data-id="9601">
        <div class="media m-realvideo">
          <video src="data:video/mp4;base64,AAAA" playsinline preload="metadata"></video>
          <span class="v-play"><svg viewBox="0 0 24 24"><path d="M7 4 L20 12 L7 20 Z"/></svg></span>
          <span class="v-dur">▶ 0:20 · 点画面全屏</span>
        </div>
      </div>`);
  });
  await p.waitForTimeout(300);

  const vid = "#feed .card[data-id='9601'] .m-realvideo video";

  /* T1 单击视频 → 进入全屏（document.fullscreenElement === video） */
  await p.click(vid);
  await p.waitForTimeout(900);
  const t1 = await p.evaluate(sel => {
    const v = document.querySelector(sel);
    const fsEl = document.fullscreenElement;
    return { isFs: fsEl === v, anyFs: !!fsEl };
  }, vid);
  ck("单击视频进入全屏", t1.isFs, "anyFs=" + t1.anyFs);

  /* T2 退出全屏，恢复常态 */
  await p.evaluate(() => { try { document.exitFullscreen(); } catch (e) {} });
  await p.waitForTimeout(500);

  /* T3 卡片不含 controls（原生控制条只在全屏里） */
  const t3 = await p.evaluate(sel => {
    const v = document.querySelector(sel);
    return { noControls: !v.hasAttribute("controls"), hasPlayBadge: !!document.querySelector("#feed .card[data-id='9601'] .v-play") };
  }, vid);
  ck("卡片视频无原生 controls", t3.noControls);
  ck("保留中央播放角标", t3.hasPlayBadge);

  /* T4 不再同时触发进详情（捕获拦截生效）——点视频后详情面板不开 */
  const t4 = await p.evaluate(() => {
    const d = document.getElementById("r23Detail");
    return d ? !d.classList.contains("open") : true;
  });
  ck("点击视频不会误开详情面板", t4);

  console.log("pageerrors:", errs.length ? errs.join(" | ") : "无");
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("崩溃:", e); process.exit(2); });
