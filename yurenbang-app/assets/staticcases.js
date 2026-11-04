/* ============================================================================
   育人帮 · 静态内容层 staticcases.js（2026-11-01）
   ---------------------------------------------------------------------------
   为什么有这一层：
     云端隔离期间首页信息流与案例广场都是空的，访客第一眼看到的是「维护中」，
     会以为整站废了。而 /anli/ 下的 10 篇案例是纯静态页，与云服务完全无关，
     一直可读、不消耗任何云额度。

   做法（遵守「增强层只注入+委托，不改 app.js/refine23 结构」）：
     · 只向 #page-home / #page-cases 里插入**兄弟节点**，不碰 app.js 的渲染函数，
       因此 app 每 20 秒重渲染时不会把这个区块冲掉；
     · 仅在云端处于 isolated 态时插入，恢复后自动撤掉，把位置还给真实信息流；
     · 卡片刻意做成普通链接（跳静态页），不接应用内的查看器，
       避免引出一堆点赞/留言/帮忙按钮在隔离期全部 402 的坏体验。

   对外：window.YRB_STATICCASE = { list, version, refresh, mountAll, unmount }
   ========================================================================== */
(function () {
  "use strict";
  if (window.YRB_STATICCASE) return;

  var VERSION = "2026-11-01";

  /* 10 篇案例（标题为卡片用的短标题，正文页标题更完整；摘要取原文首句） */
  var LIST = [
    { s: "erhai-zhengchao", t: "二宝出生后，大宝开始尿裤子、打弟弟",
      d: "二宝出生三个月，六岁的大宝突然要喂饭、尿裤子、偷偷掐弟弟。" },
    { s: "gedai-yangyu-chongtu", t: "奶奶追着喂饭、穿三件衣服：隔代养育我只争三条底线",
      d: "老人带娃，追着喂饭、穿太多、一看动画片一下午。" },
    { s: "haizi-bei-guli", t: "孩子说「没人跟我玩」、不想上学",
      d: "三年级女儿连着几天说「没人跟我玩」，早上赖着不肯去学校。" },
    { s: "haizi-chenmi-shouji", t: "孩子沉迷手机，一说就翻脸：从抢手机到定停车位",
      d: "四年级的儿子放学就要手机，一刷两小时，说一句就摔门。" },
    { s: "haizi-sahuang", t: "一年级孩子撒谎：我怕的不是谎，是他不敢说实话",
      d: "儿子一年级，作业没写说写了，杯子碎了说是猫弄的。" },
    { s: "haizi-xie-zuoye-tuola", t: "写作业拖到两个半小时，到 50 分钟的五步调整",
      d: "每天写作业像打仗，吼到嗓子哑、孩子哭到打嗝。" },
    { s: "kaoshi-kaoza-qingxu", t: "考砸了撕卷子：第一句话决定还能不能谈",
      d: "数学考了 68 分，儿子进门就把卷子撕了，反锁房门哭了一小时。" },
    { s: "qingchunqi-buyuan-goutong", t: "青春期回家就关门，我把谈话改成并肩做事",
      d: "初二开始，儿子回家就进房间反锁门，问「今天怎么样」永远只有一个「嗯」。" },
    { s: "xie-zuowen-mei-hua-shuo", t: "作文憋两小时写不出三百字：先让他说，再让他写",
      d: "三年级第一篇作文，儿子对着空本子坐了两小时，写了一百字还全是「很开心」。" },
    { s: "zaoshang-moceng-shangxue", t: "一年级早晨像打仗：我把流程画成了一张卡",
      d: "刚上一年级那半年，每天早上叫八遍不起床、穿衣服要十分钟。" }
  ];

  var HOME_N = 4;          /* 首页只放 4 篇，其余去案例库看，避免首页过长 */
  var TICK_MS = 1600;      /* 轮询隔离态；只在内存里读变量，不发请求 */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* 运行时读状态：cloud.js 与本层同为脚本，加载顺序变化时也不会取到旧值 */
  function stateOf(kind) {
    try {
      var C = window.YRB_CLOUD;
      if (!C) return "";
      var fn = kind === "cases" ? C.casesState : C.postsState;
      return (typeof fn === "function" && fn()) || "";
    } catch (e) { return ""; }
  }

  function cardHTML(c, i) {
    return '<a class="sc-card" href="/anli/' + esc(c.s) + '.html">'
      + '<span class="sc-t">' + esc(c.t) + "</span>"
      + '<span class="sc-d">' + esc(c.d) + "</span>"
      + '<span class="sc-a">读这一篇 →</span>'
      + "</a>";
  }

  function blockHTML(title, sub, n, all) {
    return '<div class="sc-h">' + esc(title) + "</div>"
      + '<div class="sc-sub">' + esc(sub) + "</div>"
      + '<div class="sc-list">' + LIST.slice(0, n).map(cardHTML).join("") + "</div>"
      + (all ? '<a class="sc-more" href="/anli/">看全部 ' + LIST.length + " 篇案例 →</a>" : "");
  }

  /* 在 anchor 之前插入；已存在则原地更新，不重复插入（observer/轮询安全） */
  function ensure(id, before, html, pageClassTarget) {
    var anchor = document.getElementById(before);
    if (!anchor || !anchor.parentNode) return false;
    var host = anchor.parentNode;
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement("section");
      el.id = id;
      el.className = "sc-wrap";
      el.setAttribute("aria-label", "静态案例推荐");
      host.insertBefore(el, anchor);
    }
    if (el.getAttribute("data-v") !== VERSION) {
      el.innerHTML = html;
      el.setAttribute("data-v", VERSION);
    }
    if (pageClassTarget) pageClassTarget.classList.add("sc-on");
    return true;
  }

  function remove(id, pageClassTarget) {
    var el = document.getElementById(id);
    if (el && el.parentNode) el.parentNode.removeChild(el);
    if (pageClassTarget) pageClassTarget.classList.remove("sc-on");
  }

  /* 2026-11-01 迁移后新增：云端为空也算「需要兜底」
     隔离期由 isolated 触发；换到自建库后信息流是空的，如果只看 isolated，
     访客会看到一片空白 —— 改为「云端正常但没有内容」时同样展示静态案例。 */
  function feedEmpty() {
    try {
      if (typeof YRB_CLOUD === "undefined" || !YRB_CLOUD.postsState) return false;
      if (YRB_CLOUD.postsState() !== "ok") return false;
      var feed = document.getElementById("feed");
      if (!feed) return false;
      return feed.querySelectorAll("article.card[data-id]").length === 0;
    } catch (e) { return false; }
  }
  function gridEmpty() {
    try {
      if (typeof YRB_CLOUD === "undefined" || !YRB_CLOUD.casesState) return false;
      if (YRB_CLOUD.casesState() !== "ok") return false;
      var g = document.getElementById("caseGrid");
      if (!g) return false;
      return g.querySelectorAll(".case-card").length === 0;
    } catch (e) { return false; }
  }

  function mountAll() {
    var homePage = document.getElementById("page-home");
    var casePage = document.getElementById("page-cases");

    var postsIso = stateOf("posts") === "isolated";
    if (postsIso || feedEmpty()) {
      ensure("scHome", "feed", blockHTML(
        postsIso ? "云端社区正在恢复，先看看这些真实经历" : "社区刚开张，先看看这些真实经历",
        postsIso
          ? "发帖和留言暂时打不开；下面这些案例已经整理好，可以直接读。恢复后会自动回到社区。"
          : "这里沉淀了 " + LIST.length + " 篇真实家庭的经历，点开就能读。你也可以发第一条求助。",
        HOME_N, true
      ), homePage);
    } else {
      remove("scHome", homePage);
    }

    var casesIso = stateOf("cases") === "isolated";
    if (casesIso || gridEmpty()) {
      ensure("scCases", "caseGrid", blockHTML(
        casesIso ? "案例库（离线可读）" : "精选案例（先读这些）",
        casesIso
          ? "云端案例暂时取不回来，这里是可以直接读的 " + LIST.length + " 篇。"
          : "这些是站内已经整理好的 " + LIST.length + " 篇，读起来不费流量。",
        LIST.length, false
      ), casePage);
    } else {
      remove("scCases", casePage);
    }
  }

  function unmount() {
    remove("scHome", document.getElementById("page-home"));
    remove("scCases", document.getElementById("page-cases"));
  }

  /* 轮询：只要状态不变就几乎零开销（两个函数调用 + 一次字符串比较） */
  var last = null, timer = null;
  function tick() {
    var sig = stateOf("posts") + "|" + stateOf("cases");
    if (sig === last) return;
    last = sig;
    if (sig === "|") return;          /* cloud 层还没就绪，等下一拍 */
    mountAll();
  }

  function boot() {
    tick();
    if (timer) return;
    timer = setInterval(tick, TICK_MS);
    /* 状态变化另有事件通道时立刻响一次，不必等轮询 */
    try { window.addEventListener("yrb-cloud-state", tick); } catch (e) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.YRB_STATICCASE = {
    version: VERSION,
    list: LIST,
    refresh: function () { last = null; tick(); },
    mountAll: mountAll,
    unmount: unmount
  };
})();
