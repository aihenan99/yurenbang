/* ============================================================
   casedit.js — 案例广场「图文」编辑器 v2（2026-10-27）
   Word 式：可粘贴文字/图片、可编辑、加粗/小标题/居中/插图，发布到案例广场。
   ------------------------------------------------------------
   设计约束（对应项目铁律）：
   · 增强层不改 app.js/refine23 结构：只走 DOM 委托 + window.YRB_CLOUD；
   · 用户内容一律白名单清洗后才落库/渲染（不在 innerHTML 里直出原文）；
   · 后端 yb_cases.content_html 列未迁移前：发布自动降级为图片案例，不阻断；
   · 查看端接管同样走委托（app.js 先渲染，本层随后覆盖），不碰原函数。
   ------------------------------------------------------------
   v2 修复（2026-10-27）：
   1. 探测三态（有列/无列/未知），未知不再擅自降级——避免「正文静默丢失」；
   2. 降级发布后不清空编辑器、不删草稿，明确告知用户先复制文字；
   3. 粘贴图文混排不再丢正文：剪贴板文件按序替换 html 里的外链图；
   4. 发布全链路超时兜底，按钮不会永久卡在「正在发布…」；
   5. 查看端渲染图文案例正文（原实现只有 media，正文永远看不见）；
   6. 图片 Blob 未就绪时发布前等待，不再静默丢图；blob URL 统一回收；
   7. 兼容修正：NodeList.forEach → 定长循环（微信 X5/老安卓 WebView）；
   8. 草稿在 pagehide/切后台时立即落盘；boot 轮询限次，不再无限空转。
   ============================================================ */
(function(){
"use strict";
var LS="yrb_casedit_draft_v1";       /* 草稿只存文字（图片不进 localStorage） */
var MAX_IMGS=9, MAX_CHARS=20000, MAX_TITLE=80;

/* 探测三态：UNKNOWN 表示「云没就绪 / 网络错误」，既不能当有、也不能当没有 */
var P_UNKNOWN=0, P_YES=1, P_NO=2;
var probeState=P_UNKNOWN, probePromise=null;

var active=false, saving=false;
var imgs=[];                          /* imgs[n]={src,blob?,bad?}  n ↔ data-ce-ph */
var pasteQueue=null;                  /* 粘贴期间：剪贴板图片队列（替换 html 外链图） */
var restored=false, saveT=null, lastRange=null;

function $(s,r){return (r||document).querySelector(s);}
function toast(m){try{if(window.toast)window.toast(m);}catch(e){}}
function paper(){return $("#cePaper");}
function escHtml(s){return String(s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
/* 兼容：老 WebView 没有 NodeList.prototype.forEach */
function each(list,fn){for(var i=0;i<list.length;i++)fn(list[i],i);}

/* ---------- 清洗：白名单（P/H3/B/STRONG/U/EM/I/BR/UL/OL/LI/IMG） ----------
   mode="edit"  编辑态：外链图丢弃，剪贴板图片按序顶替
   mode="final" 发布态：img 只留占位序号，由 serialize 统一编号
   mode="view"  查看态：img 只留 data-yrb-media 序号，供渲染端填签名地址 */
/* 2026-11-07：加 HR（分隔线）——后台排版「分段」要用；仍是封闭白名单，
   只多一个无属性空元素，不引入任何可执行/可外链的标签。 */
var ALLOW={P:1,H3:1,B:1,STRONG:1,U:1,EM:1,I:1,BR:1,HR:1,UL:1,OL:1,LI:1};
var DROP={SCRIPT:1,STYLE:1,NOSCRIPT:1,IFRAME:1,OBJECT:1,EMBED:1,SVG:1,TEXTAREA:1,INPUT:1,BUTTON:1,LINK:1,META:1,FORM:1,SELECT:1,VIDEO:1,AUDIO:1,CANVAS:1,TEMPLATE:1};

function addImg(src,mode,blob){
  var n=imgs.length;
  var entry={src:src};
  if(blob)entry.blob=blob;
  else{
    /* blob:/data: 统一取回 Blob（发布管道只认 Blob）；失败标记 bad，发布时跳过该图 */
    try{
      fetch(src).then(function(r){return r.blob();})
        .then(function(b){entry.blob=b;})
        .catch(function(){entry.bad=true;});
    }catch(e){entry.bad=true;}
  }
  imgs.push(entry);
  var im=document.createElement("img");
  im.setAttribute("data-ce-ph",String(n));
  im.src=src;im.alt="";
  return im;
}
function cleanInto(src,dst,mode){
  for(var n=src.firstChild;n;n=n.nextSibling){
    if(n.nodeType===3){dst.appendChild(document.createTextNode(n.nodeValue));continue;}
    if(n.nodeType!==1)continue;
    var tag=n.tagName;
    /* 危险/无意义子树：整棵丢弃，不拆壳（防 script/style 文本泄漏） */
    if(DROP[tag])continue;
    if(tag==="IMG"){
      var s=(n.getAttribute&&n.getAttribute("src"))||"";
      if(mode==="view"){
        var mk=n.getAttribute&&n.getAttribute("data-yrb-media");
        if(mk!=null){
          var vo=document.createElement("img");
          vo.setAttribute("data-yrb-media",mk);vo.setAttribute("alt","");
          dst.appendChild(vo);
        }
      }else if(mode==="edit"){
        if(/^blob:/i.test(s)||/^data:image\//i.test(s)){
          dst.appendChild(addImg(s,"edit"));
        }else if(pasteQueue&&pasteQueue.length){
          /* 外链图：用剪贴板里的原始图片顶替（Word/网页图文混排的关键） */
          var pb=pasteQueue.shift();
          if(pb)dst.appendChild(addImg(URL.createObjectURL(pb),"edit",pb));
        }
        /* 剩余外链图：静默丢弃（不看、不引、不耗流量） */
      }else{
        var ph=n.getAttribute&&n.getAttribute("data-ce-ph");
        if(ph!=null){
          var o=document.createElement("img");
          o.setAttribute("data-ce-ph",ph);
          dst.appendChild(o);
        }
      }
      continue;
    }
    if(tag==="DIV"||tag==="SECTION"||tag==="ARTICLE"||tag==="FONT"||tag==="BLOCKQUOTE")tag="P";
    if(tag==="H1"||tag==="H2"||tag==="H4"||tag==="H5"||tag==="H6")tag="H3";
    if(!ALLOW[tag]){cleanInto(n,dst,mode);continue;}   /* 非白名单：拆壳留文字 */
    var el=document.createElement(tag);
    /* 对齐只认左/中/右三档，且只写在 P/H3 上：其余 style（颜色、字号 em、
       背景图等）一律不保留 —— 那些既能把页面搞乱，也是外链与 XSS 的常见载体。 */
    if(tag==="P"||tag==="H3"){
      var al=/(?:^|;)\s*text-align\s*:\s*(left|center|right)/i.exec((n.getAttribute&&n.getAttribute("style"))||"");
      if(al&&al[1].toLowerCase()!=="left")el.style.textAlign=al[1].toLowerCase();
    }
    dst.appendChild(el);
    cleanInto(n,el,mode);
  }
}
/* 编辑态 → 发布态：返回 {html, items:[Blob], chars}；无图时 items 为空。
   两遍法：先按白名单平移到发布树（img 保占位序号），再按 DOM 顺序统一编号。 */
function serialize(){
  var p=paper();if(!p)return null;
  var holder=document.createElement("div");
  cleanInto(p,holder,"final");
  var seq=0,items=[],list=holder.querySelectorAll("img[data-ce-ph]");
  each(list,function(im){
    var e=imgs[+im.getAttribute("data-ce-ph")]||{};
    if(e.blob&&!e.bad){
      im.removeAttribute("data-ce-ph");
      im.setAttribute("data-yrb-media",String(seq++));
      im.removeAttribute("src");
      items.push({blob:e.blob});
    }else{
      im.parentNode&&im.parentNode.removeChild(im);  /* 图未就绪/失败：不发这张，文字保留 */
    }
  });
  var chars=(holder.textContent||"").replace(/\s+/g,"").length;
  return {html:holder.innerHTML,items:items,chars:chars};
}

/* ---------- 图片工具 ---------- */
function liveImgCount(){
  var p=paper();if(!p)return 0;
  return p.querySelectorAll("img[data-ce-ph]").length;
}
function pendingImgCount(){
  var p=paper();if(!p)return 0;
  var list=p.querySelectorAll("img[data-ce-ph]"),k=0;
  each(list,function(el){
    var e=imgs[+el.getAttribute("data-ce-ph")];
    if(e&&!e.blob&&!e.bad)k++;
  });
  return k;
}
/* 等图片 Blob 取回，最多等 ms；超时后未就绪的图在 serialize 里被跳过（不阻断发布） */
function waitImgs(ms){
  return new Promise(function(res){
    var t0=Date.now();
    (function tick(){
      if(!pendingImgCount()||Date.now()-t0>ms)return res();
      setTimeout(tick,80);
    })();
  });
}
function releaseImgs(){
  each(imgs,function(e){
    var s=e&&e.src;
    if(s&&/^blob:/i.test(s)){try{URL.revokeObjectURL(s);}catch(_){}}
  });
  imgs=[];
}

/* ---------- 编辑器行为 ---------- */
function setEmptyTip(){
  var p=paper();if(!p)return;
  var has=p.querySelector("img")||(p.textContent||"").trim();
  p.classList.toggle("ce-empty",!has);
}
function updateMeta(){
  var tip=$("#ceTip");if(!tip)return;
  var p=paper();if(!p)return;
  var n=(p.textContent||"").replace(/\s+/g,"").length;
  var k=liveImgCount();
  var over=n>MAX_CHARS, near=n>MAX_CHARS*0.9;
  tip.classList.toggle("ce-warn",over||near);
  tip.textContent=over
    ? "已写 "+n+" 字 · 超出 2 万字，删减后才能发布"
    : "已写 "+n+" 字 · 图片 "+k+"/"+MAX_IMGS+" 张"+(near?"（快到 2 万字上限了）":"");
}
function restoreSel(){
  var p=paper();if(!p)return;
  try{p.focus();}catch(e){}
  if(!lastRange)return;
  try{
    /* 选区所属节点已不在编辑区（草稿重放/清空）→ 丢弃，避免把光标恢复到幽灵节点 */
    if(!p.contains(lastRange.startContainer)){lastRange=null;return;}
    var s=window.getSelection();
    if(!s)return;
    if(!s.anchorNode||!p.contains(s.anchorNode)){
      s.removeAllRanges();s.addRange(lastRange);
    }
  }catch(e){lastRange=null;}
}
function trackSel(){
  try{
    var s=window.getSelection();
    if(s&&s.rangeCount&&s.anchorNode){
      var p=paper();
      if(p&&p.contains(s.anchorNode))lastRange=s.getRangeAt(0).cloneRange();
    }
  }catch(e){}
}
function insertHtmlAtCursor(html){
  if(!html)return;
  var p=paper();if(!p)return;
  restoreSel();
  var ok=false;
  try{ok=document.execCommand("insertHTML",false,html);}catch(e){}
  if(!ok){try{p.insertAdjacentHTML("beforeend",html);}catch(_){}}
  trackSel();setEmptyTip();updateMeta();scheduleSave();
}
function insertImageBlob(blob){
  if(!blob)return;
  if(liveImgCount()>=MAX_IMGS){toast("图片最多 "+MAX_IMGS+" 张，先发这篇，下一篇再放");return;}
  var url;try{url=URL.createObjectURL(blob);}catch(e){return;}
  var im=document.createElement("img");
  im.setAttribute("data-ce-ph",String(imgs.length));
  im.src=url;im.alt="";
  imgs.push({src:url,blob:blob});
  insertHtmlAtCursor(im.outerHTML);
}
function insertImages(blobs){
  if(!blobs||!blobs.length)return;
  var room=MAX_IMGS-liveImgCount();
  if(room<=0){toast("图片最多 "+MAX_IMGS+" 张，先发这篇，下一篇再放");return;}
  if(blobs.length>room)toast("图片最多 "+MAX_IMGS+" 张，已保留前 "+room+" 张");
  each(blobs.slice(0,room),function(b){insertImageBlob(b);});
}

/* 压缩：统一入口，失败退回原文件（宁可大一点，也不能丢图） */
function compressOne(f){
  return new Promise(function(res){
    try{
      if(window.YRB_CAPTURE&&window.YRB_CAPTURE.compress){
        window.YRB_CAPTURE.compress(f).then(function(b){res(b||f);},function(){res(f);});
      }else res(f);
    }catch(_){res(f);}
  });
}
function compressAll(files){
  var out=[];
  var chain=Promise.resolve();
  each(files,function(f){
    chain=chain.then(function(){
      return compressOne(f).then(function(b){out.push(b);});
    });
  });
  return chain.then(function(){return out;});
}

/* ---------- 粘贴 / 拖入（审核 M8：drop 过去完全没接，浏览器默认把来源 HTML
   原样插进 contenteditable——live DOM 自 XSS 面；现在统一走 pasteRich 白名单清洗） ---------- */
function transferIn(dt){
  var files=[];try{files=[].slice.call(dt.files||[]);}catch(_){}
  var pics=[];each(files,function(f){if(f&&/^image\//.test(f.type||""))pics.push(f);});
  var html="";try{html=dt.getData("text/html")||"";}catch(_){}
  var plain="";try{plain=dt.getData("text/plain")||"";}catch(_){}

  if(!pics.length){
    if(html)pasteRich(html,[],plain);
    else insertPlainText(plain);
    return;
  }
  /* 有图片：先压缩，再一次性插入（保证图文顺序不乱） */
  compressAll(pics).then(function(blobs){
    if(html)pasteRich(html,blobs,plain);
    else insertImages(blobs);
  },function(){insertImages(pics);});
}
function handlePaste(e){
  if(!active)return;
  var dt=e.clipboardData||window.clipboardData;if(!dt)return;
  var p=paper();if(!p||!p.contains(e.target))return;
  e.preventDefault();
  transferIn(dt);
}
function handleDrop(e){
  if(!active)return;
  var dt=e.dataTransfer;if(!dt)return;
  var p=paper();if(!p||!p.contains(e.target))return;
  e.preventDefault();
  transferIn(dt);
}
function pasteRich(html,blobs,plain){
  var box=document.createElement("div");
  var q=(blobs||[]).slice();
  pasteQueue=q;
  try{
    var parsed=new DOMParser().parseFromString(html,"text/html");
    cleanInto(parsed.body,box,"edit");
  }catch(_){}
  pasteQueue=null;
  /* 剪贴板里带了、但 html 中没有对应位置的图：补到末尾（不丢图） */
  if(q.length)each(q.slice(),function(b){box.appendChild(addImg(URL.createObjectURL(b),"edit",b));});
  if(box.firstChild)insertHtmlAtCursor(box.innerHTML);
  else insertPlainText(plain);   /* 富文本清洗后为空（如只有 script）：退回纯文本，别什么都不插 */
}
function insertPlainText(txt){
  txt=String(txt||"");
  if(!txt)return;
  var parts=txt.replace(/\r/g,"").split(/\n+/).map(function(s){return s.trim();}).filter(function(s){return s.length;});
  if(!parts.length)return;
  insertHtmlAtCursor(parts.map(function(s){return "<p>"+escHtml(s)+"</p>";}).join(""));
}

/* ---------- 草稿（只存文字） ---------- */
function scheduleSave(){
  clearTimeout(saveT);
  saveT=setTimeout(saveDraft,800);
}
function saveDraft(){
  try{
    clearTimeout(saveT);saveT=null;
    var p=paper();if(!p)return;
    var clone=p.cloneNode(true);
    each(clone.querySelectorAll("img"),function(x){x.parentNode&&x.parentNode.removeChild(x);});
    var h=clone.innerHTML||"";
    if(h.replace(/<[^>]*>/g,"").trim())localStorage.setItem(LS,h);
    else localStorage.removeItem(LS);
  }catch(e){}
}
function restoreDraft(){
  if(restored)return;restored=true;
  try{
    var h=localStorage.getItem(LS);
    if(!h||!h.replace(/<[^>]*>/g,"").trim())return;
    var p=paper();if(!p)return;
    if((p.textContent||"").trim()||p.querySelector("img"))return;  /* 已有内容不覆盖 */
    var box=document.createElement("div");
    var parsed=new DOMParser().parseFromString("<div>"+h+"</div>","text/html");
    if(parsed.body.firstChild)cleanInto(parsed.body.firstChild,box,"edit");
    p.innerHTML=box.innerHTML;
    setEmptyTip();updateMeta();
    toast("已恢复上次没发完的草稿（图片需要重新插图）");
  }catch(e){}
}

/* ---------- 激活 / 停用 ---------- */
function activate(){
  if(active)return;active=true;
  var pan=$("#cePanel"),g=$("#cuGrid"),note=$("#cuNote");
  if(pan)pan.hidden=false;
  if(g)g.style.display="none";
  if(note)note.textContent="像写文档一样写：直接打字，也可以粘贴文字和图片";
  restoreDraft();setEmptyTip();updateMeta();
  setTimeout(function(){try{var p=paper();if(p)p.focus();}catch(e){}},120);
}
function deactivate(){
  if(!active)return;active=false;
  try{saveDraft();}catch(_){}
  var pan=$("#cePanel"),g=$("#cuGrid");
  if(pan)pan.hidden=true;
  if(g)g.style.display="";
}

/* ---------- 后端探测：yb_cases.content_html 列是否存在（三态） ---------- */
function colMissing(err){
  if(!err)return false;
  var code=String((err.code!==undefined?err.code:err.status)||"");
  var msg=String(err.message||err.details||err.hint||"");
  if(/42703|PGRST204/.test(code)||/42703|PGRST204/.test(msg))return true;
  if(/content_html/i.test(msg))return true;
  if(/column .* does not exist|schema cache/i.test(msg))return true;
  return false;
}
/* 云 SDK 异步加载：等 yrb-cloud-ready 或轮询，不硬性 return */
function waitCloud(ms){
  return new Promise(function(res){
    function ready(){
      try{return !!(window.YRB_CLOUD&&window.YRB_CLOUD.client&&window.YRB_CLOUD.client.database);}catch(_){return false;}
    }
    if(ready())return res(true);
    var done=false;
    var t=setTimeout(function(){
      if(done)return;done=true;res(ready());
    },ms);
    try{
      window.addEventListener("yrb-cloud-ready",function(){
        if(done)return;done=true;clearTimeout(t);res(ready());
      },{once:true});
    }catch(_){}
  });
}
function probeCol(){
  if(probeState!==P_UNKNOWN)return Promise.resolve(probeState);
  if(probePromise)return probePromise;
  probePromise=waitCloud(6000).then(function(ok){
    if(!ok)return P_UNKNOWN;
    return new Promise(function(res){
      var settled=false;
      function fin(v){if(settled)return;settled=true;clearTimeout(timer);res(v);}
      var timer=setTimeout(function(){fin(P_UNKNOWN);},8000);
      try{
        window.YRB_CLOUD.client.database.from("yb_cases").select("content_html").limit(1)
          .then(function(r){
            var err=r&&r.error;
            if(!err)return fin(P_YES);
            fin(colMissing(err)?P_NO:P_UNKNOWN);
          })
          .catch(function(e){fin(colMissing(e)?P_NO:P_UNKNOWN);});
      }catch(e){fin(colMissing(e)?P_NO:P_UNKNOWN);}
    });
  }).then(function(st){
    probePromise=null;
    if(st!==P_UNKNOWN)probeState=st;   /* 未知不缓存：下次发布重试 */
    return st;
  }).catch(function(){
    probePromise=null;
    return P_UNKNOWN;
  });
  return probePromise;
}

/* ---------- 发布（拦截 #cuGo，doc 模式下接管） ---------- */
function setBusy(on){
  var go=$("#cuGo");if(!go)return;
  if(on){go.disabled=true;go.textContent="正在发布…";}
  else{go.disabled=false;go.textContent="发布到案例广场";}
}
function publish(){
  if(saving)return;
  var C=window.YRB_CLOUD;
  if(!C||!C.signedIn||!C.signedIn()){
    toast("发布案例需要先登录 / 注册～");
    if(C&&C.ensureLogin)setTimeout(function(){try{C.ensureLogin();}catch(e){}},250);
    return;
  }
  if(!C.publishCase){toast("发布功能还没准备好，请稍后重试");return;}
  var titleEl=$("#cuTitle");
  var title=((titleEl&&titleEl.value)||"").trim();
  if(!title){toast("先给案例起个标题吧～");return;}
  if(title.length>MAX_TITLE)title=title.slice(0,MAX_TITLE);
  saving=true;setBusy(true);

  var cleanup=function(){
    try{
      var t=$("#cuTitle");if(t)t.value="";
      var p=paper();if(p)p.innerHTML="";
      releaseImgs();
      setEmptyTip();updateMeta();
      try{localStorage.removeItem(LS);}catch(_){}
      var seg=$('#cuTypes .seg-btn[data-t="img"]');
      if(seg)seg.click();               /* 借 app.js 的切换逻辑复位状态 */
      if(C.retryCases)C.retryCases();   /* 立即回填案例广场 */
    }catch(_){}
  };

  var finishOk=function(degraded){
    if(degraded){
      /* 正文没落库：绝不能清空编辑器。文字是用户刚写的，清掉就找不回来了 */
      try{saveDraft();}catch(_){}
      var tip=$("#ceTip");
      if(tip){
        tip.textContent="⚠️ 图片已发布，但正文没能保存。你的文字还留在上面，请先复制到备忘录，等后台升级后再发一次。";
        tip.classList.add("ce-warn");
      }
      toast("正文暂时存不上，文字已留在编辑器里");
      return;
    }
    cleanup();
    toast("图文案例已发布 🎉");
  };
  var finishFail=function(msg,silent){
    if(!silent)toast(msg||"发布没成功，请检查网络后再试一次");
  };

  var fin={html:"",items:[],chars:0}, sendItems=[], hadBody=false;

  var send=function(withBody,degradeAllowed){
    var payload=withBody
      ? {title:title,type:"img",content_html:fin.html}
      : {title:title,type:"img"};
    var pr;
    try{pr=C.publishCase(payload,sendItems);}catch(e){pr=Promise.reject(e);}
    return Promise.resolve(pr).then(function(res){
      if(res&&res.ok)return {ok:true,degraded:!withBody&&hadBody};
      if(res&&res.reason==="cancel")return {ok:false,silent:true};
      if(res&&res.reason==="auth"){
        if(C.openLogin)setTimeout(function(){try{C.openLogin();}catch(e){}},600);
        return {ok:false,msg:res.message||"登录已过期，请重新登录后再发布"};
      }
      if(res&&(res.reason==="no-cloud"||res.reason==="no-session"))
        return {ok:false,msg:"云端连接还没就绪，请等几秒再试一次"};
      if(withBody&&colMissing(res||{})){
        probeState=P_NO;
        if(degradeAllowed)return send(false,false);
      }
      return {ok:false,msg:"发布没成功："+((res&&(res.message||res.reason))||"请检查网络后再试一次")};
    },function(){
      return {ok:false,msg:"发布没成功，请检查网络后再试一次"};
    });
  };

  waitImgs(4000)
    .then(function(){fin=serialize()||{html:"",items:[],chars:0};return null;})
    .then(function(){
      if(!fin.chars&&!fin.items.length){toast("写点内容再发布吧～");return null;}
      if(fin.chars>MAX_CHARS){toast("正文超过 2 万字了，删减一点再发");return null;}
      hadBody=fin.chars>0;
      sendItems=fin.items.map(function(it,idx){
        return {blob:it.blob,kind:"img",name:"photo"+(idx+1)+".jpg"};
      });
      return probeCol().then(function(st){
        if(st===P_NO){
          /* 已知无列：直接发图片版，并如实告知正文没保存 */
          return send(false,false);
        }
        /* 有列 / 未知：先带正文发，失败时允许降级一次 */
        return send(true,true);
      }).then(function(r){
        if(r&&r.ok)finishOk(!!r.degraded);
        else if(r)finishFail(r.msg,r.silent);
      });
    })
    .catch(function(){
      finishFail("发布没成功，请检查网络后再试一次");
    })
    .then(function(){
      saving=false;setBusy(false);
    });
}

/* ---------- 查看端：图文案例正文（接管 app.js 渲染结果，不改其代码） ---------- */
var curDocCase=null;   /* 当前正在查看的图文案例；非图文时为 null */
/* 后台编辑用（2026-11-03）：把编辑区 HTML 收敛成可落库的形态。
   白名单标签保留；图片只留 data-yrb-media 序号（后台不改素材，序号仍指向原 media 数组），
   外链图 / 粘贴图一律丢弃——避免后台编辑引入来源不明的图片。 */
function sanitizeHtml(html){
  var box=document.createElement("div");
  try{
    var parsed=new DOMParser().parseFromString("<div>"+String(html||"")+"</div>","text/html");
    var root=parsed.body.firstChild||parsed.body;
    cleanInto(root,box,"view");
  }catch(_){return "";}
  return box.innerHTML;
}
function docPlainText(html){
  var box=document.createElement("div");
  try{
    var parsed=new DOMParser().parseFromString("<div>"+String(html||"")+"</div>","text/html");
    var root=parsed.body.firstChild||parsed.body;
    cleanInto(root,box,"view");
  }catch(_){return "";}
  return (box.textContent||"").replace(/\s+/g," ").trim();
}
function renderDocView(c){
  var body=$("#vwBody");if(!body)return false;
  var M=c.media||[];
  var box=document.createElement("div");
  box.className="yrb-doc-body";
  try{
    /* 上限与落库上限一致：防异常大字段把渲染卡住 */
    var raw=String(c.content_html||"").slice(0,200000);
    var parsed=new DOMParser().parseFromString("<div>"+raw+"</div>","text/html");
    var root=parsed.body.firstChild||parsed.body;
    cleanInto(root,box,"view");
  }catch(_){return false;}
  /* 正文里的图按 data-yrb-media 序号填签名地址；拿不到就整张撤掉，不留破图 */
  var list=box.querySelectorAll("img[data-yrb-media]");
  var shown=0,wanted=0;
  each(list,function(im){
    wanted++;
    var k=+im.getAttribute("data-yrb-media");
    var m=M[k];
    im.removeAttribute("data-yrb-media");
    if(m&&m.url){im.setAttribute("src",m.url);im.setAttribute("loading","lazy");im.setAttribute("alt","");shown++;}
    else if(im.parentNode)im.parentNode.removeChild(im);
  });
  if(wanted&&!shown){
    var lock=document.createElement("div");
    lock.className="yrb-doc-lock";
    lock.textContent="🔒 图片需要登录后才能查看";
    box.appendChild(lock);
  }
  /* 统计用数字，绝不把库里的原始字符串拼进 innerHTML */
  var nH=Number(c.helps)||0, nL=Number(c.likes)||0, nF=Number(c.favs)||0;
  var stats='<div class="c-stats" style="justify-content:center;font-size:13px;margin-top:10px">'+
    "<span>🤝 <b>"+nH+"</b></span>"+
    "<span>♥ <b>"+nL+"</b></span>"+
    "<span>⭐ <b>"+nF+"</b></span></div>";
  body.innerHTML="";
  body.appendChild(box);
  body.insertAdjacentHTML("beforeend",stats);
  $("#viewer").classList.add("open");
  return true;
}
function onCardClick(e){
  var card=e.target&&e.target.closest?e.target.closest(".case-card"):null;
  if(!card)return;
  var c=null;
  try{
    var i=+card.dataset.i;
    c=(typeof S!=="undefined"&&S&&S.cases)?S.cases[i]:null;
  }catch(_){c=null;}
  curDocCase=(c&&c.content_html)?c:null;   /* 非图文必须清空：朗读拦截按此放行 */
  if(!curDocCase)return;                   /* 非图文案例：不干预 app.js 的渲染 */
  renderDocView(curDocCase);
  try{
    var M=window.YRB_MEDIAFULL;
    /* 2026-11-13 用户要求「不自动阅读」：打开案例只展示正文，点头部 🔊 才念。
       自动与否的唯一开关在 mediafull.js 的 AUTO_READ（此处只读，不再看旧跟读胶囊）。 */
    if(M&&M.speak&&M.autoRead&&M.autoRead.enabled())speakDocNow(0);
  }catch(_){}
}
/* 朗读开关的两处历史说明（保留备查）：
   · 11-13 前：受 #mfAuto 跟读胶囊（localStorage yrb_autospeak）控制——胶囊已随自动朗读整体下线；
   · 手动路径不变：点查看器头部 🔊 → onTtsClick → mediafull.speak。 */
/* 朗读接管：mediafull 的 speakCase 只认识 slides（旧静态案例），图文正文读不出来。
   capture 阶段拦下查看器朗读按钮，把「标题+正文纯文本」交给 YRB_MEDIAFULL.speak
   （其内部自带再点停止、分段播放、云端转本机兜底与按钮状态，全部复用）。 */
function onTtsClick(e){
  var b=e.target&&e.target.closest?e.target.closest(".vw-head .mf-tts"):null;
  if(!b||!curDocCase)return;
  e.preventDefault();e.stopPropagation();
  var title=($("#vwTitle")||{}).textContent||"";
  var txt=docPlainText(curDocCase.content_html);
  if(!txt){try{window.toast("这一篇没有可朗读的文字");}catch(_){}return;}
  var full=(title&&txt.slice(0,40).indexOf(title)!==0)?title+"。"+txt:txt;
  var M=window.YRB_MEDIAFULL;
  if(M&&M.speak){
    try{M.speak(full,b,false,"case");}catch(_){}
  }
}

/* ---------- 双击全屏朗读（2026-11-03） ----------
   为什么：案例广场的卡片文字小，点开后的正文还在一个带边距的圆角卡片里；
   长辈要「放大 + 有人念」。所以双击（快速两下）就一步到位：撑满屏幕 + 自动朗读。
   行为：
   · 案例广场里双击卡片文字 → 打开后直接全屏朗读（app.js 的单击照旧只是打开）
   · 查看器里双击正文 → 进全屏并朗读；再双击 = 退出全屏（朗读继续，按头部 🔊 才停）
   · 只有「有正文的图文案例」才进全屏，视频/图片案例保持原样，不做无意义的放大
   实现要点：单击已经被 app.js 用来打开案例，dblclick 事件到不了卡片（第一下就浮层遮住了），
   所以自己数「两次 pointerdown」：第二下落在查看器上也认，第二下仍落在卡片上也认。 */
var fsOn=false, lastTap=null, fsTimer=null, fsGuardUntil=0;
var ceHist=0, ceExitAt=0;                   /* 全屏时押在历史栈里的「返回垫片」 */
/* ---------- 系统返回（侧滑 / 返回键）接管：退回全屏前的样子，而不是退出应用 ----------
   与 mediafull 里 pfHistPush 同一思路，两层各自管自己的垫片（history.state 只用于观测）。
   2026-11-03 用户反馈「全屏里左右滑，整个 APP 退出了」：安卓微信/X5、系统 WebView、iOS Safari
   的边缘侧滑都是 WebView 后退，历史栈只有一条时退一格就出了页面。 */
function ceHistPush(){
  if(ceHist)return;
  try{history.pushState({yrbCase:1},"");ceHist=1;}catch(_){}
}
try{
  window.addEventListener("popstate",function(){
    if(!ceHist)return;
    ceHist=0;
    if(fsOn){fsExit();return;}                       /* 全屏中返回 → 回到查看器（上一级） */
    if(Date.now()-ceExitAt<900)return;               /* 刚自己退出过：同一次手势，别再退一格 */
    try{history.back();}catch(_){}
  });
}catch(_){}
/* 双击窗口：卡片的第二下要等查看器的 250ms 打开动画，实测常到 400-500ms，
   所以「卡片 → 遮罩」这一档放到 800ms；查看器内部双击按常规 500ms */
var TAP_MS=650, CARD_MS=800;

function speakDocNow(tries,force){
  var c=curDocCase; if(!c)return false;
  var title=($("#vwTitle")||{}).textContent||(c.t||"");
  var txt=docPlainText(c.content_html);
  if(!txt)return false;
  var full=(title&&txt.slice(0,40).indexOf(title)!==0)?title+"。"+txt:txt;
  var btn=$(".vw-head .mf-tts");
  if(btn&&btn.classList.contains("on")){
    if(!force)return true;                               /* 已经在读：不打断，只换显示方式 */
    /* 全屏重读：但同篇刚开读不到一瞬（<800ms）就别重发了——这时用户其实什么都没听到，
       「从头」已经是事实，重发只会更慢 */
    if(lastRead&&lastRead.txt===full&&Date.now()-lastRead.t<800)return true;
    try{var M0=window.YRB_MEDIAFULL;if(M0&&M0.stopSpeak)M0.stopSpeak();}catch(_){}
  }
  var M=window.YRB_MEDIAFULL;
  if(M&&M.speak){
    /* 不再等 🔊 按钮注入：按钮晚到时 mediafull 会自动把状态补到新按钮上，先出声要紧 */
    try{lastRead={t:Date.now(),txt:full};M.speak(full,btn||null,false,"case");return true;}catch(_){}
  }
  return false;
}
var lastRead=null;
function fsTip(){
  try{
    var v=$("#viewer");if(!v||$("#vwFsTip"))return;
    var d=document.createElement("div");
    d.id="vwFsTip";d.textContent="再双击文字可退出全屏";
    v.appendChild(d);
    setTimeout(function(){try{if(d.parentNode)d.parentNode.removeChild(d);}catch(_){}},2600);
  }catch(_){}
}
function fsEnter(){
  var v=$("#viewer");
  if(!v||fsOn||!v.classList.contains("open"))return;
  fsOn=true;v.classList.add("vw-fs");
  ceHistPush();                                     /* 押垫片：系统返回只退全屏，不出页面 */
  /* 顶部已经写着标题，正文第一行又是同一句：全屏时省掉重复那行，别让长辈以为是两篇 */
  try{
    var h=$(".yrb-doc-body h1,.yrb-doc-body h2,.yrb-doc-body h3");
    if(h){
      var a=(h.textContent||"").replace(/\s+/g,"");
      var t=(($("#vwTitle")||{}).textContent||"").replace(/\s+/g,"");
      if(a&&t&&a===t)h.classList.add("vw-dup");
    }
  }catch(_){}
  /* 2026-11-03 晚：不再调原生 requestFullscreen。
     安卓微信/X5 里它常被系统在几百毫秒后自己退出，退出瞬间重算视口会把页面挤偏
     （用户看到「左边多出半截画面」）；视觉全屏靠 .vw-fs 撑满即可。 */
  fsTip();
}
function fsExit(){
  if(!fsOn)return;
  fsOn=false;ceExitAt=Date.now();
  try{var v=$("#viewer");if(v)v.classList.remove("vw-fs");}catch(_){}
  try{each(document.querySelectorAll(".vw-dup"),function(n){n.classList.remove("vw-dup");});}catch(_){}
  try{var t=$("#vwFsTip");if(t&&t.parentNode)t.parentNode.removeChild(t);}catch(_){}
}
/* 自动是否朗读：2026-11-13 起统一由 mediafull 的 AUTO_READ 裁决（现为 false）。
   双击 = 显式「放大」手势，不再顺带朗读——要听就点查看器头部 🔊。 */
function autoReadOn(){
  try{var M=window.YRB_MEDIAFULL;return !!(M&&M.autoRead&&M.autoRead.enabled());}catch(_){return false;}
}
/* 等第一下的渲染落地（app.js → casedit 依次跑完）再进全屏；最多试 6 次，约 0.5 秒 */
function fsPending(tries){
  tries=tries||0;
  clearTimeout(fsTimer);
  fsTimer=setTimeout(function(){
    var v=$("#viewer");
    if(!v||!v.classList.contains("open")){if(tries<6)fsPending(tries+1);return;}
    if(!curDocCase)return;                 /* 视频/图片案例：不进全屏，也不读 */
    fsEnter();
    if(autoReadOn())speakDocNow(0,true);   /* 仅自动朗读开启时：强制从头重读 */
  },tries?90:70);
}
function fsToggle(){
  if(fsOn){fsExit();return;}
  fsEnter();
  if(autoReadOn())speakDocNow(0,true);     /* 仅自动朗读开启时：进全屏从头再读一遍 */
}
/* 手指按下案例卡片的一瞬就开始合成第一段语音（比 click 早一百来毫秒），
   mediafull 会缓存；真正打开朗读时直接用现成音频。滚动时 mediafull 自动作废。
   2026-11-13：不自动朗读后，按下并不代表要听——预取会替「只是想看看」的人
   白拉一整篇语音（老年用户流量敏感），改为只有点 🔊 时才取（无缓存则首段稍慢）。 */
function preTouch(card){
  return;                                  /* 预取下线；恢复自动朗读时把此 return 删掉即可 */
}
function onFsDown(e){
  if(e&&e.button!==undefined&&e.button!==0)return;       /* 只认左键 / 单指 */
  var t=e&&e.target;
  if(!t||!t.closest)return;
  var now=Date.now();
  var card=t.closest(".case-card");
  if(card){
    try{preTouch(card);}catch(_){}                          /* 按下即预取语音，打开就立即有 */
    var same=!!(lastTap&&lastTap.kind==="card"&&lastTap.el===card&&(now-lastTap.t)<TAP_MS);
    lastTap={t:now,kind:"card",el:card};
    if(same){fsGuardUntil=now+CARD_MS+100;fsPending(0);}  /* 第二下没被浮层吃掉：同样算双击 */
    return;
  }
  var inV=t.closest("#viewer");
  if(inV){
    if(t.closest("button,a,input,textarea,select,video"))return;   /* 按钮/链接自己处理 */
    var fromCard=!!(lastTap&&lastTap.kind==="card"&&(now-lastTap.t)<CARD_MS);
    if(fromCard){lastTap=null;fsGuardUntil=now+CARD_MS+100;fsPending(0);return;} /* 第二下落在刚打开的查看器上 */
    var twice=!!(lastTap&&lastTap.kind==="viewer"&&(now-lastTap.t)<TAP_MS);
    lastTap={t:now,kind:"viewer"};
    if(twice){
      lastTap=null;              /* 一击只算一次双击：否则「双击→停顿→双击」会被连成一串，进又立刻退 */
      /* 退出全屏会让卡片一下缩回中间：双击的第二下会落到遮罩上被当成「关闭」，
         一并吃掉，否则「退出全屏」等于「关掉案例」 */
      if(fsOn)fsGuardUntil=now+600;
      fsToggle();
    }
    return;
  }
  lastTap=null;
}
function wireFs(){
  try{document.addEventListener("pointerdown",onFsDown,true);}catch(_){}
  /* 双击的第二下若落在卡片外的遮罩上，app.js 会当成「点遮罩关闭」把刚打开的查看器关掉，
     全屏就永远进不去。识别为双击后半段时把这一下吃掉（600ms 内，且必须是遮罩本身） */
  try{
    document.addEventListener("click",function(e){
      if(Date.now()>fsGuardUntil)return;
      var t=e.target;
      if(!t||!t.closest||!t.closest("#viewer"))return;
      if(t.closest(".vw-card"))return;                    /* 卡内点击照常 */
      e.preventDefault();e.stopPropagation();
    },true);
  }catch(_){}
  /* 关闭查看器 / 按 Esc 退出原生全屏 → 收掉全屏类，避免下次打开「还是全屏」 */
  try{
    document.addEventListener("click",function(e){
      var x=e.target&&e.target.closest?e.target.closest("#vwX"):null;
      if(x)fsExit();
    },true);
  }catch(_){}
  try{
    /* 全屏态只跟随查看器自身的 .open，不再跟随浏览器 fullscreenchange：
       2026-11-03 晚去掉原生全屏后，系统级 fullscreenchange 与视觉全屏已无关系，
       留着反而会在某些浏览器按 F11/手势时把阅读态误关掉 */
    var v=$("#viewer");
    if(v)new MutationObserver(function(){
      if(!v.classList.contains("open")&&fsOn)fsExit();
      /* 查看器被正常关掉（点 ✕ / 点遮罩）：把垫片还回去，
         否则下次按系统返回键会有一下「按了没反应」 */
      if(!v.classList.contains("open")&&ceHist){ceHist=0;try{history.back();}catch(_){}}
    }).observe(v,{attributes:true,attributeFilter:["class"]});
  }catch(_){}
}

/* ---------- 事件接线（全部委托，不改 app.js 任何结构） ---------- */
function wire(){
  /* 类型切换：app.js 的处理器先跑（S.cuType/格线），本层随后修 UI */
  document.addEventListener("click",function(e){
    var b=e.target&&e.target.closest?e.target.closest("#cuTypes .seg-btn"):null;
    if(!b)return;
    if(b.dataset.t==="doc")activate();else deactivate();
  });
  /* 发布拦截：capture 阶段先于 app.js 的 #cuGo 处理器 */
  document.addEventListener("click",function(e){
    if(!active)return;
    var go=e.target&&e.target.closest?e.target.closest("#cuGo"):null;
    if(!go)return;
    e.preventDefault();e.stopPropagation();
    publish();
  },true);
  /* 工具条：mousedown 阻止默认，保住编辑区选区 */
  document.addEventListener("mousedown",function(e){
    var b=e.target&&e.target.closest?e.target.closest("#ceBar [data-ce],#ceBar label.ce-img-btn"):null;
    if(b)e.preventDefault();
  });
  document.addEventListener("click",function(e){
    var b=e.target&&e.target.closest?e.target.closest("#ceBar [data-ce]"):null;
    if(!b)return;
    restoreSel();
    var cmd=b.getAttribute("data-ce");
    try{
      if(cmd==="bold")document.execCommand("bold",false,null);
      else if(cmd==="h3"){
        var blk="P";
        try{blk=(document.queryCommandValue&&/^h3$/i.test(String(document.queryCommandValue("formatBlock")||"")))?"P":"H3";}catch(_){}
        document.execCommand("formatBlock",false,blk);
      }
      else if(cmd==="center")document.execCommand("justifyCenter",false,null);
    }catch(err){}
    trackSel();setEmptyTip();updateMeta();scheduleSave();
  });
  document.addEventListener("selectionchange",trackSel);
  /* 插图：label 原生触发（微信 X5 兼容），change 委托处理 */
  document.addEventListener("change",function(e){
    var t=e.target;
    if(!t||t.id!=="ceImg")return;
    var files=[];try{files=[].slice.call(t.files||[]);}catch(_){}
    t.value="";
    if(!files.length)return;
    compressAll(files).then(insertImages,function(){insertImages(files);});
  });
  /* 粘贴 + 输入 */
  document.addEventListener("paste",handlePaste,true);
  document.addEventListener("drop",handleDrop,true); /* 审核 M8：拖入与粘贴同一条白名单管道 */
  document.addEventListener("dragover",function(e){
    if(!active)return;var p=paper();
    if(p&&p.contains(e.target))e.preventDefault(); /* 允许 drop 且屏蔽浏览器默认打开文件 */
  },true);
  document.addEventListener("input",function(e){
    if(e.target&&e.target.id==="cePaper"){setEmptyTip();updateMeta();scheduleSave();}
  });
  document.addEventListener("blur",function(e){
    if(e.target&&e.target.id==="cePaper")saveDraft();
  },true);
  /* 关页/切后台立即落盘：防抖窗口内的输入不丢 */
  window.addEventListener("pagehide",function(){try{saveDraft();}catch(_){}});
  document.addEventListener("visibilitychange",function(){
    if(document.visibilityState==="hidden"){try{saveDraft();}catch(_){}}
  });
  /* 查看端接管（冒泡阶段，晚于 #caseGrid 的 openViewer） */
  document.addEventListener("click",onCardClick);
  /* 查看器朗读按钮（capture 阶段先于 mediafull 的按钮监听） */
  document.addEventListener("click",onTtsClick,true);
  /* 双击全屏朗读（见上方「双击全屏朗读」一节） */
  wireFs();
}

/* ---------- 启动：DOM 就绪后注入 ---------- */
var bootTry=0;
function boot(){
  var bar=$("#cuTypes");
  if(!bar){
    if(++bootTry>60)return;          /* 最多约 18 秒，之后放弃（不再无限空转） */
    setTimeout(boot,300);return;
  }
  if(!$("#ceBtn")){
    var b=document.createElement("button");
    b.type="button";b.className="seg-btn";b.dataset.t="doc";b.id="ceBtn";
    b.innerHTML='<span class="si">📝</span>图文';
    bar.appendChild(b);
  }
  if(!$("#cePanel")){
    var grid=$("#cuGrid"),file=$("#cuFile");
    var pan=document.createElement("div");
    pan.id="cePanel";pan.hidden=true;
    pan.innerHTML=
      '<div class="ce-bar" id="ceBar">'+
        '<button type="button" data-ce="bold" title="加粗" class="ce-b">B</button>'+
        '<button type="button" data-ce="h3" title="小标题">小标题</button>'+
        '<button type="button" data-ce="center" title="居中">居中</button>'+
        '<label class="ce-img-btn" title="插图">📷 插图<input type="file" id="ceImg" accept="image/*" multiple hidden></label>'+
      '</div>'+
      '<div class="ce-paper ce-empty" id="cePaper" contenteditable="true" data-ph="在这里写案例正文…可以直接打字，也可以把文字和图片粘贴进来"></div>'+
      '<div class="ce-tip" id="ceTip">可以直接打字，也可以粘贴文字和图片（自动压缩）· 草稿自动保存</div>';
    if(file&&file.parentNode)file.parentNode.insertBefore(pan,file);
    else if(grid&&grid.parentNode)grid.parentNode.insertBefore(pan,grid.nextSibling);
  }
  wire();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot);
else boot();

/* 可检测标志：health.js 探针与自愈补载据此判断本层是否存活（增强层惯例） */
try{window.YRB_CASED={version:4,ready:function(){return !!$("#cePanel");},sanitize:sanitizeHtml};}catch(_){}
})();
