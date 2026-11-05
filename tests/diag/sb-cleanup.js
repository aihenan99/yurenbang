/* 清理自检遗留：列出 test* 账号 → 逐个登录 → 删掉自己名下的测试帖
   跑法：node tests/diag/sb-cleanup.js */
const path = require("path");
const SB = require(path.join(__dirname, "..", "..", "yurenbang-app", "assets", "yb-sb.js"));
const BASE = "https://xn--gmqq09al6z.cn/sbapi";
const KEY = "sb_publishable_ebjDgVECIpbwM2oGW_4pEg_tAAi0wqi";
const PASS = "Test12345";

const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
const rawFetch = global.fetch;
global.fetch = async (u, i) => {
  i = i || {};
  i.headers = Object.assign({ Origin: "https://xn--gmqq09al6z.cn" }, i.headers || {});
  try { return await rawFetch(u, i); } catch (e) { await new Promise(r => setTimeout(r, 500)); return rawFetch(u, i); }
};

(async () => {
  const admin = SB.createClient({ base: BASE, key: KEY, storageKey: "cleanup_ro" });
  const pr = await admin.database.from("yb_profiles").select("user_id,user_name,nick");
  if (pr.error) { console.log("读档案失败", pr.error); process.exit(1); }
  const tests = (pr.data || []).filter(x => /^test/i.test(x.user_name));
  console.log("测试账号：", tests.map(x => x.user_name).join(", ") || "（无）");

  let removed = 0;
  for (const t of tests) {
    const c = SB.createClient({ base: BASE, key: KEY, storageKey: "cleanup_" + t.user_name });
    const lg = await c.auth.signInWithPassword({ email: t.user_name + "@usr.yurenbang.cn", password: PASS });
    if (lg.error) { console.log("  " + t.user_name + " 登录失败：" + lg.error.message); continue; }
    const posts = await c.database.from("yb_posts").select("id,title").eq("owner_id", t.user_id);
    for (const p of (posts.data || [])) {
      await c.database.from("yb_comments").delete().eq("post_id", p.id);
      const d = await c.database.from("yb_posts").delete().eq("id", p.id);
      if (!d.error) { removed++; console.log("  删帖 #" + p.id + " " + JSON.stringify(p.title)); }
      else console.log("  删帖失败 #" + p.id + " " + (d.error.code || d.error.message));
    }
    await c.database.from("yb_profiles").delete().eq("user_id", t.user_id);
  }
  const left = await admin.database.from("yb_posts").select("id,title");
  console.log("清理完成，删除 " + removed + " 条；剩余帖子：", (left.data || []).length);
  process.exit(0);
})();
