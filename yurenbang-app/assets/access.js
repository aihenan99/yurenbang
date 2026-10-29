/* =========================================================
   育人帮 · 适老化 / 无障碍 / 便利性 / 科学性 增强层
   依赖：app.js（S/UID/esc/toast/banner/modal/enterApp 等全局绑定）
   策略：只向既有容器注入节点 + 事件委托，不破坏既有结构
   ========================================================= */
(function(){
"use strict";
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];

/* ============ 1. 状态持久化（可行性：刷新不丢数据） ============ */
const KEY="yrb_state_v1";
let saveTm=null;
function save(){
  try{
    localStorage.setItem(KEY,JSON.stringify({
      elder:S.elder,fs:S.fs,theme:S.theme,myEffect:S.myEffect,roses:S.roses,
      /* 浏览历史 / 收藏：跨会话保留（只存 id 轻量字段，云端帖不落库） */
      history:(S.history||[]).filter(h=>h&&h.id!=null).slice(0,60),
      favIds:(S.posts||[]).filter(p=>p&&p.faved).map(p=>p.id),
      /* 云端帖子不入本地库：由 loadCloudPosts 统一恢复，避免刷新后出现重复卡片 */
      myPosts:S.posts.filter(p=>p.mine&&!p.__cloud)
    }));
  }catch(e){}
}
function scheduleSave(){clearTimeout(saveTm);saveTm=setTimeout(save,600);}
window.__yrbSave=save;   /* 供增强层（浏览历史 / 收藏）立即落盘，避免等待防抖 */
function load(){
  try{
    const d=JSON.parse(localStorage.getItem(KEY)||"null");if(!d)return;
    ["elder","fs","theme","myEffect","roses"].forEach(k=>{if(d[k]!==undefined)S[k]=d[k];});
    /* 浏览历史 / 收藏恢复 */
    S.history=Array.isArray(d.history)?d.history.filter(h=>h&&h.id!=null):[];
    S.favIds=Array.isArray(d.favIds)?d.favIds:[];
    S.favIds.forEach(id=>{const p=(S.posts||[]).find(x=>x.id===id);if(p)p.faved=true;});
    if(Array.isArray(d.myPosts)&&d.myPosts.length){
      d.myPosts.forEach(p=>{
        if(p.r23Status==="reviewing")p.r23Status="open"; /* 审核流程不可跨会话悬置 */
        if(p.time==="刚刚")p.time="今天";
      });
      S.posts=[...d.myPosts.filter(p=>!p.__cloud),...S.posts]; /* 双保险：云端帖不本地恢复；铁律整体替换（2026-10-29 审核 H1 修复，原 unshift） */
      const kept=d.myPosts.filter(p=>!p.__cloud);
      if(kept.length){
        const mx=Math.max(100,...kept.map(p=>+p.id||0));
        UID=Math.max(UID,mx+1); /* 避免 UID 重置导致 id 碰撞 */
      }
    }
  }catch(e){}
}
load();
$("#phone").dataset.theme=S.theme;
$("#phone").dataset.fs=S.fs;
$("#phone").dataset.elder=S.elder;
/* 保险：overflow:clip 的旧浏览器回退 —— 手机框架一旦被滚动立即归位，避免整层错位 */
(function(){
  const ph=$("#phone");
  if(ph)ph.addEventListener("scroll",()=>{if(ph.scrollTop!==0)ph.scrollTop=0;},{passive:true});
})();
document.addEventListener("click",scheduleSave,true);
window.addEventListener("beforeunload",save);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")save();});

/* ============ 2. 长辈模式联动（开启长辈=字号交给长辈档；关闭恢复原字号） ============ */
let prevFs=null;
function applyElderLink(){
  const ball=$("#a11yBall");if(ball)ball.classList.toggle("elder",S.elder==="1");
  if(S.elder==="1"&&S.fs){prevFs=S.fs;S.fs="";$("#phone").dataset.fs="";}
  else if(S.elder!=="1"&&prevFs){S.fs=prevFs;prevFs=null;$("#phone").dataset.fs=S.fs;}
  save();
}
new MutationObserver(applyElderLink).observe($("#phone"),{attributes:true,attributeFilter:["data-elder"]});

/* ============ 3. 长辈模式：提示停留更久（包裹全局 toast/banner，保留原逻辑） ============ */
try{
  const _toast=toast;
  toast=function(t){
    _toast(t);
    if(S.elder==="1"){clearTimeout(tsTm);tsTm=setTimeout(()=>{const el=$("#toast");el&&el.classList.remove("show");},4200);}
  };
}catch(e){}
try{
  const _banner=banner;
  banner=function(ic,t,s){
    _banner(ic,t,s);
    if(S.elder==="1"){clearTimeout(bnTm);bnTm=setTimeout(()=>{const el=$("#banner");el&&el.classList.remove("show");},6800);}
  };
}catch(e){}

/* ============ 4. DOM 注入 ============ */
const QUICK=[
  ["孩子写作业拖拉怎么办","每天写作业磨蹭到很晚，讲也不听，大家有什么好办法？"],
  ["孩子沉迷手机","一放学就抱着手机不撒手，约定时间也不管用，求助！"],
  ["孩子不肯独自睡","说要分房睡了，可孩子每晚都哭着想跟大人睡，怎么办？"],
  ["孩子和同学闹矛盾","孩子在班里和好朋友吵架了，回家很难过，怎么开导？"],
  ["想培养阅读习惯","孩子只爱看漫画，想引导他读点文字书，求推荐方法～"]
];
const TIPS=[
  ["🧠","科学育儿 · 今日一读","孩子情绪失控时，先共情再讲理：大脑负责理智的前额叶要到 25 岁左右才发育成熟，孩子「讲不通道理」是正常发育阶段。"],
  ["⏰","科学育儿 · 今日一读","教育部建议：小学生每天睡眠应达到 10 小时，初中生 9 小时，高中生 8 小时。"],
  ["📵","科学育儿 · 今日一读","世界卫生组织建议：5 岁以下儿童每天静态屏幕时间不超过 1 小时，越少越好。"],
  ["🏃","科学育儿 · 今日一读","每天 60 分钟中高强度运动，有助于孩子的骨骼发育、注意力与情绪调节——户外活动是性价比最高的选择。"]
];
function injectAll(){
  /* 启动屏长辈入口与 Aa 悬浮球均已移除（2026-10-24/25，用户反馈影响观感）：
     长辈模式仍可从「我的 → 设置 → 长辈模式」开关开启 */

  /* 首页搜索 */
  $("#page-home").insertAdjacentHTML("afterbegin",`
    <div id="a11ySearchWrap"><div class="sw-box">🔍<input id="a11ySearch" placeholder="搜索求助：关键字 / 分类" aria-label="搜索求助"><button class="clr" id="a11yClr" aria-label="清空搜索">✕</button></div></div>`);

  /* 回到顶部 */
  $("#phone").insertAdjacentHTML("beforeend",`<button id="a11yTop" aria-label="回到顶部">↑</button>`);

  /* 发布面板：语音转文字 + 常用求助快捷填入（分类已挪到发布确认页，这里只负责把内容写快） */
  $("#pubText").insertAdjacentHTML("beforebegin",`<button id="a11yMicP">🎤 语音转文字 · 点一下说话，自动变成文字</button>`);
  $("#pubText").insertAdjacentHTML("afterend",`<div class="a11y-chips" id="a11yQuickT">${QUICK.map((q,i)=>`<button class="a11y-chip" data-q="${i}">${q[0]}</button>`).join("")}</div>`);
  $("#a11yQuickT").addEventListener("click",e=>{
    const b=e.target.closest("[data-q]");if(!b)return;
    const q=QUICK[+b.dataset.q];
    $("#pubText").value=q[1];
    window.__yrbQuickTitle=q[0];             /* 标题交给发布确认页：既可用这句，也可留空让 AI 拟 */
    toast("已帮您填好，可以再修改 ✍️");
  });

  /* 评论面板：快捷温暖语 + 语音输入 */
  $("#commentSheet .cm-bar").insertAdjacentHTML("beforebegin",`<div class="a11y-chips" style="padding:6px 14px 0" id="a11yQuickR">${["抱抱，别急，我们一起想办法 🌸","这个问题我也遇到过，别慌","为孩子点赞，你做得很好了 👍","先把情绪安抚下来，再讲道理会更有效"].map(t=>`<button class="a11y-chip" data-qr="${t}">${t}</button>`).join("")}</div>`);
  $("#a11yQuickR").addEventListener("click",e=>{
    const b=e.target.closest("[data-qr]");if(!b)return;
    $("#cmInput").value=b.dataset.qr;$("#cmInput").focus();
  });
  const cmTools=$("#cmTools");
  if(cmTools)cmTools.insertAdjacentHTML("beforeend",`<button class="cm-tool labeled" id="a11yMicC" title="说话自动变成文字，不用打字" aria-label="语音转文字输入"><span class="ic">✍️</span>语音转文字</button>`);

  /* 无障碍基础属性 */
  $("#toast").setAttribute("role","status");
  $("#toast").setAttribute("aria-live","polite");
  $("#banner").setAttribute("role","alert");
}

/* ============ 5. 搜索（不侵入 renderFeed，渲染后按 DOM 过滤） ============ */
function applySearch(){
  const inp=$("#a11ySearch");if(!inp)return;
  const q=inp.value.trim();
  $("#a11yClr").style.display=q?"flex":"none";
  let vis=0;
  $$("#feed .card").forEach(c=>{
    const p=S.posts.find(x=>x.id===+c.dataset.id);
    const hay=[p&&p.title||"",p&&p.text||"",p&&p.tag||"",p&&p.tagFull||"",p&&p.age||"",p&&p.user||""].join("|");
    const hit=!q||hay.includes(q);
    c.style.display=hit?"":"none";
    if(hit)vis++;
  });
  let empty=$("#a11yNoRes");
  if(q&&!vis){
    if(!empty)$("#feed").insertAdjacentHTML("beforeend",`<div class="empty" id="a11yNoRes">没有找到相关求助，换个关键词试试～</div>`);
  }else if(empty)empty.remove();
}

/* ============ 6. 语音朗读 TTS（云端 AI 真人声音，长辈模式语速放缓） ============
   2026-10-24：朗读统一走 mediafull 层的云端通道（/yrbtts → 央视播音员音色），
   云端不可用时 mediafull 内部自动退回本机语音。mediafull 在 access 之后加载，
   所以这里必须运行时取 window.YRB_MEDIAFULL。 */
const TTS_ON="🔊",TTS_OFF="⏹";
let speaking=false;
function resetTtsBtns(){$$("[data-tts]").forEach(b=>{b.innerHTML=TTS_ON;b.classList.remove("on");});}
function stopSpeak(){
  try{ if(window.YRB_MEDIAFULL&&YRB_MEDIAFULL.stopSpeak)YRB_MEDIAFULL.stopSpeak(); }catch(e){}
  if("speechSynthesis" in window)speechSynthesis.cancel();
  speaking=false;resetTtsBtns();
}
/* 标题与正文重复时不再拼进朗读文本（2026-10-25 用户反馈：自动标题=正文首句截断，读两遍） */
function titleDupTts(t,x){
  t=String(t||"").trim();x=String(x||"").trim();
  if(!t||!x)return false;
  if(t===x)return true;
  const b=t.replace(/[…]+$/,"").replace(/\.{3}$/,"").trim();
  return !!b&&x.replace(/\s+/g," ").indexOf(b.replace(/\s+/g," "))===0;
}
function speakPost(p,btn){
  const text=(((p.title&&!titleDupTts(p.title,p.text))?p.title+"。":"")+(p.text||"")).slice(0,1200);
  try{
    if(window.YRB_MEDIAFULL&&YRB_MEDIAFULL.speak){ YRB_MEDIAFULL.speak(text,btn,true); speaking=true; return; }
  }catch(e){}
  if(!("speechSynthesis" in window)){toast("当前浏览器不支持语音朗读");return;}
  if(speaking){stopSpeak();return;}
  const u=new SpeechSynthesisUtterance(text.slice(0,300));
  u.lang="zh-CN";u.rate=S.elder==="1"?0.85:1;
  u.onend=()=>{speaking=false;resetTtsBtns();};
  u.onerror=()=>{speaking=false;resetTtsBtns();};
  speechSynthesis.cancel();speechSynthesis.speak(u);
  speaking=true;btn.innerHTML=TTS_OFF;btn.classList.add("on");
}
let lastTtsBtn=null,lastTtsAt=0;
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-tts]");if(!b)return;
  e.stopPropagation();
  /* 500ms 防抖：个别手机 WebView 一次点按会派发两次 click，
     旧代码第二击会被当成「再点一次停止」→ 听感为刚开始就停 / 或重启叠音 */
  const now=Date.now();
  if(b===lastTtsBtn&&now-lastTtsAt<500)return;
  lastTtsBtn=b;lastTtsAt=now;
  const card=b.closest(".card");if(!card)return;
  const p=S.posts.find(x=>x.id===+card.dataset.id);if(!p)return;
  speakPost(p,b);
},true);
/* 切换页面/打开弹层时停止朗读 */
document.addEventListener("click",e=>{
  if(e.target.closest(".tb-item,.f-chip,.sheet,#modal,#drMask,#tabbar"))stopSpeak();
},true);

/* ============ 7. 语音转文字输入（Web Speech API，不支持时优雅降级） ============ */
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
function bindMic(btnId,btnRecHTML,btnNormalHTML,getTextTarget){
  const btn=$(btnId);if(!btn)return;
  if(!SR){
    btn.addEventListener("click",()=>toast("当前浏览器暂不支持语音输入，推荐使用 Chrome / Edge，或直接打字"));
    return;
  }
  /* 2026-10-19 用户反馈「语音转文字卡了」：部分浏览器 start/stop 后不回调 onend，
     rec 永远非空 → 按钮永远停在「正在听您说」。改为：
     ① 点击结束时立即复位 UI，不等 onend；
     ② 启动看门狗 4 秒无任何回调就 abort + 复位提示；
     ③ 回调统一校验 rec===r，防止旧一轮 onend 打乱新一轮。 */
  let rec=null,wd=null,tries=0;
  const settle=msg=>{
    if(wd){clearTimeout(wd);wd=null;}
    rec=null;btn.classList.remove("rec");btn.innerHTML=btnNormalHTML;
    if(msg)toast(msg);
  };
  /* 2026-10-25：之前所有识别错误都笼统报「没有听清」，用户困惑。
     实际错误分几类，处理方式不同：
     ① no-speech / network：瞬时问题（没开口/网络抖动），自动重试 1 次，长辈不用再点；
     ② aborted：手动结束或看门狗触发，静默不打扰；
     ③ 权限/设备类：给出明确指引。
     另外：识别中停顿导致 onend 但没有 final 结果时，用最后一次 interim 兜底，
     避免说了半截全丢（表现为「明明说了却什么都没转出来」）。 */
  const SRMSG={
    "audio-capture":"没有找到麦克风，请检查手机是否允许本网站使用麦克风 🎤",
    "not-allowed":"麦克风权限被拒绝：请在浏览器设置里允许本网站使用麦克风",
    "service-not-allowed":"语音服务被浏览器限制，推荐用手机自带浏览器或 Chrome 再试",
    "language-not-supported":"当前浏览器不支持中文语音识别，推荐使用 Chrome / Edge"
  };
  let sessBase=null,sessWritten="";
  btn.addEventListener("click",()=>{
    if(rec){
      const r=rec;
      try{r.stop();}catch(e){try{r.abort();}catch(e2){}}
      settle();
      return;
    }
    const target=getTextTarget();if(!target)return;
    sessBase=target.value||"";sessWritten="";tries=0;
    begin(target);
  });
  function begin(target){
    if(!target)target=getTextTarget();
    if(!target)return;
    const base=sessBase!==null?sessBase:(target.value||"");
    const r=new SR();r.lang="zh-CN";r.interimResults=true;r.continuous=false;
    rec=r;
    btn.classList.add("rec");btn.innerHTML=btnRecHTML;
    let finalTxt="",lastInterim="",got=false;
    const commit=txt=>{
      sessWritten=txt;target.value=(base?base+" ":"")+txt;
    };
    r.onstart=()=>{got=true;};
    r.onresult=e=>{
      got=true;finalTxt="";lastInterim="";
      for(let i=0;i<e.results.length;i++){
        if(e.results[i].isFinal)finalTxt+=e.results[i][0].transcript;
        else lastInterim=e.results[i][0].transcript;
      }
      const show=finalTxt||lastInterim;
      if(show)commit(show);
    };
    r.onerror=e=>{
      if(rec!==r)return;
      const c=e&&e.error||"";
      if(c==="aborted")return;                       /* 手动结束/看门狗，静默 */
      if((c==="no-speech"||c==="network")&&tries<1){ /* 瞬时问题自动重试 1 次 */
        tries++;settle(null);
        toast(c==="no-speech"?"没听清，自动再听一次…":"网络有点抖，自动重试…");
        setTimeout(begin,600);
        return;
      }
      if(c==="no-speech")settle("还是没有听清：请靠近手机、说话慢一点，再点一下麦克风 🙏");
      else if(c==="network")settle("网络不稳定，语音识别暂时用不了，稍后再试或直接打字 ✍️");
      else settle(SRMSG[c]||"没有听清，再试一次？");
    };
    r.onend=()=>{
      if(rec!==r)return;                /* 期间已被手动结束/新一轮接管，不动作 */
      /* 半截话兜底：没有 final 就用最后一次 interim，别让用户白说 */
      if(!finalTxt&&lastInterim)commit(lastInterim);
      const done=finalTxt||lastInterim;
      sessBase=null;sessWritten="";
      settle(done?"已转成文字，请检查再发布 ✍️":"");
    };
    try{
      r.start();
      wd=setTimeout(()=>{               /* 启动看门狗：start 后无任何回调 = 麦克风假死 */
        if(rec===r&&!got){try{r.abort();}catch(e){}settle("麦克风没有响应，请再点一次");}
      },4000);
    }catch(e){settle("麦克风启动失败，请再试一次");}
  }
}

/* ============ 8. 装饰：朗读按钮 / 认证徽标 / 年龄徽标 / 科学贴士 / 免责声明 ============ */
function decorateFeed(){
  const feed=$("#feed");if(!feed)return;
  /* 科学育儿贴士（每日轮换） */
  if(!$("#sciTip")&&feed.querySelector(".card")){
    const tip=TIPS[new Date().getDate()%TIPS.length];
    feed.insertAdjacentHTML("afterbegin",`<div class="sci-tip" id="sciTip"><span class="ti">${tip[0]}</span><div class="sc-tx"><div class="tt">${tip[1]}</div><div class="td">${tip[2]}</div></div></div>`);
  }
  /* 互助内容免责声明（科学性：社区建议不替代专业意见） */
  if(!$("#sciNote")&&feed.querySelector(".card")){
    feed.insertAdjacentHTML("beforeend",`<div class="sci-note" id="sciNote">💡 <b>温馨提示</b>：社区内容来自家长互助分享，仅供借鉴参考，不构成医疗、心理诊断或专业建议；涉及孩子健康、安全与法律问题，请优先咨询专业机构。</div>`);
  }
  $$("#feed .card").forEach(card=>{
    const p=S.posts.find(x=>x.id===+card.dataset.id);if(!p)return;
    /* 2026-10-24：♥ / ⭐ / 🔊 移到内容框右侧竖排悬浮列（p-side），
       底部操作行只剩「帮忙数 + 帮忙 + 查看完整求助」，清爽不挤。
       幂等：side 建一次；按钮已在其内就不再搬，避免与 MutationObserver 死循环 */
    let side=$(".p-side",card);
    if(!side){
      side=document.createElement("aside");
      side.className="p-side";
      side.setAttribute("aria-label","点赞、收藏与朗读");
      const head=$(".p-head",card);
      if(head)head.after(side);else card.appendChild(side);
    }
    const like=$(".pa-btn.like",card),fav=$(".pa-btn.fav",card);
    if(like&&like.parentElement!==side)side.appendChild(like);
    if(fav&&fav.parentElement!==side)side.appendChild(fav);
    if(!$("[data-tts]",side)){
      const b=document.createElement("button");
      b.className="pa-btn";b.dataset.tts="1";b.innerHTML=TTS_ON;
      b.setAttribute("aria-label","朗读这条求助");
      side.appendChild(b);
    }
    const name=$(".p-name",card);
    if(name&&p.user==="心理老师周周"&&!$(".pro-badge",name)){
      const sp=document.createElement("span");sp.className="pro-badge";sp.textContent="✓ 专业认证";name.appendChild(sp);
    }
    const head=$(".p-head",card),tag=$(".p-tag",head||card);
    if(p.age&&tag&&!$(".age-chip",head||card)){
      const sp=document.createElement("span");sp.className="age-chip";sp.textContent="👶 "+p.age;tag.after(sp);
    }
  });
  if($("#a11ySearch")&&$("#a11ySearch").value.trim())applySearch();
}
function decorateProNames(){
  $$("#cmList .cm-name, #r23CmList .cm-name").forEach(n=>{
    if(n.dataset.pro)return;
    if(n.textContent.includes("心理老师周周")){
      n.dataset.pro="1";
      const sp=document.createElement("span");sp.className="pro-badge";sp.textContent="✓ 专业认证";
      n.appendChild(sp);
    }else n.dataset.pro="1";
  });
}
function decorateAll(){decorateFeed();decorateProNames();}

/* ============ 9. 适老设置弹窗 ============ */
function openA11yModal(){
  modal(`<div class="md-title">👁 适老 · 无障碍</div>
  <div class="a11y-mrow"><span>长辈模式<br><i style="font-size:11px;color:var(--muted);font-style:normal">大字 · 大按钮 · 慢提示 · 可朗读</i></span><span class="switch ${S.elder==="1"?"on":""}" id="abElder" data-sw></span></div>
  <div class="a11y-mrow"><span style="flex:none">字体大小</span><span class="seg" id="abFs"><button class="seg-btn ${S.fs===""?"on":""}" data-v="">标准</button><button class="seg-btn ${S.fs==="lg"?"on":""}" data-v="lg">大</button><button class="seg-btn ${S.fs==="xl"?"on":""}" data-v="xl">特大</button></span></div>
  <div class="md-acts"><button class="btn-a" data-x="close">完成</button></div>`);
  $("#abElder").onclick=function(){
    this.classList.toggle("on");
    S.elder=this.classList.contains("on")?"1":"0";
    $("#phone").dataset.elder=S.elder;
    toast(S.elder==="1"?"长辈模式已开启：大字大按钮、可朗读":"长辈模式已关闭");
  };
  $("#abFs").onclick=e=>{
    const b=e.target.closest(".seg-btn");if(!b)return;
    $$("#abFs .seg-btn").forEach(x=>x.classList.remove("on"));b.classList.add("on");
    S.fs=b.dataset.v;$("#phone").dataset.fs=S.fs;
    toast("字体大小已调整");
  };
}

/* ============ 10. 事件绑定 ============ */
function bindAll(){
  /* Aa 悬浮球已移除；无障碍面板改由「我的 → 设置」进入 */
  const ball=$("#a11yBall");if(ball)ball.addEventListener("click",openA11yModal);

  const inp=$("#a11ySearch");
  inp.addEventListener("input",applySearch);
  inp.addEventListener("search",applySearch);
  $("#a11yClr").addEventListener("click",()=>{inp.value="";applySearch();inp.focus();});

  $("#page-home").addEventListener("scroll",()=>{
    $("#a11yTop").classList.toggle("show",$("#page-home").scrollTop>500);
  },{passive:true});
  $("#a11yTop").addEventListener("click",()=>$("#page-home").scrollTo({top:0,behavior:"smooth"}));

  /* 认证徽标点击说明 */
  document.addEventListener("click",e=>{
    const pb=e.target.closest(".pro-badge");if(!pb)return;
    e.stopPropagation();
    toast("该用户已通过平台资质认证（如：国家二级心理咨询师），建议仅供参考");
  },true);

  /* 语音输入绑定 */
  bindMic("#a11yMicP","🎤 正在听您说…点一下结束","🎤 语音转文字 · 点一下说话，自动变成文字",()=>$("#pubText"));
  bindMic("#a11yMicC",`<span class="ic">⏹</span>结束转文字`,`<span class="ic">✍️</span>语音转文字`,()=>$("#cmInput"));
}

/* ============ 11. 装饰观察器 ============ */
function observeAll(){
  new MutationObserver(decorateAll).observe($("#feed"),{childList:true,subtree:true});
  new MutationObserver(decorateProNames).observe($("#commentSheet"),{childList:true,subtree:true});
  const dt=$("#r23Detail");if(dt)new MutationObserver(decorateProNames).observe(dt,{childList:true,subtree:true});
}

/* ============ 启动 ============ */
injectAll();
applyElderLink();
bindAll();
observeAll();
decorateAll();
})();

/* =========================================================
   我的清单层：我的求助 / 我的帮忙 / 我的收藏 / 浏览历史
   —— 让「我的」页这四项真正打开可点可看的列表（并支持进入求助详情）
   ========================================================= */
(function(){
"use strict";
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

const KIND={"我的求助":"mine","我的帮忙":"helps","我的收藏":"favs","浏览历史":"hist"};
const TITLE={mine:"📄 我的求助",helps:"🤝 我的帮忙",favs:"⭐ 我的收藏",hist:"🕘 浏览历史"};
const TIPS={mine:"我发出的全部求助 · 点击可查看详情与帮忙",helps:"我送出过的每一份帮忙 · 点击可回到求助现场",
            favs:"我收藏的求助 · 在详情里可随时取消收藏",hist:"最近看过的求助 · 仅自己可见"};
let curKind=null;

/* ---------- 基础读取 ---------- */
function meName(){try{if(window.YRB_CLOUD&&YRB_CLOUD.signedIn())return YRB_CLOUD.name();}catch(e){}return "阳阳爸爸";}
function posts(){return (typeof S!=="undefined"&&Array.isArray(S.posts))?S.posts:[];}
function byId(id){return posts().find(p=>String(p.id)===String(id));}
function history(){if(typeof S==="undefined")return [];if(!Array.isArray(S.history))S.history=[];return S.history;}
function favIds(){if(!Array.isArray(S.favIds))S.favIds=[];return S.favIds;}
function isFaved(p){return !!p.faved||favIds().some(id=>String(id)===String(p.id));}
function setFaved(p,on){
  p.faved=!!on;
  const sid=String(p.id);
  S.favIds=favIds().filter(id=>String(id)!==sid);
  if(on)S.favIds.unshift(p.id);
}
function myCommentsOf(p){const n=meName();return (p&&p.comments||[]).filter(c=>c&&(c.mine||c.user===n));}
function typeBadge(p){const t={img:"🖼 图文",video:"🎬 微视频",voice:"🎙 语音"};return t[p&&p.type]||"📄 求助";}
function ago(ts){
  const t=+ts;if(!t)return "";
  const d=Math.max(0,(Date.now()-t)/1000);
  if(d<60)return "刚刚";
  if(d<3600)return Math.floor(d/60)+"分钟前";
  if(d<86400)return Math.floor(d/3600)+"小时前";
  if(d<86400*7)return Math.floor(d/86400)+"天前";
  const dt=new Date(t);return `${dt.getMonth()+1}月${dt.getDate()}日`;
}
function mainText(p){return (p.title&&p.title.trim())||(p.text||"").slice(0,20)||"求助内容";}

/* ---------- 浏览历史：快照兜底（帖子被删也能展示） ---------- */
function snapshot(p){return {title:p.title||"",text:(p.text||"").slice(0,40),user:p.user||"",tag:p.tagFull||p.tag||"求助",type:p.type||"img"};}
function recordHistory(id){
  const p=byId(id);if(!p)return;
  const h=history().filter(x=>String(x.id)!==String(id));
  h.unshift({id:p.id,t:Date.now(),s:snapshot(p)});
  S.history=h.slice(0,60);
  if(window.__yrbSave)window.__yrbSave();
}

/* ---------- 数据集合 ---------- */
function collect(kind){
  if(kind==="mine")return posts().filter(p=>p&&p.mine).map(p=>({p,note:(p.text||"").slice(0,60),sub:ago(p.__t)||p.time||""}));
  if(kind==="helps")return posts().map(p=>({p,cs:myCommentsOf(p)})).filter(x=>x.cs.length)
    .map(x=>({p:x.p,cs:x.cs,note:x.cs.map(c=>c.kind==="text"?(c.text||""):(c.kind==="voice"?"[语音帮忙] ":"[微视频帮忙] ")+(c.text||c.dur||"")).join(" ／ ")}));
  if(kind==="favs")return posts().filter(p=>p&&isFaved(p)).map(p=>({p,note:(p.text||"").slice(0,60)}));
  /* hist：优先按 id 取回真实帖子，取不到则用快照渲染 */
  return history().map(h=>{const p=byId(h.id);return {p:Object.assign({},h.s||{},p||{}),snap:!p,t:ago(h.t),note:(h.s&&h.s.text)||((p&&p.text)||"").slice(0,60)};});
}

/* ---------- 渲染 ---------- */
function itemHTML(it,ic,cls,metaExtra){
  const p=it.p,title=esc(mainText(p)),sub=esc((p.user||"家长")+(p.flag?" "+p.flag:""));
  const quote=it.note?`<div class="ml-quote">${esc(it.note)}</div>`:"";
  const time=it.t||it.sub||p.time||"";
  return `<button class="ml-item" ${it.snap?"":`data-r23detail="${esc(p.id)}"`}>
    <span class="ml-ic ${cls}">${ic}</span>
    <span class="ml-main">
      <span class="ml-t">${title}</span>
      ${quote}
      <span class="ml-meta"><span class="ml-tag">${esc(p.tagFull||p.tag||"求助")}</span><span>${sub}</span>${time?`<span>🕘 ${esc(time)}</span>`:""}${metaExtra||""}</span>
    </span>
  </button>`;
}
function emptyHTML(kind){
  const e={mine:["📄","还没有发过求助","有困惑就发一条，很多家长愿意伸手帮你"],helps:["🤝","还没有送出过帮忙","去首页看看，帮一句也是暖一份心"],favs:["⭐","收藏夹还是空的","看到有用的求助，点一下 ⭐ 就能存下来"],hist:["🕘","还没有浏览记录","看过的求助会按时间出现在这里"]}[kind];
  return `<div class="ml-empty"><span class="e">${e[0]}</span><b>${e[1]}</b><br>${e[2]}
    <span class="ml-acts"><button class="ml-btn" data-ml="go-home">去首页看看</button></span></div>`;
}
function listHTML(kind){
  const arr=collect(kind);
  const sum=`<div class="ml-sum">共 <b>${arr.length}</b> 条　·　${TIPS[kind]}</div>`;
  if(!arr.length)return sum+emptyHTML(kind);
  let body="";
  if(kind==="mine")body=arr.map(it=>{
    const st=it.p.r23Status==="solved"?"✅ 已解决":it.p.r23Status==="reviewing"?"⏳ 审核中":`🤝 ${it.p.helps||0} 个帮忙`;
    const ai=it.p.aiClassified?"<span>🤖 AI 分类</span>":"";
    return itemHTML(it,"📄","",`<span>${st}</span><span>⭐ ${it.p.favs||0}</span>${ai}`);
  }).join("");
  else if(kind==="helps")body=arr.map(it=>itemHTML(Object.assign({},it,{note:it.note}),"🤝","g",`<span>我已帮忙 ${it.cs.length} 次</span>`)).join("");
  else if(kind==="favs")body=arr.map(it=>itemHTML(Object.assign({},it,{note:"",t:""}),"⭐","y",`<span>${typeBadge(it.p)}</span>`)).join("");
  else body=arr.map(it=>itemHTML(it,"🕘","p",`<span>${typeBadge(it.p)}</span>`)).join("");
  const foot=kind==="hist"?`<div class="ml-foot"><button class="ml-foot-btn" data-ml="clear-hist">清空浏览历史</button></div>`:"";
  return sum+body+foot;
}
function render(){
  if(!curKind)return;
  const body=$("#spBody");if(!body)return;
  body.scrollTop=0;
  body.innerHTML=listHTML(curKind);
}
function open(kind){
  curKind=kind;
  applyFavs();
  const t=$("#spTitle");if(t)t.textContent=TITLE[kind]||"我的";
  render();
  const sp=$("#subpage");if(sp)sp.classList.add("open");
}
function close(){curKind=null;const sp=$("#subpage");if(sp)sp.classList.remove("open");}

/* ---------- 事件 ---------- */
/* 1) 我的页入口：捕获阶段接管，避免落到「原型演示」提示 */
document.addEventListener("click",e=>{
  const b=e.target.closest("#meMenu [data-act='memu']");if(!b)return;
  const k=KIND[(b.dataset.t||"").trim()];if(!k)return;
  e.stopPropagation();e.preventDefault();
  open(k);
},true);

/* 2) 列表内操作：去首页 / 清空历史 */
document.addEventListener("click",e=>{
  const b=e.target.closest("[data-ml]");if(!b)return;
  e.stopPropagation();
  const a=b.dataset.ml;
  if(a==="go-home"){
    close();
    if(typeof switchTab==="function")switchTab("home");
  }else if(a==="clear-hist"){
    S.history=[];if(window.__yrbSave)window.__yrbSave();
    render();
    if(window.toast)toast("浏览历史已清空");
  }
},true);

/* 3) 打开任意求助详情时记录浏览历史 */
document.addEventListener("click",e=>{
  const dl=e.target.closest("[data-r23detail]");if(!dl)return;
  recordHistory(dl.dataset.r23detail);
},true);

/* 4) 详情里的收藏/点赞写回数据，保证「我的收藏」与卡片一致 */
document.addEventListener("click",e=>{
  const fav=e.target.closest('#r23Detail [data-db="fav"]');
  if(fav){
    const p=byId(S.curPost);
    if(p){const turnOn=!fav.classList.contains("on");setFaved(p,turnOn);if(window.__yrbSave)window.__yrbSave();}
  }
  if(e.target.closest("#r23DBack")&&curKind)render();   /* 从详情返回后刷新列表（收藏可能已变化） */
},true);

/* 6) 帮忙发出后：详情页开着则同步刷新，帮忙条数/内容即时可见 */function refreshDetailIfOpen(){
  /* 弹窗开着时不再自动重开详情：2026-10-19 卡死排查中发现，
     自动重开与 DOM 观察者会互相触发（260ms 一轮），在确认框底下反复重绘 */
  if(document.querySelector("#modal.open"))return;
  const dt=$("#r23Detail");
  if(!dt||!dt.classList.contains("open"))return;
  const id=(typeof S!=="undefined")?S.curPost:null;if(id==null)return;
  const tr=document.querySelector(`[data-r23detail="${esc(id)}"]`);
  if(tr)tr.click();
}
let cmTm=null;
const cmList=$("#cmList");
if(cmList)new MutationObserver(()=>{clearTimeout(cmTm);cmTm=setTimeout(refreshDetailIfOpen,260);}).observe(cmList,{childList:true,subtree:true});

/* 7) 收藏标记回填：云端帖在刷新后才异步合并进来，需在列表重绘时按 favIds 同步卡片状态 */
function applyFavs(){
  if(!Array.isArray(S.favIds)||!S.favIds.length)return;
  S.favIds.forEach(id=>{const p=byId(id);if(p&&!p.faved)p.faved=true;});
}
const feedHost=$("#feed");
if(feedHost)new MutationObserver(()=>applyFavs()).observe(feedHost,{childList:true});
applyFavs();

/* 5) 暴露轻量接口，便于后续扩展与自检 */
window.YRB_MYLIST={open,close,refresh:render,current:()=>curKind,
  count:k=>collect(k).length,
  _debug:{recordHistory,isFaved,setFaved}};
})();
