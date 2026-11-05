/* 本地验收：案例广场 = 文档首页缩略图（cover v2，2026-11-03）
   ① 无素材的图文案例 → .c-paper 白纸 + 首行标题 + 正文前几段（真实文字）
   ② 正文首图可取的图文案例 → .c-photo 使用正文图
   ③ 普通图片案例不受影响（仍是真首图）
   ④ 截图留档 temp/casecover.png 供人工看版式 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const SITE = process.env.YRB_SITE || "http://127.0.0.1:8794/";
let pass = 0, fail = 0;
function ck(name, ok, extra) {
  if (ok) { pass++; console.log("  ✓ " + name + (extra ? "  " + extra : "")); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  " + JSON.stringify(extra) : "")); }
}
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block", deviceScaleFactor: 2 });
  const p = await ctx.newPage(); const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 160)));
  await p.goto(SITE + "?cc=" + Date.now(), { waitUntil: "load", timeout: 30000 });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(800);

  const out = await p.evaluate(() => {
    const html1 = '<h2>自己的孩⼦自⼰爱</h2><p>很多家长把全部精力放在孩子身上，却忘了自己也需要被照顾。</p>' +
      '<p>先把自己安顿好，才有余力接住孩子的情绪。可以从小事开始：每天留十分钟给自己。</p>' +
      '<p>第三段：长期的自我消耗会变成对孩子的隐性苛责。</p>';
    const html2 = '<h2>带画面的那篇</h2><img data-yrb-media="0"><p>这一篇正文第一张图就是封面。</p>';
    S.cases = [
      { t: "自己的孩⼦自⼰爱", by: "爱河南99", ava: "rabbit", type: "img", helps: 0, likes: 0, favs: 0,
        content_html: html1, media: [] },
      { t: "带画面的那篇", by: "爱河南99", ava: "rabbit", type: "img", helps: 0, likes: 0, favs: 0,
        content_html: html2, media: [{ kind: "img", url: "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="#7ec8b8"/></svg>') }] },
      { t: "普通图片案例", by: "某家长", ava: "rabbit", type: "img", helps: 1, likes: 2, favs: 0,
        media: [{ kind: "img", url: "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="#f0a8a8"/></svg>') }] },
      { t: "纯图片无正文", by: "某家长", ava: "rabbit", type: "img", helps: 0, likes: 0, favs: 0, media: [] },
      /* 素材在但取不到地址（未登录/签名失效）→ 也要退回文档首页 */
      { t: "素材没签名", by: "某家长", ava: "rabbit", type: "img", helps: 0, likes: 0, favs: 0,
        media: [{ kind: "img" }],
        content_html: "<p>未登录时图片地址拿不到，但正文文字应该照常给到浏览者。</p><p>第二段用来凑够版面。</p>" }
    ];
    try { switchTab("cases"); } catch (e) {}
    try { renderCases(); } catch (e) {}
    return true;
  });
  await p.waitForTimeout(900);

  const cards = await p.evaluate(() => Array.from(document.querySelectorAll("#caseGrid .case-card")).map(card => {
    const paper = card.querySelector(".c-paper");
    const photo = card.querySelector(".c-photo");
    return {
      t: (card.querySelector(".c-title") || {}).textContent,
      paper: !!paper,
      head: paper ? (paper.querySelector(".c-paper-h") || {}).textContent : "",
      lines: paper ? paper.querySelectorAll(".c-paper-t").length : 0,
      text: paper ? paper.textContent.replace(/\s+/g, " ").trim() : "",
      photo: photo ? String(photo.getAttribute("src")).slice(0, 22) : "",
      svgLeft: !!card.querySelector(".c-thumb svg")
    };
  }));
  console.log("卡片:", JSON.stringify(cards, null, 1));

  ck("① 图文案例渲染出文档首页（正文真实文字）", cards[0].paper && /很多家长把全部精力/.test(cards[0].text) && cards[0].lines >= 2, cards[0].text.slice(0, 40));
  ck("①b 通用插画已移除", !cards[0].svgLeft);
  ck("①c 标题重复时不重复画（省掉首行标题）", !cards[0].head && !/^自己的孩⼦自⼰爱很多/.test(cards[0].text), "head=" + JSON.stringify(cards[0].head) + " text=" + cards[0].text.slice(0, 14));
  ck("② 首图案例用正文图当封面", !cards[1].paper && /data:image/.test(cards[1].photo));
  ck("③ 普通图片案例不受影响", !!cards[2].photo && !cards[2].paper);
  ck("④ 无正文无素材：保持插画", !cards[3].paper && cards[3].svgLeft);
  ck("⑤ 有素材但无地址：退回文档首页", cards[4] && cards[4].paper && /未登录时图片地址/.test(cards[4].text), cards[4] && cards[4].text.slice(0, 24));

  /* ⑥ 点开卡片：查看器要能直接看到正文（不是空白/加载） */
  await p.evaluate(() => { document.querySelector("#caseGrid .case-card").click(); });
  await p.waitForTimeout(600);
  const vw = await p.evaluate(() => {
    const open = document.getElementById("viewer").classList.contains("open");
    const body = document.querySelector("#viewer .yrb-doc-body");
    return { open: open, hasBody: !!body, text: body ? body.textContent.replace(/\s+/g, " ").slice(0, 30) : "" };
  });
  ck("⑥ 打开案例即可看到正文", vw.open && vw.hasBody && vw.text.length > 8, JSON.stringify(vw));
  await p.evaluate(() => { try { document.getElementById("viewer").classList.remove("open"); } catch (e) {} });
  await p.waitForTimeout(300);

  /* 截图：滚到案例页 */
  await p.evaluate(() => { try { switchTab("cases"); } catch (e) {} });
  await p.waitForTimeout(500);
  await p.screenshot({ path: "temp/casecover.png" });
  console.log("pageerrors:", errs.length ? errs.join(" | ") : "无");
  console.log("结果: " + pass + " 通过 / " + fail + " 失败");
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("脚本异常:", e.message); process.exit(2); });
