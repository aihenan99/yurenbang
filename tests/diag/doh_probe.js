// 用 Cloudflare DoH 权威查询，绕过本地 DNS 缓存
const https = require("https");

function doh(name, type) {
  return new Promise((res) => {
    const u = "https://cloudflare-dns.com/dns-query?name=" + encodeURIComponent(name) + "&type=" + type;
    https
      .get(u, { headers: { accept: "application/dns-json" } }, (r) => {
        let b = "";
        r.setEncoding("utf8");
        r.on("data", (c) => (b += c));
        r.on("end", () => {
          try {
            const j = JSON.parse(b);
            const ans = (j.Answer || []).map((a) => a.data);
            res({ status: j.Status, ans });
          } catch (e) {
            res({ status: -1, ans: [], raw: b.slice(0, 200) });
          }
        });
      })
      .on("error", (e) => res({ status: -2, ans: [], raw: String(e.message) }));
  });
}

const NAMES = ["育人帮.com", "xn--gmqq09al6z.com", "育人帮.cn", "xn--gmqq09al6z.cn"];
const TYPES = ["A", "CNAME", "NS"];

(async () => {
  for (const n of NAMES) {
    console.log("=== " + n + " ===");
    for (const t of TYPES) {
      const r = await doh(n, t);
      const code = { 0: "NOERROR", 3: "NXDOMAIN" }[r.status] || ("Status=" + r.status);
      console.log("  " + t.padEnd(6) + " " + code + "  " + (r.ans.length ? JSON.stringify(r.ans) : "(无记录)"));
    }
  }
  // 直接看 HTTP 是否可达
  console.log();
  console.log("=== HTTP 探测 ===");
  for (const u of ["http://育人帮.com/", "https://育人帮.com/", "http://xn--gmqq09al6z.com/"]) {
    await new Promise((res) => {
      const req = https.request(
        { host: new URL(u).hostname, port: new URL(u).port || 80, path: "/", method: "GET", timeout: 8000,
          // 允许 https 用 http 模块不行，这里统一用 https 试
        },
        (r) => { console.log("  " + u + "  -> " + r.statusCode + "  server=" + (r.headers.server || "-") + "  location=" + (r.headers.location || "-")); res(); }
      );
      req.on("error", (e) => { console.log("  " + u + "  -> 失败: " + e.code + " " + e.message); res(); });
      req.on("timeout", () => { req.destroy(); console.log("  " + u + "  -> 超时"); res(); });
      req.end();
    });
  }
})();
