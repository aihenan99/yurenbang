/* 管理后台登录/权限回归测试
   核心：桩会话对象必须与真实 SDK 的 parseSession() 输出结构完全一致
   —— {id,name,avatarUrl,isAnonymous,raw}，**不含 phone**（这正是线上管理员被误判的原因） */
const { chromium } = require("../../temp/pw/node_modules/playwright-core");
const CHROME = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const BASE = 'http://127.0.0.1:8765/yurenbang-app/yurenbang-app.html';
const ADMIN_ID = '2110319594408247296';

function stubScript(sess) {
  return `
window.__SIGNED_OUT = false;
(function(){
  var SESS = ${JSON.stringify(sess)};
  function chain(){
    var q = {
      select(){return this;}, order(){return this;}, limit(){return this;}, eq(){return this;},
      update(){return this;}, delete(){return this;}, insert(){return this;},
      then(res){ res({data: SESS && SESS.__posts || [], error:null}); }
    };
    return q;
  }
  window.WorkBuddyCloud = {
    createWorkBuddyCloud: function(){
      return {
        auth: {
          getSession: async function(){ return {data: window.__SIGNED_OUT ? null : SESS, error:null}; },
          handleWechatWebCallback: async function(){ return {data:null,error:null}; },
          onAuthStateChange: function(){},
          signOut: async function(){ window.__SIGNED_OUT = true; },
          sendOtp: async function(){ return {data:{verificationId:'v1',isExistingUser:true}}; },
          verifyOtp: async function(){ return {data:SESS}; },
          signInWithOAuth: async function(){ return {data:{url:'about:blank'}}; }
        },
        database: { from: function(){ return chain(); } }
      };
    }
  };
})();`;
}

/* 真实 SDK 的 user 形状：只有 id/name/avatarUrl/isAnonymous/raw */
function realUser(id, rawExtra) {
  const raw = Object.assign({ sub: id, name: 'administrator', is_anonymous: false }, rawExtra || {});
  return { id: id, name: raw.name, avatarUrl: '', isAnonymous: false, raw: raw };
}
function sess(user) {
  return { accessToken: '', refreshToken: '', expiresAt: Date.now() + 3600000, user: user };
}

async function openAdminPanel(browser, session) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/net::|ERR_|404|Failed to fetch/.test(m.text())) errs.push('CONSOLE: ' + m.text().slice(0, 140)); });
  await ctx.route(/workbuddy-cloud-sdk/, route =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: stubScript(session) }));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(4500);
  const stubOK = await page.evaluate(() => !!(window.WorkBuddyCloud && /__SIGNED_OUT/.test(String(window.WorkBuddyCloud.createWorkBuddyCloud))));
  await page.click('.tb-item[data-p="me"]');
  await page.waitForTimeout(600);
  await page.click('#mmAdmin');
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => ({
    who: (window.YRB_CLOUD && YRB_CLOUD.who()) || null,
    isAdmin: !!(window.YRB_CONSOLE && YRB_CONSOLE.isAdmin()),
    body: (document.querySelector('#adBody') || {}).innerText || '',
    nameText: (document.querySelector('.me-n') || {}).textContent || '',
    hasCards: !!document.querySelector('#adBody .ad-cards'),
    switchBtn: !!document.querySelector('#adSwitch'),
    loginBtn: !!document.querySelector('#adLogin')
  }));
  info.errors = errs.slice(0, 6);
  info.stubOK = stubOK;
  return { ctx, page, info };
}

(async () => {
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const out = {};

  /* 用例 1：管理员（真实 SDK 结构，无手机号）——修复前必然失败 */
  {
    const { ctx, page, info } = await openAdminPanel(b, sess(realUser(ADMIN_ID)));
    out.case1_adminNoPhone = {
      whoId: info.who && info.who.id, whoPhone: info.who && info.who.phone,
      isAdmin: info.isAdmin, hasDataCards: info.hasCards,
      bodyHead: info.body.split('\n').slice(0, 2).join(' / '), name: info.nameText.trim(),
      errors: info.errors
    };
    await page.screenshot({ path: 'E:/育人帮/temp/admin_ok.png' });
    await ctx.close();
  }

  /* 用例 2：管理员 + 会话里有手机号 → 额外验证展示 */
  {
    const { ctx, info } = await openAdminPanel(b, sess(realUser(ADMIN_ID, { phone_number: '+86 18000005855' })));
    out.case2_adminWithPhone = { stubOK: info.stubOK, who: info.who, isAdmin: info.isAdmin, hasDataCards: info.hasCards };
    await ctx.close();
  }

  /* 用例 3：普通账号 → 应被拦下，并给出「切换管理员账号」 */
  {
    const { ctx, page, info } = await openAdminPanel(b, sess(realUser('987654321000')));
    out.case3_normalUser = { isAdmin: info.isAdmin, switchBtn: info.switchBtn, bodyHead: info.body.split('\n').slice(0, 2).join(' / ') };
    /* 点切换 → 应退出登录并弹出登录面板 */
    await page.click('#adSwitch');
    await page.waitForTimeout(1200);
    out.case3_normalUser.afterSwitch = await page.evaluate(() => ({
      signedOut: window.__SIGNED_OUT === true,
      loginOpen: !!document.querySelector('#loginSheet.open'),
      gateText: (document.querySelector('#adBody') || {}).innerText.split('\n')[0]
    }));
    await ctx.close();
  }

  /* 用例 4：未登录 → 提示登录，点按钮打开登录面板 */
  {
    const { ctx, page, info } = await openAdminPanel(b, null);
    out.case4_signedOut = { bodyHead: info.body.split('\n').slice(0, 2).join(' / '), loginBtn: info.loginBtn };
    await page.click('#adLogin');
    await page.waitForTimeout(900);
    out.case4_signedOut.loginOpen = await page.evaluate(() => !!document.querySelector('#loginSheet.open'));
    await page.screenshot({ path: 'E:/育人帮/temp/admin_login_sheet.png' });
    await ctx.close();
  }

  console.log(JSON.stringify(out, null, 1));
  await b.close();
})().catch(e => { console.error('FATAL', e && e.message); process.exit(1); });
