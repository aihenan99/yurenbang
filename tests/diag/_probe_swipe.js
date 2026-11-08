/* 排查探针：横滑事件为什么没生效（只看状态，不改代码） */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const BASE = process.env.YRB_PROD || "https://xn--gmqq09al6z.cn/";

(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, hasTouch: true, isMobile: true, serviceWorkers: "block" });
  const p = await ctx.newPage();
  p.on("pageerror", e => console.log("PAGEERR", e.message));
  await p.goto(BASE + "?pb=" + Date.now(), { waitUntil: "load", timeout: 60000 });
  await p.waitForTimeout(2000);
  await p.evaluate(() => { try { const s = document.querySelector("#splash"); if (s && !s.classList.contains("hidden")) s.click(); } catch (e) {} });
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(600);

  await p.evaluate(() => switchTab("me"));
  await p.waitForTimeout(500);

  const info = await p.evaluate(() => {
    const el = document.elementFromPoint(200, 500);
    const chain = [];
    let n = el;
    while (n && n !== document.body) {
      const cs = getComputedStyle(n);
      chain.push({ tag: n.tagName + (n.id ? "#" + n.id : "") + (n.className && typeof n.className === "string" ? "." + n.className.trim().split(/\s+/).join(".") : ""),
        ox: cs.overflowX, sw: n.scrollWidth, cw: n.clientWidth });
      n = n.parentElement;
    }
    return {
      tab: window.YRB_NAVBACK ? window.YRB_NAVBACK.tab() : "?",
      depth: window.YRB_NAVBACK ? window.YRB_NAVBACK.depth() : -1,
      list: window.YRB_NAVBACK ? window.YRB_NAVBACK.list() : [],
      guarded: window.YRB_NAVBACK ? window.YRB_NAVBACK.guarded() : false,
      landed: window.YRB_NAVBACK ? window.YRB_NAVBACK.landed() : false,
      hit: el ? el.tagName + "#" + el.id + "." + (typeof el.className === "string" ? el.className : "") : "null",
      noswipe: !!(el && el.closest && el.closest("[data-noswipe]")),
      chain: chain.filter(x => x.ox !== "visible").slice(0, 6),
      touchSupported: typeof Touch === "function",
      histState: JSON.stringify(history.state),
      histLen: history.length
    };
  });
  console.log(JSON.stringify(info, null, 2));

  /* 手动打一次滑动，并记录 handler 是否进入（用 touchend 里可观察的副作用：tab 变化） */
  const r = await p.evaluate(() => {
    const el = document.elementFromPoint(200, 500) || document.body;
    const mk = (x, y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y });
    function fire(type, list, changed) {
      const ev = new TouchEvent(type, { bubbles: true, cancelable: true, touches: list, targetTouches: list, changedTouches: changed });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    }
    fire("touchstart", [mk(200, 500)], [mk(200, 500)]);
    fire("touchend", [], [mk(80, 505)]);
    return { tabAfter: window.YRB_NAVBACK ? window.YRB_NAVBACK.tab() : "?" };
  });
  await p.waitForTimeout(400);
  const after = await p.evaluate(() => ({
    tab: window.YRB_NAVBACK ? window.YRB_NAVBACK.tab() : "?",
    activeId: (document.querySelector(".page.active") || {}).id
  }));
  console.log("dispatch 后:", JSON.stringify(r), "→ 400ms 后:", JSON.stringify(after));

  await b.close();
})();
