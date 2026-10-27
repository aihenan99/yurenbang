const fs = require('fs');
const s = fs.readFileSync(__dirname + '/sdk.js', 'utf8');

// 定位 AuthModule 类
let i = s.indexOf('var D=class');
if (i < 0) i = s.indexOf('D=class{');
console.log('AuthModule 起始位置:', i);
const body = s.slice(i, i + 9000);
const methods = [...body.matchAll(/(?:^|\})(?:async\s+)?([a-zA-Z][a-zA-Z0-9_]{2,30})\s*\(([a-z])\)\s*\{/g)].map(m => m[1]);
console.log('=== AuthModule 方法 ===');
console.log([...new Set(methods)].join('\n'));

// 找用户名归一化：手机号如何变成 username
console.log('\n=== 用户名归一化（phone → username） ===');
for (const key of ['country', 'phone_number', 'normalize']) {
  let j = -1, n = 0;
  while ((j = s.indexOf(key, j + 1)) !== -1 && n < 3) { n++; }
  j = s.indexOf(key);
  if (j >= 0) console.log('--- ' + key + ' ---\n' + s.slice(Math.max(0, j - 200), j + 200).replace(/\s+/g, ' ').slice(0, 320));
}

// 找 /v1/user/password 与 /v1/user/sudo 是否被真实调用
for (const key of ['b.userPassword', 'b.sudo', 'userPassword:', 'sudo:']) {
  let j = s.indexOf(key);
  console.log('\n--- ' + key + ' 调用上下文 ---');
  console.log(j < 0 ? '(未出现)' : s.slice(Math.max(0, j - 260), j + 160).replace(/\s+/g, ' ').slice(0, 380));
}
