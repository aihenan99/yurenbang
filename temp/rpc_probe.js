/* 探测三个管理门禁函数在数据平面上是否已暴露（PostgREST schema cache）
   预期：匿名调用 → 权限不足（函数存在）；对照一个不存在的函数 → 404/函数不存在 */
const https = require("https");
function post(path, body) {
  return new Promise(res => {
    const data = JSON.stringify(body || {});
    const req = https.request("https://xn--gmqq09al6z.cn" + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        "x-wb-webapp-access-key": "wbpk_Lt4Zxzyd4j1x3DZdRFyFF9_mGfhreB3aiE9eS2lsMIzIG6z3V4E1O01",
      },
    }, r => {
      let b = ""; r.setEncoding("utf8");
      r.on("data", c => b += c);
      r.on("end", () => res({ s: r.statusCode, b: b.slice(0, 240) }));
    });
    req.on("error", e => res({ s: 0, b: e.message }));
    req.setTimeout(20000, () => { req.destroy(); res({ s: 0, b: "TIMEOUT" }); });
    req.write(data); req.end();
  });
}
(async () => {
  const RPC = "/yrbapi/.cloud/database/rest/rpc/";
  const cases = [
    ["admin_guard_status", {}],
    ["admin_verify_password", { p_password: "x" }],
    ["admin_set_password", { p_new: "x" }],
    ["no_such_function_xyz", {}],
  ];
  for (const [fn, body] of cases) {
    const r = await post(RPC + fn, body);
    const exposed = r.s !== 404 && !/does not exist|Could not find the function/i.test(r.b);
    console.log("%-22s status=%s  已暴露=%s  body=%s", fn, r.s, exposed, r.b.replace(/\s+/g, " ").slice(0, 130));
  }
})();
