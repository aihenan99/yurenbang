/* 后台入口显隐回归测试
   验收标准：
   ① 未登录 → 「我的」页没有「管理后台」，分享层后台区块隐藏
   ② 普通账号登录 → 同样看不到任何后台入口
   ③ 管理员登录 → 「管理后台」自动出现（无需重开应用），分享层区块可见
   ④ 管理员退出登录 → 入口自动消失 */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const BASE = 'http://127.0.0.1:8765/yurenbang-app/yurenbang-app.html';
const ADMIN_ID = '2110319594408247296';

function user(id, rawExtra) {
  const raw = Object.assign({ sub: id, name: 'administrator', is_anonymous: false }, rawExtra || {});
  return { id: id, name: raw.name, avatarUrl: '', isAnonymous: false, raw: raw };
}
function sess(u) { return u ? { accessToken: '', refreshToken: '', expiresAt: Date.now() + 3600000, user: u } : null; }

function stub(init, next) {
  return `
window.__ST = { cur: ${JSON.stringify(init)}, next: ${JSON.stringify(next)}, out:false };
(function(){
  function chain(){
    return { select(){return this}, order(){return this}, limit(){return this}, eq(){return this},
      update(){return this}, delete(){return this}, insert(){return this},
      then(res){ res({data:[], error:null}); } };
  }
  window.WorkBuddyCloud = { createWorkBuddyCloud: function(){ return {
    auth: {
      getSession: async function(){ return {data: window.__ST.out ? null : window.__ST.cur, error:null}; },
      handleWechatWebCallback: async function(){ return {data:null,error:null}; },
      onAuthStateChange: function(){},
      signOut: async function(){ window.__ST.out = true; window.__ST.cur = null; },
      sendOtp: async function(){ return {data:{verificationId:'v1',isExistingUser:true}}; },
      verifyOtp: async function(){ window.__ST.cur = window.__ST.next; return {data: window.__ST.cur}; },
      signInWithOAuth: async function(){ return {data:{url:'about:blank'}}; }
    },
    database: { from: function(){ return chain(); } }
  }; } };
})();`;
}

async function boot(browser, init, next) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/net::|ERR_|404|Failed to fetch/.test(m.text())) errs.push('CONSOLE: ' + m.text().slice(0, 130)); });
  await ctx.route(/workbuddy-cloud-sdk/, r => r.fulfill({ status: 200, contentType: 'application/javascript', body: stub(init, next) }));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(4500);
  return { ctx, page, errs };
}
async function snap(page) {
  return page.evaluate(() => ({
    menuAdmin: !!document.querySelector('#mmAdmin'),
    menuShare: !!document.querySelector('#mmShare'),
    itemCount: document.querySelectorAll('#meMenu .me-item').length,
    slBoxDisplay: (() => { const b = document.querySelector('#slAdminBox'); return b ? (b.style.display || 'visible') : 'absent'; })(),
    isAdmin: !!(window.YRB_CONSOLE && YRB_CONSOLE.isAdmin()),
    name: ((document.querySelector('.me-n') || {}).textContent || '').trim().split(' ')[0]
  }));
}
async function goMe(page) { await page.click('.tb-item[data-p="me"]'); await page.waitForTimeout(700); }

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const out = {};

  /* ① 未登录 */
  {
    const { ctx, page, errs } = await boot(b, null, null);
    await goMe(page);
    out.case1_notLoggedIn = await snap(page);
    /* 分享层后台区块应隐藏 */
    await page.click('#mmShare'); await page.waitForTimeout(700);
    out.case1_notLoggedIn.shareLayerBox = await page.evaluate(() => {
      const el = document.querySelector('#slAdminBox');
      return el ? getComputedStyle(el).display : 'absent';
    });
    await page.screenshot({ path: 'E:/育人帮/temp/vis_notlogin.png' });
    out.case1_notLoggedIn.errors = errs.slice(0, 4);
    await ctx.close();
  }

  /* ② 普通账号登录（打开时即为普通账号） */
  {
    const { ctx, page, errs } = await boot(b, sess(user('987654321000')), null);
    await goMe(page);
    out.case2_normalUser = await snap(page);
    /* #admin 直达也应被拦 */
    const { ctx: c2, page: p2, errs: e2 } = await boot(b, sess(user('987654321000')), null);
    await p2.goto(BASE + '#admin', { waitUntil: 'load' });
    await p2.waitForTimeout(5000);
    out.case2_normalUser.deepLinkGate = await p2.evaluate(() =>
      (document.querySelector('#adBody') || {}).innerText ? document.querySelector('#adBody').innerText.split('\n').filter(Boolean)[0] + '|' + (document.querySelector('#adBody').innerText.includes('不是管理员') ? 'blocked' : 'other') : 'absent');
    out.case2_normalUser.errors = errs.slice(0, 4).concat(e2.slice(0, 2));
    await c2.close(); await ctx.close();
  }

  /* ③ 管理员用手机号登录（从"我的→登录/注册"进入）→ 入口自动出现 */
  {
    const adminSess = sess(user(ADMIN_ID, { phone_number: '+86 18037345855' }));
    const { ctx, page, errs } = await boot(b, null, adminSess);
    await goMe(page);
    out.case3_admin = { before: await snap(page) };
    await page.click('#clAcct'); await page.waitForTimeout(900);        /* 打开登录面板 */
    await page.click('#lgCk');  await page.waitForTimeout(150);          /* 勾选协议 */
    await page.fill('#lgPhone', '18037345855');
    await page.click('#lgSend'); await page.waitForTimeout(1200);        /* 获取验证码 */
    await page.fill('#lgCode', '123456');
    await page.click('#lgSubmit'); await page.waitForTimeout(2500);      /* 提交登录 */
    await goMe(page);
    out.case3_admin.afterLogin = await snap(page);
    /* 分享层区块此时应可见 */
    await page.click('#mmShare'); await page.waitForTimeout(700);
    out.case3_admin.shareLayerBox = await page.evaluate(() => {
      const el = document.querySelector('#slAdminBox');
      return el ? getComputedStyle(el).display : 'absent';
    });
    await page.click('#slBack'); await page.waitForTimeout(500);
    /* ④ 退出登录 → 入口消失 */
    await page.evaluate(async () => { await window.YRB_CLOUD.signOut(); });
    await page.waitForTimeout(1000);
    await goMe(page);
    out.case3_admin.afterSignOut = await snap(page);
    await page.screenshot({ path: 'E:/育人帮/temp/vis_after_logout.png' });
    out.case3_admin.errors = errs.slice(0, 4);
    await ctx.close();
  }

  console.log(JSON.stringify(out, null, 1));
  await b.close();
})().catch(e => { console.error('FATAL', e && e.message); process.exit(1); });
