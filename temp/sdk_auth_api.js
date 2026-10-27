const fs = require('fs');
const s = fs.readFileSync(__dirname + '/sdk.js', 'utf8');

// 列出 AuthModule 上的所有方法名
const names = new Set();
for (const m of s.matchAll(/(?:async\s+)?([a-zA-Z][a-zA-Z0-9_]{2,30})\(e\)\{let t=B\(e,"([a-zA-Z0-9_]+)"\)/g)) {
  names.add(m[2]);
}
console.log('=== Auth 方法（按参数校验函数名推断）===');
console.log([...names].sort().join('\n'));

console.log('\n=== 含 password / sudo 的关键片段 ===');
for (const key of ['signInWithPassword', 'updatePassword', 'setPassword', 'sudo', 'verifyPassword', 'userPassword']) {
  const i = s.indexOf(key);
  if (i >= 0) console.log('\n--- ' + key + ' ---\n' + s.slice(Math.max(0, i - 120), i + 220).replace(/\s+/g, ' ').slice(0, 340));
}
