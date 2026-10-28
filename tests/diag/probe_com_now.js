const dns = require("dns").promises;
(async () => {
  for (const t of ["A", "CNAME", "NS"]) {
    try {
      const r = t === "A" ? await dns.resolve4("xn--gmqq09al6z.com")
        : t === "CNAME" ? await dns.resolveCname("xn--gmqq09al6z.com")
        : await dns.resolveNs("xn--gmqq09al6z.com");
      console.log(`${t.padEnd(6)} ${JSON.stringify(r)}`);
    } catch (e) { console.log(`${t.padEnd(6)} ${e.code}`); }
  }
  try {
    const r = await fetch("https://xn--gmqq09al6z.com/", { redirect: "manual" });
    console.log("HTTP   ", r.status, "→", r.headers.get("location") || "(无跳转)");
  } catch (e) { console.log("HTTP    ERR", e.message); }
  try {
    const r = await fetch("https://yurenbang-com-redirect.pages.dev/", { redirect: "manual" });
    console.log("跳转项目", r.status, "→", r.headers.get("location") || "(无跳转)");
  } catch (e) { console.log("跳转项目 ERR", e.message); }
})();
