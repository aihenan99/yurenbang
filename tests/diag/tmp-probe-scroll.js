const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const LONG = "每天晚上写作业都要拖到十点，一说就哭。我试过陪着写、也试过定闹钟，都不太管用。后来又试了番茄钟，前两天有点用，第三天就完全失效了。孩子在学校上课也坐不住，老师反映说小动作特别多。家里老人说是缺微量元素，带去查了又都正常。求有经验的家长指点一下，到底应该怎么引导，还是需要去测一下注意力？";
const POSTS = [
  { id: 9101, user: "测试家长", title: "孩子写作业拖拉怎么办", text: LONG, likes: 3, favs: 1, helps: 2, time: "10 分钟前", ava: "rabbit", tag: "求助", comments: [{ user: "家长A", text: "先陪他做十分钟", likes: 1, liked: false }], roses: ["家长A"], vis: 0, urg: 1 },
  { id: 9102, user: "另一位家长", title: "孩子不肯自己睡", text: "五岁了还要大人陪睡，一关灯就哭，怎么办？", likes: 0, favs: 0, helps: 0, time: "刚刚", ava: "rabbit", tag: "求助", comments: [], roses: [], vis: 0, urg: 1 }
];
(async () => {
  const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
  const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, serviceWorkers: "block" });
  await ctx.addInitScript("try{localStorage.setItem('yrb_autospeak','0');}catch(e){}Object.defineProperty(navigator,'webdriver',{get:()=>false});");
  const p = await ctx.newPage();
  await p.goto("http://127.0.0.1:8794/index.html?sc=" + Date.now(), { waitUntil: "load" });
  await p.waitForTimeout(1100);
  await p.evaluate(() => { try { enterApp(); } catch (e) {} });
  await p.waitForTimeout(400);
  await p.evaluate(list => { S.posts = list; try { switchTab("home"); } catch (e) {} try { renderFeed(); } catch (e) {} }, POSTS);
  await p.waitForTimeout(700);
  await p.locator('#feed .card[data-id="9101"] .p-text').first().click();
  await p.waitForTimeout(1000);
  console.log(JSON.stringify(await p.evaluate(() => {
    const d = document.getElementById("r23Detail"), bd = d.querySelector(".r23-dbody");
    bd.scrollTop = (bd.scrollHeight - bd.clientHeight) / 2;
    return {
      fs: d.classList.contains("mf-fs"),
      dScroll: [d.scrollTop, d.scrollHeight, d.clientHeight],
      bdScroll: [bd.scrollTop, bd.scrollHeight, bd.clientHeight],
      dStyle: getComputedStyle(d).overflow + "/" + getComputedStyle(d).display,
      bdStyle: getComputedStyle(bd).overflowY
    };
  }), null, 1));
  await b.close();
})();
