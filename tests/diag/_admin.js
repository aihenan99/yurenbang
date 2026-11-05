/* 诊断脚本共用的「管理员手机号」取值口（2026-11-05）

   为什么不写在脚本里：手机号属于个人敏感信息，写进被 git 跟踪的脚本 = 公开泄露，
   而且换号要改一堆文件。唯一出处是 config/admin.local.json（.gitignore 已屏蔽），
   deploy 时的 window.YRB_ADMIN 也是从这里注入的 —— 同一个地方，不重复抄。

   取值顺序：环境变量 YRB_ADMIN_PHONE → config/admin.local.json 的 phones[0]。
   拿不到就返回空串，脚本自己决定跳过（不要硬编码兜底号）。 */
const fs = require("fs");
const path = require("path");

function adminPhone() {
  if (process.env.YRB_ADMIN_PHONE) return String(process.env.YRB_ADMIN_PHONE).replace(/\D/g, "");
  const p = path.join(__dirname, "..", "..", "config", "admin.local.json");
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    const list = Array.isArray(j.phones) ? j.phones : [];
    return String(list[0] || "").replace(/\D/g, "");
  } catch (e) {
    return "";
  }
}

const raw = adminPhone();

module.exports = {
  phone: raw,                       /* 180xxxxxxxx */
  e164: raw ? "+86" + raw : "",     /* +86180xxxxxxxx */
  spaced: raw ? "+86 " + raw : ""   /* +86 180xxxxxxxx（平台接口的展示格式） */
};
