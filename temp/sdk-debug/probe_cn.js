/* .cn 端点连通性 + 一次完整 OTP 流程探测（真实下发短信到用户手机号，用户正在登录） */
const PK = "wbpk_Lt4Zxzyd4j1x3DZdRFyFF9_mGfhreB3aiE9eS2lsMIzIG6z3V4E1O01";
const PHONE = "+86 18037345855";
const PROXY = "https://xn--gmqq09al6z.cn/yrbapi/.cloud/auth";
const DIRECT = "https://yurenbang.app.workbuddy.host/.cloud/auth";
async function post(base, path, body) {
  const r = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-wb-webapp-access-key": PK },
    body: JSON.stringify(body)
  });
  const t = await r.text();
  return { status: r.status, body: t.slice(0, 400) };
}
(async () => {
  // 1) 静态资源连通性
  try {
    const r = await fetch("https://xn--gmqq09al6z.cn/", { method: "GET" });
    console.log("GET .cn / ->", r.status);
  } catch (e) { console.log("GET .cn / -> NET-ERR", e.message, e.cause && e.cause.message); }
  // 2) 经代理走一遍 verification（真实短信，用户正在登录中，属于其操作意图）
  try {
    const v = await post(PROXY, "/v1/verification", { phone_number: PHONE, target: "ANY" });
    console.log("proxy /v1/verification ->", v.status, v.body);
  } catch (e) { console.log("proxy /v1/verification -> NET-ERR", e.message, e.cause && e.cause.message); }
  // 3) 用错误验证码走 verify，观察报错文案（区分「验证码错误」vs「session invalid」）
  try {
    const v = await post(PROXY, "/v1/verification/verify", { verification_id: "probe-wrong-id", verification_code: "000000" });
    console.log("proxy /v1/verification/verify ->", v.status, v.body);
  } catch (e) { console.log("proxy /v1/verification/verify -> NET-ERR", e.message, e.cause && e.cause.message); }
})();
