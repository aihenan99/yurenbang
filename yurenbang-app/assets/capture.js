/* =========================================================
   育人帮 · 真实拍摄采集层
   图片：相机拍照 / 相册多选（真实文件）+ 客户端压缩 + 真实缩略图
   微视频：getUserMedia + MediaRecorder 真实录制（≤20s，含回放/重拍）
   语音：getUserMedia + MediaRecorder 真实录音（≤60s，含试听/重录）
   接口：window.YRB_CAPTURE（供 refine23 的发布面板调用）
   环境不支持时（非安全上下文/无权限）自动给出提示并保留降级路径
   ========================================================= */
(function(){
"use strict";
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const MAX_IMG=9, MAX_VID=20, MAX_VOICE=60;

/* ---------- 状态 ---------- */
const state={
  images:[],          // [{file, url, name}]
  video:null,         // {blob, url, dur}
  voice:null,
  vState:"idle",      // idle | live | recording | done
  vStream:null, vRec:null, vTimer:null, vStart:0,
  aState:"idle",      // idle | recording | done
  aStream:null, aRec:null, aTimer:null, aStart:0,
  help:null,          // {kind,name,title,why,steps[],actions[]} 失败说明卡
  diag:null           // 最近一次环境自检结果
};

/* ---------- 环境能力 ---------- */
function hasGetUserMedia(){
  return !!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia);
}
function hasRecorder(){return typeof window.MediaRecorder!=="undefined";}
/* =========================================================
   环境自诊断：先判断「为什么用不了」，再给出能照做的解决办法
   ========================================================= */
const LIVE_URL="https://yurenbang.app.workbuddy.host/";
function inFrame(){try{return window.self!==window.top;}catch(e){return true;}}
function crossFrame(){                       /* 被嵌在别的网站里（预览框） */
  if(!inFrame())return false;
  try{return !window.top.location.href;}catch(e){return true;}
}
function isHttps(){return /^https:/.test(location.protocol)||/^file:/.test(location.protocol)||/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);}
/* 页面策略是否允许使用摄像头/麦克风（跨域预览框里会被禁止） */
function policyAllows(kind){
  try{
    const fp=document.permissionsPolicy||document.featurePolicy;
    if(fp&&fp.allowsFeature)return fp.allowsFeature(kind==="voice"?"microphone":"camera");
  }catch(e){}
  return true;   /* 判断不了就不吓唬用户 */
}
/* 是否属于「提前就能判断用不了」的情况 */
function blockedReason(kind){
  if(!window.isSecureContext||!isHttps())return "unsafe";
  if(!hasGetUserMedia())return "unsupported";
  if(!policyAllows(kind))return "frame";
  return "";
}
function blockWarn(kind){
  const r=blockedReason(kind);
  const word=kind==="voice"?"麦克风":"摄像头";
  if(r==="frame")return `<div class="cap-warn">⚠️ 当前是在「预览框」里打开，预览框不允许使用${word}。请用下面的按钮在新窗口打开，就能正常${kind==="voice"?"录音":"拍摄"}。
    <button class="cap-warn-btn" data-cap-help="open">🔗 在新窗口打开</button></div>`;
  if(r)return `<div class="cap-warn">⚠️ 当前打开方式不允许网页直接使用${word}，若提示失败，请改用下面的备用方式。</div>`;
  return "";
}
async function permState(name){
  try{
    if(!navigator.permissions||!navigator.permissions.query)return "unknown";
    const st=await navigator.permissions.query({name});
    return st.state||"unknown";             /* granted | denied | prompt | unknown */
  }catch(e){return "unknown";}
}
async function envDiag(){
  const d={
    url:location.href,
    secure:!!window.isSecureContext,
    safeOrigin:isHttps(),
    inFrame:inFrame(),
    crossOrigin:crossFrame(),
    hasMediaDevices:hasGetUserMedia(),
    hasRecorder:hasRecorder(),
    policyCamera:policyAllows("video"),
    policyMic:policyAllows("voice"),
    camera:"unknown",microphone:"unknown",ua:navigator.userAgent
  };
  d.camera=await permState("camera");
  d.microphone=await permState("microphone");
  return d;
}
function diagText(d){
  return ["育人帮·拍摄自检",
    "网址："+d.url,
    "安全上下文："+(d.secure?"是":"否"),
    "地址可用："+(d.safeOrigin?"是":"否（需 https）"),
    "是否被内嵌："+(d.inFrame?(d.crossOrigin?"是（跨域预览框）":"是（同源框）"):"否"),
    "支持拍摄："+(d.hasMediaDevices?"是":"否")+"，支持录制："+(d.hasRecorder?"是":"否"),
    "页面策略允许摄像头："+(d.policyCamera?"是":"否")+"，允许麦克风："+(d.policyMic?"是":"否"),
    "摄像头权限："+d.camera+"，麦克风权限："+d.microphone,
    "浏览器："+d.ua].join("\n");
}
/* 把浏览器报错翻译成老人也能照着做的话 */
function explain(err,kind,d){
  const word=kind==="voice"?"麦克风":"摄像头";
  const name=(err&&err.name)||"";
  const msg=(err&&err.message)||"";
  const base={kind,name,msg,steps:[],actions:[]};
  if(!d.hasMediaDevices||!d.safeOrigin){
    return Object.assign(base,{
      title:"浏览器不允许网页使用"+word,
      why:"现在的网址不是 https 开头（或不是本机地址）。浏览器只允许 https 的网站使用"+word+"。",
      steps:["请用 https 开头的网址打开本应用："+LIVE_URL,"用手机/电脑浏览器直接打开，不要套在别的页面里打开"],
      actions:["open","diag"]});
  }
  if((d.crossOrigin||d[kind==="voice"?"policyMic":"policyCamera"]===false)&&(/permission|policy/i.test(name+msg)||name==="NotAllowedError"||!name)){
    return Object.assign(base,{
      title:"当前是在「预览框」里打开，预览框不允许使用"+word,
      why:"本应用被嵌在另一个页面的方框里，出于安全，浏览器不会把"+word+"交给预览框。",
      steps:["点下面蓝色的「在新窗口打开」","在新窗口里若弹出询问，点「允许」","之后就能正常拍摄/录音了"],
      actions:["open","retry","diag"]});
  }
  if(name==="NotAllowedError"||d[kind==="voice"?"microphone":"camera"]==="denied"){
    return Object.assign(base,{
      title:word+"的权限被拒绝了",
      why:"上一次可能点了「拒绝」，或者系统的隐私开关关闭了"+word+"权限。",
      steps:["苹果手机：设置 → Safari 浏览器 → 相机 / 麦克风 → 选「询问」或「允许」，再刷新页面",
        "安卓手机：点网址左边的小锁 🔒 → 权限 → 相机、麦克风改成「允许」",
        "电脑：点网址左边的小锁 🔒 → 摄像头 / 麦克风 → 允许；还不行就进 Windows「设置 → 隐私和安全性 → 相机 / 麦克风」，把开关都打开",
        "改好后刷新页面，再点一次「重试」"],
      actions:["retry","open","diag"]});
  }
  if(/NotFound/i.test(name)){
    return Object.assign(base,{
      title:"这台设备上没有可用的"+word,
      why:"设备没有"+word+"，或在系统里被禁用了。",
      steps:["电脑请检查摄像头是否插好、是否被系统禁用","也可以改用下面的备用方式继续发布"],
      actions:["retry","diag"]});
  }
  if(/NotReadable|TrackStart|Abort|SourceUnavailable/i.test(name)){
    return Object.assign(base,{
      title:word+"正被其它程序占用",
      why:"有别的软件正在使用"+word+"（例如微信通话、会议软件、录屏、相机）。",
      steps:["请先关掉正在使用"+word+"的软件","等几秒后点「重试」","仍然不行就重启浏览器再试"],
      actions:["retry","diag"]});
  }
  return Object.assign(base,{
    title:"无法打开"+word,
    why:"浏览器报错："+(name||"未知错误")+(msg?"（"+String(msg).slice(0,80)+"）":""),
    steps:["先点「重试」再试一次","仍不行就点「在新窗口打开」，用独立窗口打开本应用","也可以用下面的备用方式继续发布"],
    actions:["retry","open","diag"]});
}
function secureHint(){
  return "当前环境未开放摄像头/麦克风（需 https 或本机访问）";
}
function pickMime(list){
  if(!hasRecorder()||!MediaRecorder.isTypeSupported)return "";
  for(const m of list)if(MediaRecorder.isTypeSupported(m))return m;
  return "";
}
function extOf(mime){
  const m=String(mime||"").toLowerCase();
  if(/webm/.test(m))return "webm";
  if(/mp4|m4v/.test(m))return "mp4";
  if(/mp3|mpeg3|mpeg-layer3/.test(m))return "mp3";
  if(/m4a|mp4a|aac/.test(m))return "m4a";
  if(/wav/.test(m))return "wav";
  if(/ogg|opus/.test(m))return "ogg";
  if(/mov|quicktime/.test(m))return "mov";
  if(/3gpp/.test(m))return "3gp";
  if(/png/.test(m))return "png";
  if(/jpeg|jpg/.test(m))return "jpg";
  return "webm";
}
/* 读取本地媒体文件时长（选视频/录音文件时用） */
function durOf(url,isVideo){
  return new Promise(res=>{
    try{
      const el=document.createElement(isVideo?"video":"audio");
      el.preload="metadata";
      const done=v=>{el.removeAttribute("src");el.load&&el.load();res(v);};
      const tm=setTimeout(()=>done(0),4000);
      el.onloadedmetadata=()=>{clearTimeout(tm);done(isFinite(el.duration)?el.duration:0);};
      el.onerror=()=>{clearTimeout(tm);done(0);};
      el.src=url;
    }catch(e){res(0);}
  });
}
function fmt(sec){const s=Math.max(0,Math.round(sec));return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");}

/* ---------- 图片压缩（真实上传前瘦身，省流量、提成功率） ----------
   2026-10-19：压缩搬到 Worker（OffscreenCanvas），主线程只插缩略图。
   原因：一次选多张手机原图时，旧实现逐张在主线程解码 + 缩放 + 编码，
   9 张能把界面卡住 3~10 秒且毫无反馈，用户会以为死机。
   Worker 不可用（老浏览器 / 脚本加载失败）时自动回退到主线程压缩。 */
async function compress(file,maxSide=1280,quality=.78){
  if(!/^image\//.test(file.type)||/gif|svg/.test(file.type))return file;
  try{
    const bmp=await createImageBitmap(file);
    const scale=Math.min(1,maxSide/Math.max(bmp.width,bmp.height));
    if(scale>=1&&file.size<900*1024)return file;
    const w=Math.max(1,Math.round(bmp.width*scale)),h=Math.max(1,Math.round(bmp.height*scale));
    const cv=document.createElement("canvas");cv.width=w;cv.height=h;
    cv.getContext("2d").drawImage(bmp,0,0,w,h);
    const blob=await new Promise(r=>cv.toBlob(r,"image/jpeg",quality));
    bmp.close&&bmp.close();
    if(!blob)return file;
    return new File([blob],(file.name||"photo").replace(/\.[^.]+$/,"")+".jpg",{type:"image/jpeg"});
  }catch(e){return file;}
}

/* ---------- 压缩 Worker：把解码/编码移出主线程 ---------- */
let imgW=null,imgWId=0,imgWBroken=false;
const imgWPending=new Map();
function imgWorker(){
  if(imgWBroken)return null;
  if(imgW)return imgW;
  try{
    imgW=new Worker("assets/img-worker.js");
    imgW.onmessage=e=>{
      const d=e.data||{},p=imgWPending.get(d.id);
      if(!p)return;
      imgWPending.delete(d.id);
      if(d.ok)p.res(d);else p.rej(new Error(d.message||"压缩失败"));
    };
    imgW.onerror=()=>{
      imgWBroken=true;
      imgWPending.forEach(p=>p.rej(new Error("压缩线程不可用")));
      imgWPending.clear();
      try{imgW.terminate();}catch(e){}
      imgW=null;
    };
    return imgW;
  }catch(e){imgWBroken=true;return null;}
}
/* 优先 Worker；任何异常（含 20 秒无响应）都回退主线程，绝不丢图 */
function compressSmart(file){
  const w=imgWorker();
  if(!w)return compress(file);
  return new Promise((res,rej)=>{
    const id=++imgWId;
    let settled=false;
    const bail=()=>{
      if(settled)return;settled=true;
      compress(file).then(res,rej);
    };
    imgWPending.set(id,{
      res:d=>{
        if(settled)return;settled=true;
        try{
          if(d.passthrough)res(file);
          else res(new File([d.blob],d.name||"photo.jpg",{type:"image/jpeg"}));
        }catch(e){res(file);}
      },
      rej:()=>bail()
    });
    try{w.postMessage({id,file,maxSide:1280,quality:.78});}
    catch(e){imgWPending.delete(id);bail();return;}
    setTimeout(()=>{if(imgWPending.has(id)){imgWPending.delete(id);bail();}},20000);
  });
}
/* 处理进度：直接改提示文字（不重建 DOM，避免额外卡顿） */
function paintImgBusy(done,total){
  const host=$("#r23Picker");if(!host)return;
  const hint=$(".cap-hint",host);if(!hint)return;
  if(done>=total||total<=0){
    hint.innerHTML=`已选 <b>${state.images.length}</b>/${MAX_IMG} 张 · 拍照或从相册选择，上传前自动压缩`;
    return;
  }
  hint.innerHTML=`⏳ 正在压缩第 ${done+1}/${total} 张 · 已完成 ${done} 张，请稍候…`;
}
/* 逐张处理：每完成一张就刷新缩略图 + 让出一帧，用户始终能看到进度 */
async function addImages(list){
  let i=0;
  for(const f of list){
    i++;
    let out=f;
    try{out=await compressSmart(f);}catch(e){out=f;}
    state.images.push({file:out,url:URL.createObjectURL(out),name:out.name||"photo.jpg"});
    refresh();
    paintImgBusy(i,list.length);
    await new Promise(r=>setTimeout(r,16));   /* 让浏览器把这一帧画出来再继续 */
  }
}

/* ---------- 渲染 ---------- */
function render(type){
  if(state.help&&state.help.kind===type)return helpHTML(state.help,type);
  if(type==="img")return imgHTML();
  if(type==="video")return vidHTML();
  return voiceHTML();
}
/* ---------- 失败说明卡（大字、可照做、带兜底） ---------- */
function helpHTML(h,type){
  const word=type==="voice"?"麦克风":"摄像头";
  const acts=h.actions||["retry","open","diag"];
  const btn={
    open:`<button class="cap-help-btn primary" data-cap-help="open">🔗 在新窗口打开</button>`,
    retry:`<button class="cap-help-btn primary" data-cap-help="retry">🔄 重试</button>`,
    diag:`<button class="cap-help-btn ghost" data-cap-help="diag">📋 复制自检信息</button>`
  };
  const extra=type==="video"
    ? `<label class="cap-help-btn fallback"><input type="file" accept="video/*" capture="environment" data-cap-in="video" hidden>📷 用系统相机拍摄
       </label>
       <label class="cap-help-btn fallback"><input type="file" accept="video/*" data-cap-in="video" hidden>🖼️ 从相册选视频
       </label>`
    : `<label class="cap-help-btn fallback"><input type="file" accept="audio/*" data-cap-in="audio" hidden>🎵 选已有的录音文件
       </label>`;
  return `<div class="cap-help" role="alertdialog" aria-label="为什么用不了${word}">
    <div class="cap-help-ic">🔒</div>
    <div class="cap-help-t">${h.title}</div>
    <div class="cap-help-w">${h.why||""}</div>
    ${(h.steps&&h.steps.length)?`<ol class="cap-help-s">${h.steps.map(s=>`<li>${s}</li>`).join("")}</ol>`:""}
    <div class="cap-help-act">${acts.map(a=>btn[a]||"").join("")}</div>
    <div class="cap-help-alt">用不了${word}？可以先用这些方式：</div>
    <div class="cap-help-act">${extra}
      <button class="cap-help-btn ghost" data-cap-help="close">↩︎ 返回</button></div>
    <div class="cap-help-note" data-cap-diag="${(state.diag&&diagText(state.diag).replace(/"/g,"'").replace(/\n/g,"｜"))||""}"></div>
  </div>`;
}
function imgHTML(){
  const cells=state.images.map((im,i)=>`
    <div class="cap-cell"><img src="${im.url}" alt="已选图片${i+1}">
      <button class="cap-rm" data-cap-rm="${i}" aria-label="删除第${i+1}张">✕</button>
      <span class="cap-n">图${i+1}</span></div>`).join("");
  const slots=[];
  if(state.images.length<MAX_IMG){
    slots.push(`<label class="cap-add"><input type="file" accept="image/*" capture="environment" data-cap-in="shot" hidden>
      <span class="pl">📷</span><span class="ps">拍照</span></label>`);
    slots.push(`<label class="cap-add"><input type="file" accept="image/*" multiple data-cap-in="album" hidden>
      <span class="pl">🖼️</span><span class="ps">相册</span></label>`);
  }
  return `<div class="cap-imgs">
    <div class="cap-grid">${cells}${slots.join("")}</div>
    <div class="cap-hint">已选 <b>${state.images.length}</b>/${MAX_IMG} 张 · 拍照或从相册选择，上传前自动压缩</div>
  </div>`;
}
function vidHTML(){
  const s=state.vState;
  if(s==="idle"){
    const warn=blockWarn("video");
    return `<div class="cap-rec idle">
      <div class="cap-stage"><span class="cap-ph">🎥</span>
        <div class="cap-tip">点下面按钮现场拍摄，最长 <b>20 秒</b></div></div>
      ${warn}
      <button class="cap-big" data-cap-vid="start">🎥 开始拍摄</button>
      <div class="cap-alt-row">
        <label class="cap-alt"><input type="file" accept="video/*" capture="environment" data-cap-in="video" hidden>📷 用系统相机拍</label>
        <label class="cap-alt"><input type="file" accept="video/*" data-cap-in="video" hidden>🖼️ 从相册选视频</label>
      </div>
      <div class="cap-hint">系统相机拍摄不需要网页权限，任何手机都能用</div>
    </div>`;
  }
  if(s==="live"||s==="recording"){
    const rec=s==="recording";
    return `<div class="cap-rec ${rec?"recording":""}">
      <div class="cap-stage"><video class="cap-preview" autoplay muted playsinline></video>
        ${rec?'<span class="cap-recflag"><i></i>REC</span>':""}
        <span class="cap-clock" data-cap-clock>${rec?"00:00":"准备中"}</span></div>
      <button class="cap-big ${rec?"stop":""}" data-cap-vid="${rec?"stop":"rec"}">${rec?"■ 停止录制":"● 开始录制"}</button>
      <div class="cap-hint">${rec?"正在录制，到 20 秒会自动停止":"画面正常后点「开始录制」"}</div>
    </div>`;
  }
  const d=state.video?fmt(state.video.dur):"00:03";
  return `<div class="cap-rec done">
    <div class="cap-stage"><video class="cap-preview" src="${state.video?state.video.url:""}" controls playsinline></video>
      <span class="cap-clock">已录制 ${d}</span></div>
    <div class="cap-row">
      <button class="btn-g cap-retake" data-cap-vid="retake">重拍</button>
      <button class="btn-a cap-use" data-cap-vid="use">使用这段视频</button></div>
  </div>`;
}
function voiceHTML(){
  const s=state.aState;
  if(s==="idle"){
    const warn=blockWarn("voice");
    return `<div class="cap-voice">
      ${warn}
      <button class="cap-vmic" data-cap-aud="start">🎤</button>
      <div class="cap-bars">${bars(34)}</div>
      <div class="cap-hint">点大话筒开始录音，最长 <b>60 秒</b>；录完可以试听</div>
      <label class="cap-alt"><input type="file" accept="audio/*" data-cap-in="audio" hidden>🎵 或选已有的录音文件</label>
    </div>`;
  }
  if(s==="recording"){
    return `<div class="cap-voice rec">
      <button class="cap-vmic on" data-cap-aud="stop">■</button>
      <div class="cap-bars live">${bars(34)}</div>
      <div class="cap-clock" data-cap-aclock>00:00</div>
      <div class="cap-hint">正在录音，说完再点一次结束</div></div>`;
  }
  return `<div class="cap-voice done">
    <div class="cap-vrow"><span class="cap-vicon">🎙️</span>
      <audio src="${state.voice?state.voice.url:""}" controls playsinline></audio></div>
    <div class="cap-row">
      <button class="btn-g cap-revoice" data-cap-aud="retake">重录</button>
      <button class="btn-a cap-use" data-cap-aud="use">使用这段语音</button></div>
    <div class="cap-hint">录音时长 ${state.voice?fmt(state.voice.dur):"00:00"}</div></div>`;
}
function bars(n){let s="";for(let i=0;i<n;i++)s+=`<i style="height:${16+Math.round(Math.abs(Math.sin(i*1.6))*78)}%;animation-delay:${(i%9)*.07}s"></i>`;return s;}

/* ---------- 绑定 ---------- */
function bind(host){
  /* 失败说明卡上的按钮 */
  $$("[data-cap-help]",host).forEach(b=>b.addEventListener("click",e=>{
    e.preventDefault();e.stopPropagation();helpAct(b.dataset.capHelp,b);
  }));
  /* 文件选择（拍照 / 相册 / 系统相机 / 视频 / 录音文件） */
  $$("[data-cap-in]",host).forEach(inp=>{
    inp.addEventListener("change",async()=>{
      const files=[...(inp.files||[])];inp.value="";if(!files.length)return;
      const mode=inp.dataset.capIn;
      if(mode==="video"){
        const f=files[0],url=URL.createObjectURL(f);
        const d=await durOf(url,true);
        if(!d){URL.revokeObjectURL(url);toast("这个文件不是可播放的视频，请换一个");return;}
        /* 免费额度专项（2026-10-26）：相册原片常 20-30MB，几十次播放就能吃掉大块流量额度。
           现场录制走 854×480 / 0.8Mbps，20 秒约 2MB，所以优先引导现场录。 */
        if(d>21){URL.revokeObjectURL(url);toast(`这段视频 ${Math.round(d)} 秒，超过 20 秒了，请剪短一点再传`);return;}
        if(f.size>8*1024*1024){URL.revokeObjectURL(url);toast(`这段视频 ${(f.size/1048576).toFixed(1)}MB，太大了。建议点「录视频」现场录一段`);return;}
        if(state.video)URL.revokeObjectURL(state.video.url);
        state.video={blob:f,url,dur:Math.min(MAX_VID,d||1),ext:extOf(f.type)||"mp4"};
        state.vState="done";state.help=null;refresh();
        toast("视频已选好（"+fmt(state.video.dur)+"），可直接上传 🎬");return;
      }
      if(mode==="audio"){
        const f=files[0],url=URL.createObjectURL(f);
        const d=await durOf(url,false);
        if(state.voice)URL.revokeObjectURL(state.voice.url);
        if(!d){URL.revokeObjectURL(url);toast("这个文件不是可播放的音频，请换一个");return;}
        state.voice={blob:f,url,dur:Math.min(MAX_VOICE,d),ext:extOf(f.type)};
        state.aState="done";state.help=null;refresh();
        toast("录音已选好（"+fmt(state.voice.dur)+"），可试听后上传 🎙️");return;
      }
      const room=MAX_IMG-state.images.length;
      const take=files.slice(0,room);
      if(files.length>room)toast(`最多 ${MAX_IMG} 张，已为您保留前 ${room} 张`);
      if(!take.length)return;
      await addImages(take);      /* 逐张压缩 + 逐张出缩略图（不再一次性卡住） */
      toast(`已添加 ${take.length} 张图片`);
    });
  });
  $$("[data-cap-rm]",host).forEach(b=>b.addEventListener("click",e=>{
    e.preventDefault();e.stopPropagation();
    const i=+b.dataset.capRm,im=state.images[i];
    if(im){URL.revokeObjectURL(im.url);state.images.splice(i,1);}
    refresh();
  }));
  /* 视频 */
  $$("[data-cap-vid]",host).forEach(b=>b.addEventListener("click",()=>videoAct(b.dataset.capVid)));
  /* 语音 */
  $$("[data-cap-aud]",host).forEach(b=>b.addEventListener("click",()=>voiceAct(b.dataset.capAud)));
  if(state.vState==="live"&&state.vStream){
    const v=$(".cap-preview",host);
    if(v&&!v.srcObject)v.srcObject=state.vStream;
  }
}
/* 当前媒体类型（S 为全局词法绑定，不在 window 上，必须用 typeof 安全读取） */
function curType(){try{return (typeof S!=="undefined"&&S&&S.pubType)||"img";}catch(e){return "img";}}

/* 停掉容器内所有正在播放/待播放的视频与音频，并清空 src。
   关键：手机浏览器的"视频接管小窗"只认播放中的媒体元素——
   暂停 + 移除 src + load() 三连后，小窗会立即收起，不会残留在其他界面上 */
function stopMediaIn(root){
  try{
    (root||document).querySelectorAll("video,audio").forEach(m=>{
      try{m.pause();}catch(e){}
      try{m.removeAttribute("src");m.removeAttribute("srcObject");m.load();}catch(e){}
    });
  }catch(e){}
}

/* 通用挂载：把采集界面渲染到任意容器上（发布面板默认用 #r23Picker，帮忙面板用评论面板内的容器）
   —— 让「录音/录像」同一套实现被两处复用，避免出现只有样子没功能的按钮 */
let mountCtx=null;                 /* {host, type, onDone} */
function paintMount(){
  if(!mountCtx)return;
  const host=mountCtx.host;
  if(!host||!host.isConnected){mountCtx=null;return;}
  stopMediaIn(host);               /* 重绘前停播，避免浏览器小窗残留 */
  host.innerHTML=render(mountCtx.type);
  bind(host);
}
function doneMount(type){
  if(!mountCtx||typeof mountCtx.onDone!=="function")return;
  const cb=mountCtx.onDone;
  setTimeout(()=>{try{cb(type);}catch(e){console.warn("[育人帮] 采集完成回调异常",e);}},0);
}
function refresh(){
  if(mountCtx){paintMount();return;}
  const host=$("#r23Picker");
  if(host&&window.YRB_CAPTURE){
    stopMediaIn(host);             /* 重绘前停播，避免浏览器小窗残留 */
    host.innerHTML=window.YRB_CAPTURE.render(curType());
    bind(host);
  }
}

/* ---------- 对外/内部：失败处理 ---------- */
async function fail(kind,err){
  state.diag=await envDiag();
  const h=explain(err,kind,state.diag);
  state.help=h;
  if(kind==="video"){state.vState="idle";stopVideoStream();}else{state.aState="idle";stopAudioStream();}
  refresh();
  try{console.warn("[育人帮] 摄像头/麦克风不可用 →",h.title,"|",h.name,h.msg,"|",state.diag);}catch(e){}
}
async function helpAct(a){
  if(a==="open"){
    let ok=false;
    try{ok=!!window.open(LIVE_URL,"_blank","noopener");}catch(e){ok=false;}
    if(!ok){
      try{await navigator.clipboard.writeText(LIVE_URL);toast("弹窗被拦截，网址已复制，请粘贴到浏览器打开");}
      catch(e){toast("请在浏览器地址栏打开："+LIVE_URL);}
    }else toast("已在新窗口打开，若弹出询问请点「允许」");
    return;
  }
  if(a==="retry"){
    const kind=(state.help&&state.help.kind)||"video";
    state.help=null;refresh();
    await new Promise(r=>setTimeout(r,150));      /* 让浏览器先释放上一次的拒绝状态 */
    if(kind==="voice")voiceAct("start");else videoAct("start");
    return;
  }
  if(a==="diag"){
    const t=diagText(state.diag||await envDiag());
    try{await navigator.clipboard.writeText(t);toast("自检信息已复制 📋 可直接发给我");}
    catch(e){toast("自检信息："+t.replace(/\n/g,"；"));}
    return;
  }
  if(a==="close"){state.help=null;refresh();}
}
/* 逐级降级申请（摄像头参数不支持时自动换更简单的请求） */
async function openStream(kind){
  const tries=kind==="video"?[
    /* 854×480 + 0.8Mbps：20 秒约 2MB（720p 原码率约 6-10MB）。
       免费额度按流量折算，视频是最容易烧穿额度的一项（2026-10-26 免费额度专项） */
    {video:{facingMode:{ideal:"environment"},width:{ideal:854},height:{ideal:480}},audio:true},
    {video:{facingMode:{ideal:"environment"}},audio:true},
    {video:true,audio:true},
    {video:true}
  ]:[
    {audio:{echoCancellation:true,noiseSuppression:true}},
    {audio:true}
  ];
  let last=null;
  for(const c of tries){
    try{return await navigator.mediaDevices.getUserMedia(c);}
    catch(e){
      last=e;
      /* 权限/设备/占用类错误换参数也没用，直接给用户可照做的说明 */
      if(/NotAllowed|NotFound|NotReadable|TrackStart|Security|Abort|SourceUnavailable/i.test(e&&e.name||""))break;
    }
  }
  throw last||new Error("getUserMedia failed");
}

/* ---------- 视频录制 ---------- */
async function videoAct(act){
  if(act==="start"){
    if(!hasGetUserMedia()){await fail("video",{name:"NotSupportedError",message:"浏览器未提供拍摄接口"});return;}
    try{
      state.vStream=await openStream("video");
      state.help=null;state.vState="live";refresh();
      toast("摄像头已开启，点「开始录制」");
    }catch(err){
      await fail("video",err);
    }
    return;
  }
  if(act==="rec"){
    if(!state.vStream){toast("摄像头未就绪，请重新打开");state.vState="idle";refresh();return;}
    const mime=pickMime(["video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm","video/mp4"]);
    let rec;
    try{rec=new MediaRecorder(state.vStream,Object.assign(mime?{mimeType:mime}:{},{videoBitsPerSecond:800000}));}
    catch(e){toast("当前浏览器不支持视频录制，可用相册选择视频");stopVideoStream();state.vState="idle";refresh();return;}
    const chunks=[];
    rec.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data);};
    rec.onstop=()=>{
      clearInterval(state.vTimer);state.vTimer=null;
      stopVideoStream();
      const blob=new Blob(chunks,{type:rec.mimeType||"video/webm"});
      const dur=(performance.now()-state.vStart)/1000;
      state.video={blob,url:URL.createObjectURL(blob),dur:Math.max(1,Math.min(MAX_VID,dur)),ext:extOf(rec.mimeType||"video/webm")};
      state.vState="done";refresh();toast("拍摄完成，可预览、重拍或使用 ✅");
    };
    state.vRec=rec;state.vState="recording";state.vStart=performance.now();
    try{rec.start(200);}catch(e){toast("录制启动失败");stopVideoStream();state.vState="idle";refresh();return;}
    refresh();
    state.vTimer=setInterval(()=>{
      const el=$("[data-cap-clock]");const el2=$("[data-cap-clock]");
      const t=(performance.now()-state.vStart)/1000;
      const node=el||el2;if(node)node.textContent=fmt(t);
      if(t>=MAX_VID)stopVideo();
    },200);
    return;
  }
  if(act==="stop"){stopVideo();return;}
  if(act==="retake"){if(state.video)URL.revokeObjectURL(state.video.url);state.video=null;state.vState="idle";state.help=null;refresh();return;}
  if(act==="use"){
    if(!state.video){toast("还没有拍好的视频");return;}
    if(mountCtx){doneMount("video");return;}   /* 帮忙面板：交给调用方发送 */
    toast("视频已加入素材 🎬");
  }
}
function stopVideo(){
  if(state.vRec&&state.vRec.state!=="inactive"){try{state.vRec.stop();}catch(e){}}
  else{clearInterval(state.vTimer);state.vTimer=null;stopVideoStream();state.vState=state.video?"done":"idle";refresh();}
}
function stopVideoStream(){
  if(state.vStream){state.vStream.getTracks().forEach(t=>t.stop());state.vStream=null;state.vRec=null;}
}

/* ---------- 语音录制 ---------- */
async function voiceAct(act){
  if(act==="start"){
    if(!hasGetUserMedia()){await fail("voice",{name:"NotSupportedError",message:"浏览器未提供录音接口"});return;}
    try{
      state.aStream=await openStream("voice");
      state.help=null;
    }catch(err){await fail("voice",err);return;}
    const mime=pickMime(["audio/webm;codecs=opus","audio/webm","audio/mp4","audio/ogg"]);
    let rec;
    /* 32kbps 单声道足够听清人声，60 秒约 240KB（默认码率约 1MB，省 3/4 额度） */
    try{rec=new MediaRecorder(state.aStream,Object.assign(mime?{mimeType:mime}:{},{audioBitsPerSecond:32000}));}
    catch(e){toast("当前浏览器不支持录音");stopAudioStream();return;}
    const chunks=[];
    rec.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data);};
    rec.onstop=()=>{
      clearInterval(state.aTimer);state.aTimer=null;stopAudioStream();
      const blob=new Blob(chunks,{type:rec.mimeType||"audio/webm"});
      const dur=(performance.now()-state.aStart)/1000;
      if(dur<0.4){state.aState="idle";refresh();toast("录音太短，请重新录制");return;}
      state.voice={blob,url:URL.createObjectURL(blob),dur:Math.max(1,Math.min(MAX_VOICE,dur)),ext:extOf(rec.mimeType||"audio/webm")};
      state.aState="done";refresh();toast("录音完成，可试听或重录 ✅");
    };
    state.aRec=rec;state.aState="recording";state.aStart=performance.now();
    try{rec.start(200);}catch(e){toast("录音启动失败");stopAudioStream();state.aState="idle";refresh();return;}
    refresh();
    state.aTimer=setInterval(()=>{
      const t=(performance.now()-state.aStart)/1000;
      const node=$("[data-cap-aclock]");if(node)node.textContent=fmt(t);
      if(t>=MAX_VOICE)voiceAct("stop");
    },200);
    return;
  }
  if(act==="stop"){
    if(state.aRec&&state.aRec.state!=="inactive"){try{state.aRec.stop();}catch(e){}}
    else{clearInterval(state.aTimer);state.aTimer=null;stopAudioStream();state.aState="idle";refresh();}
    return;
  }
  if(act==="retake"){if(state.voice)URL.revokeObjectURL(state.voice.url);state.voice=null;state.aState="idle";state.help=null;refresh();return;}
  if(act==="use"){
    if(!state.voice){toast("还没有录好的语音");return;}
    if(mountCtx){doneMount("voice");return;}   /* 帮忙面板：交给调用方发送 */
    toast("语音已加入素材 🎙️");
  }
}
function stopAudioStream(){
  if(state.aStream){state.aStream.getTracks().forEach(t=>t.stop());state.aStream=null;state.aRec=null;}
}

/* ---------- 对外接口 ---------- */
window.YRB_CAPTURE={
  render,bind,
  /* 图片压缩出口（Worker 优先、失败回退主线程）：案例广场上传等复用 */
  compress:compressSmart,
  /* 把采集面板挂到任意容器（帮忙面板复用发布面板的同一套录音/录像实现） */
  mount(host,type,onDone){
    if(!host)return;
    if(state.video){URL.revokeObjectURL(state.video.url);state.video=null;}
    if(state.voice){URL.revokeObjectURL(state.voice.url);state.voice=null;}
    state.vState="idle";state.aState="idle";state.help=null;
    mountCtx={host,type,onDone:onDone||null};
    paintMount();
  },
  unmount(){mountCtx=null;},
  validate(type){
    if(type==="img"&&state.images.length===0)return "请至少拍 1 张照片或从相册选择图片";
    if(type==="video"&&!(state.video&&state.vState==="done"))return "请先完成微视频拍摄";
    if(type==="voice"&&!(state.voice&&state.aState==="done"))return "请先完成语音录制";
    return null;
  },
  collect(type){
    if(type==="img"){
      return state.images.map(im=>({kind:"image",blob:im.file,name:im.name}));
    }
    if(type==="video"&&state.video){
      return [{kind:"video",blob:state.video.blob,dur:fmt(state.video.dur),ext:state.video.ext||"webm"}];
    }
    if(type==="voice"&&state.voice){
      return [{kind:"voice",blob:state.voice.blob,dur:fmt(state.voice.dur),ext:state.voice.ext||"webm"}];
    }
    return [];
  },
  duration(type){
    if(type==="video"&&state.video)return fmt(state.video.dur);
    if(type==="voice"&&state.voice)return fmt(state.voice.dur);
    return "";
  },
  count(){return state.images.length;},
  hasAnything(){return state.images.length>0||!!state.video||!!state.voice;},
  live(){return hasGetUserMedia()&&hasRecorder()&&isHttps();},
  diag:envDiag,
  help:()=>state.help,
  liveURL:LIVE_URL,
  clearHelp(){state.help=null;refresh();},
  /* 停掉指定容器（默认全局）内所有视频/音频播放并清空 src —— 供发布面板在切换类型/关闭时调用 */
  stopMedia(root){stopMediaIn(root);},
  stopAll(){
    clearInterval(state.vTimer);clearInterval(state.aTimer);
    state.vTimer=state.aTimer=null;
    try{if(state.vRec&&state.vRec.state!=="inactive")state.vRec.stop();}catch(e){}
    try{if(state.aRec&&state.aRec.state!=="inactive")state.aRec.stop();}catch(e){}
    stopVideoStream();stopAudioStream();
    if(state.vState==="recording"||state.vState==="live")state.vState=state.video?"done":"idle";
    if(state.aState==="recording")state.aState=state.voice?"done":"idle";
  },
  /* 重置素材。noPaint=true 时不立即重绘（发布面板打开瞬间由调用方统一渲染一次，
     避免 reset 内部 refresh + 外层 renderPicker 各渲染一遍造成的闪烁与无谓开销） */
  reset(noPaint){
    mountCtx=null;                 /* 先解除挂载，避免刷新到已关闭的容器 */
    window.YRB_CAPTURE.stopAll();
    state.images.forEach(im=>URL.revokeObjectURL(im.url));state.images=[];
    if(state.video)URL.revokeObjectURL(state.video.url);state.video=null;
    if(state.voice)URL.revokeObjectURL(state.voice.url);state.voice=null;
    state.vState="idle";state.aState="idle";state.help=null;
    if(!noPaint)refresh();
  }
};
})();
