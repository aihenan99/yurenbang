(async () => {
  const r = await fetch("https://yurenbang.app.workbuddy.host/?cb=" + Date.now());
  const t = await r.text();
  console.log("status", r.status, "len", t.length);
  console.log("title:", (t.match(/<title>([^<]*)<\/title>/) || [])[1]);
  console.log("has meta refresh:", /http-equiv="refresh"/i.test(t));
  console.log("has #phone:", /id="phone"/.test(t));
  const r2 = await fetch("https://yurenbang.app.workbuddy.host/yurenbang-app.html");
  const t2 = await r2.text();
  console.log("app title:", (t2.match(/<title>([^<]*)<\/title>/) || [])[1]);
  console.log("app len", t2.length, "| gate?", /assets\/gate\.js/.test(t2), "| adminguard?", /adminguard/.test(t2));
})();
