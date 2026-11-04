const { chromium } = require("./pw/node_modules/playwright-core");
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", headless: true });
  const p = await b.newPage({ viewport: { width: 412, height: 900 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  p.on("console", m => { const t = m.text(); if (/^NB/.test(t)) console.log(t); });
  await p.goto("http://127.0.0.1:8796/yurenbang-app.html?rp2=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.waitForTimeout(1200);
  const splash = await p.evaluate(() => { const s = document.querySelector("#splash"); return !!(s && !s.classList.contains("hidden")); });
  if (splash) { await p.click("#splash"); await p.waitForTimeout(600); }
  await p.evaluate(() => {
    S.posts.unshift({ id: 9101, user: "举报测试家长", time: "刚刚", tag: "求助", text: "测试举报链路", likes: 1, favs: 0, helps: 0, ava: "animal", comments: [], roses: [] });
    if (typeof renderFeed === "function") renderFeed();
    window.__NB_DEBUG = 1;
    const det = document.getElementById("r23Detail");
    ["add","remove"].forEach(m => {
      const o = DOMTokenList.prototype[m];
      DOMTokenList.prototype[m] = function () {
        if (this === det.classList && String(arguments[0]).indexOf("open") > -1)
          console.log("NBX " + m + " detail.open ← " + new Error().stack.split("\n").slice(2, 6).join(" | "));
        return o.apply(this, arguments);
      };
    });
    window.addEventListener("popstate", function (e) {
      console.log("NBX POP state=" + JSON.stringify(e.state) + " guarded=" + (window.YRB_NAVBACK && YRB_NAVBACK.guarded()));
    });
  });
  await p.waitForTimeout(300);
  const openUI = async () => {
    await p.evaluate(() => {
      let el = document.getElementById("__t_open");
      if (!el) { el = document.createElement("button"); el.id = "__t_open"; document.body.appendChild(el); }
      el.setAttribute("data-r23detail", "9101"); el.click();
    });
    await p.waitForTimeout(400);
    await p.evaluate(() => { const x = document.querySelector('#r23Detail [data-db="report"]'); if (x) x.click(); });
    await p.waitForTimeout(300);
  };
  await openUI();
  // 横滑关面板
  await p.evaluate(() => {
    const from = document.querySelector("#r23Detail .r23-dbody") || document.getElementById("r23Detail");
    const r = from.getBoundingClientRect();
    const mk = (ty, cx, cy) => new TouchEvent(ty, { bubbles: true, cancelable: true,
      touches: ty === "touchend" ? [] : [new Touch({ identifier: 1, target: from, clientX: cx, clientY: cy })],
      changedTouches: [new Touch({ identifier: 1, target: from, clientX: cx, clientY: cy })] });
    from.dispatchEvent(mk("touchstart", r.left + r.width / 2, r.top + 120));
    from.dispatchEvent(mk("touchend", r.left + r.width / 2 - 130, r.top + 123));
  });
  await p.waitForTimeout(800);   // 给足 sync/back/popstate 时间
  console.log("滑关后", await p.evaluate(() => ({ rp: !!document.querySelector("#r23Report.open"), d: YRB_NAVBACK.depth(), list: YRB_NAVBACK.list(), url: location.href })));
  // 重新打开
  await p.evaluate(() => { const x = document.querySelector('#r23Detail [data-db="report"]'); if (x) x.click(); });
  await p.waitForTimeout(600);
  console.log("重开后", await p.evaluate(() => ({ rp: !!document.querySelector("#r23Report.open"), d: YRB_NAVBACK.depth(), url: location.href })));
  const u0 = p.url();
  await p.evaluate(() => history.back());
  await p.waitForTimeout(600);
  console.log("返回后", await p.evaluate(() => ({ rp: !!document.querySelector("#r23Report.open"), detail: !!document.querySelector("#r23Detail.open"), d: YRB_NAVBACK.depth(), url: location.href })), "url同?", p.url() === u0);
  await b.close();
})();
