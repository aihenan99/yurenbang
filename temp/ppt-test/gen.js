const PptxGenJS = require("pptxgenjs");
const p = new PptxGenJS();
p.layout = "LAYOUT_16x9";
p.defineSlideMaster({ title: "M", background: { color: "F6F1EA" } });
let s = p.addSlide();
s.background = { color: "FFE0CB" };
s.addText("开学焦虑怎么办？", { x: 0.6, y: 0.9, w: 8.8, h: 1.2, fontSize: 40, bold: true, color: "3A2E2A" });
s.addText("写给家长的三页手册 · 心理老师周周", { x: 0.6, y: 2.1, w: 8.8, h: 0.6, fontSize: 18, color: "7A6A60" });

let s2 = p.addSlide();
s2.background = { color: "FFFFFF" };
s2.addText("第一步：先接住情绪", { x: 0.6, y: 0.5, w: 8.8, h: 0.9, fontSize: 30, bold: true, color: "2F6F5E" });
s2.addText([
  { text: "别急着讲道理，先说「我知道你有点怕」", options: { bullet: true, fontSize: 18 } },
  { text: "每天留 10 分钟只听不说", options: { bullet: true, fontSize: 18 } },
  { text: "把担心写下来，一起看看哪条能解决", options: { bullet: true, fontSize: 18 } }
], { x: 0.8, y: 1.6, w: 8.4, h: 3.0, color: "444444", lineSpacing: 34 });

let s3 = p.addSlide();
s3.background = { color: "EAF4F0" };
s3.addText("第二步：把大目标拆小", { x: 0.6, y: 0.5, w: 8.8, h: 0.9, fontSize: 30, bold: true, color: "2F6F5E" });
s3.addShape(p.ShapeType.roundRect, { x: 0.8, y: 1.7, w: 3.9, h: 2.6, fill: { color: "FFFFFF" }, line: { color: "BFE0D4" } });
s3.addText("今天：整理书包\n明天：预习第一课", { x: 1.0, y: 2.0, w: 3.5, h: 2.0, fontSize: 16, color: "333333" });
s3.addShape(p.ShapeType.rect, { x: 5.1, y: 1.7, w: 4.0, h: 2.6, fill: { color: "FFD9CF" } });
s3.addText("小贴士：完成就打勾", { x: 5.3, y: 2.4, w: 3.6, h: 1.0, fontSize: 18, color: "8A4A32", bold: true });

p.writeFile({ fileName: "sample.pptx" }).then(f => console.log("written", f));
