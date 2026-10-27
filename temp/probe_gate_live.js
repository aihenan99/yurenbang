(async () => {
  for (const u of ["https://xn--gmqq09al6z.cn/assets/gate.js", "https://xn--gmqq09al6z.cn/assets/gate.css"]) {
    const t = await (await fetch(u + "?cb=" + Date.now())).text();
    console.log(u.split("/").pop(), "len=" + t.length,
      "| cm-locked:", /cm-locked/.test(t), "| cm-lock:", /cm-lock\b/.test(t),
      "| 留言:", /帮忙留言/.test(t));
  }
  const idx = await (await fetch("https://xn--gmqq09al6z.cn/?cb=" + Date.now())).text();
  console.log("index gate.js ref:", /assets\/gate\.js/.test(idx), "| gate.css:", /assets\/gate\.css/.test(idx));
})();
