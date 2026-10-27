/* 用真实手机号 + 假 verification_token 探测 /v1/signin：
   - 若返回 "User not exist" → 说明该手机号从未完成过注册（登录从未成功过）
   - 若返回 invalid_grant/session 错误 → 账号存在，是令牌交换层拒绝 */
const PK = "wbpk_Lt4Zxzyd4j1x3DZdRFyFF9_mGfhreB3aiE9eS2lsMIzIG6z3V4E1O01";
const DIRECT = "https://yurenbang.app.workbuddy.host/.cloud/auth";
(async () => {
  const r = await fetch(DIRECT + "/v1/signin", {
    method: "POST",
    headers: { "content-type": "application/json", "x-wb-webapp-access-key": PK },
    body: JSON.stringify({ username: "+86 18037345855", verification_token: "probe-invalid-token" })
  });
  console.log("status:", r.status);
  console.log("body:", await r.text());
})();
