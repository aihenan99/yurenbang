/* 实测第 1 步：经 .cn 代理下发验证码（复现 .cn 网站的完整链路） */
const PK = "wbpk_Lt4Zxzyd4j1x3DZdRFyFF9_mGfhreB3aiE9eS2lsMIzIG6z3V4E1O01";
const PROXY = "https://xn--gmqq09al6z.cn/yrbapi/.cloud/auth";
(async () => {
  try {
    const r = await fetch(PROXY + "/v1/verification", {
      method: "POST",
      headers: { "content-type": "application/json", "x-wb-webapp-access-key": PK },
      body: JSON.stringify({ phone_number: "+86 18037345855", target: "ANY" })
    });
    const t = await r.text();
    console.log("status:", r.status);
    console.log("body:", t);
  } catch (e) {
    console.log("NET-ERR:", e.message, e.cause ? e.cause.message : "");
  }
})();
