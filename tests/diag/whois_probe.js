// WHOIS 查询：育人帮.com 的注册商 / NS / 状态
const net = require("net");

function whois(server, query) {
  return new Promise((resolve) => {
    let data = "";
    const s = net.createConnection(43, server, () => s.write(query + "\r\n"));
    s.setEncoding("utf8");
    s.on("data", (d) => (data += d));
    s.on("end", () => resolve(data));
    s.on("error", (e) => resolve("ERR " + e.code));
    s.setTimeout(15000, () => { s.destroy(); resolve(data || "TIMEOUT"); });
  });
}

(async () => {
  const d = "xn--gmqq09al6z.com";
  let raw = await whois("whois.verisign-grs.com", "domain " + d);
  const ref = (raw.match(/Registrar WHOIS Server:\s*(\S+)/i) || [])[1];
  console.log("=== Verisign 摘要 ===");
  for (const line of raw.split(/\r?\n/)) {
    if (/^(Domain Name|Registrar:|Registrar WHOIS|Creation Date|Registry Expiry|Domain Status|Name Server):/i.test(line)) {
      console.log("  " + line.trim());
    }
  }
  console.log("\n[注册商 WHOIS 服务器] " + (ref || "(未给出)"));
  if (ref) {
    const raw2 = await whois(ref, d);
    console.log("\n=== 注册商 WHOIS 摘要 ===");
    for (const line of raw2.split(/\r?\n/)) {
      if (/registrar|name server|ns |expir|status|注册|域名|到期|服务器/i.test(line) && line.trim()) {
        console.log("  " + line.trim().slice(0, 160));
      }
    }
  }
})();
