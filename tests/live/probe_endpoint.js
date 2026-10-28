const targets = [
  ["wb cloud.js", "https://yurenbang.app.workbuddy.host/assets/cloud.js"],
  ["wb admin.js", "https://yurenbang.app.workbuddy.host/assets/admin.js"],
  ["wb capture.js", "https://yurenbang.app.workbuddy.host/assets/capture.js"],
  ["cn cloud.js", "https://xn--gmqq09al6z.cn/assets/cloud.js"],
];
(async () => {
  for (const [n, u] of targets) {
    const t = await (await fetch(u)).text();
    const ep = (t.match(/endpoint:"[^"]*"/) || [])[0] || "-";
    const au = (t.match(/const APP_URL = "[^"]*"/) || [])[0] || "-";
    const lu = (t.match(/const LIVE_URL="[^"]*"/) || [])[0] || "-";
    console.log(`${n.padEnd(14)} ${ep} | ${au} | ${lu}`);
  }
})();
