const { writeFileSync } = require("fs");
(async () => {
  for (const [n, u] of [["育人帮.com", "https://xn--gmqq09al6z.com/"], ["www", "https://www.xn--gmqq09al6z.com/"]]) {
    const r = await fetch(u, { redirect: "follow" });
    const t = await r.text();
    console.log(`${n.padEnd(10)} 最终 ${r.status} url=${r.url}`);
    console.log(`            title="${(t.match(/<title>([^<]*)<\/title>/) || [])[1]}" 含gate=${/assets\/gate\.js/.test(t)} 含门禁=${/adminguard/.test(t)}`);
  }
})();
