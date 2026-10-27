const https = require('https');
function req(method, u, headers, body) {
  return new Promise((res) => {
    const r = https.request(u, { method, headers }, x => {
      let b = ''; x.setEncoding('utf8');
      x.on('data', c => b += c);
      x.on('end', () => res({ s: x.statusCode, h: x.headers, b }));
    });
    r.on('error', e => res({ err: e.code + ' ' + e.message }));
    r.setTimeout(25000, () => { r.destroy(); res({ err: 'TIMEOUT' }); });
    if (body) r.write(body);
    r.end();
  });
}
(async () => {
  const KEY = 'wbpk_Lt4Zxzyd4j1x3DZdRFyFF9_mGfhreB3aiE9eS2lsMIzIG6z3V4E1O01';
  const O = 'https://xn--gmqq09al6z.cn';
  const tests = [
    ['GET', '/yrbapi/.cloud/auth/v1/user/me', {}],
    ['POST', '/yrbapi/.cloud/auth/v1/verification', { phone_number: '+8618037345855', target: 'ANY' }],
  ];
  for (const [m, p, body] of tests) {
    const h = { 'Origin': O, 'Content-Type': 'application/json', 'x-wb-webapp-access-key': KEY };
    const r = await req(m, O + p + '?cb=' + Date.now(), h, m === 'POST' ? JSON.stringify(body) : null);
    console.log('%s %s -> status=%s', m, p, r.s || r.err);
    console.log('   acao=%s body=%s', r.h && r.h['access-control-allow-origin'], (r.b || '').replace(/\s+/g, ' ').slice(0, 200));
  }
  const c = await req('GET', O + '/assets/cloud.js?cb=' + Date.now(), {});
  const m2 = (c.b || '').match(/endpoint:"([^"]+)"/);
  console.log('\n线上 cloud.js endpoint =', m2 && m2[1]);
})();
