"use strict";
const fs=require("fs"),path=require("path");
const CHROME=["C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find(p=>fs.existsSync(p));
(async()=>{
const {chromium}=require(path.join(__dirname,"pw","node_modules","playwright-core"));
const b=await chromium.launch({executablePath:CHROME,headless:true});
const p=await (await b.newContext()).newPage();
const png=fs.readFileSync(path.join(__dirname,"imgviewer-1-open.png")).toString("base64");
const out=await p.evaluate(async (b64)=>{
  const img=new Image();
  img.src="data:image/png;base64,"+b64;
  await new Promise(r=>img.onload=r);
  const cv=document.createElement("canvas"); cv.width=img.width; cv.height=img.height;
  const cx=cv.getContext("2d"); cx.drawImage(img,0,0);
  function px(x,y){const d=cx.getImageData(x,y,1,1).data;return [d[0],d[1],d[2],d[3]];}
  return {size:[img.width,img.height],
    top_bar:px(195,100), top_left:px(30,60), chip:px(60,152),
    below_img:px(195,700), above_img:px(195,210)};
},png);
console.log(JSON.stringify(out));
await b.close();
})();
