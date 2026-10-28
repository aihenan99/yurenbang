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
  endpoint:"https://xn--gmqq09al6z.cn/yrbapi",
  oauthRelayBaseUrl:"https://www.workbuddy.cn/v2/as/genie-baas/oauth",
  publishableKey:"wbpk_Lt4Zxzyd4j1x3DZdRFyFF9_mGfhreB3aiE9eS2lsMIzIG6z3V4E1O01"
};

let cloud=null, session=null, cloudPosts=[], ready=false;
let loginResolve=null, pendingOtp=null, sendTimer=null;
let uploading=false;

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
function sessionPhone(){
  const u=(session&&session.user)||{},raw=u.raw||{},claims=session?jwtPayload(session.accessToken):{};
  const cands=[
    u.phone,u.phone_number,raw.phone_number,raw.phone,claims.phone_number,claims.phone,
    (/^1\d{10}$/.test(String(u.name||"").trim())?u.name:""),
    (/^1\d{10}$/.test(String(raw.name||"").trim())?raw.name:"")
  ];
  for(const c of cands){
    const d=String(c||"").replace(/\D/g,"");
    if(d.length>=11)return d.slice(-11);
  }
  return "";
}
function myName(){
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
  const code=err.code||err.status;
  if(code==="42501"||code===401||code===403)return "没有权限操作（请重新登录）";
  if(code==="42P01")return "云端数据表尚未就绪";
  if(code==="23505")return "内容已存在";
  if(/timeout|超时/i.test(err.message||""))return err.message;
  return err.message||err.error_description||err.error||"网络异常，请稍后重试";
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

/* ---------- SDK 动态加载（CDN 形式，主源失败自动切换备用源） ---------- */
const SDK_URLS=[
  "https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js",
  "https://unpkg.com/@tencent-ai/workbuddy-cloud-sdk@dev/lib/index.global.js"
];
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
      <div class="lg-label">手机号</div>
      <div class="lg-field"><span class="lg-pre">+86</span><input id="lgPhone" inputmode="numeric" maxlength="11" placeholder="请输入 11 位手机号" aria-label="手机号"></div>
      <div class="lg-err" id="lgPhoneErr"></div>
      <div class="lg-label">短信验证码</div>
      <div class="lg-field"><input id="lgCode" inputmode="numeric" maxlength="6" placeholder="6 位验证码" aria-label="验证码">
        <button class="lg-code-btn" id="lgSend" type="button">获取验证码</button></div>
      <!-- 获取验证码下方：明示同意（未勾选不下发验证码、不能登录） -->
      <div class="lg-agree" id="lgAgree">
        <button class="lg-ck" id="lgCk" type="button" role="checkbox" aria-checked="false" aria-label="同意育人帮用户协议与隐私政策"><i></i></button>
        <span>已阅读并同意<a class="lg-doc" data-doc="terms" href="javascript:;">《育人帮用户协议》</a>和<a class="lg-doc" data-doc="privacy" href="javascript:;">《隐私政策》</a></span>
      </div>
      <div class="lg-err" id="lgErr"></div>
      <button class="lg-btn" id="lgSubmit" type="button">登录 / 注册</button>
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
    closeLgDoc();
    /* 用户读完协议点确认 → 自动帮其勾上，减少一步操作（仍为用户主动点击行为） */
    const c=$("#lgCk");if(c&&!c.classList.contains("on"))c.click();
  });
  $("#lgSend").addEventListener("click",sendPhoneCode);
  $("#lgSubmit").addEventListener("click",submitPhoneLogin);
  $("#lgWx").addEventListener("click",wechatLogin);
  $("#lgX").addEventListener("click",()=>closeLogin(false));
  $("#loginMask").addEventListener("click",()=>closeLogin(false));
  const ux=$("#upX");
  if(ux)ux.addEventListener("click",()=>{hideProgress();toast("已关闭提示，正在后台上传，稍后自动保存到云端");});
}
function openLogin(){
  ensureShell();
  $("#loginSheet").classList.add("open");
  $("#loginMask").classList.add("open");
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
    <p class="d-h">七、服务变更与终止</p><p>1. 平台可能根据运营需要调整功能、暂停或终止部分服务，重大变更将提前公告。<br>2. 你可以随时在「设置—账号与安全」中申请注销账号；注销后相关数据将按隐私政策处理或删除。</p>
    <p class="d-h">八、免责声明</p><p>1. 本社区的内容由用户自行发布，平台不保证其真实性与准确性，请自行辨别、谨慎决断。<br>2. 社区互助不能代替医疗、心理、法律等专业救助。遇到紧急情况，请第一时间拨打 110 / 120 或联系专业机构。<br>3. 因网络故障、不可抗力等导致服务中断，平台不承担赔偿责任，但会尽力恢复。</p>
    <p class="d-h">九、协议更新与法律适用</p><p>1. 本协议更新后将在平台内公示，继续使用即视为接受更新后的协议。<br>2. 本协议适用中华人民共和国法律。争议先行协商，协商不成可向平台运营方所在地人民法院提起诉讼。</p>
    <p class="d-h">十、联系我们</p><p>如有疑问或投诉，可通过「我的—设置—反馈与帮助」提交，或发送邮件至 support@yurenbang.example（演示地址），我们将在 15 个工作日内回复。</p>
    <p class="d-note">本协议为互动原型版本，正式上线前将由法务复核后发布。</p>`},
  privacy:{t:"育人帮隐私政策",tag:"v1.0",html:`
    <p class="d-h">引言</p><p>我们深知个人信息对您的重要性。本政策说明我们在你使用育人帮时如何收集、使用、存储和保护你的个人信息，以及你可以如何管理自己的信息。我们遵循《个人信息保护法》《网络安全法》《未成年人保护法》等法律法规，坚持最小必要原则。</p>
    <p class="d-h">一、我们收集哪些信息</p><p>1. <b>手机号</b>：仅用于登录验证与账号找回，不做营销外呼。<br>2. <b>微信标识</b>：当你选择微信一键登录时，我们仅获取微信返回的唯一标识用于创建账号。<br>3. <b>你主动发布的内容</b>：求助文字、图片、微视频、语音，以及帮忙评论。<br>4. <b>拍摄与录音权限</b>：仅在你主动点击「拍摄 / 录音」时调用，用于生成求助素材。<br>5. <b>粗略位置</b>：用于展示「同城可见」与就近互助，默认仅精确到城市，不上传定位原图。<br>6. <b>设备与日志信息</b>：设备类型、系统版本、浏览器标识、错误日志，用于兼容性优化与安全防护。</p>
    <p class="d-h">二、我们如何使用这些信息</p><p>1. 完成账号注册、登录与身份验证；<br>2. 展示、存储你发布的求助与帮忙内容；<br>3. 对内容进行安全审核，识别并拦截违法违规与侵害未成年人的信息；<br>4. 计算帮忙积分、玫瑰与职级成长；<br>5. 处理你的反馈、投诉与账号注销请求。</p>
    <p class="d-h">三、信息的共享与对外提供</p><p>我们不会出售你的个人信息。以下情形会与第三方共享必要信息：<br>1. <b>云服务托管方</b>：存储账号与发布内容（加密传输）；<br>2. <b>短信服务商</b>：下发登录验证码，仅提供手机号；<br>3. <b>微信开放平台</b>：在你选择微信登录时完成授权；<br>4. <b>法定情形</b>：根据法律法规或主管部门的强制性要求提供。</p>
    <p class="d-h">四、信息的存储与保存期限</p><p>你的信息存储于中国境内的服务器。账号存续期间我们会持续保存必要信息；账号注销后，我们将在 15 个工作日内删除或匿名化处理，法律法规另有规定的除外。</p>
    <p class="d-h">五、我们如何保护信息</p><p>我们采用传输加密（HTTPS）、访问权限分级、数据库行级权限控制等措施保护信息安全。但请理解，任何技术手段都无法保证百分之百的安全，请妥善保管你的账号。</p>
    <p class="d-h">六、你的权利</p><p>你可以随时：<br>1. 在「我的」中查看、更正自己发布的求助与帮忙内容；<br>2. 删除自己发布的内容、清空浏览历史与收藏；<br>3. 通过「设置—账号与安全」注销账号；<br>4. 撤回位置、相机、麦克风等系统权限授权（在手机系统设置中关闭即可，关闭后相关功能将不可用）；<br>5. 通过「反馈与帮助」提出查阅、复制、更正、删除个人信息的请求。</p>
    <p class="d-h">七、未成年人信息保护</p><p>1. 我们高度重视未成年人个人信息保护。涉及未成年人的求助，请务必隐去真实姓名、学校、班级、住址等可识别信息；<br>2. 未满 14 周岁的未成年人使用本平台，须由监护人代为注册并全程陪同；<br>3. 若我们发现未经监护人同意收集了未成年人个人信息，将立即删除。</p>
    <p class="d-h">八、本地存储说明</p><p>为提升使用体验，我们会在你的设备本地（localStorage）保存登录状态、浏览历史、收藏、积分职级等数据。你可以通过浏览器的清除数据功能或在应用内「清空浏览历史」来删除这些本地记录。</p>
    <p class="d-h">九、政策更新与联系我们</p><p>本政策更新后将在平台内公示。如对本政策有任何疑问、意见或投诉，可通过「我的—设置—反馈与帮助」联系我们，我们将在 15 个工作日内答复。</p>
    <p class="d-note">本政策为互动原型版本，正式上线前将由法务复核后发布。</p>`}
};
function openLgDoc(k){
  const d=LG_DOCS[k]||LG_DOCS.terms;
  const t=$("#lgDocTitle"),tag=$("#lgDocTag"),b=$("#lgDocBody"),p=$("#lgDoc");
  if(!p)return;
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
    /* 保存本次挑战，提交时复用，不再重复发送 */
    pendingOtp={phone,verificationId:sent.data.verificationId,isExistingUser:sent.data.isExistingUser};
    let left=60;btn.textContent=`${left}s 后重发`;
    clearInterval(sendTimer);
    sendTimer=setInterval(()=>{
      left--;if(left<=0){clearInterval(sendTimer);btn.disabled=false;btn.textContent="重新获取";return;}
      btn.textContent=`${left}s 后重发`;
    },1000);
    $("#lgErr").textContent="";
    if(window.toast)toast("验证码已发送，请查看短信 📩");
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
  if(!pendingOtp||pendingOtp.phone!==phone){$("#lgErr").textContent="请先获取该手机号的验证码";return;}
  if(!/^\d{4,6}$/.test(code)){$("#lgErr").textContent="请输入收到的短信验证码";return;}
  const btn=$("#lgSubmit");btn.disabled=true;btn.textContent="登录中…";
  try{
    const done=await withTimeout(cloud.auth.verifyOtp({
      phone:pendingOtp.phone,verificationId:pendingOtp.verificationId,
      isExistingUser:pendingOtp.isExistingUser,token:code
    }),20000,"登录校验");
    if(!done||done.error){$("#lgErr").textContent=errMsg(done&&done.error);return;}
    pendingOtp=null;
    await refreshSession();
    $("#lgCode").value="";
    closeLogin(true);
    onAuthChanged();
    if(window.toast)toast("登录成功，现在可以发布求助并上传素材了 ✅");
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

/* ---------- 存储：签名与上传 ---------- */
async function signPaths(paths){
  const map={};
  if(!session||!cloud||!paths||!paths.length)return map;
  const uniq=[...new Set(paths.filter(Boolean))];
  if(!uniq.length)return map;
  try{
    if(typeof cloud.storage.createSignedUrls==="function"){
      const r=await withTimeout(cloud.storage.createSignedUrls(uniq,3600),12000,"获取图片地址");
      const arr=r&&r.data;
      if(Array.isArray(arr))arr.forEach((x,i)=>{
        const p=x&&(x.path||x.name||uniq[i]);
        const u=x&&(x.signedUrl||x.signed_url||x.url);
        if(p&&u)map[p]=u;
      });
    }
  }catch(e){}
  for(const p of uniq.filter(k=>!map[k])){
    try{
      const r=await withTimeout(cloud.storage.createSignedUrl(p,3600),12000,"获取图片地址");
      const d=r&&r.data,u=d&&(d.signedUrl||d.signed_url||d.url);
      if(u)map[p]=u;
    }catch(e){}
  }
  return map;
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
    }catch(e){throw new Error(errMsg(e));}
    if(res&&res.error)throw new Error(errMsg(res.error));
    out.push({kind:it.kind,path,dur:it.dur||"",url:URL.createObjectURL(it.blob)});
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
      media:media.map(m=>({kind:m.kind,path:m.path,dur:m.dur}))
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
    const paths=[];rows.forEach(x=>(x.media||[]).forEach(m=>m&&m.path&&paths.push(m.path)));
    const um=await signPaths(paths);
    post.comments=rows.map(x=>({
      user:x.owner_name||"家长",flag:x.owner_flag||"",ava:"animal",
      text:x.body||"",kind:x.kind||"text",dur:x.dur||"",
      media:(x.media||[]).map(m=>Object.assign({},m,{url:um[m.path]||""})),
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
  }catch(e){return {ok:false,message:errMsg(e)};}
}

/* ---------- 云端求助加载与渲染 ---------- */
async function loadCloudPosts(){
  if(!cloud||!ready)return;
  try{
    const r=await withTimeout(cloud.database.from("yb_posts")
      .select("*").order("created_at",{ascending:false}).limit(50),20000,"加载云端求助");
    if(r&&r.error)return;
    /* 管理后台下架的内容不再进入信息流（后台自身仍可查看并恢复） */
    const rows=((r&&r.data)||[]).filter(x=>!x.hidden);
    const paths=[];rows.forEach(x=>(x.media||[]).forEach(m=>m&&m.path&&paths.push(m.path)));
    const um=await signPaths(paths);
    cloudPosts=rows.map(x=>{
      const media=(x.media||[]).map(m=>Object.assign({},m,{url:um[m.path]||""}));
      return {
        id:100000+Number(x.id),cloudId:x.id,__cloud:true,
        mine:!!(session&&x.owner_id===session.user.id),
        user:x.owner_name||"家长",flag:x.owner_flag||"",ava:"animal",
        type:x.type||"img",media,title:x.title||"",text:x.body||"",
        tag:x.tag||"求助",tagFull:x.tag||"求助",age:x.age||"",
        urg:x.urg||1,vis:x.vis||0,loc:x.loc||"",time:relTime(x.created_at),
        likes:x.likes||0,liked:false,favs:0,faved:false,helps:x.helps||0,
        comments:[],roses:[],r23Status:"open"
      };
    });
    mergeCloudPosts();
  }catch(e){}
}
function mergeCloudPosts(){
  if(typeof S==="undefined")return;
  S.posts=S.posts.filter(p=>!p.__cloud);
  S.posts=[...cloudPosts,...S.posts];
  if(typeof renderFuncRow==="function")renderFuncRow();
  if(typeof renderFeed==="function")renderFeed();
}

/* ---------- 我的页面：账号信息 ---------- */
function renderAccount(){
  const menu=$("#meMenu");if(!menu)return;
  const nameEl=$(".me-n");
  if(nameEl){
    const want=session?myName():"阳阳爸爸";
    const first=nameEl.childNodes[0];
    if(first&&first.nodeType===3&&first.nodeValue.trim()!==want)first.nodeValue=want+" ";
  }
  const idEl=$(".me-id");
  if(idEl&&session){
    const want="育人帮号："+String((session.user&&session.user.id)||"").slice(-8);
    if(idEl.dataset.clId!==want){
      idEl.dataset.clId=want;
      idEl.innerHTML=`<span>${esc(want)}</span><span class="chip">已实名</span>`;
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
      session=null;cloudPosts=[];
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
      if(!r.ok&&window.toast)toast("云端保存失败，仅本机可见："+(r.message||""));
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
  const res=await withTimeout(cloud.storage.upload(path,item.blob,{
    contentType:(item.blob&&item.blob.type)||mimeOf(item.kind,ext),upsert:false
  }),60000,"上传帮忙素材");
  if(res&&res.error)throw new Error(errMsg(res.error));
  return {kind:item.kind,path,dur:item.dur||""};
}
async function sendCommentMedia(post,item){
  if(!cloud||!session)return {ok:false,reason:"no-session"};
  if(!post||!post.cloudId)return {ok:false,reason:"not-cloud"};
  try{
    const m=await uploadCommentItem(item);
    const r=await withTimeout(cloud.database.from("yb_comments").insert({
      post_id:post.cloudId,body:"",owner_name:myName(),owner_flag:flagOf(),
      kind:item.kind,dur:item.dur||"",media:[{kind:m.kind,path:m.path,dur:m.dur}]
    }),25000,"发表帮忙");
    if(r&&r.error)throw r.error;
    return {ok:true,path:m.path};
  }catch(e){return {ok:false,message:errMsg(e)};}
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
    if(!r.ok&&r.message)toast("云端同步失败，已保存在本机："+r.message);
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
  /* 退出登录（供账号管理 / 管理后台切换账号使用） */
  async signOut(){
    try{await cloud.auth.signOut();}catch(e){}
    session=null;cloudPosts=[];
    try{if(typeof S!=="undefined"&&S&&S.posts)S.posts=S.posts.filter(p=>!p.__cloud);}catch(e){}
    try{if(typeof renderFeed==="function")renderFeed();}catch(e){}
    renderAccount();
    try{window.dispatchEvent(new CustomEvent("yrb-auth",{detail:{signedIn:false,who:null}}));}catch(e){}
  },
  publishPost,
  loadCloudPosts,
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
  /* 自检出口：供排障时验证"超时保护 / 慢网提示 / 弹窗可关闭"是否生效 */
  _debug:{
    withTimeout,showProgress,hideProgress,setProgress,
    state(){return {ready,signedIn:!!session,uploading,hasCloud:!!cloud};}
  }
};
})();
