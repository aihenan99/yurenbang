/* ============================================================
   pptview.js — PPT 在线翻页浏览层（2026-10-22）
   点开 PPT 案例时自动下载并逐页展开浏览（上一页/下一页/滑动翻页/放大）。
   - 渲染引擎：assets/vendor/pptx-preview.umd.js（按需懒加载，约 1.3MB，
     仅在第一次打开 PPT 时下载，之后走浏览器缓存）
   - 解析结果按文件地址缓存（最多 3 份）：关掉再看秒开
   - 任何失败（旧版 .ppt / 加密文件 / 网络问题）都降级为「打开文件」卡片，
     绝不阻塞查看器
   用法：YRB_PPT.mount(容器元素, {url, name})
   ============================================================ */
(function(){
"use strict";
var LIB="assets/vendor/pptx-preview.umd.js";
var ZIP="assets/vendor/jszip.min.js";
var libP=null;

function esc(s){return String(s||"").replace(/[&<>"']/g,function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];});}

function loadLib(){
  var needEngine=!window.pptxPreview, needZip=!window.JSZip;
  if(!needEngine&&!needZip)return Promise.resolve();
  if(libP)return libP;
  libP=new Promise(function(res,rej){
    var pend=0,fail=null;
    function done(){ if(--pend===0){ fail?rej(fail):res(); } }
    if(needEngine){pend++;var s=document.createElement("script");
      s.src=LIB;s.onload=done;
      s.onerror=function(){libP=null;fail=new Error("渲染库加载失败");done();};
      document.head.appendChild(s);}
    if(needZip){pend++;var z=document.createElement("script");
      z.src=ZIP;z.onload=done;
      z.onerror=function(){libP=null;fail=new Error("解压库加载失败");done();};
      document.head.appendChild(z);}
  });
  return libP;
}

/* ---------- 打开前预处理：清洗 [Content_Types].xml ----------
   不少工具（WPS 部分版本、pptxgenjs 等）导出的 pptx 会在
   [Content_Types].xml 里声明包内实际不存在的部件，渲染引擎遇到这种
   文件会把解析异常整个吞掉、表现为"一页都读不出来"。
   这里在交给引擎前先把这些"幽灵声明"删掉，并把修复过程暴露出来。 */
function sanitize(buf){
  if(!window.JSZip)return Promise.resolve(buf);
  return JSZip.loadAsync(buf).then(function(z){
    var f=z.file("[Content_Types].xml");
    if(!f)return buf;                       /* 没有声明表：原样交给引擎 */
    return f.async("text").then(function(txt){
      var removed=[];
      var txt2=txt.replace(/<Override PartName="([^"]+)"[^>]*\/>/g,function(m,part){
        var p=part.charAt(0)==="/"?part.slice(1):part;
        if(z.files[p]||z.files[p+"/"])return m;
        removed.push(p);return "";
      });
      if(!removed.length)return buf;
      try{console.warn("[pptview] 清洗幽灵声明：",removed.join(", "));}catch(e){}
      var out=new JSZip(),jobs=[];
      Object.keys(z.files).forEach(function(k){
        if(z.files[k].dir)return;
        jobs.push(z.files[k].async("uint8array").then(function(d){out.file(k,d);}));
      });
      return Promise.all(jobs).then(function(){
        out.file("[Content_Types].xml",txt2);
        return out.generateAsync({type:"uint8array",compression:"DEFLATE"});
      });
    });
  }).catch(function(e){
    /* zip 都打不开：多半是旧版 .ppt 改了扩展名、或文件被加密 */
    throw new Error("not-zip");
  });
}

/* ---------- PPT 全文提取（mediafull 朗读层调用，2026-10-24） ----------
   直接解 zip 读 ppt/slides/slideN.xml 里的 <a:t> 文本段，按页分组返回。
   比从渲染 SVG 里抠文字可靠得多（渲染只画当前页，XML 里有全部页）。
   页序按 slideN 数字排序（标准导出的编号与页序一致）。 */
var textCache=new Map();                       /* url -> [每页文本] */
function xmlDecode(s){
  return String(s||"")
    .replace(/&lt;/g,"<").replace(/&gt;/g,">")
    .replace(/&quot;/g,"\"").replace(/&apos;/g,"'")
    .replace(/&#(\d+);/g,function(m,d){try{return String.fromCharCode(+d);}catch(e){return m;}})
    .replace(/&amp;/g,"&");                    /* &amp; 必须最后解码 */
}
function extractText(buf){
  if(!window.JSZip)return Promise.reject(new Error("no-zip"));
  return JSZip.loadAsync(buf).then(function(z){
    var names=Object.keys(z.files).filter(function(k){
      return /^ppt\/slides\/slide\d+\.xml$/.test(k)&&!z.files[k].dir;
    }).sort(function(a,b){
      return (parseInt(a.replace(/\D+/g,""),10)||0)-(parseInt(b.replace(/\D+/g,""),10)||0);
    });
    if(!names.length)return [];
    return Promise.all(names.map(function(k){return z.files[k].async("text");}))
      .then(function(docs){
        return docs.map(function(doc){
          var paras=doc.split(/<\/a:p>/);       /* 按 XML 段落切 */
          var lines=paras.map(function(p){
            var runs=p.match(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)||[];
            return runs.map(function(r){
              return xmlDecode(r.replace(/^<a:t(?:\s[^>]*)?>/,"").replace(/<\/a:t>$/,""));
            }).join("");
          }).filter(function(s){return s.trim();});
          return lines.join("，").trim();
        });
      });
  });
}
function putTextCache(url,pages){
  try{
    if(textCache.has(url))textCache.delete(url);
    textCache.set(url,pages);
    while(textCache.size>5)textCache.delete(textCache.keys().next().value);
  }catch(e){}
}
/* 取某个 PPT 文件的全部页面文字（已提取过直接返回；没提取过现场下载提取。
   签名地址过期（HTTP 4xx）时与 mount 同策略：用 path 重签后再试一次） */
function pagesFor(url,path){
  if(!url)return Promise.reject(new Error("no-url"));
  if(textCache.has(url))return Promise.resolve(textCache.get(url));
  return loadLib().then(function(){          /* JSZip 懒加载：朗读层可能先于引擎单独调用 */
    return getBuf(url);
  }).catch(function(err){
    var m=(err&&err.message)||"";
    if(path&&/HTTP 4\d\d/.test(m)&&window.YRB_CLOUD&&YRB_CLOUD.resignUrl){
      return YRB_CLOUD.resignUrl(path).then(function(u2){
        if(!u2)throw err;
        url=u2;
        return getBuf(u2);
      });
    }
    throw err;
  }).then(function(buf){
    return extractText(buf);
  }).then(function(pages){
    putTextCache(url,pages);
    return pages;
  });
}

/* 同一文件解析结果缓存：最多 3 份 */
var cache=new Map();
function getBuf(url){
  if(cache.has(url)){var v=cache.get(url);cache.delete(url);cache.set(url,v);return Promise.resolve(v);}
  return new Promise(function(res,rej){
    var xhr=new XMLHttpRequest();
    xhr.open("GET",url,true);xhr.responseType="arraybuffer";
    var to=setTimeout(function(){try{xhr.abort();}catch(e){}rej(new Error("下载超时"));},30000);
    xhr.onload=function(){clearTimeout(to);
      if(xhr.status>=200&&xhr.status<300&&xhr.response&&xhr.response.byteLength)res(xhr.response);
      else rej(new Error("HTTP "+xhr.status));};
    xhr.onerror=function(){clearTimeout(to);rej(new Error("网络错误"));};
    xhr.send();
  });
}
function putCache(url,buf){
  try{
    if(cache.has(url))cache.delete(url);
    cache.set(url,buf);
    while(cache.size>3)cache.delete(cache.keys().next().value);
  }catch(e){}
}
/* 当前正在自动播放的实例停止器（同一时间只允许一个） */
var active=null;

function mount(stage,file){
  if(!stage)return;
  file=file||{};
  var name=file.name||"演示文件";
  /* 打开新案例时先停掉上一个 PPT 的自动播放，避免两个计时器同时翻页 */
  if(active){try{active();}catch(e){}active=null;}
  /* 全屏阅读要用：当前已解析的文件内容与真实宽高比 */
  var lastBuf=null,lastRatio=9/16;

  /* PDF / 旧版 .ppt 不走 pptx 渲染，直接给文件卡片 */
  if(/\.pdf$/i.test(name)){
    stage.innerHTML=failHTML(file,"PDF 暂不支持在线翻页浏览，敬请期待");
    return;
  }
  if(/\.ppt$/i.test(name)&&!/\.pptx$/i.test(name)){
    stage.innerHTML=failHTML(file,"旧版 .ppt 暂不支持在线翻页，在电脑上另存为 .pptx 后再上传即可");
    return;
  }

  var W=Math.min(Math.max(stage.clientWidth||346,260),520);
  stage.innerHTML='<div class="vp-load"><span class="vp-spin"></span>正在展开 PPT，请稍候…</div>';

  /* 下载；若签名地址过期（HTTP 4xx）且知道云端 path，自动重新签名再试一次 */
  function fetchBuf(){
    return getBuf(file.url).catch(function(err){
      var m=(err&&err.message)||"";
      if(file.path&&/HTTP 4\d\d/.test(m)&&window.YRB_CLOUD&&YRB_CLOUD.resignUrl){
        try{console.warn("[pptview] 签名地址失效，重新签名后重试");}catch(e){}
        return YRB_CLOUD.resignUrl(file.path).then(function(u2){
          if(!u2)throw err;
          file.url=u2;
          return getBuf(u2);
        });
      }
      throw err;
    });
  }

  loadLib().then(function(){return fetchBuf();  }).then(function(buf){
    putCache(file.url,buf);
    /* 先清洗 [Content_Types].xml 再交给引擎（WPS 等工具常见"幽灵声明"） */
    return sanitize(buf).then(function(b2){lastBuf=b2;
      /* 预热全文缓存：朗读层点 🔊 时就不用再下载解包 */
      extractText(b2).then(function(pages){putTextCache(file.url,pages);})
        .catch(function(e){try{console.warn("[pptview] 全文提取失败（不影响浏览）",e);}catch(e2){}});
      return build(b2,9/16,0);});
  }).catch(function(err){
    var m=(err&&err.message)||String(err||"");
    try{console.warn("[pptview] 展开失败：",err&&(err.stack||err.message)||err);}catch(e){}
    var tip;
    if(m==="not-zip")
      tip="这个文件不是有效的 .pptx（可能已加密，或其实是旧版 .ppt 改了名字），请重新上传 .pptx";
    else if(m==="empty")
      tip="文件里没能读出页面，可能是特殊版本 WPS 导出的格式，请重新另存为 .pptx 后上传";
    else if(/下载超时|HTTP|网络/.test(m))
      tip="内容下载没成功（"+m+"），请稍后重试";
    else
      tip="内容展开失败，请稍后重试或联系管理员";
    stage.innerHTML=failHTML(file,tip);
  });

  /* 2026-10-24 内容保护：非管理员不再暴露原文件入口（打开=可下载）。
     管理员判定与 protect 层同一套（后台豁免）。 */
  function adminOpen(){
    try{ if(window.YRB_CONSOLE&&YRB_CONSOLE.isAdmin&&YRB_CONSOLE.isAdmin())return true; }catch(e){}
    try{ if(window.YRB_ADMINGUARD&&YRB_ADMINGUARD.unlocked&&YRB_ADMINGUARD.unlocked())return true; }catch(e){}
    return false;
  }
  function failHTML(f,msg){
    return '<div class="vp-fail"><b>📄</b><span>'+esc(name)+'</span>'+
      (adminOpen()&&f&&f.url?'<a class="btn-a" href="'+esc(f.url)+'" target="_blank" rel="noopener">打开文件</a>':'')+
      '<i>'+esc(msg||"")+'</i></div>';
  }

  /* 建一个指定比例的预览器并渲染（rebuild 只在比例不符时发生一次） */
  function build(buf,ratio,depth){
    return new Promise(function(res,rej){
      var host=document.createElement("div");host.className="vp-fit";
      stage.innerHTML="";stage.appendChild(host);
      var pv;
      try{
        pv=window.pptxPreview.init(host,{width:W,height:Math.round(W*ratio),mode:"slide"});
      }catch(e){return rej(e);}
      pv.preview(buf).then(function(){
        try{
          if(!pv.slideCount)return rej(new Error("empty"));
          /* 演示文稿真实比例与 16:9 差得多时，按真实比例重建一次 */
          var w=(pv.pptx&&pv.pptx.width)||0,h=(pv.pptx&&pv.pptx.height)||0;
          if(w&&h&&depth<1){
            var r=h/w;
            if(Math.abs(r-9/16)>0.04){build(buf,r,depth+1).then(res,rej);return;}
          }
          lastRatio=ratio;
          res(pv);
        }catch(e){rej(e);}
      }).catch(rej);
    });
  }

  /* 渲染成功后接线：自动播放翻页 + 大按钮翻页 + 滑动翻页 + 放大 */
  function wire(pv){
    var scroll=document.createElement("div");scroll.className="vp-scroll";
    var fit=stage.querySelector(".vp-fit");
    stage.innerHTML="";
    scroll.appendChild(fit);stage.appendChild(scroll);

    var prog=document.createElement("div");prog.className="vp-prog";
    prog.innerHTML="<i></i>";
    var nav=document.createElement("div");nav.className="vp-nav";
    nav.innerHTML='<button class="vp-btn" data-a="prev">‹ 上一页</button>'+
      '<span class="vp-num"></span>'+
      '<button class="vp-btn" data-a="next">下一页 ›</button>';
    var tools=document.createElement("div");tools.className="vp-tools";
    /* 「📂 打开文件」只给管理员（内容保护：普通用户不能拿到原文件） */
    tools.innerHTML='<button class="vp-tool" data-a="full">⛶ 全屏阅读</button>'+
      '<button class="vp-tool" data-a="play">⏸ 暂停</button>'+
      '<button class="vp-tool" data-a="speed">⏱ 6 秒/页</button>'+
      (adminOpen()&&file.url?'<a class="vp-tool" href="'+esc(file.url)+'" target="_blank" rel="noopener">📂 打开文件</a>':'');
    stage.appendChild(prog);stage.appendChild(nav);stage.appendChild(tools);

    var playBtn=tools.querySelector("[data-a='play']");
    var speedBtn=tools.querySelector("[data-a='speed']");
    var bar=prog.querySelector("i");

    /* ---------------- 自动播放 ---------------- */
    var SPEEDS=[6,9,12];          /* 秒/页，长辈可调到更慢 */
    var si=0, secs=SPEEDS[0];
    var timer=null, mode="paused";  /* playing | paused | ended */

    function num(){
      var n=nav.querySelector(".vp-num");
      if(n)n.textContent="第 "+(pv.currentIndex+1)+" 页 / 共 "+pv.slideCount+" 页";
    }
    function mark(m){
      mode=m;
      if(playBtn)playBtn.textContent=m==="playing"?"⏸ 暂停":(m==="ended"?"▶ 重播":"▶ 继续");
      if(prog)prog.classList.toggle("off",m!=="playing");
    }
    function stopTimer(){ if(timer){clearInterval(timer);timer=null;} }
    function restProg(){
      if(!bar)return;
      try{
        bar.style.transition="none";bar.style.width="0%";
        void bar.offsetWidth;                      /* 强制重排，让动画重新开始 */
        bar.style.transition="width "+secs+"s linear";bar.style.width="100%";
      }catch(e){}
    }
    function holdProg(){
      if(!bar)return;
      try{
        var w=bar.getBoundingClientRect().width;
        bar.style.transition="none";bar.style.width=w+"px";
      }catch(e){}
    }
    function tick(){
      if(!scroll.isConnected){stopTimer();return;}   /* 查看器已关闭：收掉计时器 */
      if(pv.currentIndex>=pv.slideCount-1){          /* 最后一页：停下并等待重播 */
        stopTimer();holdProg();mark("ended");return;
      }
      try{pv.renderNextSlide();}catch(e){stopTimer();mark("paused");return;}
      num();restProg();
    }
    function play(){
      stopTimer();
      if(pv.currentIndex>=pv.slideCount-1){          /* 已到末页 → 从头重播 */
        try{pv.renderSingleSlide(0);}catch(e){}
        num();
      }
      mark("playing");
      timer=setInterval(tick,secs*1000);
      restProg();
    }
    function pause(){
      stopTimer();holdProg();mark("paused");
    }

    /* ---------------- 手动翻页 ---------------- */
    function go(d){
      try{
        if(scroll.classList.contains("zoom"))return;
        if(d>0)pv.renderNextSlide();else pv.renderPreSlide();
        num();
        pause();          /* 手动翻页即接管：暂停自动播放，用户可点「▶ 继续」 */
      }catch(e){}
    }
    nav.addEventListener("click",function(e){
      var b=e.target.closest("[data-a]");if(!b)return;
      go(b.dataset.a==="next"?1:-1);
    });
    tools.addEventListener("click",function(e){
      var b=e.target.closest("[data-a]");
      if(!b)return;
      var a=b.dataset.a;
      if(a==="play"){ (mode==="playing")?pause():play(); return; }
      if(a==="speed"){
        si=(si+1)%SPEEDS.length;secs=SPEEDS[si];
        b.textContent="⏱ "+secs+" 秒/页";
        if(mode==="playing")play();
        return;
      }
      if(a==="full"){openFull();return;}
    });
    /* ---------------- 全屏阅读（2026-10-23） ----------------
       竖屏：撑满屏宽；Android 申请系统横屏锁定（Fullscreen API + orientation.lock），
       横屏后 PPT 宽度≈屏高×16/9，字号约为卡片里的 2 倍；
       iOS/微信不支持锁横屏：CSS 全屏层 + 提示「横过来手机字更大」，转屏自动重渲染 */
    function openFull(){
      if(!lastBuf){try{toast("还在准备内容，请稍等一两秒")}catch(e){}return;}
      var old=document.getElementById("vpFull");if(old)old.remove();
      var layer=document.createElement("div");layer.id="vpFull";
      layer.innerHTML=
        '<div class="vf-head"><b class="vf-name">'+esc(name)+'</b>'+
        '<button class="vf-x" type="button" aria-label="退出全屏">✕</button></div>'+
        '<div class="vf-body"><div class="vf-load"><span class="vp-spin"></span>正在放大，请稍候…</div></div>'+
        '<div class="vf-foot"><button class="vf-btn" data-a="prev">‹ 上一页</button>'+
        '<span class="vf-num"></span>'+
        '<button class="vf-btn" data-a="next">下一页 ›</button></div>'+
        '<div class="vf-tip">📱 手机横过来，字会大一倍</div>';
      document.body.appendChild(layer);
      pause();                                   /* 卡片里的自动播放先停 */

      var body=layer.querySelector(".vf-body");
      var numEl=layer.querySelector(".vf-num");
      var alive=true,pv2=null,rt=0;

      function pwFor(){
        var w=window.innerWidth||360,h=window.innerHeight||640;
        return Math.max(240,Math.min(w,h/lastRatio));
      }
      function num(){
        if(numEl&&pv2)numEl.textContent="第 "+(pv2.currentIndex+1)+" 页 / 共 "+pv2.slideCount+" 页";
      }
      function failFull(msg){
        if(!alive)return;
        body.innerHTML='<div class="vf-load">'+esc(msg||"全屏展开失败")+
          '<button class="vf-btn" data-a="close" style="margin-left:10px">关闭</button></div>';
      }
      function renderOnce(idx){
        if(!alive)return;
        var w=Math.round(pwFor());
        var host=document.createElement("div");host.className="vp-fit vf-fit";
        body.innerHTML="";body.appendChild(host);
        try{
          pv2=window.pptxPreview.init(host,{width:w,height:Math.round(w*lastRatio),mode:"slide"});
        }catch(e){return failFull();}
        pv2.preview(lastBuf).then(function(){
          if(!alive)return;
          try{ if(idx>0&&pv2)pv2.renderSingleSlide(idx); }catch(e){}
          num();
        }).catch(function(){failFull("全屏展开失败，可关闭后重试");});
      }
      function go(d){
        if(!pv2)return;
        try{ if(d>0)pv2.renderNextSlide();else pv2.renderPreSlide(); num(); }catch(e){}
      }
      function closeFull(){
        if(!alive)return;alive=false;
        window.removeEventListener("resize",onRes);
        window.removeEventListener("orientationchange",onRes);
        try{ if(document.fullscreenElement&&document.exitFullscreen)document.exitFullscreen(); }catch(e){}
        try{ if(screen.orientation&&screen.orientation.unlock)screen.orientation.unlock(); }catch(e){}
        layer.remove();
        play();                                  /* 回到卡片视图继续自动播放 */
      }
      function onRes(){clearTimeout(rt);rt=setTimeout(function(){
        if(!alive)return;
        var host=body.querySelector(".vf-fit");
        if(!host||!pv2)return;
        var w=Math.round(pwFor());
        if(Math.abs(host.clientWidth-w)<48)return;   /* 变化不大不折腾 */
        var idx=0;try{idx=pv2.currentIndex||0;}catch(e){}
        body.innerHTML='<div class="vf-load"><span class="vp-spin"></span>正在调整…</div>';
        pv2=null;
        renderOnce(idx);
      },450);}

      layer.addEventListener("click",function(e){
        if(e.target.closest(".vf-x")){closeFull();return;}
        var b=e.target.closest("[data-a]");if(!b)return;
        if(b.dataset.a==="close"){closeFull();return;}
        go(b.dataset.a==="next"?1:-1);
      });
      var sx=0,sy=0,sw=false;
      body.addEventListener("touchstart",function(e){
        var t=e.touches&&e.touches[0];if(!t)return;
        sx=t.clientX;sy=t.clientY;sw=true;
      },{passive:true});
      body.addEventListener("touchend",function(e){
        if(!sw)return;sw=false;
        var t=e.changedTouches&&e.changedTouches[0];if(!t)return;
        var dx=t.clientX-sx,dy=t.clientY-sy;
        if(Math.abs(dx)>44&&Math.abs(dx)>Math.abs(dy)*1.4)go(dx<0?1:-1);
      },{passive:true});
      window.addEventListener("resize",onRes);
      window.addEventListener("orientationchange",onRes);

      renderOnce(0);
      /* Android：申请系统全屏并锁横屏，一进来就是横屏大字；不支持就静默降级 */
      try{
        var pr=layer.requestFullscreen?layer.requestFullscreen({navigationUI:"hide"}):null;
        if(pr&&pr.then)pr.then(function(){
          try{
            if(screen.orientation&&screen.orientation.lock)
              screen.orientation.lock("landscape").catch(function(){});
          }catch(e){}
        }).catch(function(){});
      }catch(e){}
    }

    /* 滑动翻页（放大状态下交给滚动手势） */
    var sx=0,sy=0,on=false;
    scroll.addEventListener("touchstart",function(e){
      if(scroll.classList.contains("zoom")){on=false;return;}
      var t=e.touches&&e.touches[0];if(!t)return;
      sx=t.clientX;sy=t.clientY;on=true;
    },{passive:true});
    scroll.addEventListener("touchend",function(e){
      if(!on)return;on=false;
      var t=e.changedTouches&&e.changedTouches[0];if(!t)return;
      var dx=t.clientX-sx,dy=t.clientY-sy;
      if(Math.abs(dx)>44&&Math.abs(dx)>Math.abs(dy)*1.4)go(dx<0?1:-1);
    },{passive:true});

    num();
    /* 打开即自动放映；关闭查看器/切走时由 active 统一停表 */
    active=function(){stopTimer();mode="paused";};
    setTimeout(function(){ if(scroll.isConnected)play(); },400);
  }

  /* build 完成后接 UI（build 内部可能重建一次，所以在这里挂） */
  var origBuild=build;
  build=function(buf,ratio,depth){
    return origBuild(buf,ratio,depth).then(function(pv){wire(pv);return pv;});
  };
}

/* ---------- 封面缩略图（cover 层调用，2026-10-24） ----------
   把 .pptx 第一页离屏渲染成小图并缓存到 localStorage，
   案例卡片「打开就能看到第一页」就是靠它。失败时安静返回错误，
   卡片保持原有 📄 文件占位（优雅降级）。 */
var COVER_KEY="yrb_pptcover_v1";
function coverGet(key){
  try{
    var o=JSON.parse(localStorage.getItem(COVER_KEY)||"{}");
    var e=o[key];
    return e&&e.d?e.d:null;
  }catch(e){return null;}
}
function coverPut(key,d){
  try{
    var o=JSON.parse(localStorage.getItem(COVER_KEY)||"{}");
    o[key]={d:d,t:Date.now()};
    var ks=Object.keys(o);
    while(ks.length>24)delete o[ks.shift()];        /* LRU 上限 24 个 ≈ 1MB */
    try{localStorage.setItem(COVER_KEY,JSON.stringify(o));}
    catch(qe){                                       /* 超配额：砍掉最旧一半再试一次 */
      var arr=ks.sort(function(a,b){return (o[a].t||0)-(o[b].t||0);});
      for(var i=0;i<Math.ceil(arr.length/2);i++)delete o[arr[i]];
      try{localStorage.setItem(COVER_KEY,JSON.stringify(o));}catch(e2){}
    }
  }catch(e){}
}
function thumb(file){
  file=file||{};
  var key=file.path||file.url||"";
  if(!key)return Promise.reject(new Error("no-url"));
  var hit=coverGet(key);
  if(hit)return Promise.resolve(hit);
  return loadLib().then(function(){
    return getBuf(file.url).catch(function(err){
      var m=(err&&err.message)||"";
      if(file.path&&/HTTP 4\d\d/.test(m)&&window.YRB_CLOUD&&YRB_CLOUD.resignUrl){
        return YRB_CLOUD.resignUrl(file.path).then(function(u2){
          if(!u2)throw err;
          return getBuf(u2);
        });
      }
      throw err;
    });
  }).then(function(buf){
    return sanitize(buf).then(function(b2){
      return new Promise(function(res,rej){
        var TW=360,TH=Math.round(TW*9/16);
        var host=document.createElement("div");
        host.style.cssText="position:fixed;left:-9999px;top:0;width:"+TW+"px;";
        document.body.appendChild(host);
        var pv;
        try{ pv=window.pptxPreview.init(host,{width:TW,height:TH,mode:"slide"}); }
        catch(e){ try{host.remove();}catch(e2){} return rej(e); }
        function grab(){
          try{
            if(!pv.slideCount)throw new Error("empty");
            /* 引擎把幻灯片渲染成内联 SVG（也可能 canvas/img，都兜住） */
            var d=null;
            var cv=host.querySelector("canvas");
            if(cv&&cv.width)d=cv.toDataURL("image/jpeg",0.55);
            if(!d){
              /* 挑面积最大的 SVG = 当前幻灯片（另一个通常是导航箭头小图标） */
              var best=null,bestA=0;
              var svgs=host.querySelectorAll("svg");
              for(var i=0;i<svgs.length;i++){
                var r=svgs[i].getBoundingClientRect();
                var a=(r.width||0)*(r.height||0);
                if(a>bestA){bestA=a;best=svgs[i];}
              }
              if(best){
                var txt=new XMLSerializer().serializeToString(best);
                if(txt.indexOf("xmlns")===-1)
                  txt=txt.replace(/<svg/i,'<svg xmlns="http://www.w3.org/2000/svg"');
                var svgUrl="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(txt);
                try{
                  /* 优先栅格化成小 JPEG（体积小、缓存友好） */
                  var im2=new Image();
                  var done2=function(dd){ if(dd)coverPut(key,dd); try{host.remove();}catch(e9){} dd?res(dd):rej(new Error("no-frame")); };
                  im2.onload=function(){
                    try{
                      var c2=document.createElement("canvas");
                      c2.width=TW;c2.height=TH;
                      c2.getContext("2d").drawImage(im2,0,0,TW,TH);
                      done2(c2.toDataURL("image/jpeg",0.55));
                    }catch(e7){ done2(svgUrl); }   /* 画布被污染等 → 直接用 SVG */
                  };
                  im2.onerror=function(){ done2(svgUrl); };
                  im2.src=svgUrl;
                  return;                            /* 异步完成，这里不再往下走 */
                }catch(e8){}
              }
            }
            if(!d)throw new Error("no-frame");
            coverPut(key,d);
            try{host.remove();}catch(e4){}
            res(d);
          }catch(e){ try{host.remove();}catch(e5){} rej(e); }
        }
        pv.preview(b2).then(function(){
          /* 真实比例与 16:9 差得多时按真实比例重画一次（与 mount 的 build 同策略） */
          try{
            var w=(pv.pptx&&pv.pptx.width)||0,h=(pv.pptx&&pv.pptx.height)||0;
            if(w&&h&&Math.abs(h/w-9/16)>0.04){
              TH=Math.round(TW*h/w);
              try{host.remove();}catch(e6){}
              host=document.createElement("div");
              host.style.cssText="position:fixed;left:-9999px;top:0;width:"+TW+"px;";
              document.body.appendChild(host);
              pv=window.pptxPreview.init(host,{width:TW,height:TH,mode:"slide"});
              pv.preview(b2).then(grab,function(e){try{host.remove();}catch(e2){}rej(e);});
              return;
            }
          }catch(e){}
          grab();
        }).catch(function(e){ try{host.remove();}catch(e2){} rej(e); });
      });
    });
  });
}

window.YRB_PPT={mount:mount,thumb:thumb,pagesFor:pagesFor};
})();
