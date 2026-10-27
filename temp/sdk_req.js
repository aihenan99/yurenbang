const fs = require('fs');
const s = fs.readFileSync(__dirname + '/sdk.js', 'utf8');

// PUBLISHABLE_KEY_HEADER
let m = s.match(/be="([^"]+)"/) || s.match(/PUBLISHABLE_KEY_HEADER[^=]*=\s*"([^"]+)"/);
console.log('publishable key header =', m && m[1]);

// 找 fetch 调用上下文：搜 ".cloud" 拼接处
let i = s.indexOf('/.cloud');
console.log('--- /.cloud 上下文 ---');
console.log(s.slice(Math.max(0, i - 400), i + 200));

// 找 auth 模块 sendOtp/verification 请求
i = s.indexOf('R.verification');
if (i < 0) i = s.search(/verification\b[^"]*fetch|request\(\{[^}]*verification/);
console.log('\n--- verification 调用处 ---');
const j = s.indexOf('paths.verification') !== -1 ? s.indexOf('paths.verification') : s.search(/[a-zA-Z]\.verification[,\)]/);
console.log(s.slice(Math.max(0, j - 500), j + 300));
