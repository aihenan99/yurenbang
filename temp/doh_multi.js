const EP = [
  ["Cloudflare", "https://cloudflare-dns.com/dns-query"],
  ["Google", "https://dns.google/resolve"],
  ["阿里", "https://dns.alidns.com/resolve"],
  ["腾讯", "https://doh.pub/dns-query"],
];
const NAMES = ["xn--gmqq09al6z.com", "www.xn--gmqq09al6z.com"];
(async () => {
  for (const [lab, base] of EP) {
    for (const n of NAMES) {
      const u = base.includes("?") || base.endsWith("/resolve")
        ? `${base}?name=${n}&type=A` : `${base}?name=${n}&type=A`;
      try {
        const r = await fetch(u, { headers: { accept: "application/dns-json" } });
        const j = await r.json();
        const ans = (j.Answer || []).map(a => `${a.type === 5 ? "CNAME:" : "A:"}${a.data}`);
        console.log(`  ${lab.padEnd(11)} ${n.padEnd(24)} ${ans.join(" | ") || "无记录(Status=" + j.Status + ")"}`);
      } catch (e) {
        console.log(`  ${lab.padEnd(11)} ${n.padEnd(24)} ERR ${e.message.slice(0, 40)}`);
      }
    }
  }
})();
