/* =========================================================
   育人帮 · 家教服务层（jiaojiao.js）
   1) 首页顶部栏目注入「🎓 家教」入口（包装 renderFuncRow，不改结构）
   2) 家教需求登记页（仿 jiaojiao.site 登记 form：提示条 / 分组选项卡 /
      必填校验 / 提交 / 二维码咨询卡）
   3) 提交需登录（gate.js 拦 #jjSubmit）；登录后云端入库 yb_tutor_req
      （RLS：只允许 INSERT，客户端读不走），本机同时留一份存档
   依赖：app.js（switchTab / toast / esc）、cloud.js（YRB_CLOUD）
   ========================================================= */
(function () {
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ================= 数据：与参考设计一致的选项 ================= */
const GRADES = [
  ["高一", "高二", "高三"],
  ["六年级", "初一", "初二", "初三"],
  ["一年级", "二年级", "三年级", "四年级", "五年级"],
  ["幼儿", "幼小衔接", "小初衔接", "初高衔接", "成人"]
];
const SUBJECTS = ["全科", "语文", "数学", "英语", "物理", "化学", "生物", "政治", "历史", "地理"];
const FREQS = ["每周1~2次", "每周3次以上", "待定看效果"];
const TEACHERS = ["大学生", "专职", "学校在职"];
const ONLINES = ["接受", "不接受", "优秀老师可线上"];
const GOALS = ["补差巩固", "预习新课", "拔高培优", "作业辅导", "还没想好"];
const KEY = "yrb_jiaojiao_v1";

/* ================= 1. 顶部栏目入口：包装 renderFuncRow ================= */
const CHIP = `<button class="f-chip jj-chip" data-f="jiaojiao">🎓 家教</button>`;
try {
  const _renderFuncRow = renderFuncRow;
  renderFuncRow = function () {
    _renderFuncRow();
    try {
      const row = $("#funcrow");
      if (!row || $(".jj-chip", row)) return;
      /* 家教入口插到栏目行**第一位**：行是横向滚动条，插在末尾时
         大半截在屏幕外，手机上不滑动根本看不到（用户反馈"找不到家教栏目"） */
      const first = $(".f-chip", row);
      if (first) first.insertAdjacentHTML("beforebegin", CHIP);
      else {
        const add = $(".f-add", row);
        if (add) add.insertAdjacentHTML("beforebegin", CHIP);
        else row.insertAdjacentHTML("beforeend", CHIP);
      }
    } catch (e) {}
  };
} catch (e) {}

/* ================= 2. 登记页结构 ================= */
function opts(list, name, multi) {
  return list.map(t =>
    `<button type="button" class="jj-opt" data-name="${name}" data-v="${esc(t)}">${esc(t)}</button>`
  ).join("");
}
function label(txt, req, chip) {
  return `<div class="jj-lb"><b>${txt}${req ? ' <i class="req">*</i>' : ""}</b>${chip ? `<span class="jj-chip-tag">${chip}</span>` : ""}</div>`;
}
function buildPage() {
  const pages = $("#pages");
  if (!pages || $("#page-jiaojiao")) return;
  const sec = document.createElement("section");
  sec.className = "page"; sec.id = "page-jiaojiao";
  sec.innerHTML = `
  <div class="pg-head"><h1>🎓 家教服务</h1><span class="pg-sub">登记需求 · 免费为您匹配好老师</span></div>
  <div class="jj-wrap">

    <div class="jj-tip">🛡️ 温馨提示：信息仅用于匹配合适老师，严格保密，绝不对外泄露</div>

    <!-- 学生基本信息 -->
    <div class="jj-card">
      <div class="jj-sec"><span class="jj-sec-ic">🎓</span><div><b>学生基本信息</b><span>方便我们为您精准匹配</span></div></div>
      ${label("称呼", 0, "选填")}
      <div class="jj-input"><span class="jj-pre">☺️</span><input id="jjName" maxlength="20" placeholder="选填，方便对方称呼你"></div>
      ${label("微信号/手机号", 1, "方便我们推荐")}
      <div class="jj-input"><span class="jj-pre">📞</span><input id="jjContact" maxlength="40" placeholder="用于对接匹配老师，信息严格保密"></div>
      ${label("居住小区", 1, "上课地址，方便就近匹配")}
      <div class="jj-input"><span class="jj-pre">📍</span><input id="jjCommunity" maxlength="30" placeholder="只需填小区名称，不用精确门牌"></div>
    </div>

    <!-- 年级：单选 -->
    <div class="jj-card">
      ${label("年级", 1, "单选")}
      <div class="jj-box">${GRADES.map((g, i) => `<div class="jj-grp${i ? " gap" : ""}">${opts(g, "grade")}</div>`).join("")}</div>
    </div>

    <!-- 科目：多选 -->
    <div class="jj-card">
      ${label("科目", 1, "多选")}
      <div class="jj-box"><div class="jj-grp">${opts(SUBJECTS, "subjects")}</div></div>
      <div class="jj-input mt"><span class="jj-pre">✏️</span><input id="jjOther" maxlength="20" placeholder="输入其他科目"></div>
    </div>

    <!-- 频次：选填单选 -->
    <div class="jj-card">
      ${label("频次", 0, "选填")}
      <div class="jj-box"><div class="jj-grp">${opts(FREQS, "freq")}</div></div>
    </div>

    <!-- 老师类型：多选 -->
    <div class="jj-card">
      ${label("老师类型", 1, "多选")}
      <div class="jj-box"><div class="jj-grp">${opts(TEACHERS, "teachers")}</div></div>
    </div>

    <!-- 是否接受线上：单选 -->
    <div class="jj-card">
      ${label("是否接受线上", 1, "单选")}
      <div class="jj-box"><div class="jj-grp">${opts(ONLINES, "online")}</div></div>
    </div>

    <!-- 上课目标：多选 -->
    <div class="jj-card">
      ${label("上课目标", 1, "多选")}
      <div class="jj-box"><div class="jj-grp">${opts(GOALS, "goals")}</div></div>
    </div>

    <button id="jjSubmit" type="button">✈️ 提交登记信息</button>
    <div class="jj-hint"><i></i><span>我们将在2小时内与您联系</span><i></i></div>

    <!-- 扫码咨询 -->
    <div class="jj-wx">
      <div class="jj-wx-t">💬 扫码咨询</div>
      <div class="jj-wx-body">
        <img class="jj-qr" src="assets/jiaojiao-qr.png" alt="育人帮二维码">
        <div class="jj-tags">
          <span>补差巩固</span><span>预习新课</span><span>拔高培优</span>
          <span>作业辅导</span><span>幼小衔接</span><span>小初衔接</span>
          <span class="hot">⭐ 渠道：YRB</span>
          <span class="brand">育人帮 · 家教服务</span>
        </div>
      </div>
    </div>

    <div class="jj-privacy">提交即表示同意《隐私政策》：联系方式仅用于家教匹配，不公开、不外泄</div>
  </div>

  <!-- 提交成功面板 -->
  <div class="jj-done" id="jjDone" hidden>
    <div class="jj-done-card">
      <div class="jj-done-ic">✅</div>
      <div class="jj-done-t">登记成功</div>
      <div class="jj-done-s">我们将在<b>2小时内</b>与您联系<br>请保持手机 / 微信畅通</div>
      <div class="jj-done-sum" id="jjSum"></div>
      <button id="jjAgain" type="button">再登记一份</button>
      <button id="jjBack" type="button" class="ghost">返回社区</button>
    </div>
  </div>`;
  pages.appendChild(sec);
}

/* ================= 3. 交互：选择 / 校验 / 提交 ================= */
function val(name) {
  const on = $$on(name);
  return on.map(b => b.dataset.v);
}
function $$on(name) { return [...document.querySelectorAll(`#page-jiaojiao .jj-opt.on[data-name="${name}"]`)]; }
function bind() {
  const page = $("#page-jiaojiao"); if (!page) return;
  /* 选项：单选组互斥，多选组可叠加（「还没想好」在目标组内与其余互斥） */
  page.addEventListener("click", e => {
    const b = e.target.closest(".jj-opt"); if (!b) return;
    const name = b.dataset.name;
    if (name === "grade" || name === "freq" || name === "online") {
      $$on(name).forEach(x => x.classList.remove("on"));
      b.classList.add("on");
    } else {
      if (b.dataset.v === "还没想好" && !b.classList.contains("on")) {
        $$on(name).forEach(x => x.classList.remove("on"));
      }
      b.classList.toggle("on");
    }
  });
  /* 提交（gate.js 会在未登录时先拦下，登录成功后重放本点击） */
  $("#jjSubmit").addEventListener("click", onSubmit);
  $("#jjAgain").addEventListener("click", () => {
    $("#jjDone").hidden = true; $(".jj-wrap", page).hidden = false; page.scrollTop = 0;
  });
  $("#jjBack").addEventListener("click", () => { try { switchTab("home"); } catch (e) {} });
}
function onSubmit() {
  const contact = $("#jjContact").value.trim();
  const community = $("#jjCommunity").value.trim();
  const grade = val("grade"), subjects = val("subjects"),
        teachers = val("teachers"), online = val("online"), goals = val("goals");
  const bad = (id, msg) => { toast(msg); const el = $(id); if (el) { el.focus(); el.classList.add("shake"); setTimeout(() => el.classList.remove("shake"), 600); } };
  if (!contact) return bad("#jjContact", "请填写微信号或手机号，方便老师联系您");
  if (!community) return bad("#jjCommunity", "请填写居住小区，方便就近匹配老师");
  if (!grade.length) return toast("请选择孩子的年级");
  if (!subjects.length) return toast("请选择需要辅导的科目");
  if (!teachers.length) return toast("请选择老师类型");
  if (!online.length) return toast("请选择是否接受线上上课");
  if (!goals.length) return toast("请选择上课目标");

  const rec = {
    name: $("#jjName").value.trim(), contact, community,
    grade: grade[0], subjects: subjects.join("、"),
    other: $("#jjOther").value.trim(),
    freq: (val("freq")[0] || ""), teachers: teachers.join("、"),
    online: online[0], goals: goals.join("、"), at: new Date().toLocaleString("zh-CN")
  };
  /* 本机存档（永远成功） */
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || "[]");
    arr.push(rec); localStorage.setItem(KEY, JSON.stringify(arr));
  } catch (e) {}
  /* 云端入库（尽力而为：RLS 只许登录用户写入、客户端读不走） */
  cloudSave(rec);
  showDone(rec);
}
function cloudSave(rec) {
  try {
    const C = window.YRB_CLOUD;
    if (!C || !C.enabled || !C.enabled() || !C.signedIn() || !C.client) return;
    const row = {
      name: rec.name, contact: rec.contact, community: rec.community,
      grade: rec.grade, subjects: rec.subjects, other_subject: rec.other,
      freq: rec.freq, teacher_types: rec.teachers, online: rec.online, goals: rec.goals,
      owner_name: (C.name && C.name()) || ""
    };
    Promise.race([
      Promise.resolve(C.client.database.from("yb_tutor_req").insert(row)),
      new Promise(res => setTimeout(() => res(null), 20000))
    ]).then(r => { if (r && r.error) console.warn("[家教登记] 云端保存失败：", r.error.message || r.error); })
      .catch(() => {});
  } catch (e) {}
}
function showDone(rec) {
  const page = $("#page-jiaojiao");
  const sum = [
    rec.grade + (rec.other ? " · " + rec.other : ""), rec.subjects,
    rec.freq || "频次待定", rec.teachers, "线上：" + rec.online, "目标：" + rec.goals
  ].join(" ｜ ");
  $("#jjSum").textContent = sum;
  $(".jj-wrap", page).hidden = true;
  const d = $("#jjDone"); d.hidden = false;
  d.scrollIntoView({ behavior: "smooth", block: "center" });
}

/* ================= 4. 栏目点击路由 ================= */
document.addEventListener("click", e => {
  if (e.target.closest("#funcrow .jj-chip")) {
    e.preventDefault(); e.stopPropagation();
    try { switchTab("jiaojiao"); } catch (err) {}
  }
}, true);

/* ================= 5. 扫码卡二维码：支持后台上传更换 =================
   设置存云端表 yb_settings（key=jiaojiao_qr，值为图片 dataURL）。
   读取对所有访客开放（RLS 只放 SELECT）；写入仅管理员（admin_set_setting）。
   本地缓存秒开；后台更换后下次进入自动换新。
   ⚠️ 2026-10-19 修：cloud.js 的 SDK 是**异步加载**的，本脚本 boot 时
   `YRB_CLOUD.client` 还是 null。旧代码 `if(!C.client) return;` 直接放弃且不重试，
   于是"后台能上传、前台永远不换"。现改为：等就绪事件 + 有限次轮询兜底，
   并把已生效的地址记在 qrCurrent，页面重建后自动补回。 */
let qrCurrent = "";          /* "" 表示用内置默认图 */
function applyQR(src) {
  qrCurrent = src || "";
  const img = document.querySelector("#page-jiaojiao .jj-qr");
  if (img) img.src = qrCurrent || "assets/jiaojiao-qr.png";
}
function cloudDb() {
  try {
    const C = window.YRB_CLOUD;
    if (!C || !C.enabled || !C.enabled()) return null;
    return (C.client && C.client.database) || null;
  } catch (e) { return null; }
}
function loadQR() {
  /* 1) 先用本地缓存秒开 */
  try {
    const cached = localStorage.getItem("yrb_jj_qr") || "";
    if (cached) applyQR(cached);
  } catch (e) {}
  /* 2) 云端为准：client 未就绪时等事件 + 轮询兜底（最多约 12 秒） */
  let tries = 0;
  (function pull() {
    const D = cloudDb();
    if (!D) {
      if (tries++ < 48) setTimeout(pull, 250);
      return;
    }
    Promise.resolve(D.from("yb_settings").select("key,value").eq("key", "jiaojiao_qr").maybeSingle())
      .then(r => {
        if (!r || r.error || !r.data) return;      /* 没配置过 / 读取失败：保持当前图 */
        const v = r.data.value || "";
        if (v) {
          applyQR(v);
          try { localStorage.setItem("yrb_jj_qr", v); } catch (e) {}
        } else {
          applyQR("");                              /* 后台恢复默认 */
          try { localStorage.removeItem("yrb_jj_qr"); } catch (e) {}
        }
      }).catch(() => {});
  })();
}
/* 云端 SDK 就绪 → 立刻补读一次（解决"早期读到 null 就放弃"） */
window.addEventListener("yrb-cloud-ready", () => { try { loadQR(); } catch (e) {} });
/* 后台刚换完二维码 → 立即反映到正开着的家教页 */
window.addEventListener("yrb-jj-qr", (ev) => {
  const v = ev && ev.detail && ev.detail.value;
  if (v) applyQR(v);            /* 后台已拿到新值：先本地立即生效 */
  loadQR();                     /* 再用云端真相校准（多设备一致） */
});

/* ================= 6. 启动 ================= */
function boot() {
  buildPage();
  if (qrCurrent) applyQR(qrCurrent);   /* 页面刚建好，把已知二维码补上 */
  bind(); loadQR();
  try { renderFuncRow(); } catch (e) {}   /* 立即补上入口（此时 renderFuncRow 已是包装版） */
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
window.YRB_JJ = 1;   /* 自愈标记：弱网补载用 */
})();
