/* =========================================================
   育人帮 · 云服务接入层（登录 / 媒体上传 / 求助入库）
   - SDK：CDN 形式（纯 HTML 无构建步骤）
   - 端点与公钥来自开通云服务时返回的 publicConfig（可安全内置于前端）
   - 未登录可浏览；发布求助 / 上传素材需登录
   - SDK 不可用或被拒绝（如本地域名 Origin 不匹配）时优雅降级，不阻塞演示
   ========================================================= */
(function(){
"use strict";
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/* ---------- publicConfig（开通云服务返回，仅此四项可入前端） ---------- */
const CFG={
  endpoint:"https://yurenbang.app.workbuddy.host",
  oauthRelayBaseUrl:"https://www.workbuddy.cn/v2/as/genie-baas/oauth",
  publishableKey:"wbpk_Lt4Zxzyd4j1x3DZdRFyFF9_mGfhreB3aiE9eS2lsMIzIG6z3V4E1O01"
};

let cloud=null, session=null, cloudPosts=[], ready=false;
let loginResolve=null, pendingOtp=null, sendTimer=null;
let uploading=false;

/* ---------- 验证码挑战凭证持久化（2026-10-23） ----------
   现象：收到验证码填进去，仍提示「请先获取该手机号的验证码」。
   根因：pendingOtp 只存在内存里，页面一旦刷新（弱网自愈 / 启动屏自救 /
   SW 升级 / 用户手动刷新 / 切后台被回收）就丢了，fresh 页面提交必然走
   「请先获取」分支。凭证本身 5 分钟有效，放 sessionStorage 即可跨刷新。
   另外发送接口 20s 超时但短信实际已下发时，用户也会填进旧凭证之外的码——
   此时给出「重新获取」的明确指引，而不是让人卡在这一句上。 */
const OTP_KEY="ybp_otp_v1", OTP_TTL=10*60*1000;
function saveOtp(o){
  pendingOtp=o;
  try{ o?sessionStorage.setItem(OTP_KEY,JSON.stringify({...o,ts:Date.now()})):sessionStorage.removeItem(OTP_KEY); }catch(e){}
}
function loadOtp(){
  if(pendingOtp) return pendingOtp;
  try{
    const raw=sessionStorage.getItem(OTP_KEY);
    if(!raw) return null;
    const o=JSON.parse(raw);
    if(!o||!o.phone||!o.verificationId||(Date.now()-(o.ts||0))>OTP_TTL){sessionStorage.removeItem(OTP_KEY);return null;}
    pendingOtp=o;
    return o;
  }catch(e){ return null; }
}

/* ---------- 工具 ---------- */
function rnd(){return Math.random().toString(36).slice(2,8);}

/* ---------- 从登录会话里取手机号（多路兜底） ----------
   注意：SDK 的会话对象由内部 parseSession() 构造，user 只含
   {id, name, avatarUrl, isAnonymous, raw}，**没有 user.phone**。
   历史代码直接读 user.phone 恒为空 → 管理员被误判为普通用户（后台进不去）。
   因此这里按可靠性依次尝试：user 各字段 → raw（服务端原始载荷）→ accessToken 的 JWT 载荷
   → 形如 11 位手机号的昵称。任一命中即返回后 11 位数字。 */
function jwtPayload(tok){
  try{
    const part=String(tok||"").split(".")[1];
    if(!part)return {};
    const b64=part.replace(/-/g,"+").replace(/_/g,"/");
    const bin=atob(b64.padEnd(Math.ceil(b64.length/4)*4,"="));
    /* 转 UTF-8，避免中文昵称解码乱码 */
    const json=decodeURIComponent(Array.prototype.map.call(bin,c=>"%"+("00"+c.charCodeAt(0).toString(16)).slice(-2)).join(""));
    return JSON.parse(json)||{};
  }catch(e){return {};}
}
/* ---------- 最近登录手机号（2026-10-23） ----------
   平台会话对象与 JWT 载荷都不含手机号：验证码登录后短时间内能靠
   sessionStorage 里的 OTP 凭证对上号，但凭证 10 分钟过期、账号密码登录
   更是从头到尾没有 phone 凭证。结果：密码登录的用户进「账号与安全」
   设密码/改用户名时报「没取到手机号」。登录成功那一刻手机号是明确
   已知的，把它记在本机 localStorage，作为 sessionPhone 的最后兜底；
   退出登录时清除。 */
const PHONE_KEY="yrb_login_phone_v1";
function rememberPhone(p){
  try{
    const d=String(p||"").replace(/\D/g,"");
    if(d.length>=11)localStorage.setItem(PHONE_KEY,d.slice(-11));
  }catch(e){}
}
function rememberedPhone(){
  try{ return String(localStorage.getItem(PHONE_KEY)||""); }catch(e){ return ""; }
}
function forgotPhone(){ try{ localStorage.removeItem(PHONE_KEY); }catch(e){} }

function sessionPhone(){
  const u=(session&&session.user)||{},raw=u.raw||{},claims=session?jwtPayload(session.accessToken):{};
  const cands=[
    u.phone,u.phone_number,raw.phone_number,raw.phone,claims.phone_number,claims.phone,
    (/^1\d{10}$/.test(String(u.name||"").trim())?u.name:""),
    (/^1\d{10}$/.test(String(raw.name||"").trim())?raw.name:""),
    rememberedPhone()          /* 最后兜底：本机最近一次登录成功的手机号 */
  ];
  for(const c of cands){
    const d=String(c||"").replace(/\D/g,"");
    if(d.length>=11)return d.slice(-11);
  }
  return "";
}
function myName(){
  /* 用户自定义昵称优先（profile.js 写入，发布求助 / 帮忙留言的作者名统一用它） */
  try{
    const p=JSON.parse(localStorage.getItem("yrb_profile_v1")||"{}");
    const n=String((p&&p.nick)||"").trim();
    if(n)return n;
  }catch(e){}
  if(!session)return "阳阳爸爸";
  const d=sessionPhone();
  if(d.length>=4)return "家长"+d.slice(-4);
  return "家长"+String((session.user&&session.user.id)||"").slice(-4);
}
function relTime(iso){
  const t=new Date(iso).getTime();if(!t)return "刚刚";
  const d=Math.max(0,(Date.now()-t)/1000);
  if(d<60)return "刚刚";
  if(d<3600)return Math.floor(d/60)+"分钟前";
  if(d<86400)return Math.floor(d/3600)+"小时前";
  if(d<604800)return Math.floor(d/86400)+"天前";
  try{return new Date(t).toLocaleDateString("zh-CN");}catch(e){return "已发布";}
}
function errMsg(err){
  if(!err)return "操作失败，请重试";
  /* 平台隔离/维护：先判这里，避免把 503 说成「网络不稳定」误导用户反复重试 */
  if(isIsolated(err))return "系统正在维护，暂时无法操作，请过一会儿再试（你的内容不会丢失）";
  const code=err.code||err.status;
  /* 会话/令牌类错误（invalid_grant / unauthenticated）→ 明确引导重新获取验证码，
     不再裸露英文原文（如 "the session is invalid, expired or issued for another client"） */
  if(code==="invalid_grant"||err.kind==="unauthenticated")
    return "登录会话已失效，请点「重新获取」验证码后再试一次";
  if(code==="42501"||code===401||code===403)return "没有权限操作（请重新登录）";
  if(code==="42P01")return "云端数据表尚未就绪";
  if(code==="23505")return "内容已存在";
  const raw=err.message||err.error_description||err.error||"";
  if(/timeout|超时/i.test(raw))return raw;
  if(/session is invalid|another client|invalid_grant/i.test(raw))
    return "验证会话已失效，请点「重新获取」验证码后再试一次";
  /* 短信发送频率限制（服务端仍可能按 60 秒限流）：给出可照做的中文提示 */
  if(/frequen|too many|rate.?limit|频繁|稍后再试/i.test(raw))
    return "发送太频繁了，请等 1 分钟后再点「重新获取」";
  /* 其余服务端英文报错对老年用户不友好，收敛为通用提示 */
  if(/^[\x00-\x7F]+$/.test(raw)&&raw.length>60)return "网络开小差了，请稍后重试";
  return raw||"网络异常，请稍后重试";
}
/* 会话/令牌类失败（可自动重试一次：偶发的链路抖动会误伤令牌交换） */
function isSessionErr(e){
  if(!e)return false;
  return e.code==="invalid_grant"||e.kind==="unauthenticated"
    ||/session is invalid|another client|invalid_grant/i.test(e.message||"");
}
/* 云端数据库资源被隔离/服务维护（平台侧 503 DATABASE_RESOURCE_ISOLATED：
   欠费或 PG 实例到期时整库不可用）。这不是用户网络问题，界面必须给准确说法，
   并自动轮询等待恢复，不引导用户反复点重试。 */
function isIsolated(e){
  if(!e)return false;
  const s=[e.code,e.status,e.kind,e.message,e.error,e.error_description]
    .filter(x=>x!==undefined&&x!==null).join(" ");
  if(/DATABASE_RESOURCE_ISOLATED|resource is isolated|database.{0,12}isolat/i.test(s))return true;
  const n=Number(e.status||e.code);
  return n===503;
}
/* 云端维护横幅：仅 isolated 态出现，恢复后自动移除（避免访客以为网站坏了） */
function paintMaint(on){
  try{
    const app=document.getElementById("app");if(!app)return;
    let el=document.getElementById("maintBar");
    if(!on){if(el&&el.parentNode)el.parentNode.removeChild(el);return;}
    if(el)return;
    el=document.createElement("div");
    el.id="maintBar";el.setAttribute("role","status");
    el.textContent="🛠 系统维护中：内容暂时看不到，已自动检测恢复，帖子不会丢失";
    el.style.cssText="background:#FFF4E5;color:#8A5300;font-size:13.5px;line-height:1.55;"
      +"padding:9px 14px;text-align:center;font-weight:700;border-bottom:1px solid #FFE0B2";
    const pages=document.getElementById("pages");
    if(pages&&pages.parentNode===app)app.insertBefore(el,pages);else app.appendChild(el);
  }catch(e){}
}
/* ---------- 超时保护 ----------
   个别网络环境（地铁、弱信号、运营商劫持）下请求已发出但回执收不到，
   界面会一直停在“上传中”。这里给所有云端调用加上限期，超时即当失败处理，
   并由发布流程去做“是否其实已成功”的确认，既不会卡死界面，也不会重复发布。 */
function withTimeout(promise,ms,label){
  return new Promise((resolve,reject)=>{
    let settled=false;
    const timer=setTimeout(()=>{
      if(settled)return;settled=true;
      reject(new Error((label||"网络请求")+"超时（网络较慢），请检查网络后重试"));
    },ms);
    Promise.resolve(promise).then(v=>{
      if(settled)return;settled=true;clearTimeout(timer);resolve(v);
    },e=>{
      if(settled)return;settled=true;clearTimeout(timer);reject(e);
    });
  });
}
function flagOf(){
  /* S 是全局词法绑定（非 window 属性），需用 typeof 安全读取 */
  try{return (typeof S!=="undefined"&&S&&S.region&&S.region.flag)||"";}catch(e){return "";}
}
function mimeOf(kind,ext){
  if(kind==="image")return ext==="png"?"image/png":ext==="webp"?"image/webp":"image/jpeg";
  if(kind==="video"){
    if(ext==="mp4")return "video/mp4";
    if(ext==="mov")return "video/quicktime";
    if(ext==="3gp")return "video/3gpp";
    return "video/webm";
  }
  if(ext==="mp3")return "audio/mpeg";
  if(ext==="m4a")return "audio/mp4";
  if(ext==="wav")return "audio/wav";
  if(ext==="ogg")return "audio/ogg";
  return "audio/webm";
}
function guessExt(type,kind){
  const t=String(type||"").toLowerCase();
  if(/jpeg|jpg/.test(t))return "jpg";
  if(/png/.test(t))return "png";
  if(/webp/.test(t))return "webp";
  if(/webm/.test(t))return "webm";
  if(/quicktime|mov/.test(t))return kind==="video"?"mov":"m4a";
  if(/3gpp/.test(t))return kind==="video"?"3gp":kind==="voice"?"m4a":"3gp";
  if(/mp4/.test(t))return kind==="voice"?"m4a":kind==="image"?"jpg":"mp4";
  if(/mpeg3|mp3/.test(t))return kind==="voice"?"mp3":"mp4";
  if(/m4a|mp4a|aac/.test(t))return kind==="voice"?"m4a":"mp4";
  if(/wav/.test(t))return kind==="voice"?"wav":"mp4";
  if(/ogg|opus/.test(t))return "ogg";
  return kind==="image"?"jpg":kind==="video"?"webm":"webm";
}

/* ---------- SDK 动态加载（全同源自托管） ----------
   2026-10-26 修复「网站打不开」：SDK 原先只走 jsdelivr/unpkg 国外 CDN，
   国内访问经常被重置（实测 jsdelivr SSL EOF），SDK 一挂整个云端功能全瘫。
   2026-10-29 彻底下线 CDN 兜底：SDK 文件随站点部署（assets/vendor/
   cloud-sdk.global.js，同源必达、SW 离线缓存），境外兜底只剩 IP/UA 出境
   与隐私合规负担（PIPL 39），在 vendor 文件缺失（=部署事故）时没有价值。
   版本仍锁定勿改回 @dev。 */
const SDK_URLS=["assets/vendor/cloud-sdk.global.js"];
function loadScript(src){
  return new Promise(res=>{
    const s=document.createElement("script");
    s.src=src;s.async=true;
    s.onload=()=>res(!!window.WorkBuddyCloud);
    s.onerror=()=>res(false);
    document.head.appendChild(s);
  });
}
async function loadSDK(){
  if(window.WorkBuddyCloud&&window.WorkBuddyCloud.createWorkBuddyCloud)return true;
  for(const u of SDK_URLS){
    try{if(await loadScript(u)&&window.WorkBuddyCloud)return true;}catch(e){}
  }
  return false;
}

/* ---------- 初始化 ---------- */
function initSDK(){
  try{
    if(!window.WorkBuddyCloud||typeof WorkBuddyCloud.createWorkBuddyCloud!=="function")return null;
    cloud=WorkBuddyCloud.createWorkBuddyCloud({
      endpoint:CFG.endpoint,
      oauthRelayBaseUrl:CFG.oauthRelayBaseUrl,
      publishableKey:CFG.publishableKey
    });
    return cloud;
  }catch(e){cloud=null;return null;}
}

/* ---------- 会话 ---------- */
async function refreshSession(){
  if(!cloud)return null;
  try{
    const r=await withTimeout(cloud.auth.getSession(),12000,"读取登录状态");
    session=(r&&!r.error&&r.data)?r.data:null;
  }catch(e){session=null;}
  return session;
}
function onAuthChanged(){
  renderAccount();
  if(session)loadCloudPosts();
  loadCases();                 /* 登录/退出都重拉：登录后才能拿到素材签名地址 */
  /* 广播登录状态变化：管理后台等增强层据此自动刷新，不再靠猜测关闭按钮的 id */
  try{window.dispatchEvent(new CustomEvent("yrb-auth",{detail:{signedIn:!!session,who:window.YRB_CLOUD&&YRB_CLOUD.who?YRB_CLOUD.who():null}}));}catch(e){}
}

/* ---------- 登录面板 ---------- */
function ensureShell(){
  if($("#loginSheet"))return;
  $("#phone").insertAdjacentHTML("beforeend",`
    <div id="loginMask"></div>
    <div id="loginSheet">
      <button class="lg-x" id="lgX" aria-label="关闭">✕</button>
      <div class="lg-title">登录育人帮</div>
      <div class="lg-sub">登录后即可<b>发布求助</b>、<b>帮忙回应</b>并上传照片 / 视频 / 语音<br>不登录也可以浏览大家的求助与帮忙</div>
      <!-- 两种登录方式：验证码（首次注册）/ 账号密码（老用户免等短信） -->
      <div class="lg-tabs" role="tablist">
        <button class="lg-tab on" id="lgTabPhone" type="button" role="tab" aria-selected="true">📱 验证码登录</button>
        <button class="lg-tab" id="lgTabPwd" type="button" role="tab" aria-selected="false">🔑 账号密码登录</button>
      </div>
      <div id="lgPanePhone">
        <div class="lg-label">手机号</div>
        <div class="lg-field"><span class="lg-pre">+86</span><input id="lgPhone" inputmode="numeric" maxlength="11" placeholder="请输入 11 位手机号" aria-label="手机号"></div>
        <div class="lg-err" id="lgPhoneErr"></div>
        <div class="lg-label">短信验证码</div>
        <div class="lg-field"><input id="lgCode" inputmode="numeric" maxlength="6" placeholder="6 位验证码" aria-label="验证码">
          <button class="lg-code-btn" id="lgSend" type="button">获取验证码</button></div>
        <!-- 首次注册才展开：设置登录用户名 + 密码，以后免验证码 -->
        <div class="lg-reg" id="lgReg" hidden>
          <div class="lg-reg-t">🎉 首次注册，设置好登录账号，下次可免验证码登录</div>
          <div class="lg-label">登录用户名</div>
          <div class="lg-field"><input id="lgUser" maxlength="20" placeholder="2-20 位，如：小明妈妈" aria-label="登录用户名"></div>
          <div class="lg-bad" id="lgUserErr"></div>
          <div class="lg-label">设置登录密码</div>
          <div class="lg-field"><input id="lgPwd" type="password" maxlength="32" placeholder="6-20 位，字母+数字更安全" aria-label="登录密码">
            <button class="lg-eye" id="lgPwdEye" type="button">显示</button></div>
          <div class="lg-reg-n">用户名可用中文、字母、数字；以后用「用户名 + 密码」或「手机号 + 密码」都能直接登录</div>
          <button class="lg-skip" id="lgSkipReg" type="button">这次先不设，直接用验证码登录</button>
        </div>
      </div>
      <div id="lgPanePwd">
        <div class="lg-label">登录账号</div>
        <div class="lg-field"><input id="lgAcct" maxlength="20" placeholder="用户名或 11 位手机号" aria-label="登录账号"></div>
        <div class="lg-label">登录密码</div>
        <div class="lg-field"><input id="lgPwd2" type="password" maxlength="32" placeholder="请输入登录密码" aria-label="登录密码">
          <button class="lg-eye" id="lgPwdEye2" type="button">显示</button></div>
        <div class="lg-pwdx"><a id="lgToSms">忘记密码？用验证码登录</a><a id="lgToReg">首次使用？去注册</a></div>
      </div>
      <!-- 明示同意（未勾选不下发验证码、不能登录） -->
      <div class="lg-agree" id="lgAgree">
        <button class="lg-ck" id="lgCk" type="button" role="checkbox" aria-checked="false" aria-label="同意育人帮用户协议与隐私政策"><i></i></button>
        <span>已阅读并同意<a class="lg-doc" data-doc="terms" href="javascript:;">《育人帮用户协议》</a>和<a class="lg-doc" data-doc="privacy" href="javascript:;">《隐私政策》</a></span>
      </div>
      <div class="lg-err" id="lgErr"></div>
      <div class="lg-hint" id="lgHint"></div>
      <button class="lg-btn" id="lgSubmit" type="button">登录 / 注册</button>
      <button class="lg-btn" id="lgPwdSubmit" type="button" style="display:none">登录</button>
      <div class="lg-or">或</div>
      <button class="lg-wx" id="lgWx" type="button">💬 微信一键登录</button>
      <div class="lg-note">未注册的手机号将自动创建账号<br>我们仅用手机号做登录验证，不向第三方出售个人信息</div>
    </div>
    <!-- 协议 / 隐私政策阅读层（登录面板内阅读，不打断登录流程） -->
    <div id="lgDoc" role="dialog" aria-label="协议正文">
      <div class="lg-doc-head">
        <button class="lg-doc-back" id="lgDocBack" type="button" aria-label="返回">‹</button>
        <b id="lgDocTitle">用户协议</b>
        <span class="lg-doc-tag" id="lgDocTag">育人帮</span>
      </div>
      <div class="lg-doc-body" id="lgDocBody"></div>
      <div class="lg-doc-foot"><button class="lg-doc-ok" id="lgDocOk" type="button">我已阅读，返回勾选</button></div>
    </div>
    <div id="upMask"><div class="up-card">
      <button class="up-x" id="upX" type="button" aria-label="关闭提示，后台继续上传">✕</button>
      <div class="up-ic">☁️</div><div class="up-t" id="upT">正在上传…</div>
      <div class="up-bar"><i id="upBar"></i></div><div class="up-s" id="upS">准备中</div>
      <div class="up-note">网络慢时可以先点右上角 ✕ 关闭提示，内容和照片都不会丢</div>
    </div></div>`);

  $("#lgPhone").addEventListener("input",()=>{$("#lgPhoneErr").textContent="";});
  $("#lgCode").addEventListener("input",()=>{$("#lgErr").textContent="";});
  /* 协议勾选：点一下切换，勾上后自动清掉红色提示 */
  $("#lgCk").addEventListener("click",()=>{
    const c=$("#lgCk"),on=c.classList.toggle("on");
    c.setAttribute("aria-checked",on?"true":"false");
    if(on){$("#lgErr").textContent="";$("#lgAgree").classList.remove("shake");}
  });
  $("#lgAgree").addEventListener("click",e=>{
    if(e.target.closest(".lg-doc")||e.target.closest("#lgCk"))return;
    $("#lgCk").click();
  });
  /* 点击《用户协议》/《隐私政策》→ 面板内阅读 */
  document.querySelectorAll("#loginSheet .lg-doc").forEach(a=>{
    a.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();openLgDoc(a.dataset.doc);});
  });
  $("#lgDocBack").addEventListener("click",closeLgDoc);
  $("#lgDocOk").addEventListener("click",()=>{
    const ro=lgDocReadOnly;
    closeLgDoc();
    if(ro)return;                       /* 设置页阅读模式：只关闭，不动同意勾选 */
    /* 用户读完协议点确认 → 自动帮其勾上，减少一步操作（仍为用户主动点击行为） */
    const c=$("#lgCk");if(c&&!c.classList.contains("on"))c.click();
  });
  $("#lgSend").addEventListener("click",sendPhoneCode);
  $("#lgSubmit").addEventListener("click",submitPhoneLogin);
  $("#lgPwdSubmit").addEventListener("click",submitPwdLogin);
  $("#lgWx").addEventListener("click",wechatLogin);
  /* 两种登录方式切换 */
  $("#lgTabPhone").addEventListener("click",()=>switchLoginMode("phone"));
  $("#lgTabPwd").addEventListener("click",()=>switchLoginMode("pwd"));
  $("#lgToSms").addEventListener("click",()=>switchLoginMode("phone"));
  $("#lgToReg").addEventListener("click",()=>switchLoginMode("phone"));
  /* 密码明文切换 */
  [["lgPwdEye","lgPwd"],["lgPwdEye2","lgPwd2"]].forEach(([b,i])=>{
    const btn=$( "#"+b),inp=$("#"+i);
    if(btn&&inp)btn.addEventListener("click",()=>{
      const show=inp.type==="password";
      inp.type=show?"text":"password";
      btn.textContent=show?"隐藏":"显示";
    });
  });
  $("#lgSkipReg").addEventListener("click",()=>{
    const r=$("#lgReg"); if(r){r.hidden=true;}
    const u=$("#lgUser"),p=$("#lgPwd"); if(u)u.value=""; if(p)p.value="";
    const t=$("#lgUserErr"); if(t)t.textContent="";
    if(window.toast)toast("可以先跳过，随时在「我的—账号与安全」里设置登录密码");
  });
  $("#lgUser").addEventListener("blur",checkUserName);
  $("#lgUser").addEventListener("input",()=>{const e=$("#lgUserErr");if(e)e.textContent="";});
  $("#lgAcct").addEventListener("input",()=>{$("#lgErr").textContent="";});
  $("#lgPwd2").addEventListener("input",()=>{$("#lgErr").textContent="";});
  $("#lgX").addEventListener("click",()=>closeLogin(false));
  $("#loginMask").addEventListener("click",()=>closeLogin(false));
  const ux=$("#upX");
  if(ux)ux.addEventListener("click",()=>{hideProgress();toast("已关闭提示，正在后台上传，稍后自动保存到云端");});
}
/* =========================================================
   登录方式切换 + 账号密码登录（2026-10-23）
   需求：首次注册用手机验证码 + 自定义用户名 + 密码；之后可用
   「用户名 + 密码」或「手机号 + 密码」直接登录，不必每次等短信。
   实现要点：
   - 平台鉴权只认手机号，所以用户名 → 手机号的映射放在云端函数
     yb_account_login（bcrypt 校验 + 5 次锁 5 分钟），校验通过才返回手机号；
   - 密码本身由 yb_account_save 同时写入平台鉴权表，保证 signInWithPassword 真能过。
   ========================================================= */
function waitCloud(ms){
  if(cloud&&cloud.database&&cloud.database.rpc)return Promise.resolve(cloud);
  return new Promise(res=>{
    let done=false;
    const fin=()=>{if(done)return;done=true;clearInterval(iv);res((cloud&&cloud.database&&cloud.database.rpc)?cloud:null);};
    window.addEventListener("yrb-cloud-ready",()=>setTimeout(fin,60),{once:true});
    const t0=Date.now();
    const iv=setInterval(()=>{
      if((cloud&&cloud.database&&cloud.database.rpc)||Date.now()-t0>ms)fin();
    },300);
  });
}
function accountRpc(fn,args){
  /* SDK 是异步加载的：不能一进来就判断 client 为空然后一走了之（历史踩坑） */
  return waitCloud(8000).then(c=>{
    if(!c)return {data:null,error:{message:"云服务未就绪，请检查网络后重试"}};
    return c.database.rpc(fn,args).then(r=>r||{data:null,error:null}).catch(e=>({data:null,error:e}));
  });
}
function switchLoginMode(mode){
  const pwd=mode==="pwd";
  const tp=$("#lgTabPhone"),tq=$("#lgTabPwd");
  if(tp){tp.classList.toggle("on",!pwd);tp.setAttribute("aria-selected",String(!pwd));}
  if(tq){tq.classList.toggle("on",pwd);tq.setAttribute("aria-selected",String(pwd));}
  const pp=$("#lgPanePhone"),pq=$("#lgPanePwd");
  if(pp)pp.style.display=pwd?"none":"";
  if(pq)pq.classList.toggle("on",pwd);
  const b1=$("#lgSubmit"),b2=$("#lgPwdSubmit");
  if(b1)b1.style.display=pwd?"none":"";
  if(b2)b2.style.display=pwd?"":"none";
  const e=$("#lgErr");if(e)e.textContent="";
  const h=$("#lgHint");if(h){h.style.display="none";h.textContent="";}
  setTimeout(()=>{
    const t=pwd?$("#lgAcct"):$("#lgPhone");
    if(t&&!t.value){
      if(pwd){const o=loadOtp();if(o)t.value=o.phone;}
      if(!t.value)t.focus();
    }
  },140);
}
function showReg(on){
  const r=$("#lgReg");if(!r)return;
  r.hidden=!on;
  if(!on)return;
  const h=$("#lgHint");
  if(h){h.textContent="首次注册：设置登录用户名和密码，以后可免验证码直接登录";h.style.display="block";}
}
function regNameOK(v){
  if(v.length<2)return "用户名至少 2 个字";
  if(v.length>20)return "用户名最多 20 个字";
  if(/\s/.test(v))return "用户名不能含空格";
  if(/[<>"'/\\]/.test(v))return "用户名不能含 < > \" ' / \\ 等符号";
  return "";
}
async function checkUserName(){
  const inp=$("#lgUser"),tip=$("#lgUserErr");
  if(!inp||!tip)return true;
  const v=inp.value.trim();
  if(!v){tip.textContent="";return false;}
  const bad=regNameOK(v);
  if(bad){tip.textContent=bad;return false;}
  /* 先本地放行，云端查重（最多等 2.5s：弱网时不卡住注册，服务端保存时还会再校验一次） */
  const r=await Promise.race([
    accountRpc("yb_account_avail",{p_username:v}),
    new Promise(res=>setTimeout(()=>res(null),2500))
  ]);
  const d=r&&r.data;
  if(d&&d.avail===false){tip.textContent="这个用户名已被使用，换一个试试";return false;}
  tip.textContent="";
  return true;
}
/* 保存登录账号：写 yb_accounts（用户名→手机号）＋ 平台密码（真正可密码登录） */
async function saveLoginAccount(uname,pwd,phone){
  const r=await accountRpc("yb_account_save",{p_username:uname,p_password:pwd,p_phone:phone});
  const d=r&&r.data;
  if(d&&d.ok===true)return {ok:true,data:d};
  const reason=(d&&d.reason)||"";
  const map={
    name_len:"用户名需 2-20 位",name_chars:"用户名含不支持的符号",
    name_taken:"这个用户名已被使用",phone_taken:"该手机号已绑定其他账号",
    pwd_len:"密码需 6-20 位",not_signed_in:"登录状态已失效，请重新登录",
    no_phone:"没取到手机号，请重新登录后再设置"
  };
  return {ok:false,msg:map[reason]||errMsg(r&&r.error)||"保存失败，请稍后重试"};
}
function pwdLoginError(done,left){
  const code=(done&&done.error&&done.error.code)||"";
  const raw=String((done&&done.error&&(done.error.message||done.error.error_description))||"");
  if(code==="password_not_set"||/password not set|密码未设置/i.test(raw))
    return "这个账号还没设置登录密码。请用「验证码登录」进来，然后在「我的—账号与安全」里点『设置登录密码』";
  if(code==="invalid_username_or_password"||/incorrect/i.test(raw))
    return left>0?("账号或密码不正确，还可以再试 "+left+" 次"):"账号或密码不正确。忘记密码可改用验证码登录";
  return errMsg(done&&done.error)||"登录失败，请稍后重试";
}
async function submitPwdLogin(){
  ensureShell();
  if(!cloud){$("#lgErr").textContent="云服务暂不可用，请稍后重试";return;}
  if(!agreeOK()){needAgree();return;}
  const id=($("#lgAcct").value||"").trim(),pwd=$("#lgPwd2").value||"";
  if(!id){$("#lgErr").textContent="请输入用户名或手机号";return;}
  if(!pwd){$("#lgErr").textContent="请输入登录密码";return;}
  const btn=$("#lgPwdSubmit"),errE=$("#lgErr");
  btn.disabled=true;btn.textContent="登录中…";errE.textContent="";
  try{
    let phone="",left=0;
    if(/^\d{11}$/.test(id)){
      phone=id;
    }else{
      /* 用户名 → 手机号：云端 bcrypt 校验通过才返回，避免手机号外泄 */
      const r=await withTimeout(accountRpc("yb_account_login",{p_username:id,p_password:pwd}),20000,"查询账号");
      const d=r&&r.data;
      if(!d||d.ok!==true){
        const reason=(d&&d.reason)||"";
        if(reason==="no_user")errE.textContent="没有找到这个用户名，请检查拼写，或改用手机号登录";
        else if(reason==="bad_pwd"){
          left=Number(d.left||0);
          errE.textContent=left>0?("用户名或密码不正确，还可以再试 "+left+" 次"):"用户名或密码不正确，请稍后重试";
        }
        else if(reason==="locked")errE.textContent="密码错误次数过多，请 "+Math.max(1,Math.ceil(Number(d.seconds||300)/60))+" 分钟后再试，或用验证码登录";
        else if(reason==="empty")errE.textContent="请输入用户名和密码";
        else errE.textContent=errMsg(r&&r.error)||"登录失败，请稍后重试";
        return;
      }
      phone=String(d.phone||"");
    }
    if(!/^1\d{10}$/.test(phone)){errE.textContent="账号信息不完整，请改用验证码登录";return;}
    const done=await withTimeout(cloud.auth.signInWithPassword({phone,password:pwd}),20000,"登录");
    if(!done||done.error){errE.textContent=pwdLoginError(done,left);return;}
    rememberPhone(phone);          /* 密码登录的会话里没有手机号，记下来供设密码等操作用 */
    await refreshSession();
    if($("#lgPwd2"))$("#lgPwd2").value="";
    closeLogin(true);
    onAuthChanged();
    if(window.toast)toast("登录成功，欢迎回来 👋");
  }catch(e){
    errE.textContent=errMsg(e);
  }finally{
    btn.disabled=false;btn.textContent="登录";
  }
}
/* 登录后温和提醒（每个会话一次）：还没设密码就提示去设，不打断操作 */
async function remindSetPwd(){
  if(!session)return;
  try{
    if(sessionStorage.getItem("yrb_pwd_reminded")==="1")return;
    const r=await accountRpc("yb_account_me",{});
    const d=r&&r.data;
    if(!d||d.ok!==true)return;
    sessionStorage.setItem("yrb_pwd_reminded","1");
    if(d.has_pwd)return;
    if(window.toast)toast("小提示：到「我的—账号与安全」设置登录密码，下次免验证码登录 🔑");
  }catch(e){}
}
/* 用平台自己的验证码重置接口设置/修改密码（2026-10-23）
   为什么必须走这条：平台密码是它自己的加密格式，外部直接写库无效
   （实测 $2a$ bcrypt 被拒），所以统一「发验证码 → 校验 → 重置密码」。
   返回 {ok, msg, token?} */
async function platformSetPwd(phone,verificationId,code,newPwd){
  const ep=String(CFG.endpoint||"").replace(/\/+$/,"");
  const H={"content-type":"application/json","x-wb-webapp-access-key":CFG.publishableKey};
  try{
    const r1=await withTimeout(fetch(ep+"/.cloud/auth/v1/verification/verify",{
      method:"POST",headers:H,
      body:JSON.stringify({verification_id:verificationId,verification_code:String(code)})
    }),20000,"校验验证码");
    const j1=await r1.json().catch(()=>({}));
    const vt=j1&&j1.verification_token;
    if(!vt){
      const m=String((j1&&(j1.error_description||j1.error||j1.message))||"");
      return {ok:false,msg:/expire|invalid|not found/i.test(m)?"验证码不正确或已过期，请重新获取":"验证码校验失败，请重新获取"};
    }
    const r2=await withTimeout(fetch(ep+"/.cloud/auth/v1/reset",{
      method:"POST",headers:H,
      body:JSON.stringify({phone_number:"+86 "+phone,new_password:newPwd,verification_token:vt})
    }),20000,"设置密码");
    const j2=await r2.json().catch(()=>({}));
    if(!r2.ok){
      const m=String((j2&&(j2.error_description||j2.error||j2.message))||"");
      return {ok:false,msg:m||"设置密码失败，请稍后重试"};
    }
    return {ok:true,token:vt};
  }catch(e){
    return {ok:false,msg:"网络不稳定，设置密码没成功，请稍后重试"};
  }
}
/* 设密码专用的验证码（2026-10-25）：
   平台要求 reset 的令牌必须来自 usage:"PASSWORD_RESET" 的验证申请，
   复用「登录用途」的验证码会在最后一步被拒（这就是普通用户设不了密码的根因） */
async function platformSendResetOtp(phone){
  const ep=String(CFG.endpoint||"").replace(/\/+$/,"");
  const H={"content-type":"application/json","x-wb-webapp-access-key":CFG.publishableKey};
  try{
    const r=await withTimeout(fetch(ep+"/.cloud/auth/v1/verification",{
      method:"POST",headers:H,
      body:JSON.stringify({phone_number:"+86 "+phone,usage:"PASSWORD_RESET",target:"USER"})
    }),20000,"发送验证码");
    const j=await r.json().catch(()=>({}));
    const vid=j&&j.verification_id;
    if(!vid){
      const m=String((j&&(j.error_description||j.error||j.message))||"");
      return {ok:false,msg:/账号不存在|not_found/i.test(m)?"这个手机号还没有注册过育人帮":/rate|频|limit/i.test(m)?"验证码发送太频繁，请等 1 分钟再试":"验证码没发出去，请稍后重试"};
    }
    return {ok:true,verificationId:vid};
  }catch(e){
    return {ok:false,msg:"网络不稳定，验证码没发出去，请稍后重试"};
  }
}
function openLogin(){
  ensureShell();
  $("#loginSheet").classList.add("open");
  $("#loginMask").classList.add("open");
  switchLoginMode("phone");
  /* 刷新过页面但验证码还在有效期内：回填手机号并提示直接输入，不用重新发 */
  const otp=loadOtp();
  const hint=$("#lgHint"), ph=$("#lgPhone");
  if(otp&&ph&&!ph.value){ph.value=otp.phone;}
  if(hint){
    if(otp){
      const left=Math.max(1,Math.round((OTP_TTL-(Date.now()-(otp.ts||Date.now())))/60000));
      hint.textContent="验证码已发送到 "+otp.phone.slice(0,3)+"****"+otp.phone.slice(-4)+"，直接输入收到的验证码即可（约 "+left+" 分钟内有效）";
      hint.style.display="block";
    }else{ hint.style.display="none"; hint.textContent=""; }
  }
}
function closeLogin(ok){
  const sh=$("#loginSheet");if(sh)sh.classList.remove("open");
  const mk=$("#loginMask");if(mk)mk.classList.remove("open");
  closeLgDoc();
  if(loginResolve){const r=loginResolve;loginResolve=null;r(!!ok);}
}

/* ---------- 用户协议 / 隐私政策 ---------- */
const LG_DOCS={
  terms:{t:"育人帮用户协议",tag:"v1.0",html:`
    <p class="d-h">一、协议范围</p><p>本协议是你与「育人帮」之间就使用本平台服务所订立的约定。育人帮是一个面向家长、监护人及关心下一代的爱心人士的互助社区，倡导善意互助、科学育儿。你在注册或使用前应完整阅读并同意本协议。</p>
    <p class="d-h">二、账号注册与安全</p><p>1. 本平台使用手机号验证码或微信授权登录，未注册的手机号首次登录将自动创建账号。<br>2. 你应保证注册所用手机号为你本人所有，并妥善保管账号，因账号外借、泄露造成的损失由你自行承担。<br>3. 一个手机号对应一个账号，账号不得买卖、出租或转让。</p>
    <p class="d-h">三、用户行为规范</p><p>你承诺不发布、不传播含有下列内容的信息：<br>1. 违反宪法和法律、危害国家安全、破坏社会稳定的内容；<br>2. 涉及未成年人的色情、暴力、虐待、拐卖、隐私泄露等内容；<br>3. 侮辱、诽谤、恐吓他人或侵犯他人隐私、名誉、肖像、知识产权的信息；<br>4. 虚假求助、骗捐、引流诈骗、广告营销、招募代理等内容；<br>5. 其他违反法律法规、公序良俗或平台规则的内容。</p>
    <p class="d-h">四、内容发布与审核</p><p>1. 求助内容支持文字、图片、微视频（建议 ≤30 秒）与语音；帮忙回应支持文字、语音与微视频。<br>2. 平台对发布内容进行安全审核，并对明显的隐私信息（如定位原图、身份证号、门牌号）进行提示与遮蔽。<br>3. 违规内容平台有权不予展示、下架、限制功能或封禁账号，并保留向主管部门报告的权利。<br>4. 你在本平台发布的内容，你仍享有著作权；你授权平台在本服务范围内进行展示、存储与必要的技术处理。</p>
    <p class="d-h">五、未成年人保护</p><p>1. 平台遵循《未成年人保护法》及《未成年人网络保护条例》，严禁任何形式的未成年人权益侵害。<br>2. 涉及未成年人的求助，平台会加强审核，并优先提示官方专业救助渠道（110 / 120 / 12355）。<br>3. 不满 14 周岁的未成年人不得自行注册使用本平台，应由监护人代为操作并全程陪同。<br>4. 请勿在图片、视频、语音中公开孩子的真实姓名、学校、班级、门牌号等可识别信息。</p>
    <p class="d-h">六、互助与积分规则</p><p>1. 「赠人玫瑰，手留余香」：每次真实帮忙经确认后可获得积分与玫瑰感谢，并累积职级成长。<br>2. 积分与玫瑰为平台内的鼓励机制，不具有货币属性，不可提现、交易或转让。<br>3. 通过刷量、抄袭、造假等不正当方式获取的积分，平台有权收回并扣减职级。</p>
    <p class="d-h">七、服务变更与终止</p><p>1. 平台可能根据运营需要调整功能、暂停或终止部分服务，重大变更将提前公告。<br>2. 当前版本尚未开放自助注销入口，你可通过「我的—设置—反馈与帮助」提交注销请求，我们核实身份后按隐私政策处理或删除相关数据；自助注销随云服务恢复版本上线。</p>
    <p class="d-h">八、免责声明</p><p>1. 本社区的内容由用户自行发布，平台不保证其真实性与准确性，请自行辨别、谨慎决断。<br>2. 社区互助不能代替医疗、心理、法律等专业救助。遇到紧急情况，请第一时间拨打 110 / 120 或联系专业机构。<br>3. 因网络故障、不可抗力等导致服务中断，平台不承担赔偿责任，但会尽力恢复。</p>
    <p class="d-h">九、协议更新与法律适用</p><p>1. 本协议更新后将在平台内公示，继续使用即视为接受更新后的协议。<br>2. 本协议适用中华人民共和国法律。争议先行协商，协商不成可向平台运营方所在地人民法院提起诉讼。</p>
    <p class="d-h">十、联系我们</p><p>如有疑问或投诉，可通过「我的—设置—反馈与帮助」提交，我们将在 15 个工作日内回复。</p>
    <p class="d-note">本协议随功能与法规变化更新，更新后在站内公示。</p>`},
  privacy:{t:"育人帮隐私政策",tag:"v2.0",html:`
    <p class="d-h">引言</p><p>育人帮（以下称「本平台」）是面向家长、监护人及关心下一代的爱心人士的互助社区。本政策说明我们<b>收集什么、为什么收集、存在哪里、保存多久、你如何控制</b>。我们遵循《个人信息保护法》《网络安全法》《数据安全法》《未成年人保护法》《未成年人网络保护条例》《儿童个人信息网络保护规定》，坚持最小必要、目的明确、公开透明、安全可控。</p>
    <p><b>特别提示</b>：本平台内容常涉及未成年人。请勿发布孩子的真实姓名、学校、班级、门牌号、身份证号、正面清晰照片等可识别信息。不满 14 周岁儿童的个人信息按敏感个人信息处理，见第七节。</p>
    <p class="d-h">一、个人信息处理者</p><p>运营主体：待补充（须与备案主体一致，备案完成后在本页与站内页脚公示）。<br>联系方式：站内「我的—设置—反馈与帮助」为当前唯一有效渠道，我们承诺 15 个工作日内答复。<br>个人信息保护负责人：待补充（确定前由运营者经上述渠道直接受理你的请求）。<br>网站备案号：办理中，取得后公示于页脚。</p>
    <p class="d-h">二、我们收集哪些信息</p><p>1. <b>手机号</b>：注册、登录与找回账号，是账号唯一标识，不提供则无法登录。<br>2. <b>短信验证码</b>：验证手机号归你本人所有。<br>3. <b>昵称与头像效果</b>（小动物 / 马赛克 / 变形）：社区展示与隐私保护，可不填。<br>4. <b>你主动发布的内容</b>：求助与帮忙的文字、图片、语音、微视频（建议 ≤30 秒），以及上传的 PPT / 文档（仅保存转换后的页图与缩略图）。<br>5. <b>设备与日志信息</b>：浏览器类型、系统版本、页面错误堆栈，用于兼容性修复与安全防护，<b>不含你发布的内容</b>。<br>6. <b>访问日志</b>：IP、访问时间、浏览器标识，由托管与边缘加速服务产生，用于安全审计与法定留存。<br>7. <b>举报记录</b>：你主动举报时记录被举报内容与理由，用于内容治理与未成年人保护。</p>
    <p><b>我们不收集</b>：通讯录、短信内容、相册全量、精确定位与行踪轨迹、生物识别（人脸 / 指纹）、身份证号、银行卡。<b>我们不接入</b>广告、统计、用户画像类第三方 SDK。</p>
    <p class="d-h">三、我们如何使用这些信息</p><p>用于注册登录与账号安全、展示与存储你发布的内容、内容安全审核（拦截违法违规与侵害未成年人的信息）、计算帮忙积分与玫瑰职级、处理投诉举报与你的权利请求、安全防护与故障排查。以上均属履行合同或法定义务所必需。<b>不用于</b>个性化广告、出售、向无关第三方提供或自动化决策画像。</p>
    <p class="d-h">四、敏感个人信息与单独同意</p><p>1. 不满 14 周岁儿童的个人信息：发布涉及儿童的内容前，我们提示并要求你确认已取得监护人同意，并逐步留存确认记录（条款版本、确认时间、账号标识）。<br>2. 语音、视频中可能含可识别的生物特征：发布前提示「请确认已获得出镜人及其监护人同意」。<br>3. 你拒绝单独同意时，仅该功能不可用，其它功能不受影响。</p>
    <p class="d-h">五、共享、委托处理与第三方</p><p>我们<b>不出售</b>你的个人信息，仅在下列必要情形共享，并要求对方按同等标准保护：<br>1. <b>云服务托管方</b>（受托处理）：存储账号、发布内容与媒体文件；<br>2. <b>短信服务商</b>（受托处理）：仅提供手机号，用于下发登录验证码；<br>3. <b>边缘加速 / CDN</b>（受托处理）：获得 IP、浏览器标识与请求路径，用于内容分发与安全防护；<br>4. <b>微信开放平台</b>：仅在开通微信登录后，用于授权登录；<br>5. <b>监管机关</b>：依法要求时提供。</p>
    <p>本平台前端会加载云服务 SDK（用于访问数据库与文件）。该 SDK 随本站同源自托管（由你的浏览器直接向本站获取，带离线缓存），<b>不会向任何第三方 CDN 或统计服务发起请求</b>。相关第三方名称与隐私政策链接在备案主体确定后一并公示。</p>
    <p class="d-h">六、存储地点与跨境传输</p><p>静态资源经 <b>Cloudflare 全球边缘节点</b>分发，节点可能位于境外；数据库与文件存储的具体机房位置以云服务商公示为准，我们正在确认，确认后在本节如实更新。<br>若确认涉及向境外提供个人信息，我们将依据《个人信息保护法》第 38 条采取安全评估、标准合同或认证等路径，并按第 39 条告知境外接收方名称、联系方式、处理目的与方式，另行取得你的单独同意。</p>
    <p>我们不会为了「看起来合规」把这一节写成「全部境内」——事实是什么就写什么，写错属虚假告知。</p>
    <p class="d-h">七、未成年人（含不满 14 周岁儿童）信息保护</p><p>1. 不满 14 周岁儿童的个人信息属敏感个人信息，处理前须取得监护人单独同意；本平台不面向儿童独立提供服务，须由监护人代为操作并全程陪同。<br>2. 涉及儿童的内容默认不进入搜索引擎索引，不在公开列表页展示可识别信息。<br>3. 监护人可要求查阅、更正、删除儿童信息，我们在 <b>72 小时</b>内响应（严于一般情形）。<br>4. 具体规则见「我的—设置—隐私与个人信息—儿童个人信息处理规则」。</p>
    <p class="d-h">八、保存期限</p><p>账号信息：账号存续期间。<br>你发布的内容：存续期间，或你删除时。<br>举报与处置记录：3 年（内容治理留痕需要）。<br>访问日志：不少于 6 个月（网络安全法要求）。<br>注销后的数据：<b>15 个工作日内</b>删除或匿名化（法定留存除外）。<br>本地缓存：至你清除浏览器数据或退出登录。</p>
    <p class="d-h">九、我们如何保护信息</p><p>全站 HTTPS + HSTS；数据库行级权限（RLS）按账号隔离；管理层另有独立密码（bcrypt）；媒体不提供公开直链，一律限时签名地址（1 小时失效）；手机号一律脱敏展示；内容保护层禁止下载与另存；CSP 限制脚本来源；代码库不保存任何密钥。<br>任何技术手段都不能保证百分之百安全，若发生泄露，我们按第十一节处理。</p>
    <p class="d-h">十、你的权利</p><p><b>查阅、复制</b>：在「我的」中查看内容与资料；结构化导出（JSON）将随自助功能上线。<br><b>更正</b>：直接编辑发布内容与个人资料，即时生效。<br><b>删除</b>：自己发布的案例可随时删除（即时生效）；求助、帮忙内容与账号数据的删除请经反馈渠道申请，15 个工作日内处理。<br><b>撤回同意</b>：在系统设置中关闭相机、麦克风权限，即时生效。<br><b>注销账号</b>：当前版本尚未开放自助注销入口（该功能随云服务恢复版本上线）。过渡期内请通过「我的—设置—反馈与帮助」提交，我们核实身份后人工处理。<br><b>转移（可携带）</b>：同上渠道申请，15 个工作日内答复。<br><b>解释说明</b>：对处理规则有疑问，可通过下方渠道询问。</p>
    <p>过渡期说明：自助注销与数据导出正在开发，落地时间以站内公告为准。我们不把「即将上线」写成「已经可用」。</p>
    <p class="d-h">十一、安全事件通知</p><p>发生或可能发生个人信息泄露、篡改、丢失时：立即采取补救措施并评估影响；按法定要求向监管部门报告（含事件情况、可能影响、已采取措施与你可自主防范的建议）；以站内公告结合短信或电话等可达方式告知受影响的你（涉及儿童信息时同时告知监护人）；处置过程留痕备查并事后复盘、修订本政策。</p>
    <p class="d-h">十二、Cookie 与本地存储</p><p>我们仅使用必要的本地存储，不用于追踪或广告：登录会话（由云服务 SDK 写入，随令牌有效期）；<b>yrb_profile_v1</b>（昵称、头像效果、浏览历史等偏好）；<b>yrb_chips_v1</b>（首页栏目排序）；<b>yrb_license_v1</b>（已阅读的须知标记）；<b>yrb_jj_qr</b>（分享二维码缓存）；验证码临时态（sessionStorage，关闭页面即失效）。<br>你可以通过浏览器「清除网站数据」删除以上记录（会同时退出登录）。</p>
    <p class="d-h">十三、本政策的更新</p><p>处理目的、信息类型、共享对象、跨境传输或你的权利发生重大变更时，我们会弹窗重新征得同意，不以「继续使用即同意」替代。历史版本在站内可查，保留最近 3 个版本及生效日期。</p>
    <p class="d-h">十四、联系我们与投诉</p><p>平台内：「我的—设置—反馈与帮助」。<br>我们承诺 15 个工作日内答复。<br>若你对答复不满意，可向网信部门（12377）、市场监管部门（12315）或电信主管部门投诉举报。</p>
    <p class="d-note">版本 v2.0（替代 v1.0）· 生效日期于备案完成后公示。本版补齐了处理者信息、第三方清单、敏感信息单独同意、跨境说明、事件通知与权利时限；运营主体名称、联系方式与备案号等尚未确定的事实项一律标注「待补充」，不虚构。</p>`},
  child:{t:"儿童个人信息处理规则",tag:"v1.0",html:`
    <p class="d-h">一、适用范围</p><p>本规则适用于不满 14 周岁儿童的个人信息处理。本平台不面向儿童独立提供服务，须由监护人代为注册、代为操作并全程陪同。</p>
    <p class="d-h">二、我们如何取得监护人同意</p><p>1. 发布涉及儿童的内容前，页面提示「请确认你已取得该儿童监护人的同意」，由发布者（应为监护人）主动确认。<br>2. 我们留存确认记录：条款版本、确认时间、账号标识；<b>不记录儿童身份信息本身</b>。<br>3. 若发现在未取得监护人同意的情况下收集了儿童个人信息，我们将立即停止处理并删除。</p>
    <p class="d-h">三、我们如何处理儿童信息</p><p>1. 仅处理实现互助所必需的内容（文字、图片、语音、微视频）。<br>2. 涉及儿童的内容默认不进入搜索引擎索引，不在公开列表页展示可识别信息。<br>3. 不出售、不用于广告或用户画像，不向无关第三方提供。</p>
    <p class="d-h">四、监护人的权利</p><p>监护人可随时要求查阅、更正、删除儿童个人信息，或撤回同意。<br>响应时限：<b>72 小时</b>内首次响应（严于一般情形的 15 个工作日）。<br>渠道：「我的—设置—反馈与帮助」。</p>
    <p class="d-h">五、发布前的自我检查</p><p>不出现孩子真实姓名、学校、班级、门牌号、身份证号；不出现可定位的校服校徽与小区门牌；不出现正面清晰照片（可用贴纸遮挡）；语音中不透露上述信息。</p>
    <p class="d-h">六、违规处理</p><p>发现涉及儿童的不良信息，我们立即下架，并按《安全事件应急预案》评估是否属于重大事件；涉嫌违法犯罪的，向公安机关报告。</p>
    <p class="d-note">本规则与《隐私政策》第七节配套适用；两者不一致时，以对儿童更有利的条款为准。</p>`}
};
/* opts.readOnly：设置页阅读模式——底部按钮叫「关闭」，且不代勾登录页的同意框
   （同意必须由用户在登录面板里自己点，不能因为读了政策就替他勾上） */
let lgDocReadOnly=false;
function openLgDoc(k,opts){
  const d=LG_DOCS[k]||LG_DOCS.terms;
  const t=$("#lgDocTitle"),tag=$("#lgDocTag"),b=$("#lgDocBody"),p=$("#lgDoc");
  if(!p)return;
  lgDocReadOnly=!!(opts&&opts.readOnly);
  const ok=$("#lgDocOk");if(ok)ok.textContent=lgDocReadOnly?"关闭":"我已阅读，返回勾选";
  if(t)t.textContent=d.t;if(tag)tag.textContent=d.tag;if(b){b.innerHTML=d.html;b.scrollTop=0;}
  p.classList.add("open");
}
function closeLgDoc(){const p=$("#lgDoc");if(p)p.classList.remove("open");}

/* 明示同意校验：未勾选不下发验证码、不登录 */
function agreeOK(){const c=$("#lgCk");return !!(c&&c.classList.contains("on"));}
function needAgree(){
  const row=$("#lgAgree");
  const e=$("#lgErr");if(e)e.textContent="请先阅读并勾选同意《育人帮用户协议》和《隐私政策》";
  if(row){row.classList.remove("shake");void row.offsetWidth;row.classList.add("shake");}
  if(window.toast)toast("请先勾选同意《育人帮用户协议》和《隐私政策》");
  return false;
}
function ensureLogin(){
  if(session)return Promise.resolve(true);
  if(!cloud)return Promise.resolve(false);
  openLogin();
  return new Promise(res=>{loginResolve=res;});
}

/* 获取验证码（发送与校验分离，符合 SDK 契约） */
async function sendPhoneCode(){
  ensureShell();
  if(!cloud){$("#lgErr").textContent="云服务暂不可用，请稍后重试";return;}
  if(!agreeOK()){needAgree();return;}
  const phone=$("#lgPhone").value.trim();
  if(!/^1\d{10}$/.test(phone)){$("#lgPhoneErr").textContent="请输入正确的 11 位手机号";return;}
  const btn=$("#lgSend");
  btn.disabled=true;$("#lgErr").textContent="";
  try{
    const sent=await withTimeout(cloud.auth.sendOtp({phone}),20000,"发送验证码");
    if(!sent||sent.error){
      $("#lgErr").textContent=errMsg(sent&&sent.error);
      btn.disabled=false;return;
    }
    /* 保存本次挑战，提交时复用，不再重复发送（同时落 sessionStorage，刷新不丢） */
    const resent=!!pendingOtp&&pendingOtp.phone===phone;
    saveOtp({phone,verificationId:sent.data.verificationId,isExistingUser:sent.data.isExistingUser});
    /* 首次注册（isExistingUser=false）才展开「设置用户名 + 密码」 */
    const firstUser=sent.data&&sent.data.isExistingUser===false;
    showReg(firstUser);
    const h=$("#lgHint");
    if(h&&!firstUser){h.textContent="验证码已发送到 "+phone.slice(0,3)+"****"+phone.slice(-4)+"，请把收到的验证码填在上面";h.style.display="block";}
    if(firstUser)setTimeout(()=>{const u=$("#lgUser");if(u&&!u.value)u.focus();},160);
    if(resent){$("#lgCode").value="";$("#lgPhoneErr").textContent="";}
    /* 2026-10-19 用户要求：重发等待从 60 秒缩短到 20 秒（短信验证码本身 5 分钟内有效） */
    let left=20;btn.textContent=`${left}s 后重发`;
    clearInterval(sendTimer);
    sendTimer=setInterval(()=>{
      left--;if(left<=0){clearInterval(sendTimer);btn.disabled=false;btn.textContent="重新获取";return;}
      btn.textContent=`${left}s 后重发`;
    },1000);
    $("#lgErr").textContent="";
    if(window.toast)toast(resent?"新验证码已发送，旧的已失效，请输入最新收到的 📩":"验证码已发送，请查看短信 📩");
  }catch(e){
    $("#lgErr").textContent=errMsg(e);btn.disabled=false;
  }
}
/* 提交验证码（不重新发送） */
async function submitPhoneLogin(){
  ensureShell();
  if(!cloud){$("#lgErr").textContent="云服务暂不可用，请稍后重试";return;}
  if(!agreeOK()){needAgree();return;}
  const phone=$("#lgPhone").value.trim(),code=$("#lgCode").value.trim();
  if(!/^1\d{10}$/.test(phone)){$("#lgPhoneErr").textContent="请输入正确的 11 位手机号";return;}
  /* 刷新过页面也能接着登录：从 sessionStorage 恢复发送凭证 */
  const otp=loadOtp();
  if(!otp||otp.phone!==phone){
    if(otp&&otp.phone!==phone){
      $("#lgErr").textContent="验证码是发给「"+otp.phone.slice(0,3)+"****"+otp.phone.slice(-4)+"」的，请重新获取本机验证码";
    }else{
      $("#lgErr").textContent="验证码已过期或页面刷新过，请点「重新获取」发一条新的，再输入收到的验证码";
    }
    return;
  }
  if(!/^\d{4,6}$/.test(code)){$("#lgErr").textContent="请输入收到的短信验证码";return;}
  /* 首次注册：用户名 + 密码是「免验证码登录」的前提，填了就必须合法 */
  const regVisible=$("#lgReg")&&!$("#lgReg").hidden;
  let uname="",pwd="";
  if(regVisible){
    uname=($("#lgUser").value||"").trim();
    pwd=$("#lgPwd").value||"";
    const nameBad=regNameOK(uname);
    if(nameBad){$("#lgUserErr").textContent=nameBad;return;}
    if(pwd.length<6||pwd.length>20){$("#lgErr").textContent="登录密码请设置 6-20 位";return;}
    const okName=await checkUserName();
    if(!okName){$("#lgErr").textContent="请先换一个可用的登录用户名";return;}
  }
  const btn=$("#lgSubmit");btn.disabled=true;btn.textContent="登录中…";
  try{
    /* 只校验一次：验证码一经验证即被消耗，重复校验会把"会话失效"伪装成"验证码错误" */
    const payload={
      phone:otp.phone,verificationId:otp.verificationId,
      isExistingUser:otp.isExistingUser,token:code
    };
    /* 有密码就走注册带密码（平台侧同时设好密码，之后可免验证码） */
    if(pwd)payload.password=pwd;
    const done=await withTimeout(cloud.auth.verifyOtp(payload),20000,"登录校验");
    if(!done||done.error){
      const raw=String((done&&done.error&&(done.error.message||done.error.error_description||done.error.error))||"");
      /* 服务端说「请先获得该手机号的验证码」/ 挑战不存在 → 本地凭证已作废，清掉并引导重发 */
      if(/请先获得|验证码不存在|not\s*found|expired|已过期|失效/i.test(raw)){
        saveOtp(null);
        const h=$("#lgHint"); if(h){h.style.display="none";h.textContent="";}
        $("#lgErr").textContent="验证码已失效（可能超时或页面刷新过），请点「重新获取」发一条新的";
        return;
      }
      $("#lgErr").textContent=errMsg(done&&done.error);
      return;
    }
    saveOtp(null);
    rememberPhone(otp.phone);      /* 会话对象不含手机号，记下来供「账号与安全」设密码用 */
    await refreshSession();
    $("#lgCode").value="";
    closeLogin(true);
    onAuthChanged();
    if(pwd){
      /* 注册已成功，紧接着把「用户名→手机号」映射存好；失败也不影响登录，只是要重设 */
      const saved=await saveLoginAccount(uname,pwd,otp.phone);
      if(window.toast){
        toast(saved.ok
          ?("账号设置完成 ✅ 下次可用「"+uname+"」+ 密码直接登录")
          :("注册成功，但用户名没存上："+saved.msg+"，可在「我的—账号与安全」重设"));
      }
      setTimeout(()=>remindSetPwd(),600);
    }else if(window.toast){
      toast("登录成功，现在可以发布求助并上传素材了 ✅");
      setTimeout(()=>remindSetPwd(),600);
    }
  }catch(e){
    $("#lgErr").textContent=errMsg(e);
  }finally{
    btn.disabled=false;btn.textContent="登录 / 注册";
  }
}
/* 微信一键登录 / 扫码登录（同一套 OAuth 流程） */
async function wechatLogin(){
  ensureShell();
  if(!cloud){$("#lgErr").textContent="云服务暂不可用，请稍后重试";return;}
  if(!agreeOK()){needAgree();return;}
  const btn=$("#lgWx");btn.disabled=true;
  try{
    const r=await withTimeout(cloud.auth.signInWithOAuth({provider:"wechat",redirectTo:location.origin}),20000,"发起微信登录");
    if(r&&r.error){$("#lgErr").textContent=errMsg(r.error);return;}
    if(r&&r.data&&r.data.url){location.assign(r.data.url);return;}
    $("#lgErr").textContent="暂无法发起微信登录，请使用手机号验证码";
  }catch(e){
    $("#lgErr").textContent=errMsg(e);
  }finally{btn.disabled=false;}
}

/* ---------- 上传进度 ---------- */
let upWatch=null, upStage="";
function showProgress(t){
  const el=$("#upMask");if(!el)return;
  $("#upT").textContent=t||"正在上传…";$("#upS").textContent="准备中";$("#upBar").style.width="0%";
  el.classList.add("open");uploading=true;upStage=t||"";
  /* 看门狗：网络慢时明确告知，避免老人以为"死机了"而反复点击 */
  clearInterval(upWatch);
  const started=Date.now();
  upWatch=setInterval(()=>{
    const el2=$("#upMask");
    if(!el2||!el2.classList.contains("open")){clearInterval(upWatch);return;}
    const sec=Math.round((Date.now()-started)/1000);
    /* 硬超时：上传卡死时遮罩会挡住全屏（用户只能强杀程序），120 秒后自动收起并说明情况 */
    if(sec>=120&&el2.classList.contains("open")){
      try{hideProgress();}catch(e){}
      if(window.toast)toast("上传超时了，内容已保存在本机，可稍后重试");
      return;
    }
    if(sec>=20){
      const t2=$("#upT");
      if(t2&&!/网络较慢/.test(t2.textContent))t2.textContent="网络较慢，正在继续上传…";
      const s2=$("#upS");
      if(s2&&!/请稍候/.test(s2.textContent))s2.textContent="请稍候，内容不会丢（已等待 "+sec+" 秒）";
    }
  },3000);
}
function setProgress(i,total,label){
  const p=Math.round(i/Math.max(1,total)*100);
  const bar=$("#upBar");if(bar)bar.style.width=p+"%";
  const s=$("#upS");if(s)s.textContent=(label||"已上传")+` ${i}/${total} · ${p}%`;
}
function hideProgress(){
  const el=$("#upMask");if(el)el.classList.remove("open");
  clearInterval(upWatch);upWatch=null;uploading=false;
}

/* ---------- 存储：签名与上传 ----------
   签名地址缓存（2026-10-26 节流）：签名 URL 有效期 1 小时，此前每次进首页/切页都重新签一遍，
   既多打请求也白耗额度。这里缓存 50 分钟，同一素材在有效期内复用同一地址。 */
const SIGN_CACHE_MS=50*60*1000, SIGN_CACHE_MAX=400;
const signCache=new Map();
function signCacheGet(p){
  const c=signCache.get(p);
  if(!c)return "";
  if(c.exp<=Date.now()){signCache.delete(p);return "";}
  return c.url;
}
function signCachePut(p,u){
  if(!u)return;
  if(signCache.size>=SIGN_CACHE_MAX){
    /* 先清过期，仍超限就丢最早写入的一批（Map 保持插入序） */
    const now=Date.now();
    for(const [k,v] of signCache){if(v.exp<=now)signCache.delete(k);}
    let over=signCache.size-SIGN_CACHE_MAX+1;
    for(const k of signCache.keys()){if(over--<=0)break;signCache.delete(k);}
  }
  signCache.set(p,{url:u,exp:Date.now()+SIGN_CACHE_MS});
}
function clearSignCache(){try{signCache.clear();}catch(_){}}
async function signPaths(paths){
  const map={};
  if(!session||!cloud||!paths||!paths.length)return map;
  const uniq=[...new Set(paths.filter(Boolean))];
  if(!uniq.length)return map;
  const need=[];
  for(const p of uniq){
    const hit=signCacheGet(p);
    if(hit)map[p]=hit; else need.push(p);
  }
  if(!need.length)return map;
  try{
    if(typeof cloud.storage.createSignedUrls==="function"){
      const r=await withTimeout(cloud.storage.createSignedUrls(need,3600),12000,"获取图片地址");
      const arr=r&&r.data;
      if(Array.isArray(arr))arr.forEach((x,i)=>{
        const p=x&&(x.path||x.name||need[i]);
        const u=x&&(x.signedUrl||x.signed_url||x.url);
        if(p&&u){map[p]=u;signCachePut(p,u);}
      });
    }
  }catch(e){}
  for(const p of need.filter(k=>!map[k])){
    try{
      const r=await withTimeout(cloud.storage.createSignedUrl(p,3600),12000,"获取图片地址");
      const d=r&&r.data,u=d&&(d.signedUrl||d.signed_url||d.url);
      if(u){map[p]=u;signCachePut(p,u);}
    }catch(e){}
  }
  return map;
}
/* 会话/令牌失效判定（2026-10-25）：session 对象还在但令牌已被服务端拒绝时，
   必须让用户重新登录，而不是让 TA 对着「上传失败」猜原因 */
function isAuthErr(e){
  const code=(e&&(e.code||e.status))||"";
  const raw=String((e&&(e.message||e.error_description||e.error))||"");
  return code==="invalid_grant"||code===401||code===403||(e&&e.kind==="unauthenticated")
    ||/session is invalid|another client|invalid_grant|unauthenticated|JWT/i.test(raw);
}
/* 会话失效后的统一处置：清掉假会话（让 gate/登录面板正常接管），SDK 令牌异步注销 */
function dropDeadSession(){
  try{session=null;}catch(_){}
  try{if(cloud&&cloud.auth&&cloud.auth.signOut)cloud.auth.signOut();}catch(_){}
}
/* 生成列表用小图（400px / q0.70，约 20-35KB）：信息流只加载它，点开才取原图。
   2026-10-26 节流：手机原图 2-4MB，一个列表 10 张就是几十 MB 下行额度。
   免费版额度按流量折算（210 点/GB），列表图越小，能撑的访客越多。 */
async function makeThumb(blob,maxSide,quality){
  try{
    if(!blob||!/^image\//i.test(blob.type||""))return null;
    maxSide=maxSide||400;quality=quality||0.7;
    let bmp=null;
    if(window.createImageBitmap){
      try{bmp=await createImageBitmap(blob);}catch(e){bmp=null;}
    }
    if(!bmp){
      bmp=await new Promise((res,rej)=>{
        const img=new Image();
        img.onload=()=>res(img);img.onerror=rej;
        img.src=URL.createObjectURL(blob);
      });
    }
    const w=bmp.width||bmp.naturalWidth,h=bmp.height||bmp.naturalHeight;
    if(!w||!h)return null;
    const s=Math.min(1,maxSide/Math.max(w,h));
    const cv=document.createElement("canvas");
    cv.width=Math.max(1,Math.round(w*s));cv.height=Math.max(1,Math.round(h*s));
    cv.getContext("2d").drawImage(bmp,0,0,cv.width,cv.height);
    const out=await new Promise(r=>{try{cv.toBlob(r,"image/jpeg",quality);}catch(e){r(null);}});
    return out||null;
  }catch(e){return null;}
}
/* 视频抓首帧当封面（2026-10-26 免费额度专项）：
   视频卡片若只有 poster 而没有封面，浏览器会为了显示第一帧去下载视频数据；
   有了封面图（约 30KB），列表可以完全不碰视频文件，点开才加载。 */
async function makeVideoPoster(blob,maxSide,quality){
  try{
    if(!blob||!/^video\//i.test(blob.type||""))return null;
    maxSide=maxSide||480;quality=quality||0.7;
    const url=URL.createObjectURL(blob);
    const v=document.createElement("video");
    v.muted=true;v.playsInline=true;v.setAttribute("playsinline","");v.preload="auto";v.src=url;
    const ready=await new Promise(res=>{
      let done=false;const fin=x=>{if(!done){done=true;res(x);}};
      v.onloadeddata=()=>fin(true);
      v.onerror=()=>fin(false);
      setTimeout(()=>fin(false),7000);
    });
    let w=0,h=0;
    if(ready){
      try{v.currentTime=Math.min(0.4,(v.duration||1)/3);}catch(e){}
      await new Promise(r=>{let f=false;const go=()=>{if(!f){f=true;r();}};v.onseeked=go;setTimeout(go,2500);});
      w=v.videoWidth||0;h=v.videoHeight||0;
    }
    if(!w||!h){try{URL.revokeObjectURL(url);}catch(e){}return null;}
    const s=Math.min(1,maxSide/Math.max(w,h));
    const cv=document.createElement("canvas");
    cv.width=Math.max(1,Math.round(w*s));cv.height=Math.max(1,Math.round(h*s));
    cv.getContext("2d").drawImage(v,0,0,cv.width,cv.height);
    const out=await new Promise(r=>{try{cv.toBlob(r,"image/jpeg",quality);}catch(e){r(null);}});
    try{URL.revokeObjectURL(url);}catch(e){}
    return out||null;
  }catch(e){return null;}
}
async function uploadItems(items,type){
  const out=[];
  if(!items||!items.length)return out;
  for(let i=0;i<items.length;i++){
    const it=items[i];
    const ext=it.ext||guessExt(it.blob&&it.blob.type,it.kind);
    const name=`${Date.now()}-${i}-${rnd()}.${ext}`;
    const path=cloud.storage.sharedPath(session.user.id,`${type}/${name}`);
    let res;
    try{
      res=await withTimeout(
        cloud.storage.upload(path,it.blob,{contentType:(it.blob&&it.blob.type)||mimeOf(it.kind,ext),upsert:false}),
        90000,"素材上传");
    }catch(e){
      /* 保持原始错误向上抛：publishPost 侧要靠错误码识别「会话失效」并引导重新登录 */
      if(isAuthErr(e))throw e;
      throw new Error(errMsg(e));
    }
    if(res&&res.error){
      if(isAuthErr(res.error))throw res.error;
      throw new Error(errMsg(res.error));
    }
    /* 图片／视频顺带传一张小图当列表封面（失败不影响发布） */
    let thumb="";
    if(it.kind==="img"||it.kind==="video"){
      const tb=it.kind==="img"?await makeThumb(it.blob):await makeVideoPoster(it.blob);
      if(tb){
        const tpath=cloud.storage.sharedPath(session.user.id,`${type}/t-${name.replace(/\.[^.]+$/,"")}.jpg`);
        try{
          const tr=await withTimeout(cloud.storage.upload(tpath,tb,{contentType:"image/jpeg",upsert:false}),60000,"缩略图上传");
          if(!(tr&&tr.error))thumb=tpath;
        }catch(e){/* 缩略图是可选项，失败退回原图 */}
      }
    }
    out.push({kind:it.kind,path,dur:it.dur||"",name:it.name||"",thumb,url:URL.createObjectURL(it.blob)});
    setProgress(i+1,items.length,"已上传");
  }
  return out;
}

/* 用「作者 + 标题」回查最近一条记录：
   弱网下插入请求可能已成功但回执丢失，靠它确认到底存没存，避免重复发布 */
async function findRecentPost(title){
  try{
    const r=await withTimeout(
      cloud.database.from("yb_posts").select("*")
        .eq("owner_id",session.user.id).eq("title",title)
        .order("id",{ascending:false}).limit(1),
      12000,"确认保存");
    const rows=(r&&r.data)||[];
    return rows[0]||null;
  }catch(e){return null;}
}

/* ---------- 发布求助（上传 + 入库） ---------- */
async function publishPost(payload,items){
  if(!cloud)return {ok:false,reason:"no-cloud"};
  const ok=await ensureLogin();
  if(!ok)return {ok:false,reason:"cancel"};
  if(!session)return {ok:false,reason:"no-session"};
  let media=[];
  try{
    if(items&&items.length){showProgress("正在上传素材到云端…");media=await uploadItems(items,String(payload.type||"img"));}
    showProgress("正在保存到云端…");
    const row={
      type:payload.type,title:payload.title,body:payload.text,tag:payload.tagFull||payload.tag,
      age:payload.age||"",urg:payload.urg||1,vis:payload.vis||0,loc:payload.loc||"",
      owner_name:myName(),owner_flag:flagOf(),
      media:media.map(m=>({kind:m.kind,path:m.path,dur:m.dur,...(m.thumb?{thumb:m.thumb}:{})}))
    };
    let saved=null;
    try{
      /* 只做插入、不等 RETURNING：个别网络环境下回执收不到会把界面卡住 */
      const ins=await withTimeout(cloud.database.from("yb_posts").insert(row),25000,"保存");
      if(ins&&ins.error)throw ins.error;
      saved=(ins&&ins.data&&ins.data[0])||null;
    }catch(e){
      /* 超时或报错：先确认是否其实已经写进去了（避免让用户重复发布） */
      const found=await findRecentPost(row.title);
      if(!found)throw e;
      saved=found;
    }
    if(!saved)saved=await findRecentPost(row.title);   /* 尽力补上云端 id */
    return {ok:true,media,cloudId:saved?saved.id:null,row:saved};
  }catch(e){
    /* 会话失效（令牌被拒但 session 对象还在）：清掉假会话并明确要求重新登录，
       不再让用户对着「上传失败」猜原因（2026-10-25 用户反馈「都不能上传」的根因） */
    if(isAuthErr(e)){
      dropDeadSession();
      return {ok:false,reason:"auth",message:"登录已过期，请重新登录后再发布"};
    }
    return {ok:false,reason:"error",message:errMsg(e),media};
  }finally{
    hideProgress();
  }
}

/* ---------- 评论：读取与写入 ---------- */
async function loadComments(post){
  if(!cloud||!post||!post.cloudId)return;
  try{
    const r=await cloud.database.from("yb_comments")
      .select("*").eq("post_id",post.cloudId).order("created_at",{ascending:true}).limit(100);
    if(r&&r.error)return;
    const rows=(r&&r.data)||[];
    const paths=[];rows.forEach(x=>(x.media||[]).forEach(m=>{if(!m)return;if(m.thumb)paths.push(m.thumb);if(m.path)paths.push(m.path);}));
    const um=await signPaths(paths);
    post.comments=rows.map(x=>({
      user:x.owner_name||"家长",flag:x.owner_flag||"",ava:"animal",
      owner:x.owner_id,   /* 美食答谢需要知道受赠人 uid */
      text:x.body||"",kind:x.kind||"text",dur:x.dur||"",
      media:(x.media||[]).map(m=>Object.assign({},m,{url:um[m.path]||"",thumbUrl:(m.thumb&&um[m.thumb])||""})),
      likes:0,liked:false,replies:[],__cid:x.id
    }));
  }catch(e){}
}
async function publishComment(post,text){
  if(!cloud||!session||!post||!post.cloudId)return {ok:false};
  try{
    /* 同样不等 RETURNING，避免弱网下回执丢失把界面卡住 */
    const r=await withTimeout(cloud.database.from("yb_comments").insert({
      post_id:post.cloudId,body:text,owner_name:myName(),
      owner_flag:flagOf(),kind:"text"
    }),25000,"发表帮忙");
    if(r&&r.error)return {ok:false,message:errMsg(r.error)};
    return {ok:true};
  }catch(e){
    if(isAuthErr(e)){dropDeadSession();return {ok:false,reason:"auth",message:"登录已过期，请重新登录后再帮忙"};}
    return {ok:false,message:errMsg(e)};
  }
}

/* ---------- 云端求助加载与渲染 ----------
   2026-10-25：之前失败静默吞掉 → 弱网用户永远看到「还没有求助信息」。
   现在记录 postsLoadState（loading/ok/fail/isolated）供空态区分，
   失败自动重试 2 次（3s/8s），并提供 retryPosts 供「点此重试」。
   2026-10-26：平台隔离（503）单独成态 isolated → 20s 自动探测恢复，恢复即自动渲染。 */
let postsLoadState="loading",postsRetries=0,postsRetryT=null,postsPoller=null,postsWasIsolated=false;
/* 分页（2026-10-26 节流）：首屏只拉 15 条，点「看更多」再 +15。
   每次打开少读 35 行，按天累计能省下可观的读取额度；老人一次也看不完更多。 */
const POST_PAGE=15,POST_MAX=90;
let postsLimit=POST_PAGE,postsHasMore=false;
function postsState(){return postsLoadState;}
function postsMore(){return postsHasMore;}
async function loadMorePosts(){
  if(!postsHasMore)return {ok:true,more:false};
  if(postsLimit>=POST_MAX)return {ok:true,more:false,limit:true};
  return loadCloudPosts(true);
}
function retryPosts(){
  postsRetries=0;postsLoadState="loading";postsLimit=POST_PAGE;
  clearTimeout(postsRetryT);postsRetryT=null;
  clearTimeout(postsPoller);postsPoller=null;
  mergeCloudPosts();          /* 立即把空态切成「正在加载」 */
  loadCloudPosts();
}
/* ---------- 标记求助已解决（2026-10-25 收权到发布者） ----------
   库端 yb_post_solve(pid)：SECURITY DEFINER 校验 owner_id=auth.uid()，
   非发布者/未登录在数据库层就拒掉（不靠前端）。 */
async function solvePost(cloudId){
  if(!cloud||!ready)return {ok:false,message:"云端未就绪"};
  const ok=await ensureLogin();
  if(!ok)return {ok:false,reason:"cancel"};
  try{
    const r=await withTimeout(cloud.database.rpc("yb_post_solve",[Number(cloudId)]),15000,"标记已解决");
    if(r&&r.error)throw r.error;
    return {ok:true};
  }catch(e){
    if(isAuthErr(e)){dropDeadSession();return {ok:false,reason:"auth",message:"登录已过期，请重新登录后再操作"};}
    return {ok:false,message:errMsg(e)};
  }
}

async function loadCloudPosts(more){
  if(!cloud||!ready)return;
  if(more)postsLimit=Math.min(POST_MAX,postsLimit+POST_PAGE); else postsLimit=POST_PAGE;
  try{
    const r=await withTimeout(cloud.database.from("yb_posts")
      .select("*").order("created_at",{ascending:false}).limit(postsLimit),20000,"加载云端求助");
    if(r&&r.error)throw r.error;
    const raw=(r&&r.data)||[];
    /* 管理后台下架的内容不再进入信息流（后台自身仍可查看并恢复） */
    const rows=raw.filter(x=>!x.hidden);
    postsHasMore=raw.length>=postsLimit&&postsLimit<POST_MAX;
    const paths=[];rows.forEach(x=>(x.media||[]).forEach(m=>{if(!m)return;if(m.thumb)paths.push(m.thumb);if(m.path)paths.push(m.path);}));
    const um=await signPaths(paths);
    cloudPosts=rows.map(x=>{
      const media=(x.media||[]).map(m=>Object.assign({},m,{url:um[m.path]||"",thumbUrl:(m.thumb&&um[m.thumb])||""}));
      return {
        id:100000+Number(x.id),cloudId:x.id,__cloud:true,
        mine:!!(session&&x.owner_id===session.user.id),
        user:x.owner_name||"家长",flag:x.owner_flag||"",ava:"animal",
        type:x.type||"img",media,title:x.title||"",text:x.body||"",
        tag:x.tag||"求助",tagFull:x.tag||"求助",age:x.age||"",
        urg:x.urg||1,vis:x.vis||0,loc:x.loc||"",time:relTime(x.created_at),
        likes:x.likes||0,liked:false,favs:0,faved:false,helps:x.helps||0,
        comments:[],roses:[],r23Status:x.status==="solved"?"solved":"open"
      };
    });
    postsLoadState="ok";postsRetries=0;
    clearTimeout(postsPoller);postsPoller=null;
    paintMaint(false);
    if(postsWasIsolated){
      postsWasIsolated=false;
      try{window.toast&&window.toast("✅ 云端服务已恢复，内容已刷新");}catch(_){}
    }
    mergeCloudPosts();
  }catch(e){
    /* 原始错误进控制台：线上排障靠这里（errMsg 会把长英文收敛成通用提示） */
    try{console.warn("[云端求助] 加载失败：",e&&(e.code||e.status),e&&e.message||e);}catch(_){}
    if(isIsolated(e)){
      /* 平台侧隔离/维护：不计失败次数，20s 自动再探；恢复后自动渲染，用户无需操作 */
      postsLoadState="isolated";
      postsWasIsolated=true;
      paintMaint(true);
      mergeCloudPosts();
      clearTimeout(postsPoller);
      postsPoller=setTimeout(()=>{postsPoller=null;loadCloudPosts();},20000);
      return;
    }
    postsLoadState="fail";
    mergeCloudPosts();          /* 空态切换成「加载失败/重试」而不是误导性的「还没有求助」 */
    if(postsRetries<2){
      postsRetries++;
      clearTimeout(postsRetryT);
      postsRetryT=setTimeout(loadCloudPosts,postsRetries===1?3000:8000);
    }
  }
}
function mergeCloudPosts(){
  if(typeof S==="undefined")return;
  S.posts=S.posts.filter(p=>!p.__cloud);
  S.posts=[...cloudPosts,...S.posts];
  if(typeof renderFuncRow==="function")renderFuncRow();
  if(typeof renderFeed==="function")renderFeed();
}

/* ---------- 案例广场（2026-10-20）：真实上传 + 云端同步 ----------
   表 yb_cases：SELECT 全员可见（案例内容公开），INSERT 仅登录作者本人；
   素材上传复用帖子的 storage 通道（case/ 目录）。 */
async function publishCase(payload,items){
  if(!cloud)return {ok:false,reason:"no-cloud"};
  const ok=await ensureLogin();
  if(!ok)return {ok:false,reason:"cancel"};
  if(!session)return {ok:false,reason:"no-session"};
  let media=[];
  try{
    if(items&&items.length){
      showProgress("正在上传案例素材到云端…");
      media=await uploadItems(items,"case");
    }
    showProgress("正在保存案例…");
    const row={
      title:payload.title,type:payload.type||"img",
      owner_name:myName(),
      /* 图文案例（2026-10-27 casedit 层）：正文 HTML 随行落库。
         列未迁移前（42703）由调用方探测降级，这里只做守卫式透传，不做结构改动。 */
      ...(payload.content_html!=null?{content_html:String(payload.content_html).slice(0,200000)}:{}),
      media:media.map(m=>({kind:m.kind,path:m.path,dur:m.dur||"",name:m.name||"",...(m.thumb?{thumb:m.thumb}:{})}))
    };
    const ins=await withTimeout(cloud.database.from("yb_cases").insert(row),25000,"保存案例");
    if(ins&&ins.error)throw ins.error;
    const saved=(ins&&ins.data&&ins.data[0])||null;
    return {ok:true,media,cloudId:saved?saved.id:null};
  }catch(e){
    /* 原始错误必须进控制台：errMsg 会把长英文收敛成「网络开小差了」，线上排障全靠这里 */
    try{console.warn("[案例发布] 原始错误：",e&&(e.code||e.status),e&&e.message||e);}catch(_){}
    /* 会话失效：与发布求助同规则，明确引导重新登录（2026-10-25） */
    if(isAuthErr(e)){
      dropDeadSession();
      return {ok:false,reason:"auth",message:"登录已过期，请重新登录后再上传"};
    }
    return {ok:false,reason:"error",message:errMsg(e),media};
  }finally{
    hideProgress();
  }
}
let cloudCases=[];
let casesState="loading",casesRetries=0,casesRetryT=null,casesPoller=null,casesWasIsolated=false;
async function loadCases(){
  if(!cloud||!ready)return;
  try{
    const r=await withTimeout(cloud.database.from("yb_cases")
      .select("*").order("created_at",{ascending:false}).limit(50),20000,"加载案例");
    if(r&&r.error)throw r.error;
    const rows=((r&&r.data)||[]).filter(x=>!x.hidden);
    const paths=[];rows.forEach(x=>(x.media||[]).forEach(m=>{if(!m)return;if(m.thumb)paths.push(m.thumb);if(m.path)paths.push(m.path);}));
    /* signPaths 需要登录会话：未登录时返回空表 → 查看器按「登录后可查看」处理（与求助素材同规则） */
    const um=await signPaths(paths);
    cloudCases=rows.map(x=>{
      const media=(x.media||[]).map(m=>Object.assign({},m,{url:um[m.path]||"",thumbUrl:(m.thumb&&um[m.thumb])||""}));
      return {
        id:200000+Number(x.id),cloudId:x.id,__cloud:true,
        t:x.title||"案例",by:x.owner_name||"家长",ava:"animal",
        type:x.type||"img",kind:"study",media,
        dur:((x.media||[]).find(m=>m.kind==="video")||{}).dur||"0:30",
        /* 图文案例正文（2026-10-27 casedit 层）：列未迁移时 x.content_html 为 undefined → 空串，
           查看端按「无正文」处理，旧案例零影响。清洗与渲染由 casedit 层负责，此处只透传原文。 */
        content_html:x.content_html||"",
        helps:0,likes:0,favs:0
      };
    });
    casesState="ok";casesRetries=0;
    clearTimeout(casesPoller);casesPoller=null;
    casesWasIsolated=false;
    mergeCloudCases();
  }catch(e){
    try{console.warn("[案例广场] 加载失败：",e&&(e.code||e.status),e&&e.message||e);}catch(_){}
    if(isIsolated(e)){
      casesState="isolated";casesWasIsolated=true;
      mergeCloudCases();
      clearTimeout(casesPoller);
      casesPoller=setTimeout(()=>{casesPoller=null;loadCases();},20000);
      return;
    }
    casesState="fail";
    mergeCloudCases();
    if(casesRetries<2){
      casesRetries++;
      clearTimeout(casesRetryT);
      casesRetryT=setTimeout(loadCases,casesRetries===1?3000:8000);
    }
  }
}
function mergeCloudCases(){
  if(typeof S==="undefined")return;
  S.cases=S.cases.filter(c=>!c.__cloud);
  S.cases=[...cloudCases,...S.cases];
  try{if(typeof renderCases==="function")renderCases();}catch(e){}
}
/* 删除案例（2026-10-24）：管理员（is_admin）或作者本人可删（RLS yb_cases_admin_remove / yb_cases_delete_own）
   素材文件顺带清理，失败不阻塞——行删掉后孤儿文件不影响展示 */
async function deleteCase(cloudId,media){
  if(!cloud||!ready)return {ok:false,reason:"no-cloud"};
  const ok=await ensureLogin();
  if(!ok)return {ok:false,reason:"cancel"};
  if(!session)return {ok:false,reason:"no-session"};
  try{
    const r=await withTimeout(cloud.database.from("yb_cases").delete().eq("id",cloudId),15000,"删除案例");
    if(r&&r.error)throw r.error;
    try{
      const paths=(media||[]).map(m=>m&&m.path).filter(Boolean);
      if(paths.length&&cloud.storage&&typeof cloud.storage.remove==="function"){
        await withTimeout(cloud.storage.remove(paths),12000,"清理案例素材");
      }
    }catch(_){/* 孤儿文件可容忍 */}
    return {ok:true};
  }catch(e){
    try{console.warn("[案例删除] 原始错误：",e&&(e.code||e.status),e&&e.message||e);}catch(_){}
    return {ok:false,reason:"error",message:errMsg(e)};
  }
}

/* ---------- 我的页面：账号信息 ---------- */
function renderAccount(){
  const menu=$("#meMenu");if(!menu)return;
  const nameEl=$(".me-n");
  const idEl=$(".me-id");
  if(session){
    if(nameEl){
      /* 登录后显示昵称：myName() 已优先读本地资料 */
      const want=myName();
      const first=nameEl.childNodes[0];
      if(first&&first.nodeType===3&&first.nodeValue.trim()!==want)first.nodeValue=want+" ";
    }
    if(idEl){
      const want="育人帮号："+String((session.user&&session.user.id)||"").slice(-8);
      /* 覆盖未登录占位后要清掉 guest 标记，两种状态来回切换才不会卡住 */
      if(idEl.dataset.clGuest){delete idEl.dataset.clGuest;}
      if(idEl.dataset.clId!==want){
        idEl.dataset.clId=want;
        /* 2026-10-28：去掉了写死挂上的「已实名」标签——平台没有实名认证流程，
           挂了就是对用户的虚假陈述（第三方审核一票否决项） */
        idEl.innerHTML=`<span>${esc(want)}</span>`;
      }
    }
  }else{
    /* 未登录（2026-10-20 用户反馈）：头部不得显示昵称 / 育人帮号 / 已实名，
       否则「明明未登录却像已登录」，与下方「登录 / 注册」入口自相矛盾 */
    if(nameEl){
      const first=nameEl.childNodes[0];
      if(first&&first.nodeType===3&&first.nodeValue.trim()!=="未登录")first.nodeValue="未登录 ";
    }
    if(idEl&&idEl.dataset.clGuest!=="1"){
      idEl.dataset.clGuest="1";
      idEl.innerHTML=`<span>登录后展示昵称与育人帮号</span>`;
    }
  }
  let row=$("#clAcct");
  if(!row){
    menu.insertAdjacentHTML("afterbegin",
      `<button class="me-item cl-acct" id="clAcct"><span class="ic">${session?"👤":"🔑"}</span>
        <span id="clAcctT">${session?"我的账号":"登录 / 注册"}</span>
        <span class="sub" id="clAcctS"><span class="cl-dot ${session?"":"off"}"></span>${session?"已登录":"未登录"}</span>
        <span class="arr">›</span></button>`);
    row=$("#clAcct");
  }else{
    const t=$("#clAcctT"),s=$("#clAcctS"),ic=row.querySelector(".ic");
    const wantT=session?"我的账号":"登录 / 注册";
    if(t&&t.textContent!==wantT)t.textContent=wantT;
    const wantIc=session?"👤":"🔑";
    if(ic&&ic.textContent!==wantIc)ic.textContent=wantIc;
    const wantS=`<span class="cl-dot ${session?"":"off"}"></span>${session?"已登录":"未登录"}`;
    /* 仅在内容变化时写入，避免 MutationObserver 自触发死循环 */
    if(s&&s.dataset.cls!==wantS){s.dataset.cls=wantS;s.innerHTML=wantS;}
  }
  row.onclick=()=>{
    if(!session){ensureLogin();return;}
    modal(`<div class="md-title">账号</div>
      <div class="a11y-mrow"><span>登录身份</span><span style="margin-left:auto;font-weight:800">${esc(myName())}</span></div>
      <div class="a11y-mrow"><span>求助与素材</span><span style="margin-left:auto;color:var(--muted);font-size:12.5px">已实时保存到云端</span></div>
      <div class="md-acts"><button class="btn-g" data-x="close">关闭</button><button class="btn-a" id="clOut">退出登录</button></div>`);
    const out=$("#clOut");
    if(out)out.onclick=async()=>{
      try{await cloud.auth.signOut();}catch(e){}
      session=null;cloudPosts=[];forgotPhone();
      if(typeof closeModal==="function")closeModal();
      if(typeof S!=="undefined")S.posts=S.posts.filter(p=>!p.__cloud);
      if(typeof renderFeed==="function")renderFeed();
      renderAccount();
      if(window.toast)toast("已退出登录");
    };
  };
}

/* ---------- 评论 / 详情：进入时拉取云端评论 ---------- */
function hookCommentLoads(){
  document.addEventListener("click",e=>{
    const trigger=e.target.closest('[data-act="cm"],[data-r23detail]');
    if(!trigger)return;
    /* 未登录不拉帮忙留言：服务端只允许 authenticated 读 yb_comments，
       拉回来必然是空数组，却会把 post 标记成"已加载"，登录后就不再重试 */
    if(!session)return;
    const card=trigger.closest(".card")||null;
    const id=card?+card.dataset.id:(S&&S.curPost);
    const post=(S&&S.posts||[]).find(p=>p.id===id);
    if(!post||!post.__cloud||post._cmLoaded||post._cmLoading)return;
    post._cmLoading=true;
    loadComments(post).then(()=>{
      post._cmLoading=false;post._cmLoaded=true;
      const again=card&&(card.querySelector(".pa-help")||card.querySelector('[data-act="cm"]'));
      const inDetail=document.querySelector("#r23Detail.open");
      if(inDetail&&document.querySelector(`[data-r23detail="${post.id}"]`)){
        document.querySelector(`[data-r23detail="${post.id}"]`).click();
      }else if(again){
        setTimeout(()=>again.click(),30);
      }
    });
  },true);

  /* 登录 / 退出后：帮忙留言的可见性变了，必须清掉"已加载"标记并让
     当前正看着的这条求助重新拉一次 —— 否则家长登录后会一直卡在「还没有帮忙」。
     （session 在派发 yrb-auth 之前就已写好，所以这里读到的是新状态） */
  window.addEventListener("yrb-auth",()=>{
    if(!S||!S.posts)return;
    S.posts.forEach(p=>{p._cmLoaded=false;p._cmLoading=false;});
    if(!session)return;
    const post=(S.posts||[]).find(p=>p.id===S.curPost);
    if(!post||!post.__cloud)return;
    setTimeout(()=>{
      const dl=document.querySelector(`[data-r23detail="${post.id}"]`);
      if(document.querySelector("#r23Detail.open")&&dl){dl.click();return;}
      const t=document.querySelector(`#feed .card[data-id="${post.id}"] [data-act="cm"]`);
      if(t)t.click();
    },400);
  });

  /* 帮忙评论：真实写入云端（文本） */
  document.addEventListener("click",e=>{
    const btn=e.target.closest("#cmSend");if(!btn)return;
    if(!cloud||!session)return;
    const post=(S&&S.posts||[]).find(p=>p.id===S.curPost);
    if(!post||!post.__cloud)return;
    const inp=$("#cmInput");const text=inp?inp.value.trim():"";
    if(!text)return;
    publishComment(post,text).then(r=>{
      if(!r.ok&&r.reason==="auth"){
        if(window.toast)toast((r.message||"登录已过期，请重新登录"));
        setTimeout(()=>{try{openLogin();}catch(e){}},800);
      }else if(!r.ok&&window.toast)toast("云端保存失败，仅本机可见："+(r.message||""));
    });
  },true);
}

/* ================= 帮忙面板：真实录音 / 录像（与发布面板共用同一套采集实现） ================= */
let cmCapType=null;                 /* 当前正在采集的类型：voice | video */

function cmCapHost(){return $("#cmCap");}

async function uploadCommentItem(item){
  const ext=item.ext||guessExt(item.blob&&item.blob.type,item.kind);
  const name=`${Date.now()}-${rnd()}.${ext}`;
  const path=cloud.storage.sharedPath(session.user.id,`comments/${name}`);
  let res;
  try{
    res=await withTimeout(cloud.storage.upload(path,item.blob,{
      contentType:(item.blob&&item.blob.type)||mimeOf(item.kind,ext),upsert:false
    }),60000,"上传帮忙素材");
  }catch(e){
    /* 保留原始错误码给上层判定会话失效（2026-10-25） */
    if(isAuthErr(e))throw e;
    throw new Error(errMsg(e));
  }
  if(res&&res.error){
    if(isAuthErr(res.error))throw res.error;
    throw new Error(errMsg(res.error));
  }
  /* 帮忙图片也带一张小图，避免列表直接拉原图（2026-10-26 节流） */
  let thumb="";
  if(item.kind==="img"){
    const tb=await makeThumb(item.blob);
    if(tb){
      const tpath=cloud.storage.sharedPath(session.user.id,`comments/t-${name.replace(/\.[^.]+$/,"")}.jpg`);
      try{
        const tr=await withTimeout(cloud.storage.upload(tpath,tb,{contentType:"image/jpeg",upsert:false}),60000,"缩略图上传");
        if(!(tr&&tr.error))thumb=tpath;
      }catch(e){}
    }
  }
  return {kind:item.kind,path,dur:item.dur||"",thumb};
}
async function sendCommentMedia(post,item){
  if(!cloud||!session)return {ok:false,reason:"no-session"};
  if(!post||!post.cloudId)return {ok:false,reason:"not-cloud"};
  try{
    const m=await uploadCommentItem(item);
    const r=await withTimeout(cloud.database.from("yb_comments").insert({
      post_id:post.cloudId,body:"",owner_name:myName(),owner_flag:flagOf(),
      kind:item.kind,dur:item.dur||"",media:[{kind:m.kind,path:m.path,dur:m.dur,...(m.thumb?{thumb:m.thumb}:{})}]
    }),25000,"发表帮忙");
    if(r&&r.error)throw r.error;
    return {ok:true,path:m.path};
  }catch(e){
    /* 会话失效：清掉假会话并要求重新登录（帮忙素材同理，2026-10-25） */
    if(isAuthErr(e)){
      dropDeadSession();
      return {ok:false,reason:"auth",message:"登录已过期，请重新登录后再帮忙"};
    }
    return {ok:false,message:errMsg(e)};
  }
}

/* 收起采集区（同时释放摄像头/麦克风，避免一直占用） */
function closeCommentCapture(){
  cmCapType=null;
  if(window.YRB_CAPTURE){
    if(YRB_CAPTURE.unmount)YRB_CAPTURE.unmount();
    YRB_CAPTURE.stopAll();
  }
  const host=cmCapHost();
  if(host){host.classList.remove("open");host.innerHTML="";}
}

/* 录制完成 → 本地立即渲染成可播放的帮忙；已登录则同步云端 */
async function finishCommentCapture(type){
  if(!window.YRB_CAPTURE)return;
  const items=YRB_CAPTURE.collect(type);
  if(!items.length){toast("还没录好，请先完成录制");return;}
  const it=items[0];
  const dur=YRB_CAPTURE.duration(type)||"";
  const url=URL.createObjectURL(it.blob);          /* 独立的对象地址，与采集层的临时地址互不影响 */
  const post=(S&&S.posts||[]).find(x=>x.id===S.curPost);
  closeCommentCapture();
  if(!post)return;
  addComment({user:(session?myName():"阳阳爸爸"),flag:flagOf(),ava:"rabbit",
    kind:type,dur,media:[{kind:type,url}],likes:0,liked:false});
  toast(type==="voice"?"🎙️ 语音帮忙已送达，感谢你的善意":"📹 视频帮忙已送达，感谢你的善意");
  if(cloud&&post.__cloud){
    if(!session){toast("已送达（保存在本机）。登录后可与更多家长分享 🌸");return;}
    const r=await sendCommentMedia(post,{kind:type,blob:it.blob,ext:it.ext,dur});
    if(!r.ok){
      if(r.reason==="auth"){
        toast((r.message||"登录已过期，请重新登录")+"；帮忙已保存在本机");
        setTimeout(()=>{try{openLogin();}catch(e){}},800);
      }else if(r.message)toast("云端同步失败，已保存在本机："+r.message);
    }
  }
}

function openCommentCapture(type){
  const host=cmCapHost();
  if(!host)return;
  if(!window.YRB_CAPTURE){toast("当前环境不支持拍摄，可用文字帮忙");return;}
  if(cmCapType===type&&host.classList.contains("open")){closeCommentCapture();return;}  /* 再点一次 = 收起 */
  closeCommentCapture();
  host.classList.add("open");
  host.innerHTML=`<div class="cm-cap-head"><span>${type==="voice"?"🎙️ 录一段语音帮忙":"📹 拍一段微视频帮忙"}</span><button class="cm-cap-x" id="cmCapX" type="button">✕ 收起</button></div><div id="cmCapBox"></div>`;
  $("#cmCapX").addEventListener("click",closeCommentCapture);
  cmCapType=type;
  YRB_CAPTURE.mount($("#cmCapBox"),type,t=>finishCommentCapture(t));
}

/* 关闭评论面板 / 切换到别的求助时，自动收起采集区 */
function hookCommentCapture(){
  document.addEventListener("click",e=>{
    if(e.target.closest('[data-close="commentSheet"]')||e.target.closest('[data-act="cm"]'))closeCommentCapture();
  },true);
}

/* ---------- 视觉：账号信息随我的页面重绘而同步 ---------- */
function observeMe(){
  const me=$("#page-me");if(!me)return;
  new MutationObserver(()=>renderAccount()).observe(me,{childList:true,subtree:true});
}

/* ---------- 启动 ---------- */
async function boot(){
  ready=false;
  const ok=await loadSDK();
  if(!ok){initSDK();return;} /* 拉不到 SDK：保持离线演示，不阻塞任何本地功能 */
  initSDK();
  if(!cloud)return;
  /* 微信登录回跳：必须无条件执行，且在任何界面逻辑之前 */
  try{
    const r=await withTimeout(cloud.auth.handleWechatWebCallback(),15000,"处理微信回调");
    if(r&&r.error&&window.toast)toast("微信登录失败："+errMsg(r.error));
    else if(r&&r.data){
      try{history.replaceState(null,"",location.pathname);}catch(e){}
    }
  }catch(e){}
  await refreshSession();
  try{cloud.auth.onAuthStateChange((ev,s)=>{session=s||null;onAuthChanged();});}catch(e){}
  ready=true;
  renderAccount();
  observeMe();
  loadCloudPosts();
  loadCases();
  /* 云端就绪广播：增强层（家教二维码、资质证照等）不能在脚本启动时就假设
     client 已存在——SDK 是异步加载的，早读会拿到 null 且永不重试。
     统一在这里通知一次，各层收到后自行重试读取。 */
  try{window.dispatchEvent(new CustomEvent("yrb-cloud-ready"));}catch(e){}
}

ensureShell();
hookCommentLoads();
hookCommentCapture();
boot();

/* ---------- 帮忙面板的录音/录像入口（供 app.js 调用） ---------- */
window.YRB_COMMENT={record:openCommentCapture,close:closeCommentCapture};

/* ---------- 对外接口 ---------- */
window.YRB_CLOUD={
  enabled(){return !!cloud;},
  ready(){return ready;},
  signedIn(){return !!session;},
  name:myName,
  ensureLogin,
  openLogin,
  /* 账号体系（用户名 + 密码）出口：供「我的—账号与安全」等层复用同一套云端校验 */
  accounts:{
    me(){return accountRpc("yb_account_me",{});},
    save:saveLoginAccount,
    lookup(uname,pwd){return accountRpc("yb_account_login",{p_username:uname,p_password:pwd});},
    avail(uname){return accountRpc("yb_account_avail",{p_username:uname});},
    signIn(phone,pwd){return cloud?cloud.auth.signInWithPassword({phone,password:pwd}):Promise.resolve(null);},
    setPwd:platformSetPwd,
    sendResetOtp:platformSendResetOtp,
    sendOtp(phone){return cloud?cloud.auth.sendOtp({phone}):Promise.resolve(null);},
    mode:switchLoginMode,
    remind:remindSetPwd,
    rule:regNameOK
  },
  /* 退出登录（供账号管理 / 管理后台切换账号使用） */
  async signOut(){
    try{await cloud.auth.signOut();}catch(e){}
    session=null;cloudPosts=[];forgotPhone();
    clearSignCache();
    try{if(typeof S!=="undefined"&&S&&S.posts)S.posts=S.posts.filter(p=>!p.__cloud);}catch(e){}
    try{if(typeof renderFeed==="function")renderFeed();}catch(e){}
    renderAccount();
    try{window.dispatchEvent(new CustomEvent("yrb-auth",{detail:{signedIn:false,who:null}}));}catch(e){}
  },
  publishPost,
  loadCloudPosts,
  solvePost,
  postsState,
  retryPosts,
  postsMore,
  loadMorePosts,
  isIsolated,
  errText: errMsg,
  makeThumb,
  makeVideoPoster,
  paintMaint,
  casesState(){return casesState;},
  retryCases(){
    casesRetries=0;casesState="loading";
    clearTimeout(casesRetryT);casesRetryT=null;
    clearTimeout(casesPoller);casesPoller=null;
    mergeCloudCases();
    loadCases();
  },
  publishCase,
  loadCases,
  deleteCase,
  /* PPT 在线翻页用：签名地址 1 小时过期时按 path 重新签一个（失败返回空串） */
  async resignUrl(path){
    if(!path||!cloud||!session)return "";
    try{const m=await signPaths([path]);return m[path]||"";}catch(e){return "";}
  },
  /* 供「答谢名单」等增强层按需拉取某条求助的帮忙留言（返回 Promise，已加载过则直接复用） */
  async ensureComments(post){
    if(!post)return [];
    if(post._cmLoaded)return post.comments||[];
    if(post._cmLoading){                       /* 正在拉：等它落地（最多 6 秒） */
      for(let i=0;i<30&&post._cmLoading;i++)await new Promise(r=>setTimeout(r,200));
      return post.comments||[];
    }
    post._cmLoading=true;
    try{await loadComments(post);post._cmLoaded=true;}catch(e){}
    post._cmLoading=false;
    return post.comments||[];
  },
  isCloudPost(p){return !!(p&&p.__cloud);},
  /* 当前登录身份摘要（管理后台据此判断是否管理员；实际权限仍由数据库 RLS 把关）
     phone 由 sessionPhone() 多路兜底提取：SDK 会话对象本身不含 user.phone */
  who(){
    if(!session)return null;
    const u=session.user||{};
    return {id:String(u.id||""),phone:sessionPhone(),name:myName()};
  },
  /* 诊断用途：客户端实例只含公开配置，无敏感凭据 */
  get client(){return cloud;},
  config:CFG,
  /* 协议正文出口：设置页「用户协议」与登录面板共用同一份文案（避免两处不一致） */
  doc(k){const d=LG_DOCS[k]||LG_DOCS.terms;return {title:d.t,tag:d.tag,html:d.html};},
  openDoc(k,opts){openLgDoc(k,opts);},
  /* 自检出口：供排障时验证"超时保护 / 慢网提示 / 弹窗可关闭"是否生效 */
  _debug:{
    withTimeout,showProgress,hideProgress,setProgress,
    state(){return {ready,signedIn:!!session,uploading,hasCloud:!!cloud};}
  }
};
})();
