const targets = [
  ["育人帮.com", "https://xn--gmqq09al6z.com/"],
  ["www.育人帮.com", "https://www.xn--gmqq09al6z.com/"],
  ["育人帮.com 带路径", "https://xn--gmqq09al6z.com/share.html?a=1"],
  ["http 版", "http://xn--gmqq09al6z.com/"],
];
(async () => {
  for (const [n, u] of targets) {
    try {
      const r = await fetch(u, { redirect: "manual" });
      const loc = r.headers.get("location") || "(无)";
      console.log(`${n.padEnd(18)} ${r.status}  →  ${loc}`);
    } catch (e) {
      const m = String(e.message || e);
      console.log(`${n.padEnd(18)} ERR  ${m.includes("certificate") || m.includes("SSL") ? "证书尚未签发" : m.slice(0, 60)}`);
    }
  }
})();
