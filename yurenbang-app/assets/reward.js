/* =========================================================
   育人帮 · 回报增强层
   1) 滑动自动播放：真实音视频进入视野自动播，离开自动停；
      演示型视频/语音卡进入视野自动"播放"（进度条 / 声波动起来）
   2) 帮忙积分：文字 +10 · 语音 +15 · 视频 +20（可调）
   3) 职级晋升：积分到线自动升职级，弹金色晋升卡
   4) 大大的玫瑰鲜花 + 3 秒掌声（WebAudio 合成，无需音频文件）
   5) 四维称号：尊位(玫瑰) / 职称(帮忙) / 官爵(连续到访) / 功力(语音视频帮忙)
   6) 每次打开"我的"页：满屏玫瑰 + 掌声 1 秒（可点停）
   依赖：app.js（S / esc / toast / openGift / renderMe / addComment）
   策略：包装既有全局函数 + 观察注入，不改动既有结构
   ========================================================= */
(function () {
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ================= 1. 积分 / 职级数据 ================= */
const KEY = "yrb_reward_v1";
const GAIN = { text: 10, voice: 15, video: 20 };      /* 每份帮忙的积分 */
const RANKS = [
  { lv: 0, name: "新来的家长", ic: "🌱", min: 0 },
  { lv: 1, name: "热心帮友",   ic: "🤝", min: 100 },
  { lv: 2, name: "育儿帮手",   ic: "📚", min: 300 },
  { lv: 3, name: "金牌互助家长", ic: "🏅", min: 600 },
  { lv: 4, name: "社区育儿达人", ic: "🎓", min: 1000 },
  { lv: 5, name: "首席育儿顾问", ic: "👑", min: 1800 }
];
const START_POINTS = 90;   /* 起步积分：让第一份帮忙就能看到"即将升级"的动力 */

/* ---------- 四维称号（方案 B）：四个维度各管一摊，让成长看得见 ---------- */
const TITLES = [
  { key: "尊位", ic: "👑", unit: "朵玫瑰",  gap: v => `${v} 朵玫瑰`,
    src: () => R.rosesGot,
    ladder: [
      { min: 0,  name: "邻座嘉宾", ic: "🪑" },
      { min: 3,  name: "贵宾席",   ic: "🎀" },
      { min: 10, name: "首席嘉宾", ic: "🌟" },
      { min: 25, name: "荣誉长者", ic: "🏆" },
      { min: 50, name: "至尊席位", ic: "👑" }
    ] },
  { key: "职称", ic: "🤝", unit: "次帮忙",  gap: v => `${v} 次帮忙`,
    src: () => helpTotal(),
    ladder: [
      { min: 0,  name: "帮手学徒", ic: "🌱" },
      { min: 5,  name: "正式帮手", ic: "🤝" },
      { min: 15, name: "资深帮手", ic: "🔧" },
      { min: 30, name: "帮忙达人", ic: "🎯" },
      { min: 60, name: "助人楷模", ic: "🏅" }
    ] },
  { key: "官爵", ic: "🏛️", unit: "天连续到访", gap: v => `${v} 天连续到访`,
    src: () => R.streak,
    ladder: [
      { min: 0,  name: "新官上任", ic: "📝" },
      { min: 2,  name: "勤务在岗", ic: "📋" },
      { min: 7,  name: "勤勉榜样", ic: "⭐" },
      { min: 14, name: "常任元老", ic: "🏛️" },
      { min: 30, name: "终身荣誉", ic: "👑" }
    ] },
  { key: "功力", ic: "🔥", unit: "次语音/视频帮忙", gap: v => `${v} 次语音/视频帮忙`,
    src: () => R.helps.voice + R.helps.video,
    ladder: [
      { min: 0,  name: "初入门径", ic: "🌱" },
      { min: 3,  name: "小有所成", ic: "🎵" },
      { min: 8,  name: "渐入佳境", ic: "🎬" },
      { min: 15, name: "炉火纯青", ic: "🔥" },
      { min: 30, name: "登峰造极", ic: "⚡" }
    ] }
];
function titleOf(ladder, v) { let t = ladder[0]; for (const x of ladder) if (v >= x.min) t = x; return t; }
function nextTitle(ladder, v) { return ladder.find(x => x.min > v) || null; }

/* 官爵用的连续到访天数：每天第一次打开算一天 */
function todayStr(d) {
  d = d || new Date();
  return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
}
function touchStreak() {
  const t = todayStr();
  if (R.lastActive === t) return;
  const y = new Date(); y.setDate(y.getDate() - 1);
  R.streak = (R.lastActive === todayStr(y)) ? (R.streak || 0) + 1 : 1;
  R.lastActive = t;
  save();
}

let R = { points: START_POINTS, helps: { text: 0, voice: 0, video: 0 }, rosesGot: 0, streak: 0, lastActive: "" };
let gRank = null;   /* 最新职级，用于判断是否晋升 */

function helpCountInData() {
  try {
    if (typeof S === "undefined" || !Array.isArray(S.posts)) return 0;
    return S.posts.reduce((n, p) => n + ((p && p.comments) || []).filter(c => c && c.mine).length, 0);
  } catch (e) { return 0; }
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || "null");
    if (d && typeof d.points === "number") {
      R = Object.assign(R, d);
      R.helps = Object.assign({ text: 0, voice: 0, video: 0 }, d.helps || {});
    } else {
      /* 首次：把历史帮忙折算成起始积分，避免"新用户显示 0 却已有很多帮忙" */
      const h = helpCountInData();
      R.points = START_POINTS + h * GAIN.text;
      R.helps = { text: h, voice: 0, video: 0 };
    }
  } catch (e) {}
  touchStreak();          /* 官爵：每天第一次打开记 1 天连续到访 */
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(R)); } catch (e) {} }
function rankOf(pts) { let r = RANKS[0]; for (const x of RANKS) if (pts >= x.min) r = x; return r; }
function nextOf(pts) { return RANKS.find(x => x.min > pts) || null; }
function helpTotal() { return R.helps.text + R.helps.voice + R.helps.video; }
function syncState() { try { S.points = R.points; S.rank = rankOf(R.points); } catch (e) {} }
load(); syncState();

/* ================= 2. 3 秒掌声（WebAudio 合成） ================= */
let AC = null;
function ac() {
  try {
    if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === "suspended") AC.resume();
    return AC;
  } catch (e) { return null; }
}
/* 一次采样即反复使用：白噪声缓冲 */
let noiseBuf = null;
function getNoise(c) {
  if (noiseBuf && noiseBuf.sampleRate === c.sampleRate) return noiseBuf;
  const len = Math.floor(c.sampleRate * 1.2);
  const b = c.createBuffer(1, len, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  noiseBuf = b;
  return b;
}
/* 掌声 = 大量随机"拍手"脉冲叠加（带通噪声 + 快攻慢衰），约 3 秒 */
function applause(sec) {
  const c = ac(); if (!c) return;
  sec = sec || 3;
  const t0 = c.currentTime + 0.03;
  const master = c.createGain();
  master.gain.value = 0.9;
  master.connect(c.destination);
  const n = Math.round(sec * 26);              /* ≈26 次/秒，密度接近真实鼓掌 */
  for (let i = 0; i < n; i++) {
    const t = t0 + (i / n) * sec;
    const src = c.createBufferSource();
    src.buffer = getNoise(c);
    src.playbackRate.value = 0.9 + Math.random() * 0.5;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1100 + Math.random() * 1900;
    bp.Q.value = 0.6 + Math.random() * 1.1;
    const g = c.createGain();
    /* 整体包络：前 0.25s 渐起（掌声由稀到密），最后 0.55s 收尾 */
    const prog = t / sec;
    const swell = prog < 0.09 ? prog / 0.09 : (prog > 0.82 ? Math.max(0.06, (1 - prog) / 0.18) : 1);
    const peak = (0.10 + Math.random() * 0.16) * swell;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05 + Math.random() * 0.10);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t, Math.random() * 0.5, 0.22);
    src.stop(t + 0.3);
  }
  /* 低音"人群"底噪，让掌声更饱满 */
  const bed = c.createBufferSource();
  bed.buffer = getNoise(c); bed.loop = true;
  const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 700;
  const bg = c.createGain();
  bg.gain.setValueAtTime(0.0001, t0);
  bg.gain.exponentialRampToValueAtTime(0.05, t0 + 0.22);
  bg.gain.setValueAtTime(0.05, t0 + sec - 0.5);
  bg.gain.exponentialRampToValueAtTime(0.0001, t0 + sec);
  bed.connect(lp); lp.connect(bg); bg.connect(master);
  bed.start(t0); bed.stop(t0 + sec + 0.1);
  return { stop() { try { master.gain.cancelScheduledValues(c.currentTime); master.gain.setTargetAtTime(0.0001, c.currentTime, 0.05); } catch (e) {} } };
}
/* 首次交互时解锁音频（iOS/Safari 需要用户手势后才能出声） */
(function unlock() {
  const go = () => {
    const c = ac();
    if (c) { const b = c.createBuffer(1, 1, c.sampleRate); const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); }
    document.removeEventListener("touchstart", go, true);
    document.removeEventListener("click", go, true);
  };
  document.addEventListener("touchstart", go, true);
  document.addEventListener("click", go, true);
})();

/* ================= 3. 玫瑰 + 掌声 + 晋升弹层 ================= */
let curClap = null, rwTm = null;
function clearRewardLayer() {
  const g = $("#gift"); if (!g) return;
  g.classList.remove("rw-big", "rw-up");
  $$(".rw-roses,.rw-gain,.rw-clap,.rw-rays", g).forEach(e => e.remove());
  if (curClap) { curClap.stop(); curClap = null; }
  clearTimeout(rwTm);
}
/* 打开：#gift 层由 app.js openGift 负责显示/计数，这里只做"加料" */
function decorate(gain, promoted, rank) {
  const g = $("#gift"), inner = g && $(".gift-inner", g);
  if (!g || !inner) return;
  g.classList.add("rw-big");
  if (promoted) { g.classList.add("rw-up"); inner.insertAdjacentHTML("afterbegin", `<div class="rw-rays"></div>`); }

  /* 满屏大大的玫瑰鲜花 */
  const wrap = document.createElement("div");
  wrap.className = "rw-roses";
  const N = promoted ? 16 : 12;
  for (let i = 0; i < N; i++) {
    const s = document.createElement("span");
    s.textContent = i % 3 === 0 ? "🌹" : (i % 3 === 1 ? "🌹" : "💐");
    s.style.left = (2 + Math.random() * 88) + "%";
    s.style.fontSize = (46 + Math.random() * 54) + "px";
    s.style.animationDelay = (Math.random() * 1.6) + "s";
    s.style.animationDuration = (3.6 + Math.random() * 1.6) + "s";
    wrap.appendChild(s);
  }
  g.insertBefore(wrap, g.firstChild);

  /* 积分飘字 / 晋升肩章 */
  if (promoted) {
    inner.insertAdjacentHTML("beforeend", `<div class="rw-up-badge">${rank.ic} 晋升 ${rank.name} · Lv.${rank.lv}</div>`);
  } else {
    inner.insertAdjacentHTML("beforeend", `<div class="rw-gain">🤝 帮忙有回报 · +${gain} 积分</div>`);
  }
  /* 掌声提示：挂在 #gift 层底部（不挤占中央卡片），点一下可立即停止，照顾不同的家庭环境 */
  g.insertAdjacentHTML("beforeend", `<div class="rw-clap" id="rwClap">👏 掌声 3 秒 · 点击可停止</div>`);
  const clap = $("#rwClap");
  if (clap) clap.addEventListener("click", ev => {
    /* 必须阻断冒泡：#gift 自身有点击即关闭的监听，否则点"停止掌声"会把整层一起关掉 */
    ev.stopPropagation();
    if (curClap) { curClap.stop(); curClap = null; }
    clap.textContent = "已停止掌声 🤫";
  });

  curClap = applause(promoted ? 3 : 3);
  clearTimeout(rwTm);
  rwTm = setTimeout(clearRewardLayer, 5600);
}
/* 帮忙后的奖励结算 */
function rewardForHelp(kind) {
  if (typeof openGift !== "function") return;
  const gain = GAIN[kind] || GAIN.text;
  const before = rankOf(R.points);
  R.points += gain;
  R.rosesGot++;
  if (R.helps[kind] === undefined) R.helps[kind] = 0;
  R.helps[kind]++;
  const after = rankOf(R.points);
  const promoted = after.lv > before.lv;
  save(); syncState();

  clearRewardLayer();
  openGift(
    promoted ? "🎉 恭喜晋升！" : "收到一朵大大的玫瑰",
    promoted
      ? `${after.ic} ${after.name} · 累计 ${R.points} 积分（+${gain}）`
      : `帮忙有回报 · +${gain} 积分 · 累计 ${R.points} 分`
  );
  decorate(gain, promoted, after);
  renderRank();
  if (promoted) setTimeout(() => toast(`🎉 恭喜晋升「${after.name}」！继续帮忙，职级还会升`), 900);
}
/* 包装 addComment：任何形式的帮忙（文字 / 语音 / 视频）都结算积分 */
try {
  const _addComment = addComment;
  addComment = function (c) {
    _addComment(c);
    try {
      const kind = (c && typeof c === "object" && (c.kind === "voice" || c.kind === "video")) ? c.kind : "text";
      rewardForHelp(kind);
    } catch (e) {}
  };
  window.__yrbAddCommentWrapped = true;
} catch (e) {}

/* ================= 4. 我的页：职级 / 积分卡 ================= */
function renderRank() {
  const page = $("#page-me"); if (!page) return;
  let box = $("#rwRank");
  if (!box) {
    const anchor = $("#meMenu");
    box = document.createElement("div");
    box.id = "rwRank"; box.className = "rw-rank";
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(box, anchor);
    else page.appendChild(box);
  }
  const r = rankOf(R.points), nx = nextOf(R.points);
  const pct = nx ? Math.min(100, Math.round((R.points - r.min) / (nx.min - r.min) * 100)) : 100;
  box.innerHTML = `
    <div class="rw-rank-top">
      <span class="rw-ic">${r.ic}</span>
      <div>
        <div class="rw-rank-name">${r.name} <span class="rw-lv">Lv.${r.lv}</span></div>
        <div class="rw-rank-sub">已帮忙 ${helpTotal()} 次 · 文字${R.helps.text} / 语音${R.helps.voice} / 视频${R.helps.video}</div>
      </div>
      <div class="rw-pts"><b>${R.points}</b><span>积分</span></div>
    </div>
    <div class="rw-bar"><i style="width:${pct}%"></i></div>
    <div class="rw-tip">${nx ? `距离「${nx.ic} ${nx.name}」还差 <b>${nx.min - R.points}</b> 积分` : "已是最高职级 👑 谢谢你一直在帮大家"}<br>每份帮忙都有回报：文字 <b>+${GAIN.text}</b> · 语音 <b>+${GAIN.voice}</b> · 视频 <b>+${GAIN.video}</b></div>
    <div class="rw-titles">${TITLES.map(t => {
      const v = Math.max(0, Number(t.src()) || 0);
      const cur = titleOf(t.ladder, v), nx2 = nextTitle(t.ladder, v);
      return `<div class="rw-tl">
        <div class="rw-tl-ic">${cur.ic}</div>
        <div class="rw-tl-k">${t.key}</div>
        <div class="rw-tl-n">${cur.name}</div>
        <div class="rw-tl-s">${nx2 ? `还差 <b>${nx2.min - v}</b> ${t.unit}` : "已达巅峰 👑"}</div>
      </div>`;
    }).join("")}</div>
    <div class="rw-titles-tip">尊位看玫瑰 · 职称看帮忙 · 官爵看坚持 · 功力看语音视频帮忙</div>`;
  /* 顶部数据同步为真实值，并把"获赞"换成"积分"（更贴合本应用） */
  const st = $("#meStats");
  if (st) {
    let mine = 0;
    try { mine = (S.posts || []).filter(p => p && p.mine).length; } catch (e) {}
    st.innerHTML = [[mine, "求助"], [helpTotal(), "帮忙"], [R.points, "积分"], [S.roses + "", "玫瑰🌹"]]
      .map(([n, l]) => `<div class="ms"><b>${n}</b><span>${l}</span></div>`).join("");
  }
}
try {
  const _renderMe = renderMe;
  renderMe = function () { _renderMe(); try { renderRank(); } catch (e) {} };
} catch (e) {}

/* ================= 5. 滑动自动播放 ================= */
/* 说明：#phone 内 .page / 面板各自滚动，IntersectionObserver 会连同祖先裁剪一起计算，
   因此 root 用视口即可，滚动到哪个位置都能触发。 */
let soundHintShown = false;
function tryPlay(el, muted) {
  try {
    el.muted = !!muted;
    el.loop = false;
    const p = el.play();
    if (p && p.catch) p.catch(() => {
      if (!muted) {                    /* 带声被拦：退回静音自动播，并提示开声音 */
        el.muted = true;
        el.play().catch(() => {});
        showSoundHint(el);
      }
    });
    if (!muted) el.classList.add("auto-on");
  } catch (e) {}
}
function pauseEl(el) {
  try { el.pause(); el.classList.remove("auto-on"); } catch (e) {}
}
/* 系统不允许带声自动播放时，右上角出现"🔊 点一下开声音"（点后解除静音继续播） */
function showSoundHint(el) {
  const wrap = el.closest(".cm-media,.rw-media-wrap,.media") || el.parentElement;
  if (!wrap) return;
  if (soundHintShown && wrap.querySelector(".ap-sound")) return;
  const b = document.createElement("button");
  b.className = "ap-sound"; b.type = "button"; b.textContent = "🔊 点我开声音";
  b.addEventListener("click", ev => {
    ev.stopPropagation();
    el.muted = false; el.classList.add("auto-on");
    el.play().catch(() => {});
    b.remove();
  }, true);
  wrap.appendChild(b);
  soundHintShown = true;
  setTimeout(() => b.remove(), 6000);
}

const io = ("IntersectionObserver" in window) ? new IntersectionObserver(entries => {
  entries.forEach(en => {
    const el = en.target;
    const r = en.intersectionRatio;
    if (el.__rwReal) {                            /* 真实音视频：进视野播，出视野停 */
      if (r >= 0.6) { if (el.paused) tryPlay(el, false); }
      else if (r < 0.25) pauseEl(el);
    } else {                                      /* 演示卡片：进视野"播放"动效 */
      const on = r >= 0.5;
      if (el.classList.contains("auto-play") !== on) el.classList.toggle("auto-play", on);
      const chip = el.querySelector(".ap-chip");
      if (on && !chip) el.insertAdjacentHTML("afterbegin", `<span class="ap-chip">▶ 自动播放中</span>`);
      if (!on && chip) chip.remove();
    }
  });
}, { threshold: [0, 0.25, 0.5, 0.6, 0.85, 1] }) : null;

function watchNode(root) {
  if (!io || !root || !root.querySelectorAll) return;
  root.querySelectorAll("video,audio").forEach(el => {
    if (!el.__rwReal) { el.__rwReal = true; el.classList.add("rw-media-wrap"); io.observe(el); }
  });
  root.querySelectorAll(".m-video,.m-voice,.cm-media").forEach(el => {
    if (el.querySelector("video,audio")) return;   /* 真媒体由上面那条管 */
    if (!el.__rwDemo) { el.__rwDemo = true; io.observe(el); }
  });
}
/* 只扫描"当前可见页/面板"，避免给隐藏页里的节点做无谓观察（观察是幂等的） */
function scan() {
  [".page.active", "#cmList", "#feed", "#r23Detail", "#subpage", "#publishSheet"].forEach(sel => {
    const n = $(sel); if (n) watchNode(n);
  });
}
let scanTm = null;
function scheduleScan() { clearTimeout(scanTm); scanTm = setTimeout(scan, 180); }
if (io) {
  new MutationObserver(scheduleScan).observe($("#phone") || document.body, { childList: true, subtree: true });
  document.addEventListener("click", () => setTimeout(scan, 260), true);   /* 切页 / 开面板后补扫 */
  setTimeout(scan, 900);
}
/* 切到"我的"页时刷新职级卡（数值可能刚变过），并送上"打开就有"的玫瑰 + 1 秒掌声 */
let wlTm = null;
function welcomeRoses() {
  const ph = $("#phone"); if (!ph) return;
  const old = $("#rwWelcome"); if (old) old.remove();
  clearTimeout(wlTm);
  const w = document.createElement("div");
  w.id = "rwWelcome"; w.className = "rw-welcome";
  let spans = "";
  for (let i = 0; i < 10; i++) {
    spans += `<span style="left:${2 + Math.random() * 88}%;font-size:${44 + Math.random() * 56}px;` +
      `animation-delay:${Math.random() * 0.9}s;animation-duration:${3 + Math.random() * 1.4}s">${i % 3 === 2 ? "💐" : "🌹"}</span>`;
  }
  w.innerHTML = spans + `<div class="rw-wl-card" id="rwWlStop">🌹 欢迎回来 · 掌声 1 秒 👏</div>`;
  ph.appendChild(w);
  try { if (curClap) curClap.stop(); curClap = applause(1); } catch (e) {}
  const stop = w.querySelector("#rwWlStop");
  if (stop) stop.addEventListener("click", ev => {
    ev.stopPropagation();
    if (curClap) { curClap.stop(); curClap = null; }
    stop.textContent = "已停止掌声 🤫";
    clearTimeout(wlTm); wlTm = setTimeout(() => w.remove(), 500);
  });
  wlTm = setTimeout(() => { try { w.remove(); } catch (e) {} }, 4200);
}
document.addEventListener("click", e => {
  if (e.target.closest('.tb-item[data-p="me"]')) setTimeout(() => {
    try { renderRank(); } catch (err) {}
    try { welcomeRoses(); } catch (err) {}
  }, 260);
}, true);

/* ================= 6. 对外接口（便于自检与后续扩展） ================= */
window.YRB_REWARD = {
  state: () => ({
    points: R.points, rank: rankOf(R.points), next: nextOf(R.points), helps: helpTotal(), detail: Object.assign({}, R.helps),
    streak: R.streak || 0, rosesGot: R.rosesGot || 0,
    titles: TITLES.map(t => {
      const v = Math.max(0, Number(t.src()) || 0);
      const cur = titleOf(t.ladder, v);
      return { key: t.key, value: v, name: cur.name, ic: cur.ic, max: t.ladder[t.ladder.length - 1].min };
    })
  }),
  gain: GAIN, ranks: RANKS, titles: TITLES,
  addPoints(n) { R.points += (n || 0); save(); syncState(); renderRank(); },
  applause: sec => applause(sec),
  welcome: welcomeRoses,
  rescan: scan,
  _debug: { rewardForHelp, tryPlay, pauseEl, touchStreak }
};
})();
