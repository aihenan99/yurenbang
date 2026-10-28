// 域名解析侦察：育人帮.cn / 育人帮.com（含 punycode）
const dns = require("dns").promises;
const URL_ = require("url");

const names = [
  "育人帮.cn",
  "育人帮.com",
  "xn--gmqq09al6z.cn",
  "xn--gmqq09al6z.com",
  "yurenbang.app.workbuddy.host",
];

(async () => {
  for (const n of names) {
    console.log("=== " + n + " ===");
    for (const [label, fn] of [
      ["A", () => dns.resolve4(n)],
      ["CNAME", () => dns.resolveCname(n)],
      ["NS", () => dns.resolveNs(n)],
      ["TXT", () => dns.resolveTxt(n)],
    ]) {
      try {
        const r = await fn();
        console.log("  " + label + ": " + JSON.stringify(r));
      } catch (e) {
        console.log("  " + label + ": " + e.code);
      }
    }
  }
})();
