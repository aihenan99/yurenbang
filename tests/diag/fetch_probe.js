// 抓取线上页面，确认当前承载内容
const https = require("https");

const targets = [
  { url: "https://xn--gmqq09al6z.cn/", label: "育人帮.cn (punycode)" },
  { url: "https://育人帮.cn/", label: "育人帮.cn (中文)" },
  { url: "https://xn--gmqq09al6z.com/", label: "育人帮.com (punycode)" },
  { url: "https://yurenbang.app.workbuddy.host/", label: "WorkBuddy 云端(现役)" },
];

function get(url, depth = 0) {
  return new Promise((resolve) => {
    if (depth > 3) return resolve({ err: "too many redirects" });
    let u;
    try { u = new URL(url); } catch (e) { return resolve({ err: "bad url " + url }); }
    const req = https.request(
      { hostname: u.hostname, port: 443, path: u.pathname + u.search, method: "GET",
        headers: { "User-Agent": "Mozilla/5.0 YRB-Probe" }, timeout: 12000 },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, url).toString();
          res.resume();
          return resolve(get(next, depth + 1));
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (d) => { if (body.length < 60000) body += d; });
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }
    );
    req.on("timeout", () => { req.destroy(); resolve({ err: "timeout" }); });
    req.on("error", (e) => resolve({ err: e.code || e.message }));
    req.end();
  });
}

(async () => {
  for (const t of targets) {
    const r = await get(t.url);
    console.log("\n===== " + t.label + " =====");
    if (r.err) { console.log("  ERROR: " + r.err); continue; }
    console.log("  status: " + r.status);
    console.log("  server: " + (r.headers["server"] || "-"));
    console.log("  cf-ray: " + (r.headers["cf-ray"] || "-"));
    const title = (r.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
    console.log("  title : " + (title ? title.trim().slice(0, 80) : "(无)"));
    const m = r.body.match(/<meta[^>]+name=["']description["'][^>]*>/i);
    console.log("  desc  : " + (m ? m[0].slice(0, 120) : "(无)"));
    console.log("  bytes : " + r.body.length);
    console.log("  sniff : " + r.body.replace(/\s+/g, " ").slice(0, 200));
  }
})();
