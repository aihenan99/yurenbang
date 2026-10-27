const fs = require('fs');
const s = fs.readFileSync(__dirname + '/sdk.js', 'utf8');
let m = s.match(/var j="([^"]+)"/);
console.log('CLOUD_PATH_PREFIX =', m && m[1]);
m = s.match(/var R=\{(.{0,500}?)\};/s);
console.log('CLOUD_MODULE_PATHS =', m && m[1]);
const i = s.indexOf('/v1/verification"');
console.log('--- /v1/verification 上下文 ---');
console.log(s.slice(Math.max(0, i - 300), i + 400));
