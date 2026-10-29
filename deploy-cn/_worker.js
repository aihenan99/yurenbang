/* 育人帮 · Cloudflare Pages _worker.js（高级模式）
 *
 * 1) /yrbapi/*  → 同源反向代理到 WorkBuddy 云服务端点。
 *    背景：云服务端点按「精确 Origin 白名单」校验客户端，只放行
 *    *.app.workbuddy.host；站点迁到自定义域名后浏览器直连一律 403
 *    "the request origin is not allowed for this client"。由本代理改写
 *    Origin/Referer 转发（后端对白名单 Origin 放行），前端 cloud.js 的
 *    endpoint 已指向 https://xn--gmqq09al6z.cn/yrbapi。
 *    注意：/api/* 被 zone 里旧版残留的 Worker 占用，所以用 /yrbapi。
 * 2) 其余路径 → 静态资源。**只放行已知的真实文件/目录**，其余一律返回
 *    带 404 状态码的错误页。
 *    2026-10-22 为什么要这样：Pages 的 ASSETS 绑定对未命中路径会回落到
 *    index.html，于是随便编一个网址都返回 200 + 首页内容（软 404）。百度/
 *    必应会把这类页面判成重复内容，sitemap 里的死链也变成"有效页"。
 *    应用内部路由全部走 hash（#page-cases 等），不依赖 path，所以可以严格化。
 */
const UPSTREAM = "https://yurenbang.app.workbuddy.host";
const PREFIX = "/yrbapi";
const BUILD_TAG = "202610292033-build";

/* ============================================================
   /yrbtts —— AI 真人语音合成代理（2026-10-24）
   GET /yrbtts?t=<文本>&r=norm|slow
   → 服务端直连微软 Edge 神经语音（zh-CN-YunyangNeural「云扬」，
     央视新闻播音员音色），返回 audio/mpeg。
   · Sec-MS-GEC v2 令牌在 Worker 内计算（SHA256+CS64 定制算法，
     与 rany2/edge-tts 对拍一致）
   · caches.default 按 URL 缓存（同文本同一音频），边缘命中零成本
   · 任何失败返回 502，前端自动退回本机语音，绝不卡死朗读
   ============================================================ */
const TTS_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const TTS_WSS = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=" + TTS_TOKEN;
const TTS_GEC_VERSION = "2-143.0.3650.75";
const TTS_ORIGIN = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";
const TTS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";
const TTS_VOICE = "zh-CN-YunyangNeural";

const U32 = 0xFFFFFFFF;
const u32 = x => x >>> 0;
const rol16 = v => u32((u32(v) << 16) | (u32(v) >>> 16));
const rotr = (v, n) => u32((u32(v) >>> n) | (u32(v) << (32 - n)));
const T_RC = [0x428A2F98,0x71374491,0xB5C0FBCF,0xE9B5DBA5,0x3956C25B,0x59F111F1,0x923F82A4,0xAB1C5ED5,0xD807AA98,0x12835B01,0x243185BE,0x550C7DC3,0x72BE5D74,0x80DEB1FE,0x9BDC06A7,0xC19BF174,0xE49B69C1,0xEFBE4786,0x0FC19DC6,0x240CA1CC,0x2DE92C6F,0x4A7484AA,0x5CB0A9DC,0x76F988DA,0x983E5152,0xA831C66D,0xB00327C8,0xBF597FC7,0xC6E00BF3,0xD5A79147,0x06CA6351,0x14292967,0x27B70A85,0x2E1B2138,0x4D2C6DFC,0x53380D13,0x650A7354,0x766A0ABB,0x81C2C92E,0x92722C85,0xA2BFE8A1,0xA81A664B,0xC24B8B70,0xC76C51A3,0xD192E819,0xD6990624,0xF40E3585,0x106AA070,0x19A4C116,0x1E376C08,0x2748774C,0x34B0BCB5,0x391C0CB3,0x4ED8AA4A,0x5B9CCA4F,0x682E6FF3,0x748F82EE,0x78A5636F,0x84C87814,0x8CC70208,0x90BEFFFA,0xA4506CEB,0xBEF9A3F7,0xC67178F2];
const T_RC_BLOCK = T_RC.slice(0, 14).concat([0xC9DC06A7], T_RC.slice(15));
const T_INIT = [0x6A09E667,0xBB67AE85,0x3C6EF372,0xA54FF53A,0x510E527F,0x9B05688C,0x1F83D9AB,0x5BE0CD19];
const T_STATE = [0xFD9FBEA2,0x91243CE7,0xBE499094,0xCD2E1E0A,0x6C006F49,0x04BD35AB,0xFEB0A7E4,0x03EFFBD2];
const T_SCHED14 = [0xEB24BF9E,0x1558691F,0xA0C09EE2,0x0CFA32BA,0xA622EE8C,0xD1DD9491,0xC0DD25A0,0xF9E70AB6,0xF0C31573,0x7058CE4E,0x7188E606,0x00E5AB33,0xD258B060,0x72766564];
const T_ADJ = 0xC9DC06A7, T_S0A = 0x059C0B80, T_S1A = 0x000B92C0;
const T_COEFFS = [[0xE82E91B1,0xB32700D0],[0x44DE24C6,0x88DFF51D],[0x3BEB65BC,0x29514038],[0xC89C5933,0xB328CBDF],[0x8D1EC211,0xD405B4D5],[0x314EF5D5,0x26E55F3C],[0xE92491B1,0x607801C6],[0xF0A5B9D5,0x82B2C1FB],[0x06064CF3,0xFA51A3DA],[0xDA79FA60,0x207CC464],[0xBED20560,0x3C3C74F3],[0x89F9C9F8,0xD2D14B61],[0x35FA38C6,0xBB04A2C1],[0xCB49E3C6,0xC5626167]];

function tSigma0(v){ return u32(u32(v)>>>7 ^ u32(v)<<25 ^ u32(v)>>>18 ^ u32(v)<<14 ^ u32(v)>>>3); }
function tSigma1(v){ return u32(u32(v)>>>17 ^ u32(v)<<15 ^ u32(v)>>>19 ^ u32(v)<<13 ^ u32(v)>>>10); }
function tExpand(words, first){ for(let i=first;i<64;i++){ const x=words[i-2], y=words[i-15]; words[i]=u32(tSigma1(x)+words[i-7]+tSigma0(y)+words[i-16]); } }
function tRounds(state, words, K, start){
  let a=state[0],b=state[1],c=state[2],d=state[3],e=state[4],f=state[5],g=state[6],h=state[7];
  for(let i=start||0;i<64;i++){
    const S1=rotr(e,6)^rotr(e,11)^rotr(e,25);
    const t1=u32(u32(h+S1+(g^(e&(f^g)))+K[i])+words[i]);
    const S0=rotr(a,2)^rotr(a,13)^rotr(a,22);
    const t2=u32(S0+((a&b)|(c&(a|b))));
    h=g;g=f;f=e;e=u32(d+t1);d=c;c=b;b=a;a=u32(t1+t2);
  }
  return [a,b,c,d,e,f,g,h];
}
function tShaInit(salt){
  const words=[0,0,0,0,0,0,0,0,0,0,0,0,0,0];
  words.push((salt[0]<<16)|(salt[1]<<8)|salt[2]);
  words.push((salt[3]<<24)|(salt[4]<<16)|(salt[5]<<8)|salt[6]);
  for(let index=16;index<30;index++){
    let value=T_SCHED14[index-16];
    if(index-2>=14) value=u32(value+(index===16?(tSigma1(words[14])^T_S1A):tSigma1(words[index-2])));
    if(index-7>=14) value=u32(value+words[index-7]);
    if(index-15>=14) value=u32(value+(index===29?(tSigma0(words[index-15])^T_S0A):tSigma0(words[index-15])));
    words.push(u32(value));
  }
  words.push(u32(tSigma1(words[28])+words[23]+tSigma0(words[15])+words[14]+u32(T_ADJ-T_RC[14])));
  tExpand(words,31);
  const w=tRounds(T_STATE,words,T_RC_BLOCK,14);   /* init 从第 14 轮恢复 */
  return T_INIT.map((x,i)=>u32(x+w[i]));
}
function tShaDigest(data){
  const length=57+data.length;
  const z=((55-length)%64+64)%64;
  const lenBuf=new ArrayBuffer(8); new DataView(lenBuf).setBigUint64(0,BigInt(length*8));
  const parts=[data.slice(7),new Uint8Array([0x80]),new Uint8Array(z),new Uint8Array(lenBuf)];
  let total=0; parts.forEach(p=>total+=p.length);
  const padded=new Uint8Array(total); let off=0; parts.forEach(p=>{padded.set(p,off);off+=p.length;});
  let state=tShaInit(data.slice(0,7));
  for(let o=0;o<padded.length;o+=64){
    const words=[];
    for(let i=0;i<16;i++) words.push((padded[o+i*4]<<24)|(padded[o+i*4+1]<<16)|(padded[o+i*4+2]<<8)|padded[o+i*4+3]);
    tExpand(words,16);
    const w=tRounds(state,words,T_RC,0);
    state=state.map((x,i)=>u32(x+w[i]));
  }
  const out=new Uint8Array(32);
  state.forEach((x,i)=>{out[i*4]=x>>>24&255;out[i*4+1]=x>>>16&255;out[i*4+2]=x>>>8&255;out[i*4+3]=x&255;});
  return out;
}
function tCs64(data, digest){
  const dv=new DataView(digest.buffer,digest.byteOffset,8);
  const keyA=u32(dv.getUint32(0,true)|1), keyB=u32(dv.getUint32(4,true)|1);
  const fA=u32(Math.imul(keyA,0x82893933)), fB=u32(Math.imul(keyB,0x82893933));
  const factors=[fA,fB];
  const terms=T_COEFFS.map((c,i)=>u32(Math.imul(c[0],factors[i%2])));
  const offsets=T_COEFFS.map(c=>c[1]);
  const d=new Uint8Array(data.length+1); d.set(data,1);        /* b"\0"+data */
  const pad=(4-(d.length%4))%4;
  const full=new Uint8Array(d.length+pad); full.set(d);
  const words=[];
  const wdv=new DataView(full.buffer);
  for(let i=0;i<full.length;i+=4) words.push(wdv.getUint32(i,true));
  if(words.length%2) words.push(0);
  words.forEach((word,index)=>{
    let term=u32(Math.imul(word, index%2===0?keyA:keyB));
    let offset=u32(Math.imul(rol16(word), index%2===0?0xEF0569FB:0xC31713DB));
    if(index===0){ term=u32(term+u32(Math.imul(0xF2F90B1A,fA))); offset=u32(offset+0x0B1A0000); }
    terms.push(term); offsets.push(offset);
  });
  let swapAcc=0,swapLast=0,state=0,acc=0;
  for(let index=0;index<terms.length;index+=2){
    const x=terms[index], y=terms[index+1];
    let t=rol16(u32(offsets[index]+x));
    let q=u32(Math.imul(t,0x76F50F34));
    swapAcc=u32(swapAcc+u32(Math.imul(rol16(q),0xC3EFEA97)+q));
    t=rol16(u32(offsets[index+1]+y));
    q=u32(Math.imul(t,0x1881CE3C));
    swapLast=u32(Math.imul(rol16(q),0x35BD1EC9)+q);
    swapAcc=u32(swapAcc+swapLast);
    state=u32(Math.imul(state,keyA)+x);
    state=u32(Math.imul(rol16(state),0xCF98B111));
    state=u32(Math.imul(rol16(state),0x87085B9F));
    state=u32(Math.imul(rol16(state),0x12CEB96D));
    state=u32(Math.imul(rol16(state),0x257E1D83));
    acc=u32(acc+state);
    t=u32(Math.imul(state,keyB)+y);
    t=u32(Math.imul(rol16(t),0xA27416F5));
    t=u32(Math.imul(rol16(t),0xD38396FF));
    state=u32(Math.imul(rol16(u32(Math.imul(rol16(t),0x7C932B89))),0xBFA49F69));
    acc=u32(acc+state);
  }
  return [u32(swapLast^state), u32(swapAcc^acc)];
}
function ttsSecMsGec(){
  let t=Math.floor(Date.now()/1000)+11644473600;
  t-=t%300;
  const str=BigInt(t*1e7).toString()+TTS_TOKEN;   /* 与参考实现同精度浮点乘法 */
  const data=new TextEncoder().encode(str);
  const digest=tShaDigest(data);
  const [w1,w2]=tCs64(data,digest);
  const b=new Uint8Array(8); new DataView(b.buffer).setUint32(0,w1,true); new DataView(b.buffer).setUint32(4,w2,true);
  const hex=Array.from(b).map(x=>x.toString(16).padStart(2,"0")).join("").toUpperCase();
  const dhex=Array.from(digest).map(x=>x.toString(16).padStart(2,"0")).join("").toUpperCase();
  return hex+"-"+dhex;
}
function xmlEsc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;"); }
async function ttsSynthesize(text, slow){
  /* Workers 出站 WebSocket：fetch + Upgrade 头 → resp.webSocket（不能用 new WebSocket 传头） */
  const gec=ttsSecMsGec();
  /* wss:// 换成 https://：Workers fetch 用 Upgrade: websocket 头建立 WS 连接 */
  const hs=await fetch(TTS_WSS.replace(/^wss:\/\//,"https://")+"&Sec-MS-GEC="+gec+"&Sec-MS-GEC-Version="+TTS_GEC_VERSION,{
    headers:{ "Upgrade":"websocket", "Origin":TTS_ORIGIN, "User-Agent":TTS_UA,
      "Accept-Language":"en-US,en;q=0.9", "Cache-Control":"no-cache", "Pragma":"no-cache" } });
  if(!hs.webSocket) throw new Error("ws handshake "+hs.status);   /* 101 也算成功（Response.ok 不含 1xx） */
  const ws=hs.webSocket; ws.accept();
  /* workerd：accept() 后连接即已打开，不会触发 open 事件，配置与 SSML 立即发送 */
  ws.send("X-Timestamp:"+new Date().toString()+"\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n"+
    JSON.stringify({context:{synthesis:{audio:{metadataoptions:{sentenceBoundaryEnabled:"false",wordBoundaryEnabled:"false"},outputFormat:"audio-24khz-48kbitrate-mono-mp3"}}}}));
  const ssml="<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'><voice name='"+TTS_VOICE+"'><prosody rate='"+(slow?"-15%":"+0%")+"'>"+xmlEsc(text)+"</prosody></voice></speak>";
  ws.send("X-RequestId:"+crypto.randomUUID().replace(/-/g,"")+"\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n"+ssml);
  const rate=slow?"-15%":"+0%";
  const chunks=[];
  return new Promise((resolve,reject)=>{
    let settled=false;
    const to=setTimeout(()=>{ if(!settled){settled=true;try{ws.close(1000);}catch(e){} reject(new Error("tts timeout")); } },12000);
    const fin=(ok,val)=>{ if(!settled){settled=true;clearTimeout(to);try{ws.close(1000);}catch(e){} ok?resolve(val):reject(val);} };
    ws.addEventListener("message",ev=>{
      if(typeof ev.data==="string"){
        if(ev.data.indexOf("Path:turn.end")>=0){
          const total=chunks.reduce((a,b)=>a+b.byteLength,0);
          const out=new Uint8Array(total); let off=0;
          chunks.forEach(c=>{out.set(new Uint8Array(c),off);off+=c.byteLength;});
          fin(true,out.buffer);
        }
        return;
      }
      Promise.resolve().then(()=>{
        const raw=ev.data;
        if(raw instanceof ArrayBuffer) return raw;
        if(raw&&raw.arrayBuffer) return raw.arrayBuffer();
        if(raw&&raw.buffer) return raw.buffer.slice(raw.byteOffset||0,(raw.byteOffset||0)+raw.byteLength);
        return null;
      }).then(buf=>{
        if(!buf) return;
        const u8=new Uint8Array(buf);
        const hlen=(u8[0]<<8)|u8[1];
        const head=new TextDecoder().decode(u8.slice(2,2+hlen));
        if(head.indexOf("Path:audio")>=0) chunks.push(buf.slice(2+hlen));
      }).catch(()=>{});
    });
    ws.addEventListener("close",()=>{ fin(false,new Error("tts closed early")); });
    ws.addEventListener("error",()=>{ fin(false,new Error("tts ws error")); });
  });
}
async function handleTts(request, url){
  const text=(url.searchParams.get("t")||"").slice(0,400);
  const slow=url.searchParams.get("r")==="slow";
  if(!text) return new Response(JSON.stringify({error:"no text"}),{status:400,headers:{"content-type":"application/json"}});
  const cache=caches.default;
  try{ const hit=await cache.match(request); if(hit) return hit; }catch(e){}
  try{
    const mp3=await ttsSynthesize(text,slow);
    if(!mp3||!mp3.byteLength) throw new Error("empty audio");
    const resp=new Response(mp3,{status:200,headers:{
      "content-type":"audio/mpeg","cache-control":"public, max-age=86400",
      "access-control-allow-origin":url.origin,"x-yrb-tts":"1"}});
    try{ await cache.put(request,resp.clone()); }catch(e){}
    return resp;
  }catch(err){
    console.error("[yrbtts] error:", String(err&&err.message||err).slice(0,200)); /* 审核 M12：原文进日志，对外固定文案 */
    return new Response(JSON.stringify({error:"tts_failed",message:"语音合成暂时不可用，将改用本机朗读"}),{status:502,headers:{"content-type":"application/json","access-control-allow-origin":url.origin}});
  }
}


/* 2026-10-18 修正：**不要剥 Origin，而是改写成白名单内的正式 Origin**。
   云端把「短信验证码会话」绑定在签发时的客户端上下文上，请求若没有 Origin
   会被当成另一个客户端，验证时直接报
   "the session is invalid, expired or issued for another client"（用户实测）。
   上游 Origin 白名单只放行 *.app.workbuddy.host，所以这里填正式站点域名。 */
const STRIP = ["host", "x-forwarded-host", "x-forwarded-proto",
  "cf-connecting-ip", "cf-ipcountry", "cf-ray", "cf-visitor", "cf-worker",
  "cdn-loop", "x-real-ip", "true-client-ip"];

/* 允许直达的固定路径（真实存在的文件 + 站点根） */
const ALLOW = new Set([
  "/", "/index.html", "/share", "/share.html", "/error.html",
  "/sitemap.xml", "/robots.txt", "/manifest.webmanifest", "/sw.js",
  "/build.json",   /* 平稳升级层探测线上构建号，必须允许匿名访问 */
  "/favicon.ico", "/favicon.png", "/8f3c2a7d94b14e6f9a0c5d2e7b3f18a6.txt",
]);

/* 静态案例库页面（由 temp/sync_deploy.py 按 yurenbang-app/anli/ 实际文件名注入，
   占位符保留在源码里，注入后是一份显式清单） */
const ANLI = new Set(["/anli/erhai-zhengchao.html", "/anli/erhai-zhengchao", "/anli/gedai-yangyu-chongtu.html", "/anli/gedai-yangyu-chongtu", "/anli/haizi-bei-guli.html", "/anli/haizi-bei-guli", "/anli/haizi-chenmi-shouji.html", "/anli/haizi-chenmi-shouji", "/anli/haizi-sahuang.html", "/anli/haizi-sahuang", "/anli/haizi-xie-zuoye-tuola.html", "/anli/haizi-xie-zuoye-tuola", "/anli/index.html", "/anli/kaoshi-kaoza-qingxu.html", "/anli/kaoshi-kaoza-qingxu", "/anli/qingchunqi-buyuan-goutong.html", "/anli/qingchunqi-buyuan-goutong", "/anli/xie-zuowen-mei-hua-shuo.html", "/anli/xie-zuowen-mei-hua-shuo", "/anli/zaoshang-moceng-shangxue.html", "/anli/zaoshang-moceng-shangxue"]); /* __ANLI_INJECTED__ */

function allowed(path) {
  if (ALLOW.has(path)) return true;
  if (path.indexOf("/assets/") === 0) return true;     // 静态资源目录
  if (path.indexOf("/baidu_verify_") === 0) return true; // 百度/搜索平台文件验证
  if (ANLI.has(path)) return true;                      // 案例库已知页面
  if (path === "/anli" || path === "/anli/") return true;
  return false;
}

async function notFound(url, env) {
  const errPage = await env.ASSETS.fetch(new URL("/error.html", url));
  const headers = new Headers(errPage.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-yrb-edge", BUILD_TAG);
  return new Response(errPage.body, { status: 404, statusText: "Not Found", headers: secure(headers) });
}

/* ============================================================
   安全加固层（2026-10-25 后台升级）
   1) 统一安全响应头：nosniff / DENY 嵌套 / Referrer 收敛 / 能力收敛
      （摄像头·麦克风·定位保持 self——长辈模式语音与拍摄要用，其余能力全关）
   2) 进程内限流（按 IP 滑动窗口）：
      /yrbtts 20 次/分（语音合成成本高）；/yrbapi 120 次/分（防脚本滥用）。
      注：Pages Functions 为多实例，此限流是"每实例"级别，用于抬高滥用
      门槛而非精确计量；真正的配额仍由上游与 TTS 缓存兜底。
   3) HTTP 方法白名单：TRACE/TRACK 等一律 405。
   ============================================================ */
/* ---------- 内容安全策略（CSP） ----------
 * 起点：先以 **Report-Only** 上线。它不阻断任何请求，只在浏览器控制台报违规，
 *       用来摸清"现有代码到底依赖哪些源"，避免一上来就把站打挂。
 *
 * 切换为强制模式（确认连续一周无违规后）：把下面这行改成
 *   const CSP_HEADER = "content-security-policy";
 * 只改这一个字符串，策略本身不动。
 *
 * 策略为什么这么写（每条都有实际原因）：
 *   'unsafe-inline'  首页有内联自愈脚本、JSON-LD、大量内联 style 属性
 *   'unsafe-eval'    PPT 渲染引擎（pptx-preview）内部用动态求值
 *   blob: data:      录制预览、粘贴图片、离线草稿都是 Blob/data URL
 *   img-src https:   云端存储的签名图片地址（跨域，域名随平台变化）
 *   media-src https: 同上，视频/语音
 *   frame-src blob:  PPT/全屏查看器可能用 Blob 地址装载
 *   worker-src       Service Worker 与后台压缩
 *   object-src none  禁止 Flash/插件类嵌入（历史遗留攻击面）
 *   frame-ancestors  比 X-Frame-Options 更现代，二者并存兼容旧浏览器
 */
const CSP_HEADER = "content-security-policy-report-only";
/* P3 分路径强制（2026-10-29，预案 docs/CSP转强制预案.md）：纯静态、无云交互的页面
   先转强制，逐批扩大；回滚 = 从集合删掉对应路径。hash 已由演练器在强制模式下
   三页走查零违规（含 share.html 自己的内联块），这一步是执行既定预案。 */
const CSP_ENFORCE = ["/anli/", "/share.html"];
function cspNameFor(path) {
  return CSP_ENFORCE.some((p) => path === p || path.startsWith(p))
    ? "content-security-policy"
    : CSP_HEADER;
}
const CSP_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'sha256-WSR3JsBOi1ku91HBvFogs6slXsjcLEp2xrq2WzB/6Mg=' 'sha256-MsIHKWwAkOqHuy+fS8Dh6+h8aIJ9trABD9s34o3VFi0=' 'sha256-4Af4t/iEQUgw37MgnPKy3KbnTbaaP0NhuLE9rncYZGM=' 'sha256-PwOZ9r7SB3z+7SEQtn2TQ4eugxNK+o6fhQ6J7lzc8n4='",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https:",
  "frame-src 'self' blob: https:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

function secure(h, path) {
  h.set("x-content-type-options", "nosniff");
  h.set("x-frame-options", "DENY");
  h.set("referrer-policy", "strict-origin-when-cross-origin");
  h.set("permissions-policy", "camera=(self), microphone=(self), geolocation=(self), payment=()");
  /* HSTS：180 天。刻意不加 includeSubDomains / preload——两者都难回退，
     等真正有子域需要 HTTPS 时再单独评估。 */
  h.set("strict-transport-security", "max-age=15552000");
  h.set(cspNameFor(path || ""), CSP_POLICY);
  return h;
}
const RL = new Map();
function rateLimit(ip, limit, windowMs) {
  const now = Date.now();
  let b = RL.get(ip);
  if (!b || now - b.t0 > windowMs) { b = { t0: now, n: 0 }; RL.set(ip, b); }
  b.n++;
  if (RL.size > 5000) { for (const [k, v] of RL) { if (now - v.t0 > windowMs) { RL.delete(k); } } }
  return b.n <= limit;
}
function tooMany(url, msg) {
  return new Response(JSON.stringify({ error: "rate_limited", message: msg }), {
    status: 429,
    headers: secure(new Headers({ "content-type": "application/json", "access-control-allow-origin": url.origin, "retry-after": "30" })),
  });
}
const OK_METHODS = new Set(["GET", "HEAD", "OPTIONS", "POST", "PUT", "DELETE", "PATCH"]);

/* 审核 H3（2026-10-29）：同源校验。
 * 本代理对任何调用方都会把 Origin 改写成上游白名单值——不校验请求来源的话，
 * 任何脚本都能借道 /yrbapi 打上游（刷验证码短信轰炸、耗上游配额），
 * 部署包里还有可被针对的管理员号。规则：
 *   有 Origin → 必须是本站 host（"null" 拒）
 *   无 Origin → 看 Referer（同源 GET fetch 不带 Origin 但带 Referer）
 *   都没有   → 拒（浏览器内同源请求必带其一；curl/脚本直连就此打不通）
 * 适用 /yrbapi 与 /yrbtts 两条代理线。 */
function sameOriginOk(request, url) {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const hostOk = (h) => { try { return new URL(h).host === url.host; } catch (_) { return false; } };
  if (origin) return origin !== "null" && hostOk(origin);
  if (referer) return hostOk(referer);
  return false;
}
function forbiddenOrigin(url) {
  return new Response(JSON.stringify({ error: "forbidden_origin", message: "请从育人帮站点内使用" }), {
    status: 403,
    headers: secure(new Headers({ "content-type": "application/json", "access-control-allow-origin": url.origin })),
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /* 方法白名单：探测类方法直接拒绝 */
    if (!OK_METHODS.has(request.method)) {
      return new Response("Method Not Allowed", { status: 405, headers: secure(new Headers({ "allow": "GET, HEAD, OPTIONS, POST, PUT, DELETE, PATCH" })) });
    }
    const ip = request.headers.get("cf-connecting-ip") || url.hostname || "unknown";

    if (url.pathname === "/yrbtts") {
      /* 语音合成限流：20 次/分/IP（正常朗读远用不到，主要防脚本盗刷） */
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: secure(new Headers({ "content-type": "application/json" })) });
      }
      if (!sameOriginOk(request, url)) return forbiddenOrigin(url); /* 审核 H3：防盗刷朗读配额 */
      if (!rateLimit(ip + "|tts", 20, 60000)) return tooMany(url, "朗读请求太频繁，请稍后再试");
      const r = await handleTts(request, url);
      const h = secure(new Headers(r.headers));
      return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
    }

    if (url.pathname === PREFIX || url.pathname.startsWith(PREFIX + "/")) {
      /* 云端 API 限流：120 次/分/IP（正常页面交互每分钟几十次以内） */
      if (!rateLimit(ip + "|api", 120, 60000)) return tooMany(url, "请求太频繁，请稍后再试");
      /* 审核 H3：同源校验——本代理是唯一 Origin 改写点，不校验来源＝开放中继 */
      if (!sameOriginOk(request, url)) return forbiddenOrigin(url);
      const sub = url.pathname.slice(PREFIX.length) || "/";
      const target = UPSTREAM + sub + url.search;

      const headers = new Headers(request.headers);
      for (const h of STRIP) headers.delete(h);
      /* 统一改写为白名单 Origin / Referer，保证「签发 ↔ 校验」客户端上下文一致 */
      headers.set("origin", UPSTREAM);
      if (headers.has("referer")) headers.set("referer", UPSTREAM + "/");

      const init = { method: request.method, headers, redirect: "manual" };
      if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = await request.arrayBuffer();
      }

      try {
        const resp = await fetch(target, init);
        const out = new Headers(resp.headers);
        out.set("access-control-allow-origin", url.origin);
        out.set("x-yrb-proxy", "1");
        return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: secure(out) });
      } catch (err) {
        /* 审核 M12：对外只给固定文案——原错误串可能带上游主机名/栈细节；
           原文进边缘日志（wrangler tail / Pages 控制台可查） */
        console.error("[yrbapi] upstream error:", String(err));
        return new Response(JSON.stringify({ error: "upstream_error", message: "云端服务暂时不可用，请稍后再试" }), {
          status: 502,
          headers: secure(new Headers({ "content-type": "application/json", "access-control-allow-origin": url.origin })),
        });
      }
    }

    if (!allowed(url.pathname)) return notFound(url, env);

    const asset = await env.ASSETS.fetch(request);
    if (asset.status === 404) return notFound(url, env);
    /* 资源存在时补一个构建标记，方便线上核对是否为新版本 */
    const h = new Headers(asset.headers);
    h.set("x-yrb-edge", BUILD_TAG);
    return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers: secure(h, url.pathname) });
  },
};
