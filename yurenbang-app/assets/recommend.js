/* 育人帮 · 推荐排序层（recommend.js，2026-11-04）
   需求：「每次重新打开网页或 APP 时浏览内容显示不同的求助，采取流行的推荐算法」。
   原来信息流按发布时间倒序（cloud.js），置顶的永远是同一条、老帖永远沉底。

   本层只提供「给一批帖子打分并排序」的纯函数，由 app.js 的 renderFeed 一行钩子调用：
     ① 互动质量 点赞1 / 帮忙3 / 留言2 / 玫瑰2 / 收藏1.5（回应比点赞值钱）
     ② 时间衰减 (质量+1)/(小时+2)^1.4（HN/Reddit 的 gravity，比 1.8 温和）
     ③ 新鲜 ×1.35(≤6h) / ×1.12(≤24h)；自己的帖子 ×1.8(≤48h)
     ④ 已读 ×0.55；上次打开时的头三条 ×0.75（让新面孔有机会）
     ⑤ 兴趣 ×(1+0.5×话题 + 0.25×作者)：从点赞/收藏/留言/阅读累计，只存本机
     ⑥ 探索抖动 ×0.65~1.35：按会话 seed 抽签 → 「每次打开不一样」的来源
     ⑦ 打散：同作者不连排、同话题最多连排 2 条

   抖动用 hash(id, seed) 现算而不是缓存到帖子对象上——refine23 合并云端字段会重建
   对象，缓存的抖动会丢、顺序会跳。调试：?rec=0 关层 / ?recseed=N 固定种子 /
   ?reclog=1 打印分数拆解 / YRB_RECO.explain(帖子)。 */

(function () {
  "use strict";

  var SEEN_TOP_KEY = "yrb_rec_top";   /* 上一次打开时的头三条（只存 id，本机） */
  var GRAVITY = 1.4;                  /* 时间衰减指数 */
  var JITTER = 0.35;                  /* 探索抖动幅度 ±35% */
  var W_LIKE = 1, W_HELP = 3, W_CMT = 2, W_ROSE = 2, W_FAV = 1.5;

  var off = false, noisy = false;
  try {
    off = /[?&]rec=0(?:&|$)/.test(location.search);
    noisy = /[?&]reclog=1(?:&|$)/.test(location.search);
  } catch (e) {}

  /* 会话种子：优先 URL 指定（测试可复现），否则每打开一次页面重新抽 */
  var SEED = (function () {
    try {
      var m = /[?&]recseed=(\d+)/.exec(location.search);
      if (m) return (Number(m[1]) >>> 0) || 1;
    } catch (e) {}
    return ((Date.now() % 4294967296) ^ Math.floor(Math.random() * 4294967296)) >>> 0;
  })();

  /* 帖子 id + 种子的确定性抖动（-1~1），不落任何缓存 */
  function jitterOf(p) {
    var x = ((Number(p && p.id) || 0) ^ SEED) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 2246822507) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 3266489909) >>> 0;
    x = (x ^ (x >>> 16)) >>> 0;
    return 1 + ((x / 4294967296) * 2 - 1) * JITTER;
  }

  function readTop() {
    try {
      var a = JSON.parse(localStorage.getItem(SEEN_TOP_KEY) || "[]");
      return Object.prototype.toString.call(a) === "[object Array]" ? a : [];
    } catch (e) { return []; }
  }
  var lastTop = readTop(), wroteTop = false;
  function saveTop(ids) {
    try { localStorage.setItem(SEEN_TOP_KEY, JSON.stringify(ids.slice(0, 3))); } catch (e) {}
  }

  /* ---------- 上下文：时间、已读、兴趣画像（每次排序时按当前数据现算） ---------- */
  function postList() {
    try { return (typeof S !== "undefined" && S.posts) || []; } catch (e) { return []; }
  }
  function historyList() {
    try { return (typeof S !== "undefined" && S.history) || []; } catch (e) { return []; }
  }

  function ageHours(p) {
    var t = p && p.ts;
    if (t) return Math.max(0, (Date.now() - t) / 3600000);
    /* 本地刚发的、或没有时间戳的：当作新的（不抢第一，但也不沉底） */
    return p && p.mine ? 0 : 72;
  }

  function buildCtx(list) {
    var seen = {}, i, p, h;

    /* 已读：本机历史（近几年打开过的详情，access.js 记录，最多 60 条） */
    var his = historyList();
    for (i = 0; i < his.length; i++) {
      h = his[i];
      if (h && h.id != null) seen[String(h.id)] = 1;
    }
    var top = {};
    for (i = 0; i < lastTop.length; i++) top[String(lastTop[i])] = 1;

    /* 兴趣画像：话题 / 作者 的加权累计 */
    var tagW = {}, userW = {}, total = 0;
    function add(kind, key, w) {
      if (!key) return;
      if (kind === "t") tagW[key] = (tagW[key] || 0) + w;
      else userW[key] = (userW[key] || 0) + w;
      total += w;
    }
    for (i = 0; i < list.length; i++) {
      p = list[i];
      if (!p) continue;
      var w = 0;
      if (p.liked) w += 3;
      if (p.faved) w += 3;
      if (p.comments && p.comments.length) {
        for (var j = 0; j < p.comments.length; j++) {
          if (p.comments[j] && p.comments[j].mine) { w += 2; break; }
        }
      }
      if (w) { add("t", p.tagFull || p.tag, w); add("u", p.user, w); }
    }
    /* 读过但没点赞的，同样说明在意这个话题（权重低一点） */
    for (i = 0; i < his.length; i++) {
      h = his[i];
      var s = (h && h.s) || {};
      add("t", s.tag, 1.5);
      add("u", s.user, 1.5);
    }

    return {
      seen: function (p) { return !!seen[String(p.id)]; },
      top: function (p) { return !!top[String(p.id)]; },
      affTag: function (p) {
        var k = p.tagFull || p.tag, v = tagW[k] || 0;
        return v ? Math.min(1, v / 10) : 0;
      },
      affUser: function (p) {
        var v = userW[p.user] || 0;
        return v ? Math.min(1, v / 10) : 0;
      },
      size: total
    };
  }

  /* ---------- 打分：返回明细，便于 explain 与调试 ---------- */
  function parts(p, ctx) {
    ctx = ctx || buildCtx(postList());
    p = p || {};
    var eng = (p.likes || 0) + (p.liked ? 1 : 0)
      + W_HELP * (p.helps || 0)
      + W_CMT * ((p.comments && p.comments.length) || 0)
      + W_ROSE * ((p.roses && p.roses.length) || 0)
      + W_FAV * ((p.favs || 0) + (p.faved ? 1 : 0));

    var h = ageHours(p);
    var base = (eng + 1) / Math.pow(h + 2, GRAVITY);

    var fresh = h <= 6 ? 1.35 : (h <= 24 ? 1.12 : 1);
    var mine = (p.mine && h <= 48) ? 1.8 : 1;
    var hot = p.hot ? 1.15 : 1;
    var seen = ctx.seen(p) ? 0.55 : 1;
    var give = ctx.top(p) ? 0.75 : 1;
    var aff = 1 + 0.5 * ctx.affTag(p) + 0.25 * ctx.affUser(p);
    var jit = jitterOf(p);

    return {
      eng: eng, ageH: h, base: base, fresh: fresh, mine: mine, hot: hot,
      seen: seen, give: give, aff: aff, jit: jit,
      score: base * fresh * mine * hot * seen * give * aff * jit
    };
  }

  function score(p) { return parts(p).score; }

  /* ---------- 多样性打散：同作者不连排、同话题最多连排 2 条 ---------- */
  function diversify(items) {
    var out = [], rest = items.slice(), lastUser = "", tagRun = "", tagCnt = 0;
    while (rest.length) {
      var pick = -1;
      for (var i = 0; i < rest.length && i < 6; i++) {
        var p = rest[i].p, t = p.tagFull || p.tag || "";
        if (p.user !== lastUser && !(t === tagRun && tagCnt >= 2)) { pick = i; break; }
      }
      if (pick < 0) pick = 0;                      /* 实在避不开（只有一个人发帖）就照排 */
      var it = rest.splice(pick, 1)[0], q = it.p, qt = q.tagFull || q.tag || "";
      out.push(it);
      lastUser = q.user || "";
      if (qt === tagRun) tagCnt++; else { tagRun = qt; tagCnt = 1; }
    }
    return out;
  }

  /* ---------- 对外：给一批帖子排序（不修改入参） ---------- */
  function order(list) {
    if (!list || list.length < 2) return list || [];
    if (off) return list;
    try {
      var ctx = buildCtx(list);
      var items = [];
      for (var i = 0; i < list.length; i++) {
        if (!list[i]) continue;
        items.push({ p: list[i], s: parts(list[i], ctx).score });
      }
      items.sort(function (a, b) { return b.s - a.s; });
      var ranked = diversify(items).map(function (x) { return x.p; });

      /* 记下这一次的头三条，下次打开时它们主动让位（这就是「隔一次就见到新面孔」） */
      if (!wroteTop && ranked.length >= 3) {
        wroteTop = true;
        saveTop(ranked.map(function (p) { return p.id; }));
      }
      if (noisy) {
        try {
          console.log("[推荐] seed=" + SEED + " 顺序=" + ranked.map(function (p) { return p.id; }).join(","));
          items.slice(0, 8).forEach(function (x) {
            var d = parts(x.p, ctx);
            console.log("  #" + x.p.id + " " + (x.p.tagFull || x.p.tag) + " 分=" + d.score.toFixed(3) +
              " (质量" + d.eng + " 龄" + d.ageH.toFixed(1) + "h → 基" + d.base.toFixed(3) +
              " ×鲜" + d.fresh + " ×我" + d.mine + " ×阅" + d.seen + " ×让" + d.give +
              " ×趣" + d.aff.toFixed(2) + " ×抖" + d.jit.toFixed(2) + ")");
          });
        } catch (e) {}
      }
      return ranked;
    } catch (e) {
      return list;                                  /* 打分出任何问题都不许让首页空着 */
    }
  }

  window.YRB_RECO = {
    version: "1.0.0",
    ready: true,
    order: order,
    score: score,
    explain: function (p) { return parts(p, buildCtx(postList())); },
    seed: function () { return SEED; },
    disabled: function () { return off; }
  };
})();
