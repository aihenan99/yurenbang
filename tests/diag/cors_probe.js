const https = require('https');
const ADM = require('./_admin');   /* 管理员手机号从 config/admin.local.json 取，不入库 */
function req(method, u, headers, body) {
  return new Promise((res) => {
    const r = https.request(u, { method, headers }, x => {
      let b = ''; x.setEncoding('utf8');
      x.on('data', c => b += c);
      x.on('end', () => res({ s: x.statusCode, h: x.headers, b: b.slice(0, 400) }));
    });
    r.on('error', e => res({ err: e.code + ' ' + e.message }));
    r.setTimeout(20000, () => { r.destroy(); res({ err: 'TIMEOUT' }); });
    if (body) r.write(body);
    r.end();
  });
}
(async () => {
  if (!ADM.e164) { console.log('缺 config/admin.local.json 里的管理员手机号，跳过（本脚本需要真号才能探测验证码接口）'); return; }
  const EP = 'https://yurenbang.app.workbuddy.host';
  const P = EP + '/.cloud/auth/v1/verification';
  const KEY = 'wbpk_Lt4Zxzyd4j1x3DZdRFyFF9_mGfhreB3aiE9eS2lsMIzIG6z3V4E1O01';
  for (const origin of ['https://xn--gmqq09al6z.cn', 'https://yurenbang.app.workbuddy.host', null]) {
    console.log('=== Origin:', origin || '(none)', '===');
    const pre = await req('OPTIONS', P, {
      'Origin': origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-wb-webapp-access-key',
    });
    console.log('  OPTIONS status=%s acao=%s', pre.s || pre.err, pre.h && pre.h['access-control-allow-origin']);
    const body = JSON.stringify({ phone_number: ADM.e164, target: 'ANY' });
    const p = await req('POST', P, {
      'Origin': origin, 'Content-Type': 'application/json',
      'x-wb-webapp-access-key': KEY,
    }, body);
    console.log('  POST status=%s acao=%s body=%s',
      p.s || p.err, p.h && p.h['access-control-allow-origin'], (p.b || '').slice(0, 200));
  }
})();
