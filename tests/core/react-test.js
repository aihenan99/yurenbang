/* 点赞 / 收藏入库回归（2026-11-05）
   背景：此前收藏只写 localStorage、点赞状态每次拉数据都被重置成 false，
   发布者看到的 ⭐ 数永远是 0。现在改为 yb_reacts 入库、计数由库端触发器维护。
   本测试不连真库，用桩替代 YRB_CLOUD，验证「界面 ↔ 数据 ↔ 写库调用」这条链路：
   R1 未登录点 ♥ → 拉起登录，状态不变
   R2 未登录点 ⭐ → 拉起登录，不进收藏夹
   R3 登录后点 ♥ → liked 翻转、按钮点亮、写库参数正确
   R4 登录后点 ⭐ → 进「我的收藏」（S.favIds）、写库参数正确
   R5 写库失败 → 界面与数据一起回滚，并给出提示（不留假象）
   R6 云端收藏回传（yrb-reacts）→ ⭐ 点亮、本机收藏夹补齐
   R7 详情页点 ♥ → 数据同步、数字 +1（refine23 原来只切 class，数字不动）
   R8 全程零脚本错误
   运行前：python -m http.server 8793 --bind 127.0.0.1（项目根，测 /deploy-cn/ 产物） */
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8793/deploy-cn/";
const { chromium } = require("../../temp/pw/node_modules/playwright-core");

let pass = 0, fail = 0;
function ck(name, ok, extra) {
  if (ok) { pass++; console.log("✓ " + name); }
  else { fail++; console.log("✗ " + name + "  → " + extra); }
}

const POST = {
  id: 990201, cloudId: 900201, __cloud: true,
  user: "测试家长", tag: "求助", tagFull: "求助", type: "img",
  title: "点赞收藏入库", text: "登录后点赞与收藏应写库", likes: 3, liked: false,
  favs: 1, faved: false, helps: 0, comments: [], media: [], ts: Date.now(),
};

(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  await ctx.addInitScript("try{localStorage.setItem('yrb_autospeak','0');}catch(e){}");
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));

  await p.goto(BASE + "?react=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  /* 点赞会触发答谢礼物动画，动画层盖住整屏会挡住后续点击（测试里只关心状态，不看动画） */
  await p.addStyleTag({ content: "#gift{pointer-events:none!important}" });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(400);

  const seed = async (patch) => {
    await p.evaluate((arg) => {
      const post = Object.assign(JSON.parse(JSON.stringify(arg.post)), arg.patch || {});
      S.posts = [post];
      S.favIds = [];
      renderFeed();
    }, { post: POST, patch: patch || {} });
    await p.waitForTimeout(250);
  };
  await seed();

  /* ---------- R1 / R2：未登录被拦 ---------- */
  await p.click('#feed .card [data-act="like"]');
  await p.waitForTimeout(500);
  let st = await p.evaluate(() => ({
    liked: !!(S.posts[0] || {}).liked,
    login: (document.querySelector("#loginSheet") || {}).className || "",
  }));
  ck("R1 未登录点 ♥ 不生效且拉起登录",
    st.liked === false && /open|show/.test(st.login), JSON.stringify(st));

  await p.evaluate(() => { try { document.querySelector("#lgX").click(); } catch (e) {} });
  await p.waitForTimeout(200);
  await seed();                       /* 云端加载可能插进来重排，动手前重建桩帖 */
  await p.click('#feed .card [data-act="fav"]');
  await p.waitForTimeout(500);
  st = await p.evaluate(() => ({
    faved: !!(S.posts[0] || {}).faved,
    favs: (S.favIds || []).slice(),
    login: (document.querySelector("#loginSheet") || {}).className || "",
  }));
  ck("R2 未登录点 ⭐ 不生效且拉起登录",
    st.faved === false && st.favs.length === 0 && /open|show/.test(st.login), JSON.stringify(st));

  /* ---------- 桩登录：记录写库调用 ---------- */
  await p.evaluate(() => {
    const C = window.YRB_CLOUD;
    try { document.querySelector("#lgX").click(); } catch (e) {}
    C.signedIn = () => true;
    window.__calls = [];
    window.__mode = "ok";
    C.toggleReact = (cloudId, kind, on) => {
      window.__calls.push([Number(cloudId), kind, !!on]);
      if (window.__mode === "fail") return Promise.resolve({ ok: false, reason: "error", message: "网络开小差了，请稍后重试" });
      return Promise.resolve({ ok: true });
    };
  });
  await p.waitForTimeout(150);
  await seed();

  /* ---------- R3：点赞写库 ---------- */
  await p.click('#feed .card [data-act="like"]');
  await p.waitForTimeout(400);
  st = await p.evaluate(() => ({
    liked: !!S.posts[0].liked,
    on: document.querySelector('#feed .card [data-act="like"]').classList.contains("on"),
    num: (document.querySelector('#feed .card [data-act="like"] .n') || {}).textContent,
    calls: window.__calls.slice(),
  }));
  ck("R3 登录后点赞：状态/按钮/数字/写库都对",
    st.liked === true && st.on === true && st.num === "4" &&
    st.calls.length === 1 && st.calls[0][1] === "like" && st.calls[0][2] === true,
    JSON.stringify(st));

  /* ---------- R4：收藏写库 + 进收藏夹 ---------- */
  await seed();
  await p.click('#feed .card [data-act="fav"]');
  await p.waitForTimeout(400);
  st = await p.evaluate(() => ({
    faved: !!S.posts[0].faved,
    inList: (S.favIds || []).map(String).indexOf("990201") >= 0,
    calls: window.__calls.slice(),
  }));
  ck("R4 登录后收藏：进收藏夹且写库",
    st.faved === true && st.inList === true &&
    st.calls.some(c => c[1] === "fav" && c[2] === true), JSON.stringify(st));

  /* ---------- R5：写库失败回滚 ---------- */
  await seed({ liked: true });        /* 先处在「已点赞」，点一下是取消 */
  await p.evaluate(() => { window.__mode = "fail"; });
  await p.click('#feed .card [data-act="like"]');   /* 这次是取消点赞，写库会失败 */
  await p.waitForTimeout(700);
  st = await p.evaluate(() => ({
    liked: !!S.posts[0].liked,
    on: document.querySelector('#feed .card [data-act="like"]').classList.contains("on"),
    num: (document.querySelector('#feed .card [data-act="like"] .n') || {}).textContent,
    toast: (document.querySelector("#toast") || {}).textContent || "",
  }));
  ck("R5 写库失败整体回滚并提示",
    st.liked === true && st.on === true && st.num === "4" &&
    st.toast.indexOf("网络") >= 0, JSON.stringify(st));
  await p.evaluate(() => { window.__mode = "ok"; });

  /* ---------- R6：云端收藏回传 ---------- */
  await seed();
  await p.evaluate(() => {
    window.dispatchEvent(new CustomEvent("yrb-reacts", { detail: { favs: [990201] } }));
  });
  await p.waitForTimeout(400);
  st = await p.evaluate(() => ({
    faved: !!S.posts[0].faved,
    on: document.querySelector('#feed .card [data-act="fav"]').classList.contains("on"),
    inList: (S.favIds || []).map(String).indexOf("990201") >= 0,
  }));
  ck("R6 云端收藏回传后 ⭐ 点亮并补回收藏夹",
    st.faved === true && st.on === true && st.inList === true, JSON.stringify(st));

  /* ---------- R7：详情页点赞 ---------- */
  await seed();
  await p.waitForTimeout(200);
  await p.click("#feed .card .p-text");
  await p.waitForTimeout(900);
  const opened = await p.evaluate(() => !!document.querySelector("#r23Detail.open"));
  if (opened) {
    const before = await p.evaluate(() => document.querySelector('#r23Detail [data-db="like"]').textContent.trim());
    await p.click('#r23Detail [data-db="like"]');
    await p.waitForTimeout(500);
    st = await p.evaluate(() => ({
      liked: !!S.posts[0].liked,
      on: document.querySelector('#r23Detail [data-db="like"]').classList.contains("on"),
      txt: document.querySelector('#r23Detail [data-db="like"]').textContent.trim(),
      calls: window.__calls.slice(-1),
    }));
    ck("R7 详情页点赞：数据同步且数字 +1",
      st.liked === true && st.on === true && before !== st.txt && st.calls[0] &&
      st.calls[0][1] === "like", before + " → " + JSON.stringify(st));
  } else {
    ck("R7 详情页点赞：数据同步且数字 +1", false, "详情未打开");
  }

  /* ---------- R8 ---------- */
  ck("R8 全程零脚本错误", errs.length === 0, errs.slice(0, 2).join(" | "));

  await b.close();
  console.log(`\n${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
