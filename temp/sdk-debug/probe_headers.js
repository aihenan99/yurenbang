/* 检查 auth 端点是否用 Cookie 维持匿名客户端会话，以及 Set-Cookie 的 Domain 属性 */
const PK = "wbpk_Lt4Zxzyd4j1x3DZdRFyFF9_mGfhreB3aiE9eS2lsMIzIG6z3V4E1O01";
const DIRECT = "https://yurenbang.app.workbuddy.host/.cloud/auth";
async function dump(base, path, body, method) {
  try {
    const r = await fetch(base + path, {
      method: method || "POST",
      headers: { "content-type": "application/json", "x-wb-webapp-access-key": PK, "origin": "https://yurenbang.app.workbuddy.host" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const hs = [];
    r.headers.forEach((v, k) => { if (/cookie|auth|session|x-wb|access/i.test(k)) hs.push(`${k}: ${v.slice(0, 200)}`); });
    const t = await r.text();
    console.log(`${path} -> ${r.status}\n  headers: ${hs.join(" | ") || "(none)"}\n  body: ${t.slice(0, 200)}`);
  } catch (e) { console.log(`${path} -> NET-ERR ${e.message}`); }
}
(async () => {
  await dump(DIRECT, "/v1/verification", { phone_number: "12000000000", target: "ANY" });
  await dump(DIRECT, "/v1/verification/verify", { verification_id: "probe", verification_code: "000000" });
  await dump(DIRECT, "/v1/signin", { username: "+86 12000000000", verification_token: "probe" });
  await dump(DIRECT, "/v1/token", { refresh_token: "probe" });
})();
