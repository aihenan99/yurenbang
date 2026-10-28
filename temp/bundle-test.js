/* 部署包冒烟测试（bundle-test）
   断言版：失败时 process.exit(1)，可进 npm run verify --e2e
   依赖：8793 服务（项目根，跑 /deploy-cn/index.html）+ 已 sync 的部署包
   验的是「打包产物能不能独立活起来」——和源码 8796 那条线互补：
   1) 8 个核心功能层标记全部在位（缺一层就是打包漏了）
   2) 本地资源无 404（chunk/bundle 路径必须与 html 对得上）
   3) 未触发自愈补载脚本（script[data-heal] === 0，说明一次加载成功）
   4) 点按进入：遮罩收起、栏目行渲染
   5) 全程无 pageerror

   注意：云端额度耗尽期间 /yrbapi 请求必然失败（402），属环境噪声，
   本测试只判本地同源资源，不把云端失败算作缺陷。
*/
const { chromium } = require("E:/育人帮/temp/pw/node_modules/playwright-core");
const fs = require("node:fs");
const DEPLOY = "E:/育人帮/deploy-cn";

/* 注意：这里不能叫 URL——会遮蔽全局 URL 构造函数（与项目里 var S 遮蔽词法 S 同类坑） */
const PAGE = "http://127.0.0.1:8793/deploy-cn/index.html?bt=" + Date.now();
const LAYERS = [
  ["app", "YRB_APP"], ["r23", "YRB_R23"], ["jj", "YRB_JJ"], ["gate", "YRB_GATE"],
  ["cloud", "YRB_CLOUD"], ["food", "YRB_FOOD"], ["access", "YRB_MYLIST"], ["ppt", "YRB_PPT"]
];

let pass = 0, fail = 0;
function ck(name, cond, info) {
  if (cond) { pass++; console.log("  ✓ " + name + (info ? "  [" + info + "]" : "")); }
  else { fail++; console.log("  ✗ " + name + "  [" + (info || "") + "]"); }
}

(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const p = await b.newPage({ viewport: { width: 412, height: 900 } });

  const errs = [];
  const missing = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("response", (r) => {
    const u = new URL(r.url());
    if (u.origin !== "http://127.0.0.1:8793") return;   /* 云端 402 属环境噪声，不看 */
    if (r.status() < 400) return;
    /* 站点生产环境在根路径，本地却挂在 /deploy-cn/ 下：
       绝对路径 /assets/x 在本地必然 404。这类不算缺陷——
       只要 deploy-cn 里确实有这个文件，就是路径前缀造成的假象。 */
    if (fs.existsSync(DEPLOY + u.pathname)) return;
    missing.push(u.pathname + " " + r.status());
  });

  await p.goto(PAGE, { waitUntil: "load", timeout: 30000 });
  await p.waitForTimeout(2500);

  /* 1. 功能层标记 */
  const s1 = await p.evaluate((list) => {
    const out = {};
    for (const item of list) out[item[0]] = !!window[item[1]];
    return {
      marks: out,
      heal: document.querySelectorAll("script[data-heal]").length,
      scripts: document.querySelectorAll("script[src]").length
    };
  }, LAYERS.map((x) => [x[0], x[1]]));
  const missingLayers = LAYERS.filter((x) => !s1.marks[x[0]]).map((x) => x[0]);
  ck("8 个核心功能层全部就位", missingLayers.length === 0,
    missingLayers.length ? "缺 " + missingLayers.join(",") : s1.scripts + " 个外链脚本");

  /* 2. 资源完整性 */
  ck("本地资源无 404", missing.length === 0, missing.slice(0, 4).join(", "));

  /* 3. 一次加载成功，无需自愈 */
  ck("未触发自愈补载", s1.heal === 0, "data-heal 脚本 " + s1.heal + " 个");

  /* 4. 点按进入 */
  await p.mouse.click(206, 450);
  await p.waitForTimeout(1500);
  const s2 = await p.evaluate(() => {
    const sp = document.getElementById("splash");
    return {
      splashHidden: !!(sp && sp.classList.contains("hidden")),
      chips: [...document.querySelectorAll("#funcrow .f-chip")].map((e) => e.textContent.trim()),
      hasFeed: !!document.getElementById("feed")
    };
  });
  ck("点按收起遮罩进入主界面", s2.splashHidden);
  ck("栏目行渲染出按钮", s2.chips.length >= 2, JSON.stringify(s2.chips));
  ck("信息流容器在位", s2.hasFeed);

  /* 5. 无脚本错误 */
  ck("全程无 pageerror", errs.length === 0, errs.slice(0, 2).join(" | ").slice(0, 200));

  console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
