(async () => {
  const cases = [
    ["GET user/me", "GET", "https://yurenbang.app.workbuddy.host/.cloud/auth/v1/user/me"],
    ["GET user/me (cn proxy)", "GET", "https://xn--gmqq09al6z.cn/yrbapi/.cloud/auth/v1/user/me"],
  ];
  for (const [n, m, u] of cases) {
    try {
      const r = await fetch(u, { method: m, headers: { "x-wb-webapp-access-key": "wbapp_Lt4Zxzyd4j1x3DZdRFyFF9" } });
      console.log(`${n.padEnd(24)} ${r.status}  ${(await r.text()).slice(0, 120)}`);
    } catch (e) { console.log(`${n.padEnd(24)} ERR ${e.message}`); }
  }
})();
