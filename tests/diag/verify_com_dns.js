const dns = require("dns").promises;
const NAMES = ["xn--gmqq09al6z.com", "www.xn--gmqq09al6z.com"];
(async () => {
  console.log("=== 系统解析器 ===");
  for (const n of NAMES) {
    for (const t of ["A", "CNAME"]) {
      try {
        const r = t === "A" ? await dns.resolve4(n) : await dns.resolveCname(n);
        console.log(`  ${n.padEnd(24)} ${t.padEnd(6)} ${JSON.stringify(r)}`);
      } catch (e) { console.log(`  ${n.padEnd(24)} ${t.padEnd(6)} ${e.code}`); }
    }
  }
  console.log("=== Google DoH（绕开本机缓存） ===");
  for (const n of NAMES) {
    try {
      const r = await fetch(`https://dns.google/resolve?name=${n}&type=A`);
      const j = await r.json();
      console.log(`  ${n.padEnd(24)} ${(j.Answer || []).map(a => a.data).join(", ") || "无记录"}`);
    } catch (e) { console.log(`  ${n.padEnd(24)} ERR ${e.message}`); }
  }
})();
