/* 核对线上 refine23.js 年龄段相关代码已清除（临时脚本） */
(async () => {
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch("https://xn--gmqq09al6z.cn/assets/refine23.js?v=" + Date.now(), { signal: AbortSignal.timeout(25000) });
      const t = await r.text();
      console.log("HTTP", r.status, "长度", t.length);
      console.log("渲染模板还有 r23Age 区块:", t.includes('id="r23Age"'));
      console.log("onclick 绑定还在:", t.includes('$("#r23Age").onclick'));
      console.log("AI 卡片还拼年龄段 chip:", t.includes("curAge"));
      console.log("payload age 已置空:", t.includes('age:"",urg,vis,loc'));
      return;
    } catch (e) { console.log("#" + i, "失败:", e.cause ? e.cause.code || e.cause.message : e.message); }
  }
})();
