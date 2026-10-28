const urls = [
  ["cn 首页", "https://xn--gmqq09al6z.cn/?cb=" + Date.now()],
  ["cn adminguard.js", "https://xn--gmqq09al6z.cn/assets/adminguard.js"],
  ["cn gate.js", "https://xn--gmqq09al6z.cn/assets/gate.js"],
  ["cn yrbapi", "https://xn--gmqq09al6z.cn/yrbapi/.cloud/auth/v1/user/me"],
  ["wb 首页", "https://yurenbang.app.workbuddy.host/?cb=" + Date.now()],
  ["wb app.html", "https://yurenbang.app.workbuddy.host/yurenbang-app.html"],
  ["wb adminguard.js", "https://yurenbang.app.workbuddy.host/assets/adminguard.js"],
  ["wb gate.js", "https://yurenbang.app.workbuddy.host/assets/gate.js"],
  ["wb cloud.js", "https://yurenbang.app.workbuddy.host/assets/cloud.js"],
];
(async () => {
  for (const [name, u] of urls) {
    try {
      const r = await fetch(u, { redirect: "manual" });
      const t = await r.text();
      const marks = [];
      if (/adminguard/.test(t)) marks.push("adminguard");
      if (/assets\/gate\.js/.test(t)) marks.push("gate");
      console.log(`${name.padEnd(20)} ${r.status}  ${t.length}B  ${marks.length ? "[" + marks.join(",") + "]" : ""}`);
    } catch (e) {
      console.log(`${name.padEnd(20)} ERR ${e.message}`);
    }
  }
})();
