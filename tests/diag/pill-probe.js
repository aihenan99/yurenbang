/* 探针：跟读胶囊 #mfAuto 在各状态下的可见性与可点击性
   状态：① 首页信息流 ② 点卡片进详情全屏 ③ 退出全屏回详情 ④ 关闭详情回首页 ⑤ 切到案例 tab 再回首页 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const POSTS = [{ id: 9101, user: "测试家长", title: "孩子写作业拖拉", text: "写作业总拖到十点，一说就哭，求办法。",
  likes: 1, favs: 0, helps: 1, time: "10 分钟前", ava: "rabbit", tag: "求助", comments: [], roses: [], vis: 0, urg: 1 }];
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  await ctx.addInitScript("Object.defineProperty(navigator,'webdriver',{get:()=>false});try{localStorage.setItem('yrb_autospeak','1');}catch(e){}");
  const p = await ctx.newPage();
  p.on("pageerror", e => console.log("PAGEERR", e.message));
  await p.goto("http://127.0.0.1:8794/index.html?pill=" + Date.now(), { waitUntil: "load" });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(500);
  await p.evaluate(l => { S.posts = l; try { switchTab("home"); } catch (e) {} try { renderFeed(); } catch (e) {} }, POSTS);
  await p.waitForTimeout(700);

  const probe = (tag) => p.evaluate(t => {
    const el = document.getElementById("mfAuto");
    if (!el) return { tag: t, exists: false };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
    const hit = document.elementFromPoint(cx, cy);
    return {
      tag: t, exists: true, display: cs.display, z: cs.zIndex, vis: cs.visibility, op: cs.opacity,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      inView: r.top >= 0 && r.bottom <= innerHeight && r.width > 0,
      hit: hit ? (hit.id || hit.className || hit.tagName) : null,
      clickable: !!(hit && (hit === el || el.contains(hit))),
      text: el.textContent.trim(), parent: el.parentElement ? (el.parentElement.id || el.parentElement.tagName) : null
    };
  }, tag);

  console.log("① 首页", JSON.stringify(await probe("home")));

  await p.evaluate(() => { const b2 = document.querySelector('#feed .card[data-id="9101"] [data-r23detail]'); if (b2) b2.click(); });
  await p.waitForTimeout(1200);
  console.log("② 全屏详情", JSON.stringify(await probe("fs-detail")));

  await p.evaluate(() => { const d = document.getElementById("r23Detail"); d.classList.remove("mf-fs"); });
  await p.waitForTimeout(500);
  console.log("③ 退出全屏", JSON.stringify(await probe("detail")));

  await p.evaluate(() => { document.getElementById("r23DBack").click(); });
  await p.waitForTimeout(700);
  console.log("④ 回首页", JSON.stringify(await probe("back-home")));

  await p.evaluate(() => { try { switchTab("cases"); } catch (e) {} });
  await p.waitForTimeout(700);
  console.log("⑤ 案例 tab", JSON.stringify(await probe("cases")));

  await p.evaluate(() => { try { switchTab("home"); } catch (e) {} });
  await p.waitForTimeout(700);
  console.log("⑥ 回首页", JSON.stringify(await probe("home2")));

  await b.close();
})();
