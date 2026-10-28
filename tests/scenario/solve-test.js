/* solve-test：「标记已解决」收权到发布者 + 云端落库同步 + 失败回滚 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
let pass=0,fail=0;
const ck=(n,c,d)=>{ if(c){pass++;console.log("  ✅",n);} else {fail++;console.log("  ✗",n,d||"");} };
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(String(e.message).slice(0, 120)));
  p.on("console", m => { const t = m.text(); if (t.indexOf("[sv]") === 0) console.log("[pg]", t.slice(0, 120)); });
  await p.goto("http://127.0.0.1:8793/deploy-cn/?sv=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(2200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(800);
  await p.evaluate(() => {
    S.posts.unshift(
      { id: 9901, mine: true, __cloud: true, cloudId: 55, user: "作者", flag: "🇨🇳", ava: "rabbit", type: "img", kinds: ["study"],
        time: "刚刚", tag: "测试", tagFull: "测试", title: "我的求助", text: "测试正文内容", likes: 0, liked: false, favs: 0, faved: false, helps: 0, comments: [] },
      { id: 9902, mine: false, __cloud: true, cloudId: 56, user: "别人", flag: "🇨🇳", ava: "cat", type: "img", kinds: ["study"],
        time: "刚刚", tag: "测试", tagFull: "测试", title: "别人的求助", text: "测试正文内容", likes: 0, liked: false, favs: 0, faved: false, helps: 0, comments: [] });
    renderFeed();
    window.__solveCalls = [];
    try { YRB_CLOUD.solvePost = async (id) => { window.__solveCalls.push(id); return { ok: true }; }; } catch (e) {}
  });
  await p.waitForTimeout(350);
  const openDetail = (id) => p.evaluate(id2 => {
    const card = document.querySelector("#feed .card[data-id='" + id2 + "']");
    (card.querySelector(".r23-detail-link") || card).click();
  }, id);

  /* T1 非发布者：详情页无按钮，状态行保留 */
  await openDetail(9902);
  await p.waitForTimeout(600);
  const t1 = await p.evaluate(() => ({
    btn: !!document.querySelector("#r23Detail .r23-solve"),
    status: (document.querySelector("#r23Detail .r23-status") || {}).textContent || "",
    open: document.getElementById("r23Detail").classList.contains("open")
  }));
  ck("非发布者详情不渲染「标记已解决」按钮", t1.open && !t1.btn, JSON.stringify(t1));
  ck("非发布者仍能看到状态行", t1.status.indexOf("位家长") >= 0, t1.status);
  await p.evaluate(() => document.getElementById("r23DBack").click());
  await p.waitForTimeout(400);

  /* T2 发布者：按钮 → 确认 → solved + 云端被调 */
  await openDetail(9901);
  await p.waitForTimeout(600);
  const t2a = await p.evaluate(() => (document.querySelector("#r23Detail .r23-solve") || {}).textContent || null);
  ck("发布者看到「标记已解决」按钮", t2a && t2a.indexOf("标记") >= 0, t2a);
  await p.evaluate(() => document.querySelector("#r23Detail .r23-solve").click());
  await p.waitForTimeout(400);
  const t2b = await p.evaluate(() => ({ modal: document.getElementById("modal").classList.contains("open"), ok: !!document.getElementById("r23SolveOk") }));
  ck("确认弹窗打开", t2b.modal && t2b.ok, JSON.stringify(t2b));
  await p.evaluate(() => document.getElementById("r23SolveOk").click());
  await p.waitForTimeout(700);
  const t2c = await p.evaluate(() => ({
    status: (document.querySelector("#r23Detail .r23-status") || {}).textContent || "",
    calls: window.__solveCalls
  }));
  ck("标记后状态变「已解决」", t2c.status.indexOf("已解决") >= 0, t2c.status);
  ck("云端 solvePost 被调用且参数正确", t2c.calls.length === 1 && t2c.calls[0] === 55, JSON.stringify(t2c.calls));
  await p.evaluate(() => document.getElementById("r23DBack").click());
  await p.waitForTimeout(400);

  /* T3 云端拒绝：本地回滚为未解决 */
  await p.evaluate(() => {
    try {
      YRB_CLOUD.solvePost = async () => { console.log("[sv] reject-stub called"); return { ok: false, message: "只有求助的发布者可以标记已解决" }; };
      console.log("[sv] stub2 installed:", typeof YRB_CLOUD.solvePost);
    } catch (e) { console.log("[sv] stub2 fail", e.message); }
    const post = S.posts.find(x => x.id === 9901); post.r23Status = "open"; renderFeed();
  });
  await p.waitForTimeout(350);
  await openDetail(9901);
  await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector("#r23Detail .r23-solve").click());
  await p.waitForTimeout(350);
  await p.evaluate(() => document.getElementById("r23SolveOk").click());
  await p.waitForTimeout(900);
  const t3 = await p.evaluate(() => ({
    st: S.posts.find(x => x.id === 9901).r23Status,
    status: (document.querySelector("#r23Detail .r23-status") || {}).textContent || ""
  }));
  ck("云端拒绝后本地回滚为未解决", t3.st === "open" && t3.status.indexOf("位家长") >= 0, JSON.stringify(t3));

  console.log("pageerrors:", errs.length ? errs.join(" | ") : "无");
  console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("崩溃:", e); process.exit(2); });
