/* 探测云服务 auth 端点的报错行为（不发真实短信：用非法号段 12x / 假 verification_id） */
const PK = "wbpk_Lt4Zxzyd4j1x3DZdRFyFF9_mGfhreB3aiE9eS2lsMIzIG6z3V4E1O01";
const BASES = {
  direct: "https://yurenbang.app.workbuddy.host/.cloud/auth",
  proxy: "https://xn--gmqq09al6z.cn/yrbapi/.cloud/auth"
};
async function probe(name, base) {
  const out = [`${name}: ${base}`];
  const post = async (path, body) => {
    try {
      const r = await fetch(base + path, {
        method: "POST",
        headers: { "content-type": "application/json", "x-wb-webapp-access-key": PK },
        body: JSON.stringify(body)
      });
      const t = await r.text();
      return `  ${path} -> ${r.status} ${t.slice(0, 300)}`;
    } catch (e) { return `  ${path} -> NET-ERR ${e.message}`; }
  };
  out.push(await post("/v1/verification", { phone_number: "12000000000", target: "ANY" }));
  out.push(await post("/v1/verification/verify", { verification_id: "bogus-id-probe", verification_code: "000000" }));
  return out.join("\n");
}
(async () => {
  console.log(await probe("direct", BASES.direct));
  console.log(await probe("proxy ", BASES.proxy));
})();
