/* 家教栏目 + 家教需求登记 专项测试
   用法：YRB_BASE=<url> node temp/jiaojiao_check.js
   断言：栏目入口 / 登记页结构 / 必填校验 / 登录门槛 / 提交成功与云端入库 / 长辈模式 */
const { chromium } = require("playwright-core");

const BASE = process.env.YRB_BASE || "http://127.0.0.1:8791/yurenbang-app.html";
const CHROME = "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe";
let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log(`  ✅ ${name}${extra ? " ｜ " + extra : ""}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? " ｜ " + extra : ""}`); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  page.on("pageerror", e => console.log("  [pageerror]", String(e).slice(0, 140)));

  await page.goto(BASE, { waitUntil: "load", timeout: 30000 });
  await page.waitForSelector("#feed .card", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(700);

  /* 稳定桩：覆盖 YRB_CLOUD（本地 CDN 可能没加载），拦截云端写入 */
  await page.evaluate(() => {
    const state = { signed: false, inserts: [] };
    window.__jjStub = state;
    window.__toasts = [];
    const _t = window.toast;
    window.toast = function (m) { try { window.__toasts.push(String(m)); } catch (e) {} return _t(m); };
    window.YRB_CLOUD = {
      enabled: () => true, ready: () => true, signedIn: () => state.signed,
      name: () => "测试家长",
      openLogin() {}, ensureLogin() { state.signed = true; return Promise.resolve(true); },
      client: {
        database: { from: t => ({ insert: row => { state.inserts.push([t, row]); return Promise.resolve({ data: [row] }); } }) }
      }
    };
    localStorage.removeItem("yrb_jiaojiao_v1");
  });

  console.log("=== A. 顶部栏目入口 ===");
  const chip = await page.evaluate(() => {
    const c = document.querySelector("#funcrow .jj-chip");
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { text: c.textContent.trim(), first: c === c.parentElement.querySelector(".f-chip"), fullyVisible: r.left >= 0 && r.right <= window.innerWidth };
  });
  check("顶部栏目出现「🎓 家教」", !!chip && /家教/.test(chip.text), chip && chip.text);
  /* 2026-10-18 契约变更：入口插到栏目行第一位（末尾会被滚出屏幕，用户看不到） */
  check("入口在栏目行第一位且完全可见", chip && chip.first && chip.fullyVisible, chip && JSON.stringify(chip));

  console.log("=== B. 登记页结构（仿参考设计） ===");
  await page.click("#funcrow .jj-chip");
  await page.waitForSelector("#page-jiaojiao.active", { timeout: 5000 }).catch(() => {});
  const st = await page.evaluate(() => {
    const p = document.getElementById("page-jiaojiao");
    const q = s => p.querySelectorAll(s).length;
    return {
      active: p.classList.contains("active"),
      tip: (p.querySelector(".jj-tip") || {}).textContent || "",
      secs: [...p.querySelectorAll(".jj-sec b")].map(x => x.textContent.trim()),
      grade: q('.jj-opt[data-name="grade"]'), subjects: q('.jj-opt[data-name="subjects"]'),
      freq: q('.jj-opt[data-name="freq"]'), teachers: q('.jj-opt[data-name="teachers"]'),
      online: q('.jj-opt[data-name="online"]'), goals: q('.jj-opt[data-name="goals"]'),
      submit: (document.getElementById("jjSubmit") || {}).textContent || "",
      hint: (p.querySelector(".jj-hint span") || {}).textContent || "",
      qr: !!(p.querySelector(".jj-qr") && p.querySelector(".jj-qr").naturalWidth > 0),
      other: !!p.querySelector("#jjOther"),
      wx: (p.querySelector(".jj-wx-t") || {}).textContent || ""
    };
  });
  check("点「家教」打开登记页", st.active);
  check("温馨提示条（保密承诺）", /严格保密，绝不对外泄露/.test(st.tip));
  check("学生基本信息区块", st.secs.includes("学生基本信息"), st.secs.join(","));
  check("年级 17 项（单选，含幼儿/衔接/成人）", st.grade === 17, `实际 ${st.grade}`);
  check("科目 10 项（多选）+ 其他输入框", st.subjects === 10 && st.other, `实际 ${st.subjects}`);
  check("频次 3 项（选填）", st.freq === 3);
  check("老师类型 3 项（多选）", st.teachers === 3);
  check("是否接受线上 3 项（单选）", st.online === 3);
  check("上课目标 5 项（多选）", st.goals === 5);
  check("提交按钮「✈️ 提交登记信息」", /提交登记信息/.test(st.submit), st.submit);
  check("提交下方「我们将在2小时内与您联系」", /2小时内与您联系/.test(st.hint));
  check("绿色「扫码咨询」卡 + 真二维码图", /扫码咨询/.test(st.wx) && st.qr);

  console.log("=== C. 单选互斥 / 多选叠加 ===");
  const pick = await page.evaluate(() => {
    const page = document.getElementById("page-jiaojiao");
    const click = v => [...page.querySelectorAll(".jj-opt")].find(b => b.dataset.v === v).click();
    click("初一"); click("高三");                      /* 年级单选：后者覆盖 */
    click("数学"); click("英语");                      /* 科目多选：叠加 */
    const on = n => [...page.querySelectorAll(`.jj-opt.on[data-name="${n}"]`)].map(b => b.dataset.v);
    return { grade: on("grade"), subjects: on("subjects") };
  });
  check("年级单选互斥（选高三则初一取消）", pick.grade.join() === "高三", pick.grade.join());
  check("科目多选叠加（数学+英语）", pick.subjects.join() === "数学,英语", pick.subjects.join());

  console.log("=== D. 必填校验 ===");
  await page.click("#jjSubmit");
  await page.waitForTimeout(300);
  const v1 = await page.evaluate(() => ({
    toasts: window.__toasts.slice(),
    done: !document.getElementById("jjDone").hidden
  }));
  check("空表单提交被拦下", !v1.done);
  check("提示先填联系方式", v1.toasts.some(t => /微信号或手机号/.test(t)), v1.toasts.join(" / "));

  console.log("=== E. 未登录提交 → 门槛拦截 → 登录后放行 ===");
  await page.fill("#jjContact", "wx_lele_mama");
  await page.fill("#jjCommunity", "阳光花园");
  await page.fill("#jjName", "乐乐妈妈");
  /* 选项已在 C 段选好：高三 + 数学英语；补齐老师/线上/目标 */
  await page.evaluate(() => {
    const page = document.getElementById("page-jiaojiao");
    const click = v => [...page.querySelectorAll(".jj-opt")].find(b => b.dataset.v === v).click();
    click("大学生"); click("优秀老师可线上"); click("补差巩固"); click("每周1~2次");
  });
  await page.click("#jjSubmit");
  await page.waitForSelector("#jjDone:not([hidden])", { timeout: 6000 }).catch(() => {});
  const e1 = await page.evaluate(() => {
    const recs = JSON.parse(localStorage.getItem("yrb_jiaojiao_v1") || "[]");
    return {
      toasts: window.__toasts.slice(),
      done: !document.getElementById("jjDone").hidden,
      sum: (document.getElementById("jjSum") || {}).textContent || "",
      doneText: (document.getElementById("jjDone") || {}).textContent || "",
      recs, stub: window.__jjStub
    };
  });
  check("未登录先被门槛拦下（提示需登录）", e1.toasts.some(t => /提交家教登记需要先登录/.test(t)), e1.toasts.join(" / "));
  check("登录成功后自动重放提交 → 出现成功面板", e1.done);
  check("成功面板承诺「2小时内与您联系」", /2小时内/.test(e1.doneText));
  check("登记摘要显示所选内容", /高三/.test(e1.sum) && /数学/.test(e1.sum) && /补差巩固/.test(e1.sum), e1.sum);
  check("本机留档 1 条（含联系方式）", e1.recs.length === 1 && e1.recs[0].contact === "wx_lele_mama" && e1.recs[0].community === "阳光花园",
    e1.recs.length ? `年级=${e1.recs[0].grade}` : "无");
  check("云端入库 yb_tutor_req（1 条，字段齐全）",
    e1.stub.inserts.length === 1 && e1.stub.inserts[0][0] === "yb_tutor_req" &&
    e1.stub.inserts[0][1].grade === "高三" && e1.stub.inserts[0][1].online === "优秀老师可线上",
    e1.stub.inserts.length ? "insert 已调用" : "未调用");
  check("云端行带登录身份（owner_name）", e1.stub.inserts.length && e1.stub.inserts[0][1].owner_name === "测试家长");

  console.log("=== F. 成功面板 → 再登记一份 ===");
  await page.click("#jjAgain");
  const f1 = await page.evaluate(() => ({
    form: !document.querySelector("#page-jiaojiao .jj-wrap").hidden,
    keepContact: document.getElementById("jjContact").value
  }));
  check("「再登记一份」回到表单", f1.form);
  check("已填联系方式保留（不重复输入）", f1.keepContact === "wx_lele_mama");

  console.log("=== G. 抽屉「功能栏目」入口 ===");
  const g1 = await page.evaluate(() => {
    document.getElementById("btnMenu").click();
    return true;
  });
  await page.waitForSelector("#drawer.open", { timeout: 4000 }).catch(() => {});
  const g2 = await page.evaluate(() => {
    const item = [...document.querySelectorAll("#drBody .dr-item")].find(b => b.dataset.k === "jiaojiao");
    if (!item) return { exists: false };
    const soon = !!item.querySelector(".soon");
    item.click();
    return { exists: true, soon };
  });
  await page.waitForTimeout(300);
  const g3 = await page.evaluate(() => document.getElementById("page-jiaojiao").classList.contains("active"));
  check("抽屉里有「🎓 家教服务」且不带「预留升级」标", g2.exists && !g2.soon);
  check("点抽屉项也能打开登记页", g3);

  console.log("=== H. 长辈模式放大 ===");
  await page.evaluate(() => document.getElementById("phone").setAttribute("data-elder", "1"));
  await page.waitForTimeout(350);
  const h1 = await page.evaluate(() => {
    const lb = document.querySelector("#page-jiaojiao .jj-lb b");
    const opt = document.querySelector("#page-jiaojiao .jj-opt");
    return { lb: getComputedStyle(lb).fontSize, opt: getComputedStyle(opt).fontSize };
  });
  check("标签文字放大（≥17px）", parseFloat(h1.lb) >= 17, h1.lb);
  check("选项胶囊放大（≥15px）", parseFloat(h1.opt) >= 15, h1.opt);

  console.log("=== I. 二维码：本地缓存秒开 + 云端就绪后重读（2026-10-19 时序修复） ===");
  const TINY = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  await page.evaluate(t => localStorage.setItem("yrb_jj_qr", t), TINY);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1100);
  const vis2 = await page.evaluate(() => {
    const s = document.querySelector("#splash");
    return !!(s && !s.classList.contains("hidden") && s.offsetParent !== null);
  });
  if (vis2) { await page.click("#splash"); await page.waitForTimeout(600); }
  await page.evaluate(() => { try { switchTab("jiaojiao"); } catch (e) {} });
  await page.waitForTimeout(1500);
  const q1 = await page.evaluate(() => {
    const i = document.querySelector("#page-jiaojiao .jj-qr");
    return i ? i.src : "";
  });
  check("本地缓存的二维码启动即生效（不等云端）", q1.indexOf("data:image/png") === 0, q1.slice(0, 24));
  const q2 = await page.evaluate(() => {
    const i = document.querySelector("#page-jiaojiao .jj-qr");
    return i ? i.naturalWidth > 0 : false;
  });
  check("二维码图片确实渲染出来（非空 src）", q2);
  await page.evaluate(() => localStorage.removeItem("yrb_jj_qr"));

  await browser.close();
  console.log(`\n===== 家教登记测试：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FATAL", e); process.exit(1); });
