/* 验证上游对 Origin 的态度：白名单 Origin 应放行，其它 Origin 应 403 */
const PK = "wbpk_Lt4Zxzyd4j1x3DZdRFyFF9_mGfhreB3aiE9eS2lsMIzIG6z3V4E1O01";
const U = "https://yurenbang.app.workbuddy.host/.cloud/auth/v1/verification";
async function probe(origin) {
  const r = await fetch(U, {
    method: "POST",
    headers: { "content-type": "application/json", "x-wb-webapp-access-key": PK, origin },
    body: JSON.stringify({ phone_number: "12000000000", target: "ANY" })
  });
  const t = await r.text();
  console.log(`origin=${origin || "(none)"} -> ${r.status} ${t.slice(0, 160)}`);
}
(async () => {
  await probe("https://yurenbang.app.workbuddy.host");
  await probe("https://xn--gmqq09al6z.cn");
  await probe("");
})();
