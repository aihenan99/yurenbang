// 轮询 .com 的解析与 HTTP 跳转是否就绪
const dns = require("dns").promises;
const https = require("https");
const http = require("http");

const HOST = "xn--gmqq09al6z.com";
const CN = "xn--gmqq09al6z.cn";

function req(url, timeout = 12000) {
  return new Promise((res) => {
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : http;
    const r = mod.request(
      { host: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: u.pathname + u.search, method: "GET", timeout },
      (resp) => {
        let b = "";
        resp.setEncoding("utf8");
        resp.on("data", (c) => (b += c));
        resp.on("end", () => res({ status: resp.statusCode, loc: resp.headers.location || "", server: resp.headers.server || "-", body: b }));
      }
    );
    r.on("error", (e) => res({ err: e.code || e.message }));
    r.on("timeout", () => { r.destroy(); res({ err: "TIMEOUT" }); });
    r.end();
  });
}

(async () => {
  for (let i = 1; i <= 20; i++) {
    let a = "-";
    try {
      const r = await dns.resolve4(HOST);
      a = r.join(",");
    } catch (e) {
      a = e.code;
    }
    const h = await req("http://" + HOST + "/");
    console.log(
      `[${String(i).padStart(2)}] A=${a.padEnd(34)} http=${h.status || h.err} loc=${(h.loc || "-").slice(0, 60)}`
    );
    if (h.status && (h.status === 301 || h.status === 302 || h.status === 308)) {
      console.log("    → 跳转已生效");
      const h2 = await req("https://" + CN + "/");
      console.log("    目标 .cn 状态:", h2.status, "server=", h2.server);
      break;
    }
    if (h.status === 200 && h.body && h.body.includes("育人帮")) {
      console.log("    → 已可访问（200）");
      break;
    }
    await new Promise((r) => setTimeout(r, 15000));
  }
})();
