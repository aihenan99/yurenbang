/* 推荐排序层（recommend.js）回归
   用户需求：「每次重新打开网页或 APP 时浏览内容显示不同的求助，采取流行的推荐算法」。

   断言：
   R1 层在位：YRB_RECO.order 是函数，种子每次都抽一个新的
   R2 质量优先：互动多（点赞/帮忙/留言）的帖排在高互动但更老的帖前面
   R3 时间衰减：同质量时，2 小时前的排 72 小时前的之前
   R4 已读降权：进过浏览历史的帖子分数 ×0.55，排名下滑
   R5 上次让位：localStorage 里记着的「上次头三条」分数 ×0.75
   R6 同会话稳定：连续 renderFeed 三次，顺序一字不变（点个赞不该让卡片跳位）
   R7 每次打开不同：4 次全新会话（各自独立存储）顺序至少出现 2 种
   R8 指定种子可复现：?recseed=7 两次打开顺序完全一致
   R9 多样性打散：同一作者不连排
   R10 开关：?rec=0 时退回原始顺序（不排序）
   R11 脏数据不炸：缺字段的帖子也能排，不抛错
   R12 全程无脚本错误
   运行前：python -m http.server 8793 --bind 127.0.0.1（项目根，测 /deploy-cn/ 产物） */
const BASE = process.env.YRB_BASE || "http://127.0.0.1:8793/deploy-cn/";
const { chromium } = require("../../temp/pw/node_modules/playwright-core");

let pass = 0, fail = 0;
function ck(name, ok, extra) {
  if (ok) { pass++; console.log("✓ " + name); }
  else { fail++; console.log("✗ " + name + "  → " + extra); }
}

const H = 3600000;
/* 固定桩数据：不依赖云端，质量/时间都可控 */
function stubs(now) {
  return [
    { id: 9401, user: "家长甲", tag: "求助", tagFull: "求助", type: "text", text: "带图求助 A", likes: 10, helps: 5, comments: [{}, {}, {}], favs: 2, ts: now - 2 * H },
    { id: 9402, user: "家长乙", tag: "经验", tagFull: "经验", type: "text", text: "经验帖 B", likes: 2, helps: 1, comments: [], favs: 0, ts: now - 4 * H },
    { id: 9403, user: "家长丙", tag: "求助", tagFull: "求助", type: "text", text: "求助 C", likes: 3, helps: 1, comments: [], favs: 0, ts: now - 6 * H },
    { id: 9404, user: "家长丁", tag: "经验", tagFull: "经验", type: "text", text: "经验 D", likes: 1, helps: 1, comments: [], favs: 0, ts: now - 9 * H },
    { id: 9405, user: "家长戊", tag: "求助", tagFull: "求助", type: "text", text: "求助 E", likes: 2, helps: 0, comments: [], favs: 0, ts: now - 12 * H },
    { id: 9406, user: "家长己", tag: "案例", tagFull: "案例", type: "text", text: "案例 F", likes: 2, helps: 1, comments: [], favs: 0, ts: now - 16 * H }
  ];
}

const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";

async function newPage(b, extraInit) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  await ctx.addInitScript(
    "try{localStorage.setItem('yrb_autospeak','0');}catch(e){}" +
    "Object.defineProperty(navigator,'webdriver',{get:()=>false});" +
    (extraInit || "")
  );
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", e => { errs.push(e.message); console.log("PAGEERR", e.message); });
  await p.goto(BASE + "?rec=" + Date.now(), { waitUntil: "load", timeout: 45000 });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(400);
  return { p, ctx, errs };
}

/* 注入桩帖并重绘，返回页面里看到的顺序 */
async function feedWith(p, list) {
  return await p.evaluate(data => {
    S.posts = data;
    renderFeed();
    return [...document.querySelectorAll("#feed .card")].map(c => +c.dataset.id);
  }, list);
}

(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const now = Date.now();

  /* ---- R1/R2/R3/R9：质量、衰减、打散 ---- */
  {
    const { p, errs } = await newPage(b, "");
    const list = stubs(now);
    const order = await feedWith(p, list);
    const reco = await p.evaluate(() => ({
      on: !!(window.YRB_RECO && typeof YRB_RECO.order === "function"),
      seed: window.YRB_RECO ? YRB_RECO.seed() : 0
    }));
    ck("R1 推荐层在位", reco.on && reco.seed > 0, JSON.stringify(reco));

    ck("R2 互动质量优先（9401 高互动排第一）", order[0] === 9401, JSON.stringify(order));

    /* R3：同质量、只差时间的两帖 */
    const same = await p.evaluate(() => {
      const n = Date.now();
      const mk = (id, ageH) => ({ id: id, user: "家长" + id, tag: "求助", tagFull: "求助", type: "text",
        text: "同质帖", likes: 2, helps: 1, comments: [], ts: n - ageH * 3600000 });
      const fresh = mk(9410, 2), old = mk(9411, 72);
      return { fresh: YRB_RECO.score(fresh), old: YRB_RECO.score(old) };
    });
    ck("R3 时间衰减（2 小时前的分数高于 72 小时前）", same.fresh > same.old * 1.5,
      JSON.stringify(same));

    /* R9：同作者不连排——给甲连发三条高互动帖，看会不会挤在一起 */
    const dup = await p.evaluate(() => {
      const n = Date.now();
      const out = [];
      for (let i = 0; i < 3; i++) out.push({ id: 9420 + i, user: "家长甲", tag: "求助", tagFull: "求助",
        type: "text", text: "同一作者 " + i, likes: 6, helps: 3, comments: [], ts: n - (3 + i) * 3600000 });
      out.push({ id: 9430, user: "家长乙", tag: "经验", tagFull: "经验", type: "text", text: "别人乙",
        likes: 5, helps: 3, comments: [], ts: n - 5 * 3600000 });
      out.push({ id: 9431, user: "家长丙", tag: "案例", tagFull: "案例", type: "text", text: "别人丙",
        likes: 4, helps: 2, comments: [], ts: n - 8 * 3600000 });
      const r = YRB_RECO.order(out).map(x => x.id);
      return r;
    });
    let adj = 0;
    for (let i = 1; i < dup.length; i++) if ([9420, 9421, 9422].includes(dup[i]) && [9420, 9421, 9422].includes(dup[i - 1])) adj++;
    ck("R9 同作者不连排（5 条里只有 3 条同作者时完全错开）", adj === 0, JSON.stringify(dup));

    /* R6：同会话连续重绘顺序稳定 */
    const a1 = await feedWith(p, list);
    const a2 = await feedWith(p, list);
    const a3 = await feedWith(p, list);
    ck("R6 同会话重绘顺序稳定", a1.join() === a2.join() && a2.join() === a3.join(),
      a1.join() + " / " + a2.join() + " / " + a3.join());
    ck("R12 无脚本错误", errs.length === 0, errs.join(" | "));
    await p.context().close();
  }

  /* ---- R4：已读降权 ---- */
  {
    const { p } = await newPage(b, "");
    const r = await p.evaluate(() => {
      const n = Date.now();
      const post = { id: 9450, user: "家长庚", tag: "求助", tagFull: "求助", type: "text",
        text: "读过的帖子", likes: 4, helps: 2, comments: [], ts: n - 3 * 3600000 };
      S.posts = [post];
      S.history = [];
      const before = YRB_RECO.explain(post);
      S.history = [{ id: 9450, t: n, s: { tag: "求助", user: "家长庚" } }];
      const after = YRB_RECO.explain(post);
      return { b: before.score, a: after.score, seenMul: after.seen, hist: S.history.length };
    });
    ck("R4 读过的帖子降权 ×0.55", Math.abs(r.seenMul - 0.55) < 1e-6 && r.a < r.b,
      JSON.stringify(r));
    await p.context().close();
  }

  /* ---- R5：上次头三条让位（在加载前把 id 写进 localStorage） ---- */
  {
    const { p } = await newPage(b, "try{localStorage.setItem('yrb_rec_top','[9401,9402,9403]');}catch(e){}");
    const r = await p.evaluate(() => {
      const n = Date.now();
      const post = { id: 9401, user: "家长甲", tag: "求助", tagFull: "求助", type: "text",
        text: "上次的头条", likes: 5, helps: 2, comments: [], ts: n - 3 * 3600000 };
      const other = { id: 9460, user: "家长辛", tag: "经验", tagFull: "经验", type: "text",
        text: "没见过的", likes: 5, helps: 2, comments: [], ts: n - 3 * 3600000 };
      return { give: YRB_RECO.explain(post).give, other: YRB_RECO.explain(other).give };
    });
    ck("R5 上次头三条让位 ×0.75", Math.abs(r.give - 0.75) < 1e-6 && r.other === 1, JSON.stringify(r));
    await p.context().close();
  }

  /* ---- R8：同一种子可复现 ---- */
  {
    const seq = [];
    for (let k = 0; k < 2; k++) {
      const { p } = await newPage(b, "");
      await p.goto(BASE + "?recseed=7&run=" + k, { waitUntil: "load", timeout: 45000 });
      await p.waitForTimeout(1200);
      await p.evaluate(() => { try { enterApp(); } catch (e) {} });
      await p.waitForTimeout(300);
      seq.push(await feedWith(p, stubs(now)));
      await p.context().close();
    }
    ck("R8 指定 recseed 顺序可复现", seq[0].join() === seq[1].join(), seq[0].join() + " vs " + seq[1].join());
  }

  /* ---- R7：每次打开都不一样（4 次全新会话，无固定种子）
     用「质量打平」的一组帖（同样点赞/帮忙/时间）来测：真实社区的帖子往往就在这个区间，
     顺序该由探索抖动决定，而不是每次都一模一样 ---- */
  {
    const tie = (n) => [0, 1, 2, 3, 4, 5].map(i => ({
      id: 9500 + i, user: "家长" + "ABCDEF"[i], tag: "求助", tagFull: "求助", type: "text",
      text: "同质帖 " + i, likes: 2, helps: 1, comments: [], ts: n - 5 * H
    }));
    const seqs = [];
    for (let k = 0; k < 4; k++) {
      const { p } = await newPage(b, "");
      seqs.push((await feedWith(p, tie(Date.now()))).join(","));
      await p.context().close();
      await new Promise(r => setTimeout(r, 30));
    }
    const uniq = new Set(seqs);
    ck("R7 每次打开顺序不同（4 次开出 " + uniq.size + " 种）", uniq.size >= 3, seqs.join(" | "));
  }

  /* ---- R10：?rec=0 关闭排序 ---- */
  {
    const { p } = await newPage(b, "");
    await p.goto(BASE + "?rec=0&run=1", { waitUntil: "load", timeout: 45000 });
    await p.waitForTimeout(1200);
    await p.evaluate(() => { try { enterApp(); } catch (e) {} });
    await p.waitForTimeout(300);
    const raw = stubs(now).reverse();          /* 故意给一个非打分序 */
    const order = await feedWith(p, raw);
    ck("R10 ?rec=0 保持原序", order.join() === raw.map(x => x.id).join(),
      order.join() + " vs " + raw.map(x => x.id).join());
    await p.context().close();
  }

  /* ---- R11：脏数据不炸 ---- */
  {
    const { p } = await newPage(b, "");
    const r = await p.evaluate(() => {
      try {
        const bad = [{ id: 9470, text: "什么都没有" }, { id: 9471 }, { id: 9472, user: "某", likes: "3" }];
        const out = YRB_RECO.order(bad).map(x => x.id);
        return { ok: true, out: out, n: out.length };
      } catch (e) { return { ok: false, e: String(e) }; }
    });
    ck("R11 缺字段的帖子也能排", r.ok && r.n === 3, JSON.stringify(r));
    await p.context().close();
  }

  await b.close();
  console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
  process.exit(fail ? 1 : 0);
})();
