/* 本地冒烟：新客户端层是否就位、登录面板是否为用户名密码形态
   跑法：node tests/diag/sb-local-ui.js  （需 8794 端口静态服务） */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, serviceWorkers: "block",
    userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e).slice(0, 160)));
  p.on("console", m => { if (m.type() === "error") errs.push("console:" + m.text().slice(0, 120)); });

  await p.goto("http://127.0.0.1:8794/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.waitForFunction(() => {
    const a = document.getElementById("app"); return a && a.offsetHeight > 100;
  }, { timeout: 15000 }).catch(() => {});

  const base = await p.evaluate(() => ({
    hasSB: !!(window.YRB_SB && YRB_SB.createClient),
    cloudEnabled: !!(window.YRB_CLOUD && YRB_CLOUD.enabled && YRB_CLOUD.enabled()),
    endpoint: window.YRB_CLOUD && YRB_CLOUD.__ep || null,
    // 健康探针里 yb-sb 是否 ok
    health: (() => {
      try {
        const h = window.YRB_HEALTH && YRB_HEALTH.last && YRB_HEALTH.last();
        return h ? h.layers.filter(x => /yb-sb|cloud/.test(x.id)).map(x => x.id + ":" + (x.ok ? "ok" : "fail")) : null;
      } catch (e) { return null; }
    })()
  }));

  // 打开登录面板
  await p.evaluate(() => YRB_CLOUD.openLogin());
  await p.waitForTimeout(600);

  const sheet = await p.evaluate(() => {
    const vis = el => el && getComputedStyle(el).display !== "none" && el.offsetHeight > 0;
    const acct = document.getElementById("lgAcct");
    const pwd = document.getElementById("lgPwd2");
    const btn = document.getElementById("lgPwdSubmit");
    const otpPane = document.getElementById("lgPanePhone");
    const tab = document.getElementById("lgTabPwd");
    return {
      sheetOpen: document.getElementById("loginSheet").classList.contains("open"),
      acctVisible: vis(acct), pwdVisible: vis(pwd), btnVisible: vis(btn),
      acctPlaceholder: acct && acct.placeholder,
      btnText: btn && btn.textContent,
      otpPaneHidden: !vis(otpPane),
      tabText: tab && tab.textContent.trim(),
      regLink: (document.getElementById("lgToReg") || {}).textContent,
    };
  });

  // 切到注册态
  await p.click("#lgToReg");
  await p.waitForTimeout(200);
  const reg = await p.evaluate(() => ({
    btnText: document.getElementById("lgPwdSubmit").textContent,
    link: document.getElementById("lgToReg").textContent,
  }));
  await p.screenshot({ path: "temp/sb-login-sheet.png", clip: { x: 0, y: 0, width: 390, height: 720 } });

  console.log(JSON.stringify({ base, sheet, reg, errs }, null, 1));
  await b.close();
})();
