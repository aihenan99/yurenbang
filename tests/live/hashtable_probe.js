const https = require("https");
const KEY = "wbpk_Lt4Zxzyd4j1x3DZdRFyFF9_mGfhreB3aiE9eS2lsMIzIG6z3V4E1O01";
function get(path) {
  return new Promise(res => {
    const req = https.get("https://xn--gmqq09al6z.cn" + path, { headers: { "x-wb-webapp-access-key": KEY } }, r => {
      let b = ""; r.setEncoding("utf8");
      r.on("data", c => b += c);
      r.on("end", () => res({ s: r.statusCode, b: b.slice(0, 180) }));
    });
    req.on("error", e => res({ s: 0, b: e.message }));
    req.setTimeout(20000, () => { req.destroy(); res({ s: 0, b: "TIMEOUT" }); });
  });
}
(async () => {
  for (const p of ["/yrbapi/.cloud/database/rest/yb_admin_guard?select=*",
                   "/yrbapi/.cloud/database/rest/yb_posts?select=id&limit=1"]) {
    const r = await get(p);
    console.log("%-52s status=%s body=%s", p.slice(0, 52), r.s, r.b.replace(/\s+/g, " "));
  }
})();
