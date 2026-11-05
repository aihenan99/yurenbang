/* 育人帮 · Supabase 全链路自检（真实网络，经线上 /sbapi 代理）
   跑法：node tests/diag/sb-smoke.js
   做的事：注册测试号 → 写档案 → 发帖 → 发评论 → 校验 helps 触发器 →
           标记已解决(RPC) → 上传图片 → 签名地址可取 → 匿名读帖 → 清理
   注意：会向 Supabase 写入一条测试数据，结束时删除。 */
const path = require("path");
const SB = require(path.join(__dirname, "..", "..", "yurenbang-app", "assets", "yb-sb.js"));

const BASE = "https://xn--gmqq09al6z.cn/sbapi";
const KEY = "sb_publishable_ebjDgVECIpbwM2oGW_4pEg_tAAi0wqi";

// localStorage 桩
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};

// /sbapi 代理有同源校验：浏览器会自动带 Origin，Node 需手工补
// 代理链路偶发复用已断开的 socket（undici 报 "fetch failed"），网络层失败重试一次
const rawFetch = global.fetch;
global.fetch = async (url, init) => {
  init = init || {};
  init.headers = Object.assign({ Origin: "https://xn--gmqq09al6z.cn" }, init.headers || {});
  try {
    return await rawFetch(url, init);
  } catch (e) {
    await new Promise(r => setTimeout(r, 500));
    return rawFetch(url, init);
  }
};

const stamp = Date.now().toString(36);
const USER = "test" + stamp;
const PASS = "Test12345";
const c = SB.createClient({ base: BASE, key: KEY, emailDomain: "usr.yurenbang.cn" });

const results = [];
function ok(name, cond, extra) {
  results.push({ name, pass: !!cond, extra });
  console.log((cond ? "✅" : "❌") + " " + name + (extra ? "  → " + JSON.stringify(extra).slice(0, 160) : ""));
}

(async () => {
  // 1 注册
  const su = await c.auth.signUp({ username: USER, password: PASS, nick: "测试家长" });
  ok("注册 signUp", !su.error && su.data, su.error || { uid: su.data && su.data.user.id });
  if (su.error) return done();

  const uid = c.session().user.id;

  // 2 档案
  const pf = await c.database.from("yb_profiles")
    .insert({ user_id: uid, user_name: USER, nick: "测试家长", city: "昆明" });
  ok("写档案 yb_profiles", !pf.error, pf.error);

  // 3 发帖
  const post = await c.database.from("yb_posts").insert({
    type: "text", title: "自检帖 " + stamp, body: "这是一条自动化自检内容", tag: "学习",
    age: "小学", urg: 1, vis: 0, loc: "昆明", owner_name: "测试家长", owner_flag: "🌱",
    media: []
  });
  ok("发帖 yb_posts（owner_id 自动补）", !post.error && post.data && post.data[0], post.error);
  if (post.error) return done();
  const pid = post.data[0].id;

  // 4 评论
  const cm = await c.database.from("yb_comments").insert({
    post_id: pid, body: "自检回应", owner_name: "测试家长", owner_flag: "🌱", kind: "text"
  });
  ok("发评论 yb_comments", !cm.error, cm.error);

  // 5 触发器：helps 应 +1
  const p2 = await c.database.from("yb_posts").select("id,helps").eq("id", pid).maybeSingle();
  ok("helps 触发器生效", p2.data && p2.data.helps === 1, p2.data || p2.error);

  // 6 RPC 标记已解决
  const sv = await c.database.rpc("yb_post_solve", [Number(pid)]);
  ok("RPC yb_post_solve", !sv.error && sv.data === true, sv.error || sv.data);

  // 7 上传图片（1x1 PNG）
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const spath = c.storage.sharedPath(uid, "img/selftest-" + stamp + ".png");
  const up = await c.storage.upload(spath, new Blob([png], { type: "image/png" }), { contentType: "image/png" });
  ok("上传素材 storage.upload", !up.error, up.error || spath);

  // 8 签名地址可取
  if (!up.error) {
    const sg = await c.storage.createSignedUrl(spath, 600);
    ok("签名 URL 生成", !sg.error && sg.data && sg.data.signedUrl, sg.error);
    if (sg.data && sg.data.signedUrl) {
      const r = await fetch(sg.data.signedUrl);
      ok("签名 URL 可下载", r.ok && r.headers.get("content-type"), { status: r.status });
    }
    // 批量签名（cloud.js 实际用法）
    const sgs = await c.storage.createSignedUrls([spath], 600);
    ok("批量签名 createSignedUrls", !sgs.error && sgs.data && sgs.data[0] && sgs.data[0].signedUrl, sgs.error);
  }

  // 9 匿名读帖（未登录客户端）
  const anon = SB.createClient({ base: BASE, key: KEY, emailDomain: "usr.yurenbang.cn", storageKey: "yrb_sb_anon_probe" });
  const feed = await anon.database.from("yb_posts").select("*").order("created_at", { ascending: false }).limit(5);
  ok("匿名读信息流（看内容免费）", !feed.error && Array.isArray(feed.data) && feed.data.length > 0,
    feed.error || { rows: feed.data.length });

  // 10 匿名不可写（RLS 应拒绝）
  const anonW = await anon.database.from("yb_posts").insert({ type: "text", title: "x", body: "x" });
  ok("匿名发帖应被拒绝", !!anonW.error, anonW.error && anonW.error.code);

  // 11 非管理员调管理 RPC 应被拒
  const bad = await c.database.rpc("admin_set_setting", { p_key: "x", p_value: "y" });
  ok("非管理员调 admin_set_setting 被拒", bad.data && bad.data.ok === false, bad.data);

  // 12 清理
  await c.database.from("yb_comments").delete().eq("post_id", pid);
  await c.database.from("yb_posts").delete().eq("id", pid);
  await c.database.from("yb_profiles").delete().eq("user_id", uid);
  if (!up.error) await c.storage.remove([spath]);
  const chk = await c.database.from("yb_posts").select("id").eq("id", pid);
  ok("清理测试数据", !chk.error && Array.isArray(chk.data) && chk.data.length === 0, chk.data);

  done();
})();

function done() {
  const pass = results.filter(r => r.pass).length;
  console.log("\n════ 结果：" + pass + " / " + results.length + " 通过 ════");
  results.filter(r => !r.pass).forEach(r => console.log("失败：" + r.name));
  process.exit(pass === results.length ? 0 : 1);
}
