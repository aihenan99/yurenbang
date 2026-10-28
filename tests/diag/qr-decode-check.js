// 用 jsQR 解码验证生成的二维码内容
const fs = require("fs");
const { PNG } = require("C:/Users/a/.workbuddy/binaries/node/workspace/node_modules/pngjs");
const jsQR = require("C:/Users/a/.workbuddy/binaries/node/workspace/node_modules/jsqr");
const png = PNG.sync.read(fs.readFileSync("E:/育人帮/yurenbang-app/assets/qr-share.png"));
const data = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
if (!data) { console.log("DECODE FAIL: 识别不到二维码"); process.exit(1); }
console.log("decoded:", data.data);
if (data.data !== "https://xn--gmqq09al6z.cn/") { console.log("CONTENT MISMATCH!"); process.exit(1); }
console.log("DECODE OK ->", data.data);
